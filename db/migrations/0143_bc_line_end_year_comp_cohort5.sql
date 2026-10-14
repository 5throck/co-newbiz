-- @reversible: true (end_year is additive-nullable; comp_benchmark keeps every column and row — ADR-0014; rollback mechanism is pre-migration backup restore, see scripts/co-newbiz/restore.ts)
-- ADR-0174 slices 1+2 — two changes in ONE migration (PM decision, same file):
--
-- 1) business_case_line.end_year INTEGER NULL — per-line spending window.
--    NULL = the line runs through the model horizon (legacy rows and every
--    ratio-basis row stay exactly as they are). A lump sum copied at S5
--    promotion is a one-year line: end_year = start_year. SQLite cannot ALTER
--    a column in, so this is the plain additive ALTER (0111/0134 pattern).
--
-- 2) comp_benchmark cohort CHECK raised 3 -> 5 (decider-confirmed
--    2026-10-15, k-anonymity floor): SQLite cannot ALTER a CHECK, so the
--    table is rebuilt in place the same way 0033 rebuilt it (and 0049/0102
--    rebuilt other tables). Every column and row is copied verbatim; the
--    anonymized view is dropped and recreated against the new table, mirroring
--    0033. No table references comp_benchmark, so no FK toggle is needed and
--    the migration stays inside the default transaction wrapper.
ALTER TABLE business_case_line ADD COLUMN end_year INTEGER;

-- Guarded assertion (0132/0137 pattern): the rebuild must not silently rewrite
-- history — if the live table still holds a 3- or 4-person cohort row, the
-- migration aborts and a person resolves those rows first (raise k, merge or
-- delete) instead of the migration deleting them.
CREATE TEMP TABLE _comp_cohort5_assert (ok INTEGER NOT NULL CHECK (ok = 1));
INSERT INTO _comp_cohort5_assert (ok)
  SELECT CASE WHEN (SELECT COUNT(*) FROM comp_benchmark WHERE headcount < 5) = 0 THEN 1 ELSE 0 END;

DROP VIEW v_comp_anonymized;
CREATE TABLE comp_benchmark_new (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  job_family TEXT NOT NULL,
  grade TEXT NOT NULL,
  headcount INTEGER NOT NULL CHECK (headcount >= 5),
  target_median INTEGER NOT NULL,      -- integer minor units (KRW won), ADR-0002
  acquirer_median INTEGER NOT NULL,
  gap_pct REAL NOT NULL,
  annual_cost_delta INTEGER NOT NULL,
  evidence_ref TEXT
);
INSERT INTO comp_benchmark_new SELECT * FROM comp_benchmark;
DROP TABLE comp_benchmark;
ALTER TABLE comp_benchmark_new RENAME TO comp_benchmark;
CREATE INDEX idx_comp_benchmark_project ON comp_benchmark(project_id, job_family);
CREATE VIEW v_comp_anonymized AS
SELECT id, project_id, job_family, grade, headcount, gap_pct, annual_cost_delta, evidence_ref
FROM comp_benchmark;
