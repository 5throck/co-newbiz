---
name: quality-of-earnings
scope: co-newbiz
description: >
  Adjusts reported earnings for one-time items, related-party transactions,
  and accounting-policy aggressiveness to arrive at a normalized EBITDA the
  valuation model should actually use — a Brown Field DD staple distinct
  from `financial-statement-analysis`'s validated-but-unadjusted pipeline
  output.

  Use when: "quality of earnings", "EBITDA adjustments", "normalized
  earnings", "QoE report".
version: 1.2.1
last_reviewed: 2026-10-28
status: active
owner: financial-analyst
prerequisites:
  - financial-statement-analysis
metadata:
  type: domain
  triggers:
    - quality of earnings
    - EBITDA adjustments
    - normalized earnings
    - QoE report

  procedure_keys:
    - brownfield-fs
    - brownfield-dd
relates_to:
  - skill: investment-feasibility-modeling
    type: follows
  - skill: scenario-planning
    type: composes_with
  - skill: financial-statement-analysis
    type: composes_with
  - skill: peer-benchmarking
    type: composes_with
  - skill: unit-conversion-calibration
    type: composes_with
  - skill: stage-gate-governance
    type: composes_with
  - skill: financial-statement-analysis
    type: composes_with
  - skill: growth-projection-modeling
    type: composes_with
  - skill: historical-financial-analysis
    type: composes_with
  - skill: peer-benchmarking
    type: composes_with
---

## Context

`financial-statement-analysis`'s pipeline validates and normalizes account
names into a canonical model, but does not adjust for one-time items or
management discretion in accounting policy — that is this skill's job. A
target's reported EBITDA and its "true" run-rate EBITDA can differ
materially, and a valuation built on the unadjusted figure inherits any
distortion the target's own reporting choices introduced.

## When to Use

- Brown Field DD, before the valuation model is finalized
- Any target whose reported earnings include material one-time items or
  related-party transactions

## Execution Steps

1. **Start from `financial-statement-analysis`'s validated canonical model**
   — do not re-derive base figures independently
2. **Identify one-time items**: restructuring charges, litigation
   settlements, asset write-offs/write-ups, non-recurring gains — each
   with amount, period, and a brief rationale for why it's non-recurring
3. **Identify related-party transactions**: revenue or cost items with an
   affiliate (cross-reference `intra-group-transaction-compliance` where
   the target is itself part of a group) — a related-party price that
   isn't arm's-length distorts the true operating economics
4. **Assess accounting-policy aggressiveness**: revenue recognition timing,
   capitalization vs. expensing choices, reserve/provision levels relative
   to peers — flag where a policy choice materially flatters reported
   earnings
5. **Supply revenue-quality inputs to `commercial-due-diligence` (cdd-08)**:
   margin by customer/segment and DSO/receivable aging by customer, plus the
   recurring vs. one-off split of revenue (distinct from step 2, which
   normalizes one-time items in earnings). Provide the data and its
   reliability; the four-axis judgment stays with commercial DD
6. **Produce normalized EBITDA**: reported EBITDA plus/minus each
   adjustment, itemized (never a single unexplained delta) — this is the
   figure `investment-feasibility-modeling` should use, not the reported one

## Output Format

- QoE bridge: reported EBITDA → itemized adjustments → normalized EBITDA
- Customer-level margin, DSO/aging and recurring-revenue split handed to cdd-08

## Related Skills

- `financial-statement-analysis` — the validated base figures this adjusts
- `investment-feasibility-modeling` — the consumer of normalized EBITDA
- `commercial-due-diligence` — the broader DD context this QoE work sits within, and the consumer of the customer-level inputs above
