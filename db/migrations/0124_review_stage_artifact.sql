-- @notransaction (PRAGMA foreign_keys cannot run inside a transaction, and
-- review_stage is rebuilt below: run_id must become nullable so a review can
-- address an artifact of an opportunity, which has no run.)
-- @reversible: true (the rebuild is row-preserving 1:1 and all new columns are
-- nullable or defaulted. Manual rollback: rebuild review_stage with the 0033
-- definition (run_id NOT NULL — delete or re-home rows whose run_id IS NULL
-- first) and drop the new index; or restore from a pre-migration backup —
-- scripts/co-newbiz/restore.ts — ADR-0014.)
--
-- ADR-0153 — 3-stage review runtime (Wave F, PR F-2). review_stage becomes
-- addressable per artifact: artifact_key (here `gate:<gate>` for the 7 gate
-- proposals), entity keys, stage_id, content_hash (sha256 of the canonical
-- artifact JSON — the AI 2nd cache key), buckets_json
-- ({verified[], could_not_verify[], needs_judgement[]}), author_domain,
-- model_id, cost_tokens (token-cap accounting), performed /
-- not_performed_reason (a missing reviewer, missing LLM or hit token cap is
-- recorded as NOT PERFORMED — never silently skipped, never a pass),
-- requested_by (the calling user; agents have no accounts — boundary #1) and
-- reviewed_refs_json (human_final: the artifact hash and AI review rows the
-- human saw).
--
-- NO PASS STAMP: the CHECK below allows a non-NULL `result` only on
-- stage='human_final' — the human's gate/transition decision word. AI stages
-- (ai_1st / ai_2nd) can never carry one. unverified_items_json stays NOT NULL
-- and mirrors could_not_verify (human_final: the items still unverified when
-- the human decided).
--
-- Migration date for grandfathering: 2026-10-08 (artifacts accepted at a gate
-- before the rollout PR are not reviewed retroactively).

PRAGMA foreign_keys = OFF;

CREATE TABLE review_stage_new (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT REFERENCES run(id),
  stage TEXT NOT NULL CHECK (stage IN ('ai_1st', 'ai_2nd', 'human_final')),
  reviewer_agent_or_user TEXT NOT NULL,
  reviewer_domain TEXT,
  unverified_items_json TEXT NOT NULL,
  result TEXT,
  created_at TEXT NOT NULL,
  artifact_key TEXT,
  entity_type TEXT CHECK (entity_type IS NULL OR entity_type IN ('project', 'opportunity')),
  entity_id TEXT,
  stage_id TEXT CHECK (stage_id IS NULL OR stage_id IN ('S1','S2','S3','S4','S5','S6','S7','S8','S9','S10','S11','S12')),
  content_hash TEXT,
  buckets_json TEXT,
  author_domain TEXT,
  model_id TEXT,
  cost_tokens INTEGER NOT NULL DEFAULT 0,
  performed INTEGER NOT NULL DEFAULT 1 CHECK (performed IN (0, 1)),
  not_performed_reason TEXT,
  requested_by TEXT,
  reviewed_refs_json TEXT,
  CHECK (stage = 'human_final' OR result IS NULL)
);
INSERT INTO review_stage_new (id, run_id, stage, reviewer_agent_or_user, reviewer_domain, unverified_items_json, result, created_at)
  SELECT id, run_id, stage, reviewer_agent_or_user, reviewer_domain, unverified_items_json, result, created_at FROM review_stage;
DROP TABLE review_stage;
ALTER TABLE review_stage_new RENAME TO review_stage;
CREATE INDEX idx_review_stage_run ON review_stage(run_id);
CREATE INDEX idx_review_stage_artifact ON review_stage(entity_type, entity_id, artifact_key, content_hash, stage);

PRAGMA foreign_keys = ON;
PRAGMA foreign_key_check;
