-- @reversible: true (purely additive — one CREATE TABLE + one CREATE INDEX on
-- a table with zero rows at birth; rollback mechanism is pre-migration backup
-- restore, see scripts/co-newbiz/restore.ts — ADR-0014.)
-- ADR-0101 §1 — the S11 portfolio transition-decision ledger. 0024's own
-- header excluded decisions ("venture_transition_decision and tranche releases
-- are approval-chain records; this table stores evidence rows only") and no
-- table, column, or code reference existed before this file — nothing to
-- reuse, so this is the small additive table the ADR specifies verbatim.
--
-- Design (ADR-0101 §1):
--   * APPEND-ONLY ledger — no UPDATE path exists anywhere; a corrected IC
--     outcome is a NEW row for the same review_cycle (the index below is
--     deliberately NON-unique), and the latest row by (decided_at, id) is
--     what readers surface. History is the point of a governance ledger.
--   * decision — the exact S11 five-vocabulary from flow.spec v2.0.0 /
--     procedures/_shared/portfolio-venture-monitoring/schema.yaml, mirrored
--     by PORTFOLIO_TRANSITIONS in app/web-next/lib/process-flow.ts (the two
--     must stay in lockstep — ADR-0098 type-and-spec-port pattern).
--   * decided_by — CHECK-pinned to the ADR-0053 human-role key
--     'venture-portfolio-ic': an agent identity can never be the decider of
--     record (design boundary #2 — tranche release and kill/divest are
--     investment decisions).
--   * The RECORDER (whoever wrote the row) is tracked by run/actor lineage
--     (ADR-0005) — run_id + run.created_by + the audit row. This is how the
--     ADR-0100 recorder pattern is expressed without a second column: the
--     route is operated by the recorder agent/user recording the IC's
--     decision made in the sitting; the agent records, it never decides.
--   * rationale REQUIRED (CHECK <> '') — "a kill is a governed decision, not
--     a silent starve" (procedure step 3); learning_capture is optional and
--     carries the playbook recycle note where the IC supplied one (the route
--     additionally REQUIRES it for kill_with_learning_captured).
--   * No UPDATE/DELETE path is granted here and none is implemented —
--     append-only by construction.
CREATE TABLE venture_transition_decision (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES run(id),
  project_id TEXT NOT NULL REFERENCES md_project(id),
  review_cycle TEXT NOT NULL CHECK (review_cycle GLOB '????-Q[1-4]'),
  decision TEXT NOT NULL CHECK (decision IN (
    'next_tranche_released','held_evidence_incomplete',
    'graduate_to_core','reduce_or_divest','kill_with_learning_captured')),
  decided_by TEXT NOT NULL CHECK (decided_by = 'venture-portfolio-ic'),
  decided_at TEXT NOT NULL,
  rationale TEXT NOT NULL CHECK (rationale <> ''),
  learning_capture TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_vtd_project ON venture_transition_decision(project_id, review_cycle);
