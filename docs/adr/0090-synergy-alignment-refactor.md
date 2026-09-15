---
lang: ko
lang_reason: source-material
---

# ADR-0090: Synergy alignment refactor — targets from the affiliate registry, opportunities wired in

**Status**: Accepted — implemented in the same change (migration 0060, pipeline, API, UI)
**Date**: 2026-09-02
**Deciders**: user (standing directive), process-governance-manager (S3 gate), frontend-engineer (implementation)
**Design of record**: `db/migrations/0060_synergy_target_refactor.sql`, `app/web-next/lib/synergy-pipeline.ts`, `app/api/synergy/analyses/**`, `app/web-next/app/synergy/page.tsx`
**Related**: ADR-0080 (our-company as S3 support), ADR-0089 (S3 input-prep activities)

## Context

The 시너지 정합성 surface started with a separate company registration that duplicated the
그룹/계열사 registry, ignored the affiliate profiles produced there, and analyzed all
completed markets generically — with no link to a specific opportunity, so flow.spec S3's
completion criterion ("기회에 synergy_score와 근거가 기록되었다") was never satisfied by
the surface. S3's definition is 기회 × 자사 역량; the screen's company-centric structure
diverged from it.

## Decision

1. **Analysis targets come from the affiliate registry, not separate registration**:
   `synergy_analysis` gains `target_type ('affiliate'|'group')`, `member_id`,
   `group_id`, and `opportunity_id` (migration 0060, additive). Legacy rows
   (company_id-based) remain readable and are flagged "legacy" in the UI; they cannot be
   re-run — new analyses use the registry.
2. **Profiles are reused, not re-derived**: for an affiliate target the pipeline loads the
   latest `company_profile_version` (strengths/weaknesses/financials); for a group target
   it rolls up member profiles (strengths union, industry-exposure union, representative
   financials). The pipeline's old Steps 1–3 (its own DART/research of the target) are
   replaced by profile-reuse steps for new-type analyses; legacy rows keep the old path.
3. **Opportunity linkage**: an analysis may name one S2 opportunity; its name/scope/
   rationale are injected into the linkage and shortlist prompts, the payload records
   `synergyScore` (0–100) + `synergyRationale`, and on completion the opportunity row is
   updated with the recommended score and rationale. Per boundary #2 this is a
   recommendation record — the human gate decision remains authoritative.
4. **UI**: the registration modal is replaced by a standard inline form — target chips
   (affiliates + "그룹 전체", enabled only with a profile), an opportunity select, and
   분석 시작. List rows show target, linked opportunity, and legacy flag; actions are
   열기 → 재분석 → 삭제 (edit belongs to the 그룹/계열사 surface).

## Consequences

- Registering the same company in two places ends; affiliate profiles are the single
  source for S3 self-capability inputs.
- S3's completion criterion becomes mechanically satisfiable from the surface: analysis
  with a linked opportunity writes the recommended synergy_score and rationale.
- Legacy analyses remain viewable but frozen; deletion still removes only analysis rows
  (company master untouched). md_company is now exclusively the S4+-era project company
  registry.
