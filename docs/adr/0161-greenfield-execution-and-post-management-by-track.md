# ADR-0161 — Greenfield execution (S11) and post-management (S12) scoped by track and sub-track

- Status: Proposed
- Date: 2026-10-11
- Deciders: Human reviewer (pending). Drafted by process-governance-manager. AI review alone cannot accept this ADR (procedure, checklist applicability and flow.spec change).
- Design of record: `docs/designs/2026-10-11-greenfield-investment-execution-and-post-management-design.md`
- Related: ADR-0047, ADR-0052, ADR-0059, ADR-0150, ADR-0159, ADR-0160

## Context

S11 and S12 apply to both tracks but their execution and monitoring content assumes an acquisition closing. Greenfield has no execution baseline (capex tranches bound to S10 conditions, permit and certification milestones, hiring plan, ramp-up KPIs against the S8 adopted case and ADR-0159 goals). The S12 PMI tab is visible and writable for greenfield. `portfolio-venture-monitoring` is gated on `origin in {internal, hybrid, joint}`, so greenfield rows with null origin and every external brownfield deal (m_and_a, strategic_investment, partnership) have no applicable S12 procedure.

## Decision

1. New shared procedure `greenfield-execution-baseline` (applies_when case_type greenfield; six steps, human confirmation last) and S11 activity of the same id.
2. `portfolio-venture-monitoring` v1.2.0: predicate becomes `any_of(origin in {internal, hybrid, joint}, case_type eq greenfield)`; greenfield ramp-up measure keys documented; five-term vocabulary unchanged with a greenfield mapping.
3. External brownfield S12: `pmi-integration-execution` gains a post-close monitoring step (activity `integration-monitoring`); partnership gets `partnership-monitoring` via `jv-lifecycle-governance` step 2.
4. `financing-plan-checklist` fin-04..fin-08 scoped to brownfield; new items gx-01..gx-03 in `entity-formation-checklist`.
5. flow.spec bumped to v2.8.0. Activity-level scoping is enforced by procedure `applies_when` and UI/API guards unless activity-level `applicableTracks` is confirmed supported.
6. UI/API: PMI tab and writes gated by `pmiKickoffApplies`; new execution-baseline route (human-only confirm). No DB migration.
7. Brownfield PMI sub-tracks remain byte-identical. Application at next policy pin, not retroactive.

## Alternatives considered

- Extend `entity-establishment-execution`: rejected, it is entity-shaped and origin-gated; existing_business_rbd has no new entity.
- Add greenfield terms to the transition vocabulary: rejected, the five terms map cleanly.
- New tranche table: deferred; process_run meta and venture_scorecard suffice.

## Consequences

- Positive: every track/sub-track cell has an applicable S12 procedure; greenfield execution is tracked against the case and goals; PMI data hygiene.
- Negative: one more procedure to maintain; origin and track predicates coexist.
- Rollback: revert spec and procedure versions; UI guards are additive.
