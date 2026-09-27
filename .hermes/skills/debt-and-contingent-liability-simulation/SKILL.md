---
name: debt-and-contingent-liability-simulation
scope: co-newbiz
description: >
  Enters contingent liabilities (litigation, environmental, unfunded
  pension, warranty/recall) with a probability/amount distribution for
  Monte Carlo integration — never a narrative-only entry (ADR-0026) — and
  tests covenant breach under a +200bp rate shock, identifying CoC
  acceleration clauses on debt instruments. Mandatory Brown Field DD
  validator (ma-10/ma-11); a covenant breach under the downside scenario is
  itself a binding Kill Criterion.

  Use when: "contingent liability", "covenant breach test", "rate shock",
  "Monte Carlo liability integration", "CoC debt acceleration".
version: 1.1.0
last_reviewed: 2026-08-23
status: active
owner: risk-officer
prerequisites: none
metadata:
  type: domain
  triggers:
    - contingent liability
    - covenant breach test
    - rate shock
    - Monte Carlo liability integration
    - CoC debt acceleration

  procedure_keys:
    - brownfield-dd
relates_to:
  - skill: certification-transferability
    type: follows
  - skill: technical-due-diligence
    type: composes_with
  - skill: legal-due-diligence
    type: composes_with
  - skill: management-incentive-review
    type: composes_with
  - skill: financing-plan-review
    type: composes_with
  - skill: org-readiness-assessment
    type: composes_with
  - skill: stage-gate-governance
    type: composes_with
  - skill: investment-feasibility-modeling
    type: composes_with
  - skill: wacc-input-session
    type: composes_with

---

## Context

ADR-0026's decision is specific: each contingent liability carries a
probability, an amount distribution (low/expected/high), and an expected
timing, integrated directly into `python/monte_carlo.py` — not disclosed as
prose the valuation model has nothing to compute against. Verification is
concrete: the downside tail must visibly thicken when contingent
liabilities are added (design §12) — a contingent-liability entry that
doesn't move the P95 NPV impact at all is either immaterial or entered wrong.
A covenant breach under the downside scenario is one of the six binding
Kill Criteria (`policies/group/neb-policy.md` §4) — this is a harder stop
than a RAG-grade penalty.

## When to Use

- Brown Field DD — always, per the mandatory checklist items ma-10/ma-11
- Assessing debt-covenant headroom under a rate-shock scenario

## Execution Steps

1. **Inventory contingent liabilities**: litigation, environmental
   remediation, unfunded pension, warranty/recall exposure — every entry
   requires a probability, an amount distribution (low/expected/high), and
   expected timing; a narrative-only entry ("possible litigation exposure")
   does not satisfy ma-10
2. **Integrate into the Monte Carlo simulation** (`python/monte_carlo.py`)
   rather than treating it as a valuation footnote — confirm the downside
   tail actually thickens as a sanity check
3. **Test covenant breach under a +200bp rate shock** — the standard stress
   scenario, applied consistently across deals for comparability
4. **Identify CoC acceleration clauses on debt instruments** — cross-reference
   with `customer-attrition-risk`'s CoC-clause scan rather than duplicating it
5. **If the covenant-breach test fails under the downside scenario**: this
   is a Kill Criteria hit (`stage-gate-governance`), not a RAG-grade
   penalty — halt and route for Group IC override consideration, do not
   simply lower the grade and proceed

## Output Format

- Contingent-liability inventory (probability/amount distribution/timing per
  item), Monte Carlo P50/P95 NPV impact, covenant-breach stress-test result,
  CoC debt-acceleration inventory

## Related Skills

- `customer-attrition-risk` — the CoC-clause cross-reference
- `stage-gate-governance` — the Kill Criterion a covenant breach triggers
- `monte-carlo-simulation` — the underlying simulation engine this feeds
