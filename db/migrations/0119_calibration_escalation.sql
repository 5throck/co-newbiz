-- 0119_calibration_escalation.sql
-- @reversible: true (purely additive — one new table, no existing rows or
-- tables touched. Manual rollback: DROP TABLE calibration_escalation, or
-- restore from a pre-migration backup — scripts/co-newbiz/restore.ts.)
--
-- 결정론 CAGR 스케일링 에스컬레이션 기록 (design
-- 2026-09-20-calibration-escalation; sim-engine separation §P3의 "3사이클
-- 미수렴 시 사람 결정 트리거"의 실행 표면). LLM 재분석이 수렴선(격차 ≤15%)
--에 도달하지 못할 때, 사람이 결정론 산술(외부 참조 × 0.85)로 조정 CAGR을
-- 채택한 행위를 append-only로 남긴다 — 버전 페이로드는 절대 재작성하지
-- 않는다.

CREATE TABLE calibration_escalation (
  id TEXT PRIMARY KEY NOT NULL,
  industry_id TEXT NOT NULL REFERENCES md_industry(id),
  version_id TEXT NOT NULL REFERENCES market_sizing_version(id),
  method TEXT NOT NULL DEFAULT 'deterministic_scaling',
  base_our_cagr_pct REAL NOT NULL,
  external_cagr_pct REAL NOT NULL,
  scaled_cagr_pct REAL NOT NULL,
  residual_gap_pct REAL NOT NULL,
  rationale TEXT NOT NULL,
  decided_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_calibration_escalation_industry
  ON calibration_escalation(industry_id, created_at DESC);
