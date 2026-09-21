---
lang: ko
lang_reason: source-material
---

# ADR-0143: S8 brownfield feasibility — per-target analysis on one project carrier (target axis)

- Status: Accepted
- Date: 2026-09-22
- Deciders: New Business Review Lead (PM), with the workspace owner
- Design of record: `docs/designs/2026-09-22-s8-multi-target-feasibility-design.md`, `process/flow.spec.yaml` (v2.5.0), `db/migrations/0120_business_case_target.sql`, `app/web-next/lib/business-case-generator.ts`, `app/web-next/lib/business-case.ts`, `app/web-next/lib/process-flow.ts` (S8 predicate), `procedures/_shared/brownfield-fs-comparative/schema.yaml`
- Related: ADR-0095 (project promotion, 1:1 — preserved), ADR-0098 (multi-scenario generation — steady-state amended), ADR-0117 (dual-perspective variants — per target), ADR-0053 (human decision authority), ADR-0076 (S8 = "valuation (BF Short List targets)" — the plural intent this ADR implements), ADR-0120 (deal-centric IA — preserved)

## Context

The brownfield S6→S7 funnel produces a ranked Short List (`brownfield_target`,
1:N with the opportunity). Classic M&A practice — and this pipeline's own
prose — requires a feasibility/valuation analysis **per shortlisted target**,
followed by a comparative selection before DD. ADR-0076 already said S8 for
brownfield quantifies "valuation (BF Short List targets)", and the S7/S8/S9
objective lines speak of "Short List 대상". The implementation never followed:
`business_case_model`/`valuation_simulation` are keyed by `project_id` only
(scenario × variant multiplicity), the S8 completion predicate probes one
latest model, adoption is one per project, and promotion binds only the
rank-1 shortlisted target to `md_project.company_id`
(`ORDER BY rank LIMIT 1`) — survivors 2..N lose any S8+ carrier. The spec had
no iteration concept and the procedure schema has no loop construct.

## Decision

1. **One project per opportunity is preserved (ADR-0095 unchanged); S8 gains
   a target axis.** A rejected alternative was promoting each shortlisted
   target to its own project at S7→S8: it breaks the 1:1 promotion invariant,
   splits one initiative into N deals (N charters, N gate ledgers, N Group-IC
   review items), and turns target selection into a project-kill exercise.
   The deal is the initiative; the shortlist is a dimension of its S8 work.

2. **`business_case_model.target_id` (nullable FK to `brownfield_target`,
   migration 0120).** Greenfield rows stay NULL; greenfield generation, seeds,
   and completion are byte-identical to today. Brownfield generation runs the
   ADR-0098 chain once per shortlisted target (3 scenarios × market_forward,
   plus the historical variant when that target's company facts exist).
   Brownfield seeds become `(projectId, targetId, scenario)`; a case's target
   must belong to the project's source opportunity and be shortlisted.

3. **S8 completion is track-aware.** Brownfield completes only when every
   shortlisted target has ≥1 analyzed case (percentiles + BEP + input
   snapshot); blockers name the missing targets. This supersedes the
   ADR-0098 §5 predicate for the brownfield track; the greenfield predicate
   is unchanged. ADR-0098's "three business cases per project" steady state
   becomes "three scenarios per subject, one subject per target plus the
   project-level subject for greenfield".

4. **Target selection is a human decision at S8, recorded — not a new gate.**
   The engine produces a cross-target comparison and a RECOMMENDED target
   flag (market_forward p05 NPV rule, historical variant excluded). A human
   selection writes a `process_run` row (`stage='s8_target_select'`, meta
   carries target id + rationale) — the only writer — and finalizes
   `md_project.company_id` (the rank-1 binding at promotion is provisional
   until then). This reuses the ADR-0053 human-decision mechanism and keeps
   the seven-gate structure intact; the `fs` gate still consumes one adopted
   case, which for brownfield must belong to the selected target.

5. **S9 narrows to the selected target.** "Short List 대상 DD" becomes
   "선정 대상 DD" (spec v2.5.0) — DD cost scales with one target, and S8's
   quantitative comparison is the selection instrument. Running parallel DDs
   on the top-N shortlist with the final call moved to Entity IC was
   considered and rejected for this iteration (2× DD cost, later selection
   point); it remains a recorded alternative if the group wants a hedged
   selection.

6. **Spec expressiveness, not a procedure-schema loop.** The stage schema
   gains `subjectScope` (S8: `{greenfield: single, brownfield: shortlist}`);
   S8 declares the `target-comparison` (financial-analyst,
   `brownfield-fs-comparative` procedure) and `target-selection`
   (`decision_authority: human`) activities and the per-target completion
   criteria. `brownfield-fs` remains the per-target instance procedure;
   repetition lives at the dispatch/automation layer (one invocation per
   target), so the procedure schema stays loop-free.

## Consequences

- The brownfield S8 workbench becomes N-analyses-in-one-stage: the UI gains a
  target comparison table and a per-target scenario matrix; the IC package,
  DD, and S10+ keep consuming exactly one adopted case, so downstream stages
  change only through the finalized company binding.
- Consumers that assumed "a project's cases share one subject" must key by
  `(target_id, scenario, variant)`; `recommendedFromDb` becomes per-subject
  and the cross-target recommendation is a new pure rule over the same rows.
- Generation cost scales with shortlist size (≈4 activities × 3 scenarios ×
  N targets), bounded by the S7 shortlist and the existing synchronous chain.
- The provisional rank-1 `company_id` binding at promotion needs no migration
  but gains a documented lifecycle: provisional → finalized at selection.
