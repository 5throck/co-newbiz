---
name: regulatory-screening
scope: co-newbiz
description: >
  Runs the Screening-gate regulatory checks: confirms the applicable region
  profile(s) exist and are validated for every touched jurisdiction, checks
  foreign-investment-screening triggers against the region profile's
  mandatory filing triggers, and runs sanctions/anti-corruption screening
  against ALL counterparties, not just the primary target
  (`checklists/legal-regulatory-checklist.yaml` lr-03/04/05).

  Use when: "regulatory screening", "foreign investment screening trigger",
  "sanctions screening all counterparties", "region profile confirmation".
version: 1.0.0
last_reviewed: 2026-08-20
status: active
owner: legal-counsel
prerequisites:
  - region-profile-application
metadata:
  type: domain
  triggers:
    - regulatory screening
    - foreign investment screening trigger
    - sanctions screening all counterparties
    - region profile confirmation
---

## Context

lr-05's scope is explicit and easy to under-deliver: "all counterparties,
not just the primary target" — a Brown Field deal's partner, a JV
co-venturer, or a significant customer/supplier with change-of-control
exposure all need the same sanctions/anti-corruption screen the target
itself gets, since exposure through any of them transfers into the deal.

## When to Use

- Screening gate, every project, mandatory
- Any new counterparty (partner, JV co-venturer, significant customer/
  supplier) is added to a project after initial screening

## Execution Steps

1. **Confirm region profile presence and validation** for every touched
   jurisdiction (`region-profile-application`, `_validate.ts` pass) — lr-03
2. **Check foreign-investment-screening triggers** against the region
   profile's `mandatory_filing_triggers` field — lr-04
3. **Enumerate all counterparties**: target, partners, JV co-venturers,
   any counterparty with material deal exposure — not just the acquirer/
   target pair
4. **Run sanctions and anti-corruption screening on every counterparty**
   from step 3 — lr-05, no exceptions for a counterparty that seems
   peripheral
5. **Record findings per jurisdiction and counterparty** feeding the RAG
   regulatory dimension

## Output Format

- Region-profile confirmation status per jurisdiction, foreign-investment
  trigger check result, sanctions/anti-corruption screen result per counterparty

## Related Skills

- `region-profile-application` — the source data for triggers
- `partner-due-diligence` — the parallel counterparty-compliance check for partnership candidates specifically
- `legal-risk-register` — where findings from this screen land
