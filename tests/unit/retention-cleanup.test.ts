// @version 1.0.0
/**
 * Retention executor (ADR-0189 phase P6, scheduled-jobs design sections 3.3, 8-P6, 9, 10-D2/D6):
 * the code-level allow-list (audit_log hard refusal, non-allow-listed refusal), deterministic
 * cutoff math by the declared basis column (month boundary), archive-before-delete ordering,
 * archive idempotency (PK dedupe within the month file), the <= 1,000-row batch loop (small
 * injected batch constant), the execution_job terminal-status filter, dry-run (writes nothing,
 * reports planned counts), last_run_at on success only, raw_payload empty-table no-op, rerun
 * no-op, and the handler registration/seed contract.
 *
 * Everything runs against a scratch SQLite under the OS temp dir (never the dev 7748 or prod 7749
 * DB) with archives in a scratch dir. NO network anywhere.
 */
import { test, expect, describe, afterAll, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

const TMP = mkdtempSync(join(tmpdir(), "retention-cleanup-"));
const TEST_DB_PATH = join(TMP, "retention.sqlite");
const ARCHIVE_DIR = join(TMP, "archive");
process.env.CO_NEWBIZ_LLM_PROVIDER = "none";
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);

const { runRetention, RetentionPolicyError, RETENTION_ALLOW_LIST, EXECUTION_JOB_TERMINAL_STATUSES } = await import(
  "../../scripts/co-newbiz/jobs/retention-cleanup.ts"
);
const { retentionCleanup } = await import("../../scripts/co-newbiz/jobs/retention-cleanup.ts");
type RetentionPolicyErrorT = import("../../scripts/co-newbiz/jobs/retention-cleanup.ts").RetentionPolicyError;
type JobResultT = import("../../scripts/co-newbiz/jobs/types.ts").JobResult;
type RetentionRunResultT = import("../../scripts/co-newbiz/jobs/retention-cleanup.ts").RetentionRunResult;
const { listJobHandlers } = await import("../../scripts/co-newbiz/jobs/index.ts");
const { seedScheduleJobs, seedRetentionPolicies } = await import("../../scripts/co-newbiz/schedule-seed.ts");
const reg = await import("../../db/lib/retention-registry.ts");

// Fixed clock: cutoffs are deterministic UTC calendar-month subtractions.
const NOW = new Date("2026-11-02T03:00:00.000Z");
// 12-month cutoff = 2025-11-02; 24-month cutoff = 2024-11-02; 6-month cutoff = 2026-05-02.

afterAll(() => {
  resetDb();
  rmSync(TMP, { recursive: true, force: true });
});

// ── env hygiene (the handler reads RETENTION_* from process.env) ────────────
const RETENTION_ENVS = ["RETENTION_DRY_RUN", "RETENTION_BATCH_SIZE", "RETENTION_ARCHIVE_DIR"];
let savedEnv: Record<string, string | undefined>;
beforeEach(() => {
  savedEnv = Object.fromEntries(RETENTION_ENVS.map((k) => [k, process.env[k]]));
  for (const k of RETENTION_ENVS) delete process.env[k];
  db.run("DELETE FROM retention_policy");
  for (const t of ["job_run", "notification", "raw_payload", "execution_job", "session", "llm_call_log"])
    db.run(`DELETE FROM ${t}`);
  rmSync(ARCHIVE_DIR, { recursive: true, force: true });
});
afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

// ── fixtures ────────────────────────────────────────────────────────────────
let seq = 0;
const uid = () => `id-${String(++seq).padStart(6, "0")}`;

function setPolicy(table_key: string, basis: string, retention_months: number, action: string) {
  db.run(
    "INSERT INTO retention_policy (table_key, basis, retention_months, action, last_run_at) VALUES (?,?,?,?,NULL)",
    [table_key, basis, retention_months, action],
  );
}

function seedJobRun(at: string, jobKey = "watch.evaluate") {
  const id = uid();
  db.run("INSERT INTO job_run (id, job_key, started_at, status) VALUES (?,?,?, 'success')", [id, jobKey, at]);
  return id;
}

function seedNotification(sentAt: string, id = uid()) {
  db.run(
    "INSERT INTO notification (id, user_id, trigger_type, severity, payload, channel, bundle, sent_at) VALUES (?,?,?,?,?,?,?,?)",
    [id, "system", "threshold_breach", "info", "{}", "in_app", "immediate", sentAt],
  );
  return id;
}

function seedRawPayload(fetchedAt: string, id = uid()) {
  db.run("INSERT INTO raw_payload (id, source_id, fetched_at, content_hash, payload) VALUES (?,?,?,?,?)", [
    id,
    "fixture-source",
    fetchedAt,
    "hash",
    "{}",
  ]);
  return id;
}

function seedExecutionJob(status: string, createdAt: string) {
  const id = uid();
  db.run(
    "INSERT INTO execution_job (id, kind, payload_json, resource_class, status, created_by, created_at) VALUES (?,?,?,?,?,?,?)",
    [id, "reprofile", "{}", "numeric", status, "system", createdAt],
  );
  return id;
}

function seedLlmCallLog(createdAt: string, id = uid()) {
  db.run("INSERT INTO llm_call_log (id, agent_key, purpose, source, created_by, created_at) VALUES (?,?,?,?,?,?)", [
    id,
    "backend-engineer",
    "draft",
    "llm",
    "system",
    createdAt,
  ]);
  return id;
}

function seedSession(expiresAt: string) {
  const id = uid();
  db.run(
    "INSERT INTO app_user (id, user_id, role, status, password_salt, password_hash, password_iterations, created_at) VALUES (?,?,?,?,?,?,?,?)",
    [`u-${id}`, `user-${id}`, "analyst", "active", "salt", "hash", 210000, "2020-01-01T00:00:00.000Z"],
  );
  db.run("INSERT INTO session (id, user_id, token_hash, created_at, expires_at) VALUES (?,?,?,?,?)", [
    id,
    `user-${id}`,
    `tok-${id}`,
    "2020-01-01T00:00:00.000Z",
    expiresAt,
  ]);
  return id;
}

function countRows(table: string): number {
  return (db.query(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

function readArchiveLines(table: string, month: string): Array<Record<string, unknown>> {
  const path = join(ARCHIVE_DIR, table, `${month}.jsonl.gz`);
  return gunzipSync(require("node:fs").readFileSync(path))
    .toString("utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

const run = (opts: { dryRun?: boolean; batchSize?: number } = {}) =>
  runRetention(db, { now: NOW, dryRun: opts.dryRun, batchSize: opts.batchSize, archiveDir: ARCHIVE_DIR });

// ── allow-list enforcement ──────────────────────────────────────────────────
describe("allow-list enforcement", () => {
  test("a policy row naming audit_log fails the run and deletes nothing (ADR-0012 hard refusal)", () => {
    const kept = seedJobRun("2024-01-01T00:00:00.000Z");
    setPolicy("audit_log", "at", 3, "delete");
    setPolicy("job_run", "started_at", 12, "delete");
    let err: unknown;
    try {
      run();
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(RetentionPolicyError);
    const issues = (err as RetentionPolicyErrorT).issues;
    expect(issues).toHaveLength(1);
    expect(issues[0].table_key).toBe("audit_log");
    expect(issues[0].code).toBe("table_not_allowed");
    // nothing was touched: the valid job_run policy was NOT executed (all-or-nothing validation)
    expect(countRows("job_run")).toBe(1);
    expect(db.query("SELECT id FROM job_run").get()).toEqual({ id: kept });
    // error message is structural (names the offending table, no row data)
    expect((err as Error).message).toContain("audit_log");
    // last_run_at untouched on error
    expect(
      (
        db.query("SELECT last_run_at FROM retention_policy WHERE table_key='job_run'").get() as {
          last_run_at: string | null;
        }
      ).last_run_at,
    ).toBeNull();
  });

  test("a policy row for any non-allow-listed table fails the same way", () => {
    setPolicy("md_company", "updated_at", 6, "delete");
    expect(() => run()).toThrow(RetentionPolicyError);
    expect(countRows("md_company")).toBeGreaterThan(0);
  });

  test("a policy row whose basis mismatches the declared basis is an error", () => {
    setPolicy("notification", "created_at", 12, "delete"); // declared basis is sent_at
    let err: unknown;
    try {
      run();
    } catch (e) {
      err = e;
    }
    expect((err as RetentionPolicyErrorT).issues[0].code).toBe("basis_mismatch");
  });

  test("a policy row whose stored action differs from the registry-derived stored action is an error (dba guard, 2026-11-02, reconciled vocabulary)", () => {
    // The stored action must equal handlingToStoredAction(entry.handling) - the SAME mapping the
    // seeder and the admin route derive from. notification is archive_then_delete -> stored
    // 'delete'; a hand-written row with action 'archive' contradicts the handling and fails loud
    // (nothing deleted, nothing archived) instead of running under ambiguous semantics.
    const kept = seedNotification("2025-06-01T00:00:00.000Z");
    setPolicy("notification", "sent_at", 12, "archive"); // expected stored action is 'delete'
    let err: unknown;
    try {
      run();
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(RetentionPolicyError);
    expect((err as RetentionPolicyErrorT).issues[0].code).toBe("action_mismatch");
    expect(countRows("notification")).toBe(1);
    expect((db.query("SELECT id FROM notification").get() as { id: string }).id).toBe(kept);
    expect(existsSync(ARCHIVE_DIR)).toBe(false);

    // a delete_only table with 'archive' fails the same way (plain-delete tables never archive)
    setPolicy("job_run", "started_at", 12, "archive");
    try {
      run();
    } catch (e) {
      err = e;
    }
    expect((err as RetentionPolicyErrorT).issues[0].code).toBe("action_mismatch");
    expect((err as RetentionPolicyErrorT).issues[0].message).toContain("delete_only");
  });
});

// ── cutoff math ─────────────────────────────────────────────────────────────
describe("cutoff math (basis column, month boundary)", () => {
  test("12-month delete on job_run: strictly-older deleted, boundary row kept", () => {
    setPolicy("job_run", "started_at", 12, "delete");
    const old1 = seedJobRun("2025-10-31T23:59:59.999Z");
    const boundary = seedJobRun("2025-11-02T03:00:00.000Z"); // exactly at the cutoff -> kept
    const fresh = seedJobRun("2025-11-03T00:00:00.000Z");
    const res = run();
    expect(res.tables[0].cutoff).toBe("2025-11-02T03:00:00.000Z");
    expect(res.tables[0].rows_deleted).toBe(1);
    expect(countRows("job_run")).toBe(2);
    const ids = (db.query("SELECT id FROM job_run").all() as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toContain(boundary);
    expect(ids).toContain(fresh);
    expect(ids).not.toContain(old1);
  });

  test("each table uses its own declared basis column (notification.sent_at, session.expires_at)", () => {
    setPolicy("notification", "sent_at", 12, "delete");
    setPolicy("session", "expires_at", 12, "delete");
    // session created long ago but expires in the future -> kept despite old created_at
    const sid = seedSession("2027-01-01T00:00:00.000Z");
    const nid = seedNotification("2025-06-01T00:00:00.000Z");
    const res = run();
    const sessionReport = res.tables.find((t) => t.table === "session");
    const notifReport = res.tables.find((t) => t.table === "notification");
    expect(sessionReport?.basis).toBe("expires_at");
    expect(sessionReport?.rows_deleted).toBe(0);
    expect(notifReport?.rows_to_archive).toBe(1);
    expect(countRows("session")).toBe(1);
    expect((db.query("SELECT id FROM session").get() as { id: string }).id).toBe(sid);
    expect(countRows("notification")).toBe(0);
    void nid;
  });
});

// ── archive before delete ───────────────────────────────────────────────────
describe("archive before delete", () => {
  test("archived rows are in the month file with _archived_at AND gone from the table", () => {
    setPolicy("notification", "sent_at", 12, "delete");
    const a = seedNotification("2025-09-15T10:00:00.000Z");
    const b = seedNotification("2025-10-20T10:00:00.000Z");
    const res = run();
    // one file per row's basis month
    expect(res.tables[0].archive_files.sort()).toEqual([
      join(ARCHIVE_DIR, "notification", "2025-09.jsonl.gz"),
      join(ARCHIVE_DIR, "notification", "2025-10.jsonl.gz"),
    ]);
    const sep = readArchiveLines("notification", "2025-09");
    expect(sep).toHaveLength(1);
    expect(sep[0].id).toBe(a);
    expect(sep[0]._archived_at).toBe(NOW.toISOString());
    expect(sep[0].trigger_type).toBe("threshold_breach"); // full row object
    const oct = readArchiveLines("notification", "2025-10");
    expect(oct.map((r) => r.id)).toEqual([b]);
    expect(countRows("notification")).toBe(0);
  });

  test("archive idempotency: a row already present in the month file is not written twice", () => {
    setPolicy("notification", "sent_at", 12, "delete");
    const id = seedNotification("2025-09-15T10:00:00.000Z");
    // simulate a crash between archive and delete: the month file already holds this row
    const pre = JSON.stringify({
      id,
      user_id: "system",
      sent_at: "2025-09-15T10:00:00.000Z",
      _archived_at: "2026-10-02T03:00:00.000Z",
    });
    require("node:fs").mkdirSync(join(ARCHIVE_DIR, "notification"), { recursive: true });
    require("node:fs").writeFileSync(
      join(ARCHIVE_DIR, "notification", "2025-09.jsonl.gz"),
      Bun.gzipSync(Buffer.from(`${pre}\n`)),
    );
    const res = run();
    expect(res.tables[0].rows_to_archive).toBe(1);
    const lines = readArchiveLines("notification", "2025-09");
    expect(lines).toHaveLength(1); // no duplicate JSONL line
    expect(lines[0].id).toBe(id);
    expect(lines[0]._archived_at).toBe("2026-10-02T03:00:00.000Z"); // the ORIGINAL archived line survives
    expect(countRows("notification")).toBe(0); // and the delete still happened
  });

  test("delete-action policies never write archive files", () => {
    setPolicy("job_run", "started_at", 12, "delete");
    seedJobRun("2025-01-01T00:00:00.000Z");
    run();
    expect(existsSync(join(ARCHIVE_DIR, "job_run"))).toBe(false);
  });
});

// ── batching ────────────────────────────────────────────────────────────────
describe("batch loop", () => {
  test(">1,000 rows are processed in injected small batches until under the cutoff", () => {
    setPolicy("job_run", "started_at", 12, "delete");
    db.run("BEGIN");
    for (let i = 0; i < 1050; i++) {
      db.run("INSERT INTO job_run (id, job_key, started_at, status) VALUES (?,?,?, 'success')", [
        `batch-${String(i).padStart(6, "0")}`,
        "watch.evaluate",
        i % 2 === 0 ? "2025-01-01T00:00:00.000Z" : "2025-06-01T00:00:00.000Z",
      ]);
    }
    db.run("COMMIT");
    const res = run({ batchSize: 200 });
    expect(res.tables[0].rows_deleted).toBe(1050);
    expect(res.tables[0].batches).toBe(Math.ceil(1050 / 200)); // 6 batches, each <= 200 rows
    expect(countRows("job_run")).toBe(0);
  });
});

// ── execution_job terminal filter ───────────────────────────────────────────
describe("execution_job terminal-status filter", () => {
  test("only succeeded/failed/cancelled rows past the cutoff are deleted; queued/running kept", () => {
    setPolicy("execution_job", "created_at", 6, "delete");
    const oldSucceeded = seedExecutionJob("succeeded", "2026-01-01T00:00:00.000Z");
    const oldFailed = seedExecutionJob("failed", "2026-02-01T00:00:00.000Z");
    const oldCancelled = seedExecutionJob("cancelled", "2026-03-01T00:00:00.000Z");
    const oldQueued = seedExecutionJob("queued", "2026-01-15T00:00:00.000Z");
    const oldRunning = seedExecutionJob("running", "2026-02-15T00:00:00.000Z");
    const freshQueued = seedExecutionJob("queued", "2026-10-01T00:00:00.000Z");
    const res = run();
    expect(res.tables[0].rows_deleted).toBe(3);
    const left = (db.query("SELECT id, status FROM execution_job").all() as Array<{ id: string; status: string }>).map(
      (r) => r.id,
    );
    expect(left).toContain(oldQueued);
    expect(left).toContain(oldRunning);
    expect(left).toContain(freshQueued);
    expect(left).not.toContain(oldSucceeded);
    expect(left).not.toContain(oldFailed);
    expect(left).not.toContain(oldCancelled);
    expect(EXECUTION_JOB_TERMINAL_STATUSES).toEqual(["succeeded", "failed", "cancelled"]);
  });
});

// ── dry-run ─────────────────────────────────────────────────────────────────
describe("dry-run", () => {
  test("writes nothing but reports planned counts and the would-be archive path", () => {
    setPolicy("notification", "sent_at", 12, "delete");
    setPolicy("job_run", "started_at", 12, "delete");
    seedNotification("2025-03-05T00:00:00.000Z");
    seedNotification("2026-10-05T00:00:00.000Z");
    seedJobRun("2024-05-05T00:00:00.000Z");
    const res = run({ dryRun: true });
    expect(res.dry_run).toBe(true);
    const notif = res.tables.find((t) => t.table === "notification");
    const jobRun = res.tables.find((t) => t.table === "job_run");
    expect(notif?.rows_to_archive).toBe(1);
    expect(notif?.rows_deleted).toBe(1); // planned
    expect(notif?.archive_files).toEqual([join(ARCHIVE_DIR, "notification", "2025-03.jsonl.gz")]);
    expect(jobRun?.rows_to_archive).toBe(0);
    expect(jobRun?.rows_deleted).toBe(1);
    // nothing written anywhere
    expect(countRows("notification")).toBe(2);
    expect(countRows("job_run")).toBe(1);
    expect(existsSync(ARCHIVE_DIR)).toBe(false);
    // last_run_at untouched on dry-run
    expect(
      (
        db.query("SELECT last_run_at FROM retention_policy WHERE table_key='notification'").get() as {
          last_run_at: string | null;
        }
      ).last_run_at,
    ).toBeNull();
  });
});

// ── last_run_at ─────────────────────────────────────────────────────────────
describe("last_run_at", () => {
  test("updated on a successful non-dry run, for the processed table only", () => {
    setPolicy("job_run", "started_at", 12, "delete");
    seedJobRun("2025-01-01T00:00:00.000Z");
    run();
    expect(
      (
        db.query("SELECT last_run_at FROM retention_policy WHERE table_key='job_run'").get() as {
          last_run_at: string | null;
        }
      ).last_run_at,
    ).toBe(NOW.toISOString());
  });

  test("raw_payload empty-table no-op succeeds and still records last_run_at", () => {
    setPolicy("raw_payload", "fetched_at", 24, "archive");
    const res = run();
    expect(res.tables[0].noop).toBe(true);
    expect(res.tables[0].rows_to_archive).toBe(0);
    expect(existsSync(join(ARCHIVE_DIR, "raw_payload"))).toBe(false);
    expect(
      (
        db.query("SELECT last_run_at FROM retention_policy WHERE table_key='raw_payload'").get() as {
          last_run_at: string | null;
        }
      ).last_run_at,
    ).toBe(NOW.toISOString());
  });
});

// ── idempotency ─────────────────────────────────────────────────────────────
describe("rerun no-op", () => {
  test("a second run changes nothing and writes no new archive lines", () => {
    setPolicy("notification", "sent_at", 12, "delete");
    seedNotification("2025-04-05T00:00:00.000Z");
    const first = run();
    expect(first.tables[0].rows_deleted).toBe(1);
    const firstLines = readArchiveLines("notification", "2025-04");
    const second = run();
    expect(second.tables[0].rows_deleted).toBe(0);
    expect(second.tables[0].noop).toBe(true);
    expect(readArchiveLines("notification", "2025-04")).toEqual(firstLines);
    expect(countRows("notification")).toBe(0);
  });
});

// ── allow-list constant + handler registration/seed contract ────────────────
describe("allow-list constant and handler contract", () => {
  test("D2/dba defaults are recorded on the entries and audit_log is absent", () => {
    const byTable = new Map(RETENTION_ALLOW_LIST.map((e) => [e.table, e]));
    expect(byTable.get("job_run")).toMatchObject({ defaultMonths: 12, handling: "delete_only", basis: "started_at" });
    expect(byTable.get("notification")).toMatchObject({
      defaultMonths: 12,
      handling: "archive_then_delete",
      basis: "sent_at",
    });
    expect(byTable.get("llm_call_log")).toMatchObject({
      defaultMonths: 12,
      handling: "archive_then_delete",
      basis: "created_at",
    });
    expect(byTable.get("raw_payload")).toMatchObject({
      defaultMonths: 24,
      handling: "archive_only",
      basis: "fetched_at",
    });
    expect(byTable.get("execution_job")).toMatchObject({
      defaultMonths: 6,
      handling: "delete_only",
      terminalOnly: true,
    });
    // dba ruling 2026-11-02: session is IN at 1 month on expires_at (12h TTL table - a session
    // expired >= 1 month is dead beyond any forensic need; expires_at basis can never match a
    // live session regardless of created_at).
    expect(byTable.get("session")).toMatchObject({ defaultMonths: 1, handling: "delete_only", basis: "expires_at" });
    expect(byTable.has("audit_log")).toBe(false);
    expect(byTable.has("dry_run_session")).toBe(false);
  });

  test("retention.cleanup is registered; schedule-seed creates it disabled with cron/timeout/retries", () => {
    const handler = listJobHandlers().find((h) => h.key === "retention.cleanup");
    expect(handler).toBeDefined();
    expect(handler?.defaultCron).toBe("0 3 * * *");
    expect(handler?.timeoutSec).toBe(30 * 60);
    expect(handler?.maxRetries).toBe(0);
    const seeded = seedScheduleJobs(db, NOW);
    expect(seeded.inserted).toContain("retention.cleanup");
    const row = db
      .query("SELECT cron_expr, enabled, timeout_sec, max_retries FROM schedule_job WHERE job_key='retention.cleanup'")
      .get() as {
      cron_expr: string;
      enabled: number;
      timeout_sec: number;
      max_retries: number;
    };
    expect(row).toEqual({ cron_expr: "0 3 * * *", enabled: 0, timeout_sec: 1800, max_retries: 0 });
  });

  test("handler honours RETENTION_DRY_RUN=1 from the environment", async () => {
    setPolicy("job_run", "started_at", 12, "delete");
    seedJobRun("2025-01-01T00:00:00.000Z");
    process.env.RETENTION_DRY_RUN = "1";
    process.env.RETENTION_ARCHIVE_DIR = ARCHIVE_DIR;
    const ctx = {
      db,
      now: NOW,
      env: "dev" as const,
      signal: new AbortController().signal,
      reportDir: join(TMP, "reports"),
    };
    const out = (await retentionCleanup.run(ctx)) as JobResultT;
    expect((out.detail as RetentionRunResultT).dry_run).toBe(true);
    expect(countRows("job_run")).toBe(1);
    delete process.env.RETENTION_DRY_RUN;
    const out2 = (await retentionCleanup.run(ctx)) as JobResultT;
    expect((out2.detail as RetentionRunResultT).dry_run).toBe(false);
    expect(out2.rowsChanged).toBe(1);
    expect(countRows("job_run")).toBe(0);
    // archive dir override honoured: dry-run named the injected dir, real run wrote nothing (delete action)
  });

  test("archive files land as <archiveDir>/<table>/<yyyy-mm>.jsonl.gz only (D6 layout)", () => {
    setPolicy("notification", "sent_at", 12, "delete");
    seedNotification("2025-05-05T00:00:00.000Z");
    run();
    const tables = readdirSync(ARCHIVE_DIR);
    expect(tables).toEqual(["notification"]);
    const files = readdirSync(join(ARCHIVE_DIR, "notification"));
    expect(files).toEqual(["2025-05.jsonl.gz"]);
  });
});

// ── registry reconciliation (dba adjudication 2026-11-02 + owner adoption) ───
describe("stored-action vocabulary round-trip (registry -> seeder -> executor)", () => {
  test("a seeded notification row (stored 'delete') archives-then-deletes: the action_mismatch guard never fires", () => {
    // End-to-end proof of the reconciled vocabulary: the seeder stores 'delete' for an
    // archive_then_delete table, and the executor understands that as archive-then-delete
    // (behavior is pinned by entry.handling, never read from the stored action).
    setPolicy("notification", "sent_at", 12, "delete"); // exactly what seedRetentionPolicies writes
    const id = seedNotification("2025-07-15T00:00:00.000Z");
    const res = run();
    expect(res.tables[0].handling).toBe("archive_then_delete");
    expect(res.tables[0].action).toBe("delete");
    expect(res.tables[0].rows_to_archive).toBe(1);
    expect(res.tables[0].rows_deleted).toBe(1);
    expect(readArchiveLines("notification", "2025-07").map((r) => r.id)).toEqual([id]);
    expect(countRows("notification")).toBe(0);
  });

  test("llm_call_log (dba-adopted volume table) archives-then-deletes on created_at at 12 months", () => {
    setPolicy("llm_call_log", "created_at", 12, "delete");
    const old = seedLlmCallLog("2025-05-01T00:00:00.000Z");
    seedLlmCallLog("2026-10-01T00:00:00.000Z");
    const res = run();
    expect(res.tables[0].handling).toBe("archive_then_delete");
    expect(res.tables[0].rows_deleted).toBe(1);
    expect(readArchiveLines("llm_call_log", "2025-05").map((r) => r.id)).toEqual([old]);
    expect(countRows("llm_call_log")).toBe(1);
  });

  test("archive_only handling archives but NEVER deletes (raw_payload lineage)", () => {
    setPolicy("raw_payload", "fetched_at", 24, "archive");
    // fixture only (no ingest path writes raw_payload): bypass the data_source FK the same way
    // admin-retention-registry.test.ts does for its fixture rows
    db.run("PRAGMA foreign_keys = OFF");
    const id = seedRawPayload("2020-01-01T00:00:00.000Z");
    db.run("PRAGMA foreign_keys = ON");
    const res = run();
    expect(res.tables[0].handling).toBe("archive_only");
    expect(res.tables[0].rows_to_archive).toBe(1);
    expect(res.tables[0].rows_deleted).toBe(0);
    expect(readArchiveLines("raw_payload", "2020-01").map((r) => r.id)).toEqual([id]);
    // the row SURVIVES the run - archiving never implies deletion for archive_only
    expect(countRows("raw_payload")).toBe(1);
    // rerun: the surviving row is re-processed (it is still under the cutoff) but the archive
    // dedupe writes no new line, and it is STILL not deleted
    const second = run();
    expect(second.tables[0].rows_to_archive).toBe(1);
    expect(readArchiveLines("raw_payload", "2020-01").map((r) => r.id)).toEqual([id]);
    expect(readArchiveLines("raw_payload", "2020-01")[0]._archived_at).toBe(NOW.toISOString());
    expect(countRows("raw_payload")).toBe(1);
  });
});

// ── seedRetentionPolicies (registry reconciliation, part A) ──────────────────
describe("seedRetentionPolicies", () => {
  test("seeds one row per registry-eligible table with the registry defaults and derived stored action", () => {
    const res = seedRetentionPolicies(db);
    expect(res.inserted.sort()).toEqual([...reg.RETENTION_ELIGIBLE_TABLES.map((t) => t.table)].sort());
    expect(res.existing).toEqual([]);
    for (const t of reg.RETENTION_ELIGIBLE_TABLES) {
      const row = db
        .query("SELECT basis, retention_months, action, last_run_at FROM retention_policy WHERE table_key = ?")
        .get(t.table) as {
        basis: string;
        retention_months: number;
        action: string;
        last_run_at: string | null;
      };
      expect(row).toEqual({
        basis: t.defaultBasis,
        retention_months: t.defaultMonths,
        action: reg.handlingToStoredAction(t.handling),
        last_run_at: null,
      });
    }
    // the concrete D2/dba contract
    expect(db.query("SELECT action FROM retention_policy WHERE table_key='notification'").get()).toEqual({
      action: "delete",
    });
    expect(db.query("SELECT action FROM retention_policy WHERE table_key='session'").get()).toEqual({
      action: "delete",
    });
    expect(db.query("SELECT retention_months FROM retention_policy WHERE table_key='session'").get()).toEqual({
      retention_months: 1,
    });
    expect(db.query("SELECT COUNT(*) AS n FROM retention_policy WHERE table_key='dry_run_session'").get().n).toBe(0);
  });

  test("is idempotent and never touches an existing row (the dev 6-month notification row wins)", () => {
    db.run("DELETE FROM retention_policy");
    db.run(
      "INSERT INTO retention_policy (table_key, basis, retention_months, action, last_run_at) VALUES ('notification','sent_at',6,'delete',NULL)",
    );
    const first = seedRetentionPolicies(db);
    expect(first.inserted).not.toContain("notification");
    expect(first.existing).toEqual(["notification"]);
    expect(db.query("SELECT retention_months FROM retention_policy WHERE table_key='notification'").get()).toEqual({
      retention_months: 6,
    });
    const second = seedRetentionPolicies(db);
    expect(second.inserted).toEqual([]);
    expect(second.existing.sort()).toEqual([...reg.RETENTION_ELIGIBLE_TABLES.map((t) => t.table)].sort());
    expect(db.query("SELECT retention_months FROM retention_policy WHERE table_key='notification'").get()).toEqual({
      retention_months: 6,
    });
  });

  test("dry-run inserts nothing but reports the full plan", () => {
    db.run("DELETE FROM retention_policy");
    const res = seedRetentionPolicies(db, { dryRun: true });
    expect(res.inserted.sort()).toEqual([...reg.RETENTION_ELIGIBLE_TABLES.map((t) => t.table)].sort());
    expect(db.query("SELECT COUNT(*) AS n FROM retention_policy").get().n).toBe(0);
  });
});

// ── cross-module invariant: registry == executor, seeded rows always pass ────
describe("cross-module invariant: a seeded/registry-created policy row always passes the executor guard", () => {
  test("RETENTION_ALLOW_LIST and RETENTION_ELIGIBLE_TABLES agree table-for-table (set, basis, months, handling)", () => {
    const byExecutor = new Map(RETENTION_ALLOW_LIST.map((e) => [e.table, e]));
    const byRegistry = new Map(reg.RETENTION_ELIGIBLE_TABLES.map((t) => [t.table, t]));
    expect([...byExecutor.keys()].sort()).toEqual([...byRegistry.keys()].sort());
    for (const [table, e] of byExecutor) {
      const r = byRegistry.get(table);
      if (!r) throw new Error(`registry entry missing for table '${table}'`);
      expect(e.basis).toBe(r.defaultBasis);
      expect(e.basis).toBe(r.dateColumns[0].column);
      expect(e.defaultMonths).toBe(r.defaultMonths);
      expect(e.handling).toBe(r.handling);
      // registry lists ONLY the executor-declared basis as an eligible column
      expect(r.dateColumns).toHaveLength(1);
      // dry_run_session is excluded on both sides (executor-refused, read-path purge per 0172)
      expect(reg.RETENTION_EXCLUDED_TABLES.dry_run_session).toBeDefined();
    }
  });

  test("runRetention accepts EVERY seeded row (zero policies error) - dry-run over a live schema", () => {
    db.run("DELETE FROM retention_policy");
    seedRetentionPolicies(db);
    // empty tables: validation still exercises every row (PRAGMA basis check included)
    const res = run({ dryRun: true });
    expect(res.dry_run).toBe(true);
    expect(res.tables.map((t) => t.table).sort()).toEqual(
      [...reg.RETENTION_ELIGIBLE_TABLES.map((t) => t.table)].sort(),
    );
    for (const t of res.tables) expect(t.noop).toBe(true);
    // and the real run validates the same rows without RetentionPolicyError
    expect(() => run()).not.toThrow(RetentionPolicyError);
  });
});
