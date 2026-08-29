---
name: financing-plan-review
scope: co-newbiz
description: >
  Assembles and reviews the financing evidence pack — sources and uses,
  commitment papers or internal-funds approval, covenant headroom,
  funds-flow memorandum, FX plan, escrow sizing, reverse-termination-fee
  sizing — so certainty of funds is evidenced before the final IC, never
  assumed by a financing contingency.

  Use when: "financing plan", "certainty of funds", "sources and uses".
version: 1.1.0
last_reviewed: 2026-08-23
status: active
owner: valuation-agent
prerequisites: none
metadata:
  type: process
  triggers:
    - financing plan
    - certainty of funds
    - sources and uses

  procedure_keys:
    - brownfield-dd
    - entity-ic-review
relates_to:
  - skill: insight-synthesis
    type: follows
  - skill: org-readiness-assessment
    type: follows
  - skill: technical-due-diligence
    type: composes_with
  - skill: legal-due-diligence
    type: composes_with
  - skill: management-incentive-review
    type: composes_with
  - skill: incentive-clawback-assessment
    type: composes_with
  - skill: stage-gate-governance
    type: composes_with
  - skill: rag-scoring-framework
    type: composes_with
  - skill: investment-feasibility-modeling
    type: composes_with
  - skill: wacc-input-session
    type: composes_with

---

## Context

The 15-step chain audit found financing absent from the entity workflow —
no step, no skill, no checklist (ADR-0051 gap 13). Published deal practice
is unambiguous: certainty of funds must be evidenced before final
investment approval, because sellers read a financing contingency as the
clearest signal of deal weakness. This skill is the HOW; the procedure
steps that dispatch it (`procedures/_shared/brownfield-dd/schema.yaml`
step 12, `procedures/_shared/entity-ic-review/schema.yaml` step 4 as a
precondition) own the what and when.

## When to Use

- At DD exit on every deal with external funding components, producing the
  evidence pack for the IC package
- At Entity IC as the precondition check — no committed financing
  evidence, no decision step

## Execution Steps

1. **Build sources and uses first** — every inflow/outflow on one table;
   decide the cash/debt/equity mix and tenor/amortization profile against
   it, never in the abstract
2. **Evidence commitments**: executed equity commitment letter and debt
   commitment letter + fee letter + term sheet, OR the documented
   internal-funds approval path — an unsigned intent is not certainty
3. **Test covenant headroom against lender terms** under the downside
   case, not the base case
4. **Draft the funds-flow memorandum** — every inflow/outflow, account,
   timing, and FX leg for closing day; route cross-border legs per
   foreign-exchange regulation
5. **Review limited-conditionality (certain-funds) structure with
   legal-counsel** — financing CPs must mirror the acquisition agreement's
   closing mechanics
6. **Size escrow against indemnity exposure and the reverse-termination
   fee against retained funding risk** (4-7% of EV is an ILLUSTRATIVE
   benchmark until the thresholds meeting — ADR-0051 open question (c))
7. **Write the certainty-of-funds statement** for the IC package: what is
   committed, by whom, expiring when, and what remains conditional

## Output Format

- `financing_readiness_check`: the evidence pack index (commitment papers
  or internal-funds approval, sources-and-uses, covenant headroom,
  funds-flow draft, FX plan, escrow/RTF sizing) + the certainty-of-funds
  statement

## Related Skills

- `investment-vehicle-structuring` — the vehicle axis of the same deal
  structure; financing leverage is one of ADR-0045's four review axes
- `deal-execution-playbook` — where the pack rides the deal timeline
- `debt-and-contingent-liability-simulation` — the downside-case covenant
  stress this skill's headroom test consumes
- `dd-to-valuation-bridge` — where financing findings adjust value
