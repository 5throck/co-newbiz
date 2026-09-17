-- @notransaction (PRAGMA foreign_keys cannot run inside a transaction, and the
-- gate_evaluation CHECK rebuild below rewrites the table in place.)
-- 0111_gate_evaluation_target_screening.sql
-- @reversible: true (row-preserving table rebuild + a scoped data re-point;
-- manual rollback: rebuild again with the 0045 CHECK and re-point the same
-- rows back to 'screening', or restore from a pre-migration backup —
-- scripts/co-newbiz/restore.ts.)
--
-- Spec-engine alignment for the S7 committee (flow.spec v2.4.1, design
-- 2026-09-18-s1s7-process-alignment): the target-longlist-shortlist committee
-- deliberates the S7 gate, but 0045's gate_evaluation CHECK predates
-- 'target_screening' (it was added only to gate_decision in 0062), so the
-- panel convened under the wrong key 'screening'
-- (app/brownfield/page.tsx gates={["screening"]}) while the human decision
-- below recorded target_screening. Three changes:
-- 1. gate_evaluation CHECK widens to accept 'target_screening' (0062
--    row-preserving rebuild pattern; 0066's dissent_json column carried over).
-- 2. Historical evaluations of that committee are re-pointed from 'screening'
--    to 'target_screening' (joined via process_run.meta_json committee_key,
--    written by lib/committee-session.ts per 0067).
-- 3. The legacy `decision` table (0045) keeps its narrow enum — no writers
--    exist anywhere in the app; widening it now would be speculative.

PRAGMA foreign_keys = OFF;

CREATE TABLE gate_evaluation_rebuilt (
  id TEXT PRIMARY KEY NOT NULL,
  process_run_id TEXT NOT NULL REFERENCES process_run(id),
  gate TEXT NOT NULL CHECK (gate IN ('screening', 'pre_fs', 'target_screening', 'fs', 'dd', 'entity_ic', 'group_ic')),
  criteria_json TEXT NOT NULL,
  score REAL,
  evidence_json TEXT,
  recommendation TEXT NOT NULL CHECK (recommendation IN ('go', 'hold', 'kill')),
  evaluated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  dissent_json TEXT
);
INSERT INTO gate_evaluation_rebuilt (id, process_run_id, gate, criteria_json, score, evidence_json, recommendation, evaluated_by, created_at, dissent_json)
  SELECT id, process_run_id, gate, criteria_json, score, evidence_json, recommendation, evaluated_by, created_at, dissent_json FROM gate_evaluation;
DROP TABLE gate_evaluation;
ALTER TABLE gate_evaluation_rebuilt RENAME TO gate_evaluation;
CREATE INDEX idx_gate_evaluation_run ON gate_evaluation(process_run_id, created_at);

-- Data fix: the S7 committee's historical proposals were stored under the
-- wrong key. Only rows whose convening session declares the
-- target-longlist-shortlist committee are re-pointed; every other committee's
-- 'screening' rows (e.g. the S3 screening gate surface) stay untouched.
UPDATE gate_evaluation
  SET gate = 'target_screening'
  WHERE gate = 'screening'
    AND process_run_id IN (
      SELECT id FROM process_run
      WHERE json_extract(meta_json, '$.committee_key') = 'target-longlist-shortlist-committee'
    );

PRAGMA foreign_keys = ON;
PRAGMA foreign_key_check;
