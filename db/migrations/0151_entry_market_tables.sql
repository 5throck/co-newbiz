-- ADR-0181 (2026-10-17): the entry market becomes the SUBJECT MARKET of
-- S3~S12, and its person-set inputs move from JSON payload columns into
-- FK-based tables (the ERD-normalization principle declared for S1~S12;
-- this migration normalizes S2). Two aggregates, deliberately separate
-- (review-board P0): the target SCOPE is storable without a link (today's
-- target-scope PUT semantics), while the DERIVATION aggregate requires the
-- pinned S1 version. Supersedes 0150's "lineage in a payload, no separate
-- table" storage decision; the DERIVED VALUE is still always computed and
-- never stored. Legacy JSON columns are backfilled below and stay as
-- read-only fallbacks (conditional freeze: chains whose opportunity has no
-- sizing_version_id cannot migrate and keep reading from the JSON column).
-- bc.fx_rate assumptions (ADR-0180 slice 7, removed) migrate into
-- entry_market_fx where the opportunity has an entry_market row.

-- @reversible: true
-- ROLLBACK-SQL-BEGIN
-- DROP TABLE entry_market_competitive;
-- DROP TABLE entry_market_step;
-- DROP TABLE entry_market_fx;
-- DROP TABLE entry_market;
-- DROP TABLE target_scope_segment;
-- DROP TABLE target_scope_region;
-- DROP TABLE opportunity_target_scope;
-- (legacy JSON columns on opportunity were never dropped; backfilled rows
-- keep their JSON source so data survives the rollback untouched.)
-- ROLLBACK-SQL-END

CREATE TABLE opportunity_target_scope (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL UNIQUE REFERENCES opportunity(id),
  unit_basis TEXT CHECK (unit_basis IS NULL OR length(unit_basis) <= 32),
  set_by TEXT NOT NULL,
  set_at TEXT NOT NULL
);

CREATE TABLE target_scope_region (
  id TEXT PRIMARY KEY,
  scope_id TEXT NOT NULL REFERENCES opportunity_target_scope(id) ON DELETE CASCADE,
  code TEXT NOT NULL CHECK (length(code) > 0),
  position INTEGER NOT NULL,
  UNIQUE (scope_id, code)
);

CREATE TABLE target_scope_segment (
  id TEXT PRIMARY KEY,
  scope_id TEXT NOT NULL REFERENCES opportunity_target_scope(id) ON DELETE CASCADE,
  code TEXT NOT NULL CHECK (length(code) > 0),
  position INTEGER NOT NULL,
  UNIQUE (scope_id, code)
);

CREATE TABLE entry_market (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL UNIQUE REFERENCES opportunity(id),
  sizing_version_id TEXT NOT NULL REFERENCES market_sizing_version(id),
  market_brief TEXT CHECK (market_brief IS NULL OR length(market_brief) <= 2000),
  -- anchor currency derived from the S1 unit declaration (usd_m_year -> USD),
  -- person-confirmable; KRW/units basis means no FX is needed (NULL).
  currency TEXT CHECK (currency IS NULL OR (length(currency) = 3 AND currency = upper(currency))),
  -- the entry-market growth as a RATIO (0..1]. cagrBase in the S1 matrix is a
  -- fraction; percent-scale input is rejected at the write path.
  growth_rate REAL CHECK (growth_rate IS NULL OR (growth_rate >= 0 AND growth_rate <= 1)),
  set_by TEXT NOT NULL,
  set_at TEXT NOT NULL
);

CREATE TABLE entry_market_fx (
  id TEXT PRIMARY KEY,
  entry_market_id TEXT NOT NULL REFERENCES entry_market(id) ON DELETE CASCADE,
  currency TEXT NOT NULL CHECK (length(currency) = 3 AND currency = upper(currency)),
  rate REAL NOT NULL CHECK (rate > 0 AND rate <= 1000000),
  volatility REAL CHECK (volatility IS NULL OR (volatility >= 0 AND volatility <= 0.5)),
  set_by TEXT NOT NULL,
  set_at TEXT NOT NULL,
  UNIQUE (entry_market_id, currency)
);

CREATE TABLE entry_market_step (
  id TEXT PRIMARY KEY,
  entry_market_id TEXT NOT NULL REFERENCES entry_market(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL CHECK (seq >= 0),
  base TEXT NOT NULL CHECK (base = 's1_anchor' OR (base GLOB 'step:[0-9]*' AND length(base) <= 16)),
  factor REAL NOT NULL CHECK (factor > 0 AND factor <= 1),
  source TEXT NOT NULL CHECK (length(trim(source)) > 0),
  as_of TEXT NOT NULL CHECK (length(trim(as_of)) > 0),
  -- kept for derivation-hash provenance stability (ADR-0181 §2); the person-
  -- facing annotation inputs are removed from the UI, new writes omit tags.
  note TEXT CHECK (note IS NULL OR length(note) <= 300),
  origin TEXT CHECK (origin IS NULL OR origin = 'ai_suggested'),
  region_tags_json TEXT CHECK (region_tags_json IS NULL OR json_valid(region_tags_json) = 1),
  segment_tags_json TEXT CHECK (segment_tags_json IS NULL OR json_valid(segment_tags_json) = 1),
  UNIQUE (entry_market_id, seq)
);

CREATE TABLE entry_market_competitive (
  id TEXT PRIMARY KEY,
  entry_market_id TEXT NOT NULL REFERENCES entry_market(id) ON DELETE CASCADE,
  player TEXT NOT NULL CHECK (length(trim(player)) > 0),
  tier TEXT CHECK (tier IS NULL OR length(tier) <= 32),
  region TEXT CHECK (region IS NULL OR length(region) <= 64),
  source TEXT CHECK (source IS NULL OR length(source) <= 200),
  set_by TEXT NOT NULL,
  set_at TEXT NOT NULL
);

-- ── Backfill ────────────────────────────────────────────────────────────────
-- Scope: every opportunity with a target_scope_json, link-independent
-- (review-board P0: scope-only rows are a real, supported state).

INSERT INTO opportunity_target_scope (id, opportunity_id, unit_basis, set_by, set_at)
SELECT
  'emscope-' || o.id,
  o.id,
  json_extract(o.target_scope_json, '$.unit_basis'),
  COALESCE(json_extract(o.target_scope_json, '$.set_by'), 'backfill'),
  COALESCE(json_extract(o.target_scope_json, '$.set_at'), o.created_at)
FROM opportunity o
WHERE o.target_scope_json IS NOT NULL;

INSERT INTO target_scope_region (id, scope_id, code, position)
SELECT
  'emscopereg-' || s.opportunity_id || '-' || (je.key),
  s.id,
  je.value,
  CAST(je.key AS INTEGER)
FROM opportunity_target_scope s
JOIN opportunity o ON o.id = s.opportunity_id
JOIN json_each(o.target_scope_json, '$.regions') je
WHERE CAST(je.value AS TEXT) <> '';

INSERT INTO target_scope_segment (id, scope_id, code, position)
SELECT
  'emscopeseg-' || s.opportunity_id || '-' || (je.key),
  s.id,
  je.value,
  CAST(je.key AS INTEGER)
FROM opportunity_target_scope s
JOIN opportunity o ON o.id = s.opportunity_id
JOIN json_each(o.target_scope_json, '$.segments') je
WHERE CAST(je.value AS TEXT) <> '';

-- Derivation aggregate: ONLY rows whose opportunity still has a pinned S1
-- version (a chain whose link was cleared stays JSON-readable — conditional
-- freeze, ADR-0181 §2). Deterministic ids keep re-runs no-ops.

INSERT INTO entry_market (id, opportunity_id, sizing_version_id, set_by, set_at)
SELECT
  'emkt-' || o.id,
  o.id,
  o.sizing_version_id,
  COALESCE(json_extract(o.entry_market_derivation_json, '$.set_by'), 'backfill'),
  COALESCE(json_extract(o.entry_market_derivation_json, '$.set_at'), o.created_at)
FROM opportunity o
WHERE o.entry_market_derivation_json IS NOT NULL
  AND o.sizing_version_id IS NOT NULL;

INSERT INTO entry_market_step (id, entry_market_id, seq, base, factor, source, as_of, note, origin, region_tags_json, segment_tags_json)
SELECT
  'emstep-' || o.id || '-' || (je.key),
  'emkt-' || o.id,
  CAST(je.key AS INTEGER),
  json_extract(je.value, '$.base'),
  json_extract(je.value, '$.factor'),
  json_extract(je.value, '$.source'),
  json_extract(je.value, '$.as_of'),
  json_extract(je.value, '$.note'),
  json_extract(je.value, '$.origin'),
  CASE
    WHEN json_extract(je.value, '$.region_tags') IS NOT NULL
      THEN (SELECT json_group_array(jt.value) FROM json_each(je.value, '$.region_tags') jt)
    ELSE NULL
  END,
  CASE
    WHEN json_extract(je.value, '$.segment_tags') IS NOT NULL
      THEN (SELECT json_group_array(jt.value) FROM json_each(je.value, '$.segment_tags') jt)
    ELSE NULL
  END
FROM opportunity o
JOIN json_each(o.entry_market_derivation_json, '$.steps') je
WHERE o.entry_market_derivation_json IS NOT NULL
  AND o.sizing_version_id IS NOT NULL;

-- bc.fx_rate (ADR-0180 slice 7) migration: the latest user row per project
-- becomes a person-set USD rate on the opportunity's entry_market record.
INSERT INTO entry_market_fx (id, entry_market_id, currency, rate, volatility, set_by, set_at)
SELECT
  'emfx-' || em.opportunity_id,
  em.id,
  'USD',
  (SELECT a.value FROM assumption a
    JOIN run r ON r.id = a.run_id
    JOIN md_project p ON p.id = r.project_id
   WHERE p.source_opportunity_id = em.opportunity_id
     AND a.assumption_key = 'bc.fx_rate' AND a.kind = 'user'
   ORDER BY a.as_of DESC, r.created_at DESC, a.id DESC LIMIT 1),
  NULL,
  'backfill-bc-fx-rate',
  em.set_at
FROM entry_market em
WHERE EXISTS (
  SELECT 1 FROM assumption a
    JOIN run r ON r.id = a.run_id
    JOIN md_project p ON p.id = r.project_id
   WHERE p.source_opportunity_id = em.opportunity_id
     AND a.assumption_key = 'bc.fx_rate' AND a.kind = 'user'
);
