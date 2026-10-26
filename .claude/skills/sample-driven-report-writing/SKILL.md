---
name: sample-driven-report-writing
scope: co-newbiz
owner: process-governance-manager
lifecycle:
  phase: draft
status: experimental
version: "1.1.0"
description: >
  Implements the ic-preparation activity (S11) report drafting: shaping an IC report from an approved sample structure so that sections, evidence references and the verified / could not verify / needs judgement split stay consistent. Does not author analysis content or build the deck (executive-presentation).
  Use when: "report writing", "sample report", "report drafting", "IC report structure".
metadata:
  triggers:
    - report writing
    - sample report
    - report drafting
    - IC report structure
---

# sample-driven-report-writing

Owned by `process-governance-manager`. Referenced from: ic-preparation activity in `process/flow.spec.yaml` (S11).

The owning procedure is authoritative for what happens and when; this skill carries only how to do the work and never restates procedure steps.

## Artifact

report draft following the sample structure, with each section citing its source artifact.

## Boundaries

- Output is a proposal; only a person records a decision, gate verdict or waiver.
- State explicitly what could not be verified; silence is never read as approval.
- Status stays `experimental` until the skill-existence bar (distinct trigger, owner, non-trivial artifact) is demonstrated.
