-- @notransaction
-- 0088_route_decision_draft.sql
-- S4 draft/final split (ADR-0124): "저장" persists a mutable draft
-- server-side (visible on reload, shareable across sessions); "결정"
-- finalizes it into the existing immutable decision record. rationale must
-- become nullable (a draft may not have it yet) — SQLite cannot ALTER
-- COLUMN DROP NOT NULL, so this is a table rebuild (same pattern as
-- 0049_brownfield_routes.sql). Existing rows are all already-recorded
-- decisions, so they all become status='final' — no change in meaning
-- (ADR-0014 additive-in-effect).
--
-- @notransaction / PRAGMA foreign_keys=OFF: route_decision_score has a live
-- FK to route_decision(id) with existing child rows. Under foreign_keys=ON
-- (db/client.ts's default), dropping+recreating the referenced table inside
-- this rebuild fails (same class of issue as ADR-0071 / migration 0033 —
-- see db/migrate.ts's header comment for the mechanism).
PRAGMA foreign_keys = OFF;

CREATE TABLE route_decision_new (
  id TEXT PRIMARY KEY NOT NULL,
  opportunity_id TEXT NOT NULL REFERENCES opportunity(id),
  project_id TEXT REFERENCES md_project(id),
  track TEXT NOT NULL CHECK (track IN ('greenfield', 'brownfield')),
  sub_track TEXT CHECK (sub_track IN ('existing_business_rbd', 'intra_venture', 'm_and_a', 'jv', 'strategic_investment', 'minority_investment', 'partnership', 'rbd', 'corporate_venture')),
  rationale TEXT,
  alternatives_considered TEXT,
  decided_by TEXT NOT NULL,
  decided_at TEXT NOT NULL,
  intent TEXT CHECK (intent IN ('integration', 'capability_access')),
  override_flagged INTEGER NOT NULL DEFAULT 0,
  staging_recommended TEXT,
  total_score REAL,
  gate_evaluation_id TEXT REFERENCES gate_evaluation(id),
  status TEXT NOT NULL DEFAULT 'final' CHECK (status IN ('draft', 'final')),
  updated_at TEXT
);
INSERT INTO route_decision_new (id, opportunity_id, project_id, track, sub_track, rationale, alternatives_considered, decided_by, decided_at, intent, override_flagged, staging_recommended, total_score, gate_evaluation_id, status, updated_at)
  SELECT id, opportunity_id, project_id, track, sub_track, rationale, alternatives_considered, decided_by, decided_at, intent, override_flagged, staging_recommended, total_score, gate_evaluation_id, 'final', decided_at
  FROM route_decision;
DROP TABLE route_decision;
ALTER TABLE route_decision_new RENAME TO route_decision;
CREATE INDEX idx_route_decision_opp ON route_decision(opportunity_id);
CREATE INDEX idx_route_decision_proj ON route_decision(project_id);
-- At most one open draft per opportunity — "저장" upserts into it rather
-- than accumulating rows.
CREATE UNIQUE INDEX idx_route_decision_one_draft ON route_decision(opportunity_id) WHERE status = 'draft';

PRAGMA foreign_keys = ON;
PRAGMA foreign_key_check;
-- @reversible: true (additive in effect against existing final rows — ADR-0014; table rebuild only to relax rationale NOT NULL for drafts)
