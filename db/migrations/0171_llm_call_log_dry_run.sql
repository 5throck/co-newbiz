-- @reversible: true (additive columns + index on an append-only execution
-- ledger; rollback is a pre-migration backup restore, scripts/co-newbiz/restore.ts,
-- ADR-0014. No existing column or row is changed.)
-- 2026-09-15-runtime-pm-agent-orchestration §6.6/§6.8 (D5 드라이런 실험 레인,
-- D7 마이그레이션 2/3) — 드라이런 LLM 호출을 llm_call_log에 기록하되 운영
-- 집계와 분리한다. is_dry_run=1인 행은 /api/flows/runs 의 기본 필터에서
-- 제외되고(§6.6 "운영 대시보드는 기본적으로 제외"), dry_run_group_id 는
-- 드라이런 세션(dry_run_session.id, 0172)과의 조인 키다 — 세션당 비용
-- 누계(화면 설계 2026-10-24 §6.2)가 이 인덱스로 조회된다.
-- IF NOT EXISTS: 0064 계열 테이블 리빌드 환경에서의 재적용 안전을 위해 명시한다.
ALTER TABLE llm_call_log ADD COLUMN is_dry_run INTEGER NOT NULL DEFAULT 0;
ALTER TABLE llm_call_log ADD COLUMN dry_run_group_id TEXT;
CREATE INDEX IF NOT EXISTS idx_llm_call_log_dry_run_group ON llm_call_log(dry_run_group_id, created_at);
