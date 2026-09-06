---
governance_doc_id: gdl-proxy-chain-hop-classification
layer: guideline
title: "Proxy Chain Hop Classification"
scope: shared
enforceability: recommended
owner_agent: quant-methodologist
version: "1.0.0"
effective_from: "2026-08-20"
lang: en
counterpart: proxy-chain-hop-classification_ko.md
---

# Guideline: Proxy Chain Hop Classification

**Layer**: Guideline (recommended — captures a methodology judgment call, not a hard rule)

## Context

Meeting M4 (2026-08-20) corrected an implicit assumption in the design: chain reliability grade is driven by the number of **statistical** hops, not total hop count. This guideline gives quant-methodologist (and anyone reviewing a proxy chain) a concrete way to classify a hop before grading the chain.

## Classify Each Hop

| Question | If yes → | If no → |
|---|---|---|
| Is the conversion factor a fixed physical/engineering constant (e.g. engines per ship, crankshaft weight per engine) that doesn't change with market conditions? | **Engineering hop** — does not degrade the chain grade | Continue |
| Is the conversion derived from a regression against historical time series? | **Statistical hop** — grade depends on its own R² and lead-lag defensibility | — |

## Worked Example (design's own case)

Crankshaft → marine engine → ship:

- **Crankshaft → engine**: likely an engineering hop (engines-per-ship and crankshaft-weight-per-engine are physical facts about ship design, not statistically estimated).
- **Engine → ship demand**: the real statistical hop — this is where R² ≥ 0.6 and lead-lag defensibility actually matter.

A naive "two-hop chain" framing would treat this as automatically worse than a one-hop chain. The correct framing: this chain has **one statistical hop**, so it can achieve Grade B if that hop clears the bar — the same grade a genuinely single-hop statistical chain would get.

## Practical Rule

When calibrating a new chain, classify every hop using the table above **before** computing the chain's reliability grade. Document the classification alongside the calibration report (`proxy_link` records) so a future reviewer doesn't have to re-derive which hops were engineering vs. statistical.
