// @version 1.0.0
/**
 * Retention allowlist: the server rejects policies on non-eligible tables/columns/actions,
 * the overview/preview endpoints are admin-only and return aggregates only, the preview
 * count is correct, and policy CRUD writes audit rows. Uses a temp DB only.
 */
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-admin-retention-registry.sqlite");
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);
const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const reg = await import("../../db/lib/retention-registry.ts");

const NOW = new Date().toISOString();
const req = (path: string, init?: RequestInit) => nextRequest(path, init);

/** Minimal structural types for the API envelope responses these tests inspect. */
interface ApiErrorBody {
  error: { code: string };
}
interface RetentionPolicyRow {
  table_key: string;
  action: string;
  retention_months: number;
}
interface ApiListBody {
  data: RetentionPolicyRow[];
}
interface OverviewBody {
  tables: Array<{
    table: string;
    row_count: number;
    date_columns: Array<{ oldest: string; newest: string }>;
    policy: unknown;
  }>;
  migrations: { applied_count: number; latest: { filename: string } };
}
async function loginCookie(userId: string, password: string) {
  const res = await req("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}
let admin = "";
let analyst = "";

beforeAll(async () => {
  for (const [u, role, pw] of [
    ["root", "admin", "pw-root-12345"],
    ["alice", "analyst", "pw-alice-12345"],
  ] as const) {
    await createUser(db, { userId: u, role, password: pw, createdBy: "test", now: NOW });
    approveUser(db, { userId: u, approvedBy: "test", now: NOW });
  }
  db.run("UPDATE app_user SET must_change_password = 0");
  admin = await loginCookie("root", "pw-root-12345");
  analyst = await loginCookie("alice", "pw-alice-12345");
});

afterAll(() => {
  resetDb();
  for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
});

const post = (body: unknown, cookie = admin) =>
  req("/api/admin/retention", { method: "POST", headers: { cookie }, body: JSON.stringify(body) });

describe("registry", () => {
  test("every eligible table and date column exists in the migrated schema; none is excluded", () => {
    for (const t of reg.RETENTION_ELIGIBLE_TABLES) {
      expect(reg.RETENTION_EXCLUDED_TABLES[t.table]).toBeUndefined();
      const cols = (db.query(`PRAGMA table_info(${t.table})`).all() as Array<{ name: string }>).map((c) => c.name);
      expect(cols.length).toBeGreaterThan(0);
      for (const c of t.dateColumns) expect(cols).toContain(c.column);
    }
  });
  test("each table has one fixed handling mapped to the stored action", () => {
    const h = Object.fromEntries(reg.RETENTION_ELIGIBLE_TABLES.map((t) => [t.table, t.handling]));
    // dba adjudication 2026-11-02: the eligible set mirrors the executor allow-list
    // table-for-table; dry_run_session moved to the excluded set (read-path purge, migration 0172).
    expect(h).toEqual({
      notification: "archive_then_delete",
      llm_call_log: "archive_then_delete",
      raw_payload: "archive_only",
      job_run: "delete_only",
      execution_job: "delete_only",
      session: "delete_only",
    });
    expect(reg.handlingToStoredAction("archive_then_delete")).toBe("delete");
    expect(reg.handlingToStoredAction("archive_only")).toBe("archive");
    expect(reg.handlingToStoredAction("delete_only")).toBe("delete");
    // dry_run_session: executor-refused, purged on the read path (migration 0172 TTL)
    expect(reg.RETENTION_EXCLUDED_TABLES.dry_run_session).toContain("read path");
    expect(reg.RETENTION_EXCLUDED_TABLES.job_run).toBeUndefined();
    expect(reg.RETENTION_EXCLUDED_TABLES.session).toBeUndefined();
  });

  test("D2/dba default months and basis are recorded per entry (the seeder's defaults)", () => {
    const d = Object.fromEntries(
      reg.RETENTION_ELIGIBLE_TABLES.map((t) => [t.table, { m: t.defaultMonths, b: t.defaultBasis }]),
    );
    expect(d).toEqual({
      notification: { m: 12, b: "sent_at" },
      llm_call_log: { m: 12, b: "created_at" },
      raw_payload: { m: 24, b: "fetched_at" },
      job_run: { m: 12, b: "started_at" },
      execution_job: { m: 6, b: "created_at" },
      session: { m: 1, b: "expires_at" }, // dba ruling 2026-11-02
    });
  });
  test("excluded tables are rejected", () => {
    for (const t of Object.keys(reg.RETENTION_EXCLUDED_TABLES)) {
      const v = reg.validateRetentionPolicy(t, "created_at", "delete");
      expect(v.ok).toBe(false);
    }
  });
});

describe("policy API allowlist", () => {
  for (const table of ["audit_log", "gate_decision", "dry_run_session", "project_policy_pin", "no_such_table"]) {
    test(`rejects ${table} with 400 table_not_eligible`, async () => {
      const res = await post({ table_key: table, basis: "created_at", retention_months: 6, action: "delete" });
      expect(res.status).toBe(400);
      expect(((await res.json()) as ApiErrorBody).error.code).toBe("table_not_eligible");
    });
  }
  test("rejects a non-eligible column", async () => {
    const res = await post({ table_key: "notification", basis: "read_at", retention_months: 6, action: "delete" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as ApiErrorBody).error.code).toBe("column_not_eligible");
  });
  test("POST without action derives it from the registry", async () => {
    expect((await post({ table_key: "raw_payload", basis: "fetched_at", retention_months: 24 })).status).toBe(201);
    expect((await post({ table_key: "notification", basis: "sent_at", retention_months: 24 })).status).toBe(201);
    const list = (await (await req("/api/admin/retention", { headers: { cookie: admin } })).json()) as ApiListBody;
    expect(list.data.find((r) => r.table_key === "raw_payload")?.action).toBe("archive");
    expect(list.data.find((r) => r.table_key === "notification")?.action).toBe("delete");
    db.run("DELETE FROM retention_policy");
  });
  test("POST for the reconciliation-added tables derives the executor-accepted stored action", async () => {
    // job_run / execution_job / session are delete_only -> stored 'delete'; llm_call_log is
    // archive_then_delete -> stored 'delete'. The executor's action_mismatch guard compares against
    // the SAME handlingToStoredAction mapping, so these admin-created rows always pass (the full
    // cross-module proof runs in retention-cleanup.test.ts).
    for (const [table, basis, months] of [
      ["job_run", "started_at", 12],
      ["execution_job", "created_at", 6],
      ["session", "expires_at", 1],
      ["llm_call_log", "created_at", 12],
    ] as const) {
      expect((await post({ table_key: table, basis, retention_months: months })).status).toBe(201);
    }
    const list = (await (await req("/api/admin/retention", { headers: { cookie: admin } })).json()) as ApiListBody;
    for (const table of ["job_run", "execution_job", "session", "llm_call_log"]) {
      expect(list.data.find((r) => r.table_key === table)?.action).toBe("delete");
    }
    db.run("DELETE FROM retention_policy");
  });
  test("conflicting action is rejected (archive-only table)", async () => {
    const res = await post({ table_key: "raw_payload", basis: "fetched_at", retention_months: 6, action: "delete" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as ApiErrorBody).error.code).toBe("action_not_allowed");
  });
  test("non-admin cannot write", async () => {
    const res = await post(
      { table_key: "notification", basis: "sent_at", retention_months: 6, action: "delete" },
      analyst,
    );
    expect(res.status).toBe(403);
  });
});

describe("overview and preview", () => {
  test("admin-only", async () => {
    expect((await req("/api/admin/database/overview", { headers: { cookie: analyst } })).status).toBe(403);
    expect(
      (
        await req("/api/admin/retention/preview?table=notification&column=sent_at&months=1", {
          headers: { cookie: analyst },
        })
      ).status,
    ).toBe(403);
    expect((await req("/api/admin/database/overview")).status).toBe(401);
  });

  test("overview returns aggregates and no row data; preview count is correct", async () => {
    db.run("PRAGMA foreign_keys = OFF"); // fixture rows only need the notification table
    const ins = (id: string, sentAt: string) =>
      db.run(
        "INSERT INTO notification (id, user_id, project_id, trigger_type, severity, payload, channel, bundle, sent_at) VALUES (?,?,?,?,?,?,?,?,?)",
        [id, "root", "p1", "rag_upgrade", "info", "SECRET-PAYLOAD", "in_app", "immediate", sentAt],
      );
    const old = new Date(Date.now() - 400 * 86400000).toISOString();
    const older = new Date(Date.now() - 800 * 86400000).toISOString();
    ins("n1", older);
    ins("n2", old);
    ins("n3", NOW);

    const res = await req("/api/admin/database/overview", { headers: { cookie: admin } });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("SECRET-PAYLOAD");
    const body = (JSON.parse(text) as { data: OverviewBody }).data;
    const n = body.tables.find((t) => t.table === "notification");
    expect(n?.row_count).toBe(3);
    expect(n?.date_columns[0].oldest).toBe(older);
    expect(n?.date_columns[0].newest).toBe(NOW);
    expect(n?.policy).toBeNull();
    expect(body.migrations.applied_count).toBeGreaterThan(100);
    expect(body.migrations.latest.filename).toMatch(/\.sql$/);

    const p = await req("/api/admin/retention/preview?table=notification&column=sent_at&months=12", {
      headers: { cookie: admin },
    });
    expect(p.status).toBe(200);
    const pt = await p.text();
    expect(pt).not.toContain("SECRET-PAYLOAD");
    expect(JSON.parse(pt).data.affected_count).toBe(2);
    const p2 = await req("/api/admin/retention/preview?table=notification&column=sent_at&months=24", {
      headers: { cookie: admin },
    });
    expect(((await p2.json()) as { data: { affected_count: number } }).data.affected_count).toBe(1);
  });

  test("preview rejects non-eligible table/column and bad months", async () => {
    const h = { headers: { cookie: admin } };
    expect((await req("/api/admin/retention/preview?table=audit_log&column=created_at&months=1", h)).status).toBe(400);
    expect((await req("/api/admin/retention/preview?table=notification&column=payload&months=1", h)).status).toBe(400);
    expect((await req("/api/admin/retention/preview?table=notification&column=sent_at&months=-1", h)).status).toBe(400);
  });
});

describe("policy CRUD with audit", () => {
  test("create, update, delete write audit rows", async () => {
    const audit = (action: string) =>
      (db.query("SELECT COUNT(*) AS n FROM audit_log WHERE action = ?").get(action) as { n: number }).n;
    const before = audit("retention_policy_set");
    expect((await post({ table_key: "llm_call_log", basis: "created_at", retention_months: 12 })).status).toBe(201);
    expect((await post({ table_key: "llm_call_log", basis: "created_at", retention_months: 6 })).status).toBe(201);
    expect(audit("retention_policy_set") - before).toBe(2);
    const list = (await (await req("/api/admin/retention", { headers: { cookie: admin } })).json()) as ApiListBody;
    expect(list.data.find((r) => r.table_key === "llm_call_log")?.retention_months).toBe(6);

    expect(
      (await req("/api/admin/retention/llm_call_log", { method: "DELETE", headers: { cookie: analyst } })).status,
    ).toBe(403);
    expect(
      (await req("/api/admin/retention/llm_call_log", { method: "DELETE", headers: { cookie: admin } })).status,
    ).toBe(200);
    expect(audit("retention_policy_delete")).toBe(1);
    expect(
      (await req("/api/admin/retention/llm_call_log", { method: "DELETE", headers: { cookie: admin } })).status,
    ).toBe(404);
  });
});
