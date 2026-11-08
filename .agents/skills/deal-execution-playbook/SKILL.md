---
name: deal-execution-playbook
scope: co-newbiz
owner: brownfield-agent
lifecycle:
  phase: draft
status: experimental
version: "1.2.0"
description: >
  Implements the route-strategy (S4) and deal-shape-evaluation (S7) activities: turning the selected route and deal shape into an execution sequence of counterparties, approvals and dependencies. Does not structure a JV (jv-structuring) or source partners (partner-sourcing-strategy).
  Use when: "deal execution", "closing steps", "execution playbook", "deal shape evaluation".
metadata:
  triggers:
    - deal execution
    - closing steps
    - execution playbook
    - deal shape evaluation
  procedure_keys:
    - brownfield-target-screening
---

# deal-execution-playbook

Owned by `brownfield-agent`. Referenced from: the route-strategy (S4) and deal-shape-evaluation (S7) activities in `process/flow.spec.yaml`; `deal-shape-chain`; `brownfield-target-screening` (step 3.5).

The owning procedure is authoritative for what happens and when; this skill carries only how to do the work and never restates procedure steps.

## Artifact

deal execution outline listing steps, owners and dependencies, as a proposal for route decision materials.

## Boundaries

- Output is a proposal; only a person records a decision, gate verdict or waiver.
- State explicitly what could not be verified; silence is never read as approval.
- Status stays `experimental` until the skill-existence bar (distinct trigger, owner, non-trivial artifact) is demonstrated.
