---
lang: ko
lang_reason: source-material
---

# ADR-0089: Codify the S3 input-prep activities (company profile + synergy screen) — without stage promotion

**Status**: Accepted — flow.spec S3 activity, procedure, output-type registry, and skill wiring in the same change
**Date**: 2026-09-02
**Deciders**: user (standing directive), process-governance-manager (spec gate), financial-analyst (procedure owner)
**Design of record**: `process/flow.spec.yaml` (S3 activities), `procedures/_shared/company-profile-analysis/schema.yaml`, `procedures/_output-types.yaml`
**Runtime implementation**: `app/web-next/lib/company-profile-pipeline.ts` (our-company surface, ADR-0080)

## Context

The 그룹/계열사 분석 surface (our-company) and the 시너지 정합성 surface produce the S3
inputs — 자사 역량·포트폴리오 정보 and target-company validation — but only appeared in
flow.spec as S3 *inputs* prose. The activities that produce them were absent from the
activity→procedure mapping, so the graph projection and gate progress views had nothing to
show for two working, heavily used surfaces ("반영이 안 된 것 같다"). Stage promotion was
considered and rejected: stages are decision points with gates and kill criteria, while
both surfaces are recurring data-preparation activities with no approval/kill semantics,
multiple downstream consumers (S3, S5, S7), and re-runnable-at-will semantics — promoting
them would bend the linear S1→S11 chain for no governance gain.

## Decision

1. **S3 gains an activity `our-company-profile`** (agent: financial-analyst, skills:
   historical-financial-analysis + company-intelligence, procedure:
   company-profile-analysis). The existing `synergy-analysis` activity already pairs the
   synergy surface; the two now read as the S3 input-prep pair.
2. **New procedure `shared-company-profile-analysis`** documents the running pipeline's
   four steps — DART financials via the k-dart v2.1.0 fallback chain (cross-validated
   corp_code only, persisted), external research pack with provenance, LLM assessment with
   source citations and honest degraded-fallback behavior, append-only version
   accumulation — as registered output types (`company_profile_financials`,
   `company_profile_research_pack`, `company_profile_assessment`, `company_profile_version`).
3. **Not a stage; positions stay soft**: the procedure carries no kill criteria and no
   approval semantics; versions are reusable master data, and any stage (S3 today, S5/S7
   as those surfaces mature) may consume the latest profile version.
4. **Registry debts cleared in the same change**: the previously committed brownfield S6/S7
   and greenfield-S5 procedures had unregistered output types and undeclared kill-criteria
   registry entries; all are registered now (84/84 output types used/registered;
   procedures/_validate.ts passes).

## Consequences

- The activity→procedure→skill contract (skill-graph bidirectional test) now covers the
  our-company surface; docs/graph and gate-progress views reflect it.
- flow.spec remains an 11-stage linear chain — no new gates, no stateTransitions changes;
  `docs/process-flow.md` regenerated.
- If a future requirement adds approval semantics to company profiling (e.g., a mandatory
  profile freshness gate before S4), that is a new decision — this ADR's default is
  activity, not stage.
