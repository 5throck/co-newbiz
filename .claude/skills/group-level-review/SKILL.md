---
name: group-level-review
scope: co-newbiz
description: >
  Owns the Group IC gate end to end — runs `procedures/_shared/group-investment-review/schema.yaml`'s
  5-step sequence (entity-IC precondition, portfolio-fit, intra-group-transaction
  compliance, agenda ranking, decision recording), never restating those steps
  here. This skill is the orchestration layer; `portfolio-fit-assessment` and
  `intra-group-transaction-compliance` implement the analytical steps.

  Use when: "group IC review", "group investment committee", "run the group
  gate", "group review agent".
version: 1.0.0
last_reviewed: 2026-08-20
status: active
owner: group-review-agent
prerequisites:
  - two-tier-approval-chain
metadata:
  type: process
  triggers:
    - group IC review
    - group investment committee
    - run the group gate
    - group review agent
---

## Context

The authoritative step sequence lives in
`procedures/_shared/group-investment-review/schema.yaml` — this skill executes
it, it does not restate it. Step 1 (Entity IC precondition) is a hard,
system-enforced rejection with no soft-warning path (design §6.4) —
`two-tier-approval-chain` already implements this check. Step 5's decision
model has **four** states, not three:
`approved`/`rejected`/`conditional`/`withdrawn_pending_resubmission` — the
fourth state was added after `docs/pilots/pilot-003-doosan-bobcat-robotics.md`
found a real case that withdrew and re-proposed with revised terms rather
than landing on any of the original three.

## When to Use

- A project has cleared Entity IC and needs to enter a Group IC review cycle
- Reviewing the current status of a project already in the Group IC pipeline

## Execution Steps

1. **Precondition** (step 1 of the shared procedure): confirm Entity IC
   approval is recorded — `two-tier-approval-chain`'s `enterGroupReview()`
   rejects entry outright if not, no soft warning
2. **Portfolio fit** (step 2): dispatch `portfolio-fit-assessment` for the
   overlap/cannibalization finding
3. **Intra-group transaction screen** (step 3): dispatch
   `intra-group-transaction-compliance` — **only if** the deal involves
   affiliate transactions; skip otherwise, do not run it as a blanket check
4. **Agenda ranking** (step 4): `portfolio-fit-assessment` again, this time
   producing the `group_agenda_ranking` output against the cycle's other
   concurrent submissions (the meeting M2 D-M2-2 formula: IRR-over-hurdle
   spread + RAG grade + capital requested, normalized to the cycle budget,
   ties broken by risk-officer flags)
5. **Record the decision** (step 5): one of the four states above, with
   `rationale` — a `conditional` decision is first-class, not a footnote on
   `approved`

## Output Format

- The `group_ic_decision` output per the shared procedure's step 5 — feeds
  `two-tier-approval-chain`'s `rankGroupAgenda()` status view

## Related Skills

- `two-tier-approval-chain` — the Entity/Group IC mechanics this orchestrates
- `portfolio-fit-assessment`, `intra-group-transaction-compliance` — the two analytical steps
- `stage-gate-governance` — the broader gate sequence Group IC sits inside
