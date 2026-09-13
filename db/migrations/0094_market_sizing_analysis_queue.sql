-- @notransaction (PRAGMA foreign_keys cannot run inside a transaction, and the
-- table rebuild below must DROP the parent table while child FKs
-- (market_sizing_version.analysis_id) reference it.)
-- @reversible: true (table rebuild carries no data loss — all existing columns
-- and rows are reproduced verbatim; new nullable columns after_analysis_id /
-- linked_relation / started_at start empty and existing statuses all map into
-- the widened CHECK unchanged; manual rollback: rebuild again with the 0061
-- CHECK ('in_progress','completed','failed') and drop the three new columns and
-- the two queue indexes, or restore from pre-migration backup — see
-- scripts/co-newbiz/restore.ts, ADR-0014.)
-- S1 linked-industry serial queue (design 2026-09-13-value-chain-linkage —
-- meeting-2026-09-13 panel-review): linked industry analyses are created in a
-- 'pending' state anchored to their root via after_analysis_id and start only
-- after the root completes, one at a time (concurrency 1 per root group).
-- SQLite cannot ALTER a CHECK constraint in place, so the table is rebuilt
-- (create-with-CHECK, INSERT..SELECT, DROP, RENAME) per the 0061 pattern.
--
-- SELF-FK ORDERING (backend/data panel P0, verified against a scratch DB): the
-- after_analysis_id self-reference is added via ALTER TABLE ADD COLUMN *after*
-- the DROP/RENAME. Declaring it inside the rebuilt CREATE TABLE either binds it
-- to the soon-to-be-DROPPED old table (final name) or, with the temporary name,
-- leaves a dangling reference — the RENAME does not rewrite it reliably across
-- SQLite builds. ADD COLUMN after RENAME binds the FK to the final table.
--
-- POST-APPLY VERIFICATION CHECKLIST (migrate.ts ignores PRAGMA output — run by hand):
--   1. PRAGMA foreign_key_check;                      → must return 0 rows
--   2. PRAGMA foreign_key_list(market_sizing_analysis); → industry_id→md_industry,
--      after_analysis_id→market_sizing_analysis (self), both present
--   3. SELECT status, COUNT(*) FROM market_sizing_analysis GROUP BY status;
--      → same counts as pre-apply census (no 'pending' rows can exist yet)
--   4. PRAGMA integrity_check;                        → ok
--   5. The partial unique index below FAILS to create if historical rows already
--      violate it (two in_progress rows for one industry). If creation fails:
--      reconcile duplicates (keep newest, retire others) and re-run.

PRAGMA foreign_keys = OFF;

CREATE TABLE market_sizing_analysis_rebuilt (
  id TEXT PRIMARY KEY,
  industry_id TEXT NOT NULL REFERENCES md_industry(id),
  status TEXT NOT NULL CHECK (status IN ('in_progress', 'completed', 'failed', 'pending')),
  current_step INTEGER NOT NULL DEFAULT 0,
  methodology_version TEXT NOT NULL DEFAULT '1.1.0',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  error_message TEXT
);
INSERT INTO market_sizing_analysis_rebuilt (id, industry_id, status, current_step, methodology_version, created_by, created_at, completed_at, error_message)
  SELECT id, industry_id, status, current_step, methodology_version, created_by, created_at, completed_at, error_message FROM market_sizing_analysis;
DROP TABLE market_sizing_analysis;
ALTER TABLE market_sizing_analysis_rebuilt RENAME TO market_sizing_analysis;

-- Serial-queue columns — added post-RENAME so the self-FK binds to the final
-- table name (see SELF-FK ORDERING above).
ALTER TABLE market_sizing_analysis ADD COLUMN after_analysis_id TEXT REFERENCES market_sizing_analysis(id);
-- Demand-first claim ordering: 전방/전전방 dependents start before 후방/후후방.
ALTER TABLE market_sizing_analysis ADD COLUMN linked_relation TEXT CHECK (linked_relation IS NULL OR linked_relation IN ('전방', '전전방', '후방', '후후방'));
-- When the pipeline actually started running (claim time) — null while pending.
ALTER TABLE market_sizing_analysis ADD COLUMN started_at TEXT;

CREATE INDEX IF NOT EXISTS idx_msa_industry ON market_sizing_analysis(industry_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_msa_queue ON market_sizing_analysis(after_analysis_id, status);
-- One active analysis per industry across the queue states (P2-1 — POST race
-- guard; see also the in_progress reuse guard in POST /market-overview/analyses).
CREATE UNIQUE INDEX IF NOT EXISTS uq_msa_one_active
  ON market_sizing_analysis(industry_id) WHERE status IN ('in_progress', 'pending');
-- Rebuild the child index dropped with the old table, if named explicitly.
CREATE INDEX IF NOT EXISTS idx_msv_analysis ON market_sizing_version(analysis_id, version_no);

PRAGMA foreign_keys = ON;
PRAGMA foreign_key_check;
