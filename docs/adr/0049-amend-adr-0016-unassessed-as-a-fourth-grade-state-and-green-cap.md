# ADR-0049: Amend ADR-0016 — UNASSESSED as a fourth grade state, and a Green cap on uncalibrated rules

**Status**: Proposed
**Date**: 2026-08-22
**Deciders**: compliance-officer, process-governance-manager, risk-officer, quant-methodologist, platform-lead

> **Supersedes [ADR-0016](0016-rag-scoring-rule-based-not-weighted-average-with-a-data-conf.md).** Proposed, not Accepted — takes effect when PR-4 (grade-state handling, `rankGroupAgenda` and UI null handling) and PR-9 (rule activation under the Green cap) land. Until then ADR-0016's strict trichotomy stands.

## Context

ADR-0016 fixed the overall RAG grade as rule-based rather than a weighted average: Red if any dimension is Red, Green only if every dimension including data confidence is Green, otherwise Amber. Its design counterpart D-M3-3 assumes a strict trichotomy — every dimension is exactly one of green / amber / red.

Formalizing `market`, `technical_execution`, and `risk` breaks that assumption in two distinct ways.

**First, missing evidence is not a grade.** Under the Kleene three-valued evaluation adopted in ADR-0046, a dimension whose deciding evidence is absent evaluates to UNASSESSED. There is no honest way to project that onto green/amber/red. Calling it Red misreports absence of evidence as evidence of a problem and will be overridden by reviewers until the signal is ignored; calling it Amber or Green asserts a finding that was never made.

**Second, an uncalibrated rule is not yet a measurement.** The market, technical-execution, and risk thresholds will be drafted in an agent meeting and approved by the user, but approval is not calibration — none of them will have been run against historical cases at the point they are first enabled.

### The `overall = null` regression

Emitting UNASSESSED naively is a **safety regression**, not merely an inconvenience, and this was verified against the current code rather than inferred:

- `rankGroupAgenda` treats a null overall as non-Red via a `? 1 : 0` coercion, so an unassessed project **ranks above an Amber project** — the exact inversion of what an honest gap should produce.
- The UI, finding no current grade, continues to display the last grade written. The user sees not an honest blank but a **stale confident grade**, with no indication that it is stale.

Both fixes are therefore in scope of the same PR that introduces the state. Shipping UNASSESSED without them would be worse than the trichotomy it replaces.

### The Green cap — the sharpest disagreement of round one

Two positions were argued directly against each other.

The process-governance-manager position: D-M3-1 through D-M3-4 were used in production uncalibrated, so a documented-uncalibrated status is the established precedent and a hard cap is unprecedented friction.

The compliance-officer position: that precedent's real control was never the documentation — it was that a human inspected **every grade by hand** at the volume those rules ran at. Automated rule evaluation across the portfolio removes that control, and citing the precedent while dropping the thing that made it safe carries over the risk without the mitigation.

**Resolved by user decision adopting the compliance-officer position.** The decisive reasoning is that ADR-0016's own overall rule already requires *all six* dimensions Green for an overall Green. Capping three of the six at Amber therefore costs **almost nothing**: any project that would have reached overall Green must have had all six Green, and it still reaches Amber — while every useful Red signal from the new rules survives the cap untouched. A cap that is nearly free and removes a real failure mode is worth taking.

## Decision

### 1. UNASSESSED is a fourth dimension-level state

D-M3-3's strict trichotomy is amended: a dimension is green, amber, red, **or unassessed**. Unassessed means the rules for that dimension could not be decided on the available evidence under ADR-0046's Kleene semantics — it is not a grade and does not order against the other three.

### 2. `overall = null` semantics

If any dimension is unassessed and no dimension is Red, the overall grade is **null** and **no grade row is written**. Red still dominates: a Red dimension yields overall Red even with other dimensions unassessed, since evidence sufficient for Red is sufficient for the conclusion. The rest of ADR-0016 is carried forward: Red if any dimension is Red, Green only if all six are Green, otherwise Amber — with the data-confidence cap intact and unmodified.

"No row written" is the point. A null overall is the absence of an assertion, not an assertion of neutrality.

### 3. Required null-handling fixes, in the same release

- `rankGroupAgenda` must order a null overall **below confirmed Green and confirmed Amber, and above Red**. Null must never confer a ranking advantage over an assessed grade.
- The UI must render a null overall as an explicit unassessed state. It must **not** fall back to the last written grade. Where the previous grade is shown at all, it must be labelled as historical with its own timestamp.

Both are acceptance criteria of the PR that introduces the state, not follow-ups.

### 4. Green cap on uncalibrated market / technical-execution / risk rules

Rules for `market`, `technical_execution`, and `risk` may emit **only Amber or Red until calibrated**, even once `enabled = 1` with an approved `policy_id` and `thresholds_source`. A rule that would evaluate to Green yields Amber, and the cap is recorded on the grade so the reason is visible rather than inferred.

Calibration means reproducing a rule's grades against 5–10 historical cases with the discrepancies examined — the acceptance condition previously stated as FR-RAG-07. The cap lifts per dimension as that dimension is calibrated, not all at once and not by an unrecorded judgement call.

This is the fifth and final stage of the anti-tampering staging, after: `enabled = 0` as a DB default; the SQL `CHECK` requiring `policy_id` and `thresholds_source` when enabled; the open threshold decision documents; and the `reviewed_by` cross-domain requirement before an asserted input reaches scoring.

## Consequences

- **ADR-0016 is superseded by this ADR.** Its substance — rule-based, not weighted-average, with a data-confidence cap — is preserved in full; what changes is the addition of a fourth state and a temporary ceiling on three dimensions. ADR-0016 remains in the record as the prior state.
- Depends on ADR-0046 for the evaluation semantics that produce UNASSESSED. The truth tables there and the state here are one decision split across two documents; neither is implementable alone.
- Cost of the cap is near zero by ADR-0016's own overall rule, as argued above. The residual cost is real but narrow: a project whose only path to overall Green runs through one of the three capped dimensions waits for calibration. That is the intended behaviour.
- Reviewers will see more Amber and more explicit blanks in the first cycles after activation. This is the honest reading of the evidence base, not a degradation, and should not be treated as a reason to lift the cap early.
- Test obligations: every operator's truth table under ADR-0046; a null overall ranks below confirmed Amber and above Red in `rankGroupAgenda`; the UI shows no stale grade for an unassessed project; and an `enabled = 1` uncalibrated rule that would evaluate Green emits Amber instead.
- The market dimension is the weakest starting point — `docs/rag-framework.md` contains no prose criteria for it at all. If the Kleene semantics and the low-confidence exclusion (`r2 < 0.6` on `value_chain_link`-derived variables) are not correct before the first market rules are written, the first rules will reproduce the defect. This sequencing dependency is why the cap matters most for `market`.
