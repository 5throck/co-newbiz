# S8 Multi-Target Feasibility (Brownfield per-Shortlist Analysis)

- Spec ID: `2026-09-22-s8-multi-target-feasibility`
- Date: 2026-09-22
- Status: **Implemented**
- Related: ADR-0094/0095 (opportunity→project carrier, 1:1 promotion), ADR-0098 (multi-**scenario** business-case generation — partially amended), ADR-0117 (dual-perspective variants), ADR-0053 (human decision authority), ADR-0076 (track separation), ADR-0104 (company linkage), ADR-0120 (deal-centric IA)

## Problem

The brownfield track narrows a Target Universe to a ranked Short List at S6–S7
(`brownfield_target`, 1:N with the opportunity). S8 must quantify a valuation
**per shortlisted target** and compare them — but every layer assumed one
feasibility analysis per project:

| Layer | Evidence |
|---|---|
| Spec | `flow.spec.yaml` S8 requiredArtifacts carried no target dimension; no iteration concept existed |
| Data | `business_case_model` / `valuation_simulation` keyed by `project_id` only; multiplicity was scenario × variant |
| Promotion | `promoteOpportunity` bound only the rank-1 shortlisted target to `md_project.company_id`; survivors lost their S8+ carrier |
| App | S8 completion probed one latest model; adoption was one per project; the S8 UI matrix was scenario × variant |

Decisions taken with the user (2026-09-22):
- **Carrier**: keep one project per opportunity; add a **target axis** inside S8. A per-target project split was rejected (it breaks ADR-0095, fragments the deal identity, and multiplies gate records for one initiative).
- **S9 scope**: DD runs on the **selected target only**. Doing full DD on every survivor is not realistic; S8's quantitative comparison is the selection instrument.

## Requirements

- REQ-T1: Brownfield S8 produces one feasibility case set per shortlisted target (3 scenarios × N targets, gate-primary `market_forward` variant), not one per project. Greenfield stays unchanged.
- REQ-T2: The target dimension is a nullable `target_id` on `business_case_model` referencing `brownfield_target(id)`. Greenfield rows keep NULL. `valuation_simulation` gains no column — simulations hang off the model.
- REQ-T3: Every persisted brownfield case names its target in the model row and reproduces from a seed that is a pure function of `(projectId, targetId, scenario)` (ADR-0052 §D.4 determinism).
- REQ-T4: The S8 completion predicate becomes track-aware: brownfield completes only when **every** shortlisted target has ≥1 model with persisted percentiles plus the BEP/snapshot artifacts; greenfield keeps the ADR-0098 predicate.
- REQ-T5: A cross-target comparison ranks the shortlist (market_forward p05 NPV per target) and flags a RECOMMENDED target. The flag is a proposal only (boundary #2).
- REQ-T6: Target selection is a human decision recorded as a `process_run` row (`stage='s8_target_select'`) with target id + rationale; it finalizes `md_project.company_id` (the rank-1 binding at promotion is provisional until then).
- REQ-T7: Brownfield case adoption is constrained to the selected target's cases.
- REQ-T8: The spec (v2.5.0) declares the repetition machine-readably: stage key `subjectScope` (`{greenfield: single, brownfield: shortlist}` on S8), per-target completion criteria, the `target-comparison` + `target-selection` activities, and the new required artifacts (target comparison, selection record). S9 scope narrows from shortlist-wide DD to selected-target DD.
- REQ-T9: The historical variant (ADR-0117) is generated per target when that target's company facts exist; it stays comparison-only and never a gate candidate. It is excluded from the cross-target ranking.

## Design

**Data (migration 0120, additive)**: `ALTER TABLE business_case_model ADD COLUMN target_id TEXT REFERENCES brownfield_target(id)` + index `(project_id, target_id)`. App-level validation: a case's target must belong to the project's `source_opportunity_id` and have `status='shortlisted'`. The existing `process_run.stage` column is free-form text, so `s8_target_select` needs no DDL.

**Generator** (`lib/business-case-generator.ts`): `generateBusinessCases` branches on track. Greenfield path unchanged (models with `target_id = NULL`). Brownfield path loops over the source opportunity's shortlisted targets; each target resolves its company (dart_corp_code → name, same resolution order as `listTargets`) for the historical variant and runs the same 4-step chain per scenario. Seed keys gain the target dimension only for brownfield (`projectId:targetId:scenario`); greenfield seeds are byte-identical to today, so existing greenfield cases stay reproducible.

**Completion** (`lib/process-flow.ts`): the S8 predicate reads the project's track. Brownfield: for each shortlisted target of the source opportunity, require ≥1 model (any variant, with `inputs_json`) whose percentiles include p50 with `bep_year`. Missing targets are named in blockers. Greenfield: unchanged.

**Selection & comparison** (`lib/business-case.ts` + API): `selectTarget(projectId, targetId, rationale, actor)` writes the `s8_target_select` run row, finalizes `md_project.company_id` (idempotent re-selection allowed, latest wins — audit-logged), and is the only writer. `listBusinessCases` returns per-case `target_id`/`target_name` plus a `targets` summary (per-target best market_forward p05, recommended flag, case counts). The adopt endpoint rejects brownfield models whose target is not the selected one.

**UI** (`BusinessCaseStage.tsx`): brownfield projects get a target-comparison table — one row per shortlisted target with base p05/p50 NPV, IRR, recommended chip, selected chip, and the human target-selection action (rationale mandatory) — plus a per-target filter on the scenario matrix. Greenfield renders exactly as before.

**Spec/procedures/skills**: S8 `subjectScope` map + activities `target-comparison` (financial-analyst, procedure `brownfield-fs-comparative`) and `target-selection` (`decision_authority: human`); new output types `target_comparison`, `target_selection_record`; skills updated so the per-target loop and the selection step are dispatch-visible. `brownfield-fs` stays the per-target instance procedure — repetition happens at the dispatch layer (one procedure invocation per target), no loop construct is added to the procedure schema.

**Company binding lifecycle**: promotion keeps binding rank-1 as the provisional default (existing API compatibility — `md_project.company_id` stays NOT-NULL-by-convention); the `fs`-gate-adjacent target selection finalizes it.

## Verification

- [x] `bun test tests/unit/business-case.test.ts` — greenfield ADR-0098 regression unchanged (3 models, seeds byte-identical semantics, boundary #2)
- [x] New brownfield tests: promote with 2 shortlisted targets → generate → 3 gate-primary models per target; S8 blocked until every target analyzed; selection endpoint (viewer 403, non-member 404, idempotent re-select); adoption constrained to the selected target
- [x] `bun test tests/unit/process-flow.test.ts` — STAGES parity with spec v2.5.0
- [x] `bun scripts/co-newbiz/generate-process-flow.ts` — docs regenerated
- [x] `bun scripts/spec-register.ts --file docs/designs/2026-09-22-s8-multi-target-feasibility-design.md --source manual --status implemented`
