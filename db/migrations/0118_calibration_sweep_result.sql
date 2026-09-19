-- 0118_calibration_sweep_result.sql
-- @reversible: true (purely additive — one new table, no existing rows or
-- tables touched. Manual rollback: DROP TABLE calibration_sweep_result, or
-- restore from a pre-migration backup — scripts/co-newbiz/restore.ts.)
--
-- 드라이버 impact 조합의 확률론적 탐색 결과 저장 (design
-- 2026-09-19-sim-engine-runtime-separation §4 저장 계약). **요약 통계만
-- 저장**한다 — 원시 표본은 저장하지 않는다(스냅샷 크기 통제, 재현은
-- seed로만). 스윕의 목적은 역산 feasibility 뷰다: "외부 참조에 도달하려면
-- 어떤 조합이 필요한가, 그중 믿을 만한 조합이 존재하는가."

CREATE TABLE calibration_sweep_result (
  id TEXT PRIMARY KEY NOT NULL,
  industry_id TEXT NOT NULL REFERENCES md_industry(id),
  version_no INTEGER NOT NULL,
  needed_uplift_pct REAL NOT NULL,
  sample_count INTEGER NOT NULL,
  plausible_ratio REAL NOT NULL,
  p10_gap_pct REAL NOT NULL,
  p50_gap_pct REAL NOT NULL,
  p90_gap_pct REAL NOT NULL,
  feasible_ratio REAL NOT NULL,
  per_driver_quantiles_json TEXT NOT NULL,
  device TEXT NOT NULL DEFAULT 'cpu',
  seed INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_calibration_sweep_industry
  ON calibration_sweep_result(industry_id, created_at DESC);
