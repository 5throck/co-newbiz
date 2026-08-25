---
name: certification-roadmap
scope: co-newbiz
description: >
  Identifies certification requirements — separately from permits, since a
  certification lets you sell rather than operate — with the gap between
  current and required status, the options to close it, and a DAG of
  dependencies where certifications build on each other. Mandatory
  Screening-gate validator (`checklists/legal-regulatory-checklist.yaml` lr-02).

  Use when: "certification requirements", "certification gap analysis",
  "certification roadmap".
version: 1.0.0
last_reviewed: 2026-08-20
status: active
owner: certification-agent
prerequisites: none
metadata:
  procedure_keys:
    - brownfield-pre-fs
    - greenfield-pre-fs
  type: domain
  triggers:
    - certification requirements
    - certification gap analysis
    - certification roadmap
---

## Context

Kept strictly separate from `permit-pathway-mapping` throughout — a
certification lets you sell into a specific market or to a specific
customer base, issued by a certifying body rather than a government
agency, and its transferability on change of control is a distinct
question handled entirely by `certification-transferability`, never
inferred here.

## When to Use

- Screening gate, every project where the product/service requires
  market-access or customer-mandated certification
- Assessing what certification work is needed before a Green Field launch
  or before a Brown Field target can access a target market segment

## Execution Steps

1. **Identify required certifications** for the target market(s) and
   customer segment(s) — product safety, quality-management-system,
   industry-specific (e.g. automotive, medical, defense)
2. **Assess current status** against each requirement — held, in-process,
   not started, or (Brown Field) held by the target but transferability
   unconfirmed (hand off to `certification-transferability` — never assume)
3. **Map dependencies**: which certifications are prerequisites for others
   (e.g. a base quality-management certification often gates a
   sector-specific one)
4. **Identify options to close each gap**: timeline, cost, and whether the
   gap is closeable pre-close/pre-launch or only post-close/post-launch
5. **Flag a non-transferable mandatory certification load-bearing to the
   deal thesis** — this is one of the six binding Kill Criteria
   (`policies/group/neb-policy.md` §4), not a schedule risk to absorb

## Output Format

- Certification requirement list, current status, gap-closure options with
  timeline/cost, dependency map

## Related Skills

- `certification-transferability` — the change-of-control question this never infers on its own
- `permit-pathway-mapping` — the strictly separate permit side
- `customer-qualification` — the customer-mandated vendor-qualification counterpart
