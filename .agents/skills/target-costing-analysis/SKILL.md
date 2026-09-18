---
name: target-costing-analysis
scope: co-newbiz
description: >
  Reverses the market price into an allowable cost at the target margin and
  compares it against the estimated unit cost — the S8 target-costing step
  (design 2026-09-18-s8-business-case-evaluation REQ-W2-1). Anchors the
  market price to the peer benchmark set or the proxy demand chain, computes
  allowable_cost = price × (1 − target_margin), records the gap against the
  estimated unit cost with reduction levers, and flags gap beyond the +10%
  threshold into the downside scenario's opex driver and the business-case
  snapshot warnings.

  Use when: "target costing", "allowable cost", "cost gap", "market price
  reversal".
version: 1.0.0
last_reviewed: 2026-09-18
status: active
owner: financial-analyst
prerequisites:
  - peer-benchmarking
metadata:
  type: domain
  triggers:
    - target costing
    - allowable cost
    - cost gap
    - market price reversal

  procedure_keys:
    - greenfield-fs
    - brownfield-fs
  output_types:
    - target_cost_gap
relates_to:
  - skill: peer-benchmarking
    type: follows
  - skill: investment-feasibility-modeling
    type: composes_with
  - skill: growth-projection-modeling
    type: composes_with

---

## Context

The S8 business case derived revenue from a growth anchor and costs from
fixed ratios — nothing forced the cost structure to be *achievable* at the
price the market actually pays. Target costing closes that loop: the market
sets the price, the required margin sets the allowable cost, and the gap to
the estimated unit cost is an explicit, recorded artifact instead of a
silent hope. It is the cost-side counterpart of the anchored growth
projection (step 1): both replace unexamined numbers with anchored,
provenance-bearing ones.

## Inputs

| Input | Source | Required |
|---|---|---|
| Market price (per unit) | `peer_benchmark_set` (step 6.6) or the proxy demand chain price node (steps 6.7/6.8) | yes |
| Target margin | group/affiliate business-target master data (`md_business_target.operating_margin`, ADR-0114) or the scenario contract | yes |
| Estimated unit cost | the case's cost structure (opex ratio, capex schedule, labor plan) | yes |

## Method

1. **Anchor the market price.** Take the peer-benchmark median unit price for
   the comparable set; when no comparable exists, use the proxy chain's price
   node with its confidence grade. Record `source` and `anchor_ref` — an
   unanchored price is a failed step.
2. **Derive the allowable cost.** `allowable_cost = market_price × (1 −
   target_margin)`. The target margin comes from the business-target master
   data; absent a row, the fs scenario contract's margin target applies.
3. **Estimate the unit cost.** From the case's cost structure: unit variable
   cost (material + variable opex) plus allocated unit fixed cost at the
   ramp-up volumes — not at steady state, so the gap reflects the ramp.
4. **Record the gap.** `gap = estimated_unit_cost − allowable_cost`, with
   reduction levers (design-to-cost, sourcing, process, scale). A gap beyond
   **+10% of allowable cost** is material: it feeds the downside scenario's
   opex driver and lands in the business-case snapshot `warnings` (REQ-W2-3).
5. **Persist `target_cost_gap`** — market_price, target_margin,
   allowable_cost, estimated_unit_cost, gap, levers, threshold verdict — so
   the fs gate reviews cost achievability, not just cost size.

## Boundaries

- The gap verdict is a PROPOSAL. Kill criteria and gate decisions stay human
  (ADR-0053).
- The skill does not re-derive the market price basis — it consumes
  `peer_benchmark_set` / proxy-chain outputs (like `investment-feasibility-
  modeling`, it assembles anchored inputs instead of re-deriving them).
- No price anchor, no step: missing data is never fabricated.
