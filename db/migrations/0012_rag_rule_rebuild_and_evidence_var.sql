-- @reversible: true (one destructive statement — DROP TABLE rag_rule — against a verified 0-row, 0-reader table; rollback mechanism is pre-migration backup restore, see scripts/co-newbiz/restore.ts — ADR-0014)
-- RAG formalization and case classification — design of record
-- docs/designs/2026-08-22-rag-formalization-and-case-classification-design.md,
-- Decision 1 (rag_rule rebuild) and Decision 2 (evidence registry).
--
-- Three sections, in dependency order:
--   (a) certification transferability columns (overturn 7 — certification
--       transferability defense needs more than a kill criterion)
--   (b) rag_rule DROP+CREATE (Decision 1)
--   (c) evidence_var + rag_rule_variable (Decision 2) — must come after (b)
--       because rag_rule_variable declares a foreign key to rag_rule(id).
--
-- WHY DROP IS SAFE (verified 2026-08-22, the last safe window — Decision 1,
-- schema-validation finding F-2):
--   * 0 rows: a fresh scratch DB migrated through 0011 has COUNT(*)=0 in
--     rag_rule — no seed data, no production data to lose.
--   * 0 readers: repo-wide grep finds no SQL that reads or writes rag_rule;
--     the only mentions are doc-comments (db/lib/predicate.ts,
--     db/lib/rag-engine.ts) and a SQL comment on rag_assessment.triggered_rules
--     (a JSON array of rag_rule ids — deliberately NOT a foreign key).
--   * No table declares an FK to rag_rule, so the DROP is legal even with
--     PRAGMA foreign_keys=ON (enforced at every connection by db/client.ts).
--
-- ANTI-TAMPER STAGING (design §5.2, steps 1-2 of 5): the old table's
-- `enabled` column DEFAULTED TO 1 — a rule existed and fired unless someone
-- remembered to disable it. The rebuild inverts that: `enabled` DEFAULTS TO 0,
-- and the table-level CHECK makes enabled=1 require BOTH a `policy_id` AND a
-- `thresholds_source`. Enabling a rule is now a deliberate, attributable act
-- with its governance anchor attached, not the silent default.
--
-- certification column semantics (design overturn 7 / non-negotiable
-- boundary #5 — inference is explicitly disallowed for certification
-- transferability on change of control):
--   transferability_basis        HOW transferability was established:
--                                'verified' (confirmed against issuer/source
--                                text) or 'inferred'. 'inferred' values are
--                                hard-blocked at the repository write layer
--                                (PR-3) — the DB records the basis, the write
--                                layer refuses to circulate an inference.
--   transferable_on_coc          Whether the certification survives the
--                                change-of-control event itself.
--   transferability_evidence_ref Source citation backing the position.
--   load_bearing                 1 = the business case depends on this
--                                certification (its loss kills the deal).
--   confirmed_at                 When the transferability position was last
--                                confirmed against the issuer/source text.

-- ── (a) certification transferability columns ───────────────────────────
-- One ALTER per statement: SQLite allows only one ADD COLUMN per statement,
-- and NOT NULL without DEFAULT is illegal in ADD COLUMN (load_bearing carries
-- DEFAULT 0 to backfill pre-existing rows).

ALTER TABLE certification ADD COLUMN transferability_basis TEXT CHECK (transferability_basis IS NULL OR transferability_basis IN ('verified','inferred'));
ALTER TABLE certification ADD COLUMN transferable_on_coc TEXT;
ALTER TABLE certification ADD COLUMN transferability_evidence_ref TEXT;
ALTER TABLE certification ADD COLUMN load_bearing INTEGER NOT NULL DEFAULT 0 CHECK (load_bearing IN (0,1));
ALTER TABLE certification ADD COLUMN confirmed_at TEXT;

-- ── (b) rag_rule rebuild (Decision 1) ───────────────────────────────────

DROP TABLE IF EXISTS rag_rule;
CREATE TABLE rag_rule (
  id TEXT PRIMARY KEY,
  rule_key TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  stage_gate TEXT NOT NULL CHECK (stage_gate IN ('screening','pre_fs','fs','dd','entity_ic','group_ic')),
  dimension TEXT NOT NULL CHECK (dimension IN ('financial','market','data_confidence','regulatory_permit','technical_execution','risk','overall')),
  grade TEXT NOT NULL CHECK (grade IN ('green','amber','red')),
  condition_expr TEXT NOT NULL,
  priority INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
  policy_id TEXT REFERENCES governance_doc(id),
  thresholds_source TEXT,
  created_at TEXT NOT NULL,
  CHECK (enabled = 0 OR (policy_id IS NOT NULL AND thresholds_source IS NOT NULL))
);
CREATE UNIQUE INDEX idx_rag_rule_key ON rag_rule(rule_key, version);
CREATE INDEX idx_rag_rule ON rag_rule(stage_gate, dimension, priority);

-- ── (c) evidence registry (Decision 2) ──────────────────────────────────
-- evidence_var is the physical variable registry; rag_rule_variable is the
-- join table that answers "which rules break if this var_key is renamed"
-- in SQL (LIKE over condition_expr is unindexable and false-positive-prone).
-- label_ko is Korean BY DESIGN — it feeds renderKo's governance artifact,
-- the document reviewers sign; this is row data, not documentation prose.

CREATE TABLE evidence_var (
  var_key TEXT PRIMARY KEY,
  label_ko TEXT NOT NULL,
  value_type TEXT NOT NULL CHECK (value_type IN ('number','string','boolean')),
  unit TEXT CHECK (unit IS NULL OR unit IN ('ratio','pp','krw','months','x','count')),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('column','computed','asserted')),
  requires_evidence_ref INTEGER NOT NULL DEFAULT 0 CHECK (requires_evidence_ref IN (0,1)),
  max_age_days INTEGER,
  created_at TEXT NOT NULL
);
CREATE TABLE rag_rule_variable (
  rule_id TEXT NOT NULL REFERENCES rag_rule(id),
  var_key TEXT NOT NULL REFERENCES evidence_var(var_key),
  PRIMARY KEY (rule_id, var_key)
);
CREATE INDEX idx_rag_rule_variable_var ON rag_rule_variable(var_key);
