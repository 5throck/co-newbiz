---
name: value-chain-driver-identification
scope: co-newbiz
description: >
  Derives per-value-chain-stage driver sensitivities systematically:
  correlates each chain node's historical financial series (from
  `value-chain-stage-financials`) against driver time series to estimate
  which drivers matter for which stage, with what sensitivity and lag —
  populating `chain_node_sensitivity` analytically instead of by manual
  form entry.

  Use when: "chain node sensitivity", "per-stage driver sensitivity",
  "driver correlation analysis", "lead-lag driver estimation".
version: 1.0.0
last_reviewed: 2026-08-29
status: active
owner: quant-methodologist
prerequisites:
  - value-chain-stage-financials
metadata:
  type: domain
  triggers:
    - chain node sensitivity
    - per-stage driver sensitivity
    - driver correlation analysis
    - lead-lag driver estimation

  procedure_keys:
    - greenfield-fs
    - brownfield-fs
relates_to:
  - skill: value-chain-stage-financials
    type: follows
  - skill: forward-industry-research
    type: follows
  - skill: unit-conversion-calibration
    type: composes_with
  - skill: scenario-planning
    type: enables

---

## Context

`chain_node_sensitivity` was originally a manual-entry form: the analyst
typed in which drivers move which stage by how much. That is an analytical
estimate masquerading as data entry. This skill applies the same estimation
discipline `unit-conversion-calibration` uses for proxy-chain hops — OLS
correlation with lead-lag exploration on observed series — to the chain's
driver sensitivities, so the numbers entering the ADR-0066 Phase C
structure simulation are derived from evidence with stated fit quality.

## When to Use

- Populating or revising `chain_node_sensitivity` for a project whose
  chain nodes have 5-year financial series
- When a structure-simulation result is questioned and the per-stage
  sensitivities turn out to be unexamined manual entries

## Execution Steps

1. **Assemble the series**: per chain node, take the historical KPI series
   (`fact_industry` via `value-chain-stage-financials`) and the candidate
   driver time series registered by `forward-industry-research` — align
   periods and units before any correlation is computed
2. **Estimate sensitivity and lag**: for each node × driver pair, run
   correlation across plausible lags (same discipline as
   `unit-conversion-calibration`'s lead-lag OLS) and record the
   best-fitting sensitivity coefficient and lag
3. **Grade the fit**: state R²/fit quality and observation count per
   estimate; a short or noisy series yields a low-confidence sensitivity —
   carry the confidence grade, never round a weak estimate toward zero or
   toward a convenient magnitude
4. **Flag structural breaks**: a regulatory transition or capacity shock
   inside the estimation window can make historical correlation a poor
   guide; flag such windows and, where necessary, estimate on the
   post-break segment only — and say so
5. **Persist and route**: write sensitivity and lag per node × driver to
   `chain_node_sensitivity` (`POST /api/projects/:id/chain-sensitivities`),
   replacing the manual entry; estimates with failed fits stay flagged for
   analyst judgement rather than silently defaulting
6. **Boundary**: these are value-chain-layer sensitivities only — never
   borrow a proxy-chain beta for the same pair, and vice versa (ADR-0025
   separation applies to sensitivities exactly as it does to
   pass-through coefficients)

## Output Format

- `chain_node_sensitivity` rows per node × driver with coefficient, lag,
  fit quality (R², n), and confidence grade
- Structural-break flags with the segment used for estimation

## Related Skills

- `value-chain-stage-financials` — the per-node historical series input
- `forward-industry-research` — the driver-candidate list input
- `unit-conversion-calibration` — the lead-lag OLS discipline this reuses
- `scenario-planning` — the structure simulation consuming these
  sensitivities
