---
name: scenario-planning
scope: co-newbiz
description: >
  Defines discrete downside/base/upside scenarios (distinct from
  `monte-carlo-simulation`'s continuous probability distribution) for the
  investment feasibility model, including the standard +200bp
  rate-shock covenant test and any deal-specific structural scenario.

  Use when: "scenario analysis", "downside case", "upside case", "rate
  shock scenario", "structural scenario planning".
version: 1.1.0
last_reviewed: 2026-08-23
status: active
owner: risk-officer
prerequisites:
  - investment-feasibility-modeling
metadata:
  type: domain
  procedure_keys:
    - greenfield-fs
    - brownfield-fs
  triggers:
    - scenario analysis
    - downside case
    - upside case
    - rate shock scenario
    - structural scenario planning
---

## Context

Scenario planning and Monte Carlo simulation answer different questions and
are not substitutes: a scenario is a discrete, named, explainable case
("what if the rate environment shocks +200bp") a human reviewer can reason
about directly; a Monte Carlo run produces a continuous probability
distribution better suited to aggregating many small, hard-to-individually-name
uncertainties (contingent liabilities, in particular). Both are usually
needed on the same deal — one is not a lighter-weight version of the other.

## When to Use

- Building the feasibility model's downside/base/upside cases
- The mandatory covenant-breach stress test (`checklists/ma-special-topics-checklist.yaml` ma-11)

## Execution Steps

1. **Define the base case** from `investment-feasibility-modeling`'s
   central assumptions
2. **Define the downside case**: which specific assumptions move
   unfavorably and by how much — named and justified, not just "20% worse
   across the board"
3. **Run the standard +200bp rate-shock covenant test** as part of the
   downside case (Brown Field DD requirement, feeding
   `debt-and-contingent-liability-simulation`'s covenant-breach check)
4. **Define the upside case** the same way — specific, named, justified
   favorable assumption moves
5. **Add any deal-specific structural scenario** the standard three-case
   framework doesn't capture (e.g. a partner-sourcing failure scenario
   where `partner-sourcing-strategy` flagged a hard dependency)
6. **Report all scenarios side by side** — a downside/base/upside table,
   never just the base case with scenarios mentioned as a footnote

## Output Format

- Scenario table (downside/base/upside, plus deal-specific scenarios),
  NPV/IRR per scenario, covenant-breach test result under the downside case

## Structure-Simulation Extension (ADR-0066 Phase C)

The quantitative arm of this skill for FS gates: driver deltas recorded on
the run as `drv.rate_bp` / `drv.fx_pct` / `drv.commodity_pct` /
`drv.regulation_severity` assumption keys are propagated through the value
chain's elasticity and pass-through coefficients by
`python/structure_sim.py` (seeded MC — same determinism discipline as
monte_carlo.py). Outputs land per node as P05/P50/P95
demand/margin quantiles (`industry_structure_simulation` output_type).
REST: `POST /api/projects/:id/structure-simulations`; MCP:
`run_structure_simulation✱`. Boundary: value_chain coefficients ONLY —
proxy-chain estimates may enter as input values, never as shared
coefficients (ADR-0025). Coefficient-less links surface UNASSESSED nodes.
## Related Skills

- `monte-carlo-simulation` — the continuous-distribution counterpart
- `investment-feasibility-modeling` — the base model this scenarios against
- `debt-and-contingent-liability-simulation` — the covenant-breach test consumer
