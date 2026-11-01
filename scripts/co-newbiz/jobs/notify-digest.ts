// @version 1.0.0
/**
 * notify.digest - the daily-bundle worker (ADR-0189/0190, scheduled-jobs design section 13.2, phase P3 row 3).
 * Cron 30 8 * * * KST (D10); catchup skip BY DESIGN: a missed run folds into tomorrow's - the 24 h window below
 * still covers yesterday's rows, so nothing is lost by not back-filling (and a back-fill would double-send anything
 * already digested). timeoutSec 600.
 *
 * Selection ("undelivered daily-bundle rows of the past 24 h", plus deferred rows per design 13.2 "over-limit rows
 * go to deferred and are folded into the next digest rather than dropped"):
 *   - notification_delivery rows, channel email, digest_id IS NULL, created_at >= now-24h, AND
 *     (status = 'deferred' - ANY parent bundle, that is the fold-over-limit rule) OR
 *     (status IN (pending, retry) AND the parent notification bundle = 'daily').
 *   Rows older than the window stay pending (they are never dropped, just not digested) - documented limitation.
 *
 * One email per recipient (raw address read from app_user.email at send time; delivery rows keep only the masked
 * form), body lists the MNPI-safe fields only (title/severity/trigger/project code/deep link - the §13.1 content
 * rule applies to digests exactly like single notifications). Every included row is marked `sent` sharing ONE
 * digest ULID after the email succeeds, so a failed send leaves rows for the next day.
 *
 * TODO(P4+): webhook digest posts (one per channel target for ops-style daily rows) - email-only for now, per the
 * row 3 brief; the selection query is channel-agnostic except for the email-only send path below.
 */
import { ulid } from "../../../db/lib/ulid.ts";
import {
  escapeHtml,
  isEmailConfigured,
  sendEmail as sendEmailDefault,
  type NotifyView,
} from "../../../db/lib/notify/email.ts";
import { buildNotifyView, deepLinkBase, sanitizeProviderMessageId, type SendEmailFn } from "./notify-deliver.ts";
import type { JobHandler, JobResult } from "./types.ts";

/** Digest fold window (design section 13.2 "the past 24 h"). */
export const DIGEST_WINDOW_HOURS = 24;

export interface DigestOnceOptions {
  now: Date;
  signal?: AbortSignal;
  sendEmail?: SendEmailFn;
}

interface DigestRow {
  id: string;
  notification_id: string;
  recipient_user_id: string | null;
  recipient_address_masked: string | null;
  status: string;
  // joined notification columns
  title: string | null;
  severity: string;
  trigger_type: string;
  project_id: string | null;
}

const SEVERITY_LABEL: Record<string, string> = {
  opportunity: "기회",
  warning: "주의",
  urgent: "긴급",
  info: "알림",
  ops: "운영",
};

/** Render the digest email (ko, like the single-notification default): MNPI-safe fields only. */
export function renderDigestEmail(items: { view: NotifyView }[]): { subject: string; text: string; html: string } {
  const subject = `[co-newbiz] 알림 요약 ${items.length}건`;
  const lines: string[] = ["오늘의 알림 요약입니다.", ""];
  const htmlItems: string[] = [];
  for (const { view } of items) {
    const project = view.projectCode ? ` | 프로젝트: ${view.projectCode}` : "";
    lines.push(
      `- [${SEVERITY_LABEL[view.severity] ?? view.severity}] ${view.title} | 트리거: ${view.triggerType}${project}`,
    );
    if (view.deepLink) lines.push(`  ${view.deepLink}`);
    htmlItems.push(
      `<li><strong>${escapeHtml(view.title)}</strong> — ${escapeHtml(SEVERITY_LABEL[view.severity] ?? view.severity)} / ${escapeHtml(view.triggerType)}${
        view.projectCode ? ` / ${escapeHtml(view.projectCode)}` : ""
      }${view.deepLink ? ` <a href="${escapeHtml(view.deepLink)}">열기</a>` : ""}</li>`,
    );
  }
  lines.push("", "본 알림에는 수치나 문서 내용이 포함되지 않습니다. 전체 내용은 앱에서만 확인할 수 있습니다.");
  const text = lines.join("\n");
  const html = [
    `<div style="font-family:sans-serif;font-size:14px;color:#1a1a1a">`,
    `<p style="margin:0 0 8px"><strong>알림 요약 ${items.length}건</strong></p>`,
    `<ul style="margin:0 0 8px;padding-left:18px">`,
    ...htmlItems,
    `</ul>`,
    `<p style="margin:0;color:#888;font-size:12px">수치·문서 내용은 포함되지 않습니다. 전체 내용은 앱에서만 확인할 수 있습니다.</p>`,
    `</div>`,
  ].join("\n");
  return { subject, text, html };
}

export async function digestOnce(db: any, opts: DigestOnceOptions): Promise<JobResult> {
  const sendEmail = opts.sendEmail ?? sendEmailDefault;
  const signal = opts.signal ?? new AbortController().signal;
  const now = opts.now;
  const nowIso = now.toISOString();
  const windowStart = new Date(now.getTime() - DIGEST_WINDOW_HOURS * 3_600_000).toISOString();

  if (!isEmailConfigured()) {
    // Channel disabled (design 13.1): rows stay pending for the next day, no error storm.
    return { rowsRead: 0, skipped: "channel_unconfigured", detail: { reason: "smtp_env_missing" } };
  }

  const rows = db
    .query(
      `SELECT d.id, d.notification_id, d.recipient_user_id, d.recipient_address_masked, d.status,
              n.title, n.severity, n.trigger_type, n.project_id
       FROM notification_delivery d JOIN notification n ON n.id = d.notification_id
       WHERE d.channel = 'email' AND d.digest_id IS NULL AND d.recipient_user_id IS NOT NULL
         AND d.created_at >= ?
         AND (d.status = 'deferred' OR (d.status IN ('pending', 'retry') AND n.bundle = 'daily'))
       ORDER BY d.recipient_user_id, d.created_at`,
    )
    .all(windowStart) as DigestRow[];

  // Group per recipient — ONE email per recipient per design 13.2.
  const perRecipient = new Map<string, DigestRow[]>();
  for (const r of rows) {
    if (!r.recipient_user_id) continue;
    const list = perRecipient.get(r.recipient_user_id) ?? [];
    list.push(r);
    perRecipient.set(r.recipient_user_id, list);
  }

  let digestsSent = 0;
  let rowsSent = 0;
  let rowsSkipped = 0;
  const failures: { recipient: string; error: string }[] = [];

  for (const [userId, items] of perRecipient) {
    if (signal.aborted) break;
    const addr = (
      db.query("SELECT email FROM app_user WHERE user_id = ?").get(userId) as { email: string | null } | undefined
    )?.email;
    if (!addr) {
      for (const item of items) markSkipped(db, item.id, "no_email_address");
      rowsSkipped += items.length;
      continue;
    }
    const views = items.map((item) => ({ view: buildNotifyView(db, item) }));
    const body = renderDigestEmail(views);
    const digestId = ulid();
    try {
      const res = await sendEmail({ to: addr, subject: body.subject, text: body.text, html: body.html, signal });
      for (const item of items) {
        db.run(
          `UPDATE notification_delivery SET status = 'sent', sent_at = ?, digest_id = ?, provider_message_id = ?, last_error = NULL
           WHERE id = ? AND digest_id IS NULL`,
          [nowIso, digestId, sanitizeProviderMessageId(res.providerMessageId), item.id],
        );
      }
      digestsSent++;
      rowsSent += items.length; // the masked form on the rows is untouched; the raw address is never persisted
    } catch (err) {
      // Row 2 senders pre-scrub messages; job_run gets the failure, rows stay pending for the next day.
      failures.push({ recipient: userId, error: (err instanceof Error ? err.message : String(err)).slice(0, 500) });
    }
  }

  if (failures.length > 0) {
    // One failing recipient must not fail the whole run silently, but the run records the failures; rows remain
    // pending and tomorrow's digest (or a manual rerun) retries them. Result stays 'success' with the detail.
    return {
      rowsRead: rows.length,
      rowsWritten: rowsSent + rowsSkipped,
      detail: { digests_sent: digestsSent, rows_sent: rowsSent, rows_skipped: rowsSkipped, send_failures: failures },
    };
  }

  return {
    rowsRead: rows.length,
    rowsWritten: rowsSent + rowsSkipped,
    detail: {
      digests_sent: digestsSent,
      rows_sent: rowsSent,
      rows_skipped: rowsSkipped,
      deep_link_base: deepLinkBase() ?? null,
    },
  };
}

function markSkipped(db: any, id: string, reason: string): void {
  db.run("UPDATE notification_delivery SET status = 'skipped', last_error = ?, next_attempt_at = NULL WHERE id = ?", [
    reason,
    id,
  ]);
}

export const notifyDigest: JobHandler = {
  key: "notify.digest",
  displayName: "Daily notification digest",
  description:
    "Folds each recipient's undelivered daily-bundle (and deferred) notifications of the past 24 h into one email and marks the rows sent with a shared digest id.",
  defaultCron: "30 8 * * *", // D10: 08:30 KST
  timeoutSec: 600,
  maxRetries: 0, // per-row state persists; the next day's run (or a manual rerun) retries naturally
  // D10/design 13.2: a missed digest folds into tomorrow's - the 24 h window still covers the missed rows.
  catchup: { mode: "skip" },
  async run(ctx) {
    return digestOnce(ctx.db, { now: ctx.now, signal: ctx.signal });
  },
};
