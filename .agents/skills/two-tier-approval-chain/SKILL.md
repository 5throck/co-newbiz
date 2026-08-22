---
name: two-tier-approval-chain
scope: co-newbiz
description: >
  Runs the Entity IC -> Group IC approval chain: Entity IC approval gates
  eligibility for Group IC submission (ADR-0028's orthogonal scope x level
  axes), and Group IC is a ranking decision among competing agenda items,
  never a simple yes/no (ADR-0029). Backed by `db/lib/approval-chain.ts`
  and `GET /api/projects/:id/approval-chain`.

  Use when: "entity IC", "group IC", "approval chain", "IC gate",
  "group agenda ranking", "submit to group IC".
version: 1.1.0
last_reviewed: 2026-08-23
status: active
owner: process-governance-manager
prerequisites: none
metadata:
  type: process
  triggers:
    - entity IC
    - group IC
    - approval chain
    - IC gate
    - group agenda ranking
    - submit to group IC

  procedure_keys:
    - group-investment-review
---

## Context

Two independent levels, not one chain with two rubber stamps: **Entity IC**
approves at each of that entity's own gates (Screening/Pre-FS/FS/DD per
`procedures/*/schema.yaml`'s `gate` field); only an Entity-IC-approved
project is eligible to enter Group IC review at all. **Group IC** does not
re-decide approve/reject — it ranks competing agenda items against each
other for capital allocation within a review cycle (ADR-0029), using
`capital_request`, `irr_over_hurdle_pp`, `rag_grade`, and `priority_rank`
(`group_agenda` table, `rankGroupAgenda()`).

## When to Use

- A project reaches a gate requiring Entity IC sign-off
- An Entity-IC-approved project needs to enter a Group IC review cycle
- Group IC needs a ranked agenda across multiple competing projects

## Execution Steps

1. **Entity IC gate**: `ensureApprovalChain()` creates the gate row per
   `procedures/*/schema.yaml`'s declared `required_procedure_id` and
   `approver_role`; `recordDecision()` logs approve/reject/conditional with
   `conditions` text where applicable
2. **Confirm gating**: a project cannot `enterGroupReview()` without a prior
   Entity IC approval on record for the relevant gate — this is enforced in
   the engine, not left to reviewer discipline
3. **Submit to the agenda**: `submitToGroupAgenda()` records the project
   against a review `cycle` with its `capital_request`, `irr_over_hurdle_pp`,
   and current `rag_grade`
4. **Rank, don't approve**: `rankGroupAgenda(cycle)` returns every submitted
   project ordered by `priority_rank` — the Group IC's output is this
   ranking plus a `decision`/`rationale` per item, never a bare
   approve/reject for the cycle as a whole
5. **Read the current status**: `GET /api/projects/:id/approval-chain`
   (also the MCP `get_approval_chain` tool) surfaces `level`, `gate`,
   `sequence`, `status`, `decision`, `decided_at`, `conditions`,
   `blocked_reason` for both levels on one project

## Output Format

- Approval-chain status per project (level, gate, decision, conditions)
- Ranked Group IC agenda for a review cycle, with rationale per item

## Related Skills

- `stage-gate-governance` — the gate sequence this approval chain runs against
- `group-level-review` — the substantive review content behind a Group IC ranking
- `deal-execution-playbook` — where in the deal lifecycle each gate falls
