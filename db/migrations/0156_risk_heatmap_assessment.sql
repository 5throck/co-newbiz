-- 0156_risk_heatmap_assessment.sql (2026-10-19 decider question: "리스크 히트맵이
-- 제대로 구현된 것이 맞는지" — the auto-derived view had HARDCODED likelihood and
-- threshold-based impact; a real heatmap needs the person's assessment recorded).
--
-- Sidecar on md_project keyed by heatmap item source key (dd:<finding_id> /
-- coc:<contract_id> / inc:<incentive_id>): { likelihood: 1..3, impact: 1..3,
-- by, at }. Person-only write (analyst+, audited). The auto-derived values stay
-- as the default when no override exists.
ALTER TABLE md_project ADD COLUMN risk_heatmap_assessment_json TEXT;
