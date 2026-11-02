// @version 1.2.0
/**
 * GET/POST /api/admin/schedule-jobs, PATCH /api/admin/schedule-jobs/[jobKey], POST
 * /[jobKey]/run, GET /health and GET /[jobKey]/runs — the admin schedule-jobs API (design
 * 2026-10-29-scheduled-jobs-design §4.1/§4.3, §9; ADR-0189 P7):
 * - GET/PATCH (pulled-forward screen): rows carry the migration-0183 fields, next_run_at (shared
 *   parser; null when disabled) and last_run; PATCH is the canonical partial update with
 *   server-side cron validation, the 5-minute interval floor (except watch.evaluate /
 *   notify.deliver per §13.2), range checks, and an append-only schedule_job_update audit row
 *   with before→after values (ADR-0012). The legacy PUT toggle stays byte-compatible.
 *   v1.2.0 (QA iteration 2, F-3): pins that absent PATCH fields keep their stored value —
 *   notify.deliver's sub-minute §13.2 timeout of 50 s survives a PATCH body without timeout_sec.
 * - POST (P7 create): registered-handler-key guard only (§5 RCE guard, 400 names the key),
 *   registry defaults, PATCH validation reused via lib/schedule/job-validate.ts, enabled
 *   defaults to 0, 409 on duplicates, schedule_job_create audit, GET-shaped 201 row.
 * - POST [jobKey]/run (P7 run-now): enqueues a schedule_job_request (requested_by = admin),
 *   202 with {request_id, reused, note}; a still-queued request is reused, never stacked; works
 *   on disabled jobs; schedule_job_run_requested audit; NO handler import in the route module
 *   (§9 "run-now never executes in-process" — asserted statically below).
 * - GET health (P7): tick heartbeat healthy iff age <= 180 s; overdue = enabled job whose
 *   dispatched fire (last_fire_minute) is older than timeout_sec with no env job_run at/after
 *   it; consecutive_failures = trailing failed/timeout runs (window 3).
 * - GET [jobKey]/runs (P7 extension): 0183 columns (trigger, actor, env, rows_*, attempt),
 *   duration, paging (?page=&limit=), backward-compatible job_key/success_rate/meta.count.
 *
 * Covered against the real Route Handlers via nextRequest() on a scratch SQLite (never the dev
 * 7748 or prod 7749 DB), admin-only with 403 for analyst/viewer.
 */
import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
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
  // GET /health resolves the environment server-side (seed-route pattern); deleted in afterAll
  // so the variable never leaks into another test file running in the same process.
  process.env.CO_NEWBIZ_SCHEDULER_ENV = "dev";
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
  delete process.env.CO_NEWBIZ_SCHEDULER_ENV;
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

  test("partial PATCH: fields absent from the body keep their stored value (notify.deliver §13.2 50 s)", async () => {
    // notify.deliver is seeded with timeout_sec = 50 — BELOW the PATCH floor of 60. The edit
    // dialog (form-unit-dirty, QA iteration 2 F-3) sends no timeout_sec for an untouched
    // timeout input; the row must keep the intentional 50 s instead of snapping to 60.
    const res = await nextRequest(jobPath("notify.deliver"), {
      method: "PATCH",
      headers: { cookie: adminCookie },
      body: JSON.stringify({ max_retries: 3 }), // explicit idempotent set — nothing else in the body
    });
    expect(res.status).toBe(200);
    const row = (await res.json()).data;
    expect(row.timeout_sec).toBe(50); // untouched by the partial PATCH
    expect(row.max_retries).toBe(3);
    const stored = db.query("SELECT timeout_sec FROM schedule_job WHERE job_key = 'notify.deliver'").get() as any;
    expect(stored.timeout_sec).toBe(50); // the stored value stays 50
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

// ── ADR-0189 P7: run-now ─────────────────────────────────────────────────────────────────

const RUN_NOW_AUDITS = () =>
  db
    .query("SELECT * FROM audit_log WHERE action = 'schedule_job_run_requested' ORDER BY created_at, id")
    .all() as any[];

describe("POST /api/admin/schedule-jobs/[jobKey]/run — run-now (P7)", () => {
  test("unauthenticated request is 401; analyst and viewer are 403 admin_required", async () => {
    const res = await nextRequest(`${jobPath("notify.digest")}/run`, { method: "POST" });
    expect(res.status).toBe(401);
    for (const cookie of [analystCookie, viewerCookie]) {
      const forbidden = await nextRequest(`${jobPath("notify.digest")}/run`, { method: "POST", headers: { cookie } });
      expect(forbidden.status).toBe(403);
      expect((await forbidden.json()).error.code).toBe("admin_required");
    }
  });

  test("unknown job_key is 404", async () => {
    const res = await nextRequest(`${jobPath("no.such.job")}/run`, {
      method: "POST",
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(404);
  });

  test("202 run-now enqueues with requested_by = the admin; the audit row carries the job key", async () => {
    const res = await nextRequest(`${jobPath("notify.digest")}/run`, {
      method: "POST",
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(202);
    const json = await res.json();
    expect(json.error).toBeNull();
    const { request_id, job_key, reused, note } = json.data;
    expect(job_key).toBe("notify.digest");
    expect(reused).toBe(false);
    expect(note).toContain("next scheduler tick");
    const row = db.query("SELECT * FROM schedule_job_request WHERE id = ?").get(request_id) as any;
    expect(row).not.toBeNull();
    expect(row.job_key).toBe("notify.digest");
    expect(row.requested_by).toBe("sjadmin");
    expect(row.status).toBe("queued");
    expect(row.job_run_id).toBeNull();
    const audit = RUN_NOW_AUDITS().at(-1);
    expect(audit.actor_user_id).toBe("sjadmin");
    expect(audit.target).toBe("notify.digest");
  });

  test("a second request while one is still queued REUSES the row instead of stacking", async () => {
    const second = await nextRequest(`${jobPath("notify.digest")}/run`, {
      method: "POST",
      headers: { cookie: adminCookie },
    });
    expect(second.status).toBe(202);
    const data = (await second.json()).data;
    expect(data.reused).toBe(true);
    const first = db
      .query("SELECT id FROM schedule_job_request WHERE job_key = 'notify.digest' AND status = 'queued'")
      .all() as any[];
    expect(first.length).toBe(1);
    expect(data.request_id).toBe(first[0].id);
  });

  test("run-now works on a DISABLED job (manual runs are explicit admin actions; the tick dispatches them)", async () => {
    const res = await nextRequest(`${jobPath("gate_integrity.shadow_report")}/run`, {
      method: "POST",
      headers: { cookie: adminCookie },
    });
    expect(res.status).toBe(202);
    expect((await res.json()).data.reused).toBe(false);
    const row = db
      .query("SELECT status FROM schedule_job_request WHERE job_key = 'gate_integrity.shadow_report'")
      .get() as any;
    expect(row.status).toBe("queued");
  });

  test("§9 no-handler-import assertion: the run-now route module imports no jobs/ handler code", () => {
    const source = readFileSync(
      join(PROJECT_ROOT, "app/web-next/app/api/admin/schedule-jobs/[jobKey]/run/route.ts"),
      "utf8",
    );
    const imports = [...source.matchAll(/import\s+[^'"]+from\s+["']([^"']+)["']/g)].map((m) => m[1]);
    expect(imports.length).toBeGreaterThan(0);
    // No jobs/ handler module (registry index included) may appear among the imports: the route
    // must only touch schedule_job_request via scheduler-core's pure enqueueRequest.
    for (const spec of imports) {
      expect(spec).not.toMatch(/jobs\//);
      expect(spec).not.toMatch(/\/jobs(\.ts)?["']$/);
    }
    expect(imports).toContain("../../../../../../../../scripts/co-newbiz/scheduler-core.ts");
  });
});

// ── ADR-0189 P7: health ──────────────────────────────────────────────────────────────────

describe("GET /api/admin/schedule-jobs/health — P7", () => {
  const tenMinAgo = () => new Date(Date.now() - 10 * 60_000).toISOString();

  beforeAll(() => {
    // Fresh heartbeat → healthy tick (overwritten by the stale test below, then restored).
    db.run(
      "INSERT INTO schedule_heartbeat (env, last_tick_at) VALUES ('dev', ?) ON CONFLICT(env) DO UPDATE SET last_tick_at = excluded.last_tick_at",
      [new Date().toISOString()],
    );
    // Overdue: enabled, a dispatched fire 10 min ago (older than its 60 s timeout), no run since.
    addJob("t.overdue", "*/30 * * * *", 1, { timeout_sec: 60 });
    db.run("UPDATE schedule_job SET last_fire_minute = ? WHERE job_key = 't.overdue'", [tenMinAgo()]);
    // Not overdue: a run started now (>= the dispatched fire) covers it.
    addJob("t.fresh", "*/30 * * * *", 1, { timeout_sec: 60 });
    db.run("UPDATE schedule_job SET last_fire_minute = ? WHERE job_key = 't.fresh'", [tenMinAgo()]);
    db.run(
      "INSERT INTO job_run (id, job_key, started_at, status, env, trigger, attempt) VALUES ('jr-h1','t.fresh',?, 'success','dev','schedule',1)",
      [new Date().toISOString()],
    );
    // Not overdue: disabled (the rule only flags enabled jobs) and never dispatched.
    addJob("t.disabled-od", "*/30 * * * *", 0, { timeout_sec: 60 });
    db.run("UPDATE schedule_job SET last_fire_minute = ? WHERE job_key = 't.disabled-od'", [tenMinAgo()]);
    addJob("t.neverfired", "*/30 * * * *", 1, { timeout_sec: 60 }); // last_fire_minute stays NULL
    // 3 consecutive failures → the flag is 3; watch.evaluate's single success stays at 0.
    addJob("t.fail3", "*/30 * * * *", 1, { timeout_sec: 60 });
    for (let i = 1; i <= 3; i++) {
      db.run(
        "INSERT INTO job_run (id, job_key, started_at, finished_at, status, env, trigger, attempt) VALUES (?, 't.fail3', ?, ?, 'failed', 'dev', 'schedule', 1)",
        [`jr-f${i}`, `2026-11-01T00:0${i}:00.000Z`, `2026-11-01T00:0${i}:30.000Z`],
      );
    }
  });

  test("unauthenticated request is 401; analyst is 403 admin_required", async () => {
    const res = await nextRequest("/api/admin/schedule-jobs/health");
    expect(res.status).toBe(401);
    const forbidden = await nextRequest("/api/admin/schedule-jobs/health", { headers: { cookie: analystCookie } });
    expect(forbidden.status).toBe(403);
  });

  test("tick heartbeat is healthy when fresh (age <= 180 s) and unhealthy when stale", async () => {
    const res = await nextRequest("/api/admin/schedule-jobs/health", { headers: { cookie: adminCookie } });
    expect(res.status).toBe(200);
    const { tick } = (await res.json()).data;
    expect(tick.env).toBe("dev");
    expect(tick.healthy).toBe(true);
    expect(tick.age_seconds).toBeLessThanOrEqual(180);

    db.run("UPDATE schedule_heartbeat SET last_tick_at = ? WHERE env = 'dev'", [
      new Date(Date.now() - 4 * 60_000).toISOString(),
    ]);
    const stale = await nextRequest("/api/admin/schedule-jobs/health", { headers: { cookie: adminCookie } });
    const staleTick = (await stale.json()).data.tick;
    expect(staleTick.healthy).toBe(false);
    expect(staleTick.age_seconds).toBeGreaterThan(180);
    // restore for any later reader
    db.run("UPDATE schedule_heartbeat SET last_tick_at = ? WHERE env = 'dev'", [new Date().toISOString()]);
  });

  test("overdue follows the documented rule: dispatched fire older than timeout with no covering run", async () => {
    const res = await nextRequest("/api/admin/schedule-jobs/health", { headers: { cookie: adminCookie } });
    expect(res.status).toBe(200);
    const { jobs } = (await res.json()).data;
    const byKey = new Map<string, any>(jobs.map((j: any) => [j.job_key, j]));
    expect(byKey.get("t.overdue").overdue).toBe(true);
    expect(byKey.get("t.fresh").overdue).toBe(false);
    expect(byKey.get("t.disabled-od").overdue).toBe(false);
    expect(byKey.get("t.neverfired").overdue).toBe(false);
    expect(byKey.get("t.overdue").last_fire_at).toBeTruthy();
    expect(byKey.get("t.fresh").last_run_started_at).toBeTruthy();
  });

  test("consecutive_failures counts the trailing failed/timeout streak (window 3)", async () => {
    const res = await nextRequest("/api/admin/schedule-jobs/health", { headers: { cookie: adminCookie } });
    const { jobs } = (await res.json()).data;
    const byKey = new Map<string, any>(jobs.map((j: any) => [j.job_key, j]));
    expect(byKey.get("t.fail3").consecutive_failures).toBe(3);
    expect(byKey.get("watch.evaluate").consecutive_failures).toBe(0); // latest run is a success
  });
});

// ── ADR-0189 P7: create ──────────────────────────────────────────────────────────────────

describe("POST /api/admin/schedule-jobs — create (P7)", () => {
  test("unauthenticated request is 401; analyst is 403 admin_required", async () => {
    const res = await nextRequest(LIST_PATH, { method: "POST", body: JSON.stringify({ job_key: "collect.dart" }) });
    expect(res.status).toBe(401);
    const forbidden = await nextRequest(LIST_PATH, {
      method: "POST",
      headers: { cookie: analystCookie },
      body: JSON.stringify({ job_key: "collect.dart" }),
    });
    expect(forbidden.status).toBe(403);
  });

  test("body validation: object with job_key required, unknown fields rejected", async () => {
    const noKey = await nextRequest(LIST_PATH, {
      method: "POST",
      headers: { cookie: adminCookie },
      body: JSON.stringify({}),
    });
    expect(noKey.status).toBe(400);
    const nonString = await nextRequest(LIST_PATH, {
      method: "POST",
      headers: { cookie: adminCookie },
      body: JSON.stringify({ job_key: 7 }),
    });
    expect(nonString.status).toBe(400);
    const unknown = await nextRequest(LIST_PATH, {
      method: "POST",
      headers: { cookie: adminCookie },
      body: JSON.stringify({ job_key: "collect.dart", command: "rm -rf /" }),
    });
    expect(unknown.status).toBe(400);
    expect((await unknown.json()).error.message).toContain("command");
  });

  test("§5 RCE guard: an unregistered job_key is 400 unregistered_handler naming the key", async () => {
    for (const key of ["rm -rf /", "no.such.handler", "notify.deliver.extra"]) {
      const res = await nextRequest(LIST_PATH, {
        method: "POST",
        headers: { cookie: adminCookie },
        body: JSON.stringify({ job_key: key }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("unregistered_handler");
      expect(json.error.message).toContain(key);
    }
  });

  test("409 job_key_exists when the key already has a schedule_job row", async () => {
    const res = await nextRequest(LIST_PATH, {
      method: "POST",
      headers: { cookie: adminCookie },
      body: JSON.stringify({ job_key: "notify.deliver" }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("job_key_exists");
  });

  test("registry defaults apply (enabled = 0, cron/timeout/retries/display fields from the handler)", async () => {
    const handlers = await import("../../scripts/co-newbiz/jobs/index.ts");
    const handler = handlers.listJobHandlers().find((h) => h.key === "collect.dart")!;
    const res = await nextRequest(LIST_PATH, {
      method: "POST",
      headers: { cookie: adminCookie },
      body: JSON.stringify({ job_key: "collect.dart" }),
    });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.error).toBeNull();
    const row = json.data;
    expect(Object.keys(row).sort()).toEqual(EXPECTED_ROW_KEYS); // GET-shaped row
    expect(row.enabled).toBe(0); // create-then-enable is the safe flow
    expect(row.next_run_at).toBeNull(); // disabled → null, like the list rows
    expect(row.cron_expr).toBe(handler.defaultCron);
    expect(row.timeout_sec).toBe(handler.timeoutSec);
    expect(row.max_retries).toBe(handler.maxRetries);
    expect(row.display_name).toBe(handler.displayName);
    expect(row.description).toBe(handler.description);
  });

  test("explicit fields reuse the PATCH validation rules (shared validator)", async () => {
    for (const [body, code] of [
      [{ job_key: "collect.ecos", cron_expr: "60 * * * *" }, "invalid_cron"],
      [{ job_key: "collect.ecos", cron_expr: "*/2 * * * *" }, "cron_too_frequent"], // not exempt
      [{ job_key: "collect.ecos", timeout_sec: 59 }, "invalid_request"],
      [{ job_key: "collect.ecos", max_retries: 6 }, "invalid_request"],
      [{ job_key: "collect.ecos", enabled: "yes" }, "invalid_request"],
    ] as const) {
      const res = await nextRequest(LIST_PATH, {
        method: "POST",
        headers: { cookie: adminCookie },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe(code);
    }
    // nothing was written by the rejected requests (bun:sqlite get() -> null for no row)
    expect(db.query("SELECT 1 FROM schedule_job WHERE job_key = 'collect.ecos'").get()).toBeNull();
  });

  test("201 happy path: explicit fields persisted, schedule_job_create audit carries the full row", async () => {
    const res = await nextRequest(LIST_PATH, {
      method: "POST",
      headers: { cookie: adminCookie },
      body: JSON.stringify({ job_key: "collect.ecos", cron_expr: "15 6 * * *", timeout_sec: 600, max_retries: 2 }),
    });
    expect(res.status).toBe(201);
    const row = (await res.json()).data;
    expect(row.job_key).toBe("collect.ecos");
    expect(row.cron_expr).toBe("15 6 * * *");
    expect(row.timeout_sec).toBe(600);
    expect(row.max_retries).toBe(2);
    expect(row.enabled).toBe(0);
    expect(row.created_at).toBeTruthy();
    const audit = db
      .query("SELECT * FROM audit_log WHERE action = 'schedule_job_create' ORDER BY created_at, id")
      .all()
      .at(-1) as any;
    expect(audit.actor_user_id).toBe("sjadmin");
    expect(audit.target).toBe("collect.ecos: cron 15 6 * * *; timeout 600; retries 2; enabled 0");
  });

  test("an explicit enabled=true is honored (admin-gated and audited)", async () => {
    const res = await nextRequest(LIST_PATH, {
      method: "POST",
      headers: { cookie: adminCookie },
      body: JSON.stringify({ job_key: "collect.krx", enabled: true }),
    });
    expect(res.status).toBe(201);
    const row = (await res.json()).data;
    expect(row.enabled).toBe(1);
    expect(row.next_run_at).toBeTruthy(); // enabled → the shared parser computes the next fire
    const audit = db
      .query("SELECT * FROM audit_log WHERE action = 'schedule_job_create' ORDER BY created_at, id")
      .all()
      .at(-1) as any;
    expect(audit.target).toContain("enabled 1");
  });
});

// ── ADR-0189 P7: run-history extension ───────────────────────────────────────────────────

describe("GET /api/admin/schedule-jobs/[jobKey]/runs — P7 extension", () => {
  beforeAll(() => {
    // 7 runs for notify.digest: 4 success / 3 failed; the newest (jr-r7) is still running.
    for (let i = 1; i <= 7; i++) {
      const status = i % 2 === 0 ? "failed" : "success";
      db.run(
        `INSERT INTO job_run (id, job_key, started_at, finished_at, status, error, "trigger", actor, env, rows_read, rows_written, rows_changed, attempt)
         VALUES (?, 'notify.digest', ?, ?, ?, ?, 'manual', 'sjadmin', 'dev', ?, ?, ?, ?)`,
        [
          `jr-r${i}`,
          `2026-11-01T00:0${i}:00.000Z`,
          status === "success" ? `2026-11-01T00:0${i}:30.000Z` : `2026-11-01T00:0${i}:45.000Z`,
          status,
          status === "failed" ? "boom" : null,
          i,
          i + 1,
          i + 2,
          1,
        ],
      );
    }
  });

  test("unauthenticated request is 401; analyst is 403; unknown job_key is 404", async () => {
    const res = await nextRequest(jobPath("notify.digest") + "/runs");
    expect(res.status).toBe(401);
    const forbidden = await nextRequest(jobPath("notify.digest") + "/runs", { headers: { cookie: analystCookie } });
    expect(forbidden.status).toBe(403);
    const missing = await nextRequest(jobPath("no.such.job") + "/runs", { headers: { cookie: adminCookie } });
    expect(missing.status).toBe(404);
  });

  test("rows carry the 0183 columns, scrubbed error and computed duration; newest first", async () => {
    const res = await nextRequest(jobPath("notify.digest") + "/runs", { headers: { cookie: adminCookie } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.job_key).toBe("notify.digest");
    const runs = json.data.runs as any[];
    expect(runs.length).toBe(7);
    for (const r of runs) {
      for (const key of [
        "started_at",
        "finished_at",
        "status",
        "error",
        "trigger",
        "actor",
        "env",
        "rows_read",
        "rows_written",
        "rows_changed",
        "attempt",
        "duration",
      ]) {
        expect(key in r).toBe(true);
      }
      expect(r.trigger).toBe("manual");
      expect(r.actor).toBe("sjadmin");
      expect(r.env).toBe("dev");
    }
    expect(runs[0].started_at).toBe("2026-11-01T00:07:00.000Z");
    expect(runs[0].finished_at).toBe("2026-11-01T00:07:30.000Z");
    expect(runs[0].duration).toBe(30_000);
    expect(runs[0].rows_read).toBe(7);
    const failed = runs.find((r) => r.status === "failed")!;
    expect(failed.error).toBe("boom");
    expect(failed.duration).toBe(45_000);
    // backward-compatible fields keep their semantics
    expect(json.data.success_rate).toBe(57); // 4 / 7 over the returned page
    expect(json.meta.count).toBe(7);
  });

  test("paging: ?page=&limit= slices the newest-first window; total serves the pager", async () => {
    const page1 = await nextRequest(jobPath("notify.digest") + "/runs?page=1&limit=3", {
      headers: { cookie: adminCookie },
    });
    const p1 = (await page1.json()).data;
    expect(p1.runs.map((r: any) => r.started_at)).toEqual([
      "2026-11-01T00:07:00.000Z",
      "2026-11-01T00:06:00.000Z",
      "2026-11-01T00:05:00.000Z",
    ]);
    expect(p1.total).toBe(7);
    expect(p1.page).toBe(1);
    expect(p1.limit).toBe(3);
    const page3 = await nextRequest(jobPath("notify.digest") + "/runs?page=3&limit=3", {
      headers: { cookie: adminCookie },
    });
    const p3env = await page3.json(); // meta lives at the envelope root, not inside data
    const p3 = p3env.data;
    expect(p3.runs.length).toBe(1);
    expect(p3.runs[0].started_at).toBe("2026-11-01T00:01:00.000Z");
    expect(p3env.meta.count).toBe(1);
    expect(p3env.meta.total).toBe(7);
  });

  test("invalid paging is 400", async () => {
    for (const qs of ["?page=0", "?page=x", "?limit=0", "?limit=201", "?limit=2.5"]) {
      const res = await nextRequest(jobPath("notify.digest") + "/runs" + qs, { headers: { cookie: adminCookie } });
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe("invalid_request");
    }
  });
});
