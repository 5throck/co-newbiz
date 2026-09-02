-- @notransaction (PRAGMA foreign_keys cannot run inside a transaction, and the
-- table rebuild below must DROP the parent table while child FKs
-- (market_sizing_version.analysis_id) reference it.)
-- @reversible: true (table rebuild carries no data loss — all existing columns
-- and rows are reproduced verbatim, only the status CHECK gains 'failed' and a
-- new nullable error_message column is added; manual rollback: rebuild again
-- with the 0046 CHECK ('in_progress','completed') and drop error_message, or
-- restore from pre-migration backup — see scripts/co-newbiz/restore.ts, ADR-0014.)
-- Adds a 'failed' status to market_sizing_analysis so the pipeline (and its
-- callers) can record a terminal failure instead of leaving rows stuck in
-- 'in_progress' forever when an LLM call throws or the DB write fails
-- mid-pipeline. SQLite cannot ALTER a CHECK constraint in place, so the table
-- is rebuilt (create-with-CHECK, INSERT..SELECT, DROP, RENAME) per the 0019
-- pattern. error_message is nullable TEXT — populated only on 'failed'.

PRAGMA foreign_keys = OFF;

CREATE TABLE market_sizing_analysis_rebuilt (
  id TEXT PRIMARY KEY,
  industry_id TEXT NOT NULL REFERENCES md_industry(id),
  status TEXT NOT NULL CHECK (status IN ('in_progress', 'completed', 'failed')),
  current_step INTEGER NOT NULL DEFAULT 0,
  methodology_version TEXT NOT NULL DEFAULT '1.1.0',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  error_message TEXT
);
INSERT INTO market_sizing_analysis_rebuilt (id, industry_id, status, current_step, methodology_version, created_by, created_at, completed_at, error_message)
  SELECT id, industry_id, status, current_step, methodology_version, created_by, created_at, completed_at, NULL FROM market_sizing_analysis;
DROP TABLE market_sizing_analysis;
ALTER TABLE market_sizing_analysis_rebuilt RENAME TO market_sizing_analysis;
CREATE INDEX IF NOT EXISTS idx_msa_industry ON market_sizing_analysis(industry_id, created_at DESC);
-- Rebuild the two child indexes dropped with the old table, if named explicitly.
CREATE INDEX IF NOT EXISTS idx_msv_analysis ON market_sizing_version(analysis_id, version_no);

PRAGMA foreign_keys = ON;
PRAGMA foreign_key_check;
