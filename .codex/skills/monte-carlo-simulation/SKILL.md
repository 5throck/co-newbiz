---
name: monte-carlo-simulation
scope: co-newbiz
description: >
  Runs the seeded Monte Carlo NPV simulation (`python/monte_carlo.py`,
  ADR-0026) integrating contingent liabilities as probability/triangular-
  distribution draws on every iteration — never a narrative footnote.
  Identical seed plus identical inputs must reproduce an identical result
  (design §12 verification item 13); this script uses numpy's seeded
  Generator exclusively, never the global unseeded RNG.

  Use when: "Monte Carlo simulation", "seeded simulation", "P50 P95 NPV",
  "contingent liability integration".
version: 1.1.0
last_reviewed: 2026-08-23
status: active
owner: risk-officer
prerequisites:
  - debt-and-contingent-liability-simulation
metadata:
  type: implementation
  procedure_keys:
    - greenfield-fs
    - brownfield-fs
  triggers:
    - Monte Carlo simulation
    - seeded simulation
    - P50 P95 NPV
    - contingent liability integration
relates_to:
  - skill: investment-vehicle-structuring
    type: follows
  - skill: scenario-planning
    type: follows
  - skill: quality-of-earnings
    type: composes_with
  - skill: scenario-planning
    type: composes_with
  - skill: peer-benchmarking
    type: composes_with
  - skill: proxy-industry-chain
    type: composes_with
  - skill: unit-conversion-calibration
    type: composes_with
  - skill: stage-gate-governance
    type: composes_with
  - skill: site-infrastructure-assessment
    type: composes_with

---

## Context

The output contract is exact, per the module's own docstring: results come
back as P50/P95 amounts, never a prose "contingent liability exists"
statement. Determinism is a hard requirement, not a nice-to-have — a
re-run with the same seed and inputs producing a different result is a bug
in the simulation code, not acceptable stochastic variance, because the
seeded numpy Generator is used exclusively.

## When to Use

- Any project with contingent liabilities entered via
  `debt-and-contingent-liability-simulation` needs its NPV distribution computed
- Verifying reproducibility of a prior simulation run

## Execution Steps

1. **Confirm inputs are ready**: `seed`, `iterations`, `discount_rate`,
   `base_cash_flows`, and every contingent liability with `probability`,
   `amount_low`/`amount_expected`/`amount_high`, and `timing_year` — a
   narrative-only contingent-liability entry is not a valid input
2. **Run**: `python monte_carlo.py <input.json>` — each contingent
   liability draws a triangular-distribution amount, gated by its
   probability, on every iteration
3. **Confirm the downside tail actually thickens** when contingent
   liabilities are included, versus a run with none — this is the
   sanity check that the integration is working, not decorative
4. **Report P50 and P95 NPV**, not a single point estimate — the whole
   point of this simulation over a deterministic model is capturing the
   distribution's tail risk
5. **Re-run with the identical seed** to verify reproducibility whenever
   inputs are unchanged but a result needs re-confirming — a mismatch is a
   defect to investigate immediately, not something to average away

## Output Format

- P50/P95 NPV distribution, per-iteration contingent-liability draw summary, seed used

## Related Skills

- `debt-and-contingent-liability-simulation` — the contingent-liability inputs this simulation draws
- `scenario-planning` — the discrete-case counterpart to this continuous distribution
