// @version 1.0.0
/**
 * POST /api/admin/schedule-jobs/seed — ADR-0189 P2 item 2, design
 * 2026-10-29-scheduled-jobs-design §4.1 (seed row, action `schedule_job_seed`) and §9
 * ("API: admin-only (403 for analyst/viewer), audit row per mutation").
 *
 * Covered against the real Route Handler via nextRequest() on a scratch SQLite (never the
 * dev 7748 or prod 7749 DB): admin-only guard, dry-run writes nothing, the real call inserts
 * DISABLED rows idempotently (D3: existing rows — including admin-edited crons — are never
 * touched), and every mutating call writes one `schedule_job_seed` audit row.
 */
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-schedule-seed-endpoint.sqlite");
process.env.CO_NEWBIZ_LLM_PROVIDER = "none";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;
// The endpoint resolves the scheduler env from the process environment (design §2.3 — never from
// the request body). Set in beforeAll and removed in afterAll: scheduler-p1.test.ts asserts
// resolveSchedulerEnv's unset-environment refusal in the same bun test process, so this must not leak.

for (const suffix of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + suffix)) rmSync(TEST_DB_PATH + suffix);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { nextRequest } = await import("./helpers/next-route-dispatch.ts");
const { listJobHandlers } = await import("../../scripts/co-newbiz/jobs/index.ts");
const reg = await import("../../db/lib/retention-registry.ts");

const PATH = "/api/admin/schedule-jobs/seed";
const NOW = new Date().toISOString();
const registeredKeys = listJobHandlers().map((h) => h.key);

function req(body?: unknown, init?: RequestInit) {
  return nextRequest(PATH, {
    method: "POST",
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    ...init,
  });
}
async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await nextRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  expect(res.status).toBe(200);
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}
const jobRows = () => db.query("SELECT * FROM schedule_job ORDER BY job_key").all() as any[];
const policyRows = () => db.query("SELECT * FROM retention_policy ORDER BY table_key").all() as any[];
const seedAuditRows = () => db.query("SELECT * FROM audit_log WHERE action = 'schedule_job_seed' ORDER BY created_at, id").all() as any[];

let adminCookie: string;
let analystCookie: string;
let viewerCookie: string;

beforeAll(async () => {
  process.env.CO_NEWBIZ_SCHEDULER_ENV = "dev"; // D3: dev seeds disabled — matches what the endpoint must report
  const seed: [string, "admin" | "analyst" | "viewer", string][] = [
    ["seedadmin", "admin", "pw-seedadm-123"],
    ["seedanalyst", "analyst", "pw-seedana-123"],
    ["seedviewer", "viewer", "pw-seedview-12"],
  ];
  for (const [userId, role, password] of seed) {
    await createUser(db, { userId, role, password, createdBy: "test", now: NOW });
    approveUser(db, { userId, approvedBy: "test", now: NOW });
  }
  db.run("UPDATE app_user SET must_change_password = 0");
  adminCookie = await loginCookie("seedadmin", "pw-seedadm-123");
  analystCookie = await loginCookie("seedanalyst", "pw-seedana-123");
  viewerCookie = await loginCookie("seedviewer", "pw-seedview-12");
});

afterAll(() => {
  delete process.env.CO_NEWBIZ_SCHEDULER_ENV;
  resetDb();
  for (const suffix of ["", "-wal", "-shm"]) rmSync(TEST_DB_PATH + suffix, { force: true });
});

describe("POST /api/admin/schedule-jobs/seed — access control (design §5/§9)", () => {
  test("unauthenticated request is 401", async () => {
    const res = await req({});
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error.code).toBe("unauthorized");
  });

  test("analyst and viewer are 403 admin_required; nothing is written", async () => {
    for (const cookie of [analystCookie, viewerCookie]) {
      const res = await req({}, { headers: { cookie } });
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error.code).toBe("admin_required");
    }
    expect(jobRows().length).toBe(0);
    expect(seedAuditRows().length).toBe(0);
  });
});

describe("POST /api/admin/schedule-jobs/seed — dry run writes nothing", () => {
  test("dryRun: true reports what would be inserted but leaves schedule_job and audit_log empty", async () => {
    const res = await req({ dryRun: true }, { headers: { cookie: adminCookie } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.error).toBeNull();
    expect(json.data.env).toBe("dev");
    expect(json.data.dryRun).toBe(true);
    expect(json.data.inserted.sort()).toEqual([...registeredKeys].sort());
    expect(json.data.existing).toEqual([]);
    // policy seeding (registry reconciliation, 2026-11-02): dry-run reports the full plan, writes nothing
    expect(json.data.policies.inserted.sort()).toEqual([...reg.RETENTION_ELIGIBLE_TABLES.map((t) => t.table)].sort());
    expect(json.data.policies.existing).toEqual([]);
    expect(jobRows().length).toBe(0);
    expect(policyRows().length).toBe(0);
    expect(seedAuditRows().length).toBe(0);
  });

  test("dryRun must be a boolean when provided", async () => {
    const res = await req({ dryRun: "yes" }, { headers: { cookie: adminCookie } });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_request");
  });
});

describe("POST /api/admin/schedule-jobs/seed — mutating path (D3 invariant, audit)", () => {
  test("first call inserts one DISABLED row per registered handler and audits it", async () => {
    const res = await req({}, { headers: { cookie: adminCookie } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.dryRun).toBe(false);
    expect(json.data.inserted.sort()).toEqual([...registeredKeys].sort());
    expect(json.data.existing).toEqual([]);

    const rows = jobRows();
    expect(rows.length).toBe(registeredKeys.length);
    expect(rows.filter((r) => r.enabled !== 0).length).toBe(0); // D3: seeded rows are DISABLED
    const byKey = new Map(rows.map((r) => [r.job_key, r]));
    for (const h of listJobHandlers()) {
      expect(byKey.get(h.key).cron_expr).toBe(h.defaultCron); // default cron from the registry
    }

    // policy seeding: one row per registry-eligible table, registry defaults, derived stored action
    expect(json.data.policies.inserted.sort()).toEqual([...reg.RETENTION_ELIGIBLE_TABLES.map((t) => t.table)].sort());
    const pols = policyRows();
    expect(pols.length).toBe(reg.RETENTION_ELIGIBLE_TABLES.length);
    for (const t of reg.RETENTION_ELIGIBLE_TABLES) {
      const row = pols.find((p) => p.table_key === t.table);
      expect(row.basis).toBe(t.defaultBasis);
      expect(row.retention_months).toBe(t.defaultMonths);
      expect(row.action).toBe(reg.handlingToStoredAction(t.handling));
      expect(row.last_run_at).toBeNull();
    }
    // dba ruling 2026-11-02 spot-checks + the explicit non-seed
    expect(pols.find((p) => p.table_key === "session")).toMatchObject({ basis: "expires_at", retention_months: 1, action: "delete" });
    expect(pols.find((p) => p.table_key === "notification")).toMatchObject({ basis: "sent_at", retention_months: 12, action: "delete" });
    expect(pols.find((p) => p.table_key === "dry_run_session")).toBeUndefined();

    const audits = seedAuditRows();
    expect(audits.length).toBe(1);
    expect(audits[0].actor_user_id).toBe("seedadmin");
    expect(audits[0].target).toContain(`inserted=[${[...registeredKeys].sort().join(",")}]`);
    expect(audits[0].target).toContain("existing_count=0");
    expect(audits[0].target).toContain(`policies_inserted=[${reg.RETENTION_ELIGIBLE_TABLES.map((t) => t.table).join(",")}]`);
    expect(audits[0].target).toContain("policies_existing_count=0");
  });

  test("second call inserts nothing, reports existing, and never overwrites an admin-edited cron or an admin-tuned policy", async () => {
    // Simulate an admin edit the seed must respect (D3: existing rows are never touched).
    const editedKey = registeredKeys[0];
    db.run("UPDATE schedule_job SET cron_expr = '9 9 * * *' WHERE job_key = ?", [editedKey]);
    // ...and an admin-tuned policy (the dev notification row at 6 months) the seed must also respect.
    db.run("UPDATE retention_policy SET retention_months = 6 WHERE table_key = 'notification'");

    const res = await req({}, { headers: { cookie: adminCookie } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.inserted).toEqual([]);
    expect(json.data.existing.sort()).toEqual([...registeredKeys].sort());
    expect(json.data.policies.inserted).toEqual([]);
    expect(json.data.policies.existing.sort()).toEqual([...reg.RETENTION_ELIGIBLE_TABLES.map((t) => t.table)].sort());

    const rows = jobRows();
    expect(rows.length).toBe(registeredKeys.length);
    expect(new Map(rows.map((r) => [r.job_key, r.cron_expr])).get(editedKey)).toBe("9 9 * * *");
    expect(rows.filter((r) => r.enabled !== 0).length).toBe(0); // still disabled after re-seed
    // the admin-tuned 6-month notification policy survives the re-seed untouched
    expect(db.query("SELECT retention_months FROM retention_policy WHERE table_key='notification'").get()).toEqual({ retention_months: 6 });

    // Every mutating call audits, including a no-op re-seed.
    const audits = seedAuditRows();
    expect(audits.length).toBe(2);
    expect(audits[1].actor_user_id).toBe("seedadmin");
    expect(audits[1].target).toContain("inserted=[]");
    expect(audits[1].target).toContain(`existing_count=${registeredKeys.length}`);
    expect(audits[1].target).toContain("policies_inserted=[]");

    // No in-process job execution (ADR-0019/ADR-0189): seeding is data — the registry import is
    // metadata only, and no handler ever ran, so job_run must stay empty across every seed call.
    expect(db.query("SELECT COUNT(*) AS c FROM job_run").get().c).toBe(0);
  });
});
