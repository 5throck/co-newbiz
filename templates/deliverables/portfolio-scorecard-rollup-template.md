---
governance_doc_id: tpl-portfolio-scorecard-rollup
layer: template
title: "Portfolio Scorecard Rollup Template"
scope: shared
enforceability: recommended
owner_agent: docs-writer
version: "1.0.0"
effective_from: "2026-08-23"
output_type: portfolio_scorecard_rollup
lang: en
counterpart: portfolio-scorecard-rollup-template_ko.md
---

<!--
  output_type: portfolio_scorecard_rollup — "Portfolio monitoring —
  bifurcated financial/strategic metrics rollup over the venture portfolio
  (ADR-0052 §E.1)". Produced by portfolio-venture-monitoring step 1
  (group-review-agent / portfolio-fit-assessment). Field shape mirrors
  ADR-0059's venture_scorecard table (run-scoped, review-cycle time-series,
  venture_class breakdown, per-measure target REQUIRED). The 20-30% CVC
  benchmark odds are ILLUSTRATIVE. ~20 measures per section family is the
  cap; a measure without a target is invalid (status insufficient_evidence
  instead).
-->

# Venture Portfolio — Scorecard Rollup

**Run ID**: [run_id] · **Review cycle**: [review_cycle] · **Portfolio scope**: [ventures in scope this cycle, with venture_class each: driving / enabling / emergent / passive / jv] · **As of**: [as_of]

## 1. Financial section

| venture_class | Venture | Measure | Target | Actual | Status | Evidence (ADR-0058 ref) |
|---|---|---|---|---|---|---|
| [class] | [venture] | [e.g. IRR vs hurdle spread / cash-on-cash / capital deployed vs milestone plan / revenue growth / stage-normalized valuation mark] | [target] | [actual] | on_target / deviation / insufficient_evidence | [ref] |

## 2. Strategic section

| venture_class | Venture | Measure | Target | Actual | Status | Evidence (ADR-0058 ref) |
|---|---|---|---|---|---|---|
| [class] | [venture] | [e.g. introductions delivered / learning progressing to products-partnerships-JVs (leading vs lagging) / stage-progression rate / kill-graduate counts] | [target] | [actual] | [status] | [ref] |

## 3. Class rollup (report by class — do not flatten)

| venture_class | Count | on_target | deviation | insufficient_evidence | Note |
|---|---|---|---|---|---|
| driving / enabling / emergent / passive / jv | [n] | [n] | [n] | [n] | [class-level reading] |

## 4. Benchmark frame (ILLUSTRATIVE)

20-30% CVC success odds — funding a venture beyond what that band implies requires explicit evidence stated here: [evidence or "n/a"].

## 5. Inputs & provenance

- Gate `gate_pass_record` outputs in scope this cycle: [refs]
- JV scorecards feeding in (jv-lifecycle step 2): [refs]
- PMI synergy tracker inputs (where applicable): [refs]

## Sign-off

| Role | Key | Surface |
|---|---|---|
| Recorder — group-review-agent | [key] | [checked scope] |
| Feeds | portfolio-venture-monitoring step 2 (evidence pack) → step 3 (human IC decision) | — |
