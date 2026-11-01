// @version 1.0.0
/**
 * Notification delivery tests (ADR-0189/0190 P3 row 3, design 2026-10-29-scheduled-jobs-design sections 13.2/13.4):
 * recipient-policy resolution, the notify.deliver expand+send loop, notify.digest, and the run-job batch_failure hook.
 * Scratch SQLite under the OS temp dir (never the dev 7748 or prod 7749 DB); senders are FAKE functions and the clock
 * is injected — NO real SMTP, no network. Scrubbing of sender errors is asserted here end-to-end (Row 2 scrubs, the
 * handler stores).
 */
import { test, expect, describe, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = mkdtempSync(join(tmpdir(), "notify-delivery-"));
const TEST_DB_PATH = join(TMP, "notify-delivery.sqlite");
process.env.CO_NEWBIZ_LLM_PROVIDER = "none";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { resolveRecipients, cooldownHoursFromSourceRef } = await import("../../db/lib/notify/policy.ts");
// F-2 (typecheck): JobResult.detail is `unknown` by contract (scrubbed before storage). The tests read the
// structured counters through this narrow cast instead of widening the shared handler type in jobs/types.ts.
const detailOf = (r: { detail?: unknown }): Record<string, number> => (r.detail ?? {}) as Record<string, number>;
const { EmailError, maskAddress } = await import("../../db/lib/notify/email.ts");
const { WebhookError } = await import("../../db/lib/notify/webhook.ts");
const notifyDeliverMod = await import("../../scripts/co-newbiz/jobs/notify-deliver.ts");
const { deliverOnce, expandPending, webhookTargetKeyFor, isDedupeSuppressed } = notifyDeliverMod;
type SendEmailFn = import("../../scripts/co-newbiz/jobs/notify-deliver.ts").SendEmailFn;
type SendWebhookFn = import("../../scripts/co-newbiz/jobs/notify-deliver.ts").SendWebhookFn;
const { digestOnce } = await import("../../scripts/co-newbiz/jobs/notify-digest.ts");
const { getJobHandler } = await import("../../scripts/co-newbiz/jobs/index.ts");
const { onJobFailure, BATCH_FAILURE_URGENT_JOB_KEYS, runJob } = await import("../../scripts/co-newbiz/run-job.ts");
const { seedScheduleJobs } = await import("../../scripts/co-newbiz/schedule-seed.ts");

afterAll(() => {
  resetDb();
  rmSync(TMP, { recursive: true, force: true });
});

// ── env hygiene (the handlers read env at call time) ─────────────────────────

const ENV_KEYS = [
  "NOTIFY_SMTP_HOST",
  "NOTIFY_SMTP_PORT",
  "NOTIFY_SMTP_USER",
  "NOTIFY_SMTP_PASS",
  "NOTIFY_SMTP_FROM",
  "NOTIFY_SMTP_TLS",
  "NOTIFY_WEBHOOK_URL_DEALS",
  "NOTIFY_WEBHOOK_URL_OPS",
  "NOTIFY_WEBHOOK_ALLOWED_HOSTS",
  "CO_NEWBIZ_PUBLIC_ORIGIN",
  "CO_NEWBIZ_API_BASE_URL",
  "CO_NEWBIZ_SCHEDULER_ENV",
];
let savedEnv: Record<string, string | undefined>;

function setEnv(map: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(map)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

const SMTP_CONFIGURED = {
  NOTIFY_SMTP_HOST: "smtp.example.com",
  NOTIFY_SMTP_FROM: "co-newbiz@example.com",
  NOTIFY_SMTP_TLS: "none",
};
beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  setEnv(Object.fromEntries(ENV_KEYS.map((k) => [k, undefined])));
  setEnv({
    ...SMTP_CONFIGURED,
    NOTIFY_WEBHOOK_URL_DEALS: "https://hooks.slack.com/services/T0/B0/deals-hook-token",
    NOTIFY_WEBHOOK_URL_OPS: "https://hooks.slack.com/services/T0/B0/ops-hook-token",
    CO_NEWBIZ_PUBLIC_ORIGIN: "https://newbiz.example.org",
  });
  resetTables();
});
afterEach(() => {
  setEnv(savedEnv);
});

// ── fixtures ─────────────────────────────────────────────────────────────────

let seq = 0;
const nextId = (p: string) => `${p}-${String(++seq).padStart(4, "0")}`;
const NOW = new Date("2026-10-31T09:00:00.000Z");
const iso = (d: Date) => d.toISOString();

function resetTables(): void {
  // Fixture tables only — the D9 policy seed rows from migration 0185 are NEVER deleted.
  db.run("DELETE FROM notification_delivery");
  db.run("DELETE FROM notification");
  db.run("DELETE FROM watch_rule");
  db.run("DELETE FROM watch");
  db.run("DELETE FROM project_member");
  db.run("DELETE FROM app_user");
  db.run("DELETE FROM md_project");
  db.run("DELETE FROM notify_webhook_target");
  db.run("DELETE FROM user_notification_pref");
}

function insertUser(
  userId: string,
  role: "admin" | "analyst" | "viewer",
  opts: { status?: string; email?: string | null } = {},
): void {
  db.run(
    `INSERT INTO app_user (id, user_id, display_name, role, status, password_salt, password_hash, password_iterations, must_change_password, email, created_at)
     VALUES (?, ?, ?, ?, ?, 'salt', 'hash', 1, 0, ?, '2026-10-01T00:00:00Z')`,
    [
      nextId("u"),
      userId,
      userId,
      role,
      opts.status ?? "active",
      opts.email === undefined ? `${userId}@example.com` : opts.email,
    ],
  );
}
function insertProject(id: string, projectNo: string): void {
  db.run("INSERT INTO md_project (id, project_no, created_at) VALUES (?, ?, '2026-10-01T00:00:00Z')", [id, projectNo]);
}
function insertMembership(
  projectId: string,
  userId: string,
  role: "lead" | "member",
  revokedAt: string | null = null,
): void {
  db.run(
    "INSERT INTO project_member (project_id, user_id, project_role, granted_by, granted_at, revoked_at, need_to_know_basis) VALUES (?,?,?,?,?,?, 'need to know')",
    [projectId, userId, role, "seed", "2026-10-01T00:00:00Z", revokedAt],
  );
}
function insertWatchChain(ruleId: string, projectId: string, ownerUserId: string, cooldownHours = 24): void {
  const watchId = nextId("w");
  db.run(
    "INSERT INTO watch (id, project_id, user_id, last_checked_at, created_at) VALUES (?, ?, ?, NULL, '2026-10-01T00:00:00Z')",
    [watchId, projectId, ownerUserId],
  );
  db.run(
    "INSERT INTO watch_rule (id, watch_id, trigger_type, threshold, cooldown_hours, channel, enabled) VALUES (?, ?, 'rag_downgrade', NULL, ?, 'all', 1)",
    [ruleId, watchId, cooldownHours],
  );
}
function insertNotification(opts: {
  userId: string;
  projectId?: string | null;
  triggerType?: string;
  severity?: string;
  channel?: string;
  bundle?: string;
  sentAt?: string;
  title?: string | null;
  sourceRef?: string | null;
  dedupeKey?: string | null;
}): string {
  const id = nextId("n");
  db.run(
    `INSERT INTO notification (id, user_id, project_id, trigger_type, severity, payload, channel, bundle, sent_at, dedupe_key, title, source_ref)
     VALUES (?, ?, ?, ?, ?, '{}', ?, ?, ?, ?, ?, ?)`,
    [
      id,
      opts.userId,
      opts.projectId ?? null,
      opts.triggerType ?? "rag_downgrade",
      opts.severity ?? "urgent",
      opts.channel ?? "all",
      opts.bundle ?? "immediate",
      opts.sentAt ?? iso(NOW),
      opts.dedupeKey ?? null,
      opts.title ?? null,
      opts.sourceRef ?? null,
    ],
  );
  return id;
}
function insertWebhookTargets(): void {
  db.run(
    "INSERT INTO notify_webhook_target (channel_key, env_var, format, enabled) VALUES ('deals', 'NOTIFY_WEBHOOK_URL_DEALS', 'slack', 1)",
  );
  db.run(
    "INSERT INTO notify_webhook_target (channel_key, env_var, format, enabled) VALUES ('ops', 'NOTIFY_WEBHOOK_URL_OPS', 'slack', 1)",
  );
}
function insertPolicyRow(id: string, severity: string, audience: string, channels: string): void {
  db.run(
    "INSERT INTO notification_recipient_policy (id, severity, trigger_type, audience, channels, bundle, enabled) VALUES (?, ?, NULL, ?, ?, 'immediate', 1)",
    [id, severity, audience, channels],
  );
}

// fake senders ----------------------------------------------------------------

interface EmailCall {
  to: string;
  subject: string;
  text: string;
  html?: string;
}
function makeFakeEmail(impl?: (call: EmailCall) => Promise<{ providerMessageId: string }>): {
  fn: SendEmailFn;
  calls: EmailCall[];
} {
  const calls: EmailCall[] = [];
  const fn: SendEmailFn = async (opts) => {
    calls.push({ to: opts.to, subject: opts.subject, text: opts.text, html: opts.html });
    if (impl) return impl(calls[calls.length - 1]);
    return { providerMessageId: `mid-${calls.length}` };
  };
  return { fn, calls };
}
function makeFakeWebhook(
  impl?: () => Promise<{ ok: boolean; status: number; providerMessageId: string | null; retryAfterMs: number | null }>,
): { fn: SendWebhookFn; calls: { url: string; body: unknown }[] } {
  const calls: { url: string; body: unknown }[] = [];
  const fn: SendWebhookFn = async (url, body) => {
    calls.push({ url, body });
    if (impl) return impl();
    return { ok: true, status: 200, providerMessageId: null, retryAfterMs: null };
  };
  return { fn, calls };
}

const deliveryRows = () =>
  db.query("SELECT * FROM notification_delivery ORDER BY channel, recipient_user_id, id").all() as any[];
const notifications = () => db.query("SELECT * FROM notification ORDER BY sent_at, id").all() as any[];

// ── policy resolution (§13.4) ────────────────────────────────────────────────

describe("recipient policy resolution", () => {
  test("owner audience resolves via the watch_rule chain only (resolveResponsibleUser NOT used)", () => {
    insertUser("owner1", "viewer", { email: "owner1@example.com" }); // a viewer still owns their watch
    insertProject("P1", "PRJ-0001");
    insertWatchChain("rule-1", "P1", "owner1");
    const res = resolveRecipients(db, {
      id: "n1",
      user_id: "system",
      project_id: "P1",
      trigger_type: "rag_downgrade",
      severity: "urgent",
      channel: "all",
      bundle: "immediate",
      source_ref: "watch_rule:rule-1",
    });
    expect(res.recipients).toHaveLength(1);
    expect(res.recipients[0].recipientUserId).toBe("owner1");
    expect(res.recipients[0].recipientAddress).toBe("owner1@example.com"); // address read at resolve time
    expect(res.recipients[0].channels.sort()).toEqual(["email", "webhook"]); // external after bound ∩ policy
    expect(res.inAppUserIds).toEqual(["owner1"]); // in-app fan-out for the system row
    expect(res.matchedPolicyIds).toContain("d9-urgent-owner");
  });

  test("role:analyst audience = active members whose app_user role ranks >= analyst (viewer excluded)", () => {
    insertUser("member-analyst", "analyst");
    insertUser("member-admin", "admin");
    insertUser("member-viewer", "viewer");
    insertProject("P1", "PRJ-0001");
    insertMembership("P1", "member-analyst", "member");
    insertMembership("P1", "member-admin", "lead");
    insertMembership("P1", "member-viewer", "member");
    insertPolicyRow("test-role-warning", "warning", "role:analyst", '["email"]');
    const res = resolveRecipients(db, {
      id: "n1",
      user_id: "system",
      project_id: "P1",
      trigger_type: "threshold_breach",
      severity: "warning",
      channel: "email",
      bundle: "immediate",
    });
    // channel bound 'email' keeps only the email channel; viewer must not appear anywhere.
    expect(res.recipients.map((r) => r.recipientUserId).sort()).toEqual(["member-admin", "member-analyst"]);
    expect(JSON.stringify(res)).not.toContain("member-viewer");
  });

  test("revoked membership is excluded", () => {
    insertUser("gone", "analyst");
    insertUser("here", "analyst");
    insertProject("P1", "PRJ-0001");
    insertMembership("P1", "gone", "member", "2026-10-15T00:00:00Z");
    insertMembership("P1", "here", "member", null);
    insertPolicyRow("test-role-info", "info", "role:analyst", '["email"]');
    const res = resolveRecipients(db, {
      id: "n1",
      user_id: "system",
      project_id: "P1",
      trigger_type: "staleness",
      severity: "info",
      channel: "all",
      bundle: "daily",
    });
    expect(res.recipients.map((r) => r.recipientUserId)).toEqual(["here"]);
  });

  test("project_id NULL ⇒ owner/role expand to nothing; ops severity reaches admins only (D9)", () => {
    insertUser("root", "admin", { email: "root@example.com" });
    insertUser("peon", "analyst");
    const res = resolveRecipients(db, {
      id: "n1",
      user_id: "system",
      project_id: null,
      trigger_type: "batch_failure",
      severity: "ops",
      channel: "all",
      bundle: "immediate",
    });
    // d9-ops-admins channels = [in_app, webhook] → external = webhook only; in-app fan-out to admins.
    expect(res.recipients.map((r) => r.recipientUserId)).toEqual(["root"]);
    expect(res.recipients[0].channels).toEqual(["webhook"]);
    expect(res.inAppUserIds).toEqual(["root"]);
    expect(JSON.stringify(res)).not.toContain("peon");
  });

  test("channel bound: notification.channel='in_app' allows no external delivery", () => {
    insertUser("u1", "analyst", { email: "u1@example.com" });
    const res = resolveRecipients(db, {
      id: "n1",
      user_id: "u1",
      project_id: null,
      trigger_type: "rag_downgrade",
      severity: "info",
      channel: "in_app",
      bundle: "daily",
    });
    expect(res.recipients).toEqual([]);
  });

  test("email opt-out is subtracted for a normal trigger (policy channels first)", () => {
    insertUser("u1", "analyst", { email: "u1@example.com" });
    db.run("INSERT INTO user_notification_pref (user_id, channel, severity, opt_in) VALUES ('u1', 'email', 'info', 0)");
    const res = resolveRecipients(db, {
      id: "n1",
      user_id: "u1",
      project_id: null,
      trigger_type: "regulation_change",
      severity: "info",
      channel: "all",
      bundle: "daily",
    });
    // Policy channels for info = {in_app, email}; bound ∩ policy = [email]; opted out → no external recipients.
    expect(res.recipients).toEqual([]);
    expect(res.matchedPolicyIds).toContain("d9-info-owner-daily");
  });

  test("channels for addressed rows come from policy ∩ bound (not the bound alone)", () => {
    insertUser("u1", "analyst", { email: "u1@example.com" });
    // ops severity: d9-ops-admins channels = [in_app, webhook] → external = [webhook] under bound 'all'.
    const res = resolveRecipients(db, {
      id: "n1",
      user_id: "u1",
      project_id: null,
      trigger_type: "batch_failure",
      severity: "ops",
      channel: "all",
      bundle: "immediate",
    });
    expect(res.recipients).toHaveLength(1);
    expect(res.recipients[0].channels).toEqual(["webhook"]);
  });

  test("urgent KILL-CRITERIA ignores opt-outs (checked by trigger_type, not severity alone)", () => {
    insertUser("u1", "analyst", { email: "u1@example.com" });
    db.run(
      "INSERT INTO user_notification_pref (user_id, channel, severity, opt_in) VALUES ('u1', 'email', 'urgent', 0)",
    );
    const kill = resolveRecipients(db, {
      id: "n1",
      user_id: "u1",
      project_id: null,
      trigger_type: "kill_criteria",
      severity: "urgent",
      channel: "all",
      bundle: "immediate",
    });
    // Addressed-user path: channels come from the producer bound; the urgent kill-criteria opt-out is ignored.
    expect(kill.recipients[0]?.channels).toEqual(["email", "webhook"]);
    // A plain urgent trigger DOES honour the opt-out.
    const plain = resolveRecipients(db, {
      id: "n2",
      user_id: "u1",
      project_id: null,
      trigger_type: "rag_downgrade",
      severity: "urgent",
      channel: "email",
      bundle: "immediate",
    });
    expect(plain.recipients).toEqual([]);
  });

  test("cooldown hours come from the watch_rule named in source_ref (fallback 24)", () => {
    insertUser("owner1", "analyst");
    insertProject("P1", "PRJ-0001");
    insertWatchChain("rule-72", "P1", "owner1", 72);
    expect(cooldownHoursFromSourceRef(db, "watch_rule:rule-72")).toBe(72);
    expect(cooldownHoursFromSourceRef(db, "job_run:xyz")).toBe(24);
    expect(cooldownHoursFromSourceRef(db, null)).toBe(24);
  });
});

// ── notify.deliver ───────────────────────────────────────────────────────────

describe("notify.deliver", () => {
  test("handler registration: key/cron/timeout/retries/catchup per design 13.2", () => {
    const h = getJobHandler("notify.deliver");
    expect(h).toBeDefined();
    expect(h!.key).toBe("notify.deliver");
    expect(h!.defaultCron).toBe("* * * * *");
    expect(h!.timeoutSec).toBe(50);
    expect(h!.maxRetries).toBe(0);
    expect(h!.catchup.mode).toBe("skip");
  });

  test("expansion is idempotent (COALESCE unique index): a second run inserts nothing new", async () => {
    insertUser("owner1", "analyst", { email: "owner1@example.com" });
    insertProject("P1", "PRJ-0001");
    insertWatchChain("rule-1", "P1", "owner1");
    insertWebhookTargets();
    insertNotification({
      userId: "system",
      projectId: "P1",
      sourceRef: "watch_rule:rule-1",
      severity: "urgent",
      triggerType: "rag_downgrade",
    });
    const email = makeFakeEmail();
    const webhook = makeFakeWebhook();
    const r1 = await deliverOnce(db, { now: NOW, sendEmail: email.fn, sendWebhook: webhook.fn });
    expect(detailOf(r1).deliveryRows).toBeGreaterThanOrEqual(2); // owner email row + one channel-level webhook row
    expect(detailOf(r1).fanoutRows).toBe(1); // one in-app fan-out row for owner1
    const afterFirst = deliveryRows().length;
    const r2 = await deliverOnce(db, {
      now: new Date(NOW.getTime() + 60_000),
      sendEmail: email.fn,
      sendWebhook: webhook.fn,
    });
    expect(detailOf(r2).deliveryRows).toBe(0);
    expect(detailOf(r2).fanoutRows).toBe(0);
    expect(deliveryRows().length).toBe(afterFirst);
  });

  test("immediate rows are sent: email per recipient, one webhook per target (recipient NULL), fan-out row in-app only", async () => {
    insertUser("owner1", "analyst", { email: "owner1@example.com" });
    insertProject("P1", "PRJ-0001");
    insertWatchChain("rule-1", "P1", "owner1");
    insertWebhookTargets();
    insertNotification({
      userId: "system",
      projectId: "P1",
      sourceRef: "watch_rule:rule-1",
      severity: "urgent",
      triggerType: "rag_downgrade",
    });
    const email = makeFakeEmail();
    const webhook = makeFakeWebhook();
    await deliverOnce(db, { now: NOW, sendEmail: email.fn, sendWebhook: webhook.fn });

    expect(email.calls).toHaveLength(1);
    expect(email.calls[0].to).toBe("owner1@example.com");
    expect(email.calls[0].subject).toContain("긴급");
    expect(email.calls[0].text).toContain("PRJ-0001"); // project code (NotifyView field)
    expect(email.calls[0].text).toContain("https://newbiz.example.org/projects/"); // deep link
    expect(webhook.calls).toHaveLength(1);
    expect(webhook.calls[0].url).toBe(process.env.NOTIFY_WEBHOOK_URL_DEALS ?? "");
    const rows = deliveryRows();
    const emailRow = rows.find((r) => r.channel === "email");
    expect(emailRow.status).toBe("sent");
    expect(emailRow.provider_message_id).toBe("mid-1");
    expect(emailRow.sent_at).toBe(iso(NOW));
    const webhookRow = rows.find((r) => r.channel === "webhook");
    expect(webhookRow.recipient_user_id).toBeNull(); // channel-level target, not per user
    expect(webhookRow.target_key).toBe("deals"); // urgent → deals (webhookTargetKeyFor)
    expect(webhookRow.status).toBe("sent");
    // MNPI: the webhook body carries only NotifyView fields (title/severity/trigger/project/deep link).
    const body = JSON.stringify(webhook.calls[0].body);
    expect(body).toContain("PRJ-0001");
    // fan-out child: addressed to owner1, in-app channel bound, source_ref = notification:<parent>
    const kids = notifications().filter((n) => n.user_id === "owner1");
    expect(kids).toHaveLength(1);
    expect(kids[0].channel).toBe("in_app");
    expect(kids[0].source_ref).toMatch(/^notification:n-/);
  });

  test("D11 routing: an urgent batch_failure delivery row targets 'ops' (the scheduler channel), not the business channel", async () => {
    insertUser("admin1", "admin", { email: "admin1@example.com" }); // the D9 'admins' audience for urgent/batch rows
    insertWebhookTargets();
    // The escalation path: watch.evaluate is in BATCH_FAILURE_URGENT_JOB_KEYS, so the hook writes an URGENT
    // batch_failure notification — the trigger, not the severity, must decide the webhook target (D11).
    onJobFailure(db, "watch.evaluate", "run-i3", "timeout", "timed out", NOW);
    const email = makeFakeEmail();
    const webhook = makeFakeWebhook();
    await deliverOnce(db, { now: NOW, sendEmail: email.fn, sendWebhook: webhook.fn });
    const webhookRows = deliveryRows().filter((r) => r.channel === "webhook");
    expect(webhookRows).toHaveLength(1);
    expect(webhookRows[0].target_key).toBe("ops"); // batch_failure → 'ops' ALWAYS (urgent escalation included)
    expect(webhook.calls[0].url).toBe(process.env.NOTIFY_WEBHOOK_URL_OPS ?? "");
  });

  test("F-3: a provider-controlled message id is scrubbed and capped (≤256 chars) before it reaches the row", async () => {
    insertUser("owner1", "analyst", { email: "owner1@example.com" });
    insertNotification({ userId: "owner1", channel: "email" });
    // Hostile/oversized id: embeds the (secret-bearing) webhook URL env value — scrubSecrets must redact it —
    // and exceeds the 256-char cap.
    const secretUrl = process.env.NOTIFY_WEBHOOK_URL_DEALS ?? "https://hooks.slack.com/services/T0/B0/deals-hook-token";
    const email = makeFakeEmail(async () => ({ providerMessageId: `${secretUrl} ${"p".repeat(400)}` }));
    await deliverOnce(db, { now: NOW, sendEmail: email.fn, sendWebhook: makeFakeWebhook().fn });
    const row = deliveryRows().find((r) => r.channel === "email");
    expect(row.status).toBe("sent");
    expect(row.provider_message_id).not.toBeNull();
    expect((row.provider_message_id as string).length).toBeLessThanOrEqual(256);
    expect(row.provider_message_id).not.toContain(secretUrl);
    expect(row.provider_message_id).toContain("[REDACTED]");
  });

  test("unconfigured channel → skipped 'channel_unconfigured' (no error storm); other channel still sends", async () => {
    insertUser("owner1", "analyst", { email: "owner1@example.com" });
    insertProject("P1", "PRJ-0001");
    insertWatchChain("rule-1", "P1", "owner1");
    insertWebhookTargets();
    insertNotification({ userId: "system", projectId: "P1", sourceRef: "watch_rule:rule-1" });
    setEnv({ NOTIFY_SMTP_HOST: undefined }); // email unconfigured
    const email = makeFakeEmail();
    const webhook = makeFakeWebhook();
    await deliverOnce(db, { now: NOW, sendEmail: email.fn, sendWebhook: webhook.fn });
    expect(email.calls).toHaveLength(0);
    expect(webhook.calls).toHaveLength(1);
    const emailRow = deliveryRows().find((r) => r.channel === "email");
    expect(emailRow.status).toBe("skipped");
    expect(emailRow.last_error).toBe("channel_unconfigured");
  });

  test("retry backoff 1/5/15 min and terminal failed at attempt 4; last_error is scrubbed", async () => {
    insertUser("owner1", "analyst", { email: "owner1@example.com" });
    insertNotification({ userId: "owner1", severity: "urgent", triggerType: "kill_criteria", channel: "email" });
    setEnv({ NOTIFY_SMTP_PASS: "passwd123456" });
    let calls = 0;
    const email = makeFakeEmail(async () => {
      calls++;
      // Simulate a server echoing the configured password back — must never reach the DB.
      throw new EmailError("smtp_retryable", `454 transient auth passwd123456 rejected`);
    });
    let t = NOW;
    const run = async () => {
      const r = await deliverOnce(db, { now: t, sendEmail: email.fn, sendWebhook: makeFakeWebhook().fn });
      return r;
    };
    await run(); // attempt 1 fails → retry +1min
    let row = deliveryRows()[0];
    expect(row.status).toBe("retry");
    expect(row.attempt).toBe(1);
    expect(row.next_attempt_at).toBe(iso(new Date(NOW.getTime() + 60_000)));
    expect(row.last_error).not.toContain("passwd123456"); // scrubbed before storage
    expect(row.last_error).toContain("[REDACTED]");

    t = new Date(NOW.getTime() + 60_000);
    await run(); // attempt 2 → +5min
    row = deliveryRows()[0];
    expect(row.status).toBe("retry");
    expect(row.attempt).toBe(2);
    expect(row.next_attempt_at).toBe(iso(new Date(NOW.getTime() + 60_000 + 5 * 60_000)));

    t = new Date(NOW.getTime() + 6 * 60_000);
    await run(); // attempt 3 → +15min
    row = deliveryRows()[0];
    expect(row.attempt).toBe(3);
    expect(row.next_attempt_at).toBe(iso(new Date(NOW.getTime() + 60_000 + 5 * 60_000 + 15 * 60_000)));

    t = new Date(NOW.getTime() + 21 * 60_000);
    await run(); // attempt 4 → terminal failed
    row = deliveryRows()[0];
    expect(row.status).toBe("failed");
    expect(row.attempt).toBe(4);
    expect(row.next_attempt_at).toBeNull();
    expect(calls).toBe(4);
  });

  test("webhook 4xx (non-408/429) is terminal in ONE attempt", async () => {
    insertUser("owner1", "analyst", { email: "owner1@example.com" });
    insertProject("P1", "PRJ-0001");
    insertWatchChain("rule-1", "P1", "owner1");
    insertWebhookTargets();
    insertNotification({ userId: "system", projectId: "P1", sourceRef: "watch_rule:rule-1" });
    const webhook = makeFakeWebhook(async () => {
      throw new WebhookError("http_terminal", "webhook responded HTTP 404", { status: 404 });
    });
    await deliverOnce(db, { now: NOW, sendEmail: makeFakeEmail().fn, sendWebhook: webhook.fn });
    const row = deliveryRows().find((r) => r.channel === "webhook");
    expect(row.status).toBe("failed");
    expect(row.attempt).toBe(1);
    expect(row.next_attempt_at).toBeNull();
  });

  test("Retry-After is honoured when larger than the backoff step", async () => {
    insertUser("owner1", "analyst", { email: "owner1@example.com" });
    insertProject("P1", "PRJ-0001");
    insertWatchChain("rule-1", "P1", "owner1");
    insertWebhookTargets();
    insertNotification({ userId: "system", projectId: "P1", sourceRef: "watch_rule:rule-1" });
    const webhook = makeFakeWebhook(async () => {
      throw new WebhookError("http_retryable", "webhook responded HTTP 429", { status: 429, retryAfterMs: 7 * 60_000 });
    });
    await deliverOnce(db, { now: NOW, sendEmail: makeFakeEmail().fn, sendWebhook: webhook.fn });
    const row = deliveryRows().find((r) => r.channel === "webhook");
    expect(row.status).toBe("retry");
    // max(1 min backoff, 7 min Retry-After) = +7 min
    expect(row.next_attempt_at).toBe(iso(new Date(NOW.getTime() + 7 * 60_000)));
  });

  test("dedupe cooldown: a sent same-key/recipient/channel delivery inside the window suppresses (unit)", async () => {
    // The notification-level unique index (user_id, dedupe_key) already prevents one user from holding two rows
    // with one key, so the delivery-level cooldown (design 13.2) is defense-in-depth for paths that would bypass
    // it (producer drift, future fan-out changes). Its semantics are asserted directly on the exported unit:
    insertUser("owner1", "analyst", { email: "owner1@example.com" });
    insertProject("P1", "PRJ-0001");
    insertWatchChain("rule-1", "P1", "owner1", 24);
    const nId = insertNotification({
      userId: "system",
      projectId: "P1",
      sourceRef: "watch_rule:rule-1",
      dedupeKey: "kc:run:1",
    });
    db.run(
      `INSERT INTO notification_delivery (id, notification_id, recipient_user_id, channel, status, attempt, sent_at, created_at)
       VALUES ('d-sent', ?, 'owner1', 'email', 'sent', 1, ?, ?)`,
      [nId, iso(new Date(NOW.getTime() - 30 * 60_000)), iso(new Date(NOW.getTime() - 31 * 60_000))],
    );
    const dueRow = {
      id: "d-new",
      notification_id: nId,
      recipient_user_id: "owner1",
      recipient_address_masked: null,
      channel: "email" as const,
      target_key: null,
      attempt: 0,
      dedupe_key: "kc:run:1",
      severity: "urgent" as const,
      trigger_type: "rag_downgrade",
      title: null,
      project_id: "P1",
      bundle: "immediate" as const,
      source_ref: "watch_rule:rule-1",
    };
    expect(isDedupeSuppressed(db, dueRow, NOW)).toBe(true); // inside the 24 h rule cooldown
    expect(isDedupeSuppressed(db, dueRow, new Date(NOW.getTime() + 25 * 3_600_000))).toBe(false); // window passed
    expect(isDedupeSuppressed(db, { ...dueRow, recipient_user_id: "someone-else" }, NOW)).toBe(false); // different recipient
    expect(isDedupeSuppressed(db, { ...dueRow, dedupe_key: null }, NOW)).toBe(false); // no key → never suppressed
    // and the rule's own cooldown_hours (72) widens the window:
    insertWatchChain("rule-72", "P1", "owner1", 72);
    expect(
      isDedupeSuppressed(db, { ...dueRow, source_ref: "watch_rule:rule-72" }, new Date(NOW.getTime() + 25 * 3_600_000)),
    ).toBe(true);
  });

  test("global email rate limit → deferred; digest picks the deferred row up", async () => {
    insertUser("owner1", "analyst", { email: "owner1@example.com" });
    // Preset the global bucket: 30 sent email deliveries within the last minute. The bucket notification is
    // channel 'in_app' so expansion creates no email row for it — the manual rows below are all the counter sees.
    const bucketNotif = insertNotification({
      userId: "owner1",
      severity: "info",
      channel: "in_app",
      triggerType: "regulation_change",
    });
    for (let i = 0; i < 30; i++) {
      db.run(
        `INSERT INTO notification_delivery (id, notification_id, recipient_user_id, channel, status, attempt, sent_at, created_at)
         VALUES (?, ?, ?, 'email', 'sent', 1, ?, ?)`,
        [
          nextId("d"),
          bucketNotif,
          `bulk-${i}`,
          iso(new Date(NOW.getTime() - 30_000)),
          iso(new Date(NOW.getTime() - 60_000)),
        ],
      );
    }
    insertNotification({ userId: "owner1", severity: "warning", triggerType: "threshold_breach" });
    const email = makeFakeEmail();
    await deliverOnce(db, { now: NOW, sendEmail: email.fn, sendWebhook: makeFakeWebhook().fn });
    expect(email.calls).toHaveLength(0);
    const deferredRow = deliveryRows().find((r) => r.status === "deferred");
    expect(deferredRow.last_error).toBe("rate_limit:email_global");

    // The next digest folds the deferred row (any bundle) into one email and marks it sent with a shared digest id.
    const digestEmail = makeFakeEmail();
    const later = new Date(NOW.getTime() + 3_600_000);
    const dr = await digestOnce(db, { now: later, sendEmail: digestEmail.fn });
    expect(digestEmail.calls).toHaveLength(1);
    expect(detailOf(dr).rows_sent).toBe(1);
    const sentRow = deliveryRows().find((r) => r.id === deferredRow.id);
    expect(sentRow.status).toBe("sent");
    expect(sentRow.digest_id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  test("per-user immediate email limit (10/h) → deferred; urgent bypasses the per-user limit", async () => {
    insertUser("owner1", "analyst", { email: "owner1@example.com" });
    // 10 immediate emails already sent to owner1 within the hour: 10 distinct notifications (the COALESCE unique
    // index collapses same-notification duplicates), each with one sent email delivery to owner1. The bucket
    // notifications are in_app-bound so expansion contributes no delivery row of its own.
    for (let i = 0; i < 10; i++) {
      const bn = insertNotification({
        userId: "owner1",
        severity: "info",
        channel: "in_app",
        triggerType: "regulation_change",
      });
      db.run(
        `INSERT INTO notification_delivery (id, notification_id, recipient_user_id, channel, status, attempt, sent_at, created_at)
         VALUES (?, ?, 'owner1', 'email', 'sent', 1, ?, ?)`,
        [nextId("d"), bn, iso(new Date(NOW.getTime() - 10 * 60_000)), iso(new Date(NOW.getTime() - 11 * 60_000))],
      );
    }
    // warning (non-urgent) immediate → deferred by the per-user limit...
    insertNotification({ userId: "owner1", severity: "warning", triggerType: "threshold_breach" });
    const email = makeFakeEmail();
    await deliverOnce(db, { now: NOW, sendEmail: email.fn, sendWebhook: makeFakeWebhook().fn });
    const deferredRow = deliveryRows().find((r) => r.status === "deferred");
    expect(deferredRow.last_error).toBe("rate_limit:email_per_user");
    // ...but urgent (kill_criteria) bypasses the per-user limit and sends.
    insertNotification({ userId: "owner1", severity: "urgent", triggerType: "kill_criteria", channel: "email" });
    await deliverOnce(db, { now: NOW, sendEmail: email.fn, sendWebhook: makeFakeWebhook().fn });
    expect(email.calls.some((c) => c.to === "owner1@example.com")).toBe(true);
  });

  test("daily-bundle rows are NOT sent by deliver (they belong to the digest)", async () => {
    insertUser("u1", "analyst", { email: "u1@example.com" });
    insertNotification({
      userId: "u1",
      severity: "info",
      triggerType: "regulation_change",
      bundle: "daily",
      channel: "all",
    });
    const email = makeFakeEmail();
    const r = await deliverOnce(db, { now: NOW, sendEmail: email.fn, sendWebhook: makeFakeWebhook().fn });
    expect(email.calls).toHaveLength(0);
    expect(detailOf(r).due).toBe(0);
    const row = deliveryRows().find((r2) => r2.channel === "email");
    expect(row.status).toBe("pending"); // waits for the digest
  });

  test("terminal failure of an URGENT delivery produces one ops notification for admins, in-app only", async () => {
    insertUser("owner1", "analyst", { email: "owner1@example.com" });
    insertNotification({ userId: "owner1", severity: "urgent", triggerType: "kill_criteria", channel: "email" });
    const email = makeFakeEmail(async () => {
      throw new EmailError("smtp_terminal", "550 mailbox unavailable");
    });
    await deliverOnce(db, { now: NOW, sendEmail: email.fn, sendWebhook: makeFakeWebhook().fn });
    const ops = notifications().find((n) => n.severity === "ops");
    expect(ops).toBeDefined();
    expect(ops.user_id).toBe("system");
    expect(ops.project_id).toBeNull();
    expect(ops.trigger_type).toBe("batch_failure");
    expect(ops.channel).toBe("in_app"); // loop guard: no external channel on the ops notification
    expect(ops.source_ref).toMatch(/^notification:n-/);
  });

  test("recipient addresses are stored MASKED only — the raw address never lands in notification_delivery", async () => {
    insertUser("owner1", "analyst", { email: "owner1@example.com" });
    insertProject("P1", "PRJ-0001");
    insertWatchChain("rule-1", "P1", "owner1");
    insertWebhookTargets();
    insertNotification({ userId: "system", projectId: "P1", sourceRef: "watch_rule:rule-1" });
    await deliverOnce(db, { now: NOW, sendEmail: makeFakeEmail().fn, sendWebhook: makeFakeWebhook().fn });
    const rows = deliveryRows();
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      if (r.recipient_address_masked !== null) {
        expect(r.recipient_address_masked).toBe(maskAddress("owner1@example.com"));
        expect(r.recipient_address_masked).toContain("***");
      }
    }
    expect(JSON.stringify(rows)).not.toContain("owner1@example.com");
  });

  test("webhookTargetKeyFor maps ops severity to the ops target, and batch_failure to ops regardless of severity (D11)", () => {
    expect(webhookTargetKeyFor("ops")).toBe("ops");
    expect(webhookTargetKeyFor("urgent")).toBe("deals");
    expect(webhookTargetKeyFor("warning")).toBe("deals");
    // The trigger overrides the severity mapping: an urgent batch_failure is still a scheduler/batch event.
    expect(webhookTargetKeyFor("urgent", "batch_failure")).toBe("ops");
    expect(webhookTargetKeyFor("ops", "batch_failure")).toBe("ops");
    expect(webhookTargetKeyFor("urgent", "rag_downgrade")).toBe("deals");
  });
});

// ── notify.digest ────────────────────────────────────────────────────────────

describe("notify.digest", () => {
  test("handler registration: cron 30 8 * * * (D10), timeout 600, catchup skip (missed run folds into tomorrow)", () => {
    const h = getJobHandler("notify.digest");
    expect(h).toBeDefined();
    expect(h!.defaultCron).toBe("30 8 * * *");
    expect(h!.timeoutSec).toBe(600);
    expect(h!.catchup.mode).toBe("skip");
    expect(h!.catchup.mode === "skip").toBe(true);
  });

  test("one email per recipient; every included row marked sent sharing ONE digest ULID", async () => {
    insertUser("u1", "analyst", { email: "u1@example.com" });
    insertUser("u2", "analyst", { email: "u2@example.com" });
    insertProject("P1", "PRJ-0001");
    // u1 gets TWO daily notifications, u2 gets one.
    insertNotification({ userId: "u1", severity: "info", triggerType: "regulation_change", bundle: "daily" });
    insertNotification({
      userId: "u1",
      severity: "warning",
      triggerType: "threshold_breach",
      bundle: "daily",
      projectId: "P1",
    });
    insertNotification({ userId: "u2", severity: "info", triggerType: "staleness", bundle: "daily" });
    // Expand (deliver sends nothing — all rows are daily), then digest.
    await deliverOnce(db, { now: NOW, sendEmail: makeFakeEmail().fn, sendWebhook: makeFakeWebhook().fn });
    const email = makeFakeEmail();
    const r = await digestOnce(db, { now: new Date(NOW.getTime() + 60_000), sendEmail: email.fn });
    expect(email.calls).toHaveLength(2);
    const u1Call = email.calls.find((c) => c.to === "u1@example.com");
    expect(u1Call!.subject).toContain("2건");
    expect(u1Call!.text).toContain("regulation_change");
    expect(u1Call!.text).toContain("PRJ-0001");
    expect(u1Call!.text).toMatch(/앱에서만 확인/); // MNPI disclaimer
    const u1Rows = deliveryRows().filter((row) => row.recipient_user_id === "u1");
    expect(u1Rows).toHaveLength(2);
    expect(u1Rows[0].digest_id).toBe(u1Rows[1].digest_id);
    expect(u1Rows[0].digest_id).not.toBe(deliveryRows().find((row) => row.recipient_user_id === "u2")!.digest_id);
    expect(detailOf(r).digests_sent).toBe(2);
    expect(detailOf(r).rows_sent).toBe(3);
    for (const row of deliveryRows()) expect(row.status).toBe("sent");
  });

  test("daily rows without an address are skipped (no eternal pending), pending daily rows stay until digest", async () => {
    insertUser("u1", "analyst", { email: null });
    insertNotification({ userId: "u1", severity: "info", triggerType: "regulation_change", bundle: "daily" });
    await deliverOnce(db, { now: NOW, sendEmail: makeFakeEmail().fn, sendWebhook: makeFakeWebhook().fn });
    const email = makeFakeEmail();
    await digestOnce(db, { now: new Date(NOW.getTime() + 60_000), sendEmail: email.fn });
    expect(email.calls).toHaveLength(0);
    expect(deliveryRows()[0].status).toBe("skipped");
    expect(deliveryRows()[0].last_error).toBe("no_email_address");
  });
});

// ── batch_failure hook ───────────────────────────────────────────────────────

describe("batch_failure hook (run-job onJobFailure)", () => {
  test("writes one system notification with correct severity/bundle/dedupe; a second failure in the same hour does not spam", () => {
    onJobFailure(db, "demo.job", "run-1", "failed", "boom", NOW);
    const rows = db.query("SELECT * FROM notification WHERE trigger_type = 'batch_failure'").all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe("system");
    expect(rows[0].project_id).toBeNull();
    expect(rows[0].severity).toBe("ops");
    expect(rows[0].bundle).toBe("daily");
    expect(rows[0].channel).toBe("all");
    expect(rows[0].title).toBe("demo.job failed");
    expect(rows[0].source_ref).toBe("job_run:run-1");
    expect(rows[0].dedupe_key).toBe("batch_failure:demo.job:2026-10-31T09");
    // Flapping job, same hour, different run → INSERT OR IGNORE keeps one row.
    onJobFailure(db, "demo.job", "run-2", "failed", "boom again", new Date(NOW.getTime() + 10 * 60_000));
    expect(db.query("SELECT * FROM notification WHERE trigger_type = 'batch_failure'").all().length).toBe(1);
    // Next hour → a new notification is allowed.
    onJobFailure(db, "demo.job", "run-3", "failed", "boom", new Date(NOW.getTime() + 61 * 60_000));
    expect(db.query("SELECT * FROM notification WHERE trigger_type = 'batch_failure'").all().length).toBe(2);
  });

  test("escalates to urgent/immediate for the named job keys (P6 inherits the constant)", () => {
    expect([...BATCH_FAILURE_URGENT_JOB_KEYS].sort()).toEqual(["retention.cleanup", "watch.evaluate"]);
    onJobFailure(db, "watch.evaluate", "run-w", "timeout", "timed out", NOW);
    const row = db.query("SELECT * FROM notification WHERE trigger_type = 'batch_failure'").all()[0] as any;
    expect(row.severity).toBe("urgent");
    expect(row.bundle).toBe("immediate");
    expect(row.title).toBe("watch.evaluate failed");
  });

  test("the hook is wired into run-job: a no-handler run records the notification (dedupe applies)", async () => {
    const res = await runJob(db, {
      jobKey: "no-such-job",
      env: "dev",
      trigger: "manual",
      actor: "tester",
      retryDelayMs: 0,
      clock: () => NOW,
    });
    expect(res.outcome).toBe("no_handler");
    const rows = db.query("SELECT * FROM notification WHERE title = 'no-such-job failed'").all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].source_ref).toBe(`job_run:${res.jobRunId}`);
    // The launchd stderr line must still have been written (scrubbed) — covered by p1's runJob tests; here we
    // assert the hook did not throw and the job_run row exists and is failed.
    const run = db.query("SELECT * FROM job_run WHERE id = ?").get(res.jobRunId) as any;
    expect(run.status).toBe("failed");
  });
});

// ── schedule_job seeding derives from the registry ───────────────────────────

describe("schedule_job seeding", () => {
  test("seedScheduleJobs inserts DISABLED rows for the new handlers (derived from listJobHandlers)", () => {
    const res = seedScheduleJobs(db, NOW);
    expect(res.inserted).toContain("notify.deliver");
    expect(res.inserted).toContain("notify.digest");
    const deliver = db.query("SELECT * FROM schedule_job WHERE job_key = 'notify.deliver'").get() as any;
    const digest = db.query("SELECT * FROM schedule_job WHERE job_key = 'notify.digest'").get() as any;
    expect(deliver.cron_expr).toBe("* * * * *");
    expect(deliver.enabled).toBe(0);
    expect(deliver.timeout_sec).toBe(50);
    expect(digest.cron_expr).toBe("30 8 * * *");
    expect(digest.timeout_sec).toBe(600);
    // Idempotent: a second seed touches nothing.
    const second = seedScheduleJobs(db, NOW);
    expect(second.inserted).toHaveLength(0);
    expect(second.existing).toContain("notify.deliver");
  });
});
