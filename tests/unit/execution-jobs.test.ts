/**
 * Unit + e2e tests for the independent parallel execution layer (design
 * 2026-09-19-sim-engine-runtime-separation §3, phase 1):
 *  - lifecycle: submit → claim → complete / fail(requeue vs exhausted, noRetry)
 *  - dispatch fairness: class filter + FIFO, cancelJob, claimJobById
 *  - stale-lock reclaim (restart survival)
 *  - e2e concurrency: TWO real worker processes claim from one scratch DB
 *    concurrently (--loop) — proves atomic claiming under SQLite's
 *    single-writer constraint (WAL + busy_timeout) and that N workers drain
 *    N jobs with attempt === 1 each (no double-claim).
 */

import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { existsSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dirname, "../..");
const TEST_DB_PATH = join(PROJECT_ROOT, "db/data/test-execution-jobs.sqlite");
process.env.CO_NEWBIZ_DB_PATH = TEST_DB_PATH;

for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);

const { resetDb, getDb } = await import("../../db/client.ts");
const { runMigrations } = await import("../../db/migrate.ts");
resetDb();
runMigrations(TEST_DB_PATH);
const db = getDb(TEST_DB_PATH);
const {
  submitJob,
  claimNextJob,
  claimJobById,
  completeJob,
  failJob,
  reclaimStaleJobs,
  cancelJob,
  classConcurrency,
} = await import("../../app/web-next/lib/execution-jobs.ts");

afterAll(async () => {
  resetDb();
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      for (const s of ["", "-wal", "-shm"]) if (existsSync(TEST_DB_PATH + s)) rmSync(TEST_DB_PATH + s);
      return;
    } catch {
      await Bun.sleep(50 * (attempt + 1));
    }
  }
});

describe("job lifecycle (single worker)", () => {
  test("submit → claim → complete records result and clears the lock", () => {
    const job = submitJob(db, { kind: "test.ok", payload: { a: 1 }, resourceClass: "numeric", createdBy: "tester" });
    expect(job.status).toBe("queued");
    const claimed = claimNextJob(db, { resourceClass: "numeric", worker: "w1" });
    expect(claimed?.id).toBe(job.id);
    expect(claimed?.attempt).toBe(1);
    expect(claimed?.locked_by).toBe("w1");
    completeJob(db, job.id, { done: true });
    const after = db.query("SELECT status, result_json, locked_by FROM execution_job WHERE id = ?").get(job.id) as
      | { status: string; result_json: string; locked_by: string | null };
    expect(after.status).toBe("succeeded");
    expect(JSON.parse(after.result_json)).toEqual({ done: true });
    expect(after.locked_by).toBeNull();
  });

  test("class filter + FIFO dispatch order", () => {
    const first = submitJob(db, { kind: "t", payload: {}, resourceClass: "llm", createdBy: "t" });
    submitJob(db, { kind: "t", payload: {}, resourceClass: "web", createdBy: "t" });
    const second = submitJob(db, { kind: "t", payload: {}, resourceClass: "llm", createdBy: "t" });
    // web 전용 워커는 llm 작업을 건드리지 않는다
    expect(claimNextJob(db, { resourceClass: "web", worker: "ww" })?.resource_class).toBe("web");
    const c1 = claimNextJob(db, { resourceClass: "llm", worker: "wl" });
    const c2 = claimNextJob(db, { resourceClass: "llm", worker: "wl" });
    expect([c1?.id, c2?.id]).toEqual([first.id, second.id]); // created_at ASC
    expect(claimNextJob(db, { resourceClass: "llm", worker: "wl" })).toBeNull();
  });

  test("failJob requeues while retries remain, fails when exhausted", () => {
    const job = submitJob(db, { kind: "t", payload: {}, resourceClass: "numeric", createdBy: "t", maxRetry: 1 });
    claimNextJob(db, { resourceClass: "numeric", worker: "w" }); // attempt 1
    expect(failJob(db, job.id, "일시 오류").requeued).toBe(true);
    const requeued = db.query("SELECT status, error FROM execution_job WHERE id = ?").get(job.id) as { status: string; error: string };
    expect(requeued.status).toBe("queued");
    expect(requeued.error).toContain("일시 오류"); // 재큐 시에도 마지막 오류 관측 가능
    claimNextJob(db, { resourceClass: "numeric", worker: "w" }); // attempt 2 = max(1)+1
    expect(failJob(db, job.id, "재시도 후에도 실패").requeued).toBe(false);
    const failed = db.query("SELECT status FROM execution_job WHERE id = ?").get(job.id) as { status: string };
    expect(failed.status).toBe("failed");
  });

  test("noRetry finalizes deterministic errors immediately (no busy spin)", () => {
    const job = submitJob(db, { kind: "unknown.kind", payload: {}, resourceClass: "llm", createdBy: "t", maxRetry: 5 });
    claimNextJob(db, { resourceClass: "llm", worker: "w" });
    expect(failJob(db, job.id, "핸들러 없음", { noRetry: true }).requeued).toBe(false);
    expect((db.query("SELECT status FROM execution_job WHERE id = ?").get(job.id) as { status: string }).status).toBe("failed");
  });

  test("claimJobById only claims a queued row; cancelJob guards queued-only", () => {
    const a = submitJob(db, { kind: "t", payload: {}, resourceClass: "web", createdBy: "t" });
    expect(claimJobById(db, a.id, { worker: "w" })?.id).toBe(a.id);
    expect(claimJobById(db, a.id, { worker: "w2" })).toBeNull(); // 이미 running
    const b = submitJob(db, { kind: "t", payload: {}, resourceClass: "web", createdBy: "t" });
    expect(cancelJob(db, b.id)).toBe(true);
    expect(cancelJob(db, b.id)).toBe(false); // queued가 아니면 불가
  });

  test("stale running locks are reclaimed on restart (requeue or fail)", () => {
    const stale = submitJob(db, { kind: "t", payload: {}, resourceClass: "numeric", createdBy: "t", maxRetry: 0 });
    claimNextJob(db, { resourceClass: "numeric", worker: "dead-worker" });
    db.run("UPDATE execution_job SET locked_at = ? WHERE id = ?", [new Date(Date.now() - 7200_000).toISOString(), stale.id]);
    const out = reclaimStaleJobs(db, { staleSec: 3600 });
    expect(out.failed).toBe(1); // maxRetry 0 — 재시도 없음 → failed
    const row = db.query("SELECT status, error FROM execution_job WHERE id = ?").get(stale.id) as { status: string; error: string };
    expect(row.status).toBe("failed");
    expect(row.error).toContain("회수");
  });

  test("concurrency caps read defaults and env overrides", () => {
    expect(classConcurrency("llm")).toBeGreaterThanOrEqual(1);
    process.env.EXECUTION_JOBS_CONCURRENCY_NUMERIC = "7";
    expect(classConcurrency("numeric")).toBe(7);
    delete process.env.EXECUTION_JOBS_CONCURRENCY_NUMERIC;
  });
});

describe("e2e — two concurrent worker processes on one DB", () => {
  test("atomic claiming: 4 jobs, 2 workers (--loop), each job runs exactly once", async () => {
    // 테스트 전용 핸들러 모듈을 tmpdir에 두고 --handlers로 로드한다.
    const dir = mkdtempSync(join(tmpdir(), "ej-test-"));
    const handlersPath = join(dir, "test-handlers.ts");
    const libPath = join(PROJECT_ROOT, "app/web-next/lib/execution-job-handlers.ts");
    require("node:fs").writeFileSync(
      handlersPath,
      `import { registerExecutionJobHandler } from ${JSON.stringify(libPath)};\n` +
        `registerExecutionJobHandler("test.echo", {\n` +
        `  resourceClass: "numeric",\n` +
        `  async run(payload) {\n` +
        `    await Bun.sleep((payload as { delayMs: number }).delayMs);\n` +
        `    return { echoed: (payload as { value: string }).value };\n` +
        `  },\n` +
        `});\n`,
    );
    for (let i = 1; i <= 4; i++) {
      submitJob(db, { kind: "test.echo", payload: { value: `v${i}`, delayMs: 250 }, resourceClass: "numeric", createdBy: "tester" });
    }
    const workerPath = join(PROJECT_ROOT, "scripts/co-newbiz/job-worker.ts");
    const env = { ...process.env, CO_NEWBIZ_DB_PATH: TEST_DB_PATH };
    const procs = [1, 2].map(() =>
      Bun.spawn(["bun", workerPath, "--loop", "--class", "numeric", "--handlers", handlersPath], { cwd: PROJECT_ROOT, env, stdout: "pipe", stderr: "pipe" })
    );
    const exits = await Promise.all(procs.map((p) => p.exited));
    const diag = await Promise.all(procs.map(async (p) => `${await new Response(p.stdout).text()}${await new Response(p.stderr).text()}`));
    const rows = db
      .query("SELECT status, attempt, result_json FROM execution_job WHERE kind = 'test.echo' ORDER BY created_at")
      .all() as Array<{ status: string; attempt: number; result_json: string | null }>;
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.status === "succeeded"), JSON.stringify({ rows, exits, diag })).toBe(true);
    expect(rows.every((r) => r.attempt === 1)).toBe(true); // 이중 선점 없음
    expect(JSON.parse(rows[0].result_json!)).toEqual({ echoed: "v1" });
    // 워커 종료 코드: 큐를 다 비웠으므로 0 (실패 없음)
    expect(exits.every((c) => c === 0)).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  }, 30000);
});
