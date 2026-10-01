# ADR-0150 — S12 lifecycle completion criteria mapped to portfolio transitions

- Status: Proposed
- Date: 2026-10-01
- Deciders: Human reviewer (pending). Drafted by process-governance-manager (Row 2). AI review alone cannot accept this ADR.
- Design of record: `docs/designs/2026-10-01-s1-s12-process-alignment-design.md` (finding F5)
- Related: ADR-0008 (Stage Gate and Kill Criteria model)

> **Needs human approval. This PR changes nothing in `procedures/**`, `policies/**`, or the S12 entry of `process/flow.spec.yaml`.** A person must approve the criteria and the migration choice first.

## Context

S12 (post-investment management) has one activity, no gate, one artifact (the venture scorecard) and one completion criterion. The web app already exposes five portfolio transition decisions (`PORTFOLIO_TRANSITIONS` in `app/web-next/lib/process-flow.ts`): `next_tranche_released`, `held_evidence_incomplete`, `graduate_to_core`, `reduce_or_divest`, `kill_with_learning_captured`. The spec does not say what a complete S12 review cycle must record.

## Decision (proposed)

Adopt six completion criteria, mapped to the existing transitions:

| # | Criterion | Transition(s) |
|---|---|---|
| 1 | A periodic scorecard review exists for each review period. | all |
| 2 | Each review records one human transition decision with rationale. | all |
| 3 | A continue decision records the next tranche condition. | `next_tranche_released`, `held_evidence_incomplete` |
| 4 | An expansion decision records the hand-off to core business. | `graduate_to_core` |
| 5 | An exit decision records the divestment or wind-down plan. | `reduce_or_divest` |
| 6 | A kill decision records the captured learning and feeds it back to S1/S2 base rates. | `kill_with_learning_captured` |

The transition decision stays a human decision. Agents may draft the scorecard summary and a proposed transition with rationale.

## Policy-impact analysis plan

1. List every `policies/**` and `procedures/**` file that references S12, post-close or portfolio monitoring.
2. Run policy impact analysis on each file.
3. Query `project_policy_pin` for every in-flight project and record which projects pin the current version.
4. **Open human decision:** pinned projects either keep the old criteria until their next review period, or migrate to the new criteria. This ADR does not choose.
5. Only after acceptance: amend the procedures and the S12 entry in `process/flow.spec.yaml` in a separate ADR-backed PR.

## Consequences

- If accepted, S12 gains explicit completion criteria and may gain a review gate; procedure, flow-spec and web changes follow in their own PR.
- Criterion 6 creates a feedback path into S1/S2 base rates; its data owner must be named at acceptance.
- Risk: changing criteria mid-deal for in-flight projects. Mitigated by the `project_policy_pin` check and the human migration decision.
