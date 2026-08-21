-- @reversible: true (additive schema except the compliance_check rebuild in (e), whose DROP is row-preserving via INSERT...SELECT — every pre-migration row survives; rollback mechanism is pre-migration backup restore, see scripts/co-newbiz/restore.ts — ADR-0014)
-- Classification infrastructure — design of record
-- docs/designs/2026-08-22-rag-formalization-and-case-classification-design.md,
-- Decision 3 (dimension_input), Decision 5b (project_case_classification),
-- Decision 5c (md_project.current_stage_gate), Decision 5d
-- (compliance_check.result 'not_applicable'), plus deal_structure_hypothesis.
--
-- Schema only — no code reads or writes the new tables in this PR. The
-- repository/application layer that proves their shape is PR-5, shipped in
-- the same release window (design §5 PR-4 row, schema finding F-14).
--
-- Pre-checks verified 2026-08-22 against the post-0012 schema:
--   * FK targets exist: run(id) (migration 0003), md_project(id) (0001),
--     evidence_var(var_key) (0012).
--   * No table declares REFERENCES compliance_check (repo-wide grep), so the
--     DROP in (e) is legal under PRAGMA foreign_keys=ON, and the RENAME TO
--     cannot silently repoint any other table's foreign key.
--   * The schema's only trigger/view (audit_log_no_delete/_no_update,
--     v_comp_anonymized — migration 0008) do not touch compliance_check.

-- ── (a) dimension_input (Decision 3) ─────────────────────────────────────
-- Run-scoped, history-preserving judged inputs. A human/judgement variable
-- is NOT a single-row-per-project slot (schema finding F-15/F-16): the
-- original single-row design deleted classification history — the exact
-- audit trail needed to catch a false skip. Rows are append-only; a newer
-- assertion supersedes an older one by pointing at it.
--
-- idx_dimension_input_live (partial UNIQUE on superseded_by IS NULL) makes
-- "one live assertion per (project, var)" a database fact; history rows
-- (superseded_by set) never block re-assertion.
--
-- reviewed_by: the cross-domain second reviewer (compliance-officer /
-- legal-counsel, non-negotiable boundary #2). Nullable here — the
-- application layer (PR-5) refuses to reflect an assertion in scoring until
-- reviewed_by is filled; the DB records the state, the write layer enforces
-- the gate. Same layering as 0012's transferability_basis.
--
-- value_kind XOR CHECK: 'num' rows carry value_num only; 'text'/'bool' rows
-- carry value_text only. A row with both (or neither) is rejected — the
-- registry's value_type must not be reinterpretable after the fact.
-- unit snapshots the evidence_var unit at assertion time, so a later
-- registry unit change cannot silently reinterpret past assertions.

CREATE TABLE dimension_input (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES run(id),
  project_id TEXT NOT NULL REFERENCES md_project(id),
  var_key TEXT NOT NULL REFERENCES evidence_var(var_key),
  value_kind TEXT NOT NULL CHECK (value_kind IN ('num','text','bool')),
  value_text TEXT, value_num NUMERIC, unit TEXT,
  evidence_ref TEXT NOT NULL,
  asserted_by TEXT NOT NULL,
  reviewed_by TEXT,
  rationale TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  superseded_by TEXT REFERENCES dimension_input(id),
  CHECK ((value_kind='num' AND value_num IS NOT NULL AND value_text IS NULL)
      OR (value_kind!='num' AND value_text IS NOT NULL AND value_num IS NULL))
);
CREATE UNIQUE INDEX idx_dimension_input_live ON dimension_input(project_id, var_key) WHERE superseded_by IS NULL;
CREATE INDEX idx_dimension_input_project ON dimension_input(project_id, observed_at DESC);

-- ── (b) project_case_classification (Decision 5b) ────────────────────────
-- Append-only classification history: one live row per project
-- (idx_case_classification_live), re-classification adds a row and
-- supersedes the old one. Post-FS case_type/origin changes additionally
-- require the approval route + compliance_check rationale (Decision 5c).
--
-- origin is 4-valued (overturn 5): 'joint' is a true bilateral JV with
-- shared control — deliberately separate from 'hybrid' (passive minority
-- stake, pilot-014 shape) so deals with opposite governance structures
-- never share a bucket.
--
-- approver_role/approved_by/approved_at are nullable AT THE DATABASE LEVEL
-- by design: Decision 5a requires the two-party approval only when
-- origin IN ('internal','hybrid','joint') (values that REDUCE the validator
-- set); SQL CHECKs cannot express conditional mandatory columns across
-- rows. The application layer (PR-5) enforces approval for those origins —
-- the two-party approval is waiver-equivalent control per the design's
-- central finding (classification is a weaker waiver), so it must cost at
-- least as much as one.

CREATE TABLE project_case_classification (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  case_type TEXT NOT NULL CHECK (case_type IN ('greenfield','brownfield')),
  origin TEXT NOT NULL CHECK (origin IN ('internal','external','hybrid','joint')),
  technology_track TEXT NOT NULL DEFAULT 'none' CHECK (technology_track IN ('none','rbd')),
  classified_by TEXT NOT NULL,
  approver_role TEXT, approved_by TEXT, approved_at TEXT,
  classified_at TEXT NOT NULL,
  rationale TEXT NOT NULL,
  superseded_by TEXT REFERENCES project_case_classification(id)
);
CREATE UNIQUE INDEX idx_case_classification_live ON project_case_classification(project_id) WHERE superseded_by IS NULL;

-- ── (c) deal_structure_hypothesis ────────────────────────────────────────
-- Until now this existed only as a procedure output_type string
-- (procedures/_shared/brownfield-pre-fs/schema.yaml). Real columns give
-- ADR-0045's four mandatory axes (tax structure, liability isolation,
-- financing leverage, exit structure) plus the acquisition-shape axes
-- (FR-RBD-07 internal_venture_spinoff, FR-RBD-12 minority_venture_
-- investment) a queryable home. run_id is nullable: a hypothesis can be
-- formed during Pre-FS procedure work before any analysis run exists.
--
-- DELIBERATE DEVIATION from the design's DDL: every axis enum CHECK is
-- written as `IS NULL OR ... IN (...)` instead of a bare IN list. All five
-- axis columns are optional at hypothesis time (an early hypothesis may
-- have settled the vehicle but not the instrument mix); a bare CHECK would
-- force all five enums non-null. Only four_axis_review_completed is NOT
-- NULL (defaults 0 — review completion is a deliberate act, mirroring
-- 0012's enabled=0 anti-tamper default).

CREATE TABLE deal_structure_hypothesis (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  run_id TEXT REFERENCES run(id),
  asset_or_stock TEXT CHECK (asset_or_stock IS NULL OR asset_or_stock IN ('asset','stock','mixed')),
  stake_type TEXT CHECK (stake_type IS NULL OR stake_type IN ('full','majority','minority','joint_control')),
  instrument_mix TEXT CHECK (instrument_mix IS NULL OR instrument_mix IN ('primary','secondary','mixed')),
  vehicle TEXT CHECK (vehicle IS NULL OR vehicle IN ('direct','spc','holdco','internal_venture_spinoff','jv')),
  commercialization_path TEXT CHECK (commercialization_path IS NULL OR commercialization_path IN ('build','license_in','license_out','spin_off','minority_venture_investment')),
  tax_structure_note TEXT, liability_isolation_note TEXT,
  financing_leverage_note TEXT, exit_structure_note TEXT,
  four_axis_review_completed INTEGER NOT NULL DEFAULT 0 CHECK (four_axis_review_completed IN (0,1)),
  hypothesized_by TEXT NOT NULL, hypothesized_at TEXT NOT NULL, rationale TEXT NOT NULL
);

-- ── (d) md_project.current_stage_gate (Decision 5c) ──────────────────────
-- NULL = gate not yet tracked (pre-backfill state). One ALTER per statement
-- (SQLite allows a single ADD COLUMN per statement); the CHECK uses the
-- IS NULL OR form because ADD COLUMN cannot add a NOT NULL constraint
-- without a DEFAULT, and backfill is PR-5's job, not the migration's.

ALTER TABLE md_project ADD COLUMN current_stage_gate TEXT
  CHECK (current_stage_gate IS NULL OR current_stage_gate IN ('screening','pre_fs','fs','dd','entity_ic','group_ic'));

-- ── (e) compliance_check.result += 'not_applicable' (Decision 5d) ────────
-- SQLite cannot ALTER a column's CHECK, so this is the standard 4-step
-- rebuild: create the extended-shape table, copy every row (INSERT...
-- SELECT preserves column order and values byte-identically), drop the old
-- table, rename. The shape is IDENTICAL to migration 0006's except the
-- result CHECK gains 'not_applicable' — column order, the layer CHECK, and
-- waiver_id's plain-TEXT (no FK, as in 0006) are preserved exactly, so
-- existing readers see no change.
--
-- 'not_applicable' records a validator skipped BY CLASSIFICATION (Decision
-- 5d): one row per skipped validator, detail carrying the rendered
-- applies_when sentence + classification row id + classified_by/approved_by.
-- Six-validator completeness becomes "6 declared / N applicable / M
-- completed", not a boolean. Rows are invalidated and re-evaluated on
-- re-classification (PR-5 write-layer behavior, recorded here for intent).

CREATE TABLE compliance_check_new (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  gate TEXT NOT NULL,
  rule_key TEXT NOT NULL,
  layer TEXT NOT NULL CHECK (layer IN ('policy', 'procedure', 'guideline', 'checklist', 'template')),
  result TEXT NOT NULL CHECK (result IN ('pass', 'blocked', 'reason_required', 'waived', 'not_applicable')),
  detail TEXT,
  waiver_id TEXT,
  detected_at TEXT NOT NULL,
  resolved_at TEXT
);
INSERT INTO compliance_check_new SELECT id, project_id, gate, rule_key, layer, result, detail, waiver_id, detected_at, resolved_at FROM compliance_check;
DROP TABLE compliance_check;
ALTER TABLE compliance_check_new RENAME TO compliance_check;
CREATE INDEX idx_compliance_check ON compliance_check(project_id, gate);
