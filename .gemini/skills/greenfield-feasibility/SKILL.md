---
name: greenfield-feasibility
scope: co-newbiz
description: >
  Runs the Green Field (new-establishment) Screening through Pre-FS feasibility
  work per `procedures/_shared/greenfield-screening/schema.yaml` and
  `procedures/_shared/greenfield-pre-fs/schema.yaml` and
  `checklists/greenfield-feasibility-checklist.yaml` — infrastructure
  minimums checked before scoring, not merely penalized (the Kill Criteria
  distinction).

  Use when: "green field feasibility", "new plant feasibility",
  "new establishment review", "greenfield screening".
version: 1.1.0
last_reviewed: 2026-08-23
status: active
owner: greenfield-agent
prerequisites: none
metadata:
  type: domain
  triggers:
    - green field feasibility
    - new plant feasibility
    - new establishment review
    - greenfield screening

  procedure_keys:
    - greenfield-pre-fs
relates_to:
  - skill: wacc-input-session
    type: follows
  - skill: site-infrastructure-assessment
    type: composes_with
  - skill: regional-incentive-sourcing
    type: composes_with
  - skill: permit-pathway-mapping
    type: composes_with
  - skill: stage-gate-governance
    type: composes_with
  - skill: community-partnership-planning
    type: composes_with
  - skill: talent-pipeline-planning
    type: composes_with

---

## Context

The authoritative step sequence lives in the shared procedure files this
skill executes, never restates. `checklists/greenfield-feasibility-checklist.yaml`
encodes the hard rule from `policies/group/neb-policy.md` §4's first Kill
Criterion: a site failing mandatory infrastructure minimums (wastewater
capacity checked *before* power, since its absence blocks expansion
outright) is **excluded from scoring, not merely penalized** — this is a
gate, not a weighting adjustment.

## When to Use

- A new-establishment (Green Field) proposal reaches Screening or Pre-FS
- Deciding whether a candidate site is even eligible to be scored

## Execution Steps

1. **Screening**: run `procedures/_shared/greenfield-screening/schema.yaml`'s
   steps as written — identify candidate sites, apply the mandatory
   infrastructure-minimum filter first (see `site-infrastructure-assessment`),
   exclude failures before any scoring begins
2. **Pre-FS**: run `procedures/_shared/greenfield-pre-fs/schema.yaml`'s steps
   for the surviving candidates — deeper feasibility on the shortlist only
3. **Check the Kill Criterion**: if zero candidates clear the infrastructure
   minimums, this is a binding halt (`stage-gate-governance`), not a "weak
   result" to carry forward anyway
4. **Complete `checklists/greenfield-feasibility-checklist.yaml`** item by
   item as evidence accumulates, not retroactively at the gate
5. **Hand off** to `site-infrastructure-assessment` (infrastructure detail),
   `regional-incentive-sourcing` (incentive NPV), `talent-pipeline-planning`,
   and `community-partnership-planning` for the specialist inputs each gate needs

## Output Format

- Screening/Pre-FS deliverables per the shared procedures' `output_type` fields
- Completed feasibility checklist

## Related Skills

- `site-infrastructure-assessment`, `regional-incentive-sourcing`,
  `talent-pipeline-planning`, `community-partnership-planning` — the specialist inputs
- `stage-gate-governance` — the Kill Criterion this feeds
