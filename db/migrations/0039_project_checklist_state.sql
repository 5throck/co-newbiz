-- 0039_project_checklist_state.sql
-- DD workspace (Commercial/Technical/Legal DD) — per-project checklist item
-- state. The gate checklists (checklists/commercial-dd-checklist.yaml etc.)
-- define the required DD scope per deal; until now the web app could only
-- store free-form dd_finding rows, so there was no record of WHICH checklist
-- items were covered, by whom, and with what evidence. One row per
-- (project, checklist, item); items default to 'pending'. 'waived' rows must
-- reference an existing waiver (waiver table) — enforced at the API layer,
-- not by FK, because a waiver is created per-project against a key, not per
-- checklist item.
CREATE TABLE project_checklist_item_state (
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
  UNIQUE(project_id, checklist_id, item_id)
);
CREATE INDEX idx_pcis_project ON project_checklist_item_state(project_id, checklist_id);
