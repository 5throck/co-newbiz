// @version 1.1.0
// 1.1.0: channel-level is_test webhook expansion for admin test sends (design section 13.7) — testWebhookTargetKey() honors the admin-requested notify_webhook_target key carried on a trigger_type='test' notification's payload; the severity→target mapping (webhookTargetKeyFor) still applies to real traffic.
/**
 * notify.deliver - the delivery worker for immediate notifications (ADR-0189/0190, scheduled-jobs design section 13.2,
 * phase P3 row 3). Runs every tick (timeout 50 s so it never overlaps the next tick; the job lease guards overlap too).
 *
 * Loop (two phases, both idempotent):
 *   1. EXPAND - notifications of the last 24 h that lack BOTH a delivery row and an in-app fan-out child are resolved
 *      through db/lib/notify/policy.ts and expanded into notification_delivery rows per recipient x external channel
 *      (INSERT OR IGNORE on the COALESCE unique index makes re-expansion a no-op). In-app needs no delivery row for an
 *      already-addressed user (the notification row IS the delivery); a 'system' parent is fanned out into one
 *      in-app notification row per entitled recipient (watch-engine.ts per-user pattern), child source_ref
 *      'notification:<parentId>'. Webhook rows are channel-level: recipient NULL, target_key per D11 — trigger_type
 *      'batch_failure' ALWAYS maps to 'ops' (the scheduler/batch channel; an urgent escalation must not post to the
 *      business channel), every other trigger maps by severity (ops → 'ops', else 'deals'). The mapping is
 *      handler-level per the 0185 comment, so the unique index collapses multiple entitled recipients into one post
 *      per target.
 *   2. SEND - rows status IN (pending, retry) AND next_attempt_at <= now AND parent bundle = 'immediate' (daily rows
 *      belong to notify.digest). Claimed by a CAS flip of next_attempt_at (+60 s soft lease) under the job lease.
 *
 * Retry policy (design section 13.2): retryable sender errors (EmailError smtp_retryable/timeout, WebhookError
 * http_retryable/timeout/network) back off 1/5/15/60 min (MAX_DELIVERY_ATTEMPTS = 4: sends 1..4, so waits 1/5/15 are
 * used; the 60 min slot applies if the cap is ever raised) and honour a larger Retry-After. Terminal errors
 * (smtp_terminal, http_terminal = 4xx except 408/429) fail in one attempt. An unconfigured channel is recorded
 * `skipped` / `channel_unconfigured`, never an error storm. Terminal failure of an URGENT delivery produces one
 * ops notification for admins, in-app only (channel bound prevents a send loop).
 *
 * Testability: senders and clock are injectable; the DB is the caller's handle. All recipient addresses are stored
 * MASKED only (maskAddress); the raw address is read from app_user.email at send time and never persisted.
 * last_error comes from the Row 2 senders, whose messages are pre-scrubbed (passwords / webhook URLs never appear).
 */
import { scrubSecrets } from "../../../db/lib/secret-scrubber.ts";
import { ulid } from "../../../db/lib/ulid.ts";
import {
  EmailError,
  isEmailConfigured,
  maskAddress,
  renderEmailBody,
  sendEmail as sendEmailDefault,
  type NotifyView,
} from "../../../db/lib/notify/email.ts";
import {
  formatSlack,
  formatTeams,
  resolveTargetUrl,
  sendWebhook as sendWebhookDefault,
  WebhookError,
} from "../../../db/lib/notify/webhook.ts";
import {
  cooldownHoursFromSourceRef,
  resolveRecipients,
  type ExternalChannel,
  type NotificationRowLike,
} from "../../../db/lib/notify/policy.ts";
import type { JobHandler, JobResult } from "./types.ts";

/** Backoff schedule in minutes (design section 13.2); index = failed attempt count - 1, capped at the last entry. */
export const BACKOFF_MINUTES = [1, 5, 15, 60];
/** Per-delivery attempt cap (design section 13.2 "4 attempts default"): send #4 failing terminally retires the row. */
export const MAX_DELIVERY_ATTEMPTS = 4;
/** Expansion window: notifications newer than this are expanded; older ones keep in-app delivery only. */
export const EXPAND_WINDOW_HOURS = 24;
/** Rate limits (D14). urgent bypasses the per-user email limit, never the per-target or global limits. */
export const RATE_LIMIT_EMAIL_PER_MINUTE = 30;
export const RATE_LIMIT_WEBHOOK_PER_MINUTE_PER_TARGET = 20;
export const RATE_LIMIT_IMMEDIATE_EMAILS_PER_USER_PER_HOUR = 10;

export type SendEmailFn = typeof sendEmailDefault;
export type SendWebhookFn = typeof sendWebhookDefault;

export interface DeliverOnceOptions {
  now: Date;
  signal?: AbortSignal;
  /** test overrides of the Row 2 senders */
  sendEmail?: SendEmailFn;
  sendWebhook?: SendWebhookFn;
}

interface DeliveryDueRow {
  id: string;
  notification_id: string;
  recipient_user_id: string | null;
  recipient_address_masked: string | null;
  channel: "email" | "webhook";
  target_key: string | null;
  attempt: number;
  // joined notification columns
  dedupe_key: string | null;
  severity: NotifyView["severity"];
  trigger_type: string;
  title: string | null;
  project_id: string | null;
  bundle: "immediate" | "daily";
  source_ref: string | null;
}

const iso = (d: Date) => d.toISOString();

/** Deep-link base for the app (design section 13.1 "a deep link to the app"); empty when no origin env is set. */
export function deepLinkBase(): string | null {
  const o = process.env.CO_NEWBIZ_PUBLIC_ORIGIN?.trim() || process.env.CO_NEWBIZ_API_BASE_URL?.trim() || "";
  return o ? o.replace(/\/+$/, "") : null;
}

/** Build the MNPI-safe NotifyView from a notification row (title/severity/trigger/project code/deep link ONLY). */
export function buildNotifyView(
  db: any,
  n: { title: string | null; severity: string; trigger_type: string; project_id: string | null },
): NotifyView {
  const project = n.project_id
    ? (db.query("SELECT project_no FROM md_project WHERE id = ?").get(n.project_id) as
        | { project_no: string }
        | undefined)
    : undefined;
  const base = deepLinkBase();
  return {
    title: n.title ?? `${n.trigger_type} alert`,
    severity: n.severity as NotifyView["severity"],
    triggerType: n.trigger_type,
    projectCode: project?.project_no,
    deepLink: n.project_id && base ? `${base}/projects/${n.project_id}` : undefined,
  };
}

/**
 * Webhook channel key (D11): scheduler/batch failures ALWAYS go to the 'ops' target — the ops webhook is the
 * scheduler/batch channel, so an urgent batch_failure escalation must not post to the business channel. Every
 * other trigger maps by severity: ops → 'ops', anything else → 'deals'.
 */
export function webhookTargetKeyFor(severity: string, triggerType?: string): "ops" | "deals" {
  if (triggerType === "batch_failure") return "ops";
  return severity === "ops" ? "ops" : "deals";
}

/**
 * P4 test-send threading (design section 13.7): the admin names the webhook channel key EXPLICITLY on a
 * trigger_type='test' notification, so the requested key rides on the payload and is honored here — the
 * regular severity→target mapping (webhookTargetKeyFor) applies to real traffic only, and the D9 seed
 * grants webhook to urgent/ops traffic only, so a policy-driven expansion would silently drop an info/test
 * webhook row. Returns the key for test rows (defensively parsed), null for everything else.
 */
export function testWebhookTargetKey(n: { trigger_type: string; payload: string }): string | null {
  if (n.trigger_type !== "test") return null;
  try {
    const parsed = JSON.parse(n.payload) as { webhook_target_key?: unknown };
    return typeof parsed.webhook_target_key === "string" && parsed.webhook_target_key.trim() !== ""
      ? parsed.webhook_target_key.trim()
      : null;
  } catch {
    return null;
  }
}

/** Cap for the provider-controlled message id stored on a delivery row (F-3, P3 QA review). */
export const PROVIDER_MESSAGE_ID_MAX = 256;

/**
 * F-3 (P3 QA review): a provider message id is PROVIDER-CONTROLLED input, not our own — it is scrubbed through
 * the central scrubber (a hostile provider response must never park a credential-looking string on the row) and
 * length-capped at 256 before it reaches `notification_delivery.provider_message_id`. Applied at every store
 * site (notify-deliver email + webhook, notify-digest email).
 */
export function sanitizeProviderMessageId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const scrubbed = scrubSecrets(raw, { maxLen: PROVIDER_MESSAGE_ID_MAX });
  return scrubbed.length > 0 ? scrubbed : null;
}

function insertDeliveryRow(
  db: any,
  opts: {
    notificationId: string;
    recipientUserId: string | null;
    recipientAddressMasked: string | null;
    channel: ExternalChannel;
    targetKey: string | null;
    nowIso: string;
    /** 1 when the parent notification is an admin test send (trigger_type 'test', design section 13.7). */
    isTest?: number;
  },
): void {
  db.run(
    `INSERT OR IGNORE INTO notification_delivery
       (id, notification_id, recipient_user_id, recipient_address_masked, channel, target_key, status, attempt, next_attempt_at, created_at, is_test)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)`,
    [
      ulid(),
      opts.notificationId,
      opts.recipientUserId,
      opts.recipientAddressMasked,
      opts.channel,
      opts.targetKey,
      opts.nowIso,
      opts.nowIso,
      opts.isTest ?? 0,
    ],
  );
}

// ── Phase 1: expansion ───────────────────────────────────────────────────────

export function expandPending(db: any, now: Date): { deliveryRows: number; fanoutRows: number; scanned: number } {
  const nowIso = iso(now);
  const windowStart = iso(new Date(now.getTime() - EXPAND_WINDOW_HOURS * 3_600_000));
  // "Unexpanded" = no delivery rows AND no in-app fan-out children yet. Recent-window + LIMIT keep the scan bounded;
  // INSERT OR IGNORE makes a re-scan harmless (idempotent by the COALESCE unique index and the dedupe index).
  const pending = db
    .query(
      `SELECT n.* FROM notification n
       WHERE n.sent_at >= ?
         AND NOT EXISTS (SELECT 1 FROM notification_delivery d WHERE d.notification_id = n.id)
         AND NOT EXISTS (SELECT 1 FROM notification c WHERE c.source_ref = 'notification:' || n.id)
       ORDER BY n.sent_at
       LIMIT 500`,
    )
    .all(windowStart) as (NotificationRowLike & { payload: string })[];
  let deliveryRows = 0;
  let fanoutRows = 0;

  for (const n of pending) {
    // §13.7 test send to a webhook target: the admin addressed one channel key explicitly — a
    // channel-level row with is_test=1, bypassing policy audiences (the D9 seed grants webhook to
    // urgent/ops traffic only, so an info/test row would otherwise expand to nothing). Every other
    // channel of a test send flows through the normal path below.
    const forcedTestKey = testWebhookTargetKey(n);
    if (forcedTestKey) {
      insertDeliveryRow(db, {
        notificationId: n.id,
        recipientUserId: null,
        recipientAddressMasked: null,
        channel: "webhook",
        targetKey: forcedTestKey,
        nowIso,
        isTest: 1,
      });
      deliveryRows++;
      continue;
    }
    const resolution = resolveRecipients(db, n);
    // Design section 13.7: delivery rows of admin test sends (parent trigger_type 'test') are tagged
    // is_test = 1 so test traffic stays distinguishable in the delivery ledger forever.
    const isTest = n.trigger_type === "test" ? 1 : 0;
    for (const r of resolution.recipients) {
      for (const channel of r.channels) {
        if (channel === "email") {
          insertDeliveryRow(db, {
            notificationId: n.id,
            recipientUserId: r.recipientUserId,
            recipientAddressMasked: r.recipientAddress ? maskAddress(r.recipientAddress) : null,
            channel: "email",
            targetKey: null,
            nowIso,
            isTest,
          });
          deliveryRows++;
        } else {
          // Channel-level target (recipient NULL): the unique index collapses entitled recipients into one row.
          insertDeliveryRow(db, {
            notificationId: n.id,
            recipientUserId: null,
            recipientAddressMasked: null,
            channel: "webhook",
            targetKey: webhookTargetKeyFor(n.severity, n.trigger_type),
            nowIso,
            isTest,
          });
          deliveryRows++;
        }
      }
    }
    // In-app fan-out for system rows (per-user rows, watch-engine.ts pattern). Children carry channel='in_app' so a
    // later expansion of the child can never create external deliveries; the dedupe index stops duplicate fan-outs.
    for (const uid of resolution.inAppUserIds) {
      const res = db.run(
        `INSERT OR IGNORE INTO notification
           (id, user_id, project_id, trigger_type, severity, payload, channel, bundle, sent_at, dedupe_key, title, source_ref)
         SELECT ?, ?, project_id, trigger_type, severity, payload, 'in_app', bundle, ?, dedupe_key, title, ?
         FROM notification WHERE id = ?`,
        [ulid(), uid, nowIso, `notification:${n.id}`, n.id],
      );
      fanoutRows += res.changes;
    }
  }
  return { deliveryRows, fanoutRows, scanned: pending.length };
}

// ── Phase 2: send loop ───────────────────────────────────────────────────────

function sentCountSince(
  db: any,
  sinceIso: string,
  extra: { channel: "email" | "webhook"; userId?: string | null; targetKey?: string | null; immediateOnly?: boolean },
): number {
  const row = db
    .query(
      `SELECT COUNT(*) AS c FROM notification_delivery d JOIN notification n ON n.id = d.notification_id
       WHERE d.channel = ? AND d.status = 'sent' AND d.sent_at >= ?
       ${extra.userId !== undefined ? "AND d.recipient_user_id IS ?" : ""}
       ${extra.targetKey !== undefined ? "AND d.target_key IS ?" : ""}
       ${extra.immediateOnly ? "AND n.bundle = 'immediate'" : ""}`,
    )
    .get(
      ...[
        extra.channel,
        sinceIso,
        ...(extra.userId !== undefined ? [extra.userId] : []),
        ...(extra.targetKey !== undefined ? [extra.targetKey] : []),
      ],
    ) as { c: number };
  return row.c;
}

/** Rate limits (D14). Returns a short reason string when the row must be deferred, or null when it may send. */
export function rateLimitReason(db: any, row: DeliveryDueRow, now: Date): string | null {
  if (row.channel === "email") {
    if (
      sentCountSince(db, iso(new Date(now.getTime() - 60_000)), { channel: "email" }) >= RATE_LIMIT_EMAIL_PER_MINUTE
    ) {
      return "rate_limit:email_global";
    }
    // urgent bypasses the per-user limit; daily rows are digest-sent and never reach this loop anyway.
    if (row.severity !== "urgent" && row.bundle === "immediate") {
      const sent = sentCountSince(db, iso(new Date(now.getTime() - 3_600_000)), {
        channel: "email",
        userId: row.recipient_user_id,
        immediateOnly: true,
      });
      if (sent >= RATE_LIMIT_IMMEDIATE_EMAILS_PER_USER_PER_HOUR) return "rate_limit:email_per_user";
    }
  } else if (row.channel === "webhook") {
    const sent = sentCountSince(db, iso(new Date(now.getTime() - 60_000)), {
      channel: "webhook",
      targetKey: row.target_key,
    });
    if (sent >= RATE_LIMIT_WEBHOOK_PER_MINUTE_PER_TARGET) return "rate_limit:webhook_per_target";
  }
  return null;
}

/** Dedupe cooldown (design section 13.2): a same-key delivery to the same recipient+channel sent inside the window skips. */
export function isDedupeSuppressed(db: any, row: DeliveryDueRow, now: Date): boolean {
  if (!row.dedupe_key) return false;
  const hours = cooldownHoursFromSourceRef(db, row.source_ref, 24);
  const cutoff = iso(new Date(now.getTime() - hours * 3_600_000));
  const dupe = db
    .query(
      `SELECT 1 FROM notification_delivery d2 JOIN notification n2 ON n2.id = d2.notification_id
       WHERE n2.dedupe_key = ? AND d2.status = 'sent' AND d2.sent_at >= ?
         AND d2.recipient_user_id IS ? AND d2.channel = ? AND d2.target_key IS ?
       LIMIT 1`,
    )
    .get(row.dedupe_key, cutoff, row.recipient_user_id ?? null, row.channel, row.target_key ?? null);
  // bun:sqlite .get() yields null (not undefined) when no row matches — check against both.
  return dupe != null;
}

function markRow(db: any, id: string, fields: Record<string, string | number | null>): void {
  const sets = Object.keys(fields)
    .map((k) => `${k} = ?`)
    .join(", ");
  db.run(`UPDATE notification_delivery SET ${sets} WHERE id = ?`, [...Object.values(fields), id]);
}

/** Terminal failure of an URGENT delivery: one ops notification for admins, in-app only (loop guard, design 13.2). */
function recordUrgentTerminalOpsNotification(db: any, row: DeliveryDueRow, error: string, nowIso: string): void {
  db.run(
    `INSERT INTO notification (id, user_id, project_id, trigger_type, severity, payload, channel, bundle, sent_at, title, source_ref)
     VALUES (?, 'system', NULL, 'batch_failure', 'ops', ?, 'in_app', 'immediate', ?, ?, ?)`,
    [
      ulid(),
      JSON.stringify({ delivery_id: row.id, channel: row.channel, target_key: row.target_key, error }),
      nowIso,
      `${row.title ?? row.trigger_type} delivery failed`,
      `notification:${row.notification_id}`,
    ],
  );
}

export async function deliverOnce(db: any, opts: DeliverOnceOptions): Promise<JobResult> {
  const sendEmail = opts.sendEmail ?? sendEmailDefault;
  const sendWebhook = opts.sendWebhook ?? sendWebhookDefault;
  const signal = opts.signal ?? new AbortController().signal;
  const now = opts.now;
  const nowIso = iso(now);

  const expansion = expandPending(db, now);
  if (signal.aborted) return { rowsRead: expansion.scanned, detail: { ...expansion, reason: "aborted" } };

  const due = db
    .query(
      `SELECT d.id, d.notification_id, d.recipient_user_id, d.recipient_address_masked, d.channel, d.target_key, d.attempt,
              n.dedupe_key, n.severity, n.trigger_type, n.title, n.project_id, n.bundle, n.source_ref
       FROM notification_delivery d JOIN notification n ON n.id = d.notification_id
       WHERE d.status IN ('pending', 'retry') AND d.next_attempt_at IS NOT NULL AND d.next_attempt_at <= ?
         AND n.bundle = 'immediate'
       ORDER BY d.created_at
       LIMIT 100`,
    )
    .all(nowIso) as DeliveryDueRow[];

  let sent = 0;
  let skipped = 0;
  let deferred = 0;
  let failed = 0;
  let retried = 0;

  for (const row of due) {
    if (signal.aborted) break;
    // Claim by CAS on next_attempt_at (+60 s soft lease): the second worker's UPDATE matches 0 rows. The job lease
    // is the primary overlap guard; this keeps two concurrent claimers honest even without it.
    const claim = db.run(
      "UPDATE notification_delivery SET next_attempt_at = ? WHERE id = ? AND status IN ('pending', 'retry') AND next_attempt_at <= ?",
      [iso(new Date(now.getTime() + 60_000)), row.id, nowIso],
    );
    if (claim.changes !== 1) continue;

    // 1. dedupe cooldown (design 13.2) - a duplicate within the rule's cooldown is skipped, not sent.
    if (isDedupeSuppressed(db, row, now)) {
      markRow(db, row.id, { status: "skipped", last_error: "dedupe_cooldown", next_attempt_at: null });
      skipped++;
      continue;
    }
    // 2. rate limits (D14) - over-limit rows are deferred into the next digest, never dropped.
    const limit = rateLimitReason(db, row, now);
    if (limit) {
      markRow(db, row.id, { status: "deferred", last_error: limit });
      deferred++;
      continue;
    }
    // 3. resolve channel configuration (env / target rows) at send time; missing config = skipped, not an error storm.
    const view = buildNotifyView(db, row);
    if (row.channel === "email") {
      if (!isEmailConfigured()) {
        markRow(db, row.id, { status: "skipped", last_error: "channel_unconfigured", next_attempt_at: null });
        skipped++;
        continue;
      }
      const addr = row.recipient_user_id
        ? (
            db.query("SELECT email FROM app_user WHERE user_id = ?").get(row.recipient_user_id) as
              | { email: string | null }
              | undefined
          )?.email
        : null;
      if (!addr) {
        markRow(db, row.id, { status: "skipped", last_error: "no_email_address", next_attempt_at: null });
        skipped++;
        continue;
      }
      const body = renderEmailBody(view);
      try {
        const res = await sendEmail({ to: addr, subject: body.subject, text: body.text, html: body.html, signal });
        markRow(db, row.id, {
          status: "sent",
          sent_at: nowIso,
          provider_message_id: sanitizeProviderMessageId(res.providerMessageId),
          last_error: null,
        });
        sent++;
      } catch (err) {
        const outcome = applySendError(db, row, err, now);
        if (outcome === "sent") sent++;
        else if (outcome === "retry") retried++;
        else if (outcome === "deferred") deferred++;
        else failed++;
      }
    } else {
      const target = db
        .query("SELECT env_var, format FROM notify_webhook_target WHERE channel_key = ? AND enabled = 1")
        .get(row.target_key ?? "") as { env_var: string; format: "slack" | "teams" } | undefined;
      const url = target ? resolveTargetUrl(target.env_var) : null;
      if (!target || !url) {
        markRow(db, row.id, { status: "skipped", last_error: "channel_unconfigured", next_attempt_at: null });
        skipped++;
        continue;
      }
      const body = target.format === "teams" ? formatTeams(view) : formatSlack(view);
      try {
        const res = await sendWebhook(url, body, { signal, urlLabel: target.env_var });
        markRow(db, row.id, {
          status: "sent",
          sent_at: nowIso,
          provider_message_id: sanitizeProviderMessageId(res.providerMessageId),
          last_error: null,
        });
        sent++;
      } catch (err) {
        const outcome = applySendError(db, row, err, now);
        if (outcome === "sent") sent++;
        else if (outcome === "retry") retried++;
        else if (outcome === "deferred") deferred++;
        else failed++;
      }
    }
  }

  return {
    rowsRead: expansion.scanned + due.length,
    rowsWritten: expansion.deliveryRows + expansion.fanoutRows + sent + skipped + deferred + failed + retried,
    detail: {
      ...expansion,
      due: due.length,
      sent,
      skipped,
      deferred,
      failed,
      retried,
    },
  };
}

/** Classify a sender failure onto the row (design section 13.2). Returns the resulting status family. */
function applySendError(
  db: any,
  row: DeliveryDueRow,
  err: unknown,
  now: Date,
): "sent" | "retry" | "failed" | "deferred" {
  const retryable = err instanceof EmailError ? err.retryable : err instanceof WebhookError ? err.retryable : false;
  // Row 2 senders pre-scrub their messages (passwords / webhook URLs redacted) — store as-is, capped.
  const msg = (err instanceof Error ? err.message : String(err)).slice(0, 2000);
  if (!retryable) {
    markRow(db, row.id, { status: "failed", attempt: row.attempt + 1, last_error: msg, next_attempt_at: null });
    if (row.severity === "urgent") recordUrgentTerminalOpsNotification(db, row, msg, iso(now));
    return "failed";
  }
  const attempt = row.attempt + 1;
  if (attempt >= MAX_DELIVERY_ATTEMPTS) {
    markRow(db, row.id, { status: "failed", attempt, last_error: msg, next_attempt_at: null });
    if (row.severity === "urgent") recordUrgentTerminalOpsNotification(db, row, msg, iso(now));
    return "failed";
  }
  // Backoff schedule; a provider Retry-After wins when it is longer (design section 13.2).
  const backoffMs = BACKOFF_MINUTES[Math.min(attempt - 1, BACKOFF_MINUTES.length - 1)] * 60_000;
  const retryAfterMs = err instanceof WebhookError ? (err.retryAfterMs ?? 0) : 0;
  const next = new Date(now.getTime() + Math.max(backoffMs, retryAfterMs));
  markRow(db, row.id, { status: "retry", attempt, next_attempt_at: iso(next), last_error: msg });
  return "retry";
}

export const notifyDeliver: JobHandler = {
  key: "notify.deliver",
  displayName: "Notification delivery",
  description:
    "Expands new notifications into per-recipient delivery rows and sends due immediate email/webhook deliveries (retries 1/5/15 min, dedupe cooldown, rate limits).",
  defaultCron: "* * * * *",
  timeoutSec: 50, // design section 13.2: must never overlap the next tick
  maxRetries: 0,
  catchup: { mode: "skip" },
  async run(ctx) {
    return deliverOnce(ctx.db, { now: ctx.now, signal: ctx.signal });
  },
};
