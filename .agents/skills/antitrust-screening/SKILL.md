---
name: antitrust-screening
scope: co-newbiz
description: >
  Defines the relevant market and calculates HHI/HHI-delta for a Brown Field
  target, including common-ownership/common-control combinations, not only
  direct mergers of the target entities themselves (pilot 010 finding F-2).
  Confirms merger-control filing requirements across every applicable
  jurisdiction and the gun-jumping prohibition. First of the six mandatory
  Brown Field DD validators (`checklists/ma-special-topics-checklist.yaml`
  ma-01/ma-02/ma-03), evaluated first per meeting M5's ordering rule.

  Use when: "antitrust screening", "HHI calculation", "merger control
  filing", "gun-jumping", "relevant market definition".
version: 1.1.0
last_reviewed: 2026-08-23
status: active
owner: antitrust-agent
prerequisites: none
metadata:
  type: domain
  triggers:
    - antitrust screening
    - HHI calculation
    - merger control filing
    - gun-jumping
    - relevant market definition

  procedure_keys:
    - brownfield-dd
    - brownfield-fs
    - brownfield-screening
---

## Context

`checklists/ma-special-topics-checklist.yaml`'s meeting-M5 evaluation order
puts antitrust + HR integration first, customer retention + incentive
second, certification transferability last — a non-transferable
certification can strip the acquisition premium and must not be computed
against a valuation that already assumed it (this is why certification
comes last, not because it matters least). Pilot 010 finding F-2 is the
concrete reason common-ownership/common-control combinations are in scope:
a financial sponsor already controlling one competitor acquiring another
raises the same substantive concern as a direct merger, even though no two
target *entities* are combining.

## When to Use

- Brown Field Screening (preliminary HHI pre-screen, a rough filter) and
  Brown Field DD (the full six-way cross-check, this checklist)
- Any acquirer with existing portfolio holdings in the same or adjacent market

## Execution Steps

1. **Define the relevant market** — product and geographic — for the target
   and every entity the acquirer (or its controlling sponsor) already holds
   a stake or board influence in
2. **Calculate HHI and HHI-delta** including common-ownership/common-control
   combinations, not just direct entity mergers (ma-01) — this is the step
   pilot 010 showed teams miss if they screen only the two named parties
3. **Confirm merger-control filing requirements** for every applicable
   jurisdiction, not only the primary market (ma-02) — a multi-jurisdiction
   deal can trigger a filing obligation in a secondary market the deal team
   didn't think to check
4. **Acknowledge gun-jumping**: no integration action (shared pricing,
   combined sales planning, premature information exchange) before
   clearance is obtained (ma-03)
5. **Record findings** for the RAG regulatory/permit dimension and the
   `get_antitrust_assessment`-shaped output (HHI, remedy type, discharge status)

## Output Format

- Relevant-market definition, HHI/HHI-delta (including common-ownership
  combinations), filing-requirement matrix by jurisdiction, gun-jumping
  acknowledgment

## Related Skills

- `intra-group-transaction-compliance` — the sibling-entity counterpart (different applicability trigger)
- `brownfield-feasibility` — the DD process this validator is mandatory within
