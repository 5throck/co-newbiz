---
name: value-chain-stage-financials
scope: co-newbiz
owner: financial-analyst
lifecycle:
  phase: draft
status: experimental
version: "1.1.0"
description: >
  Implements step 6.9 of `greenfield-fs` and the matching step of `brownfield-fs`: the per-value-chain-node five-year KPI rollup (ADR-0066). Does not derive drivers (value-chain-driver-identification) or target costs (target-costing-analysis).
  Use when: "stage financials", "value chain economics", "segment financials", "chain stage rollup".
metadata:
  procedure_keys:
    - greenfield-fs
    - brownfield-fs
  triggers:
    - stage financials
    - value chain economics
    - segment financials
    - chain stage rollup
---

# value-chain-stage-financials

Owned by `financial-analyst`. Referenced from: `greenfield-fs` step 6.9; `brownfield-fs`; ADR-0066.

The owning procedure is authoritative for what happens and when; this skill carries only how to do the work and never restates procedure steps.

## Artifact

`chain_stage_financial_rollup` with per-node KPIs and the data confidence of each input.

## Boundaries

- Output is a proposal; only a person records a decision, gate verdict or waiver.
- State explicitly what could not be verified; silence is never read as approval.
- Status stays `experimental` until the skill-existence bar (distinct trigger, owner, non-trivial artifact) is demonstrated.
