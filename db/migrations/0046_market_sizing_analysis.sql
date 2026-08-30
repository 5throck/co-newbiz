-- @reversible: true (additive-only schema, no destructive DDL against existing production data — ADR-0014; rollback mechanism is pre-migration backup restore, see scripts/co-newbiz/restore.ts)
-- Market-sizing analysis registry + version tracking (systematic-market-sizing
-- skill, /market S1 surface). One analysis per industry; every completed
-- analysis pass lands a new version row (append-only, per the evidence-ledger
-- supersede discipline).

CREATE TABLE market_sizing_analysis (
  id TEXT PRIMARY KEY,
  industry_id TEXT NOT NULL REFERENCES md_industry(id),
  status TEXT NOT NULL CHECK (status IN ('in_progress', 'completed')),
  current_step INTEGER NOT NULL DEFAULT 0,
  methodology_version TEXT NOT NULL DEFAULT '1.1.0',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX idx_msa_industry ON market_sizing_analysis(industry_id, created_at DESC);

CREATE TABLE market_sizing_version (
  id TEXT PRIMARY KEY,
  analysis_id TEXT NOT NULL REFERENCES market_sizing_analysis(id),
  version_no INTEGER NOT NULL,
  payload TEXT NOT NULL,
  changelog TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (analysis_id, version_no)
);
CREATE INDEX idx_msv_analysis ON market_sizing_version(analysis_id, version_no DESC);
