---
name: legal-risk-register
scope: co-newbiz
owner: risk-officer
lifecycle:
  phase: draft
status: experimental
version: "1.1.0"
description: >
  Implements the risk-review activity (S11) for entity and group investment review: consolidates open legal findings from DD into a register with severity and mitigation status for the IC package. Does not perform legal due diligence (legal-due-diligence) or statute research (k-law).
  Use when: "legal risk register", "legal issues", "risk register", "IC legal risk summary".
metadata:
  triggers:
    - legal risk register
    - legal issues
    - risk register
    - IC legal risk summary
---

# legal-risk-register

Owned by `risk-officer`. Referenced from: risk-review activity in `process/flow.spec.yaml` (S11); `entity-ic-review` and `group-investment-review`.

The owning procedure is authoritative for what happens and when; this skill carries only how to do the work and never restates procedure steps.

## Artifact

legal risk register entries linked to `dd_finding` rows, each with severity, owner and mitigation status.

## Boundaries

- Output is a proposal; only a person records a decision, gate verdict or waiver.
- State explicitly what could not be verified; silence is never read as approval.
- Status stays `experimental` until the skill-existence bar (distinct trigger, owner, non-trivial artifact) is demonstrated.
