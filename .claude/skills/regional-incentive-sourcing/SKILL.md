---
name: regional-incentive-sourcing
scope: co-newbiz
description: >
  Identifies regional investment-incentive packages (tax abatement, cash
  grants, land-price subsidy) and converts each to NPV on the same
  comparison table as infrastructure capex and logistics cost — never a
  separate addendum. Absorbs site-comparison (design §9.2 merge — the
  incentive-NPV conversion IS the comparison, not a separate step).

  Use when: "regional incentive", "investment incentive package",
  "site comparison", "incentive NPV", "compare candidate sites".
version: 1.1.0
last_reviewed: 2026-08-23
status: active
owner: greenfield-agent
prerequisites:
  - site-infrastructure-assessment
metadata:
  type: domain
  triggers:
    - regional incentive
    - investment incentive package
    - site comparison
    - incentive NPV
    - compare candidate sites

  procedure_keys:
    - greenfield-pre-fs
    - greenfield-screening
    - deal-structuring
relates_to:
  - skill: permit-pathway-mapping
    type: follows
  - skill: stage-gate-governance
    type: follows
  - skill: wacc-input-session
    type: composes_with
  - skill: stage-gate-governance
    type: composes_with
  - skill: strategic-fit-screening
    type: composes_with
  - skill: value-chain-linkage-analysis
    type: composes_with
  - skill: community-partnership-planning
    type: composes_with
  - skill: talent-pipeline-planning
    type: composes_with

---

## Context

`checklists/site-selection-checklist.yaml` item ss-05 states the rule
directly: "regional incentive package identified and converted to NPV, on
the same comparison table as infrastructure capex and logistics cost — not
listed separately." A site comparison that lists incentives as a footnote
rather than folding them into the same NPV-comparable table understates or
overstates the true cost difference between candidates.

## When to Use

- Comparing surviving candidate sites (post-`site-infrastructure-assessment`)
- A region-specific incentive program needs to be identified and quantified

## Execution Steps

1. **Identify applicable incentive programs per candidate region**:
   tax abatement/holiday terms, cash grants, land-price subsidy, cross-
   referenced against `region-profiles/*.yaml` where a profile exists
2. **Convert each to NPV**: apply the project's discount rate to the
   incentive's actual cash-flow timing (a grant paid up front is worth more
   than a tax holiday of equivalent nominal value spread over years) —
   record as an `assumption(kind='derived')` with the conversion method shown
3. **Build the single comparison table**: infrastructure capex + logistics
   cost + incentive NPV, per candidate site, on one table — never a
   separate incentive addendum a reader has to reconcile manually
4. **Confirm sourcing**: every incentive figure carries `source`/`as_of`/
   `verified_on` per the region-profile sourcing discipline — an incentive
   program's terms can lapse or change, so a stale figure is a real risk,
   not a formality
5. **Hand the ranked comparison to `greenfield-feasibility`** for the
   feasibility gate decision

## Output Format

- Per-site comparison table (infrastructure capex, logistics cost,
  incentive NPV, total), sourced

## Related Skills

- `site-infrastructure-assessment` — the prerequisite candidate shortlist
- `region-profile-application` — the region-profile data this draws on
- `greenfield-feasibility` — the gate this comparison feeds
