---
name: historical-financial-analysis
scope: co-newbiz
description: >
  Analyzes a target's historical financial trajectory (multi-year trend,
  volatility, cyclicality) as the base-rate distribution
  `growth-projection-modeling` anchors against — distinct from
  `financial-statement-analysis`'s single-period KPI/driver-tree pipeline,
  this skill is specifically about the historical distribution's shape.

  Use when: "historical financial trend", "historical volatility", "base
  rate distribution", "multi-year trajectory analysis".
version: 1.0.0
last_reviewed: 2026-08-20
status: active
owner: financial-analyst
prerequisites:
  - financial-statement-analysis
metadata:
  type: domain
  triggers:
    - historical financial trend
    - historical volatility
    - base rate distribution
    - multi-year trajectory analysis
---

## Context

`financial-statement-analysis` produces per-year KPIs and a driver tree;
this skill takes that multi-year output and characterizes it as a
distribution — the historical growth rate's mean, volatility, and top/bottom
decile bounds — because `growth-projection-modeling` needs exactly this
distribution to anchor a forward projection against (ADR-0018). A single
point estimate of "historical growth was X%" is not sufficient input; the
distribution's shape is what lets a base-rate warning trigger correctly.

## When to Use

- Before any growth projection is built, to establish the historical base rate
- Assessing whether a target's financial history shows meaningful cyclicality that a flat projection would miss

## Execution Steps

1. **Pull the multi-year KPI series** from `financial-statement-analysis`'s
   output (revenue, operating margin, growth rates, at minimum 3-5 years
   where available)
2. **Characterize the distribution**: mean growth rate, standard deviation,
   and the top/bottom decile bounds — this decile bound is what
   `growth-projection-modeling` checks a forecast against
3. **Flag cyclicality or structural breaks**: a target whose history
   includes a clear cyclical pattern or a one-time structural break (M&A,
   divestiture, accounting-standard change) needs that noted explicitly —
   a smoothed average across a structural break understates or overstates
   the true underlying trend
4. **Hand the distribution to `growth-projection-modeling`** and
   `peer-benchmarking` as the historical-side input to the base-rate check

## Output Format

- Historical growth distribution (mean, volatility, decile bounds),
  cyclicality/structural-break notes

## Related Skills

- `financial-statement-analysis` — the source KPI series
- `growth-projection-modeling` — the consumer of this distribution for anchoring
- `peer-benchmarking` — the parallel cross-sectional (not time-series) base rate
