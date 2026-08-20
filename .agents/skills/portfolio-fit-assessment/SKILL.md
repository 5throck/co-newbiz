---
name: portfolio-fit-assessment
scope: co-newbiz
description: >
  Implements steps 2 and 4 of `group-investment-review`: the portfolio
  overlap/cannibalization finding against other group companies, and the
  cross-cycle agenda ranking formula (IRR-over-hurdle spread + RAG grade +
  capital requested, normalized to the cycle budget, ties broken by
  risk-officer flags — meeting M2 D-M2-2).

  Use when: "portfolio overlap", "cannibalization", "portfolio fit",
  "group agenda ranking", "rank against other group companies".
version: 1.0.0
last_reviewed: 2026-08-20
status: active
owner: group-review-agent
prerequisites: none
metadata:
  type: domain
  triggers:
    - portfolio overlap
    - cannibalization
    - portfolio fit
    - group agenda ranking
    - rank against other group companies
---

## Context

Two distinct outputs from one skill, both defined by
`procedures/_shared/group-investment-review/schema.yaml`: `portfolio_overlap_finding`
(step 2, single-project) and `group_agenda_ranking` (step 4, cross-project
within a review cycle — `db/lib/approval-chain.ts`'s `rankGroupAgenda()`).
Rank, don't approve — Group IC's output for a cycle is an ordering plus a
rationale per item, never a bare approve/reject (ADR-0029, `two-tier-approval-chain`).

## When to Use

- A project entering Group IC review needs its overlap finding (step 2)
- A Group IC review cycle needs its agenda ranked (step 4)

## Execution Steps

1. **Overlap finding**: identify other group-company products/markets/customer
   segments the proposal would overlap or cannibalize, drawing on
   `company-intelligence`/`competitive-intelligence` for the comparison
   universe. Output: `portfolio_overlap_finding` — overlap areas, estimated
   cannibalization magnitude, and whether it's judged acceptable, flagged, or
   blocking
2. **Agenda ranking** — apply the formula exactly (not a discretionary
   substitute): IRR-over-hurdle spread + RAG grade + capital requested,
   normalized to the review cycle's capital budget; ties broken by
   `risk-officer` flags, not by submission order or seniority
3. **Submit to the cycle**: `submitToGroupAgenda()` records
   `capital_request`/`irr_over_hurdle_pp`/`rag_grade`; `rankGroupAgenda(cycle)`
   returns the ordered list
4. **Present the ranking with rationale per item** — a ranked list with no
   rationale is not a complete output; Group IC reviewers need to see why
   each item landed where it did

## Output Format

- `portfolio_overlap_finding` (single project)
- `group_agenda_ranking` (ranked list across a cycle, rationale per item)

## Related Skills

- `group-level-review` — the orchestrating skill this fits inside
- `two-tier-approval-chain` — the underlying ranking engine
- `intra-group-transaction-compliance` — the other Group IC analytical step
