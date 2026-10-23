-- @reversible: true (new standalone table, no references from or to existing
-- business tables; rollback is a pre-migration backup restore,
-- scripts/co-newbiz/restore.ts, ADR-0014. No existing column or row is changed.)
-- 2026-09-15-runtime-pm-agent-orchestration §6.6/§6.8 (D5 드라이런 실험 레인,
-- D7 마이그레이션 3/3) — 세션 스코프 오버라이드의 유일한 저장소. SSOT 불변
-- 경계(§6.6): 프롬프트 교체·에이전트 재배정은 이 테이블의 행으로만 존재하고,
-- 영구 반영의 유일한 경로는 제안 패키지 → 저장소 PR(Design Gate)이다.
-- 드라이런 결과는 비즈니스 테이블에 절대 기록되지 않는다(§6.6 경계) —
-- 산출물은 이 테이블 + llm_call_log(is_dry_run=1, 0171)에만 남는다.
--
-- 선호 기록 스키마(화면 설계 2026-10-24 §13-5 해소): 3상(base|override|tie)
-- + 자유 텍스트 비고 1줄 — 골든셋 시드(§6.6 (3)).
-- TTL(§6.8): expires_at 이 지난 세션은 정리 대상 — v1은 읽기 경로에서
-- 소거(lib/dry-run.ts purgeExpiredDryRunSessions, 화면 설계 §13-3의
-- "만료 예정" 칩은 Row 6 UI 과제). 만료 행 삭제 시 llm_call_log 의
-- is_dry_run 행은 런 장부(append-only)에 그대로 남는다.
CREATE TABLE IF NOT EXISTS dry_run_session (
  id TEXT PRIMARY KEY,                      -- 'dr_' + ULID
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'closed', 'expired')),
  prompt_key TEXT NOT NULL,                 -- 카탈로그 프롬프트 키(검증은 라이브러리 계층)
  activity_id TEXT,                         -- flow.spec 활동 id (미매핑 프롬프트는 NULL)
  base_agent_key TEXT NOT NULL,             -- 카탈로그 원본 에이전트(비교축 base, 고정)
  override_agent_key TEXT,                  -- NULL = 에이전트 축 미오버라이드
  override_system TEXT,                     -- NULL = 프롬프트 축 미오버라이드(카탈로그 원본 사용)
  preference TEXT
    CHECK (preference IN ('base', 'override', 'tie') OR preference IS NULL),
  preference_note TEXT,                     -- 비고 1줄(자유 텍스트)
  base_output TEXT,                         -- 최근 실행의 base 산출물(이력은 llm_call_log)
  override_output TEXT,                     -- 최근 실행의 override 산출물
  base_output_source TEXT
    CHECK (base_output_source IN ('llm', 'synthesis') OR base_output_source IS NULL),
  override_output_source TEXT
    CHECK (override_output_source IN ('llm', 'synthesis') OR override_output_source IS NULL),
  base_run_call_id TEXT,                    -- llm_call_log.id 참조(앱 계층 무결성 — FK 미선언)
  override_run_call_id TEXT,
  cost_usd REAL,                            -- 세션 누계(dry_run_group_id 행들의 SUM)
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_dry_run_session_created_by ON dry_run_session(created_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dry_run_session_expires ON dry_run_session(expires_at);
