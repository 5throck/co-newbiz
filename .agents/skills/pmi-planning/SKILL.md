---
name: pmi-planning
scope: co-newbiz
description: >
  Plans post-merger integration for a Brown Field acquisition, synthesizing
  `org-readiness-assessment`'s integration-cost estimate,
  `compensation-harmonization-analysis`'s harmonization cost,
  `management-incentive-review`'s key-person retention findings, and
  `incentive-clawback-assessment`'s restructuring-triggered clawback
  exposure into one integration plan and timeline.

  Use when: "PMI planning", "post-merger integration", "integration
  timeline", "day-one integration plan".
version: 1.0.0
last_reviewed: 2026-08-20
status: active
owner: pmi-agent
prerequisites:
  - org-readiness-assessment
metadata:
  type: process
  triggers:
    - PMI planning
    - post-merger integration
    - integration timeline
    - day-one integration plan
---

## Context

PMI planning is a synthesis skill, not a new analysis — it does not
re-derive readiness scores, harmonization costs, or clawback exposure; it
sequences and reconciles outputs that `org-readiness-assessment`,
`compensation-harmonization-analysis`, `management-incentive-review`, and
`incentive-clawback-assessment` already produced. A restructuring action
planned here that would trip a clawback identified in
`incentive-clawback-assessment` needs to be flagged before the plan is
finalized, not discovered afterward.

## When to Use

- A Brown Field deal has cleared or is nearing DD exit and needs a day-one/
  100-day/full-integration timeline
- Reconciling integration actions against known clawback and retention risks

## Execution Steps

1. **Pull the readiness scorecard** (`org-readiness-assessment`) — leadership
   alignment, cultural readiness, capability gaps, integration cost estimate
2. **Pull the compensation harmonization cost**
   (`compensation-harmonization-analysis`) and fold it into the same
   integration-cost line, not a separate budget
3. **Pull key-person retention findings**
   (`management-incentive-review`) — identify which roles are flight-risk
   and whether a non-compete is actually enforceable for them
4. **Cross-check every planned restructuring action against
   `incentive-clawback-assessment`'s inventory** — a headcount reduction or
   facility consolidation that trips a clawback needs to be priced into the
   plan or reconsidered, not discovered after the fact
5. **Sequence the plan**: day-one actions (what must happen at close),
   100-day priorities, and the full integration timeline, each with owner
   and dependency
6. **Flag any integration action that conflicts with a Kill-Criteria-adjacent
   finding** (e.g. a planned relocation that would trigger a non-transferable
   certification issue) to `stage-gate-governance` before the plan proceeds

## Output Format

- Integration plan: day-one/100-day/full timeline, cost (readiness +
  harmonization), retention-risk register, clawback cross-check result

## Related Skills

- `org-readiness-assessment`, `compensation-harmonization-analysis`,
  `management-incentive-review`, `incentive-clawback-assessment` — the
  inputs this skill synthesizes, never re-derives
