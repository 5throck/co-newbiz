-- 0132_dd_target_axis.sql
-- @reversible: false in the general case (the project_checklist_item_state
-- rebuild only swaps an inline UNIQUE constraint for an expression index and
-- copies every row verbatim; rollback is a pre-migration backup restore —
-- scripts/co-newbiz/restore.ts, ADR-0014. The four ADD COLUMNs and the new
-- table are otherwise purely additive.)
--
-- Optional per-target DD on shortlisted brownfield targets (ADR-0157, design
-- 2026-10-09-optional-per-target-dd). DD state was keyed by project only; a
-- nullable target_id adds the target axis WITHOUT touching existing rows:
-- NULL = "the selected target, or the legacy single DD subject" (every
-- existing row is grandfathered, no backfill). A non-NULL value is an
-- explicitly opened comparison target (dd_target_open). The S9 predicate and
-- the dd gate read target_id IS NULL only.
--
-- SQLite cannot drop the inline UNIQUE(project_id, checklist_id, item_id) of
-- project_checklist_item_state, so that table is rebuilt (0033 pattern:
-- create _new, copy, drop, rename, recreate indexes) inside this migration's
-- transaction. Row counts are asserted equal before commit via a CHECK-guarded
-- temp table: a mismatch aborts and rolls the whole migration back.

CREATE TABLE project_checklist_item_state_new (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  checklist_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'pass', 'fail', 'na', 'waived')),
  note TEXT,
  evidence_ref TEXT,
  waiver_id TEXT REFERENCES waiver(id),
  assessed_by TEXT NOT NULL,
  assessed_at TEXT NOT NULL,
  target_id TEXT REFERENCES brownfield_target(id)
);

INSERT INTO project_checklist_item_state_new
  (id, project_id, checklist_id, item_id, status, note, evidence_ref, waiver_id, assessed_by, assessed_at, target_id)
  SELECT id, project_id, checklist_id, item_id, status, note, evidence_ref, waiver_id, assessed_by, assessed_at, NULL
  FROM project_checklist_item_state;

-- Row-count assertion: the INSERT violates the CHECK (and aborts the whole
-- migration transaction) unless old and new counts are equal.
CREATE TEMP TABLE _dd_rebuild_assert (ok INTEGER NOT NULL CHECK (ok = 1));
INSERT INTO _dd_rebuild_assert
  SELECT CASE WHEN (SELECT COUNT(*) FROM project_checklist_item_state) = (SELECT COUNT(*) FROM project_checklist_item_state_new) THEN 1 ELSE 0 END;
DROP TABLE _dd_rebuild_assert;

DROP TABLE project_checklist_item_state;
ALTER TABLE project_checklist_item_state_new RENAME TO project_checklist_item_state;

CREATE INDEX idx_pcis_project ON project_checklist_item_state(project_id, checklist_id);
CREATE INDEX idx_pcis_project_target ON project_checklist_item_state(project_id, target_id, checklist_id);
CREATE UNIQUE INDEX uq_pcis_scope_item
  ON project_checklist_item_state(project_id, COALESCE(target_id, ''), checklist_id, item_id);

ALTER TABLE project_checklist_item_custom ADD COLUMN target_id TEXT REFERENCES brownfield_target(id);
ALTER TABLE dd_finding ADD COLUMN target_id TEXT REFERENCES brownfield_target(id);
ALTER TABLE waiver ADD COLUMN target_id TEXT REFERENCES brownfield_target(id);

CREATE INDEX idx_dd_finding_project_target ON dd_finding(project_id, target_id);

-- Re-selection (A to B) marks an existing 'dd' gate decision stale instead of
-- deleting or editing it: the decision row is never touched (an immutable
-- human record), a marker row here makes the process engine stop counting it
-- (latestGateDecisions skips marked decisions), so the gate must be re-judged
-- on the newly selected target. Written only by the target-selection
-- transaction.
CREATE TABLE gate_decision_stale (
  decision_id TEXT PRIMARY KEY NOT NULL REFERENCES gate_decision(id),
  stale_at TEXT NOT NULL,
  stale_reason TEXT NOT NULL
);

CREATE TABLE dd_target_open (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  target_id TEXT NOT NULL REFERENCES brownfield_target(id),
  opened_by TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  rationale TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'reselection')),
  UNIQUE (project_id, target_id)
);
