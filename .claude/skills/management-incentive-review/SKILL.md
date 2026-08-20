---
name: management-incentive-review
scope: co-newbiz
description: >
  Records executive compensation change-of-control triggers, golden-parachute
  payout estimates, and accelerated-vesting terms against `management_package`
  (role-based, never named individuals — design §4-9-1(b) PII discipline),
  and confirms non-compete enforceability per jurisdiction before relying on
  it for key-person retention. Mandatory Brown Field DD validator (ma-04);
  non-compete check is recommended, not mandatory (ma-05).

  Use when: "executive compensation review", "golden parachute",
  "change of control triggers", "key-person retention", "non-compete
  enforceability".
version: 1.0.0
last_reviewed: 2026-08-20
status: active
owner: incentive-agent
prerequisites: none
metadata:
  type: domain
  triggers:
    - executive compensation review
    - golden parachute
    - change of control triggers
    - key-person retention
    - non-compete enforceability
---

## Context

`checklists/brownfield-feasibility-checklist.yaml`'s bf-04 already requires
golden-parachute/CoC-trigger compensation be modeled as a day-one cash
outflow, never as a soft assumption. This skill is the review that produces
that figure. Identity discipline applies throughout: `management_package`
stores role/title-level data, never named individuals — `docs/security-model.md`
§7 item 6's byte-based surrogate-key CHECK is the DB-level enforcement of
this, not a documentation convention this skill can relax.

## When to Use

- Brown Field DD — always, per the mandatory checklist item ma-04
- Assessing key-person retention risk where a non-compete is load-bearing to the deal thesis

## Execution Steps

1. **Inventory each executive's compensation package by role** (never by
   name): base, bonus, equity, CoC triggers, golden-parachute terms,
   accelerated-vesting provisions
2. **Estimate the golden-parachute payout** for each CoC-triggering role —
   this is a day-one cash outflow in the financial model, not a footnote
   (checklist bf-04's explicit rule)
3. **Record accelerated-vesting exposure**: unvested equity that vests
   immediately on CoC, valued at the deal price
4. **Confirm non-compete enforceability per jurisdiction** (recommended,
   not mandatory — ma-05) before relying on it for key-person retention
   planning; an unenforceable non-compete is not a retention lever at all,
   regardless of what the contract says
5. **Feed the retention-risk finding** into `pmi-planning` and the deal
   thesis's key-person-dependency assessment

## Output Format

- Executive compensation/CoC-trigger inventory by role (day-one cash
  outflow estimate), non-compete enforceability finding

## Related Skills

- `compensation-harmonization-analysis` — the broader (non-executive) workforce compensation counterpart
- `customer-attrition-risk` — the parallel CoC-clause cross-reference
- `pmi-planning` — where retention risk feeds integration planning
