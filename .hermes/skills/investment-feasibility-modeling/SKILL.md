---
name: investment-feasibility-modeling
scope: co-newbiz
description: >
  Assembles the confirmed WACC/hurdle IRR, normalized EBITDA, growth
  projection, and site/incentive costs into the project's investment
  feasibility model (NPV, IRR, payback) — the synthesis point for
  `wacc-input-session`, `quality-of-earnings`, `growth-projection-modeling`,
  and `regional-incentive-sourcing`'s outputs.

  Use when: "investment feasibility model", "NPV IRR calculation",
  "feasibility financial model".
version: 1.2.0
last_reviewed: 2026-09-22
status: active
owner: valuation-agent
prerequisites:
  - wacc-input-session
  - growth-projection-modeling
metadata:
  type: domain
  triggers:
    - investment feasibility model
    - NPV IRR calculation
    - feasibility financial model

  procedure_keys:
    - brownfield-fs
    - brownfield-fs-comparative
    - greenfield-fs
    - greenfield-capability-assessment
relates_to:
  - skill: monte-carlo-simulation
    type: follows
  - skill: investment-vehicle-structuring
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
  - skill: debt-and-contingent-liability-simulation
    type: composes_with
  - skill: financing-plan-review
    type: composes_with
  - skill: wacc-input-session
    type: composes_with

---

## Context

This is a synthesis skill, like `pmi-planning` — it does not re-derive its
inputs, it assembles already-produced, already-validated figures into one
model. Using an unconfirmed WACC, an un-normalized EBITDA, or an
un-anchored growth projection here defeats the point of each upstream
skill's own discipline.

## When to Use

- Building or updating the core financial feasibility model for one analysis
  subject — the project (greenfield) or each shortlisted target of a
  brownfield project (flow.spec S8 `subjectScope`, ADR-0143)
- FS gate, where a complete model is a mandatory deliverable

## Execution Steps

1. **Pull confirmed inputs**: WACC/hurdle IRR (`wacc-input-session`,
   `kind='user'`), normalized EBITDA (`quality-of-earnings`, Brown Field
   only), anchored growth projection (`growth-projection-modeling`),
   site/incentive costs (`regional-incentive-sourcing`, Green Field only)
2. **Build the cash-flow projection** from these inputs over the
   modeling horizon
3. **Compute NPV, IRR, and payback period** at the confirmed discount rate
4. **Sensitize the result** against the key uncertain inputs (feeds
   `scenario-planning` and `monte-carlo-simulation` rather than presenting
   a single point estimate as if it were certain)
5. **Confirm the model reflects any Kill-Criteria-adjacent finding**: a
   growth projection that required risk-officer sign-off, a covenant-breach
   result from `debt-and-contingent-liability-simulation` — the model
   should not silently use a rosier assumption than what actually cleared review

## Output Format

- Feasibility model: NPV, IRR, payback, with every input traceable back to
  its confirming skill

## Related Skills

- `wacc-input-session`, `quality-of-earnings`, `growth-projection-modeling` — the confirmed inputs
- `scenario-planning`, `monte-carlo-simulation` — the uncertainty analysis this model feeds
