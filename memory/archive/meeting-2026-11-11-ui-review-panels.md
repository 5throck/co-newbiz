# Meeting transcript — website review panels (1st UI/UX + 2nd functional/Journey)

- **meeting-ids**: 2026-11-11-ui-review-panel-1, 2026-11-11-ui-review-panel-2
- **date**: 2026-11-11
- **purpose**: User-directed review panels over the whole website structure: panel 1 (UI/UX experts) grading the composition, panel 2 (functional domain) reviewing functionality and auditing the S1→S12 Journey Map (client request → final result check), then a consolidated improvement plan.
- **facilitator**: PM (inline role-play per agents/pm.md Meeting Facilitation; PM voiced only the openings and the closing syntheses)
- **panel 1 participants**: ux-designer-agent, design-system-agent, frontend-engineer
- **panel 2 participants**: process-governance-manager, risk-officer, market-intelligence-agent, financial-analyst, ux-designer-agent (panel-1 reporter)
- **basis**: screen inventory from the PM survey (survey transcript in session context), Onyx 3.0 standard patterns P0–P5 (docs/design-system/design-screens.md), DESIGN-CHECKLIST.md, the two success criteria of the 2026-09-12 usability review (CRUD surfaces + stage-linkage strip), flow.spec.yaml v2.21.0 stage/gate SSOT, FR-SYS-03/05, FR-SEC-01/02.

## Panel 1 verdict table (UI/UX)

| # | Surface | Verdict | Reason |
|---|---------|---------|--------|
| 1 | Single-landing deal board + 4-band columns (/deals) | pass | ADR-0120 choice fits the analyst JTBD; gate aging + paused widgets |
| 2 | Stage-tab integration (/deals/[id]/[stage]) | pass | all S1–S12 have dedicated screens; StageFrame auto-renders handoff |
| 3 | stage-linkage strip (STAGE_HANDOFF + StageFrame) | pass w/ condition | S10Frame sub-tabs + wrapper pages mount coverage must be verified → improvement plan |
| 4 | S6/S7 single shared component (stages.s67) | improve required | S6 = P1 Registry (sourced longlist), S7 = Registry + deal-shape evaluation (ADR-0195) — two patterns in one component |
| 5 | Five flat stage redirect stubs (CarrierGate) | improve required | auto-redirect paths should be server redirects; picker paths are valid destinations and stay |
| 6 | Wiki viewer outside P0 Shell | improve required | unregistered variant unless design-screens.md documents the exemption |
| 7 | Admin 13 surfaces have no standard-pattern mapping | improve required | system gap — mapping decision + documentation via the ADR path |
| 8 | Recently changed surfaces (CommitteeMinutesView, S4) | pass | design-lint clean, i18n parity tests, 400-line split honored |
| 9 | Handbook screenshots sync (86 captures, 2026-10-29) | improve needed | committee screens + S4 fixes not reflected → C3 |
| 10 | Entry surface (no S0/intake; two board CTAs) | → panel 2 | client-request surface is a governance + Journey question |

## Panel 2 verdict table (functional + Journey, merged view)

| # | Item | Verdict | Reason |
|---|------|---------|--------|
| 11 | Journey entry (client request) | improve required (governance) | no S0/intake stage in flow.spec — ADR-0074 path decision needed + auditable entry record (risk-officer requirement) |
| 12 | Journey exit (final result) | pass w/ partial gap | S12 five-vocabulary transition + /projects/[id]/process full chain; the kill-learning → base-rate feedback loop is not visible in any screen |
| 13 | Seven human gates surfaces | pass w/ check | GateDecisionPanel + GateSnapshotAck + kill-criteria UI unified; S11 hard-block reason must read on screen |
| 14 | S11 IC surface | pass w/ check | minutes links + DISPLAY-only snapshot + 409 snapshot_stale message legibility |
| 15 | Source/grade rendering at S1/S2/S8 (FR-SYS-03) | improve required | matrix version id + confidence grade (esp. grade U with chain hops), entry-market unset honest label, S5 pinned-reference tag — standardize as a per-surface checklist |
| 16 | Board kill-signal display | improve required | gate-aging widget should carry kill-evaluation three-state (triggered / false / unassessed) if the widget exists; absence is a gap, showing unassessed as pass would be a violation |
| 17 | S10 brownfield tranche-conditions view | check | record carrier exists (venture_transition_decision.tranche_condition); read-only view existence to confirm |
| 18 | FR-SYS-03 per-surface checklist | improve required | standardize so future panels can regression-test instead of debating per screen |

## Cross-panel agreements (input to the improvement plan)

- S6/S7 split is cheap for frontend (two thin wrappers over the shared component) but should be sequenced relative to the next S7 feature round (ADR-0195 churn).
- CarrierGate improvement = serverize only the auto-redirect paths; the picker path is a legitimate destination.
- Wiki exemption and admin pattern mapping need documentation decisions in design-screens.md (system-gap procedure: token/component proposal → platform-lead → ADR).
- Board kill-signal: three-state display required if widget exists; unassessed never renders as pass.
- Journey conclusion: S1→S12 is designed (stage screens + handoff strip + gate surfaces + PromotionPanel); the two open points are the entry (no S0) and the feedback-loop visibility; the promotion-confusion is a known handbook item (C3).
- FR-SYS-03 per-surface checklist standardization (market-intelligence-agent proposal) accepted by ux-designer-agent — becomes regression basis for future panels.

## Handoffs
- Improvement plan document: docs/ (PM-dispatched writer).
- C2 (admin account review): the 12-question security-engineer brief from the pre-dispatch survey.
- C3 (handbook + flow console): wiki SSOT drift items (self-registration closure in 01-시작하기, committee screens, S4 fixes, 86 screenshots refresh) + flow console projection freshness check (flows read generated projections; SSOT changes ADR-0195/0196-E must be re-projected).
