// @version 1.0.0
/**
 * P4 admin notification history + detail + test send (design 2026-10-29-scheduled-jobs-design
 * §13.5/§13.7/§13.8) against the real Route Handlers via nextRequest() on a scratch SQLite
 * (never the dev 7748 or prod 7749 DB).
 *
 * Covered: per-dimension filters + combos + paging caps; detail 404 + delivery rows; masking
 * (addresses masked, webhook URLs never present); test send — notification created, audit row
 * with masked target, 429 on the 6th call within the hour, is_test=1 on the deliver expansion
 * (incl. the explicit webhook channel-key threading).
 */
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = mkdtempSync(join(tmpdir(), "admin-notifications-api-"));
const TEST_DB_PATH = join(TMP, "admin-notifications.sqlite");
process.env.CO_NEWBIZ_LLM_PROVIDER = "none";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;

// Deterministic channel environment for the whole file: nothing external configured.
for (const k of ["NOTIFY_SMTP_HOST", "NOTIFY_SMTP_FROM", "NOTIFY_SMTP_PORT", "NOTIFY_SMTP_USER", "NOTIFY_SMTP_PASS", "NOTIFY_SMTP_TLS", "NOTIFY_WEBHOOK_URL_DEALS", "NOTIFY_WEBHOOK_URL_OPS"]) {
  delete process.env[k];
}

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { maskAddress } = await import("../../db/lib/notify/email.ts");
const { expandPending } = await import("../../scripts/co-newbiz/jobs/notify-deliver.ts");
const { ulid } = await import("../../db/lib/ulid.ts");
const { nextRequest } = await import("./helpers/next-route-dispatch.ts");

const NOW = new Date("2026-11-01T09:00:00.000Z");
const iso = (d: Date) => d.toISOString();

function insertProject(id: string, projectNo: string): void {
  db.run("INSERT INTO md_project (id, project_no, created_at) VALUES (?, ?, '2026-10-01T00:00:00Z')", [id, projectNo]);
}

function insertAppUser(userId: string, role: string, email: string | null): void {
  db.run(
    `INSERT INTO app_user (id, user_id, display_name, role, status, password_salt, password_hash, password_iterations, must_change_password, email, created_at)
     VALUES (?, ?, ?, ?, 'active', 'salt', 'hash', 1, 0, ?, '2026-10-01T00:00:00Z')`,
    [ulid(), userId, userId, role, email],
  );
}

interface NotifSpec {
  id: string;
  userId?: string;
  projectId?: string | null;
  triggerType?: string;
  severity?: string;
  channel?: string;
  bundle?: string;
  sentAt: string;
  readAt?: string | null;
  title?: string | null;
  payload?: string;
}

function insertNotification(s: NotifSpec): string {
  db.run(
    `INSERT INTO notification (id, user_id, project_id, trigger_type, severity, payload, channel, bundle, sent_at, read_at, dedupe_key, title, source_ref)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL)`,
    [
      s.id,
      s.userId ?? "system",
      s.projectId ?? null,
      s.triggerType ?? "rag_downgrade",
      s.severity ?? "warning",
      s.payload ?? "{}",
      s.channel ?? "all",
      s.bundle ?? "immediate",
      s.sentAt,
      s.readAt ?? null,
      s.title ?? null,
    ],
  );
  return s.id;
}

function insertDelivery(nid: string, opts: { channel: "email" | "webhook"; status: string; recipient?: string | null; masked?: string | null; targetKey?: string | null; isTest?: number }): void {
  db.run(
    `INSERT INTO notification_delivery (id, notification_id, recipient_user_id, recipient_address_masked, channel, target_key, status, attempt, next_attempt_at, created_at, is_test)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, NULL, ?, ?)`,
    [ulid(), nid, opts.recipient ?? null, opts.masked ?? null, opts.channel, opts.targetKey ?? null, opts.status, iso(NOW), opts.isTest ?? 0],
  );
}

async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await nextRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  expect(res.status).toBe(200);
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}

let adminCookie: string;
let admin2Cookie: string;
let analystCookie: string;
let viewerCookie: string;

const P1 = "proj-notif-1";
const N1 = "n-list-1"; // rag_downgrade / warning / all / unread / P1 / email sent + webhook pending
const N2 = "n-list-2"; // kill_criteria / urgent / all / read / P1 / email failed
const N3 = "n-list-3"; // batch_failure / ops / in_app / unread / no project / no deliveries
const N4 = "n-list-4"; // test / info / in_app / unread / no project / no deliveries
const LIST = "/api/admin/notifications";

beforeAll(async () => {
  insertProject(P1, "NP-NOTIF-1");
  insertNotification({
    id: N1,
    userId: "watch-owner",
    projectId: P1,
    triggerType: "rag_downgrade",
    severity: "warning",
    channel: "all",
    sentAt: "2026-10-20T10:00:00.000Z",
    title: "RAG downgraded to red",
    payload: '{"summary":"IRR fell below hurdle"}',
  });
  insertDelivery(N1, { channel: "email", status: "sent", recipient: "watch-owner", masked: maskAddress("owner@example.com") });
  insertDelivery(N1, { channel: "webhook", status: "pending", targetKey: "deals" });
  insertNotification({
    id: N2,
    userId: "watch-owner",
    projectId: P1,
    triggerType: "kill_criteria",
    severity: "urgent",
    channel: "all",
    sentAt: "2026-10-22T10:00:00.000Z",
    readAt: "2026-10-22T11:00:00.000Z",
    title: "Kill criteria triggered",
    payload: '{"criterion":"dscr_downside"}',
  });
  insertDelivery(N2, { channel: "email", status: "failed", recipient: "watch-owner", masked: maskAddress("owner@example.com") });
  insertNotification({
    id: N3,
    userId: "system",
    projectId: null,
    triggerType: "batch_failure",
    severity: "ops",
    channel: "in_app",
    sentAt: "2026-10-25T10:00:00.000Z",
    title: "collect.dart batch failed",
    payload: '{"job":"collect.dart"}',
  });
  insertNotification({
    id: N4,
    userId: "p4admin",
    projectId: null,
    triggerType: "test",
    severity: "info",
    channel: "in_app",
    sentAt: "2026-10-26T10:00:00.000Z",
    title: "Test notification",
    payload: '{"test":true}',
  });

  for (const [userId, role, password] of [
    ["p4admin", "admin", "pw-p4admin-123"],
    ["p4admin2", "admin", "pw-p4admin2-12"],
    ["p4analyst", "analyst", "pw-p4analyst-1"],
    ["p4viewer", "viewer", "pw-p4viewer-1"],
  ] as const) {
    await createUser(db, { userId, role, password, createdBy: "test", now: iso(NOW) });
    approveUser(db, { userId, approvedBy: "test", now: iso(NOW) });
  }
  insertAppUser("watch-owner", "analyst", "owner@example.com");
  insertAppUser("no-email-user", "analyst", null);
  db.run("UPDATE app_user SET must_change_password = 0 WHERE user_id IN ('p4admin','p4admin2','p4analyst','p4viewer')");
  adminCookie = await loginCookie("p4admin", "pw-p4admin-123");
  admin2Cookie = await loginCookie("p4admin2", "pw-p4admin2-12");
  analystCookie = await loginCookie("p4analyst", "pw-p4analyst-1");
  viewerCookie = await loginCookie("p4viewer", "pw-p4viewer-1");
});

afterAll(() => {
  resetDb();
  rmSync(TMP, { recursive: true, force: true });
});

const jsonOf = async (res: Response) => await res.json();
const dataOf = async (res: Response) => (await jsonOf(res)).data;
const metaOf = async (res: Response) => (await jsonOf(res)).meta;

// ── access control ─────────────────────────────────────────────────────────────

describe("access control (admin-only)", () => {
  test("unauthenticated list/detail/test are 401", async () => {
    expect((await nextRequest(LIST)).status).toBe(401);
    expect((await nextRequest(`${LIST}/n-list-1`)).status).toBe(401);
    expect((await nextRequest(`${LIST}/test`, { method: "POST", body: "{}" })).status).toBe(401);
  });

  test("analyst and viewer are 403 admin_required on all three", async () => {
    for (const cookie of [analystCookie, viewerCookie]) {
      expect((await nextRequest(LIST, { headers: { cookie } })).status).toBe(403);
      expect((await nextRequest(`${LIST}/n-list-1`, { headers: { cookie } })).status).toBe(403);
      expect(
        (await nextRequest(`${LIST}/test`, { method: "POST", headers: { cookie }, body: JSON.stringify({ channel: "in_app", target: "p4admin" }) })).status,
      ).toBe(403);
    }
  });
});

// ── list: filters ──────────────────────────────────────────────────────────────

describe("GET /api/admin/notifications — filters", () => {
  const ids = (res: Response): Promise<string[]> => dataOf(res).then((d: any) => d.rows.map((r: any) => r.id));

  test("no filter returns every row newest-first with page meta", async () => {
    const res = await nextRequest(LIST, { headers: { cookie: adminCookie } });
    expect(res.status).toBe(200);
    const j = await jsonOf(res);
    expect(j.data.rows.map((r: any) => r.id)).toEqual([N4, N3, N2, N1]);
    expect(j.meta).toMatchObject({ page: 1, page_size: 50, total: 4, total_pages: 1 });
  });

  test("from/to on sent_at; date-only `to` includes its whole day", async () => {
    expect(await ids(await nextRequest(`${LIST}?from=2026-10-21`, { headers: { cookie: adminCookie } }))).toEqual([N4, N3, N2]);
    expect(await ids(await nextRequest(`${LIST}?to=2026-10-24`, { headers: { cookie: adminCookie } }))).toEqual([N2, N1]);
    expect(await ids(await nextRequest(`${LIST}?from=2026-10-21&to=2026-10-24`, { headers: { cookie: adminCookie } }))).toEqual([N2]);
    expect((await nextRequest(`${LIST}?from=not-a-date`, { headers: { cookie: adminCookie } })).status).toBe(400);
  });

  test("trigger_type, severity, project_id", async () => {
    expect(await ids(await nextRequest(`${LIST}?trigger_type=rag_downgrade`, { headers: { cookie: adminCookie } }))).toEqual([N1]);
    expect(await ids(await nextRequest(`${LIST}?severity=urgent`, { headers: { cookie: adminCookie } }))).toEqual([N2]);
    expect(await ids(await nextRequest(`${LIST}?project_id=${P1}`, { headers: { cookie: adminCookie } }))).toEqual([N2, N1]);
  });

  test("channel matches the producer bound inclusively (email also matches 'all')", async () => {
    expect(await ids(await nextRequest(`${LIST}?channel=email`, { headers: { cookie: adminCookie } }))).toEqual([N2, N1]);
    expect(await ids(await nextRequest(`${LIST}?channel=in_app`, { headers: { cookie: adminCookie } }))).toEqual([N4, N3, N2, N1]);
    expect((await nextRequest(`${LIST}?channel=smoke`, { headers: { cookie: adminCookie } })).status).toBe(400);
  });

  test("read/unread on read_at", async () => {
    expect(await ids(await nextRequest(`${LIST}?read=read`, { headers: { cookie: adminCookie } }))).toEqual([N2]);
    expect(await ids(await nextRequest(`${LIST}?read=unread`, { headers: { cookie: adminCookie } }))).toEqual([N4, N3, N1]);
    expect((await nextRequest(`${LIST}?read=bogus`, { headers: { cookie: adminCookie } })).status).toBe(400);
  });

  test("delivery_status joins notification_delivery (in-app-only rows never match)", async () => {
    expect(await ids(await nextRequest(`${LIST}?delivery_status=sent`, { headers: { cookie: adminCookie } }))).toEqual([N1]);
    expect(await ids(await nextRequest(`${LIST}?delivery_status=failed`, { headers: { cookie: adminCookie } }))).toEqual([N2]);
    expect(await ids(await nextRequest(`${LIST}?delivery_status=pending`, { headers: { cookie: adminCookie } }))).toEqual([N1]);
    expect(await ids(await nextRequest(`${LIST}?delivery_status=deferred`, { headers: { cookie: adminCookie } }))).toEqual([]);
    expect((await nextRequest(`${LIST}?delivery_status=nope`, { headers: { cookie: adminCookie } })).status).toBe(400);
  });

  test("q searches title and payload excerpt with escaped LIKE wildcards", async () => {
    expect(await ids(await nextRequest(`${LIST}?q=RAG`, { headers: { cookie: adminCookie } }))).toEqual([N1]);
    expect(await ids(await nextRequest(`${LIST}?q=dscr_downside`, { headers: { cookie: adminCookie } }))).toEqual([N2]);
    // % is matched literally (escaped), so it hits nothing.
    expect(await ids(await nextRequest(`${LIST}?q=${encodeURIComponent("%%%")}`, { headers: { cookie: adminCookie } }))).toEqual([]);
  });

  test("combines filters", async () => {
    expect(await ids(await nextRequest(`${LIST}?severity=urgent&read=read`, { headers: { cookie: adminCookie } }))).toEqual([N2]);
    expect(await ids(await nextRequest(`${LIST}?project_id=${P1}&trigger_type=rag_downgrade&delivery_status=pending`, { headers: { cookie: adminCookie } }))).toEqual([N1]);
  });
});

// ── list: paging + delivery summary ────────────────────────────────────────────

describe("GET /api/admin/notifications — paging caps and delivery summary", () => {
  test("page_size is capped at 100 and page walks the full set", async () => {
    expect((await nextRequest(`${LIST}?page_size=101`, { headers: { cookie: adminCookie } })).status).toBe(400);
    expect((await nextRequest(`${LIST}?page=0`, { headers: { cookie: adminCookie } })).status).toBe(400);

    // 105 extra rows → 109 total; walk with page_size 100.
    for (let i = 0; i < 105; i++) {
      insertNotification({ id: `n-bulk-${i}`, userId: "system", sentAt: `2026-09-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.000Z` });
    }
    const p1 = await nextRequest(`${LIST}?page_size=100&page=1`, { headers: { cookie: adminCookie } });
    const j1 = await jsonOf(p1);
    expect(j1.meta).toMatchObject({ page: 1, page_size: 100, total: 109, total_pages: 2 });
    expect(j1.data.rows).toHaveLength(100);
    const p2 = await nextRequest(`${LIST}?page_size=100&page=2`, { headers: { cookie: adminCookie } });
    expect((await dataOf(p2)).rows).toHaveLength(9);
    // Default page_size is 50.
    const def = await metaOf(await nextRequest(LIST, { headers: { cookie: adminCookie } }));
    expect(def.page_size).toBe(50);
  });

  test("per-row delivery summary: per-channel status counts, {} for in-app-only rows", async () => {
    const d = (await dataOf(await nextRequest(`${LIST}?page_size=100`, { headers: { cookie: adminCookie } })) ) as any;
    const byId = new Map<string, any>(d.rows.map((r: any) => [r.id, r]));
    expect(byId.get(N1).delivery).toEqual({ email: { sent: 1 }, webhook: { pending: 1 } });
    expect(byId.get(N2).delivery).toEqual({ email: { failed: 1 } });
    expect(byId.get(N3).delivery).toEqual({});
    expect(byId.get(N1).project).toEqual({ id: P1, project_no: "NP-NOTIF-1" });
    expect(byId.get(N3).project).toBeNull();
    // Row shape per §13.5: id, timestamp, trigger, severity, title, project, read flag, delivery summary.
    expect(Object.keys(byId.get(N1)).sort()).toEqual(["delivery", "id", "project", "read_at", "sent_at", "severity", "title", "trigger_type"].sort());
  });
});

// ── detail ─────────────────────────────────────────────────────────────────────

describe("GET /api/admin/notifications/[id]", () => {
  test("returns the full row: parsed payload, project, and the delivery attempts table", async () => {
    const res = await nextRequest(`${LIST}/${N1}`, { headers: { cookie: adminCookie } });
    expect(res.status).toBe(200);
    const d = await dataOf(res);
    expect(d).toMatchObject({
      id: N1,
      user_id: "watch-owner",
      trigger_type: "rag_downgrade",
      severity: "warning",
      title: "RAG downgraded to red",
      channel: "all",
      bundle: "immediate",
      source_ref: null,
    });
    expect(d.payload).toEqual({ summary: "IRR fell below hurdle" }); // parsed JSON, not a string
    expect(d.project).toEqual({ id: P1, project_no: "NP-NOTIF-1" });
    expect(d.deliveries).toHaveLength(2);
    const email = d.deliveries.find((x: any) => x.channel === "email");
    expect(email).toMatchObject({ status: "sent", attempt: 1, recipient_address_masked: "o***@example.com", is_test: 0 });
    const webhook = d.deliveries.find((x: any) => x.channel === "webhook");
    expect(webhook.target_key).toBe("deals");
  });

  test("404 for an unknown id", async () => {
    expect((await nextRequest(`${LIST}/does-not-exist`, { headers: { cookie: adminCookie } })).status).toBe(404);
  });
});

// ── masking (§13.8) ────────────────────────────────────────────────────────────

describe("masking (§13.8) — masked addresses, webhook URLs never returned", () => {
  test("no raw email address ever appears in list or detail responses", async () => {
    const listText = await (await nextRequest(`${LIST}?page_size=100`, { headers: { cookie: adminCookie } })).text();
    expect(listText).not.toContain("owner@example.com"); // the list carries no addresses at all
    const detailText = await (await nextRequest(`${LIST}/${N1}`, { headers: { cookie: adminCookie } })).text();
    expect(detailText).not.toContain("owner@example.com");
    expect(detailText).toContain("o***@example.com"); // masked form only (§13.8)
  });

  test("webhook target URLs (env secrets) are never present in any response", async () => {
    const secretUrl = "https://hooks.slack.com/services/T0/B0/p4-secret-token";
    process.env.NOTIFY_WEBHOOK_URL_DEALS = secretUrl;
    db.run("INSERT OR REPLACE INTO notify_webhook_target (channel_key, env_var, format, enabled) VALUES ('deals', 'NOTIFY_WEBHOOK_URL_DEALS', 'slack', 1)");
    try {
      const listText = await (await nextRequest(`${LIST}?page_size=100`, { headers: { cookie: adminCookie } })).text();
      const detailText = await (await nextRequest(`${LIST}/${N1}`, { headers: { cookie: adminCookie } })).text();
      for (const text of [listText, detailText]) {
        expect(text).not.toContain("hooks.slack.com");
        expect(text).not.toContain(secretUrl);
      }
      // Only the channel KEY is exposed (detail's target_key; the list summary carries channel names too).
      expect(detailText).toContain("deals");
    } finally {
      delete process.env.NOTIFY_WEBHOOK_URL_DEALS;
      db.run("DELETE FROM notify_webhook_target WHERE channel_key = 'deals'");
    }
  });
});

// ── test send (§13.7) ──────────────────────────────────────────────────────────

describe("POST /api/admin/notifications/test", () => {
  const auditRows = () => db.query("SELECT * FROM audit_log WHERE action = 'notification_test_sent' ORDER BY created_at, id").all() as any[];

  test("in_app: creates the test notification and an audit row with the target user", async () => {
    const res = await nextRequest(`${LIST}/test`, {
      method: "POST",
      headers: { cookie: adminCookie },
      body: JSON.stringify({ channel: "in_app", target: "watch-owner" }),
    });
    expect(res.status).toBe(201);
    const d = await dataOf(res);
    const row = db.query("SELECT * FROM notification WHERE id = ?").get(d.notification_id) as any;
    expect(row).toMatchObject({ trigger_type: "test", severity: "info", title: "Test notification", bundle: "immediate", channel: "in_app", user_id: "watch-owner", project_id: null });
    const audits = auditRows();
    expect(audits.at(-1).target).toBe("in_app:watch-owner");
  });

  test("email: requires the user to exist AND carry app_user.email; audit target is masked", async () => {
    const missing = await nextRequest(`${LIST}/test`, { method: "POST", headers: { cookie: adminCookie }, body: JSON.stringify({ channel: "email", target: "no-such-user" }) });
    expect(missing.status).toBe(400);
    expect((await missing.json()).error.code).toBe("invalid_target");
    const noAddr = await nextRequest(`${LIST}/test`, { method: "POST", headers: { cookie: adminCookie }, body: JSON.stringify({ channel: "email", target: "no-email-user" }) });
    expect(noAddr.status).toBe(400);
    const okRes = await nextRequest(`${LIST}/test`, { method: "POST", headers: { cookie: adminCookie }, body: JSON.stringify({ channel: "email", target: "watch-owner" }) });
    expect(okRes.status).toBe(201);
    const lastAudit = auditRows().at(-1);
    expect(lastAudit.target).toBe(`email:${maskAddress("owner@example.com")}`);
    expect(lastAudit.target).not.toContain("owner@example.com");
  });

  test("webhook: target must be a configured enabled channel key; expansion honors the requested key with is_test=1", async () => {
    const bad = await nextRequest(`${LIST}/test`, { method: "POST", headers: { cookie: adminCookie }, body: JSON.stringify({ channel: "webhook", target: "not-a-key" }) });
    expect(bad.status).toBe(400);
    db.run("INSERT OR REPLACE INTO notify_webhook_target (channel_key, env_var, format, enabled) VALUES ('deals', 'NOTIFY_WEBHOOK_URL_DEALS', 'slack', 1)");
    try {
      const res = await nextRequest(`${LIST}/test`, { method: "POST", headers: { cookie: adminCookie }, body: JSON.stringify({ channel: "webhook", target: "deals" }) });
      expect(res.status).toBe(201);
      const { notification_id } = await dataOf(res);
      // The D9 seed grants webhook only to urgent/ops — without the explicit-key threading the
      // policy-driven expansion would produce ZERO rows for this info/test notification.
      expandPending(db, new Date());
      const rows = db.query("SELECT * FROM notification_delivery WHERE notification_id = ?").all(notification_id) as any[];
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ channel: "webhook", target_key: "deals", is_test: 1, recipient_user_id: null });
    } finally {
      db.run("DELETE FROM notify_webhook_target WHERE channel_key = 'deals'");
    }
  });

  test("email test expansion produces an is_test=1 delivery with a masked address", async () => {
    const res = await nextRequest(`${LIST}/test`, { method: "POST", headers: { cookie: adminCookie }, body: JSON.stringify({ channel: "email", target: "watch-owner" }) });
    expect(res.status).toBe(201);
    const { notification_id } = await dataOf(res);
    expandPending(db, new Date());
    const rows = db.query("SELECT * FROM notification_delivery WHERE notification_id = ?").all(notification_id) as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ channel: "email", is_test: 1, recipient_user_id: "watch-owner", recipient_address_masked: maskAddress("owner@example.com") });
  });

  test("rate limit: 5 per admin per hour over the action's own audit rows; 429 on the 6th", async () => {
    for (let i = 0; i < 5; i++) {
      const res = await nextRequest(`${LIST}/test`, { method: "POST", headers: { cookie: admin2Cookie }, body: JSON.stringify({ channel: "in_app", target: "watch-owner" }) });
      expect(res.status).toBe(201);
    }
    const sixth = await nextRequest(`${LIST}/test`, { method: "POST", headers: { cookie: admin2Cookie }, body: JSON.stringify({ channel: "in_app", target: "watch-owner" }) });
    expect(sixth.status).toBe(429);
    expect((await sixth.json()).error.code).toBe("rate_limited");
    // The other admin's budget is untouched (per-admin limit).
    const other = await nextRequest(`${LIST}/test`, { method: "POST", headers: { cookie: adminCookie }, body: JSON.stringify({ channel: "in_app", target: "watch-owner" }) });
    expect(other.status).toBe(201);
  });

  test("invalid bodies are 400", async () => {
    expect((await nextRequest(`${LIST}/test`, { method: "POST", headers: { cookie: adminCookie }, body: "[]" })).status).toBe(400);
    expect((await nextRequest(`${LIST}/test`, { method: "POST", headers: { cookie: adminCookie }, body: JSON.stringify({ channel: "sms", target: "x" }) })).status).toBe(400);
    expect((await nextRequest(`${LIST}/test`, { method: "POST", headers: { cookie: adminCookie }, body: JSON.stringify({ channel: "in_app" }) })).status).toBe(400);
  });
});
