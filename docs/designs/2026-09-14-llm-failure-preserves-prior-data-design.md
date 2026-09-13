# Design: LLM failure preserves prior data (beyond S1)

- Date: 2026-09-14
- Status: implemented
- Related: [ADR-0132](../adr/0132-llm-failure-preserves-prior-data-beyond-s1.md), [ADR-0131](../adr/0131-rerun-protects-prior-version.md)

## Problem

ADR-0131 fixed S1 market-sizing: a rerun that hits a genuine LLM failure (provider configured, call still errors) must not silently overwrite an already-good prior version, and the user must be told. That fix was scoped to one pipeline. The user asked for the same principle everywhere the app persists an LLM-derived value, after confirming live that a second S1 industry (`건설·광산 중장비 제조 산업`) was partially degraded with zero indication anywhere in the list screen.

## Scope

Audited all 20 `completeOrFallback`/`askJson` call sites in `app/web-next`. Split into:
- **Persists a value that can be silently overwritten** (real risk): `opportunity.factors_json`, `opportunity.fit_verdict`, `opportunity.sketch_json`, `synergy_analysis`/`synergy_version`, `company_profile_version`.
- **Computes and returns without persisting** (no risk — already reports `source` in the response, no "prior good version" to protect): the various recommendation/gate-brief/monitoring-brief endpoints.

## Approach

Applied ADR-0131's exact mechanism to each persist-risk site — see ADR-0132 for the per-site decision. Two additional changes outside that scope:
1. `GET /api/market-overview` now classifies each industry's latest version's `stepSummaries[].source` mix (`all_synthesis`/`partial_synthesis`) and the S1 list shows a distinct chip, closing the "list screen shows no problem" gap that motivated this work.
2. Migration 0096 (additive): `opportunity.fit_source`, `synergy_analysis.rerun_in_progress`, `synergy_analysis.error_message`.

## Verification

- `bunx tsc --noEmit` clean.
- `bun test tests/unit/opportunity-sketch.test.ts tests/unit/synergy-score.test.ts` — 13/13 pass.
- Migration 0096 verified on a scratch DB copy before applying to the dev DB.
- Live browser check: S1 list shows the new red/amber chips for the four known-degraded industries; S3 synergy list and S2 opportunity detail pages render unaffected.
