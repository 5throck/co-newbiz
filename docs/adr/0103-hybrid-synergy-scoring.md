# ADR-0103: Hybrid synergy scoring — rule-anchored factor engine with bounded LLM narrative

- Status: Accepted
- Date: 2026-09-04
- Deciders: New Business Review Lead (PM), per user direction
- Related: ADR-0090 (synergy alignment), ADR-0102 (e2e auto pipeline — the score engine is independent of it), ADR-0075 (credential discipline)

## Context

The synergy pipeline produced its 0-100 recommendation score in a single LLM
call. That made the score (a) disappear whenever the LLM was unavailable — the
2026-09-03 run had every input (DART financials, S1 matrices) present yet
`synergyScore: null` because the key was rejected — and (b) unexplainable and
irreproducible at IC review.

## Decision

1. **Rule-anchored factor engine** (`app/web-next/lib/synergy-score.ts`):
   four deterministic factors — market attractiveness (piecewise curve on S1
   CAGR: 0%→0, 8%→50, 35%+→100 so mature markets are not flattened), industry
   match (S1 chainDirection.relatedIndustries vs profile exposure/strengths),
   financial capacity (DART ratios), scope match. Weights renormalize over
   available factors; below two usable factors the score is fail-closed `null`
   with the missing inputs listed.
2. **Bounded LLM layer**: the pipeline layers an optional narrative plus a ±10
   adjustment with a mandatory justification on top of the rule anchor. LLM
   unavailable → rule score + template rationale (fail-degraded, never null
   when the anchor computed).
3. **Provenance**: the payload records `scoringMethod` (rule-based | hybrid),
   `synergyScoreFactors` (per-factor breakdown), and
   `synergyScoreLimitations`. The score remains a RECOMMENDATION until a human
   confirms it (boundary #2, ADR-0090).
4. Research/evaluation separation: Tavily research runs independently of the
   LLM so the degraded path still accumulates sources.

## Consequences

- `docs/adr/0102-e2e-auto-pipeline.md` is NOT the authority for this engine
  (the pipeline comments previously mis-cited it; corrected).
- Calibration history: mature-market normalization and group-rollup inputs
  fixed 2026-09-04 (CHANGELOG) after the hydraulic-breaker sample run.
