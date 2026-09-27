---
name: jv-structuring
scope: co-newbiz
description: >
  Documents JV governance (board composition, veto matters), contribution
  valuation, exit clauses (put/call, drag/tag), and the deadlock-resolution
  mechanism before term-sheet negotiation — and independently values any
  technology contribution rather than accepting the contributing party's
  stated figure. Mandatory Partnership DD validator
  (`checklists/partnership-checklist.yaml` pt-06; pt-07 recommended).

  Use when: "JV structuring", "joint venture governance", "veto matters",
  "drag-along tag-along", "deadlock resolution", "technology contribution
  valuation".
version: 1.2.0
last_reviewed: 2026-08-23
status: active
owner: partnership-agent
prerequisites:
  - partner-due-diligence
metadata:
  type: domain
  procedure_keys:
    - deal-shape-chain
    - jv-lifecycle-governance
  triggers:
    - JV structuring
    - joint venture governance
    - veto matters
    - drag-along tag-along
    - deadlock resolution
    - technology contribution valuation
relates_to:
  - skill: investment-vehicle-structuring
    type: follows
  - skill: project-review
    type: follows
  - skill: partner-sourcing-strategy
    type: composes_with
  - skill: project-review
    type: composes_with
  - skill: portfolio-fit-assessment
    type: composes_with
  - skill: project-review
    type: composes_with
  - skill: certification-transferability
    type: composes_with
  - skill: k-law
    type: composes_with
  - skill: legal-due-diligence
    type: composes_with

---

## Context

pt-06 requires all four structuring elements documented **before**
term-sheet negotiation, not drafted during it — negotiating governance and
exit terms simultaneously with the term sheet tends to produce vague
compromises on exactly the provisions that matter most when the JV later
runs into trouble. pt-07 (technology valuation independence) is
recommended rather than mandatory, but the reasoning still applies broadly:
a contributing party's self-reported technology value is not a neutral input.

## When to Use

- A partnership has cleared DD and is structuring as a joint venture
- Reviewing a JV term sheet for completeness before negotiation begins

## Execution Steps

1. **Governance**: board composition (seats per party, chair rotation if
   any), and the explicit list of veto/reserved matters — vague "major
   decisions require unanimous consent" language is not sufficient; each
   veto matter should be enumerated
2. **Contribution valuation**: cash, assets, and technology contributions
   valued and documented per party
3. **Independently value any technology contribution** (pt-07) — do not
   accept the contributing party's stated figure without an independent
   assessment; an inflated technology valuation shifts effective ownership
   economics in that party's favor
4. **Exit clauses**: put/call options (who can trigger, at what valuation
   mechanism) and drag-along/tag-along rights, documented with trigger
   conditions
5. **Deadlock-resolution mechanism**: what happens when the board cannot
   reach a required decision — escalation, mediation, buy-sell (Russian
   roulette / Texas shootout), or dissolution trigger, specified in advance
6. **Confirm all five elements are documented before term-sheet
   negotiation starts** (pt-06's explicit sequencing requirement)

## Output Format

- JV structure document: governance (board/veto matters), contribution
  valuation (technology independently assessed), exit clauses,
  deadlock-resolution mechanism — the input to term-sheet negotiation

## Related Skills

- `partner-due-diligence` — the candidate screening this structuring follows
- `stage-gate-governance` — where a hard partner-dependency Kill Criteria interacts with JV terms
