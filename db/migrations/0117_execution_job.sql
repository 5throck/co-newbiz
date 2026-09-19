-- 0117_execution_job.sql
-- @reversible: true (purely additive — one new table, no existing rows or
-- tables touched. Manual rollback: DROP TABLE execution_job, or restore from a
-- pre-migration backup — scripts/co-newbiz/restore.ts.)
--
-- 독립 병렬 실행 계층의 작업 저장소 (design
-- 2026-09-19-sim-engine-runtime-separation §3, §6). 기능(산업 재분석·스윕·
-- 프로필 재분석)은 작업을 '제출'하기만 하고, 선점·재시도·관측은 이 계층이
-- 소유한다. 상태가 DB에 있으므로 프로세스 재시작 후에도 queued 작업이
-- 소실되지 않는다(기존 in-memory Map 결함의 대체 — ADR-0019 "앱 수명 타이머
-- 금지" 규율과 정렬). claim은 BEGIN IMMEDIATE 트랜잭션의 원자적
-- UPDATE로 SQLite 단일 writer 제약 하에서 안전하다(WAL + busy_timeout).

CREATE TABLE execution_job (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  resource_class TEXT NOT NULL CHECK (resource_class IN ('llm', 'web', 'numeric')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  attempt INTEGER NOT NULL DEFAULT 0,
  max_retry INTEGER NOT NULL DEFAULT 2,
  timeout_sec INTEGER NOT NULL DEFAULT 600,
  locked_by TEXT,
  locked_at TEXT,
  result_json TEXT,
  error TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX idx_execution_job_dispatch ON execution_job(status, resource_class, created_at);
