// @version 1.0.0
/**
 * Migration 0185 (ADR-0190, design 2026-10-29-scheduled-jobs-design section 13.3 / section 10 D9, scheduler phase P3
 * row 1): notification delivery schema - the notification rebuild (trigger 'test', title, source_ref), app_user.email,
 * the four new tables (notification_delivery, notification_recipient_policy, user_notification_pref,
 * notify_webhook_target) and the D9 policy seed. Everything runs against a scratch SQLite under the OS temp dir -
 * never the dev (7748) or prod (7749) DB.
 */
import { test, expect, describe, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = mkdtempSync(join(tmpdir(), "migration-0185-"));
const TEST_DB_PATH = join(TMP, "migration-0185.sqlite");
process.env.CO_NEWBIZ_LLM_PROVIDER = "none";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations, splitSqlStatements } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);
// notification.project_id carries a declared FK (0141 shape), so FK-backed inserts need a real project row.
db.run("INSERT INTO md_project (id, project_no, created_at, current_stage_gate, origin, track, status) VALUES ('p1','P-1','2026-10-01T00:00:00Z','fs','internal','greenfield','open')");

afterAll(() => {
  resetDb();
  rmSync(TMP, { recursive: true, force: true });
});

const MIGRATION_FILE = join(import.meta.dirname, "..", "..", "db", "migrations", "0185_notification_delivery.sql");

const addUser = (id: string, userId: string, email: string | null = null) =>
  db.run(
    "INSERT INTO app_user (id, user_id, role, status, password_salt, password_hash, password_iterations, created_at, email) VALUES (?,?,?,?,?,?,?,?,?)",
    [id, userId, "analyst", "active", "s", "h", 1, "2026-10-01T00:00:00.000Z", email],
  );
const addNotification = (id: string, userId = "u1", trigger = "kill_criteria", projectId: string | null = "p1") =>
  db.run(
    "INSERT INTO notification (id, user_id, project_id, trigger_type, severity, payload, channel, bundle, sent_at) VALUES (?,?,?,?,?,?,?,?,?)",
    [id, userId, projectId, trigger, "urgent", "{}", "all", "immediate", "2026-10-31T00:00:00.000Z"],
  );

describe("migration 0185: header and notification rebuild", () => {
  test("carries the reversible metadata header (ADR-0014) and ROLLBACK-SQL block", () => {
    const sql = readFileSync(MIGRATION_FILE, "utf-8");
    expect(sql).toContain("@reversible:");
    expect(sql).toContain("ROLLBACK LIMITS");
    expect(sql).toContain("ROLLBACK-SQL-BEGIN");
    expect(sql).toContain("ROLLBACK-SQL-END");
    expect(sql).toContain("SQLite >= 3.35");
  });

  test("rebuilt notification keeps the 0141 column set and gains title/source_ref", () => {
    const cols = (db.query("PRAGMA table_info(notification)").all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols).toEqual(["id", "user_id", "project_id", "trigger_type", "severity", "payload", "channel", "bundle", "sent_at", "read_at", "dedupe_key", "title", "source_ref"]);
    const idx = (db.query("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'notification'").all() as Array<{ name: string }>).map((i) => i.name);
    expect(idx).toEqual(expect.arrayContaining(["idx_notification_cooldown", "idx_notification_user", "idx_notification_user_unread", "idx_notification_dedupe"]));
  });

  test("accepts trigger_type 'test' with title/source_ref and a NULL project_id (system row)", () => {
    db.run(
      "INSERT INTO notification (id, user_id, project_id, trigger_type, severity, payload, channel, bundle, sent_at, title, source_ref) VALUES ('n-test','system',NULL,'test','info','{}','in_app','immediate','2026-10-31T00:00:00.000Z','Test send','job_run:01ABC')",
    );
    const row = db.query("SELECT title, source_ref, project_id FROM notification WHERE id = 'n-test'").get() as any;
    expect(row).toEqual({ title: "Test send", source_ref: "job_run:01ABC", project_id: null });
  });

  test("still rejects unknown trigger values and unknown severities", () => {
    expect(() => addNotification("n-bad-trigger", "u1", "phase_of_the_moon")).toThrow();
    expect(() =>
      db.run("INSERT INTO notification (id, user_id, trigger_type, severity, payload, channel, bundle, sent_at) VALUES ('n-bad-sev','u1','kill_criteria','critical','{}','in_app','immediate','t')"),
    ).toThrow();
  });

  test("keeps the dedupe partial unique index: same (user, dedupe_key) collides, NULL dedupe_key never does", () => {
    addNotification("n-d1", "du", "rag_upgrade");
    addNotification("n-d2", "du", "rag_upgrade");
    db.run("UPDATE notification SET dedupe_key = 'k1' WHERE id = 'n-d1'");
    expect(() => db.run("UPDATE notification SET dedupe_key = 'k1' WHERE id = 'n-d2'")).toThrow(); // same (user, dedupe_key)
    db.run("UPDATE notification SET dedupe_key = 'k1' WHERE id = 'n-d1'"); // its own value: no-op write, no collision
    addNotification("n-d3", "du", "rag_upgrade");
    addNotification("n-d4", "du", "rag_upgrade");
    // both stay NULL dedupe_key: NULLs are distinct, no collision
    expect(db.query("SELECT COUNT(*) AS c FROM notification WHERE id IN ('n-d3','n-d4')").get()).toEqual({ c: 2 });
    // a real second write with the same non-null key is rejected
    db.run("UPDATE notification SET dedupe_key = 'k2' WHERE id = 'n-d3'");
    expect(() => db.run("UPDATE notification SET dedupe_key = 'k2' WHERE id = 'n-d4'")).toThrow();
  });
});

describe("migration 0185: app_user.email (D-3)", () => {
  test("two users with NULL email are fine (partial unique index ignores NULLs)", () => {
    addUser("au-null-1", "null-1");
    addUser("au-null-2", "null-2");
    expect((db.query("SELECT COUNT(*) AS c FROM app_user WHERE email IS NULL AND user_id LIKE 'null-%'").get() as any).c).toBe(2);
  });

  test("duplicate non-null emails are rejected; the address can be cleared back to NULL", () => {
    addUser("au-e1", "e1", "jane@example.com");
    expect(() => addUser("au-e2", "e2", "jane@example.com")).toThrow();
    addUser("au-e3", "e3", null);
    // reusing the freed address is allowed once the first user's email is cleared
    db.run("UPDATE app_user SET email = NULL WHERE id = 'au-e1'");
    db.run("UPDATE app_user SET email = 'jane@example.com' WHERE id = 'au-e3'");
    expect((db.query("SELECT email FROM app_user WHERE id = 'au-e3'").get() as any).email).toBe("jane@example.com");
  });
});

describe("migration 0185: notification_delivery", () => {
  test("enforces the notification FK", () => {
    expect(() =>
      db.run("INSERT INTO notification_delivery (id, notification_id, channel, status, created_at) VALUES ('dl-fk','no-such-notification','email','pending','2026-10-31T00:00:00.000Z')"),
    ).toThrow();
  });

  test("re-expansion is idempotent via the COALESCE expression unique index (channel-level webhook row)", () => {
    addNotification("n-w");
    const ins = "INSERT INTO notification_delivery (id, notification_id, recipient_user_id, channel, target_key, status, created_at) VALUES (?,?,?, 'webhook', ?, 'pending', '2026-10-31T00:00:00.000Z')";
    db.run(ins, ["dl-w1", "n-w", null, null]);
    // same (notification, NULL user, channel, NULL target) again: plain INSERT collides, OR IGNORE is a no-op
    expect(() => db.run(ins, ["dl-w2", "n-w", null, null])).toThrow();
    db.run("INSERT OR IGNORE INTO notification_delivery (id, notification_id, recipient_user_id, channel, target_key, status, created_at) VALUES ('dl-w2','n-w',NULL,'webhook',NULL,'pending','2026-10-31T00:00:00.000Z')");
    expect((db.query("SELECT COUNT(*) AS c FROM notification_delivery WHERE notification_id = 'n-w'").get() as any).c).toBe(1);
    // distinct target_keys both land
    db.run(ins, ["dl-w3", "n-w", null, "deals"]);
    db.run(ins, ["dl-w4", "n-w", null, "ops"]);
    expect((db.query("SELECT COUNT(*) AS c FROM notification_delivery WHERE notification_id = 'n-w'").get() as any).c).toBe(3);
  });

  test("per-user email rows are unique per (notification, user, channel); different users coexist", () => {
    addNotification("n-e");
    const ins = (id: string, user: string) =>
      db.run("INSERT INTO notification_delivery (id, notification_id, recipient_user_id, recipient_address_masked, channel, status, created_at) VALUES (?,?,?,?,'email','pending','2026-10-31T00:00:00.000Z')", [id, "n-e", user, "j***@example.com"]);
    ins("dl-e1", "u1");
    ins("dl-e2", "u2");
    expect(() => ins("dl-e3", "u1")).toThrow();
    expect((db.query("SELECT COUNT(*) AS c FROM notification_delivery WHERE notification_id = 'n-e'").get() as any).c).toBe(2);
  });

  test("defaults, CHECK constraints and scrubbed last_error column exist as designed", () => {
    // status has no default on purpose - every expansion insert states it explicitly
    db.run("INSERT INTO notification_delivery (id, notification_id, channel, status, created_at) VALUES ('dl-d1','n-w','email','pending','2026-10-31T00:00:00.000Z')");
    const row = db.query("SELECT status, attempt, is_test, last_error, sent_at FROM notification_delivery WHERE id = 'dl-d1'").get() as any;
    expect(row).toEqual({ status: "pending", attempt: 0, is_test: 0, last_error: null, sent_at: null });
    db.run("UPDATE notification_delivery SET status = 'retry', next_attempt_at = '2026-10-31T00:05:00.000Z', last_error = 'upstream 500 [REDACTED]' WHERE id = 'dl-d1'");
    expect(() => db.run("UPDATE notification_delivery SET channel = 'sms' WHERE id = 'dl-d1'")).toThrow();
    expect(() => db.run("UPDATE notification_delivery SET status = 'queued' WHERE id = 'dl-d1'")).toThrow();
    expect(() => db.run("UPDATE notification_delivery SET is_test = 2 WHERE id = 'dl-d1'")).toThrow();
    expect(() => db.run("UPDATE notification_delivery SET target_key = 'deals' WHERE id = 'dl-d1'")).not.toThrow(); // target_key is nullable-for-email but accepts any TEXT; channel semantics enforced in code
  });
});

describe("migration 0185: D9 policy seed", () => {
  const rows = () => db.query("SELECT * FROM notification_recipient_policy ORDER BY id").all() as any[];

  test("seeds exactly the D9 set: 3 urgent, 2 warning, 2 opportunity, 2 info, 1 ops; all trigger NULL", () => {
    expect(rows().length).toBe(10);
    expect(Object.fromEntries(["urgent", "warning", "opportunity", "info", "ops"].map((s) => [s, rows().filter((r) => r.severity === s).length]))).toEqual({ urgent: 3, warning: 2, opportunity: 2, info: 2, ops: 1 });
    expect(rows().every((r) => r.trigger_type === null)).toBe(true);
    expect(rows().every((r) => r.enabled === 1)).toBe(true);
  });

  test("urgent goes to owner + role:analyst + admins, all immediate with in_app+email+webhook", () => {
    const urgent = rows().filter((r) => r.severity === "urgent");
    expect(urgent.map((r) => r.audience).sort()).toEqual(["admins", "owner", "role:analyst"]);
    for (const r of urgent) {
      expect(r.bundle).toBe("immediate");
      expect(JSON.parse(r.channels)).toEqual(["in_app", "email", "webhook"]);
    }
  });

  test("warning/opportunity/info are owner in_app immediate + owner email daily; ops is admins in_app+webhook immediate", () => {
    for (const sev of ["warning", "opportunity", "info"]) {
      const pair = rows().filter((r) => r.severity === sev);
      const imm = pair.find((r) => r.bundle === "immediate");
      const daily = pair.find((r) => r.bundle === "daily");
      expect(imm).toMatchObject({ audience: "owner" });
      expect(JSON.parse(imm.channels)).toEqual(["in_app"]);
      expect(daily).toMatchObject({ audience: "owner" });
      expect(JSON.parse(daily.channels)).toEqual(["email"]);
    }
    const ops = rows().find((r) => r.severity === "ops");
    expect(ops).toMatchObject({ audience: "admins", bundle: "immediate" });
    expect(JSON.parse(ops.channels)).toEqual(["in_app", "webhook"]);
  });

  test("the seed is idempotent: re-running the seed statements from the file changes nothing", () => {
    const sql = readFileSync(MIGRATION_FILE, "utf-8");
    const seeds = splitSqlStatements(sql).filter((s) => s.includes("INSERT OR IGNORE INTO notification_recipient_policy"));
    expect(seeds.length).toBe(1);
    for (const s of seeds) db.run(s);
    expect(rows().length).toBe(10);
  });
});

describe("migration 0185: user_notification_pref and notify_webhook_target", () => {
  test("pref PK is (user_id, channel, severity); 'urgent' rows are storable (D12 enforcement is code-layer)", () => {
    db.run("INSERT INTO user_notification_pref (user_id, channel, severity, opt_in) VALUES ('pu','email','warning',0)");
    expect(() => db.run("INSERT INTO user_notification_pref (user_id, channel, severity, opt_in) VALUES ('pu','email','warning',1)")).toThrow();
    db.run("INSERT INTO user_notification_pref (user_id, channel, severity, opt_in) VALUES ('pu','email','urgent',0)"); // allowed here; code ignores urgent opt-outs
    db.run("INSERT INTO user_notification_pref (user_id, channel, severity, opt_in) VALUES ('pu','webhook','warning',1)");
    expect((db.query("SELECT COUNT(*) AS c FROM user_notification_pref WHERE user_id = 'pu'").get() as any).c).toBe(3);
    expect(() => db.run("INSERT INTO user_notification_pref (user_id, channel, severity, opt_in) VALUES ('pu','in_app','warning',1)")).toThrow(); // in-app is not opt-outable
    expect(() => db.run("INSERT INTO user_notification_pref (user_id, channel, severity, opt_in) VALUES ('pu','email','critical',1)")).toThrow();
  });

  test("webhook target is keyed by channel_key, stores the env-var name and a slack|teams format", () => {
    db.run("INSERT INTO notify_webhook_target (channel_key, env_var, format, enabled) VALUES ('deals','NOTIFY_WEBHOOK_URL_DEALS','slack',1)");
    expect(() => db.run("INSERT INTO notify_webhook_target (channel_key, env_var, format, enabled) VALUES ('deals','NOTIFY_WEBHOOK_URL_DEALS2','teams',0)")).toThrow();
    expect(() => db.run("INSERT INTO notify_webhook_target (channel_key, env_var, format, enabled) VALUES (NULL,'X','slack',1)")).toThrow();
    expect(() => db.run("INSERT INTO notify_webhook_target (channel_key, env_var, format, enabled) VALUES ('ops',NULL,'slack',1)")).toThrow();
    expect(() => db.run("INSERT INTO notify_webhook_target (channel_key, env_var, format, enabled) VALUES ('ops','NOTIFY_WEBHOOK_URL_OPS','discord',1)")).toThrow();
    db.run("INSERT INTO notify_webhook_target (channel_key, env_var, format) VALUES ('ops','NOTIFY_WEBHOOK_URL_OPS','teams')");
    const row = db.query("SELECT env_var, format, enabled FROM notify_webhook_target WHERE channel_key = 'ops'").get() as any;
    expect(row).toEqual({ env_var: "NOTIFY_WEBHOOK_URL_OPS", format: "teams", enabled: 1 });
  });
});
