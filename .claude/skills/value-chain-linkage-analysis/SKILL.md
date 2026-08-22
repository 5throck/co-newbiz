---
name: value-chain-linkage-analysis
scope: co-newbiz
description: >
  Assesses upstream/downstream margin and demand-risk exposure via the
  `value_chain_link` table's pass-through-rate coefficients — deliberately
  stored separately from `proxy_industry_chain`'s demand-estimation betas,
  with no shared coefficient reference, because the two answer different
  questions and would corrupt each other if shared (ADR-0025).

  Use when: "value chain linkage", "pass-through rate", "upstream downstream
  risk exposure", "margin risk from supplier or customer industry".
version: 1.1.0
last_reviewed: 2026-08-23
status: active
owner: quant-methodologist
prerequisites: none
metadata:
  type: domain
  triggers:
    - value chain linkage
    - pass-through rate
    - upstream downstream risk exposure
    - margin risk from supplier or customer industry

  procedure_keys:
    - greenfield-screening
---

## Context

ADR-0025's verification step (design §12) is a code-level check that
neither this skill's `value_chain_link` table nor `proxy-industry-chain`'s
`proxy_link` table reads the other's beta — a shared coefficient would let
a demand-estimation assumption silently leak into a margin-risk conclusion
or vice versa. This separation is what lets pass-through-rate-driven margin
risk analysis coexist correctly with proxy-chain-driven demand estimation
on the same industry pair, without one contaminating the other.

## When to Use

- Assessing how a cost shock in an upstream industry passes through to the
  target's margin
- Assessing demand-side risk exposure to a downstream customer industry's cyclicality

## Execution Steps

1. **Identify the value-chain linkage**: the specific upstream (supplier)
   or downstream (customer) industry whose fortunes materially affect the
   target's margin or demand
2. **Estimate the pass-through-rate coefficient**: how much of an upstream
   cost change flows through to the target's cost structure (or a
   downstream demand change flows through to the target's revenue) —
   store as `value_chain_link`, never referencing or being referenced by a
   `proxy_link` row for the same industry pair
3. **Assess the risk implication**: a high pass-through rate from a
   volatile upstream input is a margin-risk finding; a high demand-linkage
   to a cyclical downstream customer industry is a demand-risk finding —
   these are RAG risk-dimension inputs, not market-sizing inputs
4. **Do not reuse a `proxy_link` beta here**, even where the same industry
   pair happens to also be part of a demand-estimation proxy chain — the
   two coefficients answer different questions and are calibrated
   differently; a shared number would be coincidentally similar at best,
   wrong at worst

## Output Format

- Value-chain-linkage finding: pass-through-rate coefficient, margin/demand
  risk assessment, feeding the RAG risk dimension

## Related Skills

- `proxy-industry-chain` — the deliberately-separate demand-estimation chain (ADR-0025)
- `debt-and-contingent-liability-simulation` — a consumer of margin-risk findings for the Monte Carlo model
