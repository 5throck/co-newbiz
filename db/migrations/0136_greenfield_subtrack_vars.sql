-- 0136_greenfield_subtrack_vars.sql
-- @reversible: true (additive — two evidence_var seed rows, one new table and
-- two indexes; no existing table is altered. Manual rollback, in this order:
--   DROP INDEX idx_capex_tranche_live_no;
--   DROP INDEX idx_capex_tranche_project;
--   DROP TABLE capex_tranche;
--   DELETE FROM evidence_var WHERE var_key IN ('project.sub_track','project.site_required');
-- The DELETE is legal only while no dimension_input / rag_rule_variable row
-- references the two var_keys (dimension_input.var_key is an FK). Code
-- rollback: revert the PR — procedures/_validate.ts then rejects the
-- greenfield-dd step predicates that read these vars, so the procedure YAML is
-- reverted in the same PR. Rollback mechanism of record: pre-migration backup
-- restore (scripts/co-newbiz/restore.ts, ADR-0014).)
--
-- ADR-0160 addendum (2026-10-12, human decision reversing the earlier
-- "no migration" choice): greenfield sub-track and the site applicability flag
-- become seeded routing vars so the greenfield-dd step conditions are machine
-- applies_when predicates (db/lib/applies-when.ts), and phased capex tranches
-- (deal-structuring step 6) get a typed table.
--
-- Routing seeds — same conventions as 0014_routing_vars.sql:
--   project.sub_track      source_kind='column' — READ off the current
--                          route_decision row (is_current = 1) of the
--                          project's source opportunity. No current route =>
--                          UNASSESSED (fail-closed). A route with a NULL
--                          sub_track resolves to the literal 'none' (the
--                          plain new-site greenfield case — decided, not
--                          missing).
--   project.site_required  source_kind='asserted', requires_evidence_ref=1 —
--                          a human-confirmed dimension_input assertion,
--                          reflected in routing only when live AND reviewed.
--
-- NO DATA DEFAULT for project.site_required — DELIBERATE (as in 0014). The
-- per-sub-track default (null -> site applies, intra_venture -> no site) is
-- written into the procedure predicates, never into data, and
-- existing_business_rbd has no default at all: until a human confirms (and a
-- second person reviews) the value, the predicate is UNASSESSED and the site
-- steps APPLY (fail-closed).
--
-- created_at is a fixed literal (ADR-0002: no dynamic date functions).

INSERT INTO evidence_var (var_key, label_ko, value_type, source_kind, requires_evidence_ref, created_at) VALUES
  ('project.sub_track', '세부 트랙', 'string', 'column', 0, '2026-10-12T00:00:00Z'),
  ('project.site_required', '신규·증설 부지 필요 여부', 'boolean', 'asserted', 1, '2026-10-12T00:00:00Z');

-- Phased capex tranches (deal-structuring v1.1.0 step 6; S11 execution
-- baseline reads them). Amounts are stored in the stated currency's millions
-- (ADR-0061 stores KRW millions; a non-KRW tranche keeps its own currency —
-- no silent FX conversion). Soft rules like project_business_goal: no hard
-- delete, a retire stamps retired_*; a status change stamps status_changed_*.
-- Release is a human act (the route is human-only); release_condition is the
-- S10 milestone condition the release is judged against.
CREATE TABLE capex_tranche (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  tranche_no INTEGER NOT NULL CHECK (tranche_no >= 1),
  amount REAL NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'KRW' CHECK (length(currency) = 3 AND currency = upper(currency)),
  release_condition TEXT NOT NULL CHECK (length(trim(release_condition)) > 0),
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','released','withheld')),
  status_reason TEXT,
  source_stage TEXT NOT NULL DEFAULT 'S10' CHECK (source_stage IN ('S10','S11','S12')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT,
  status_changed_by TEXT,
  status_changed_at TEXT,
  retired_at TEXT,
  retired_by TEXT,
  retire_reason TEXT
);

CREATE INDEX idx_capex_tranche_project ON capex_tranche(project_id, tranche_no);

CREATE UNIQUE INDEX idx_capex_tranche_live_no ON capex_tranche(project_id, tranche_no) WHERE retired_at IS NULL;
