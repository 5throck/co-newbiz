// @version 1.0.0
/**
 * Scheduler P1 (ADR-0189, design 2026-10-29-scheduled-jobs-design): migration 0183, the shared cron module, the secret
 * scrubber, the dispatcher (schedule-tick), the runner (run-job: lock, timeout, retry, stale reclaim) and the two
 * handlers. Everything runs against a scratch SQLite under the OS temp dir - never the dev (7748) or prod (7749) DB.
 */
import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = mkdtempSync(join(tmpdir(), "scheduler-p1-"));
const TEST_DB_PATH = join(TMP, "scheduler.sqlite");
process.env.CO_NEWBIZ_LLM_PROVIDER = "none";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations, splitSqlStatements } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const cron = await import("../../app/web-next/lib/schedule/cron.ts");
const sched = await import("../../scripts/co-newbiz/scheduler-core.ts");
const { scrubSecrets, REDACTED } = await import("../../db/lib/secret-scrubber.ts");
const { runTick } = await import("../../scripts/co-newbiz/schedule-tick.ts");
const { runJob } = await import("../../scripts/co-newbiz/run-job.ts");
const jobs = await import("../../scripts/co-newbiz/jobs/index.ts");
const { RetryableJobError } = await import("../../scripts/co-newbiz/jobs/types.ts");
const { isoWeekLabel } = await import("../../scripts/co-newbiz/jobs/gate-integrity-shadow-report.ts");
const { spawnOptions } = await import("../../scripts/co-newbiz/schedule-tick.ts");
const { validateRequest, REQUEST_ID_RE } = await import("../../scripts/co-newbiz/run-job.ts");
const { safeDetailJson } = await import("../../db/lib/secret-scrubber.ts");
const { seedScheduleJobs } = await import("../../scripts/co-newbiz/schedule-seed.ts");

afterAll(() => {
  resetDb();
  rmSync(TMP, { recursive: true, force: true });
});

const utc = (s: string) => new Date(s);
function addJob(key: string, cronExpr: string, enabled = 1, extra: { last?: string | null; timeout?: number; retries?: number } = {}) {
  db.run(
    "INSERT OR REPLACE INTO schedule_job (id, job_key, cron_expr, enabled, created_at, timeout_sec, max_retries, last_fire_minute) VALUES (?,?,?,?,?,?,?,?)",
    [`id-${key}`, key, cronExpr, enabled, "2026-10-29T00:00:00Z", extra.timeout ?? 600, extra.retries ?? 0, extra.last ?? null],
  );
}
const runs = (key: string) => db.query("SELECT * FROM job_run WHERE job_key = ? ORDER BY started_at, id").all(key) as any[];

describe("cron module (KST)", () => {
  test("parses lists, ranges, steps and rejects garbage", () => {
    const s = cron.parseCron("*/15 8-10 1,15 * 1-5");
    expect([...s.minute]).toEqual([0, 15, 30, 45]);
    expect([...s.hour]).toEqual([8, 9, 10]);
    expect([...s.dayOfMonth]).toEqual([1, 15]);
    expect([...s.dayOfWeek]).toEqual([1, 2, 3, 4, 5]);
    for (const bad of ["", "* * * *", "* * * * * *", "60 * * * *", "* 24 * * *", "* * 0 * *", "* * * 13 *", "*/0 * * * *", "a * * * *", "5-1 * * * *", "MON * * * *"]) {
      expect(cron.validateCron(bad).ok).toBe(false);
    }
    expect(cron.validateCron("0 7 * * 7").ok).toBe(true); // 7 = Sunday
    expect([...cron.parseCron("0 7 * * 7").dayOfWeek]).toEqual([0]);
  });

  test("next fire is evaluated on the KST wall clock (UTC+9)", () => {
    // 07:00 KST weekdays; from Fri 2026-10-30 08:00 KST (= 2026-10-29T23:00Z) the next is Mon 2026-11-02 07:00 KST.
    const [n1, n2] = cron.nextFireTimes("0 7 * * 1-5", utc("2026-10-29T23:00:00Z"), 2);
    expect(n1.toISOString()).toBe("2026-11-01T22:00:00.000Z"); // Mon 07:00 KST = Sun 22:00Z
    expect(n2.toISOString()).toBe("2026-11-02T22:00:00.000Z");
    // */30 steps; strictly after the given minute
    const t = cron.nextFireTimes("*/30 * * * *", utc("2026-10-29T00:00:00Z"), 3).map((d) => d.toISOString());
    expect(t).toEqual(["2026-10-29T00:30:00.000Z", "2026-10-29T01:00:00.000Z", "2026-10-29T01:30:00.000Z"]);
  });

  test("month ends, leap day, dom/dow OR rule, impossible dates", () => {
    const dec31 = cron.nextFireTimes("0 0 31 * *", utc("2026-11-01T00:00:00Z"), 1)[0];
    expect(dec31.toISOString()).toBe("2026-12-30T15:00:00.000Z");
    expect(cron.nextFireTimes("0 0 29 2 *", utc("2026-01-01T00:00:00Z"), 1)[0].toISOString()).toBe("2028-02-28T15:00:00.000Z");
    // 1st of month OR Monday (both restricted -> union)
    const spec = cron.parseCron("0 9 1 * 1");
    expect(cron.cronMatches(spec, utc("2026-11-01T00:00:00Z"))).toBe(true); // Nov 1 09:00 KST (Sunday, day 1)
    expect(cron.cronMatches(spec, utc("2026-11-02T00:00:00Z"))).toBe(true); // Mon Nov 2
    expect(cron.cronMatches(spec, utc("2026-11-03T00:00:00Z"))).toBe(false);
    expect(cron.nextFireTimes("0 0 31 2 *", utc("2026-01-01T00:00:00Z"), 1)).toEqual([]);
  });

  test("minIntervalMinutes", () => {
    expect(cron.minIntervalMinutes("*/5 * * * *", utc("2026-10-29T00:00:00Z"))).toBe(5);
    expect(cron.minIntervalMinutes("0 8 * * 1", utc("2026-10-29T00:00:00Z"))).toBe(7 * 24 * 60);
  });
});

describe("secret scrubber", () => {
  test("redacts credential env values, URL key params, bearer tokens and URL passwords", () => {
    const env = { DART_API_KEY: "dart-secret-123456", ECOS_API_KEY: "short", NOTIFY_SMTP_PASS: "smtp-pass-abcdef", NOTIFY_WEBHOOK_URL_OPS: "https://hooks.slack.com/services/T0/B0/XYZ123456" };
    const msg =
      "fetch https://opendart.fss.or.kr/api/x.json?crtfc_key=dart-secret-123456&corp=1 failed; " +
      "https://x/y?serviceKey=abc%2Fdef&OC=myid&page=1 Authorization: Bearer tok_1234567890abcdef " +
      "smtp://user:smtp-pass-abcdef@mail.example.com hook https://hooks.slack.com/services/T0/B0/XYZ123456 short";
    const out = scrubSecrets(msg, { env });
    expect(out).not.toContain("dart-secret-123456");
    expect(out).not.toContain("abc%2Fdef");
    expect(out).not.toContain("myid");
    expect(out).not.toContain("tok_1234567890abcdef");
    expect(out).not.toContain("smtp-pass-abcdef");
    expect(out).not.toContain("XYZ123456");
    expect(out).toContain(`crtfc_key=${REDACTED}`);
    expect(out).toContain("page=1");
    expect(out).toContain("short"); // values under 6 chars are not treated as secrets (would shred ordinary text)
  });

  test("truncates to 2 KB after scrubbing", () => {
    const out = scrubSecrets("x".repeat(5000), { env: {} });
    expect(out.length).toBe(2048);
    expect(out.endsWith("...")).toBe(true);
  });
});

describe("migration 0183", () => {
  const DIR = join(import.meta.dirname, "..", "..", "db", "migrations");
  const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
  const TARGET = files.find((f) => f.startsWith("0183_"))!;
  const run = (d: Database, sql: string) => { for (const s of splitSqlStatements(sql)) d.run(s); };
  const cols = (d: Database, t: string) => (d.query(`PRAGMA table_info(${t})`).all() as Array<{ name: string }>).map((c) => c.name);

  test("has the reversible header and rebuilds job_run without losing legacy rows", () => {
    const sql = readFileSync(join(DIR, TARGET), "utf-8");
    expect(sql).toContain("@reversible:");
    expect(sql).toContain("ROLLBACK-SQL-BEGIN");
    const d = new Database(":memory:");
    d.run("PRAGMA foreign_keys = ON");
    d.run("CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, filename TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL)");
    for (const f of files) if (f < TARGET) run(d, readFileSync(join(DIR, f), "utf-8"));
    d.run("INSERT INTO job_run (id, job_key, started_at, status, error) VALUES ('old1','watch:run','2026-10-01T00:00:00Z','failed','boom')");
    d.run("INSERT INTO schedule_job (id, job_key, cron_expr, enabled, created_at) VALUES ('s1','k','* * * * *',1,'2026-10-01T00:00:00Z')");
    run(d, sql);
    const old = d.query("SELECT * FROM job_run WHERE id = 'old1'").get() as any;
    expect(old.error).toBe("boom");
    expect(old.trigger).toBeNull();
    expect(old.attempt).toBe(1);
    expect(cols(d, "job_run")).toEqual(expect.arrayContaining(["trigger", "actor", "env", "rows_read", "rows_written", "rows_changed", "attempt", "detail_json"]));
    expect(cols(d, "schedule_job")).toEqual(expect.arrayContaining(["display_name", "description", "timeout_sec", "max_retries", "updated_at", "updated_by", "last_fire_minute"]));
    expect((d.query("SELECT timeout_sec, max_retries FROM schedule_job WHERE id = 's1'").get() as any)).toEqual({ timeout_sec: 600, max_retries: 0 });
    // status vocabulary and trigger CHECK
    d.run("INSERT INTO job_run (id, job_key, started_at, status) VALUES ('n1','k','t','skipped')");
    d.run("INSERT INTO job_run (id, job_key, started_at, status) VALUES ('n2','k','t','timeout')");
    expect(() => d.run("INSERT INTO job_run (id, job_key, started_at, status) VALUES ('n3','k','t','bogus')")).toThrow();
    expect(() => d.run(`INSERT INTO job_run (id, job_key, started_at, status, "trigger") VALUES ('n4','k','t','running','cron')`)).toThrow();
    expect(() => d.run("INSERT INTO schedule_heartbeat (env, last_tick_at) VALUES ('stage','t')")).toThrow();
    expect(() => d.run("INSERT INTO schedule_job_request (id, job_key, requested_by, requested_at, status) VALUES ('r','k','u','t','weird')")).toThrow();
  });
});

describe("schedule-tick: due computation", () => {
  const spawned: Array<{ jobKey: string; trigger: string; actor?: string; requestId?: string }> = [];
  const spawn = (r: any) => void spawned.push(r);
  const tick = (iso: string) => {
    spawned.length = 0;
    return runTick(db, { env: "dev", now: utc(iso), spawn });
  };

  test("fires only enabled jobs whose cron matches this minute; writes the heartbeat", () => {
    addJob("t.every5", "*/5 * * * *");
    addJob("t.hourly", "0 * * * *");
    addJob("t.disabled", "* * * * *", 0);
    const s = tick("2026-10-29T10:05:20Z");
    expect(s.dispatched.map((d) => d.jobKey)).toEqual(["t.every5"]);
    expect(spawned.map((x) => x.jobKey)).toEqual(["t.every5"]);
    expect(spawned[0].trigger).toBe("schedule");
    expect((db.query("SELECT last_tick_at FROM schedule_heartbeat WHERE env = 'dev'").get() as any).last_tick_at).toBe("2026-10-29T10:05:20.000Z");
    expect((db.query("SELECT last_fire_minute FROM schedule_job WHERE job_key = 't.every5'").get() as any).last_fire_minute).toBe("2026-10-29T10:05:00.000Z");
  });

  test("never double-fires within the same minute (two ticks, one dispatch)", () => {
    const a = tick("2026-10-29T10:10:05Z");
    expect(a.dispatched.map((d) => d.jobKey)).toEqual(["t.every5"]);
    const b = tick("2026-10-29T10:10:40Z");
    expect(b.dispatched).toEqual([]);
    // the loser of the compare-and-set sees changes = 0
    const stale = db.run("UPDATE schedule_job SET last_fire_minute = ? WHERE job_key = 't.every5' AND COALESCE(last_fire_minute,'') = COALESCE(?, '')", ["x", "2026-10-29T10:05:00.000Z"]);
    expect(stale.changes).toBe(0);
  });

  test("hourly job fires at :00 and the disabled one never fires", () => {
    const s = tick("2026-10-29T11:00:10Z");
    expect(s.dispatched.map((d) => d.jobKey).sort()).toEqual(["t.every5", "t.hourly"]);
    expect(spawned.some((x) => x.jobKey === "t.disabled")).toBe(false);
  });

  test("invalid cron is reported, not fatal", () => {
    addJob("t.badcron", "not a cron");
    const s = tick("2026-10-29T11:01:10Z");
    expect(s.invalid.map((i) => i.jobKey)).toEqual(["t.badcron"]);
  });

  test("missed fire: skip policy consumes it, once policy catches up within the window", () => {
    const base = "2026-10-20T00:00:00.000Z";
    addJob("watch.evaluate", "*/30 * * * *", 1, { last: base }); // registered handler, catchup skip
    addJob("gate_integrity.shadow_report", "0 8 * * 1", 1, { last: base }); // registered handler, catchup once (7 d)
    // Wed 2026-10-21 12:00Z: the watch slot is on time? 12:00Z matches */30 -> the latest fire is this minute -> on time.
    // Make both stale by ticking well after the missed slots: Thu 2026-10-22 03:17Z.
    const s = tick("2026-10-22T03:17:00Z");
    const w = s.skippedMissed.find((m) => m.jobKey === "watch.evaluate");
    expect(w).toBeTruthy(); // missed 03:00Z slot (17 min old) is consumed, not run
    expect(s.dispatched.some((d) => d.jobKey === "watch.evaluate")).toBe(false);
    // Monday 08:00 KST = Sun 23:00Z -> 2026-10-25T23:00Z; tick on Tue 2026-10-27 -> catch-up, trigger 'catchup'
    const s2 = tick("2026-10-27T05:00:30Z");
    const g = s2.dispatched.find((d) => d.jobKey === "gate_integrity.shadow_report");
    expect(g?.trigger).toBe("catchup");
  });

  test("a queued run-now request spawns a manual run carrying the actor, once", () => {
    const rid = sched.enqueueRequest(db, "t.disabled", "user-42", utc("2026-10-29T12:00:00Z"));
    const s = tick("2026-10-29T12:00:30Z");
    const m = s.dispatched.find((d) => d.requestId === rid);
    expect(m?.trigger).toBe("manual");
    expect(spawned.find((x) => x.requestId === rid)?.actor).toBe("user-42");
    expect((db.query("SELECT status FROM schedule_job_request WHERE id = ?").get(rid) as any).status).toBe("claimed");
    expect(tick("2026-10-29T12:01:30Z").dispatched.some((d) => d.requestId === rid)).toBe(false);
  });
});

describe("environment guard", () => {
  test("resolveSchedulerEnv refuses anything but prod|dev", () => {
    expect(() => sched.resolveSchedulerEnv(undefined)).toThrow(/CO_NEWBIZ_SCHEDULER_ENV/);
    expect(() => sched.resolveSchedulerEnv("staging")).toThrow();
    expect(sched.resolveSchedulerEnv("prod")).toBe("prod");
    expect(sched.resolveSchedulerEnv("dev")).toBe("dev");
  });

  test("schedule-tick.ts and run-job.ts exit 2 without CO_NEWBIZ_SCHEDULER_ENV (scratch DB, nothing written)", () => {
    const env = { ...process.env, CO_NEWBIZ_DB_PATH: join(TMP, "guard.sqlite") } as Record<string, string | undefined>;
    delete env.CO_NEWBIZ_SCHEDULER_ENV;
    for (const [script, extra] of [["schedule-tick.ts", []], ["run-job.ts", ["--job", "watch.evaluate"]]] as const) {
      const p = Bun.spawnSync([process.execPath, join(import.meta.dirname, "../../scripts/co-newbiz", script), ...extra], { env: env as any });
      expect(p.exitCode).toBe(2);
      expect(p.stderr.toString()).toContain("CO_NEWBIZ_SCHEDULER_ENV");
    }
    expect(existsSync(join(TMP, "guard.sqlite"))).toBe(false);
  });
});

describe("lock, runner, timeout, stale reclaim", () => {
  const T0 = utc("2026-10-29T09:00:00Z");

  test("the lease lock prevents overlap and an expired lease can be taken over", () => {
    expect(sched.acquireLock(db, "lk", "a", T0, 60)).toBe(true);
    expect(sched.acquireLock(db, "lk", "b", new Date(T0.getTime() + 30_000), 60)).toBe(false);
    sched.releaseLock(db, "lk", "b"); // not the holder: no effect
    expect(sched.acquireLock(db, "lk", "b", new Date(T0.getTime() + 31_000), 60)).toBe(false);
    expect(sched.acquireLock(db, "lk", "b", new Date(T0.getTime() + 61_000), 60)).toBe(true);
    sched.releaseLock(db, "lk", "b");
    expect(db.query("SELECT 1 FROM schedule_job_lock WHERE job_key = 'lk'").get()).toBeNull();
  });

  test("runJob while another holder has the lease records nothing; a manual request is rejected_locked", async () => {
    jobs.registerJobHandler({ key: "t.lock", displayName: "t", description: "t", defaultCron: "* * * * *", timeoutSec: 5, maxRetries: 0, catchup: { mode: "skip" }, run: () => ({ rowsRead: 1 }) });
    addJob("t.lock", "* * * * *");
    sched.acquireLock(db, "t.lock", "someone-else", new Date(), 600);
    const rid = sched.enqueueRequest(db, "t.lock", "u1", new Date());
    const r = await runJob(db, { jobKey: "t.lock", env: "dev", trigger: "manual", actor: "u1", requestId: rid });
    expect(r.outcome).toBe("locked");
    expect(runs("t.lock")).toEqual([]);
    expect((db.query("SELECT status FROM schedule_job_request WHERE id = ?").get(rid) as any).status).toBe("rejected_locked");
    sched.releaseLock(db, "t.lock", "someone-else");
  });

  test("success records complete job_run row (trigger, actor, env, counts, detail) and completes the request", async () => {
    jobs.registerJobHandler({ key: "t.ok", displayName: "t", description: "t", defaultCron: "* * * * *", timeoutSec: 5, maxRetries: 0, catchup: { mode: "skip" }, run: () => ({ rowsRead: 7, rowsWritten: 3, rowsChanged: 2, detail: { src: "x" } }) });
    addJob("t.ok", "* * * * *", 0); // disabled: manual still allowed
    const rid = sched.enqueueRequest(db, "t.ok", "admin-1", new Date());
    const r = await runJob(db, { jobKey: "t.ok", env: "prod", trigger: "manual", actor: "admin-1", requestId: rid });
    expect(r.outcome).toBe("success");
    const row = runs("t.ok")[0];
    expect(row).toMatchObject({ status: "success", trigger: "manual", actor: "admin-1", env: "prod", rows_read: 7, rows_written: 3, rows_changed: 2, attempt: 1 });
    expect(JSON.parse(row.detail_json)).toEqual({ src: "x" });
    expect(row.finished_at).toBeTruthy();
    expect(db.query("SELECT status, job_run_id FROM schedule_job_request WHERE id = ?").get(rid)).toEqual({ status: "done", job_run_id: row.id });
    expect(db.query("SELECT 1 FROM schedule_job_lock WHERE job_key = 't.ok'").get()).toBeNull();
  });

  test("a scheduled run re-checks enabled: disabled job ends skipped with reason", async () => {
    const r = await runJob(db, { jobKey: "t.ok", env: "dev", trigger: "schedule" });
    expect(r.outcome).toBe("disabled");
    const row = runs("t.ok").at(-1);
    expect(row.status).toBe("skipped");
    expect(JSON.parse(row.detail_json).reason).toBe("disabled");
  });

  test("handler error is scrubbed and truncated; the lock is released", async () => {
    process.env.DART_API_KEY = ["dart", "key-for-test-9999"].join("-");
    jobs.registerJobHandler({ key: "t.fail", displayName: "t", description: "t", defaultCron: "* * * * *", timeoutSec: 5, maxRetries: 0, catchup: { mode: "skip" }, run: () => { throw new Error("GET https://x/api?crtfc_key=dart-key-for-test-9999 -> 500"); } });
    addJob("t.fail", "* * * * *");
    const r = await runJob(db, { jobKey: "t.fail", env: "dev", trigger: "schedule" });
    delete process.env.DART_API_KEY;
    expect(r.outcome).toBe("failed");
    const row = runs("t.fail")[0];
    expect(row.status).toBe("failed");
    expect(row.error).not.toContain("dart-key-for-test-9999");
    expect(row.error).toContain(REDACTED);
    expect(db.query("SELECT 1 FROM schedule_job_lock WHERE job_key = 't.fail'").get()).toBeNull();
  });

  test("timeout ends the run as 'timeout', does not retry, and exits 124 without releasing the lock", async () => {
    const exits: number[] = [];
    jobs.registerJobHandler({ key: "t.slow", displayName: "t", description: "t", defaultCron: "* * * * *", timeoutSec: 5, maxRetries: 2, catchup: { mode: "skip" }, run: (ctx) => new Promise((res) => ctx.signal.addEventListener("abort", () => res({}))).then(() => new Promise(() => {})) as any });
    addJob("t.slow", "* * * * *", 1, { retries: 2 });
    const r = await runJob(db, { jobKey: "t.slow", env: "dev", trigger: "schedule", timeoutMsOverride: 40, retryDelayMs: 0, exit: (c) => void exits.push(c) });
    expect(r.outcome).toBe("timeout");
    expect(exits).toEqual([124]); // M1: the process exits; the lock is NOT released (lease expiry frees it)
    expect(db.query("SELECT 1 FROM schedule_job_lock WHERE job_key = 't.slow'").get()).toBeTruthy();
    db.run("DELETE FROM schedule_job_lock WHERE job_key = 't.slow'");
    expect(r.attempts).toBe(1);
    expect(runs("t.slow")[0].status).toBe("timeout");
  });

  test("RetryableJobError retries up to max_retries, one job_run row per attempt", async () => {
    let calls = 0;
    jobs.registerJobHandler({ key: "t.retry", displayName: "t", description: "t", defaultCron: "* * * * *", timeoutSec: 5, maxRetries: 1, catchup: { mode: "skip" }, run: () => { calls++; if (calls < 3) throw new RetryableJobError("429"); return { rowsRead: 1 }; } });
    addJob("t.retry", "* * * * *", 1, { retries: 1 });
    const r = await runJob(db, { jobKey: "t.retry", env: "dev", trigger: "schedule", retryDelayMs: 0 });
    expect(r.outcome).toBe("failed"); // 1 retry allowed -> 2 attempts, both retryable errors
    expect(runs("t.retry").map((x) => [x.attempt, x.status])).toEqual([[1, "failed"], [2, "failed"]]);
    let calls2 = 0;
    jobs.registerJobHandler({ key: "t.retry2", displayName: "t", description: "t", defaultCron: "* * * * *", timeoutSec: 5, maxRetries: 2, catchup: { mode: "skip" }, run: () => { calls2++; if (calls2 < 3) throw new RetryableJobError("5xx"); return {}; } });
    addJob("t.retry2", "* * * * *", 1, { retries: 2 });
    const r2 = await runJob(db, { jobKey: "t.retry2", env: "dev", trigger: "schedule", retryDelayMs: 0 });
    expect(r2.outcome).toBe("success");
    expect(runs("t.retry2").map((x) => x.status)).toEqual(["failed", "failed", "success"]);
    // a non-retryable error is never retried
    jobs.registerJobHandler({ key: "t.noretry", displayName: "t", description: "t", defaultCron: "* * * * *", timeoutSec: 5, maxRetries: 3, catchup: { mode: "skip" }, run: () => { throw new Error("400 bad request"); } });
    addJob("t.noretry", "* * * * *", 1, { retries: 3 });
    expect((await runJob(db, { jobKey: "t.noretry", env: "dev", trigger: "schedule", retryDelayMs: 0 })).attempts).toBe(1);
  });

  test("a handler-reported skip ends as 'skipped' with the reason (e.g. credential_missing)", async () => {
    jobs.registerJobHandler({ key: "t.skip", displayName: "t", description: "t", defaultCron: "* * * * *", timeoutSec: 5, maxRetries: 0, catchup: { mode: "skip" }, run: () => ({ skipped: "credential_missing" }) });
    addJob("t.skip", "* * * * *");
    const r = await runJob(db, { jobKey: "t.skip", env: "dev", trigger: "schedule" });
    expect(r.outcome).toBe("skipped");
    expect(JSON.parse(runs("t.skip")[0].detail_json).reason).toBe("credential_missing");
  });

  test("unknown handler key records a failed run (visible, not silent)", async () => {
    const r = await runJob(db, { jobKey: "no.such.job", env: "dev", trigger: "manual", actor: "u" });
    expect(r.outcome).toBe("no_handler");
    expect(runs("no.such.job")[0]).toMatchObject({ status: "failed" });
  });

  test("sweep marks 'running' rows past their lease failed (timeout_or_crash) and clears expired locks", () => {
    addJob("t.stale", "* * * * *", 1, { timeout: 60 });
    // lease = 60 + 300 s; started 10 minutes ago -> stale. started 2 minutes ago -> still within lease.
    const now = utc("2026-10-29T13:00:00Z");
    db.run("INSERT INTO job_run (id, job_key, started_at, status, env, attempt) VALUES ('stale1','t.stale','2026-10-29T12:50:00.000Z','running','dev',1)");
    db.run("INSERT INTO job_run (id, job_key, started_at, status, env, attempt) VALUES ('fresh1','t.stale','2026-10-29T12:58:00.000Z','running','dev',1)");
    sched.acquireLock(db, "t.stale", "dead", utc("2026-10-29T12:50:00Z"), 360);
    const r = sched.sweepStaleRuns(db, now);
    expect(r.reclaimed).toBe(1);
    expect(r.locksCleared).toBeGreaterThanOrEqual(1);
    expect(db.query("SELECT status, error FROM job_run WHERE id = 'stale1'").get()).toEqual({ status: "timeout", error: "timeout_or_crash" });
    expect((db.query("SELECT status FROM job_run WHERE id = 'fresh1'").get() as any).status).toBe("running");
  });

  test("consecutiveFailures counts the trailing failed/timeout streak", () => {
    db.run("DELETE FROM job_run WHERE job_key = 't.cf'");
    for (const [i, s] of ["success", "failed", "timeout", "failed"].entries())
      db.run("INSERT INTO job_run (id, job_key, started_at, finished_at, status) VALUES (?, 't.cf', ?, ?, ?)", [`cf${i}`, `2026-10-29T0${i}:00:00Z`, `2026-10-29T0${i}:01:00Z`, s]);
    expect(sched.consecutiveFailures(db, "t.cf")).toBe(3);
  });
});

describe("handlers", () => {
  test("gate_integrity.shadow_report: job_run carries counts, report file is keyed by ISO week and overwritten on rerun", async () => {
    db.run(
      "INSERT INTO audit_log (id, actor_user_id, action, target, created_at) VALUES ('au1','u1','gate_integrity.would_block:rationale_insufficient','project:p1:entity_ic','2026-10-28T01:00:00.000Z')",
    );
    addJob("gate_integrity.shadow_report", "0 8 * * 1", 1, {});
    const reportDir = join(TMP, "reports");
    const mk = () => runJob(db, { jobKey: "gate_integrity.shadow_report", env: "dev", trigger: "manual", actor: "op", reportDir, clock: () => utc("2026-10-29T02:00:00Z") });
    const r = await mk();
    expect(r.outcome).toBe("success");
    const row = runs("gate_integrity.shadow_report")[0];
    expect(row).toMatchObject({ status: "success", rows_read: 1, rows_written: 1, rows_changed: 0, env: "dev", trigger: "manual" });
    const file = join(reportDir, "2026-W44.json");
    expect(isoWeekLabel(utc("2026-10-29T02:00:00Z"))).toBe("2026-W44");
    expect(JSON.parse(readFileSync(file, "utf-8")).totals.would_block).toBe(1);
    expect(JSON.parse(row.detail_json).report_path).toBe(file);
    await mk();
    expect(readdirSync(reportDir)).toEqual(["2026-W44.json"]);
  });

  test("watch.evaluate: runs the cycle on the scratch DB and records counts", async () => {
    // one watched project with no live anchors: changed = false, nothing fires, watermark advances
    db.run("INSERT INTO md_project (id, project_no, created_at, current_stage_gate, origin, track, status) VALUES ('wp1','WP-1','2026-10-01T00:00:00Z','fs','internal','greenfield','open')");
    const cols = (db.query("PRAGMA table_info(watch)").all() as Array<{ name: string; notnull: number; dflt_value: unknown }>);
    const fields = cols.filter((c) => c.notnull && c.dflt_value === null).map((c) => c.name);
    const vals: Record<string, string> = { id: "w1", project_id: "wp1", user_id: "u1", created_at: "2026-10-01T00:00:00Z" };
    db.run(`INSERT INTO watch (${fields.join(",")}) VALUES (${fields.map(() => "?").join(",")})`, fields.map((f) => vals[f] ?? "x"));
    addJob("watch.evaluate", "*/30 * * * *", 1, {});
    const r = await runJob(db, { jobKey: "watch.evaluate", env: "dev", trigger: "manual", actor: "op" });
    expect(r.outcome).toBe("success");
    const row = runs("watch.evaluate")[0];
    expect(row).toMatchObject({ status: "success", rows_read: 1, rows_written: 0, rows_changed: 0 });
    const detail = JSON.parse(row.detail_json);
    expect(detail.projects).toBe(1);
    expect(detail.watch_run_ids).toHaveLength(3);
    expect((db.query("SELECT last_checked_at FROM watch WHERE id = 'w1'").get() as any).last_checked_at).toBeTruthy();
  });
});

describe("seed", () => {
  test("creates disabled default rows for the P1 handlers and never overwrites an existing row", () => {
    const d = new Database(":memory:");
    d.run("CREATE TABLE schedule_job (id TEXT PRIMARY KEY, job_key TEXT UNIQUE, cron_expr TEXT, enabled INTEGER DEFAULT 1, created_at TEXT, display_name TEXT, description TEXT, timeout_sec INTEGER, max_retries INTEGER, updated_at TEXT, updated_by TEXT, last_fire_minute TEXT)");
    d.run("INSERT INTO schedule_job (id, job_key, cron_expr, enabled, created_at) VALUES ('x','watch.evaluate','5 5 * * *',1,'t')");
    const first = seedScheduleJobs(d, utc("2026-10-29T00:00:00Z"));
    expect(first.existing).toContain("watch.evaluate");
    expect(first.inserted).toContain("gate_integrity.shadow_report");
    const w = d.query("SELECT cron_expr, enabled FROM schedule_job WHERE job_key = 'watch.evaluate'").get() as any;
    expect(w).toEqual({ cron_expr: "5 5 * * *", enabled: 1 });
    const g = d.query("SELECT cron_expr, enabled FROM schedule_job WHERE job_key = 'gate_integrity.shadow_report'").get() as any;
    expect(g).toEqual({ cron_expr: "0 8 * * 1", enabled: 0 });
    expect(seedScheduleJobs(d, utc("2026-10-29T00:00:00Z")).inserted).toEqual([]);
    const empty = new Database(":memory:");
    empty.run("CREATE TABLE schedule_job (job_key TEXT)");
    const dry = seedScheduleJobs(empty, new Date(), { dryRun: true });
    expect(dry.inserted.length).toBeGreaterThan(0);
    expect(empty.query("SELECT COUNT(*) AS c FROM schedule_job").get()).toEqual({ c: 0 });
  });
});

describe("P1 review fixes", () => {
  test("H1: children are spawned detached with no parent-side timeout", () => {
    const o = spawnOptions("/tmp/x.sqlite");
    expect(o.detached).toBe(true);
    expect("timeout" in o).toBe(false);
    expect((o.env as any).CO_NEWBIZ_DB_PATH).toBe("/tmp/x.sqlite");
  });

  test("H2: run-job's own hard backstop records a timeout and exits non-zero", async () => {
    const exits: number[] = [];
    jobs.registerJobHandler({ key: "t.hang", displayName: "t", description: "t", defaultCron: "* * * * *", timeoutSec: 600, maxRetries: 0, catchup: { mode: "skip" }, run: () => new Promise(() => {}) });
    addJob("t.hang", "* * * * *");
    const p = runJob(db, { jobKey: "t.hang", env: "dev", trigger: "schedule", backstopMsOverride: 40, exit: (c) => void exits.push(c) });
    await new Promise((r) => setTimeout(r, 120));
    expect(exits).toEqual([125]);
    const row = runs("t.hang")[0];
    expect(row.status).toBe("timeout");
    expect(row.error).toContain("backstop");
    void p;
    db.run("DELETE FROM schedule_job_lock WHERE job_key = 't.hang'");
  });

  test("M2: a claimed request with no run, older than the lease, becomes abandoned; a live one is untouched", () => {
    addJob("t.abn", "* * * * *", 1, { timeout: 60 });
    const old = sched.enqueueRequest(db, "t.abn", "u", utc("2026-10-29T10:00:00Z"));
    const fresh = sched.enqueueRequest(db, "t.abn", "u", utc("2026-10-29T13:59:00Z"));
    db.run("UPDATE schedule_job_request SET status = 'claimed' WHERE id IN (?, ?)", [old, fresh]);
    const r = sched.sweepStaleRuns(db, utc("2026-10-29T14:00:00Z"));
    expect(r.requestsAbandoned).toBe(1);
    expect((db.query("SELECT status FROM schedule_job_request WHERE id = ?").get(old) as any).status).toBe("abandoned");
    expect((db.query("SELECT status FROM schedule_job_request WHERE id = ?").get(fresh) as any).status).toBe("claimed");
  });

  test("M3: failure streaks count distinct runs; retried attempts are marked and skipped", async () => {
    db.run("DELETE FROM job_run WHERE job_key = 't.streak'");
    jobs.registerJobHandler({ key: "t.streak", displayName: "t", description: "t", defaultCron: "* * * * *", timeoutSec: 5, maxRetries: 2, catchup: { mode: "skip" }, run: () => { throw new RetryableJobError("429"); } });
    addJob("t.streak", "* * * * *", 1, { retries: 2 });
    await runJob(db, { jobKey: "t.streak", env: "dev", trigger: "schedule", retryDelayMs: 0 });
    const rows = runs("t.streak");
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => JSON.parse(r.detail_json ?? "{}").retried === true)).toEqual([true, true, false]);
    expect(sched.consecutiveFailures(db, "t.streak")).toBe(1); // one run, three attempts
  });

  test("M4: detail_json is scrubbed before stringify and stays valid JSON on overflow", () => {
    process.env.ECOS_API_KEY = ["ecos", "secret-key-777"].join("-");
    const ok = safeDetailJson({ url: "https://x?apiKey=ecos-secret-key-777", n: 1 });
    delete process.env.ECOS_API_KEY;
    expect(ok).not.toContain("ecos-secret-key-777");
    const big = safeDetailJson({ blob: "y".repeat(20000) });
    const parsed = JSON.parse(big);
    expect(parsed.truncated).toBe(true);
    expect(parsed.preview.length).toBe(1000);
    expect(big.length).toBeLessThan(8192);
  });

  test("M5/M6: generic secret names are scrubbed without importing scripts/", () => {
    const env = { MY_SERVICE_TOKEN: "tok-abcdef-1", OTHER_PASSWORD: "pw-abcdef-2", X_SECRET: "sec-abcdef-3", FOO_PASS: "pass-abcdef-4", DATABASE_URL: "postgres://u:p@h/db_abcdef", SESSION_SECRET: "sess-abcdef-5", PLAIN: "visible-value" };
    const out = scrubSecrets("a tok-abcdef-1 b pw-abcdef-2 c sec-abcdef-3 d pass-abcdef-4 e postgres://u:p@h/db_abcdef f sess-abcdef-5 g visible-value", { env });
    for (const v of ["tok-abcdef-1", "pw-abcdef-2", "sec-abcdef-3", "pass-abcdef-4", "db_abcdef", "sess-abcdef-5"]) expect(out).not.toContain(v);
    expect(out).toContain("visible-value");
    expect(readFileSync(join(import.meta.dirname, "../../db/lib/secret-scrubber.ts"), "utf-8")).not.toMatch(/from\s+["'][^"']*scripts\//);
  });

  test("M5: the run-job CLI scrubs secrets from its stdout/stderr", () => {
    const p = Bun.spawnSync([process.execPath, join(import.meta.dirname, "../../scripts/co-newbiz/run-job.ts"), "--job", "no.such.job"], {
      env: { ...process.env, CO_NEWBIZ_SCHEDULER_ENV: "dev", CO_NEWBIZ_DB_PATH: join(TMP, "cli.sqlite"), DART_API_KEY: "cli-leak-secret-0001" } as any,
    });
    const out = p.stdout.toString() + p.stderr.toString();
    expect(out).not.toContain("cli-leak-secret-0001");
  });

  test("L1: a spawn that throws after the CAS leaves a skipped job_run with reason spawn_failed", () => {
    addJob("t.spawnfail", "* * * * *");
    const s = runTick(db, { env: "dev", now: utc("2026-10-29T15:00:10Z"), spawn: () => { throw new Error("EAGAIN https://x?apiKey=abcdefghij"); } });
    expect(s.dispatched.some((d) => d.jobKey === "t.spawnfail")).toBe(true);
    const row = runs("t.spawnfail")[0];
    expect(row.status).toBe("skipped");
    expect(JSON.parse(row.detail_json).reason).toBe("spawn_failed");
    expect(row.detail_json).not.toContain("abcdefghij");
  });

  test("L4: the sweep only touches scheduler-owned rows (env IS NOT NULL)", () => {
    addJob("watch:run", "* * * * *", 0);
    db.run("INSERT INTO job_run (id, job_key, started_at, status) VALUES ('legacy-run','watch:run','2020-01-01T00:00:00.000Z','running')");
    sched.sweepStaleRuns(db, utc("2026-10-29T16:00:00Z"));
    expect((db.query("SELECT status FROM job_run WHERE id = 'legacy-run'").get() as any).status).toBe("running");
  });

  test("L5: --request must be a ULID naming a request for the same job_key", async () => {
    expect(REQUEST_ID_RE.test("not-a-ulid")).toBe(false);
    const id = sched.enqueueRequest(db, "t.ok", "u", new Date());
    expect(REQUEST_ID_RE.test(id)).toBe(true);
    expect(validateRequest(db, id, "t.ok")).toBeNull();
    expect(validateRequest(db, id, "t.fail")).toContain("not 't.fail'");
    expect(validateRequest(db, "01HZZZZZZZZZZZZZZZZZZZZZZZ", "t.ok")).toContain("not found");
    expect(validateRequest(db, "x'; DROP", "t.ok")).toContain("invalid --request");
    await expect(runJob(db, { jobKey: "t.fail", env: "dev", trigger: "manual", actor: "u", requestId: id })).rejects.toThrow(/not 't.fail'/);
    const p = Bun.spawnSync([process.execPath, join(import.meta.dirname, "../../scripts/co-newbiz/run-job.ts"), "--job", "t.ok", "--request", "bad"], {
      env: { ...process.env, CO_NEWBIZ_SCHEDULER_ENV: "dev", CO_NEWBIZ_DB_PATH: join(TMP, "cli2.sqlite") } as any,
    });
    expect(p.exitCode).toBe(2);
  });
});
