// execution-jobs.ts — 독립 병렬 실행 계층의 코어 (design
// 2026-09-19-sim-engine-runtime-separation §3). 이 파일은 기능을 모른다:
// 산업 재분석·스윕·프로필 재분석은 어댑터(lib/execution-job-handlers.ts)로
// 등록하고, 이곳은 제출·선점·완료/실패·재시도·회수의 저장 계약만 소유한다.
// SQLite 단일 writer 제약: claim은 BEGIN IMMEDIATE 트랜잭션의 원자적
// UPDATE로 직렬화하고(busy_timeout은 db/client.ts가 전역 설정), 그 외 쓰기는
// 짧은 단일 문장이다.
import { getDb } from "../../../db/client.ts";
import { ulid } from "../../../db/lib/ulid.ts";

/** 계층 전반에서 쓰는 DB 연결 타입 — 핸들러 컨텍스트에도 전달된다. */
export type Db = ReturnType<typeof getDb>;

export type ResourceClass = "llm" | "web" | "numeric";
export type ExecutionJobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface ExecutionJobRow {
  id: string;
  kind: string;
  payload_json: string;
  resource_class: ResourceClass;
  status: ExecutionJobStatus;
  attempt: number;
  max_retry: number;
  timeout_sec: number;
  locked_by: string | null;
  locked_at: string | null;
  result_json: string | null;
  error: string | null;
  created_by: string;
  created_at: string;
  updated_at: string | null;
}

/** 클래스별 동시 실행 상한 — 병렬 팬아웃의 상한은 계층이 정의한다.
 *  env EXECUTION_JOBS_CONCURRENCY_{LLM|WEB|NUMERIC} 로 배포 단위 덮어쓰기. */
export const DEFAULT_CLASS_CONCURRENCY: Record<ResourceClass, number> = { llm: 3, web: 2, numeric: 2 };

export function classConcurrency(cls: ResourceClass): number {
  const v = process.env[`EXECUTION_JOBS_CONCURRENCY_${cls.toUpperCase()}`];
  const n = v ? Number(v) : NaN;
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_CLASS_CONCURRENCY[cls];
}

export function submitJob(
  db: Db,
  input: { kind: string; payload: unknown; resourceClass: ResourceClass; createdBy: string; maxRetry?: number; timeoutSec?: number },
): ExecutionJobRow {
  const id = ulid();
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO execution_job (id, kind, payload_json, resource_class, status, max_retry, timeout_sec, created_by, created_at)
     VALUES (?,?,?,?, 'queued', ?, ?, ?, ?)`,
    [id, input.kind, JSON.stringify(input.payload ?? {}), input.resourceClass, input.maxRetry ?? 2, input.timeoutSec ?? 600, input.createdBy, now],
  );
  return db.query("SELECT * FROM execution_job WHERE id = ?").get(id) as ExecutionJobRow;
}

/** 다음 queued 작업을 원자적으로 선점한다. BEGIN IMMEDIATE로 쓰기 잠금을 먼저
 *  잡고 SELECT→UPDATE를 한 트랜잭션으로 묶는다 — 두 워커가 같은 행을 잡는
 *  경합은 UPDATE ... WHERE status='queued'의 changes 검사로 판정한다.
 *  attempt는 "총 실행 횟수"로 선점 시점에 1씩 올린다(첫 실행 = 1). */
export function claimNextJob(db: Db, opts: { resourceClass?: ResourceClass; worker: string }): ExecutionJobRow | null {
  const now = new Date().toISOString();
  try {
    // db.transaction(fn)은 트랜잭션 함수를 반환한다 — 즉시 호출해 실행한다.
    const claimed = db.transaction(() => {
      const next = db
        .query(
          `SELECT id FROM execution_job WHERE status = 'queued' ${opts.resourceClass ? "AND resource_class = ?" : ""} ORDER BY created_at ASC, id ASC LIMIT 1`,
        )
        .get(...(opts.resourceClass ? [opts.resourceClass] : [])) as { id: string } | undefined;
      if (!next) return null;
      const res = db.run(
        `UPDATE execution_job SET status = 'running', attempt = attempt + 1, locked_by = ?, locked_at = ?, updated_at = ? WHERE id = ? AND status = 'queued'`,
        [opts.worker, now, now, next.id],
      );
      if (res.changes !== 1) return null; // 동시 선점 패배 — 이번 틱은 스킵
      return db.query("SELECT * FROM execution_job WHERE id = ?").get(next.id) as ExecutionJobRow;
      // immediate: take the write lock up front so busy_timeout applies. A deferred
      // SELECT→UPDATE upgrade fails instantly with SQLITE_BUSY when another worker commits
      // in between, the catch below then returned null, and --loop workers exited with
      // jobs still queued (flaky execution-jobs e2e).
    }).immediate() as ExecutionJobRow | null;
    return claimed ?? null;
  } catch {
    return null; // 예: BUSY — busy_timeout 후에도 실패면 이번 틱 스킵(워커 루프가 재시도)
  }
}

/** 특정 작업을 원자적으로 선점(디버그·재실행 경로). 대기 상태가 아니면 null. */
export function claimJobById(db: Db, jobId: string, opts: { worker: string }): ExecutionJobRow | null {
  const now = new Date().toISOString();
  try {
    const claimed = db.transaction(() => {
      const res = db.run(
        `UPDATE execution_job SET status = 'running', attempt = attempt + 1, locked_by = ?, locked_at = ?, updated_at = ? WHERE id = ? AND status = 'queued'`,
        [opts.worker, now, now, jobId],
      );
      if (res.changes !== 1) return null;
      return db.query("SELECT * FROM execution_job WHERE id = ?").get(jobId) as ExecutionJobRow;
    })() as ExecutionJobRow | null;
    return claimed ?? null;
  } catch {
    return null;
  }
}

export function completeJob(db: Db, jobId: string, result: unknown): void {
  db.run(
    `UPDATE execution_job SET status = 'succeeded', result_json = ?, error = NULL, updated_at = ?, locked_by = NULL, locked_at = NULL WHERE id = ?`,
    [JSON.stringify(result ?? null), new Date().toISOString(), jobId],
  );
}

/** 실패 처리 — 재시도 잔여(attempt ≤ max_retry)면 queued로, 소진 시 failed.
 *  마지막 오류 메시지는 재큐 시에도 error 컬럼에 남겨 관측 가능하게 한다. */
export function failJob(db: Db, jobId: string, error: string, opts: { noRetry?: boolean } = {}): { requeued: boolean } {
  const job = db.query("SELECT attempt, max_retry FROM execution_job WHERE id = ?").get(jobId) as
    | { attempt: number; max_retry: number }
    | undefined;
  if (!job) return { requeued: false };
  const now = new Date().toISOString();
  // noRetry: 설정 오류(예: 핸들러 없음)처럼 재시도해도 같이 실패할 결정적 오류는
  // 즉시 failed로 확정한다 — 재큐 후 즉시 재선점하는 busy spin을 막는다.
  const requeued = !opts.noRetry && job.attempt <= job.max_retry;
  db.run(
    `UPDATE execution_job SET status = ?, error = ?, updated_at = ?, locked_by = NULL, locked_at = NULL WHERE id = ?`,
    [requeued ? "queued" : "failed", error.slice(0, 2000), now, jobId],
  );
  return { requeued };
}

/** 죽은 워커 회수 — running 상태가 staleSec 이상이면 재큐(또는 소진 시 failed).
 *  앱/워커 재시작 후 첫 틱에서 호출하면 in-memory 상태 소실 결함이 사라진다. */
export function reclaimStaleJobs(db: Db, opts: { staleSec?: number; reason?: string } = {}): { requeued: number; failed: number } {
  const staleSec = opts.staleSec ?? 3600;
  const cutoff = new Date(Date.now() - staleSec * 1000).toISOString();
  const rows = db
    .query(`SELECT id, attempt, max_retry FROM execution_job WHERE status = 'running' AND locked_at IS NOT NULL AND locked_at < ?`)
    .all(cutoff) as Array<{ id: string; attempt: number; max_retry: number }>;
  let requeued = 0;
  let failed = 0;
  for (const r of rows) {
    const out = failJob(db, r.id, opts.reason ?? "워커 응답 없음(stale lock) — 회수 후 재큐");
    if (out.requeued) requeued += 1;
    else failed += 1;
  }
  return { requeued, failed };
}

export function cancelJob(db: Db, jobId: string): boolean {
  const res = db.run(`UPDATE execution_job SET status = 'cancelled', updated_at = ? WHERE id = ? AND status = 'queued'`, [new Date().toISOString(), jobId]);
  return res.changes === 1;
}

export function listJobs(db: Db, opts: { status?: ExecutionJobStatus; limit?: number } = {}): ExecutionJobRow[] {
  return db
    .query(`SELECT * FROM execution_job ${opts.status ? "WHERE status = ?" : ""} ORDER BY created_at DESC LIMIT ?`)
    .all(...(opts.status ? [opts.status] : []), opts.limit ?? 50) as ExecutionJobRow[];
}
