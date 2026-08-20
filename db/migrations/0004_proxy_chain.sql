-- @reversible: true (additive-only schema, no destructive DDL against existing production data — ADR-0014; rollback mechanism is pre-migration backup restore, see scripts/co-newbiz/restore.ts)
-- Proxy chain hops and chain-level reliability grade — docs/db-schema.md §3,
-- meeting M4 (D-M4-1 through D-M4-4). Deliberately NO shared FK path to
-- value_chain_link (ADR-0025, meeting M4 D-M4-4's structural separation
-- requirement) — a proxy_link coefficient can never be read as a
-- value_chain_link coefficient or vice versa, by construction, not just by
-- convention.

CREATE TABLE proxy_link (
  id TEXT PRIMARY KEY,
  from_industry_id TEXT NOT NULL REFERENCES md_industry(id),
  to_industry_id TEXT NOT NULL REFERENCES md_industry(id),
  hop_type TEXT NOT NULL CHECK (hop_type IN ('engineering', 'statistical')),
  -- Engineering hops: coefficient is a fixed physical constant, beta/r2/lag
  -- are NULL (no regression was run). Statistical hops: beta/r2/lag/ci
  -- populated from python/correlation.py's output.
  coefficient REAL,
  beta REAL,
  r2 REAL,
  lag_months INTEGER,
  ci_low REAL,
  ci_high REAL,
  evidence_ref TEXT NOT NULL,
  calibrated_at TEXT,
  CHECK (
    (hop_type = 'engineering' AND coefficient IS NOT NULL AND beta IS NULL)
    OR
    (hop_type = 'statistical' AND beta IS NOT NULL AND r2 IS NOT NULL)
  )
);
CREATE INDEX idx_proxy_link_chain ON proxy_link(from_industry_id, to_industry_id);

-- Chain-level grade, precomputed at calibration time (D-M4-3) — never
-- recomputed at runtime.
CREATE TABLE proxy_chain (
  id TEXT PRIMARY KEY,
  target_industry_id TEXT NOT NULL REFERENCES md_industry(id),
  hop_ids TEXT NOT NULL, -- JSON array of proxy_link.id, in chain order
  reliability_grade TEXT NOT NULL CHECK (reliability_grade IN ('A', 'B', 'C')),
  grade_rationale TEXT NOT NULL,
  compounded_ci_low REAL,
  compounded_ci_high REAL,
  calibrated_at TEXT NOT NULL
);
