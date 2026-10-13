---
name: permit-pathway-mapping
scope: co-newbiz
description: >
  Maps the applicable permit pathway as a DAG with critical-path lead time
  — a permit lets you operate, distinct from a certification which lets you
  sell (design's non-negotiable boundary #5: different issuers, procedures,
  critical paths, never conflated). Mandatory Screening-gate validator
  (`checklists/legal-regulatory-checklist.yaml` lr-01).

  Use when: "permit pathway", "permit DAG", "permit critical path",
  "operating permit requirements".
version: 1.1.0
last_reviewed: 2026-08-23
status: active
owner: legal-counsel
prerequisites: none
metadata:
  type: domain
  triggers:
    - permit pathway
    - permit DAG
    - permit critical path
    - operating permit requirements

  procedure_keys:
    - brownfield-pre-fs
    - business-unit-establishment-execution
    - greenfield-pre-fs
relates_to:
  - skill: certification-roadmap
    type: follows
  - skill: wacc-input-session
    type: composes_with
  - skill: stage-gate-governance
    type: composes_with
  - skill: site-infrastructure-assessment
    type: composes_with

---

## Context

A permit and a certification are managed as strictly separate artifacts
throughout this system — different issuers (government agency vs.
certifying body), different procedures, different critical paths, and
critically, different transferability rules on change of control (see
`certification-roadmap`/`certification-transferability` for the
certification side). This skill covers only the permit side: the
regulatory approvals required to operate the facility or business at all.

## When to Use

- Screening gate, every Green Field and Brown Field project
- Assessing whether a permit-related delay is on the critical path to launch/close

## Execution Steps

1. **Enumerate every required permit** for the project's jurisdiction,
   industry, and facility type — environmental, construction/occupancy,
   operating license, sector-specific approvals
2. **Map dependencies as a DAG**: which permits are prerequisites for
   others, which can run in parallel — a linear list understates real
   sequencing constraints
3. **Estimate lead time per permit** and identify the critical path — the
   longest dependency chain, which sets the earliest possible operational date
4. **Flag any permit whose issuance is genuinely uncertain** (not just
   slow) — distinct from a lead-time risk, an uncertain permit is closer to
   Kill-Criteria territory if the business cannot proceed without it
5. **Feed the critical-path timeline** into the Green Field/Brown Field
   feasibility timeline and `community-partnership-planning`'s
   local-government touchpoint coordination

## Output Format

- Permit DAG with dependencies, per-permit lead-time estimate, critical
  path, uncertain-permit flags

## Related Skills

- `certification-roadmap`, `certification-transferability` — the strictly separate certification side
- `community-partnership-planning` — coordination on local-government touchpoints
- `regulatory-screening` — the broader Screening-gate check this fits inside
