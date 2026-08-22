# ADR-0055: brownfield-dd kill-criteria additions per risk-thresholds AI-1

**Status**: Accepted
**Date**: 2026-08-23
**Deciders**: process-governance-manager (chair), risk-officer (AI-1 sponsor), PM

## Context

`docs/decisions/risk-thresholds.md` action item AI-1 originates from a recorded risk-officer dissent (D-M-RISK-2): covenant breach under downside with change-of-control acceleration is declared a Kill Criteria candidate by both `agents/risk-officer.md` and `agents/valuation-agent.md`, yet no procedure YAML declared it — and the greenfield-only `partner_dependency_unconfirmed_and_no_alternative` criterion had no brownfield counterpart. The chair ruling was explicit: **adding a kill criterion is a procedure change with policy-impact analysis, not a thresholds decision** — which is why it did not land in migrations 0019/0022 and lands here instead.

Constraint from AI-1 verbatim: *predicates only over the vars seeded in 0018* (`risk.covenants_breached`, `risk.partner_candidates_active`, `risk.partner_dependency_risk`).

## Decision

`procedures/_shared/brownfield-dd/schema.yaml` bumps to **1.6.0** with two new `kill_criteria` declarations, each with a registry entry in `procedures/_kill-criteria/`:

1. **`covenant_breach_with_coc_acceleration_under_downside` — `halt`.**
   Predicate: `count(risk.covenants_breached) >= 1` — the same evidence as the graded Red rule `risk-dd-covenant-breach` (migration 0019). **Deliberately over-inclusive in the halt direction**: the CoC-acceleration subset is indistinguishable in current evidence (covenant definitions live in `debt_instrument.covenant_json`, free TEXT, no type column — D-M-RISK-2 defers type semantics for cause). A halt routes the case to the human gate where the CoC question is asked directly; the graded Red plus the overall rule already guarantees the case cannot read Green. Narrowing the predicate to a CoC-only form requires covenant-type schema and is placed on the first-recalibration agenda (risk-thresholds AI-3).
2. **`partner_dependency_unconfirmed_and_no_alternative` — `mark_conditional`.**
   Predicate: the D-M-RISK-3 conjunction verbatim (`partner_candidates_active <= 1` AND `partner_dependency_risk IN ["high"]`) — the same evidence as the graded Amber rule `risk-dd-partner-sourcing`. This is D-M-RISK-3's "both, non-competing" boundary applied: the graded signal fires at pre_fs, the kill path marks the case conditional at the DD exit; neither weakens nor substitutes for the other. The action mirrors the greenfield-screening original.

**Staging**: both registry entries carry non-null predicates (raising the executable baseline 0 → 2, bumped in the same change per registry check (e)) but stay **`enabled: false`** with null governance anchors. Rationale: `kill_criteria` YAML is today parsed only by `procedures/_validate.ts` (registry cross-check) — no runtime evaluator consumes the predicates. Flipping to `enabled: true` claims liveness that does not exist and is anyway blocked by the anti-tamper gate (registry check (c): `enabled: true` requires `policy_id` AND `thresholds_source`). The flip is reserved to the future kill-criteria-evaluator PR, mirroring how rag_rule staged `enabled=0` until migration 0022.

## Policy-Impact Analysis

No policy-impact script exists in `scripts/co-newbiz/` (verified 2026-08-23); this section is the analysis of record, per the co-newbiz lifecycle rule for `procedures/**`.

- **`project_policy_pin` check**: migration 0015 pinned every in-flight project to the then-in-force procedure versions. Pins pin versions — in-flight projects pinned to brownfield-dd ≤ 1.5.0 keep it, and the new criteria attach to **1.6.0 only**: prospective effect, no re-pin, no retroactive halt. The brownfield pilots (002, 010) are past DD exit, so even a hypothetical retroactive reading has no live case to bite.
- **No runner behavior changes**: nothing outside `_validate.ts` reads these declarations in this change; no scoring, routing, or gate code path is touched.
- **Validator completeness interaction**: none — kill criteria are gate conditions, not the six-validator set; `not_applicable` rows (ADR-0048) are unaffected.
- **Graded-rule duplication**: intended, and ratified in the source record (D-M-RISK-3 boundary statement). The kill actions (`halt`, `mark_conditional`) are strictly stronger than the graded Red/Amber the same evidence already produces.

## Consequences

- brownfield-dd declares 4 kill criteria (3 halts + 1 mark_conditional); registry executable baseline is 2 of 23 declared.
- A kill-criteria evaluator PR (future) is the only path to `enabled: true`, and it must land anchors (`policy_id` pointing at the risk record, `thresholds_source` naming the mapping table) alongside the executor.
- The covenant criterion's over-inclusion is a recorded leniency-direction choice: tightening requires evidence that non-CoC downside breaches are non-kill-grade, plus covenant-type schema (AI-3 agenda).
