-- 0038_review_audit_sample.sql
-- Design of record: docs/designs/2026-08-19-co-newbiz-design_ko.md §6.6 —
-- the "AI 검토 신뢰도" governance KPI is the agreed-ratio of sampled
-- ai_2nd review_stage rows against the human_final outcome for the same
-- run. This table did not exist in any prior migration (confirmed by
-- direct inspection, 2026-08-28 design-vs-actual audit, design doc §20.4):
-- the KPI had no measurement mechanism at all. agreed is NOT NULL by the
-- same "no silent PASS" discipline as review_stage.unverified_items_json —
-- a sample is always recorded as agree or disagree, never left ambiguous.
CREATE TABLE review_audit_sample (
  id TEXT PRIMARY KEY NOT NULL,
  review_stage_id TEXT NOT NULL REFERENCES review_stage(id),
  sampled_by TEXT NOT NULL,
  agreed INTEGER NOT NULL CHECK (agreed IN (0, 1)),
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_review_audit_sample_stage ON review_audit_sample(review_stage_id);
