---
name: assumption-audit
scope: co-newbiz
owner: risk-officer
lifecycle:
  phase: draft
status: experimental
version: "1.1.0"
description: >
  Implements the synergy-analysis red-team activity (S3): audits the assumption register behind a synergy score for optimism bias and reference-class (base-rate) deviation. Does not draft the assumptions and does not set the score.
  Use when: "assumption audit", "assumption review", "assumption register check", "optimism bias check".
metadata:
  triggers:
    - assumption audit
    - assumption review
    - assumption register check
    - optimism bias check
---

# assumption-audit

Owned by `risk-officer`. Referenced from: synergy-analysis activity in `process/flow.spec.yaml` (S3).

The owning procedure is authoritative for what happens and when; this skill carries only how to do the work and never restates procedure steps.

## Artifact

assumption audit finding listing each challenged assumption, the base rate compared, and the verdict class (verified / could not verify / needs judgement).

## Boundaries

- Output is a proposal; only a person records a decision, gate verdict or waiver.
- State explicitly what could not be verified; silence is never read as approval.
- Status stays `experimental` until the skill-existence bar (distinct trigger, owner, non-trivial artifact) is demonstrated.
