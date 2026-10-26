---
name: waiver-management
scope: co-newbiz
owner: compliance-officer
lifecycle:
  phase: draft
status: experimental
version: "1.1.0"
description: >
  Implements the dd-waiver-review activity (S9) under the ADR-0036 mandatory-expiry waiver lifecycle: preparing a waiver request for a failed mandatory DD item, recording the waiver with its expiry, and tracking it to expiry or closure. Does not cover the six M&A mandatory validators, which have no waiver path (bf-01).
  Use when: "waiver", "waiver request", "exemption approval", "waiver expiry".
metadata:
  triggers:
    - waiver
    - waiver request
    - exemption approval
    - waiver expiry
---

# waiver-management

Owned by `compliance-officer`. Referenced from: dd-waiver-review activity in `process/flow.spec.yaml` (S9); ADR-0036.

The owning procedure is authoritative for what happens and when; this skill carries only how to do the work and never restates procedure steps.

## Artifact

waiver proposal with scope, rationale, expiry date and compensating control; the approval itself is recorded by a human.

## Boundaries

- Output is a proposal; only a person records a decision, gate verdict or waiver.
- State explicitly what could not be verified; silence is never read as approval.
- Status stays `experimental` until the skill-existence bar (distinct trigger, owner, non-trivial artifact) is demonstrated.
