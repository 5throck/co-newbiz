-- @version 1.0.0
-- @reversible: false in the general case (the notification rebuild uses the
-- SQLite table-rebuild pattern; a hand-reverse would need to re-add NOT NULL
-- on project_id, which SQLite cannot ALTER — same posture as 0033, whose
-- rollback mechanism is pre-migration backup restore, see
-- scripts/co-newbiz/restore.ts — ADR-0014.)
--
-- ADR-0102 §1 — the industry × company end-to-end auto pipeline. Two parts:
--
-- (a) pipeline_run — the pipeline's OWN state only. The pipeline never writes
--     gate decisions, adoptions, approvals, or route confirmations (boundary
--     #2, ADR-0102 §5); those stay in their existing human-action tables.
--     entity_type mirrors the ProcessEntity discriminated union in
--     app/web-next/lib/process-flow.ts: a run spans the opportunity branch
--     (S1–S7) and, after promotion (ADR-0095), the project branch (S8–S11).
--     Per ADR-0102 §1 the entity_id is re-pointed on promotion by inserting a
--     NEW run segment (append-only lineage, ADR-0005) rather than mutating
--     the opportunity-keyed row.
--     One ACTIVE run per entity (status running/paused_for_human) is enforced
--     in the repository layer (app/web-next/lib/pipeline.ts startPipeline),
--     not by a partial index — the ADR-0098 route-layer-validation pattern.
--
-- (b) notification rebuild — the ONE non-purely-additive element, called out
--     in the ADR for reviewer attention. The existing notification table
--     (0007) carries project_id NOT NULL and a 7-value trigger_type CHECK;
--     an opportunity-scoped pause needs project_id NULL and a
--     'pipeline_paused' trigger. Rebuilt with the 0033 table-rebuild pattern:
--     identical columns in identical order, all rows copied verbatim, the two
--     0007 indexes recreated, only the two sanctioned deltas applied.
--     Consumers (db/lib/watch-engine.ts recordNotification/isInCooldown and
--     the MCP list_notifications relay) are write/SELECT-only on unchanged
--     columns and are unaffected.

-- ── (a) pipeline_run ───────────────────────────────────────────────────────

CREATE TABLE pipeline_run (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('opportunity','project')),
  entity_id TEXT NOT NULL,
  industry_id TEXT NOT NULL REFERENCES md_industry(id),
  initiating_company_id TEXT NOT NULL REFERENCES md_company(id),
  status TEXT NOT NULL CHECK (status IN
    ('running','paused_for_human','completed','failed','killed')),
  current_stage TEXT,
  paused_reason TEXT,
  started_by TEXT NOT NULL,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_pipeline_run_entity ON pipeline_run(entity_type, entity_id);
CREATE INDEX idx_pipeline_run_status ON pipeline_run(status);

-- ── (b) notification rebuild (0033 pattern) ───────────────────────────────

CREATE TABLE notification_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  -- ADR-0102 §1: nullable — an opportunity-scoped pipeline pause has no
  -- project yet; project-scoped pauses keep setting it (watch-engine rows are
  -- unchanged: their project_id is NOT NULL and the column accepts that).
  project_id TEXT REFERENCES md_project(id),
  trigger_type TEXT NOT NULL CHECK (
    trigger_type IN ('rag_upgrade', 'rag_downgrade', 'kill_criteria', 'regulation_change', 'threshold_breach', 'staleness', 'batch_failure', 'pipeline_paused')
  ),
  severity TEXT NOT NULL CHECK (severity IN ('opportunity', 'warning', 'urgent', 'info', 'ops')),
  payload TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('in_app', 'email', 'webhook', 'all')),
  bundle TEXT NOT NULL CHECK (bundle IN ('immediate', 'daily')),
  sent_at TEXT NOT NULL
);
INSERT INTO notification_new SELECT * FROM notification;
DROP TABLE notification;
ALTER TABLE notification_new RENAME TO notification;
-- 0007 indexes recreated verbatim (a DROP TABLE drops its indexes with it).
CREATE INDEX idx_notification_cooldown ON notification(project_id, trigger_type, sent_at DESC);
CREATE INDEX idx_notification_user ON notification(user_id, sent_at DESC);
