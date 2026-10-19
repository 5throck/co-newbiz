-- 0155_dd_domain_adopt.sql (2026-10-19 decider-approved option: "추가 실사 도메인을
-- 판정에 반영" — person-only adoption for projects created before the 2026-10-01
-- cut-off, mirroring the greenfield hr exception of ADR-0160 addendum).
--
-- Sidecar on md_project (no new table): { adopted: true, rationale, by, at }.
-- While present, the four newer DD domains (재무·인사·시장·자금조달 계획) count
-- toward S9 completion and the dd gate for THIS project — a person's recorded
-- decision, never an agent's. Null = grandfathered (reference-only tabs, today's
-- behavior). The rationale is mandatory at write time and surfaced in the UI.
ALTER TABLE md_project ADD COLUMN dd_domain_adopt_json TEXT;
