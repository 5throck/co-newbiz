---
name: deal-execution-playbook
scope: co-newbiz
description: >
  The gate-by-gate execution map: for each of the six gates (Screening →
  Pre-FS → FS → DD → Entity IC → Group IC), which deliverable is due, which
  agent is R (responsible), which condition is a Kill Criteria candidate,
  and where a human review point sits — per `docs/process-map.md`'s and
  `docs/raci.md`'s actual RACI tables, never restated or improvised.

  Use when: "what happens at this gate", "who owns this deliverable",
  "deal execution sequence", "gate RACI".
version: 1.0.0
last_reviewed: 2026-08-20
status: active
owner: process-governance-manager
prerequisites:
  - stage-gate-governance
metadata:
  type: process
  triggers:
    - what happens at this gate
    - who owns this deliverable
    - deal execution sequence
    - gate RACI
---

## Context

`docs/process-map.md` and `docs/raci.md` are the authoritative source this
skill navigates, not restates — the deliverable, blocking-condition, and
RACI columns per gate live there and change independently of this skill.
Note the document's own warning: this is the *business review process* map,
distinct from the product-build Phase 0-6 (which is how the team built the
system that runs this process, not the process itself).

## When to Use

- Orienting a new project or reviewer on what's expected at the current gate
- Confirming who is R/A/C/I for a specific deliverable before dispatching work
- Checking whether a finding matches a gate's Kill Criteria candidate condition

## Execution Steps

1. **Identify the project's current gate** (Screening/Pre-FS/FS/DD/Entity
   IC/Group IC) and Green Field vs. Brown Field track
2. **Pull the gate's row from `docs/process-map.md`**: deliverable, blocking
   condition, approver, R/A/C/I — read directly, never reconstructed from memory
3. **Dispatch the R agent(s)** for the deliverable, with the C agents
   consulted and I agents informed per the table — this is PM's dispatch
   guide, not a skill any other agent re-derives independently
4. **Check the blocking condition** against current findings before the
   gate is considered ready — most of these map directly to a Kill
   Criteria candidate (`stage-gate-governance`)
5. **Confirm the human review point**: Entity IC and Group IC gates require
   a human approver, never an agent-only sign-off — `analysis_task.reviewed_by`
   NULL on a required deliverable is itself a blocking condition at Entity IC

## Output Format

- Gate status: deliverable completeness, R/A/C/I dispatch record, blocking-
  condition check result

## Related Skills

- `stage-gate-governance` — the Kill Criteria this playbook's blocking conditions map to
- `two-tier-approval-chain`, `group-level-review` — the Entity/Group IC mechanics
- `agent-output-provenance` — how each dispatched deliverable's output is tracked
