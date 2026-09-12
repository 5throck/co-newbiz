---
name: forward-industry-research
scope: co-newbiz
description: >
  Qualitative research narrative on the target industry's forward
  (demand-side) and upstream industries: their structure, key players,
  technology and regulatory trends, and the key drivers that will decide
  the target industry's future direction — producing the driver-candidate
  registry entries and scenario definitions the structure simulation
  consumes.

  Use when: "forward industry research", "upstream industry research",
  "key driver identification", "industry direction analysis",
  "external environment scenario".
version: 1.0.0
last_reviewed: 2026-08-29
status: active
owner: market-intelligence-agent
prerequisites: none
metadata:
  type: domain
  triggers:
    - forward industry research
    - upstream industry research
    - key driver identification
    - industry direction analysis
    - external environment scenario

  procedure_keys:
    - greenfield-screening
    - brownfield-screening
relates_to:
  - skill: value-chain-linkage-analysis
    type: enables
  - skill: value-chain-driver-identification
    type: enables
  - skill: scenario-planning
    type: composes_with
  - skill: company-intelligence
    type: composes_with

---

## Context

The six-axis linkage analysis produces quantitative coefficients, but it
presupposes someone already decided *which* upstream/forward industries
matter and *which* external drivers move them. That discovery-and-document
step is a research discipline of its own: getting it wrong means a
well-estimated coefficient on the wrong link. This skill codifies that
qualitative research narrative so the driver registry (`industry_driver`)
and the scenario definitions entering the ADR-0066 Phase C structure
simulation are researched artifacts, not ad-hoc assumptions.

## When to Use

- First pass on a new target industry: establishing what its upstream and
  forward (demand-side) industries are and what will move them
- When an external-environment shift (rate, FX, commodity, regulation, or
  a new driver class) prompts a re-examination of industry direction

## Execution Steps

1. **Map the industry neighborhood**: identify the target's upstream
   (supplier) and forward (customer/demand-side) industries beyond the
   first tier where a second-order dependency materially affects demand —
   e.g. an equipment maker whose real demand driver sits two tiers up in
   its customers' end market
2. **Research each relevant industry's structure**: concentration and key
   players, capacity-expansion posture, technology transition vectors, and
   the regulatory agenda bearing on it — sources documented per claim
3. **Derive key-driver candidates**: from the structure research, name the
   small set of external variables that most determine the target
   industry's direction; register each in `industry_driver` (the seeded
   rate/fx/commodity/regulation set is extensible — a new driver is a new
   row, not a footnote inside an existing one)
4. **Define the scenario frame**: for each driver, state the plausible
   direction and magnitude of external-environment change (e.g. rate
   ±200bp, fuel-regulation severity early/late) so the discrete scenarios
   in `scenario-planning` and the `drv.*` assumption keys entering
   `python/structure_sim.py` are traceable to research, not invented
5. **Feed the quantitative layers**: hand the driver candidates to
   `value-chain-linkage-analysis` for coefficient estimation and to
   `value-chain-driver-identification` for per-stage sensitivity
   derivation — the narrative never supplies a number itself

## Output Format

- Forward/upstream industry research narrative: per-industry structure,
  key players, technology/regulatory trend notes with sources
- `industry_driver` registry candidate rows with rationale
- Scenario definitions (driver, direction, magnitude) formatted as
  `drv.*` assumption-key inputs for the structure simulation

## Related Skills

- `value-chain-linkage-analysis` — coefficient estimation consuming the
  driver candidates
- `value-chain-driver-identification` — per-stage sensitivity derivation
- `scenario-planning` — scenario framework and ADR-0066 Phase C
  structure-simulation extension
- `company-intelligence` — key-player research within each industry
