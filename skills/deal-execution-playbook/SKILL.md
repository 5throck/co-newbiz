---
name: deal-execution-playbook
scope: co-newbiz
description: >
  The gate-by-gate execution map: for each of the seven gates (Screening →
  Pre-FS → Target Screening (brownfield) → FS → DD → Entity IC → Group IC),
  which deliverable is due, which agent is R (responsible), which condition
  is a Kill Criteria candidate, and where a human review point sits — per
  `docs/governance/process-map.md`'s and `docs/governance/raci.md`'s actual
  RACI tables, never restated or improvised. The two ungated work stages —
  S10 deal structuring (between the DD gate and Entity IC) and S12
  post-investment management — sit inside this map; dispatch mechanics for
  every stage live in the `deal-pipeline-orchestration` skill.

  Use when: "what happens at this gate", "who owns this deliverable",
  "deal execution sequence", "gate RACI".
version: 1.1.0
last_reviewed: 2026-09-08
status: active
owner: process-governance-manager
prerequisites:
  - stage-gate-governance
relates_to:
  - skill: deal-pipeline-orchestration
    type: composes_with
metadata:
  procedure_keys:
    - brownfield-screening
    - brownfield-pre-fs
    - brownfield-target-screening
    - brownfield-dd
    - brownfield-fs
    - deal-structuring
    - entity-ic-review
    - group-investment-review
    - portfolio-venture-monitoring
  type: process
  triggers:
    - what happens at this gate
    - who owns this deliverable
    - deal execution sequence
    - gate RACI
---

## Context

`docs/governance/process-map.md` and `docs/governance/raci.md` are the authoritative source this
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

1. **Identify the project's current gate** (Screening/Pre-FS/Target
   Screening—brownfield only—/FS/DD/Entity IC/Group IC) and Green Field vs.
   Brown Field track
2. **Pull the gate's row from `docs/governance/process-map.md`**: deliverable, blocking
   condition, approver, R/A/C/I — read directly, never reconstructed from memory
3. **Dispatch the R agent(s)** for the deliverable, with the C agents
   consulted and I agents informed per the table — this is PM's dispatch
   guide, not a skill any other agent re-derives independently; the per-stage
   dispatch mechanics (persona embedding, parallel/serial rules, environment
   discipline) are the `deal-pipeline-orchestration` skill
4. **Check the blocking condition** against current findings before the
   gate is considered ready — most of these map directly to a Kill
   Criteria candidate (`stage-gate-governance`)
5. **Confirm the human review point**: Entity IC and Group IC gates require
   a human approver, never an agent-only sign-off — `analysis_task.reviewed_by`
   NULL on a required deliverable is itself a blocking condition at Entity IC
6. **Ungated work stages**: after the DD gate, S10 deal structuring (vehicle
   + four-axis review + balanced sources & uses) feeds the S11 IC package;
   after Group IC, S12 post-investment management runs the venture scorecard
   and the five transition decisions — neither has a gate; both are tracked
   by their stage completion predicates in `process/flow.spec.yaml`

## Output Format

- Gate status: deliverable completeness, R/A/C/I dispatch record, blocking-
  condition check result

## Related Skills

- `stage-gate-governance` — the Kill Criteria this playbook's blocking conditions map to
- `two-tier-approval-chain`, `group-level-review` — the Entity/Group IC mechanics
- `agent-output-provenance` — how each dispatched deliverable's output is tracked
