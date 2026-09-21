-- 0120_business_case_target.sql
-- @reversible: true (purely additive — one nullable column + one index, no
-- existing rows or tables touched. Manual rollback: DROP INDEX
-- idx_bc_model_project_target; ALTER TABLE business_case_model DROP COLUMN
-- target_id (SQLite ≥3.35), or restore from a pre-migration backup —
-- scripts/co-newbiz/restore.ts.)
--
-- S8 brownfield 다중 대상 사업성 분석 — 대상(target) 축 (ADR-0143, design
-- 2026-09-22-s8-multi-target-feasibility). brownfield의 S8은 Short List에
-- 오른 각 대상(brownfield_target, 0055)별로 사업성 분석 인스턴스를 하나씩
-- 가진다. greenfield 행은 target_id = NULL (프로젝트 자체가 분석 주체 —
-- 기존 행동 그대로). valuation_simulation은 model_id를 경유해 대상을
-- 따르므로 컬럼을 추가하지 않는다.
--
-- 앱 레벨 검증: target_id는 해당 프로젝트의 source_opportunity 소속이며
-- status='shortlisted'인 대상이어야 한다 (INSERT/UPDATE 경로에서 검증 —
-- SQLite FK는 존재만 강제한다).

ALTER TABLE business_case_model ADD COLUMN target_id TEXT REFERENCES brownfield_target(id);

CREATE INDEX idx_bc_model_project_target
  ON business_case_model(project_id, target_id);
