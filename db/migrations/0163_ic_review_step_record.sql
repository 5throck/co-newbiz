-- 0163_ic_review_step_record.sql (2026-10-21 S11 투자심사 절차 표면화).
-- procedures/_shared/entity-ic-review (8 steps) and group-investment-review
-- (6 steps) had, in the workspace, only their first (AI-proposed RAG) and last
-- (human gate decision) steps: Kill Criteria explicit pass/fail, the IC memo,
-- the certainty-of-funds precondition, the integrated insight review and the
-- decision deck were spec-only. This append-only ledger records each
-- intermediate step as the person performs it; derived steps (RAG, financing
-- readiness, gate decisions) are read from their own ledgers and never
-- duplicated here. payload_json carries the step's structured content (e.g.
-- the per-criterion verdicts for step 2, the memo snapshot + hash for step 3).
CREATE TABLE ic_review_step_record (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  procedure TEXT NOT NULL CHECK (procedure IN ('entity-ic-review', 'group-investment-review')),
  step_id TEXT NOT NULL,
  output_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pass', 'fail', 'na', 'recorded')),
  payload_json TEXT,
  evidence_ref TEXT,
  recorded_by TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);
CREATE INDEX idx_ic_review_step_record_step ON ic_review_step_record(project_id, procedure, step_id, recorded_at);
