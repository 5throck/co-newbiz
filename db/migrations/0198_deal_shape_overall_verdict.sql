-- @notransaction
-- 0198_deal_shape_overall_verdict.sql
-- @version 1.0.0
-- @reversible: false in the general case (the table is rebuilt to relax NOT NULL on shape/intent and to widen the table CHECK;
-- SQLite cannot alter either in place, so every existing row is copied verbatim into the new shape. In-place rollback back to the
-- 0188 shape is valid ONLY while no overall row exists: run the guard query first and abort unless it returns 0. Otherwise restore the
-- pre-migration backup (scripts/co-newbiz/restore.ts, ADR-0014); rows recorded after this migration are lost on a backup restore.
-- Code and migration roll back together, because 0188-era code cannot read a NULL shape. This migration rebuilds a table and is
-- tagged irreversible: it needs dba execution and release-engineer sign-off (FR-OPS-02, backup first) before it runs against any
-- non-scratch database.)
-- ROLLBACK-SQL-BEGIN
--   PRAGMA foreign_keys = OFF;
--   -- GUARD (must be 0, else restore the backup instead): SELECT COUNT(*) FROM opportunity_deal_shape_evaluation WHERE shape IS NULL;
--   DROP INDEX idx_odse_live_overall;
--   DROP INDEX idx_odse_live;
--   DROP INDEX idx_odse_opp;
--   CREATE TABLE opportunity_deal_shape_evaluation_old (id TEXT PRIMARY KEY NOT NULL, opportunity_id TEXT NOT NULL REFERENCES opportunity(id), shape TEXT NOT NULL CHECK (shape IN ('full_acquisition','majority_stake','spv','holdco_route','joint_venture','minority_stake','license_in','co_development')), intent TEXT NOT NULL CHECK (intent IN ('integration','capability_access')), viable INTEGER NOT NULL CHECK (viable IN (0,1)), rationale TEXT NOT NULL CHECK (length(trim(rationale)) > 0), evidence_ref TEXT, evaluated_by TEXT NOT NULL, evaluated_at TEXT NOT NULL, superseded_by TEXT REFERENCES opportunity_deal_shape_evaluation(id));
--   INSERT INTO opportunity_deal_shape_evaluation_old SELECT id, opportunity_id, shape, intent, viable, rationale, evidence_ref, evaluated_by, evaluated_at, superseded_by FROM opportunity_deal_shape_evaluation;
--   DROP TABLE opportunity_deal_shape_evaluation;
--   ALTER TABLE opportunity_deal_shape_evaluation_old RENAME TO opportunity_deal_shape_evaluation;
--   CREATE UNIQUE INDEX idx_odse_live ON opportunity_deal_shape_evaluation(opportunity_id, shape) WHERE superseded_by IS NULL;
--   CREATE INDEX idx_odse_opp ON opportunity_deal_shape_evaluation(opportunity_id, evaluated_at DESC);
--   PRAGMA foreign_keys = ON;
-- ROLLBACK-SQL-END
--
-- ADR-0201 (design 2026-11-17-deal-shape-viability-first): the S7 deal-shape evaluation asks overall viability first. One table,
-- two row kinds. A SHAPE row (shape and intent set) means "this shape is viable" (legacy rows may still hold viable = 0). An
-- OVERALL row (shape NULL, intent NULL, viable 0) means "no shape is viable". There is no overall-viable row: overall viable means
-- one or more live shape rows exist. The live set is one overall row or one or more shape rows, never both; that exclusivity spans
-- rows, so the repository enforces it (and a test pins it), not a trigger.
--
-- idx_odse_live gains "AND shape IS NOT NULL"; a second partial unique index, idx_odse_live_overall, allows one live overall row
-- because SQLite treats NULLs as distinct in a unique index. Rows are copied verbatim: no backfill and no conversion (a legacy set of
-- all not-viable rows is NOT turned into an overall row - nobody recorded that overall judgement). Kill criterion #9 keeps reading
-- COUNT(live) / SUM(viable) unchanged. Review points for data-architect/dba: row-count parity, PRAGMA foreign_key_check after the
-- rename, both partial indexes, the table CHECK accepts every legacy row, Prisma typegen parity (shape/intent nullable).
--
-- @notransaction: PRAGMA foreign_keys = OFF is a no-op inside a transaction (same reason as 0033); a pre-migration backup is the
-- recovery path if the rebuild fails partway.

PRAGMA foreign_keys = OFF;

CREATE TABLE opportunity_deal_shape_evaluation_new (
  id TEXT PRIMARY KEY NOT NULL,
  opportunity_id TEXT NOT NULL REFERENCES opportunity(id),
  shape TEXT CHECK (shape IS NULL OR shape IN ('full_acquisition','majority_stake','spv','holdco_route',
                                               'joint_venture','minority_stake','license_in','co_development')),
  intent TEXT CHECK (intent IS NULL OR intent IN ('integration','capability_access')),
  viable INTEGER NOT NULL CHECK (viable IN (0,1)),
  rationale TEXT NOT NULL CHECK (length(trim(rationale)) > 0),
  evidence_ref TEXT,
  evaluated_by TEXT NOT NULL,
  evaluated_at TEXT NOT NULL,
  superseded_by TEXT REFERENCES opportunity_deal_shape_evaluation(id),
  CHECK ((shape IS NULL AND intent IS NULL AND viable = 0)
      OR (shape IS NOT NULL AND intent IS NOT NULL))
);

INSERT INTO opportunity_deal_shape_evaluation_new
  (id, opportunity_id, shape, intent, viable, rationale, evidence_ref, evaluated_by, evaluated_at, superseded_by)
SELECT id, opportunity_id, shape, intent, viable, rationale, evidence_ref, evaluated_by, evaluated_at, superseded_by
FROM opportunity_deal_shape_evaluation;

DROP TABLE opportunity_deal_shape_evaluation;
ALTER TABLE opportunity_deal_shape_evaluation_new RENAME TO opportunity_deal_shape_evaluation;

CREATE UNIQUE INDEX idx_odse_live ON opportunity_deal_shape_evaluation(opportunity_id, shape)
  WHERE superseded_by IS NULL AND shape IS NOT NULL;
CREATE UNIQUE INDEX idx_odse_live_overall ON opportunity_deal_shape_evaluation(opportunity_id)
  WHERE superseded_by IS NULL AND shape IS NULL;
CREATE INDEX idx_odse_opp ON opportunity_deal_shape_evaluation(opportunity_id, evaluated_at DESC);

PRAGMA foreign_keys = ON;
