---
name: incentive-clawback-assessment
scope: co-newbiz
description: >
  Reviews the incentive inventory (both prospective and already-granted) for
  clawback exposure on any contemplated relocation or restructuring —
  ADR-0030's design keeps acquisition and clawback on one record (`direction:
  prospective|granted`, `obligation_json`, `clawback_rule`), because
  receiving an incentive creates the very obligation that becomes the
  clawback risk. Mandatory Brown Field DD validator (ma-09).

  Use when: "incentive clawback", "clawback exposure", "relocation
  clawback risk", "incentive obligation".
version: 1.1.0
last_reviewed: 2026-08-23
status: active
owner: incentive-agent
prerequisites: none
metadata:
  type: domain
  triggers:
    - incentive clawback
    - clawback exposure
    - relocation clawback risk
    - incentive obligation

  procedure_keys:
    - brownfield-dd
---

## Context

ADR-0030's decision is the substantive point: acquisition (`prospective`)
and clawback (`granted`, already-received) are not separate concerns — they
are the same record viewed at two points in time, because the obligation
that comes with accepting an incentive is precisely what creates clawback
exposure later. As of Wave 5.1's DB build, the `incentive` table itself has
not yet been migrated — this skill's inventory work is real today
(spreadsheet/document-based); the schema described here (`direction`,
`obligation_json`, `clawback_rule`) is the ADR-0030 design target for when
that table lands, not a claim that it already exists.

## When to Use

- Brown Field DD — always, per the mandatory checklist item ma-09
- Any contemplated post-acquisition relocation, headcount restructuring, or
  facility closure that could trip an existing incentive's clawback clause
- Sourcing a new regional incentive (`regional-incentive-sourcing`) — record
  its obligation and clawback terms at acquisition time, not only when a
  restructuring later makes it relevant

## Execution Steps

1. **Inventory every incentive** the target (or an acquiring entity, for a
   Green Field decision) has received or is contemplating — tax abatement,
   cash grant, land subsidy, headcount-commitment-linked benefit
2. **Record the obligation for each**: the condition attached (headcount
   minimum, operating-years minimum, facility-location commitment) and its
   term
3. **Record the clawback rule**: what triggers repayment, the repayment
   formula (full/prorated), and the clawback window
4. **Cross-reference against any contemplated relocation or restructuring**:
   for each planned action, check every incentive's obligation for a
   potential trigger — do not assume only the most recent incentive is at risk
5. **Quantify clawback exposure** as a contingent liability, feeding
   `debt-and-contingent-liability-simulation`'s Monte Carlo integration
   rather than staying a narrative note

## Output Format

- Incentive inventory (direction, obligation, clawback rule, exposure
  amount) per incentive, with a total clawback-exposure estimate for any
  contemplated restructuring scenario

## Related Skills

- `regional-incentive-sourcing` — the acquisition side of the same record
- `debt-and-contingent-liability-simulation` — where clawback exposure becomes a modeled contingent liability
- `pmi-planning` — the integration/restructuring decisions this assessment should inform, not follow
