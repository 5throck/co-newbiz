---
name: customer-attrition-risk
scope: co-newbiz
description: >
  Scans change-of-control clauses across customer AND supplier contracts,
  debt covenants, and executive compensation, and assesses post-acquisition
  attrition risk including a retained seller who continues as an ongoing
  supplier post-close — the same risk category as a customer contract, not
  a separate one (pilot 002 finding F-2). Mandatory Brown Field DD validator
  (`checklists/ma-special-topics-checklist.yaml` ma-07/ma-08).

  Use when: "customer attrition risk", "change of control clause",
  "customer concentration risk", "retained seller as supplier".
version: 1.1.0
last_reviewed: 2026-08-23
status: active
owner: customer-retention-agent
prerequisites: none
metadata:
  type: domain
  triggers:
    - customer attrition risk
    - change of control clause
    - customer concentration risk
    - retained seller as supplier

  procedure_keys:
    - brownfield-dd
relates_to:
  - skill: incentive-clawback-assessment
    type: follows

---

## Context

Pilot 002 finding F-2 is the reason this skill's scope is wider than "scan
customer contracts": a seller who retains a commercial relationship with the
target post-close (as an ongoing supplier, licensor, or service provider) is
exposed to the exact same change-of-control-triggered attrition risk as any
external customer — a DD scope that stops at customer-side contracts misses
this. CoC clauses also appear in debt covenants and executive compensation
(golden-parachute triggers), scanned together, not as three separate
work-streams that might miss cross-references.

## When to Use

- Brown Field DD — always, per the mandatory checklist item ma-07/ma-08
- Any Brown Field target where the seller retains a post-close commercial relationship

## Execution Steps

1. **Scan customer contracts** for change-of-control termination/renegotiation clauses
2. **Scan supplier contracts** the same way, including a retained-seller
   supply arrangement — treat it as an equal-priority finding, not an
   afterthought appended to the customer-contract scan
3. **Scan debt covenants and executive compensation** for CoC triggers
   (cross-reference with `debt-and-contingent-liability-simulation` and
   `management-incentive-review` rather than duplicating their analysis)
4. **Assess concentration and competitive-overlap risk** for post-acquisition
   attrition — which customers/suppliers are concentrated enough that even
   a moderate attrition probability is material to the deal thesis
5. **Quantify, don't just list**: attach a probability-weighted revenue-at-risk
   estimate per material CoC-affected relationship, feeding the financial model
   and the RAG risk dimension

## Output Format

- CoC-clause inventory (customer, supplier including retained seller, debt,
  compensation), concentration/attrition risk assessment with
  probability-weighted revenue-at-risk

## Related Skills

- `debt-and-contingent-liability-simulation`, `management-incentive-review` — the CoC-clause cross-references
- `brownfield-feasibility` — the DD process this validator is mandatory within
