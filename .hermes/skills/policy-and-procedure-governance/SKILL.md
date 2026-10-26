---
name: policy-and-procedure-governance
scope: co-newbiz
owner: process-governance-manager
lifecycle:
  phase: draft
status: experimental
version: "1.1.0"
description: >
  Implements step 0 added by the ent-a overlay to `brownfield-screening` and the standing governance of the five-layer document hierarchy: checking that a pre-screen or procedure change sits at the right layer (policy, procedure, guideline, checklist, template). Does not decide the investment.
  Use when: "procedure governance", "policy procedure", "process governance", "document hierarchy check".
metadata:
  procedure_keys:
    - brownfield-screening
  triggers:
    - procedure governance
    - policy procedure
    - process governance
    - document hierarchy check
---

# policy-and-procedure-governance

Owned by `process-governance-manager`. Referenced from: ent-a `brownfield-screening` overlay step 0; `docs/governance/governance-operations.md`.

The owning procedure is authoritative for what happens and when; this skill carries only how to do the work and never restates procedure steps.

## Artifact

`internal_prescreen_record` for the ent-a overlay and a layer-placement note for any governance document change.

## Boundaries

- Output is a proposal; only a person records a decision, gate verdict or waiver.
- State explicitly what could not be verified; silence is never read as approval.
- Status stays `experimental` until the skill-existence bar (distinct trigger, owner, non-trivial artifact) is demonstrated.
