#!/usr/bin/env bun
// @version 1.0.0
//
// job-worker — 독립 병렬 실행 계층의 자식 프로세스 진입점 (design
// 2026-09-19-sim-engine-runtime-separation §3, 승인 2026-09-19 1단계).
//
// 한 프로세스가 queued 작업 1건을 claim → 어댑터 실행 → 결과/실패 기록 후
// 종료한다(--loop면 큐가 빌 때까지 반복). 병렬 실행 = 이 프로세스를 N개 동시
// 기동하는 것(오케스트레이터·OS 스케줄러·셸 어디서든). 작업 상태는
// execution_job 테이블에 있으므로 워커가 죽어도 이력이 소실되지 않는다
// (시작 시 reclaimStaleJobs로 죽은 잠금 회수).
//
// 사용법:
//   bun scripts/co-newbiz/job-worker.ts [--class llm|web|numeric] [--loop]
//        [--job <id>] [--handlers <module.ts>] [--stale-reclaim <sec>]
//
//   --class         선점 대상을 해당 리소스 클래스로 제한(동시성 상한 관리 단위)
//   --loop          큐가 빌 때까지 계속 선점(기본: 1건만)
//   --job <id>      특정 작업만 선점(디버그·재실행)
//   --handlers      추가 핸들러 모듈(registerExecutionJobHandler 호출만 하면
//                   된다)을 동적 import — 테스트·기능 확장용
//   --stale-reclaim 시작 전 죽은 워커의 running 작업 회수 기준(초, 기본 3600)
//
// 종료 코드: 0 = 완료 또는 대상 없음, 1 = 작업 실패(최종) 또는 오류.
import { getDb } from "../../db/client.ts";
import {
  claimJobById,
  claimNextJob,
  completeJob,
  failJob,
  reclaimStaleJobs,
  type ExecutionJobRow,
  type ResourceClass,
} from "../../app/web-next/lib/execution-jobs.ts";
import { getExecutionJobHandler } from "../../app/web-next/lib/execution-job-handlers.ts";
import { loadRootEnvPipelineKeys } from "../../app/web-next/lib/llm.ts";

const args = process.argv.slice(2);
function argValue(name: string): string | undefined {
  const i = args.indexOf(name);
  return i !== -1 && i + 1 < args.length ? args[i + 1] : undefined;
}
const LOOP = args.includes("--loop");
const CLASS = argValue("--class") as ResourceClass | undefined;
const JOB_ID = argValue("--job");
const HANDLERS_MODULE = argValue("--handlers");
const STALE_SEC = Number(argValue("--stale-reclaim") ?? 3600);

function claim(db: ReturnType<typeof getDb>, worker: string): ExecutionJobRow | null {
  return JOB_ID ? claimJobById(db, JOB_ID, { worker }) : claimNextJob(db, { resourceClass: CLASS, worker });
}

async function main(): Promise<number> {
  // 루트 .env의 파이프라인 키(OPENAI/TAVILY 등)를 로드 — 워커는 앱 프로세스
  // 밖에서 돌므로 스스로 키를 확보해야 한다(이미 있으면 덮어쓰지 않음).
  loadRootEnvPipelineKeys();
  if (HANDLERS_MODULE) await import(HANDLERS_MODULE);

  const db = getDb();
  reclaimStaleJobs(db, { staleSec: STALE_SEC });

  const worker = `job-worker-${process.pid}`;
  let finalExit = 0;
  for (;;) {
    const job = claim(db, worker);
    if (!job) break;
    const handler = getExecutionJobHandler(job.kind);
    console.info(`[job-worker] claimed ${job.id} kind=${job.kind} attempt=${job.attempt}`);
    if (!handler) {
      // 핸들러 부재는 결정적 설정 오류 — 재시도하지 않고 확정 실패.
      failJob(db, job.id, `등록된 핸들러가 없음: ${job.kind} (--handlers로 확장 모듈을 로드했는지 확인)`, { noRetry: true });
      console.error(`[job-worker] failed ${job.id}: no handler for kind=${job.kind}`);
      return 1;
    }
    const timeoutSec = handler.timeoutSec ?? job.timeout_sec;
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const payload = JSON.parse(job.payload_json) as unknown;
      const result = await Promise.race([
        handler.run(payload, { db, job }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            timedOut = true;
            reject(new Error(`작업 시간 초과(${timeoutSec}초)`));
          }, timeoutSec * 1000);
        }),
      ]);
      completeJob(db, job.id, result);
      console.info(`[job-worker] succeeded ${job.id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const { requeued } = failJob(db, job.id, timedOut ? `timeout: ${msg}` : msg);
      console.error(`[job-worker] failed ${job.id} attempt=${job.attempt} (${requeued ? "requeued" : "final"}): ${msg}`);
      finalExit = 1;
      if (!requeued) return 1;
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (!LOOP) return finalExit;
  }
  return finalExit;
}

process.exit(await main());
