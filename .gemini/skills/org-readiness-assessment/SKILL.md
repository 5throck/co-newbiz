---
name: org-readiness-assessment
scope: co-newbiz
description: >
  Diagnoses an organization's capacity to absorb and sustain a Brown Field
  integration or Green Field ramp-up. Produces readiness scores, capability
  gap analysis, and integration/change-management cost estimates that feed
  the financial model and compensation-harmonization analysis.

  Use when: "organizational readiness", "change readiness", "change capacity",
  "readiness assessment", "transformation readiness".
version: 1.1.0
last_reviewed: 2026-08-23
status: active
owner: hr-integration-agent
prerequisites: none
metadata:
  type: domain
  triggers:
    - organizational readiness
    - change readiness
    - change capacity
    - readiness assessment
    - transformation readiness

  procedure_keys:
    - brownfield-dd
    - entity-establishment-execution
---

## Context

Reused from `Projects/co-consult/skills/org-readiness-assessment`. In co-newbiz
this runs alongside `compensation-harmonization-analysis` and
`management-incentive-review` during Brown Field DD, and alongside
`talent-pipeline-planning` during Green Field FS — the readiness-cost output
here is a mandatory input to `valuation-agent`'s financial model (design §4-6).

## When to Use

- Brown Field integration (PMI) planning, before or alongside `pmi-planning`
- Green Field ramp-up planning where new-hire absorption capacity matters
- Before financial modeling that must account for integration/change costs
- When a Kill Criteria candidate needs a quantified resistance/delay estimate

## Execution Steps

1. **Define Change Scope**: clarify the nature and scale of the proposed
   integration or ramp-up

2. **Leadership Alignment Assessment**:
   - Are senior leaders aligned on the need for change? (Score 1-5)
   - Is there a visible, committed sponsor? (Score 1-5)
   - Are middle managers equipped to lead the change? (Score 1-5)

3. **Cultural Readiness Assessment**:
   - Does the organizational culture support the proposed change? (Score 1-5)
   - Are there past integration failures creating skepticism? (Yes/No + context)
   - Dominant cultural values and their alignment with the proposed change

4. **Capability Gap Analysis**:
   - Skills/competencies required by the change
   - Current capability level (Gap = Required − Current)
   - Training or hiring needed

5. **Cost Estimation** (feeds `assumption(kind='derived')` for the financial model):
   - Training and upskilling cost range
   - Change-agent / integration-management resource cost
   - Communication campaign budget
   - Schedule delay buffer (weeks × team cost, given resistance probability)
   - **Total integration/change-management cost range** — the mandatory output

6. **Overall Readiness Score**: weighted average across dimensions.
   Low: < 3.0 · Medium: 3.0–3.9 · High: ≥ 4.0

## Output Format

- **Readiness Scorecard**: Dimension, Score (1-5), Key Evidence, Risk Flag
- **Capability Gap Table**: Competency, Required Level, Current Level, Gap, Recommended Action
- **Integration Cost Estimate**: Category, Low Estimate, High Estimate, Assumptions
- **Overall Readiness Summary**: Score, Interpretation, Top 3 Risks, Recommended Approach

## Related Skills

- `pmi-planning` — Brown Field integration planning this feeds
- `talent-pipeline-planning` — Green Field counterpart
- `compensation-harmonization-analysis` — the upward-bias comp finding this
  assessment's cost estimate should be consistent with
- `debt-and-contingent-liability-simulation` — where readiness risk becomes a
  quantified contingent-liability line
