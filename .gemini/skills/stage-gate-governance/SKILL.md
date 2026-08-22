---
name: stage-gate-governance
scope: co-newbiz
description: >
  Runs the Screening -> Pre-FS -> FS -> DD -> Entity IC -> Group IC gate
  sequence and the 6-item binding Kill Criteria list (ADR-0008,
  `policies/group/neb-policy.md` §4) — distinct from and stricter than RAG
  grading. A Kill Criteria hit halts the project outright; only Group IC can
  override, and only with an explicit recorded decision.

  Use when: "stage gate", "kill criteria", "gate sequence", "halt the
  project", "does this trigger a kill criterion".
version: 1.1.0
last_reviewed: 2026-08-23
status: active
owner: process-governance-manager
prerequisites: none
metadata:
  type: process
  triggers:
    - stage gate
    - kill criteria
    - gate sequence
    - halt the project
    - does this trigger a kill criterion

  procedure_keys:
    - brownfield-dd
    - brownfield-fs
    - brownfield-pre-fs
    - brownfield-screening
    - entity-establishment-execution
    - entity-ic-review
    - greenfield-dd
    - greenfield-fs
    - greenfield-pre-fs
    - greenfield-screening
    - group-investment-review
---

## Context

The gate sequence per procedure `gate` fields is Screening → Pre-FS → FS →
DD → Entity IC → Group IC (Green Field and Brown Field each have their own
per-stage procedures under `procedures/_shared/`). Kill Criteria are policy
content (`policies/group/neb-policy.md` §4), not code — an amendment goes
through `policy-change-impact-analysis`, never an ad hoc edit. The six
binding criteria: zero Green Field site candidate clears mandatory
infrastructure minimums; any of the six Brown Field mandatory validators
missing at DD exit; growth projection outside the top-decile
historical/peer base rate without risk-officer sign-off; a covenant breach
under a downside scenario; a non-transferable mandatory certification
load-bearing to the deal thesis; a partner-sourcing failure the business
cannot proceed without.

## When to Use

- At every gate transition, before advancing a project to the next stage
- Whenever a finding might match one of the six Kill Criteria
- Recording a Group IC override of a Kill Criteria hit

## Execution Steps

1. **Check every finding against the six criteria** as work proceeds, not
   only at the gate boundary — a Kill Criteria hit discovered mid-DD halts
   the project immediately, it does not wait for the gate review
2. **On a hit**: halt the project and record which criterion, the
   triggering finding, and the evidence — this is separate from and
   supersedes the RAG grade (a Green project can still hit a Kill Criterion;
   RAG measures quality, Kill Criteria measure viability)
3. **Only Group IC can override**, and only with an explicit decision
   recorded (never a default/implicit override from inaction)
4. **At each gate transition**: confirm `compliance-monitoring`'s gate check
   passes (deliverables + mandatory checklist items, or an active waiver)
   before advancing
5. **Record the gate decision** via `two-tier-approval-chain`'s
   `recordDecision()` for Entity IC gates, or `group-level-review` for the
   Group IC gate

## Output Format

- Gate-transition record (stage, decision, evidence)
- Kill Criteria hit record where applicable (criterion, finding, override status)

## Related Skills

- `two-tier-approval-chain`, `group-level-review` — the gate mechanics this runs on top of
- `compliance-monitoring` — the deliverable/checklist completeness check per gate
- `deal-execution-playbook` — the full gate-by-gate agent/skill/output map
