---
name: peer-benchmarking
scope: co-newbiz
description: >
  Builds a comparable-company peer set and benchmarks the target's KPIs
  (margins, growth, leverage, ROIC) against it — the cross-sectional
  counterpart to `historical-financial-analysis`'s time-series base rate.
  Both feed `growth-projection-modeling`'s anchor check.

  Use when: "peer benchmarking", "comparable company analysis", "peer
  multiple comparison", "industry benchmark".
version: 1.0.0
last_reviewed: 2026-08-20
status: active
owner: financial-analyst
prerequisites: none
metadata:
  procedure_keys:
    - greenfield-fs
    - brownfield-fs
    - brownfield-target-screening
  type: domain
  triggers:
    - peer benchmarking
    - comparable company analysis
    - peer multiple comparison
    - industry benchmark
relates_to:
  - skill: proxy-industry-chain
    type: follows
  - skill: quality-of-earnings
    type: composes_with
  - skill: scenario-planning
    type: composes_with
  - skill: unit-conversion-calibration
    type: composes_with
  - skill: stage-gate-governance
    type: composes_with
  - skill: site-infrastructure-assessment
    type: composes_with
  - skill: quality-of-earnings
    type: composes_with

---

## Context

A peer set is only useful if genuinely comparable — same industry
(cross-referenced against `industry-profile-application` where a profile
exists), similar scale, similar business model. A mismatched peer set
(e.g. benchmarking a component supplier against integrated OEMs) produces a
benchmark that looks precise but answers the wrong question.

## When to Use

- Any feasibility or valuation work needing a peer-relative sanity check
- Establishing the peer-side base rate for `growth-projection-modeling`

## Execution Steps

1. **Screen for genuine comparability**: industry, scale, business model —
   document why each included peer is comparable, not just that it shares
   an industry code
2. **Pull peer KPIs**: margins, growth rates, leverage ratios, ROIC — via
   `company-intelligence`/`k-dart` for public peers
3. **Compute peer distribution stats**: median, quartiles, decile bounds —
   the same shape of output `historical-financial-analysis` produces, so
   the two combine cleanly in `growth-projection-modeling`'s check
4. **Flag outlier peers explicitly** rather than silently excluding them —
   an outlier peer might indicate a genuinely different sub-segment, not
   just noise to filter out
5. **Hand the peer distribution to `growth-projection-modeling`** and to
   the valuation work as a peer-multiple sanity check

## Output Format

- Peer set with comparability rationale, peer KPI distribution (median,
  quartiles, decile bounds)

## Related Skills

- `historical-financial-analysis` — the time-series counterpart base rate
- `growth-projection-modeling` — the consumer of this distribution
- `industry-profile-application` — the industry-comparability check, where a profile exists
