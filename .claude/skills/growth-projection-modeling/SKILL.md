---
name: growth-projection-modeling
scope: co-newbiz
description: >
  Builds a forward growth projection with every derived assumption carrying
  an `anchor_ref` to its source data (historical or peer distribution) —
  a forecast landing outside the top 10% of that distribution triggers an
  automatic base-rate warning rather than passing silently (ADR-0018). This
  is the mechanism that converts optimism bias from a qualitative risk into
  a mechanically checkable one, and the source of the Kill Criterion for an
  unsigned-off top-decile-exceeding projection.

  Use when: "growth projection", "revenue forecast", "base rate warning",
  "anchor_ref", "hockey stick check".
version: 1.1.0
last_reviewed: 2026-08-23
status: active
owner: financial-analyst
prerequisites:
  - historical-financial-analysis
  - peer-benchmarking
metadata:
  type: domain
  triggers:
    - growth projection
    - revenue forecast
    - base rate warning
    - anchor_ref
    - hockey stick check

  procedure_keys:
    - greenfield-fs
relates_to:
  - skill: site-infrastructure-assessment
    type: follows

---

## Context

`policies/group/neb-policy.md` §4's third Kill Criterion is exactly this
mechanism at its most consequential: a growth projection outside the
top-decile historical/peer base rate, **without risk-officer sign-off**, is
a binding halt — not a RAG-grade penalty. The `anchor_ref` requirement
(ADR-0018) is what makes this checkable at all: without a recorded pointer
from the projection assumption back to its historical/peer source, there is
nothing for the base-rate check to compare against.

## When to Use

- Any feasibility, valuation, or investment-modeling work needing a
  forward revenue/growth assumption
- Reviewing an existing projection for whether its assumptions are properly anchored

## Execution Steps

1. **Pull both base-rate distributions**: `historical-financial-analysis`'s
   time-series distribution and `peer-benchmarking`'s cross-sectional
   distribution
2. **Build the projection**, and for every derived growth assumption
   record an `anchor_ref` — the specific historical or peer data point(s)
   it's grounded in, not a vague "based on industry trends"
3. **Run the top-decile check**: does the projection fall within the top
   10% of the combined historical/peer distribution? If yes, proceed
   normally
4. **If outside the top decile**: this triggers an automatic base-rate
   warning — the projection cannot proceed without explicit `risk-officer`
   sign-off. Absent that sign-off, this is a Kill Criteria hit
   (`stage-gate-governance`), not a soft flag to note and move past
5. **Never suppress or manually override the warning** — the check exists
   specifically because optimism bias is hard to self-detect; the warning
   firing is the check working, not a nuisance to route around

## Output Format

- Growth projection with `anchor_ref` per assumption, base-rate check
  result, risk-officer sign-off record if the check triggered

## Related Skills

- `historical-financial-analysis`, `peer-benchmarking` — the anchor distributions
- `stage-gate-governance` — the Kill Criterion an unsigned-off warning triggers
- `investment-feasibility-modeling` — the broader model this projection feeds
