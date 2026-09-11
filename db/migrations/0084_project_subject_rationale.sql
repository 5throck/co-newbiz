-- 0084: md_project.subject_company_rationale — the connect flow records WHY
-- a company is bound to a project (ADR-0116 Phase 1; the approved bridge-tab
-- mockup shows "연결 근거 (필수)"). The binding itself is md_project.company_id
-- (existing column); project_company (0048) is NOT an option here — migration
-- 0073 deliberately dropped it as a dead surface superseded by
-- brownfield_target. Additive column only.
-- @reversible: true (additive-only)
ALTER TABLE md_project ADD COLUMN subject_company_rationale TEXT;
