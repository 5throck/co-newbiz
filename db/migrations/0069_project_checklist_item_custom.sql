-- 0069_project_checklist_item_custom.sql
-- @reversible: true (additive-only DDL — one CREATE TABLE, one CREATE INDEX, zero data change; rollback mechanism is pre-migration backup restore, see scripts/co-newbiz/restore.ts — ADR-0014)
--
-- S9 tailored DD checklist items — ADR-0099. Agents propose industry/company-
-- specific ADDITIONAL checklist items (augmenting, never replacing, the
-- standard checklists/*.yaml floor). Whether a proposal becomes a gate-
-- relevant requirement is a HUMAN decision (design boundary #2): approval
-- flips `status` to 'approved' (approved_by/approved_at) and the review path
-- additionally inserts a project_checklist_item_state row with
-- checklist_id = 'custom:<domain>' — from that moment the item is an ordinary
-- checklist item judged through the existing status tracking and its waiver
-- flow. Proposed-but-unapproved and rejected items never get a state row and
-- never count toward S9 completion.
--
-- source_reliability reuses the md_source.reliability_grade A/B/C vocabulary
-- (0001) so boundary #4 (data confidence caps conclusions) applies to
-- checklist coverage the same way it applies to market data. The
-- deterministic default executor writes source_url = NULL and
-- source_reliability = 'C' — visibly unsourced, visibly lowest-confidence;
-- it must NEVER fabricate plausible-looking URLs or grades (ADR-0099 §6
-- binding honesty constraint).
--
-- NO FK on item_id → project_checklist_item_state: the state row is created
-- by the review path, not this table; no cross-table identity beyond
-- (project_id, item id) is needed and a state DELETE must not cascade here.

CREATE TABLE project_checklist_item_custom (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  domain TEXT NOT NULL CHECK (domain IN ('commercial', 'technical', 'legal')),
  item_label TEXT NOT NULL,
  rationale TEXT,
  source_url TEXT,
  source_reliability TEXT CHECK (source_reliability IS NULL OR source_reliability IN ('A', 'B', 'C')),
  proposed_by_agent TEXT,
  status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'approved', 'rejected')),
  approved_by TEXT,
  approved_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_pcic_project ON project_checklist_item_custom(project_id, domain, status);
