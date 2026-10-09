-- 0131_run_subject_company.sql
-- @reversible: true (purely additive — one nullable column + one index, no
-- existing rows or tables touched. Manual rollback: DROP INDEX
-- idx_run_project_company; ALTER TABLE run DROP COLUMN subject_company_id
-- (SQLite ≥3.35), or restore from a pre-migration backup —
-- scripts/co-newbiz/restore.ts.)
--
-- Per-target WACC and financial analysis (ADR-0156, design
-- 2026-10-09-per-target-wacc-financials). A WACC input session is a versioned
-- run (ADR-0115), so the company axis is one nullable column on run: NULL =
-- project-level session (today's behavior — legacy rows are grandfathered),
-- a company id = that shortlisted target's own session. Project-level
-- resolvers filter subject_company_id IS NULL so per-target sessions can
-- never change the fs-gate figure (ADR-0116 binding semantics unchanged).
-- App-level validation: a non-NULL value must be the resolved md_company of a
-- shortlisted brownfield_target of the project's source opportunity (checked
-- on the POST route; SQLite FK enforces existence only).

ALTER TABLE run ADD COLUMN subject_company_id TEXT REFERENCES md_company(id);

CREATE INDEX idx_run_project_company
  ON run(project_id, subject_company_id);
