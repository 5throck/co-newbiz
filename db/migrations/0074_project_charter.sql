-- 0074_project_charter.sql
-- @reversible: true
-- ADR-0104 — project charter: every promoted project carries a name and a
-- structured charter (purpose, track grounding, entry scope, KPI pre-commit)
-- built at promotion time from the opportunity artifacts. charter_json keeps
-- an append-only versions array so scope creep is traceable (C3).

ALTER TABLE md_project ADD COLUMN project_name TEXT;
ALTER TABLE md_project ADD COLUMN charter_json TEXT;
ALTER TABLE md_project ADD COLUMN charter_confirmed_at TEXT;
