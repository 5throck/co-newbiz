# ADR-0150 — S12 lifecycle completion criteria mapped to portfolio transitions

- Status: Accepted (2026-10-02, human reviewer in chat)
- Date: 2026-10-01
- Deciders: Human reviewer (accepted 2026-10-02). Drafted by process-governance-manager (Row 2). AI review alone cannot accept this ADR.
- Design of record: `docs/designs/2026-10-01-s1-s12-process-alignment-design.md` (finding F5)
- Related: ADR-0008 (Stage Gate and Kill Criteria model)

> **Accepted 2026-10-02 by the human reviewer in chat.** All previously open points are decided:
> 1. The six S12 completion criteria are adopted **as written** (verbatim: "ADR-0150 accepted; the six criteria adopted as written").
> 2. **Migration: IMMEDIATE full application** — all in-flight (project_policy_pin-pinned) projects evaluate against the new criteria from now on; no cutoff, no grandfathering window. This overrides the ADR's previously open migration choice (§Policy-impact analysis plan item 4).
> 3. **Criterion 6 data owners**: `group-review-agent` records the captured learning; `risk-officer` feeds it back into S1/S2 base rates.
>
> The migration decision and the criterion-6 data ownership are now part of the Decision below, not open questions.

## Context

S12 (post-investment management) has one activity, no gate, one artifact (the venture scorecard) and one completion criterion. The web app already exposes five portfolio transition decisions (`PORTFOLIO_TRANSITIONS` in `app/web-next/lib/process-flow.ts`): `next_tranche_released`, `held_evidence_incomplete`, `graduate_to_core`, `reduce_or_divest`, `kill_with_learning_captured`. The spec does not say what a complete S12 review cycle must record.

## Decision (accepted 2026-10-02)

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

Recorded decisions completing the previously open points:

- **Migration: IMMEDIATE full application.** All in-flight (`project_policy_pin`-pinned) projects evaluate against the new criteria from now on; no cutoff. The pin-scan snapshot is archived in §Policy-impact record (2026-10-02) before the switch.
- **Criterion 6 data owners:** `group-review-agent` records the captured learning (the `learning_capture` content of `kill_with_learning_captured` rows); `risk-officer` feeds it back into S1/S2 base rates.

## Policy-impact record (2026-10-02)

Executed per the plan below (run by process-governance-manager, Row 3).

**1. Files in `policies/**` and `procedures/**` referencing S12, post-close or portfolio monitoring (grep 2026-10-02):**

| File | Match |
|---|---|
| `procedures/_shared/portfolio-venture-monitoring/schema.yaml` | `gate: post_close`; amended by this PR |
| `procedures/_shared/jv-lifecycle-governance/schema.yaml` | JV→venture monitoring feed (step 3) |
| `procedures/_shared/deal-shape-chain/schema.yaml` | JV/portfolio monitoring routing prose |
| `procedures/_human-roles.yaml` | `venture-portfolio-ic` role; post-close BAU exit certifier |
| `procedures/_kill-criteria/pmi-integration-execution__synergy_run_rate_uncertified_at_bau_handover.json` | post-close BAU handover kill criterion |
| `policies/**` | no direct S12/post-close reference found; the group policy's §2.8 pin clause governs application |

**2. Amendments by this PR:** only `procedures/_shared/portfolio-venture-monitoring/schema.yaml` is amended (records required by criteria 1-6; criterion-6 data ownership). The other files are referenced-but-unaffected: they route into or record human roles around S12 and require no change.

**3. `project_policy_pin` query (db/data/co-newbiz.sqlite, 2026-10-02):** live pin rows (superseded_by IS NULL): **0**. No in-flight project pins any procedure version, including `shared-portfolio-venture-monitoring`. In-flight projects present in `md_project`: PRJ-QGB2W5, PRJ-DSE4PW, PRJ-QG5WDY, PRJ-T7T81A, DEMO-S1-S12 (current_stage_gate `group_ic`). The immediate-application decision therefore breaks no existing pin; on the next pin sync, projects pin the amended version directly.

## Policy-impact analysis plan

1. List every `policies/**` and `procedures/**` file that references S12, post-close or portfolio monitoring.
2. Run policy impact analysis on each file.
3. Query `project_policy_pin` for every in-flight project and record which projects pin the current version.
4. ~~**Open human decision:** pinned projects either keep the old criteria until their next review period, or migrate to the new criteria.~~ **Decided 2026-10-02: IMMEDIATE full application — no cutoff.** Recorded in the Decision section.
5. Accepted 2026-10-02; the procedure and the S12 entry in `process/flow.spec.yaml` are amended in the ADR-backed implementation PR (this PR).

## Consequences

- If accepted, S12 gains explicit completion criteria and may gain a review gate; procedure, flow-spec and web changes follow in their own PR.
- Criterion 6 creates a feedback path into S1/S2 base rates; data owners are named in the Decision (`group-review-agent` records, `risk-officer` feeds back).
- Risk: changing criteria mid-deal for in-flight projects. Mitigated by the `project_policy_pin` check and the human migration decision.
