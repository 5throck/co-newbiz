---
name: site-infrastructure-assessment
scope: co-newbiz
description: >
  Assesses candidate Green Field sites against mandatory infrastructure
  minimums (wastewater, power, industrial water, logistics access) per
  `checklists/site-selection-checklist.yaml` — wastewater checked before
  power, since its absence blocks expansion outright regardless of power
  availability.

  Use when: "site infrastructure", "wastewater capacity", "power supply
  capacity", "logistics access assessment", "site selection".
version: 1.1.0
last_reviewed: 2026-08-23
status: active
owner: greenfield-agent
prerequisites: none
metadata:
  type: domain
  triggers:
    - site infrastructure
    - wastewater capacity
    - power supply capacity
    - logistics access assessment
    - site selection

  procedure_keys:
    - greenfield-fs
    - greenfield-pre-fs
    - greenfield-screening
relates_to:
  - skill: investment-feasibility-modeling
    type: follows
  - skill: regional-incentive-sourcing
    type: follows

---

## Context

`checklists/site-selection-checklist.yaml`'s item order is deliberate, not
alphabetical: wastewater/effluent treatment capacity (ss-01) is checked
**before** power (ss-02), because its absence blocks expansion outright in
a way power alone doesn't — a site with abundant power but no wastewater
capacity is not a marginal candidate, it fails the Kill Criterion the same
way a site with neither would.

## When to Use

- Any Green Field candidate site needs infrastructure screening
- Confirming which candidates survive the mandatory-minimums filter before
  `regional-incentive-sourcing` or deeper feasibility work begins

## Execution Steps

1. **Wastewater/effluent treatment capacity** — confirm for every candidate
   site first; a failure here excludes the site from further scoring
   entirely, it is not merely penalized (checklist ss-01, and the
   corresponding Kill Criterion in `policies/group/neb-policy.md` §4)
2. **Power supply capacity, connection lead time, and outage history**
   (ss-02) — for sites that survive step 1
3. **Industrial water supply capacity and quality** (ss-03)
4. **Road/logistics access** — heavy-vehicle entry and port/rail proximity
   (ss-04)
5. **Exclude, don't penalize**: any site failing a mandatory minimum is
   removed from the candidate set entirely before scoring begins on the
   survivors — do not carry a failing site forward with a lower score
6. **Hand the surviving shortlist to `regional-incentive-sourcing`** for
   the incentive-NPV comparison, which sits on the same table as
   infrastructure capex and logistics cost, never a separate addendum

## Output Format

- Per-candidate infrastructure screen result (pass/exclude per item,
  overall pass/fail)
- Surviving candidate shortlist handed to downstream feasibility skills

## Related Skills

- `greenfield-feasibility` — the broader Screening/Pre-FS process this feeds
- `regional-incentive-sourcing` — the next step for surviving candidates
- `stage-gate-governance` — the zero-candidates Kill Criterion
