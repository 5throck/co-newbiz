// @version 1.0.0
/**
 * GET /api/admin/schedule-jobs and PATCH /api/admin/schedule-jobs/[jobKey] — the pulled-forward
 * admin list-and-edit screen's API (design 2026-10-29-scheduled-jobs-design §4.1/§4.3, §9):
 * GET rows carry the migration-0183 fields, next_run_at (shared parser; null when disabled) and
 * last_run; PATCH is the canonical partial update with server-side cron validation, the 5-minute
 * interval floor (except watch.evaluate / notify.deliver per §13.2), range checks, and an
 * append-only schedule_job_update audit row with before→after values (ADR-0012). The legacy PUT
 * toggle stays byte-compatible for the current UI caller.
 *
 * Covered against the real Route Handlers via nextRequest() on a scratch SQLite (never the dev
 * 7748 or prod 7749 DB), admin-only with 403 for analyst/viewer.
 */
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-schedule-jobs-api.sqlite");
process.env.CO_NEWBIZ_LLM_PROVIDER = "none";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;

for (const suffix of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + suffix)) rmSync(TEST_DB_PATH + suffix);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { createUser, approveUser } = await import("../../db/lib/accounts.ts");
const { nextRequest } = await import("./helpers/next-route-dispatch.ts");

const NOW = new Date().toISOString();

function addJob(
  key: string,
  cronExpr: string,
  enabled: number,
  extra: Partial<{ display_name: string; description: string; timeout_sec: number; max_retries: number }> = {},
) {
  db.run(
    "INSERT INTO schedule_job (id, job_key, cron_expr, enabled, created_at, display_name, description, timeout_sec, max_retries) VALUES (?,?,?,?,?,?,?,?,?)",
    [
      `sj-${key}`,
      key,
      cronExpr,
      enabled,
      "2026-10-29T00:00:00Z",
      extra.display_name ?? null,
      extra.description ?? null,
      extra.timeout_sec ?? 600,
      extra.max_retries ?? 0,
    ],
  );
}

async function loginCookie(userId: string, password: string): Promise<string> {
  const res = await nextRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ userId, password }) });
  expect(res.status).toBe(200);
  return (res.headers.getSetCookie()[0] ?? "").split(";")[0];
}

let adminCookie: string;
let analystCookie: string;
let viewerCookie: string;

beforeAll(async () => {
  addJob("notify.deliver", "* * * * *", 1, {
    display_name: "Notification dispatch",
    description: "Delivery worker",
    timeout_sec: 50,
    max_retries: 3,
  });
  addJob("watch.evaluate", "*/30 * * * *", 1, { display_name: "Watch evaluation", timeout_sec: 300, max_retries: 0 });
  addJob("gate_integrity.shadow_report", "0 8 * * 1", 0, { display_name: "Gate integrity weekly report" });
  addJob("notify.digest", "30 8 * * *", 1, { display_name: "Notification daily digest" });
  addJob("report.weekly", "0 8 * * 1", 1); // known weekly cron for the next_run_at assertion (Mon 08:00 KST = Sun 23:00Z)
  // job_run history: watch.evaluate's latest run finished (duration 90 s); notify.deliver's latest
  // run is still running (finished_at NULL -> duration_ms null). Insert order matters: MAX(id) wins.
  db.run(
    "INSERT INTO job_run (id, job_key, started_at, finished_at, status, env, trigger, attempt) VALUES ('jr-1','watch.evaluate','2026-10-31T00:00:00.000Z','2026-10-31T00:01:30.000Z','success','dev','schedule',1)",
  );
  db.run(
    "INSERT INTO job_run (id, job_key, started_at, status, env, trigger, attempt) VALUES ('jr-2','notify.deliver','2026-10-31T00:05:00.000Z','running','dev','schedule',1)",
  );
  const seed: [string, "admin" | "analyst" | "viewer", string][] = [
    ["sjadmin", "admin", "pw-sjadmin-123"],
    ["sjanalyst", "analyst", "pw-sjanalyst-1"],
    ["sjviewer", "viewer", "pw-sjviewer-1"],
  ];
  for (const [userId, role, password] of seed) {
    await createUser(db, { userId, role, password, createdBy: "test", now: NOW });
    approveUser(db, { userId, approvedBy: "test", now: NOW });
  }
  db.run("UPDATE app_user SET must_change_password = 0");
  adminCookie = await loginCookie("sjadmin", "pw-sjadmin-123");
  analystCookie = await loginCookie("sjanalyst", "pw-sjanalyst-1");
  viewerCookie = await loginCookie("sjviewer", "pw-sjviewer-1");
});

afterAll(() => {
  resetDb();
  for (const suffix of ["", "-wal", "-shm"]) rmSync(TEST_DB_PATH + suffix, { force: true });
});

const LIST_PATH = "/api/admin/schedule-jobs";
const jobPath = (key: string) => `${LIST_PATH}/${encodeURIComponent(key)}`;
const updateAuditRows = () =>
  db.query("SELECT * FROM audit_log WHERE action = 'schedule_job_update' ORDER BY created_at, id").all() as any[];

const EXPECTED_ROW_KEYS = [
  "id",
  "job_key",
  "cron_expr",
  "enabled",
  "created_at",
  "display_name",
  "description",
  "timeout_sec",
  "max_retries",
  "updated_at",
  "updated_by",
  "next_run_at",
  "last_run",
].sort();

describe("GET /api/admin/schedule-jobs — access control", () => {
  test("unauthenticated request is 401", async () => {
    const res = await nextRequest(LIST_PATH);
    expect(res.status).toBe(401);
  });

  test("analyst and viewer are 403 admin_required", async () => {
    for (const cookie of [analystCookie, viewerCookie]) {
      const res = await nextRequest(LIST_PATH, { headers: { cookie } });
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe("admin_required");
    }
  });
});

describe("GET /api/admin/schedule-jobs — row shape (§4.3)", () => {
  let rows: any[];

  beforeAll(async () => {
    const res = await nextRequest(LIST_PATH, { headers: { cookie: adminCookie } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.error).toBeNull();
    rows = json.data as any[];
  });

  test("every row carries the full field set (registry fields + computed, no human cron string)", () => {
    expect(rows.length).toBe(5);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(EXPECTED_ROW_KEYS);
      expect("human_cron" in row).toBe(false); // the frontend humanizes with cronstrue per locale
      expect(typeof row.timeout_sec).toBe("number");
      expect(typeof row.max_retries).toBe("number");
    }
  });

  test("registry fields from migration 0183 are returned", () => {
    const deliver = rows.find((r) => r.job_key === "notify.deliver")!;
    expect(deliver.display_name).toBe("Notification dispatch");
    expect(deliver.description).toBe("Delivery worker");
    expect(deliver.timeout_sec).toBe(50);
    expect(deliver.max_retries).toBe(3);
    expect(deliver.updated_at).toBeNull(); // never PATCHed yet
    expect(deliver.updated_by).toBeNull();
  });

  test("next_run_at is computed by the shared parser and null for disabled jobs", () => {
    // report.weekly: Mon 08:00 KST = Sun 23:00 UTC.
    const weekly = rows.find((r) => r.job_key === "report.weekly")!;
    expect(weekly.next_run_at).toBeTruthy();
    const d = new Date(weekly.next_run_at);
    expect(d.getUTCDay()).toBe(0); // Sunday UTC
    expect(d.getUTCHours()).toBe(23);
    expect(d.getUTCMinutes()).toBe(0);
    expect(d.getTime()).toBeGreaterThan(Date.now());
    // notify.digest: daily 08:30 KST = 23:30 UTC.
    const digest = new Date(rows.find((r) => r.job_key === "notify.digest")!.next_run_at);
    expect(digest.getUTCHours()).toBe(23);
    expect(digest.getUTCMinutes()).toBe(30);
    // disabled job -> null (gate_integrity.shadow_report is seeded enabled=0)
    expect(rows.find((r) => r.job_key === "gate_integrity.shadow_report")!.next_run_at).toBeNull();
  });

  test("last_run is {started_at, status, duration_ms} from the latest job_run, null when never run", () => {
    const watch = rows.find((r) => r.job_key === "watch.evaluate")!;
    expect(watch.last_run).toEqual({ started_at: "2026-10-31T00:00:00.000Z", status: "success", duration_ms: 90_000 });
    const deliver = rows.find((r) => r.job_key === "notify.deliver")!;
    expect(deliver.last_run).toEqual({ started_at: "2026-10-31T00:05:00.000Z", status: "running", duration_ms: null });
    expect(rows.find((r) => r.job_key === "notify.digest")!.last_run).toBeNull();
    expect(rows.find((r) => r.job_key === "gate_integrity.shadow_report")!.last_run).toBeNull();
  });
});

describe("PATCH /api/admin/schedule-jobs/[jobKey] — access control and lookup", () => {
  test("unauthenticated request is 401", async () => {
    const res = await nextRequest(jobPath("notify.digest"), {
      method: "PATCH",
      body: JSON.stringify({ enabled: false }),
    });
    expect(res.status).toBe(401);
  });

  test("analyst and viewer are 403 admin_required", async () => {
    for (const cookie of [analystCookie, viewerCookie]) {
      const res = await nextRequest(jobPath("notify.digest"), {
        method: "PATCH",
        headers: { cookie },
        body: JSON.stringify({ enabled: false }),
      });
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe("admin_required");
    }
  });

  test("unknown job_key is 404", async () => {
    const res = await nextRequest(jobPath("no.such.job"), {
      method: "PATCH",
      headers: { cookie: adminCookie },
      body: JSON.stringify({ enabled: true }),
    });
    expect(res.status).toBe(404);
  });
});

describe("PATCH — request validation (all server-side, §4.1)", () => {
  const patch = (body: unknown, key = "notify.digest") =>
    nextRequest(jobPath(key), { method: "PATCH", headers: { cookie: adminCookie }, body: JSON.stringify(body) });

  test("body must be a JSON object with at least one known field", async () => {
    const empty = await patch({});
    expect(empty.status).toBe(400);
    expect((await empty.json()).error.code).toBe("invalid_request");
    const array = await nextRequest(jobPath("notify.digest"), {
      method: "PATCH",
      headers: { cookie: adminCookie },
      body: "[]",
    });
    expect(array.status).toBe(400);
  });

  test("unknown fields are rejected", async () => {
    const res = await patch({ bogus: 1 });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe("invalid_request");
    expect(json.error.message).toContain("bogus");
  });

  test("invalid cron is rejected with the shared parser's error", async () => {
    const res = await patch({ cron_expr: "60 * * * *" });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe("invalid_cron");
    expect(json.error.message).toContain("minute value out of range 0-59");
  });

  test("interval floor: sub-5-minute crons are rejected for normal jobs", async () => {
    for (const expr of ["*/2 * * * *", "* * * * *"]) {
      const res = await patch({ cron_expr: expr });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("cron_too_frequent");
      expect(json.error.message).toContain("at least 5 minutes");
    }
    // the stored row is untouched by the rejections
    expect(
      (db.query("SELECT cron_expr FROM schedule_job WHERE job_key = 'notify.digest'").get() as any).cron_expr,
    ).toBe("30 8 * * *");
  });

  test("interval floor exemptions: notify.deliver may stay every-minute; watch.evaluate may take */30 (§13.2)", async () => {
    const deliver = await patch({ cron_expr: "* * * * *" }, "notify.deliver");
    expect(deliver.status).toBe(200);
    const watch = await patch({ cron_expr: "*/30 * * * *" }, "watch.evaluate");
    expect(watch.status).toBe(200);
  });

  test("timeout_sec must be an integer in 60..7200", async () => {
    for (const v of [59, 7201, 90.5, "600", null]) {
      const res = await patch({ timeout_sec: v });
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe("invalid_request");
    }
  });

  test("max_retries must be an integer in 0..5", async () => {
    for (const v of [-1, 6, 1.5, "2"]) {
      const res = await patch({ max_retries: v });
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe("invalid_request");
    }
  });
});

describe("PATCH — happy path, response row, audit (ADR-0012)", () => {
  test("persists values, sets updated_at/updated_by, responds with the full GET-shaped row", async () => {
    const res = await nextRequest(jobPath("watch.evaluate"), {
      method: "PATCH",
      headers: { cookie: adminCookie },
      body: JSON.stringify({ cron_expr: "0 * * * *", timeout_sec: 600, max_retries: 2 }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.error).toBeNull();
    const row = json.data;
    expect(Object.keys(row).sort()).toEqual(EXPECTED_ROW_KEYS); // same shape as GET rows
    expect(row.cron_expr).toBe("0 * * * *");
    expect(row.timeout_sec).toBe(600);
    expect(row.max_retries).toBe(2);
    expect(row.updated_at).toBeTruthy();
    expect(row.updated_by).toBe("sjadmin");
    // next_run_at recomputed for the new cron: hourly at :00 KST -> minute 0, still future
    expect(new Date(row.next_run_at).getUTCMinutes()).toBe(0);
    expect(new Date(row.next_run_at).getTime()).toBeGreaterThan(Date.now());
    expect(row.last_run).toEqual({ started_at: "2026-10-31T00:00:00.000Z", status: "success", duration_ms: 90_000 });

    const stored = db
      .query(
        "SELECT cron_expr, timeout_sec, max_retries, updated_by FROM schedule_job WHERE job_key = 'watch.evaluate'",
      )
      .get() as any;
    expect(stored).toEqual({ cron_expr: "0 * * * *", timeout_sec: 600, max_retries: 2, updated_by: "sjadmin" });
  });

  test("audit row action schedule_job_update with before→after for changed fields only", () => {
    const audits = updateAuditRows();
    const watchAudits = audits.filter((a) => a.target.startsWith("watch.evaluate:"));
    // the exemption test earlier PATCHed watch.evaluate with its unchanged cron; the happy-path
    // row is the LAST watch.evaluate audit
    const target = watchAudits.at(-1)?.target ?? "";
    expect(audits.at(-1)?.actor_user_id).toBe("sjadmin");
    expect(target).toContain("cron */30 * * * *→0 * * * *");
    expect(target).toContain("timeout 300→600");
    expect(target).toContain("retries 0→2");
    expect(target).not.toContain("enabled"); // unchanged field is omitted
    // the earlier same-value PATCH audited the explicit set honestly
    expect(watchAudits[0]?.target).toBe("watch.evaluate: cron */30 * * * *→*/30 * * * *");
  });

  test("enabled change audits before→after; an idempotent re-PATCH audits the explicit set", async () => {
    const res = await nextRequest(jobPath("notify.digest"), {
      method: "PATCH",
      headers: { cookie: adminCookie },
      body: JSON.stringify({ enabled: false }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).data.enabled).toBe(0);
    const noop = await nextRequest(jobPath("notify.digest"), {
      method: "PATCH",
      headers: { cookie: adminCookie },
      body: JSON.stringify({ enabled: false }),
    });
    expect(noop.status).toBe(200);
    const targets = updateAuditRows()
      .filter((a) => a.target.startsWith("notify.digest:"))
      .map((a) => a.target);
    expect(targets).toContain("notify.digest: enabled 1→0");
    expect(targets).toContain("notify.digest: enabled 0→0"); // before→after is truthful even when equal
  });
});

describe("PUT toggle — legacy contract kept byte-compatible for the current UI caller", () => {
  test("PUT {enabled} still toggles and audits schedule_job_toggle with the legacy target", async () => {
    const res = await nextRequest(jobPath("notify.digest"), {
      method: "PUT",
      headers: { cookie: adminCookie },
      body: JSON.stringify({ enabled: true }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual({ ok: true, job_key: "notify.digest", enabled: true });
    expect((db.query("SELECT enabled FROM schedule_job WHERE job_key = 'notify.digest'").get() as any).enabled).toBe(1);
    const toggles = db
      .query("SELECT * FROM audit_log WHERE action = 'schedule_job_toggle' ORDER BY created_at, id")
      .all() as any[];
    expect(toggles.at(-1)?.target).toBe("notify.digest:enabled=1");
    expect(toggles.at(-1)?.actor_user_id).toBe("sjadmin");
  });

  test("PUT without a boolean enabled is 400; analyst is 403; unknown key 404", async () => {
    const bad = await nextRequest(jobPath("notify.digest"), {
      method: "PUT",
      headers: { cookie: adminCookie },
      body: JSON.stringify({ cron_expr: "0 * * * *" }),
    });
    expect(bad.status).toBe(400);
    const forbiddenRes = await nextRequest(jobPath("notify.digest"), {
      method: "PUT",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ enabled: true }),
    });
    expect(forbiddenRes.status).toBe(403);
    const missing = await nextRequest(jobPath("no.such.job"), {
      method: "PUT",
      headers: { cookie: adminCookie },
      body: JSON.stringify({ enabled: true }),
    });
    expect(missing.status).toBe(404);
  });
});
