-- @reversible: true (additive: three nullable/defaulted columns, two partial indexes; the
-- only row write is the copy of confirmed_from_version_id into the new source_version_id.
-- Every existing verdict becomes 'human' through the column DEFAULT. Premise and its limit: the
-- ADR-0199 confirm route was human-only, but before 0197 the eval-state PUT was also reachable by
-- MCP record_candidate_screening and by bearer tokens, and only edit_from_version saves were audited,
-- so rows written by agents before this migration cannot be told apart from a person's.
-- OPERATOR PRE-DEPLOY CHECK (run before applying; if any agent write could have happened, set those rows to
-- 'ai_draft' after the migration: UPDATE brownfield_target_eval_state SET verdict_source='ai_draft' WHERE id IN (...)):
--   SELECT s.id, s.assessed_by, s.assessed_at, t.id AS token_id, t.kind, t.scopes, t.last_used_at
--     FROM brownfield_target_eval_state s
--     JOIN api_token t ON t.user_id = s.assessed_by
--    WHERE t.scopes LIKE '%write%' AND t.created_at <= s.assessed_at
--      AND (t.revoked_at IS NULL OR t.revoked_at >= s.assessed_at)
--      AND (t.last_used_at IS NULL OR t.last_used_at >= s.assessed_at);
--   (api_token holds personal and oauth_access/oauth_refresh tokens; compare the usage windows with assessed_at.)
-- Rollback (ADR-0014): run in maintenance / read-only mode (a person saving through the old code in the gap
-- would lose the save). Roll the code back first, take the pre-migration backup, then run the
-- ROLLBACK-SQL block. Step 1 is mandatory and runs BEFORE the column is removed: once
-- verdict_source is gone, an AI verdict would read as a human one. Non-human verdicts are
-- reset to pending; they remain reproducible from their immutable versions and the audit log.)
-- ROLLBACK-SQL-BEGIN
--   UPDATE brownfield_target_eval_state SET status = 'pending', note = NULL, evidence_ref = NULL WHERE verdict_source <> 'human' AND status <> 'pending';
--   UPDATE brownfield_target_eval_state SET confirmed_from_version_id = NULL WHERE verdict_source <> 'human' OR confirmed_from_version_id IS NOT source_version_id;
--   DROP INDEX idx_bf_target_eval_state_unreviewed;
--   DROP INDEX idx_bf_target_eval_state_source_version;
--   ALTER TABLE brownfield_eval_draft_run_item DROP COLUMN apply_summary;
--   ALTER TABLE brownfield_target_eval_state DROP COLUMN verdict_source;
--   (source_version_id takes part in a FOREIGN KEY, so SQLite cannot DROP COLUMN it:
--    rebuild brownfield_target_eval_state without it (0104 create-copy-rename pattern)
--    or restore the pre-migration backup.)
-- ROLLBACK-SQL-END
--
-- 0197_eval_state_verdict_source.sql
-- ADR-0200 (spec 2026-11-17-s6-direct-ai-verdict §3.3): AI evaluation results are applied
-- directly as item verdicts; every verdict records its origin.
-- Layer: fact. verdict_source is a closed three-value code system enforced by CHECK (the 0104
-- status precedent), so no free-text code column is introduced (FR-DATA-02/04); no md_* change.
-- confirmed_from_version_id (0194) is frozen from here on: no code writes it, readers switch to
-- source_version_id. No monetary column (ADR-0061).
-- Portability (ADR-0002): ADD COLUMN with a constant default plus a self-referencing CHECK, a
-- nullable FK column, and partial indexes are portable; json_valid follows the 0150/0193/0194
-- precedent and carries the same portability note.
-- Invariant not expressible by ALTER: "auto_rule => source_version_id NOT NULL" needs a table
-- CHECK (a rebuild); it is enforced in the single write path (writeEvalVerdict in
-- db/repositories/brownfield-eval-draft.repository.ts) and asserted by test TA3.
-- Health-after (dba): PRAGMA foreign_key_check (0 rows); PRAGMA integrity_check (ok);
--   SELECT COUNT(*) FROM brownfield_target_eval_state WHERE verdict_source <> 'human' = 0;
--   SELECT COUNT(*) FROM brownfield_target_eval_state WHERE confirmed_from_version_id IS NOT source_version_id = 0.

ALTER TABLE brownfield_target_eval_state
  ADD COLUMN verdict_source TEXT NOT NULL DEFAULT 'human'
  CHECK (verdict_source IN ('human', 'auto_rule', 'ai_draft'));

ALTER TABLE brownfield_target_eval_state
  ADD COLUMN source_version_id TEXT REFERENCES brownfield_eval_draft_version(id);

-- Backfill: one forward link for every origin; the 0194 column is frozen from here on.
UPDATE brownfield_target_eval_state
   SET source_version_id = confirmed_from_version_id
 WHERE confirmed_from_version_id IS NOT NULL;

-- Pattern: "verdicts resting on version V" (version history panel applied/reviewed counts,
-- audit lookup). Replaces idx_bf_target_eval_state_from_version for new reads; the 0194
-- index stays for the frozen column.
CREATE INDEX idx_bf_target_eval_state_source_version
  ON brownfield_target_eval_state(source_version_id)
  WHERE source_version_id IS NOT NULL;

-- Pattern: "unreviewed AI verdicts of candidate T" (longlist marker, promote warning,
-- committee brief). Partial, so it holds only the rows a person still has to look at.
CREATE INDEX idx_bf_target_eval_state_unreviewed
  ON brownfield_target_eval_state(brownfield_target_id)
  WHERE verdict_source <> 'human' AND status <> 'pending';

-- Per-category apply counts and skip reasons, e.g.
--   {"financial": {"applied": 4, "kept_human": 2, "unverified": 0, "cleared": 0,
--                  "skipped": [{"criterion_id": "...", "reason": "criterion_changed"}]},
--    "technical": {...}}
ALTER TABLE brownfield_eval_draft_run_item
  ADD COLUMN apply_summary TEXT
  CHECK (apply_summary IS NULL OR json_valid(apply_summary) = 1);
