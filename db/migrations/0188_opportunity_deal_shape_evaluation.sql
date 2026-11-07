-- @reversible: true (purely additive: one new table and two indexes; no backfill; no existing table altered. Rollback: the
-- ROLLBACK-SQL block below (DROP TABLE) after the pre-migration backup per ADR-0014. Rows recorded after this migration are
-- lost with the table on rollback.)
-- ROLLBACK-SQL-BEGIN
--   DROP TABLE opportunity_deal_shape_evaluation;
-- ROLLBACK-SQL-END
--
-- ADR-0194 item A (owner decision 2026-11-07, O-A1): the opportunity-scope S4 deal-shape screen becomes a human-recorded
-- fact, so kill criterion #9 (deal-shape-chain:no_viable_deal_shape, evaluated at the opportunity pre_fs gate) reads a
-- direct count instead of a proxy (ADR-0193 section 14.2). deal_shape_evaluation (0026/0033) is project-scoped
-- (project_id NOT NULL) and is left untouched; this table is its opportunity-scoped counterpart. shape and intent keep the
-- byte-identical CHECK vocabularies of deal_shape_evaluation (promotion to an md_deal_shape code table is recorded debt,
-- ADR-0194 O-A3).
--
-- Append-only with a superseded_by chain (ADR-0005 / FR-DATA-10): one LIVE verdict per (opportunity, shape) is enforced by the
-- partial unique index idx_odse_live; a re-evaluation inserts a new row and sets superseded_by on the old one in one
-- transaction, so history stays attributable. evaluated_by is the md_user id of the calling human taken from the session
-- (never from the request body, never an agent account - Boundary 1); the repository and the route enforce that. rationale is
-- required (the RECYCLE semantics of the registry entry: written feedback on every verdict).
--
-- No backfill: existing project-scoped deal_shape_evaluation rows are not opportunity evidence and copying them would invent
-- opportunity-scope records (ADR-0194). In-flight opportunities read unassessed at pre_fs until a human records a verdict.

CREATE TABLE opportunity_deal_shape_evaluation (
  id TEXT PRIMARY KEY NOT NULL,
  opportunity_id TEXT NOT NULL REFERENCES opportunity(id),
  shape TEXT NOT NULL CHECK (shape IN ('full_acquisition','majority_stake','spv','holdco_route',
                                       'joint_venture','minority_stake','license_in','co_development')),
  intent TEXT NOT NULL CHECK (intent IN ('integration','capability_access')),
  viable INTEGER NOT NULL CHECK (viable IN (0,1)),
  rationale TEXT NOT NULL CHECK (length(trim(rationale)) > 0),
  evidence_ref TEXT,
  evaluated_by TEXT NOT NULL,
  evaluated_at TEXT NOT NULL,
  superseded_by TEXT REFERENCES opportunity_deal_shape_evaluation(id)
);
CREATE UNIQUE INDEX idx_odse_live ON opportunity_deal_shape_evaluation(opportunity_id, shape)
  WHERE superseded_by IS NULL;
CREATE INDEX idx_odse_opp ON opportunity_deal_shape_evaluation(opportunity_id, evaluated_at DESC);
