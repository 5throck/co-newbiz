-- @reversible: true (purely additive — two ALTER TABLE ADD COLUMN (nullable, row-preserving by definition) + one CREATE TABLE; no rebuild, no DROP, no data change; rollback mechanism is pre-migration backup restore, see scripts/co-newbiz/restore.ts — ADR-0014)
-- Six-validator completeness record + not_applicable invalidation — design of
-- record docs/designs/2026-08-22-rag-formalization-and-case-classification-design.md,
-- Decisions 5d/5f/5g, ADR-0048 §4-§5. PR-5c.
--
-- (a) compliance_check invalidation columns (ADR-0048 §5): a not_applicable
--     row derives its justification from a specific classification row, so
--     superseding that classification must retire the skip. SQLite ADD COLUMN
--     is row-preserving by construction (every existing row gains the column
--     as NULL); no 0013-style rebuild is needed because nothing about the
--     existing columns changes. invalidated_by_classification points at the
--     row that BECAME live (the superseding classification) — the audit link
--     "this skip died when classification X took over", not a second citation
--     of the already-cited predecessor.
--     An invalidated not_applicable row no longer counts as coverage
--     (constraint 4: a skip can never outlive the classification that
--     justified it) — enforced by the reader (db/lib/validator-completeness.ts),
--     not by deletion: compliance_check is an append-only audit trail.
--
-- (b) validator_completeness_record (ADR-0048 §4): the durable 3-number
--     artifact ("6 declared / N applicable / M completed") brownfield-dd
--     step 14 emits. A boolean cannot distinguish "all six ran" from "two
--     ran and four were classified away" — the three numbers can.
--     declared is pinned to 6 by CHECK: the no-waiver core's size is a
--     governance fact (design §8.9-1(f)), not a per-project variable.
--     completed_count may exceed applicable_count — M counts coverage rows
--     across ALL SIX (a not_applicable row for a legitimately-skipped
--     validator is completed-with-reason, ADR-0048 §3), so the honest bounds
--     are 0..6 for both N and M, never M <= N.
--     validator_rows is a JSON array, one object per validator
--     {key, status, compliance_check_id} — status ∈ completed | not_applicable
--     | missing; written by db/repositories/compliance.repository.ts.
--
-- Pre-checks verified 2026-08-23 against the post-0015 schema:
--   * FK targets exist: md_project(id) (migration 0001), run(id) (0003),
--     project_case_classification(id) (0013).
--   * SQLite permits ADD COLUMN with a nullable REFERENCES clause under
--     PRAGMA foreign_keys=ON (default NULL satisfies the FK).
--   * No view/trigger references compliance_check beyond 0008's, which do
--     not touch it (verified in 0013's pre-checks; nothing since added any).

ALTER TABLE compliance_check ADD COLUMN invalidated_at TEXT;
ALTER TABLE compliance_check ADD COLUMN invalidated_by_classification TEXT REFERENCES project_case_classification(id);

CREATE TABLE validator_completeness_record (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  run_id TEXT REFERENCES run(id),
  gate TEXT NOT NULL CHECK (gate IN ('dd')),
  declared INTEGER NOT NULL CHECK (declared = 6),
  applicable_count INTEGER NOT NULL CHECK (applicable_count >= 0 AND applicable_count <= 6),
  completed_count INTEGER NOT NULL CHECK (completed_count >= 0 AND completed_count <= 6),
  validator_rows TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_validator_completeness_record ON validator_completeness_record(project_id, gate, created_at DESC);
