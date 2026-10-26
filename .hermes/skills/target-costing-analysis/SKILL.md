---
name: target-costing-analysis
scope: co-newbiz
owner: quant-methodologist
lifecycle:
  phase: draft
status: experimental
version: "1.1.0"
description: >
  Implements step 6.96 of `greenfield-fs` and the matching step of `brownfield-fs`: allowable-cost derivation from a market-price candidate and the resulting cost gap for the business case. Does not extract web-search price evidence beyond the candidates handed in.
  Use when: "target costing", "allowable cost", "cost gap", "target cost".
metadata:
  procedure_keys:
    - greenfield-fs
    - brownfield-fs
  triggers:
    - target costing
    - allowable cost
    - cost gap
    - target cost
---

# target-costing-analysis

Owned by `quant-methodologist`. Referenced from: `greenfield-fs` step 6.96; `brownfield-fs`.

The owning procedure is authoritative for what happens and when; this skill carries only how to do the work and never restates procedure steps.

## Artifact

`target_cost_gap` with price evidence (currency, unit, source) and the cost gap, as a proposal to the business case.

## Boundaries

- Output is a proposal; only a person records a decision, gate verdict or waiver.
- State explicitly what could not be verified; silence is never read as approval.
- Status stays `experimental` until the skill-existence bar (distinct trigger, owner, non-trivial artifact) is demonstrated.
