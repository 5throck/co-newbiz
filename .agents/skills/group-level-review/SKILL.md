---
name: group-level-review
scope: co-newbiz
owner: group-review-agent
lifecycle:
  phase: draft
status: experimental
version: "1.1.0"
description: >
  Implements the group-review activity (S11) of `group-investment-review`: ranks concurrent proposals for Group IC and screens portfolio overlap at group level, distinct from entity-level review. Does not cover portfolio-fit scoring (portfolio-fit-assessment) or affiliate transaction screens (intra-group-transaction-compliance).
  Use when: "group review", "group IC", "proposal ranking", "capital allocation priority".
metadata:
  triggers:
    - group review
    - group IC
    - proposal ranking
    - capital allocation priority
---

# group-level-review

Owned by `group-review-agent`. Referenced from: group-review activity in `process/flow.spec.yaml` (S11); `group-investment-review`.

The owning procedure is authoritative for what happens and when; this skill carries only how to do the work and never restates procedure steps.

## Artifact

group review pack: ranked proposal list with the stated basis and overlap flags, as a proposal to Group IC.

## Boundaries

- Output is a proposal; only a person records a decision, gate verdict or waiver.
- State explicitly what could not be verified; silence is never read as approval.
- Status stays `experimental` until the skill-existence bar (distinct trigger, owner, non-trivial artifact) is demonstrated.
