// @version 1.0.0
/**
 * P4 watch / watch-rule CRUD + dry-run preview (design 2026-10-29-scheduled-jobs-design
 * §13.6/§13.8) against the real Route Handlers via nextRequest() on a scratch SQLite
 * (never the dev 7748 or prod 7749 DB).
 *
 * Covered: watch list (project/user join + rule counts + derived enabled), create with
 * one-watch-per (project,user) 409, PATCH/DELETE as disable-all-rules (schema has no
 * watch.enabled/name column), the rule validation matrix (threshold required/forbidden,
 * cooldown bounds, channel config gating, notification-only triggers rejected, severity
 * not storable), rule PATCH composite re-validation, hard rule delete, and the preview:
 * would-fire with resolved (masked) recipients on seeded fixtures while writing NOTHING.
 */
import { test, expect, beforeAll, afterAll, beforeEach, afterEach, describe } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = mkdtempSync(join(tmpdir(), "admin-watches-api-"));
const TEST_DB_PATH = join(TMP, "admin-watches.sqlite");
process.env.CO_NEWBIZ_LLM_PROVIDER = "none";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { ulid } = await import("../../db/lib/ulid.ts");
const { nextRequest } = await import("./helpers/next-route-dispatch.ts");

const NOW = new Date().toISOString();

// ── env hygiene (channel gating reads env at request time) ────────────────────
const ENV_KEYS = ["NOTIFY_SMTP_HOST", "NOTIFY_SMTP_FROM"];
let savedEnv: Record<string, string | undefined>;
beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});
afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

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

function insertWatch(id: string, projectId: string, userId: string): void {
  db.run("INSERT INTO watch (id, project_id, user_id, last_checked_at, created_at) VALUES (?, ?, NULLIF(?, ''), ?, ?)", [id, projectId, userId, null, "2026-10-01T00:00:00Z"]);
}

function insertRule(id: string, watchId: string, trigger: string, threshold: number | null, cooldown: number, channel: string, enabled = 1): void {
  db.run(
    "INSERT INTO watch_rule (id, watch_id, trigger_type, threshold, cooldown_hours, channel, enabled, adr_ref) VALUES (?,?,?,?,?,?,?, NULL)",
    [id, watchId, trigger, threshold, cooldown, channel, enabled],
  );
}

async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await nextRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  expect(res.status).toBe(200);
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}

const P1 = "proj-watch-1";
const P2 = "proj-watch-2";
const W1 = "watch-w1"; // P1 / w-owner / 2 rules (one disabled)
const W2 = "watch-w2"; // P2 / w-owner / no rules
const R1 = "rule-r1"; // rag_downgrade, no threshold, 24h, all, enabled
const R2 = "rule-r2"; // staleness, 30 days, 48h, email, DISABLED

const WATCHES = "/api/admin/watches";
const watchPath = (id: string) => `${WATCHES}/${id}`;
const rulesPath = (id: string) => `${WATCHES}/${id}/rules`;
const rulePath = (id: string) => `/api/admin/watch-rules/${id}`;

let adminCookie: string;
let analystCookie: string;

beforeAll(async () => {
  insertProject(P1, "NP-WATCH-1");
  insertProject(P2, "NP-WATCH-2");
  insertWatch(W1, P1, "w-owner");
  insertWatch(W2, P2, "w-owner");
  insertRule(R1, W1, "rag_downgrade", null, 24, "all", 1);
  insertRule(R2, W1, "staleness", 30, 48, "email", 0);
  insertAppUser("w-owner", "analyst", "wowner@example.com");

  for (const [userId, role, password] of [
    ["wadmin", "admin", "pw-wadmin-123"],
    ["wanalyst", "analyst", "pw-wanalyst-1"],
  ] as const) {
    await createUser(db, { userId, role, password, createdBy: "test", now: NOW });
    approveUser(db, { userId, approvedBy: "test", now: NOW });
  }
  db.run("UPDATE app_user SET must_change_password = 0 WHERE user_id IN ('wadmin','wanalyst')");
  adminCookie = await loginCookie("wadmin", "pw-wadmin-123");
  analystCookie = await loginCookie("wanalyst", "pw-wanalyst-1");
});

afterAll(() => {
  resetDb();
  rmSync(TMP, { recursive: true, force: true });
});

const jsonOf = async (res: Response) => await res.json();

// ── access control ─────────────────────────────────────────────────────────────

describe("access control (admin-only)", () => {
  test("unauthenticated requests are 401 across the surface", async () => {
    expect((await nextRequest(WATCHES)).status).toBe(401);
    expect((await nextRequest(watchPath(W1), { method: "PATCH", body: "{}" })).status).toBe(401);
    expect((await nextRequest(watchPath(W1), { method: "DELETE" })).status).toBe(401);
    expect((await nextRequest(rulesPath(W1))).status).toBe(401);
    expect((await nextRequest(rulesPath(W1), { method: "POST", body: "{}" })).status).toBe(401);
    expect((await nextRequest(rulePath(R1), { method: "DELETE" })).status).toBe(401);
    expect((await nextRequest("/api/admin/watch-rules/preview", { method: "POST", body: "{}" })).status).toBe(401);
  });

  test("analyst is 403 admin_required", async () => {
    expect((await nextRequest(WATCHES, { headers: { cookie: analystCookie } })).status).toBe(403);
    expect((await nextRequest(rulesPath(W1), { method: "POST", headers: { cookie: analystCookie }, body: "{}" })).status).toBe(403);
    expect((await nextRequest("/api/admin/watch-rules/preview", { method: "POST", headers: { cookie: analystCookie }, body: "{}" })).status).toBe(403);
  });
});

// ── watch CRUD ─────────────────────────────────────────────────────────────────

describe("GET/POST /api/admin/watches", () => {
  test("list: project join, rule counts, derived enabled state", async () => {
    const res = await nextRequest(WATCHES, { headers: { cookie: adminCookie } });
    expect(res.status).toBe(200);
    const rows = (await jsonOf(res)).data.rows;
    const w1 = rows.find((r: any) => r.id === W1);
    expect(w1).toMatchObject({
      project: { id: P1, project_no: "NP-WATCH-1" },
      user_id: "w-owner",
      rule_count: 2,
      enabled_rule_count: 1,
      enabled: true,
    });
    const w2 = rows.find((r: any) => r.id === W2);
    expect(w2).toMatchObject({ rule_count: 0, enabled_rule_count: 0, enabled: false });
  });

  test("create: 201 + audited; duplicate (project,user) is 409; unknown project/user 400", async () => {
    const res = await nextRequest(WATCHES, { method: "POST", headers: { cookie: adminCookie }, body: JSON.stringify({ project_id: P2, user_id: "wanalyst" }) });
    expect(res.status).toBe(201);
    const created = (await jsonOf(res)).data;
    expect(created.project_id).toBe(P2);
    const audit = db.query("SELECT * FROM audit_log WHERE action = 'watch_create' ORDER BY created_at DESC, id DESC").get() as any;
    expect(audit.target).toContain(P2);

    const dupe = await nextRequest(WATCHES, { method: "POST", headers: { cookie: adminCookie }, body: JSON.stringify({ project_id: P2, user_id: "wanalyst" }) });
    expect(dupe.status).toBe(409);
    expect((await jsonOf(dupe)).error.code).toBe("watch_exists");

    expect((await nextRequest(WATCHES, { method: "POST", headers: { cookie: adminCookie }, body: JSON.stringify({ project_id: "nope", user_id: "wanalyst" }) })).status).toBe(400);
    expect((await nextRequest(WATCHES, { method: "POST", headers: { cookie: adminCookie }, body: JSON.stringify({ project_id: P1, user_id: "no-such" }) })).status).toBe(400);
  });
});

describe("PATCH/DELETE /api/admin/watches/[id] — all-rules semantics", () => {
  test("PATCH enabled=false disables every rule of the watch; true re-enables", async () => {
    const off = await nextRequest(watchPath(W1), { method: "PATCH", headers: { cookie: adminCookie }, body: JSON.stringify({ enabled: false }) });
    expect(off.status).toBe(200);
    expect((await jsonOf(off)).data).toMatchObject({ id: W1, enabled: false, rules_updated: 2 });
    expect(db.query("SELECT COUNT(*) c FROM watch_rule WHERE watch_id = ? AND enabled = 1").get(W1)).toMatchObject({ c: 0 });
    const audit = db.query("SELECT * FROM audit_log WHERE action = 'watch_update' ORDER BY created_at DESC, id DESC").get() as any;
    expect(audit.target).toContain("enabled=0");

    const on = await nextRequest(watchPath(W1), { method: "PATCH", headers: { cookie: adminCookie }, body: JSON.stringify({ enabled: true }) });
    expect(on.status).toBe(200);
    expect(db.query("SELECT COUNT(*) c FROM watch_rule WHERE watch_id = ? AND enabled = 1").get(W1)).toMatchObject({ c: 2 });
    // Restore the seeded mixed state.
    db.run("UPDATE watch_rule SET enabled = 0 WHERE id = ?", [R2]);
  });

  test("PATCH with a name field explains the schema drift; unknown fields rejected; 404 unknown watch", async () => {
    const rename = await nextRequest(watchPath(W1), { method: "PATCH", headers: { cookie: adminCookie }, body: JSON.stringify({ name: "x" }) });
    expect(rename.status).toBe(400);
    expect((await jsonOf(rename)).error.message).toContain("no name column");
    expect((await nextRequest(watchPath(W1), { method: "PATCH", headers: { cookie: adminCookie }, body: JSON.stringify({ bogus: 1 }) })).status).toBe(400);
    expect((await nextRequest(watchPath("no-such-watch"), { method: "PATCH", headers: { cookie: adminCookie }, body: JSON.stringify({ enabled: false }) })).status).toBe(404);
  });

  test("DELETE is the §13.6 soft delete: rules disabled, watch row stays, audited", async () => {
    const res = await nextRequest(watchPath(W2), { method: "DELETE", headers: { cookie: adminCookie } });
    expect(res.status).toBe(200);
    expect((await jsonOf(res)).data).toMatchObject({ id: W2, mode: "soft", rules_disabled: 0 });
    insertRule("rule-w2-a", W2, "kill_criteria", null, 24, "all", 1);
    const res2 = await nextRequest(watchPath(W2), { method: "DELETE", headers: { cookie: adminCookie } });
    expect((await jsonOf(res2)).data.rules_disabled).toBe(1);
    expect(db.query("SELECT COUNT(*) c FROM watch WHERE id = ?").get(W2)).toMatchObject({ c: 1 }); // row stays
    expect(db.query("SELECT enabled FROM watch_rule WHERE id = ?").get("rule-w2-a")).toMatchObject({ enabled: 0 });
    const audit = db.query("SELECT * FROM audit_log WHERE action = 'watch_delete' ORDER BY created_at DESC, id DESC").get() as any;
    expect(audit.target).toContain(W2);
    expect((await nextRequest(watchPath("no-such-watch"), { method: "DELETE", headers: { cookie: adminCookie } })).status).toBe(404);
  });
});

// ── rule CRUD + validation matrix ──────────────────────────────────────────────

describe("GET/POST /api/admin/watches/[id]/rules", () => {
  test("list returns the watch's rules; 404 unknown watch", async () => {
    const res = await nextRequest(rulesPath(W1), { headers: { cookie: adminCookie } });
    expect(res.status).toBe(200);
    const rows = (await jsonOf(res)).data.rows;
    expect(rows.map((r: any) => r.id).sort()).toEqual([R1, R2].sort());
    expect((await nextRequest(rulesPath("no-such-watch"), { headers: { cookie: adminCookie } })).status).toBe(404);
  });

  test("threshold-bearing triggers: required and > 0", async () => {
    const missing = await nextRequest(rulesPath(W1), { method: "POST", headers: { cookie: adminCookie }, body: JSON.stringify({ trigger_type: "threshold_breach" }) });
    expect(missing.status).toBe(400);
    expect((await jsonOf(missing)).error.details.fields.threshold).toContain("required");

    const zero = await nextRequest(rulesPath(W1), { method: "POST", headers: { cookie: adminCookie }, body: JSON.stringify({ trigger_type: "threshold_breach", threshold: 0 }) });
    expect(zero.status).toBe(400);
    expect((await jsonOf(zero)).error.details.fields.threshold).toContain("> 0");

    const negative = await nextRequest(rulesPath(W1), { method: "POST", headers: { cookie: adminCookie }, body: JSON.stringify({ trigger_type: "staleness", threshold: -5 }) });
    expect(negative.status).toBe(400);

    const okBreach = await nextRequest(rulesPath(W1), { method: "POST", headers: { cookie: adminCookie }, body: JSON.stringify({ trigger_type: "threshold_breach", threshold: 2.5 }) });
    expect(okBreach.status).toBe(201);
    expect((await jsonOf(okBreach)).data).toMatchObject({ trigger_type: "threshold_breach", threshold: 2.5, enabled: 1 });

    const okStale = await nextRequest(rulesPath(W1), { method: "POST", headers: { cookie: adminCookie }, body: JSON.stringify({ trigger_type: "staleness", threshold: 30 }) });
    expect(okStale.status).toBe(201);
    expect((await jsonOf(okStale)).data.threshold).toBe(30);
  });

  test("threshold rejected for event-driven triggers; null accepted", async () => {
    const withThreshold = await nextRequest(rulesPath(W1), { method: "POST", headers: { cookie: adminCookie }, body: JSON.stringify({ trigger_type: "rag_upgrade", threshold: 5 }) });
    expect(withThreshold.status).toBe(400);
    expect((await jsonOf(withThreshold)).error.details.fields.threshold).toContain("not accepted");
    const ok = await nextRequest(rulesPath(W1), { method: "POST", headers: { cookie: adminCookie }, body: JSON.stringify({ trigger_type: "rag_downgrade", threshold: null }) });
    expect(ok.status).toBe(201);
    expect((await jsonOf(ok)).data.threshold).toBeNull();
  });

  test("trigger_type must be from the watch_rule CHECK's 7-value set (not the notification set)", async () => {
    for (const trigger of ["pipeline_paused", "establishment_step_reopened", "test", "not_a_trigger"]) {
      const res = await nextRequest(rulesPath(W1), { method: "POST", headers: { cookie: adminCookie }, body: JSON.stringify({ trigger_type: trigger, ...(trigger === "not_a_trigger" ? {} : { threshold: trigger === "threshold_breach" || trigger === "staleness" ? 1 : null }) }) });
      expect(res.status).toBe(400);
    }
  });

  test("cooldown_hours bounds 1–720 integer", async () => {
    for (const cooldown of [0, 721, 1.5, "24"]) {
      const res = await nextRequest(rulesPath(W1), { method: "POST", headers: { cookie: adminCookie }, body: JSON.stringify({ trigger_type: "rag_downgrade", cooldown_hours: cooldown }) });
      expect(res.status).toBe(400);
    }
    for (const cooldown of [1, 720]) {
      const res = await nextRequest(rulesPath(W1), { method: "POST", headers: { cookie: adminCookie }, body: JSON.stringify({ trigger_type: "rag_downgrade", cooldown_hours: cooldown }) });
      expect(res.status).toBe(201);
    }
    const def = await nextRequest(rulesPath(W1), { method: "POST", headers: { cookie: adminCookie }, body: JSON.stringify({ trigger_type: "rag_downgrade" }) });
    expect((await jsonOf(def)).data.cooldown_hours).toBe(24); // default
  });

  test("channel gating: in_app and 'all' always; email needs SMTP env; webhook needs an enabled target row", async () => {
    // Nothing configured.
    expect((await nextRequest(rulesPath(W1), { method: "POST", headers: { cookie: adminCookie }, body: JSON.stringify({ trigger_type: "rag_downgrade", channel: "email" }) })).status).toBe(400);
    expect((await nextRequest(rulesPath(W1), { method: "POST", headers: { cookie: adminCookie }, body: JSON.stringify({ trigger_type: "rag_downgrade", channel: "webhook" }) })).status).toBe(400);
    expect((await nextRequest(rulesPath(W1), { method: "POST", headers: { cookie: adminCookie }, body: JSON.stringify({ trigger_type: "rag_downgrade", channel: "all" }) })).status).toBe(201);
    expect((await nextRequest(rulesPath(W1), { method: "POST", headers: { cookie: adminCookie }, body: JSON.stringify({ trigger_type: "rag_downgrade", channel: "in_app" }) })).status).toBe(201);

    // SMTP configured → email opens.
    process.env.NOTIFY_SMTP_HOST = "smtp.example.com";
    process.env.NOTIFY_SMTP_FROM = "co-newbiz@example.com";
    expect((await nextRequest(rulesPath(W1), { method: "POST", headers: { cookie: adminCookie }, body: JSON.stringify({ trigger_type: "rag_downgrade", channel: "email" }) })).status).toBe(201);
    delete process.env.NOTIFY_SMTP_HOST;
    delete process.env.NOTIFY_SMTP_FROM;

    // Disabled-only webhook target does NOT open the channel; enabled does.
    db.run("INSERT OR REPLACE INTO notify_webhook_target (channel_key, env_var, format, enabled) VALUES ('deals', 'NOTIFY_WEBHOOK_URL_DEALS', 'slack', 0)");
    expect((await nextRequest(rulesPath(W1), { method: "POST", headers: { cookie: adminCookie }, body: JSON.stringify({ trigger_type: "rag_downgrade", channel: "webhook" }) })).status).toBe(400);
    db.run("UPDATE notify_webhook_target SET enabled = 1 WHERE channel_key = 'deals'");
    const okWebhook = await nextRequest(rulesPath(W1), { method: "POST", headers: { cookie: adminCookie }, body: JSON.stringify({ trigger_type: "rag_downgrade", channel: "webhook" }) });
    expect(okWebhook.status).toBe(201);
    db.run("DELETE FROM notify_webhook_target WHERE channel_key = 'deals'");
  });

  test("severity is not storable on watch_rule; unknown fields rejected; enabled=false stored", async () => {
    const sev = await nextRequest(rulesPath(W1), { method: "POST", headers: { cookie: adminCookie }, body: JSON.stringify({ trigger_type: "rag_downgrade", severity: "urgent" }) });
    expect(sev.status).toBe(400);
    expect((await jsonOf(sev)).error.details.fields.severity).toContain("not stored");

    const junk = await nextRequest(rulesPath(W1), { method: "POST", headers: { cookie: adminCookie }, body: JSON.stringify({ trigger_type: "rag_downgrade", bogus: 1 }) });
    expect(junk.status).toBe(400);

    const disabled = await nextRequest(rulesPath(W1), { method: "POST", headers: { cookie: adminCookie }, body: JSON.stringify({ trigger_type: "batch_failure", enabled: false, adr_ref: "ADR-0019" }) });
    expect(disabled.status).toBe(201);
    expect((await jsonOf(disabled)).data).toMatchObject({ enabled: 0, adr_ref: "ADR-0019" });
  });

  test("rule create is audited", async () => {
    const before = (db.query("SELECT COUNT(*) c FROM audit_log WHERE action = 'watch_rule_create'").get() as any).c;
    await nextRequest(rulesPath(W1), { method: "POST", headers: { cookie: adminCookie }, body: JSON.stringify({ trigger_type: "regulation_change" }) });
    expect((db.query("SELECT COUNT(*) c FROM audit_log WHERE action = 'watch_rule_create'").get() as any).c).toBe(before + 1);
  });
});

describe("PATCH/DELETE /api/admin/watch-rules/[id]", () => {
  test("PATCH re-validates the composite: switching onto a bearing trigger needs a threshold", async () => {
    const res = await nextRequest(rulePath(R1), { method: "PATCH", headers: { cookie: adminCookie }, body: JSON.stringify({ trigger_type: "threshold_breach" }) });
    expect(res.status).toBe(400);
    expect((await jsonOf(res)).error.details.fields.threshold).toContain("required");

    const ok = await nextRequest(rulePath(R1), { method: "PATCH", headers: { cookie: adminCookie }, body: JSON.stringify({ trigger_type: "threshold_breach", threshold: 1.5, cooldown_hours: 48 }) });
    expect(ok.status).toBe(200);
    expect((await jsonOf(ok)).data).toMatchObject({ trigger_type: "threshold_breach", threshold: 1.5, cooldown_hours: 48 });
    const audit = db.query("SELECT * FROM audit_log WHERE action = 'watch_rule_update' ORDER BY created_at DESC, id DESC").get() as any;
    expect(audit.target).toContain("trigger rag_downgrade→threshold_breach");
    // Restore.
    db.run("UPDATE watch_rule SET trigger_type = 'rag_downgrade', threshold = NULL, cooldown_hours = 24 WHERE id = ?", [R1]);
  });

  test("PATCH enabled toggle and 404", async () => {
    const res = await nextRequest(rulePath(R2), { method: "PATCH", headers: { cookie: adminCookie }, body: JSON.stringify({ enabled: true }) });
    expect(res.status).toBe(200);
    expect((await jsonOf(res)).data.enabled).toBe(1);
    expect((await nextRequest(rulePath("no-such-rule"), { method: "PATCH", headers: { cookie: adminCookie }, body: JSON.stringify({ enabled: true }) })).status).toBe(404);
    db.run("UPDATE watch_rule SET enabled = 0 WHERE id = ?", [R2]);
  });

  test("DELETE hard-deletes the rule row and is audited", async () => {
    insertRule("rule-del", W1, "batch_failure", null, 24, "in_app", 1);
    const res = await nextRequest(rulePath("rule-del"), { method: "DELETE", headers: { cookie: adminCookie } });
    expect(res.status).toBe(200);
    expect((await jsonOf(res)).data).toMatchObject({ id: "rule-del", deleted: true });
    expect(db.query("SELECT COUNT(*) c FROM watch_rule WHERE id = ?").get("rule-del")).toMatchObject({ c: 0 });
    const audit = db.query("SELECT * FROM audit_log WHERE action = 'watch_rule_delete' ORDER BY created_at DESC, id DESC").get() as any;
    expect(audit.target).toContain("rule-del");
    expect((await nextRequest(rulePath("rule-del"), { method: "DELETE", headers: { cookie: adminCookie } })).status).toBe(404);
  });
});

// ── preview (dry run — writes NOTHING) ─────────────────────────────────────────

describe("POST /api/admin/watch-rules/preview", () => {
  const PX = "proj-preview";
  let WX: string;

  beforeAll(() => {
    insertProject(PX, "NP-PREVIEW");
    WX = "watch-preview";
    insertWatch(WX, PX, "w-owner");
  });

  const counts = () => ({
    notifications: (db.query("SELECT COUNT(*) c FROM notification").get() as any).c,
    deliveries: (db.query("SELECT COUNT(*) c FROM notification_delivery").get() as any).c,
    watermark: (db.query("SELECT last_checked_at FROM watch WHERE id = ?").get(WX) as any).last_checked_at,
    // F1 (security review): the rag_transition.notified flip is dryRun-guarded in the engine —
    // snapshot the flags per row so the preview's zero-write property covers that UPDATE too.
    ragNotified: db.query("SELECT id, notified FROM rag_transition WHERE project_id = ? ORDER BY id").all(PX),
  });

  test("staleness: would-fire on an old anchor series with resolved masked recipients — and writes NOTHING", async () => {
    const runId = ulid();
    db.run("INSERT INTO run (id, project_id, label, input_hash, created_by, created_at) VALUES (?,?,?,?,?,?)", [runId, PX, "manual", "hash", "test", NOW]);
    db.run("INSERT INTO assumption (id, run_id, assumption_key, kind, value, anchor_ref, as_of) VALUES (?,?,?,?,?,?,?)", [ulid(), runId, "oil_price", "live", 70, "SERIES-PREV", NOW]);
    const fortyFiveDaysAgo = new Date(Date.parse(NOW) - 45 * 86_400_000).toISOString();
    db.run("INSERT INTO data_change_log (id, series_id, detected_at, change_type, old_value, new_value) VALUES (?,?,?,?,?,?)", [ulid(), "SERIES-PREV", fortyFiveDaysAgo, "revised", 70, 55]);

    const before = counts();
    const res = await nextRequest("/api/admin/watch-rules/preview", {
      method: "POST",
      headers: { cookie: adminCookie },
      body: JSON.stringify({ watch_id: WX, trigger_type: "staleness", threshold: 30 }),
    });
    expect(res.status).toBe(200);
    const d = (await jsonOf(res)).data;
    expect(d).toMatchObject({ watch_id: WX, evaluated: true, would_fire: true, suppressed_by_cooldown: false, severity: "warning", channel: "all", in_app_user_ids: ["w-owner"] });
    expect(d.reason).toContain("45.0 days");
    expect(d.recipients).toEqual([{ user_id: "w-owner", email_masked: "w***@example.com", channels: ["email"] }]);

    const after = counts();
    expect(after).toEqual(before); // no notification/delivery rows, no watermark advance
  });

  test("rag_downgrade: matches the latest transition direction; cooldown suppression flips would_fire", async () => {
    const runId = ulid();
    db.run("INSERT INTO run (id, project_id, label, input_hash, created_by, created_at) VALUES (?,?,?,?,?,?)", [runId, PX, "manual", "hash", "test", NOW]);
    db.run(
      "INSERT INTO rag_transition (id, project_id, from_grade, to_grade, run_id, at, reason, notified) VALUES (?,?,?,?,?,?,?,0)",
      [ulid(), PX, "amber", "red", runId, NOW, "dscr deterioration"],
    );
    const before = counts();
    expect(before.ragNotified).toHaveLength(1);
    expect(before.ragNotified[0]).toMatchObject({ notified: 0 }); // F1: seeded UN-notified on purpose

    const fresh = await nextRequest("/api/admin/watch-rules/preview", {
      method: "POST",
      headers: { cookie: adminCookie },
      body: JSON.stringify({ watch_id: WX, trigger_type: "rag_downgrade" }),
    });
    expect(fresh.status).toBe(200);
    const d = (await jsonOf(fresh)).data;
    expect(d).toMatchObject({ evaluated: true, would_fire: true, suppressed_by_cooldown: false, severity: "warning" });
    expect(d.reason).toContain("amber→red");

    // A recent notification for the same (project, trigger) puts the draft inside its own cooldown.
    db.run(
      "INSERT INTO notification (id, user_id, project_id, trigger_type, severity, payload, channel, bundle, sent_at) VALUES (?,?,?,?,?,?,?,?,?)",
      [ulid(), "w-owner", PX, "rag_downgrade", "warning", "{}", "all", "immediate", NOW],
    );
    const cooled = await nextRequest("/api/admin/watch-rules/preview", {
      method: "POST",
      headers: { cookie: adminCookie },
      body: JSON.stringify({ watch_id: WX, trigger_type: "rag_downgrade", cooldown_hours: 24 }),
    });
    const cd = (await jsonOf(cooled)).data;
    expect(cd).toMatchObject({ would_fire: false, suppressed_by_cooldown: true });

    // F1 (security review): a would-fire preview must NOT flip rag_transition.notified —
    // the only UPDATE that sets it is dryRun-guarded in the engine; this is the regression evidence.
    const after = counts();
    expect(after.ragNotified).toEqual(before.ragNotified);
    expect(after.ragNotified.every((r: any) => r.notified === 0)).toBe(true);
  });

  test("threshold_breach is event-driven: evaluated=false with an honest reason", async () => {
    const res = await nextRequest("/api/admin/watch-rules/preview", {
      method: "POST",
      headers: { cookie: adminCookie },
      body: JSON.stringify({ watch_id: WX, trigger_type: "threshold_breach", threshold: 5 }),
    });
    expect(res.status).toBe(200);
    const d = (await jsonOf(res)).data;
    expect(d).toMatchObject({ evaluated: false, would_fire: false });
    expect(d.reason).toContain("threshold_breach");
  });

  test("validation and 404s: unknown watch, missing watch_id, invalid draft", async () => {
    expect((await nextRequest("/api/admin/watch-rules/preview", { method: "POST", headers: { cookie: adminCookie }, body: JSON.stringify({ trigger_type: "rag_downgrade" }) })).status).toBe(400);
    expect((await nextRequest("/api/admin/watch-rules/preview", { method: "POST", headers: { cookie: adminCookie }, body: JSON.stringify({ watch_id: "no-such-watch", trigger_type: "rag_downgrade" }) })).status).toBe(404);
    const bad = await nextRequest("/api/admin/watch-rules/preview", { method: "POST", headers: { cookie: adminCookie }, body: JSON.stringify({ watch_id: WX, trigger_type: "pipeline_paused" }) });
    expect(bad.status).toBe(400);
    expect((await jsonOf(bad)).error.details.fields.trigger_type).toBeDefined();
    const unconfigured = await nextRequest("/api/admin/watch-rules/preview", { method: "POST", headers: { cookie: adminCookie }, body: JSON.stringify({ watch_id: WX, trigger_type: "rag_downgrade", channel: "webhook" }) });
    expect(unconfigured.status).toBe(400);
  });
});
