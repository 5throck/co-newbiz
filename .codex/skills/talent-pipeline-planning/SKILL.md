---
name: talent-pipeline-planning
scope: co-newbiz
description: >
  Assesses local labor-market capacity for a Green Field site — headcount
  availability by skill category, wage benchmarks, and ramp-up timeline —
  the Green Field counterpart to `org-readiness-assessment`'s Brown Field
  integration-capacity work.

  Use when: "talent pipeline", "labor market assessment", "hiring ramp-up
  plan", "workforce availability".
version: 1.1.0
last_reviewed: 2026-08-23
status: active
owner: hr-integration-agent
prerequisites: none
metadata:
  type: domain
  triggers:
    - talent pipeline
    - labor market assessment
    - hiring ramp-up plan
    - workforce availability

  procedure_keys:
    - greenfield-dd
    - greenfield-execution-baseline
relates_to:
  - skill: community-partnership-planning
    type: follows
  - skill: greenfield-feasibility
    type: composes_with
  - skill: regional-incentive-sourcing
    type: composes_with
  - skill: site-infrastructure-assessment
    type: composes_with

---

## Context

Where `org-readiness-assessment` measures an *existing* organization's
capacity to absorb change (Brown Field integration or Green Field
ramp-up of an already-hired team), this skill measures the *external*
labor market's capacity to supply the new site's headcount in the first
place — a distinct question that has to be answered before a Green Field
site is genuinely feasible, not after ground has broken.

## When to Use

- A Green Field site is a serious candidate and needs a labor-supply check
  alongside `site-infrastructure-assessment`
- Region-lead labor review is required by a Brown Field DD checklist item

## Execution Steps

1. **Define the required headcount by skill category** (production,
   technical, management) and ramp-up schedule from the operating plan
2. **Assess local labor-market supply**: available workforce by skill
   category in the candidate region, cross-referenced against
   `region-profiles/*.yaml` labor-market fields where available
3. **Benchmark wages**: local wage levels by skill category, compared to
   the project's assumed labor cost — a plan built on an unrealistic wage
   assumption understates operating cost from day one
4. **Assess competing local demand**: other employers drawing from the same
   labor pool (existing industrial parks, competing new entrants) —
   headcount availability on paper can still mean a slow, expensive ramp-up
   in practice if competition for the same skill category is intense
5. **Produce a ramp-up timeline with confidence bands**, not a single
   optimistic date — feeds the financial model's opex timing

## Output Format

- Labor-supply assessment: headcount availability by skill category, wage
  benchmark, competing-demand note, ramp-up timeline with confidence bands

## Related Skills

- `org-readiness-assessment` — the internal-capacity counterpart
- `site-infrastructure-assessment` — the parallel site-screening work
- `community-partnership-planning` — local workforce-development partnerships
