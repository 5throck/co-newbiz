-- @reversible: true (purely additive — one CREATE TABLE + one CREATE INDEX on a
-- table with zero rows at birth; rollback mechanism is pre-migration backup
-- restore, see scripts/co-newbiz/restore.ts — ADR-0014.)
-- ADR-0058 — the durable record of kill-criteria evaluation. The evaluator
-- (db/lib/kill-criteria.ts, ADR-0057) landed read-only with one open decision:
-- where a triggered criterion is durably recorded. This migration is that
-- decision: a NEW run-scoped append-only table — NOT compliance_check
-- (project-scoped, no run provenance; its rule_key namespace feeds the
-- six-validator newest-row-wins machinery and must not grow kill rows), NOT
-- gate_pass_record (no such table exists — it is a procedure output_type;
-- when gate-flow code lands it READS this table).
--
-- Design (ADR-0058 §1):
--   * COMPLETE LEDGER — one row per evaluated criterion per run, all three
--     outcomes ('triggered' / 'false' / 'unassessed'). A recorded 'false' is
--     the auditable proof the criterion was evaluated and measured false;
--     absence of a row means never-evaluated, the only silent state, and it
--     is unambiguous. Inert (predicate-null / disabled) entries get no rows —
--     the ledger claims nothing about them.
--   * ADR-0005 SNAPSHOTTING — predicate_json, policy_id, thresholds_source
--     and action are copied INTO the row: a later registry edit cannot
--     rewrite what this run was evaluated under.
--   * UNIQUE (run_id, procedure_key, criterion_id) — the recorder throws on a
--     second record call for the same run+procedure (runs are immutable).
--   * evaluated_by carries the acting user (agents inherit the calling
--     user's identity — design boundary #1); the repository write path
--     enforces FR-SEC-08 membership + FR-SEC-06 insider status.
CREATE TABLE kill_criteria_evaluation (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES run(id),
  project_id TEXT NOT NULL REFERENCES md_project(id),
  procedure_key TEXT NOT NULL,
  criterion_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('halt','mark_conditional','escalate_to_risk_officer')),
  outcome TEXT NOT NULL CHECK (outcome IN ('triggered','false','unassessed')),
  predicate_json TEXT NOT NULL,
  policy_id TEXT NOT NULL,
  thresholds_source TEXT NOT NULL,
  evaluated_at TEXT NOT NULL,
  evaluated_by TEXT NOT NULL,
  UNIQUE (run_id, procedure_key, criterion_id)
);
CREATE INDEX idx_kill_criteria_eval_project ON kill_criteria_evaluation(project_id, evaluated_at DESC);
