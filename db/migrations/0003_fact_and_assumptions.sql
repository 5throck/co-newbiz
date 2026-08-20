-- @reversible: true (additive-only schema, no destructive DDL against existing production data — ADR-0014; rollback mechanism is pre-migration backup restore, see scripts/co-newbiz/restore.ts)
-- Fact/observation and assumption/run tables — docs/db-schema.md §3-4.
-- Revision-preserving by design (FR-DATA-05): fact_market_observation's PK
-- includes revision_no, so ensure_fresh() never overwrites a prior value,
-- it inserts a new revision row.

CREATE TABLE raw_payload (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES md_source(id),
  fetched_at TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX idx_raw_payload_source ON raw_payload(source_id, fetched_at DESC);

CREATE TABLE fact_market_observation (
  series_id TEXT NOT NULL,
  period_id TEXT NOT NULL REFERENCES md_period(id),
  revision_no INTEGER NOT NULL,
  value REAL NOT NULL,
  unit_id TEXT NOT NULL REFERENCES md_unit(id),
  source_id TEXT NOT NULL REFERENCES md_source(id),
  content_hash TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (series_id, period_id, revision_no)
);
-- ensure_fresh()'s primary read path: latest revision for a series/period.
CREATE INDEX idx_obs_latest ON fact_market_observation(series_id, period_id DESC);

CREATE TABLE data_change_log (
  id TEXT PRIMARY KEY,
  series_id TEXT NOT NULL,
  detected_at TEXT NOT NULL,
  change_type TEXT NOT NULL CHECK (change_type IN ('new', 'revised', 'deleted')),
  old_value REAL,
  new_value REAL
);
CREATE INDEX idx_change_log_series ON data_change_log(series_id, detected_at DESC);

CREATE TABLE assumption (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  assumption_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('live', 'user', 'derived', 'assumed')),
  value REAL NOT NULL,
  rationale TEXT,
  anchor_ref TEXT,
  as_of TEXT NOT NULL,
  ttl_days INTEGER,
  -- FR-DATA-07: assumed inputs must carry a rationale. Enforced here, not
  -- just in application code, since this is the boundary the design says
  -- must never silently pass.
  CHECK (kind != 'assumed' OR (rationale IS NOT NULL AND rationale != ''))
);
CREATE INDEX idx_assumption_run ON assumption(run_id, assumption_key);

CREATE TABLE run (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  label TEXT,
  input_hash TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  superseded_by TEXT REFERENCES run(id)
);
CREATE INDEX idx_run_project ON run(project_id, created_at DESC);

CREATE TABLE run_input (
  run_id TEXT NOT NULL REFERENCES run(id),
  assumption_key TEXT NOT NULL,
  value REAL NOT NULL,
  PRIMARY KEY (run_id, assumption_key)
);
