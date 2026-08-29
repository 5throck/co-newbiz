---
name: proxy-industry-chain
scope: co-newbiz
description: >
  Builds and grades a proxy-industry demand-estimation chain (e.g.
  crankshaft -> marine engine -> ship) for target industries with no direct
  market data. Chain reliability grade (A/B/C) is driven by the count of
  STATISTICAL hops only, not total hop count — corrected at meeting M4 from
  an earlier design draft (ADR-0006). Data confidence from this chain caps
  the overall RAG grade downstream.

  Use when: "proxy chain", "no direct market data", "chain reliability
  grade", "demand estimation via proxy industry".
version: 1.1.0
last_reviewed: 2026-08-23
status: active
owner: quant-methodologist
prerequisites:
  - unit-conversion-calibration
metadata:
  procedure_keys:
    - brownfield-fs
    - greenfield-fs
  type: domain
  triggers:
    - proxy chain
    - no direct market data
    - chain reliability grade
    - demand estimation via proxy industry
relates_to:
  - skill: unit-conversion-calibration
    type: follows
  - skill: quality-of-earnings
    type: composes_with
  - skill: scenario-planning
    type: composes_with
  - skill: stage-gate-governance
    type: composes_with
  - skill: site-infrastructure-assessment
    type: composes_with
  - skill: scenario-planning
    type: composes_with

---

## Context

`guidelines/proxy-chain-hop-classification.md` (recommended layer — a
methodology judgment call, not a hard rule) gives the classification test:
a hop with a fixed physical/engineering conversion factor (doesn't change
with market conditions) is an **engineering hop** and does not degrade the
chain grade; a hop derived from regression against historical time series is
a **statistical hop**, graded on its own R² and lead-lag defensibility. A
2-hop chain with one engineering and one statistical hop can reach Grade B —
this would have been impossible under the pre-M4 rule that penalized total
hop count. This is the design's central distinctive mechanism for the
domain (design's own stated differentiator): many target industries have no
direct market data, so demand is estimated through this proxy chain, and
chain reliability caps the confidence of every downstream conclusion.

## When to Use

- The target industry has no direct market-size data and needs a proxy-chain estimate
- Grading an existing chain's reliability
- Reviewing whether a proposed chain's hop count is actually the right metric to worry about

## Execution Steps

1. **Identify the proxy chain**: the sequence of upstream industries
   connecting a data-available industry to the target (e.g. crankshaft →
   marine engine → ship)
2. **Classify every hop** per `guidelines/proxy-chain-hop-classification.md`:
   engineering (fixed physical constant) vs. statistical (regression-derived)
3. **For statistical hops**: use `unit-conversion-calibration`'s methodology
   for the regression, recording R² and lead-lag defensibility per hop
4. **Grade the chain**: count only statistical hops — a chain with zero
   statistical hops (pure engineering conversion throughout) is the
   strongest case; grade degrades with statistical-hop count and per-hop
   R² quality, not with total chain length
5. **Cap downstream confidence explicitly**: the chain's grade caps the
   RAG data-confidence dimension — a two-hop proxy estimate cannot reach
   Green no matter how good the resulting financials look (design's
   non-negotiable boundary #4)
6. **Store separately from value-chain-linkage coefficients**: this chain's
   `proxy_link` betas are never shared with or read by
   `value-chain-linkage-analysis`'s `value_chain_link` table (ADR-0025) —
   they answer different questions
7. **Record the reference-class inputs explicitly** (v1.1.0 — reference-class
   forecasting discipline per `docs/research/readiness-gap-best-practice.md`
   Area 3): a proxy chain IS a reference class — record (a) the reference
   class used, (b) its base rate / outcome distribution, (c) the dispersion,
   and (d) the adjustment rationale for why THIS target tracks the class.
   These four are named inputs to `distributional_valuation`
   (monte-carlo-simulation consumes the dispersion as demand-driver spread,
   ADR-0052 §D.4) — an unrecorded reference class is an undocumented
   assumption, not a method

## Output Format

- Proxy chain with per-hop classification and grade, overall chain
  reliability grade (A/B/C), the resulting data-confidence cap for the RAG dimension
- Reference-class record: class used · base rate/distribution · dispersion ·
  adjustment rationale (feeds `distributional_valuation`)

## Related Skills

- `unit-conversion-calibration` — the regression methodology for statistical hops
- `value-chain-linkage-analysis` — the deliberately-separate upstream/downstream risk analysis
- `rag-scoring-framework` — where the chain grade caps the overall grade
