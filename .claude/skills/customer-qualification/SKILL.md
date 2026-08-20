---
name: customer-qualification
scope: co-newbiz
description: >
  Assesses customer-mandated vendor-registration and production-approval
  requirements (e.g. PPAP/FAI in manufacturing supply chains) — distinct
  from `certification-roadmap`'s regulatory/market-access certifications,
  since a customer-specific qualification requirement can exist even where
  no external certifying body is involved.

  Use when: "customer qualification", "vendor registration", "PPAP",
  "first article inspection", "customer-mandated approval".
version: 1.0.0
last_reviewed: 2026-08-20
status: active
owner: commercial-dd-agent
prerequisites: none
metadata:
  type: domain
  triggers:
    - customer qualification
    - vendor registration
    - PPAP
    - first article inspection
    - customer-mandated approval
---

## Context

Where `certification-roadmap` covers requirements imposed by a certifying
body for market access, this skill covers requirements imposed directly by
a specific customer as a condition of doing business with them —
Production Part Approval Process (PPAP), First Article Inspection (FAI),
vendor-registration audits, and similar customer-specific qualification
gates common in manufacturing supply chains. A target can be fully
certified for its market and still lose a major customer relationship on
change of control if the new entity hasn't independently re-qualified.

## When to Use

- Brown Field DD, for any target whose customer base includes
  qualification-gated relationships
- Green Field, when planning to enter a customer base with known
  qualification requirements

## Execution Steps

1. **Identify customers with formal qualification/vendor-registration
   requirements** — not every customer relationship has one; focus on
   those that do
2. **Confirm whether the qualification is entity-specific or
   facility-specific** — a change of control (new legal entity) may
   require re-qualification even if the physical facility and processes
   are unchanged
3. **Assess re-qualification timeline and risk** for each affected
   customer relationship — cross-reference against `customer-attrition-risk`'s
   CoC-clause scan rather than duplicating that analysis
4. **Flag any customer relationship where re-qualification failure would
   be material** — feeds the revenue-at-risk estimate alongside
   `customer-attrition-risk`'s CoC findings

## Output Format

- Customer qualification inventory: customer, requirement type, entity vs.
  facility scope, re-qualification risk assessment

## Related Skills

- `certification-roadmap` — the parallel regulatory/market-access certification track
- `customer-attrition-risk` — the CoC-clause counterpart this cross-references
