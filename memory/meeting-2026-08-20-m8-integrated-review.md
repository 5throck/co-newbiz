# Meeting M8: Integrated Review — Stage 1 Close-Out

**Date**: 2026-08-20
**Facilitator**: pm
**Participants**: pm, process-governance-manager, platform-lead, industry-lead, region-lead
**Objective**: Reconcile M0–M7-3 outcomes, resolve conflicts, confirm remaining open issues where possible, and produce the Stage 1 → Stage 2 handoff.

---

## Agenda
1. Reconcile all M0–M7-3 decisions for conflicts
2. Resolve outstanding open issues where the room can settle them
3. Confirm Stage 2 entry readiness

## Discussion

**pm**: Eleven meetings behind us. My job here is conflict detection, not re-deciding anything settled cleanly. Flag anything that contradicts another meeting's outcome.

**process-governance-manager**: One real tension: M6 gave site scoring a 15%-weighted permit-critical-path factor, but M1 made "sufficient infra + no Kill Criteria" a hard pre-filter. Resolution — these aren't in conflict, they're sequential: M1's Kill Criteria (e.g. zero viable sites on wastewater) is a project-level gate; M6's scoring runs among sites that already passed that filter. Stating this explicitly so procedures/ doesn't accidentally implement them as competing checks.

**platform-lead**: One implementation-order dependency worth flagging: M7-1's repository-layer mandatory-context static check (A-1) and M7-3's single-authoritative-gate-check function (A-2) are both Stage 5.1/5.3 work and should be built together, since they're the same kind of "one enforcement point, not scattered" pattern applied to two different concerns (need-to-know, human/agent boundary). Building them as one shared pattern reduces the chance of drift between them later.

**industry-lead** / **region-lead**: No conflicts from the profile side. M7-2's decision that EU market-surveillance is a region-profile field (not a certification-agent scheme) and M0's profile/opinion boundary are consistent with each other — confirming, not correcting.

**pm**: On open issues — O-2 resolved at M1 (shipbuilding-adjacent, KR+EU). O-8 (thin-agent consolidation) — design already set this decision point at end of Stage 2, and nothing in M0-M7-3 changed that reasoning, so it stays there, not pulled forward. O-1 (entity list) — no real entity list surfaced in this room; apply the design's stated default (two placeholder entities `ent-a`/`ent-b`) and move on, per the design's own fallback rule for exactly this situation.

**process-governance-manager**: On O-3 (real deal for the manual pilot) and O-16 (reviewer allocation) — neither is something this room can resolve; both require an answer from outside the team. I want to flag them plainly rather than let Stage 1 close with an implied resolution that didn't happen.

**pm**: Agreed. Both stay open and get escalated at Stage 1 close, per the design's own instruction that O-3 needs early escalation and O-16 gates Stage 3's pilot timing (concurrent-deal cap is separately constrained per M7-3, but that's Stage 5 operations, not Stage 2/3 blocking).

**platform-lead**: Stage 2 entry readiness from the technical side: yes, we have enough — M3's RAG numbers, M4's chain-grade criteria, and M7's architecture decisions are all concrete enough to start writing schema and procedures against.

**process-governance-manager**: Confirmed from the functional side — M1, M2, M5, M6 collectively give enough concrete detail to draft `procedures/_shared/{greenfield-screening,brownfield-screening}` and the group-review procedure without further meetings.

## Decisions

| # | Decision |
|---|---|
| D-M8-1 | No contradictions found between M0–M7-3 outcomes; one sequencing clarification (M1 pre-filter vs. M6 weighted score are sequential, not competing) documented |
| D-M8-2 | M7-1's mandatory-context check and M7-3's authoritative gate-check function should be implemented as one shared enforcement pattern, not two independent ones |
| D-M8-3 | O-1 resolved via design default: `md_entity` seeded with placeholder entities `ent-a`/`ent-b` pending a real entity list |
| D-M8-4 | O-2 confirmed resolved at M1 (no change) |
| D-M8-5 | O-8 stays at its existing decision point (end of Stage 2) — nothing in Stage 1 changed the reasoning |
| **D-M8-6** | **Stage 1 complete. Stage 2 entry criteria met** — proceed to regulation book, procedures, guidelines, checklists, and manuals per design section 10.5 |

## Action Items

| # | Action | Owner | Landing | Status |
|---|---|---|---|---|
| A-1 | Seed `md_entity` with placeholder entities per D-M8-3 | data-architect | Stage 2/4 | Pending |
| A-2 | Consolidate all M0–M7-3 decisions into a Stage 1 addendum in the design doc | pm | Design doc §17 (new) | **Done this session** |
| A-3 | **Escalate O-3 (real pilot deal) and O-16 (reviewer allocation) to the user** — required before Stage 3, and O-16 affects Stage 0/5 calendar already in progress | pm | User escalation | **Done this session** |
| A-4 | Begin Stage 2: regulation book, procedures, glossary already seeded (Stage 0.3), manuals | process-governance-manager, docs-writer | Stage 2 | Pending user go-ahead |

## Open Issues (carried forward, unresolved by this room)

| # | Issue | Why unresolved here |
|---|---|---|
| O-3 | Real deal for the Stage 3 manual pilot | Requires an actual candidate deal from outside the team |
| O-16 | Reviewer allocation ≥2.5 days/week | Requires an organizational staffing decision |
