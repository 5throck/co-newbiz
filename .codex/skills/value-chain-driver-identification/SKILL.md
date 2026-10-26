---
name: value-chain-driver-identification
scope: co-newbiz
owner: quant-methodologist
lifecycle:
  phase: draft
status: experimental
version: "1.1.0"
description: >
  Implements step 6.95 of `greenfield-fs` and the matching step of `brownfield-fs`: per-stage driver sensitivities from correlation and lead-lag analysis of value-chain series, replacing manual sensitivity entries. Does not estimate pass-through (value-chain-linkage-analysis).
  Use when: "value chain drivers", "driver analysis", "driver identification", "stage sensitivity".
metadata:
  procedure_keys:
    - greenfield-fs
    - brownfield-fs
  triggers:
    - value chain drivers
    - driver analysis
    - driver identification
    - stage sensitivity
---

# value-chain-driver-identification

Owned by `quant-methodologist`. Referenced from: `greenfield-fs` step 6.95; `brownfield-fs`.

The owning procedure is authoritative for what happens and when; this skill carries only how to do the work and never restates procedure steps.

## Artifact

`chain_node_sensitivity_set` with fit quality and confidence grade per driver; a weak fit is reported as such, never rounded up.

## Boundaries

- Output is a proposal; only a person records a decision, gate verdict or waiver.
- State explicitly what could not be verified; silence is never read as approval.
- Status stays `experimental` until the skill-existence bar (distinct trigger, owner, non-trivial artifact) is demonstrated.
