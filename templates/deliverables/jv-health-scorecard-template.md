---
governance_doc_id: tpl-jv-health-scorecard
layer: template
title: "JV Health Scorecard Template"
scope: shared
enforceability: recommended
owner_agent: docs-writer
version: "1.0.0"
effective_from: "2026-08-23"
output_type: jv_health_scorecard
lang: en
counterpart: jv-health-scorecard-template_ko.md
---

<!--
  output_type: jv_health_scorecard — "JV lifecycle monitor — seven-dimension
  health scorecard; weights/cadence DECIDED by
  docs/decisions/2026-08-24-class-c-decisions.md (b)".
  Produced by jv-lifecycle-governance step 2 (partnership-agent /
  project-review). Field shape mirrors ADR-0059's venture_scorecard table
  (section/measure/target/actual/status + evidence_ref) so a filled
  scorecard maps 1:1 onto rows now that the E.4 migration has landed.
  Weights: EQUAL/UNWEIGHTED dimension scores with per-dimension red-flag
  thresholds (Ankura/Watermark flat-rollup precedent); differential weights
  revisited after 4-6 quarters of accumulated cycles on cross-case evidence.
  Cadence: QUARTERLY scoring cycle feeding the quarterly JV board; annual
  deepening layer; triennial external governance review; event-driven
  re-score on defined triggers. Record raw assessments, not weighted
  composites — the flat-rollup rule stands until a calibration-backed
  amendment changes it.
  ~20 measures across the card is the cap (balanced-scorecard discipline).
-->

# [JV Name] — Health Scorecard

**Run ID**: [run_id] · **Project**: [project_id] · **Review cycle**: [review_cycle] · **venture_class**: jv · **As of**: [as_of]

## Seven dimensions (jv-lifecycle-governance step 2)

Per dimension: 2-3 measures. Every measure carries a target — a measure without a target is invalid; if the target is undetermined for THIS JV, status MUST be `insufficient_evidence`, not a guessed grade.

| Dimension | Measure | Target | Actual | Status | Evidence (ADR-0058 ref) |
|---|---|---|---|---|---|
| Performance | [measure] | [target] | [actual] | on_target / deviation / insufficient_evidence | [ref] |
| People | [measure] | [target] | [actual] | [status] | [ref] |
| Partner alignment | [measure] | [target] | [actual] | [status] | [ref] |
| Decision health | [measure] | [target] | [actual] | [status] | [ref] |
| Milestones & funding | [measure] | [target] | [actual] | [status] | [ref] |
| Governance health | [measure] | [target] | [actual] | [status] | [ref] |
| Value-distribution symmetry | [measure] | [target] | [actual] | [status] | [ref] |

## Deviation notes (trend-and-trigger, not one-off rating)

For every `deviation`: [what changed vs. last cycle · trigger implication — does any metric-tied restructuring trigger (step 4 menu) become live? · corrective path and owner]

## Cadence & review

- **This review cycle**: [cycle — quarterly per the (b) decision] · **Independent external governance review**: every 3 years (decided cadence layer)
- **Feeds**: the annual strategic asset review (step 3) and the Section E portfolio rollup (portfolio-venture-monitoring step 1)

## Sign-off

| Role | Key | Surface |
|---|---|---|
| Recorder — partnership-agent | [key] | [checked scope] |
| Human reviewer (if designated this cycle) | [registry key] | verified / could not verify / needs judgment |
