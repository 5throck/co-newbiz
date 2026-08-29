---
name: compensation-harmonization-analysis
scope: co-newbiz
description: >
  Benchmarks employee compensation at job-family/grade level (`comp_benchmark`,
  k>=3 aggregate only — never individual rows) and models post-integration
  harmonization with an explicit upward bias in BOTH comparison directions
  (ADR-0027): whichever side is higher sets the floor for that job family/
  grade, because Korean labor law generally prevents lowering compensation
  post-integration regardless of direction. Never modeled as a savings line.

  Use when: "compensation harmonization", "comp benchmark", "upward bias",
  "post-merger pay equalization".
version: 1.0.0
last_reviewed: 2026-08-20
status: active
owner: hr-integration-agent
prerequisites: none
metadata:
  procedure_keys:
    - pmi-integration-execution
  type: domain
  triggers:
    - compensation harmonization
    - comp benchmark
    - upward bias
    - post-merger pay equalization
relates_to:
  - skill: stage-gate-governance
    type: follows

---

## Context

ADR-0027's verification rule is exact: both a target-higher input case and
an acquirer-higher input case must each raise the modeled labor cost — if
only one direction rises, the unfavorable-change-restriction logic is not
actually implemented, it's just an average with extra steps. This is not a
conservative-modeling preference; it reflects a real Korean labor-law
constraint (Korean Labor Standards Act §94, unfavorable-change-to-employment-rules
restrictions) that makes a naive average legally wrong, not merely imprecise.
`checklists/brownfield-feasibility-checklist.yaml`'s bf-05 states the same
rule: "never modeled as a savings line."

## When to Use

- Brown Field DD — always, per the mandatory checklist item ma-06
- Any post-acquisition integration where target and acquirer compensation
  levels differ across overlapping job families/grades

## Execution Steps

1. **Benchmark compensation at job-family/grade level** on both sides,
   aggregate only (`comp_benchmark`, k≥3 headcount per row — the schema
   itself rejects a smaller aggregate, since a 1-2 person row re-identifies
   individuals even without a name column)
2. **Compare job-family-by-job-family, grade-by-grade** — not a single
   company-wide average, which would hide harmonization cost in
   over-represented families
3. **Apply the upward-bias rule in both directions**: where target > acquirer
   for a family/grade, target sets the floor; where acquirer > target, acquirer
   sets the floor — run both comparison directions and confirm cost rises in
   each, per ADR-0027's verification requirement
4. **Compute the harmonization cost** as a day-one-plus-ongoing labor-cost
   increase, feeding `org-readiness-assessment`'s integration-cost estimate
   directly rather than as a separate, disconnected line
5. **Never present this as savings** — a scenario where harmonization
   nets to a cost decrease indicates a modeling error, not a favorable finding

## Output Format

- Job-family/grade compensation comparison table (both directions),
  harmonization cost estimate, confirmation that both directions raised cost

## Related Skills

- `org-readiness-assessment` — the integration-cost model this feeds
- `management-incentive-review` — the executive-level counterpart (different governance)
