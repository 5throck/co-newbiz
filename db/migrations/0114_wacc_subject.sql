-- 0114_wacc_subject.sql
-- @version 1.0.0
-- @reversible: true — purely additive nullable columns on md_project; dropping
--   them loses only the recorded subject decision (re-derivable from the
--   track default; design 2026-09-18-s8-business-case-evaluation REQ-W4-1).
--
-- WACC application subject (design REQ-W4-1/2) — WHOSE cost of capital
-- discounts the valuation: 'promoter' (the investing entity, greenfield
-- self-execution default), 'target' (the target company's cash-flow risk,
-- brownfield acquisition / equity-participation default), 'project_newco'
-- (a ring-fenced new entity with its own leverage). NULL = the track-based
-- default applies (route_decision of the source opportunity), so existing
-- projects keep evaluating without a backfill. The discount rate follows the
-- RISK OF THE CASH FLOWS, not the legal form — the subject is recorded with
-- its rationale so the fs gate reviews the choice, not a silent constant.
-- Stored on md_project (not the numeric assumption table) because the value
-- is an enum string; the design's REQ-W4-1 semantics (user-confirmed +
-- mandatory rationale) are unchanged.
ALTER TABLE md_project ADD COLUMN wacc_subject TEXT CHECK (wacc_subject IN ('promoter','target','project_newco'));
ALTER TABLE md_project ADD COLUMN wacc_subject_rationale TEXT;
ALTER TABLE md_project ADD COLUMN wacc_subject_decided_by TEXT;
ALTER TABLE md_project ADD COLUMN wacc_subject_decided_at TEXT;
