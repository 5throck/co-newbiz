---
name: site-visit-protocol
scope: co-newbiz
description: >
  Conducts the technical DD site visit with a pre-visit document request
  list and an on-site observation checklist, capturing evidence (photo,
  measurement, log) for every observation — an observation without
  captured evidence does not survive IC scrutiny
  (`checklists/technical-dd-checklist.yaml` tdd-01/02).

  Use when: "site visit protocol", "pre-visit document request",
  "on-site evidence capture", "site visit checklist".
version: 1.1.0
last_reviewed: 2026-08-23
status: active
owner: technical-dd-agent
prerequisites: none
metadata:
  type: process
  triggers:
    - site visit protocol
    - pre-visit document request
    - on-site evidence capture
    - site visit checklist

  procedure_keys:
    - greenfield-dd
relates_to:
  - skill: talent-pipeline-planning
    type: follows
  - skill: stage-gate-governance
    type: composes_with
  - skill: technical-due-diligence
    type: composes_with

---

## Context

tdd-02's rule is exacting on purpose: "observations without captured
evidence do not survive IC scrutiny." A site-visit summary that says
"equipment appeared well-maintained" without a photo, measurement, or
maintenance log to back it is not evidence an IC reviewer can rely on — it
is an impression, and the checklist treats it as such.

## When to Use

- Every Brown Field technical DD
- Green Field, when a comparable-facility benchmark visit is warranted

## Execution Steps

1. **Build the pre-visit document request list**: equipment
   maintenance logs, EHS records, production data, capex history — sent
   ahead of the visit so gaps in what's provided are visible before arrival
2. **Build the on-site observation checklist**: what specifically needs to
   be physically inspected (equipment condition, bottleneck processes,
   safety practices, facility condition) — derived from
   `technical-due-diligence`'s tdd items, not improvised on-site
3. **Capture evidence for every observation**: photo, measurement, or log
   reference — an observation with no evidence attached is recorded as
   unconfirmed, not silently upgraded to a finding
4. **Cross-check documents against physical observation** during the visit
   itself where possible (does the stated equipment age match visible wear?)
5. **Compile the evidence package** immediately after the visit — evidence
   collected but not organized promptly tends to lose its traceability to
   the specific observation it supports

## Output Format

- Pre-visit document request list, on-site observation checklist (completed),
  evidence package indexed to specific observations

## Related Skills

- `technical-due-diligence` — the broader DD process this visit feeds
- `expert-interview` — a complementary evidence-gathering method, often run alongside a site visit
