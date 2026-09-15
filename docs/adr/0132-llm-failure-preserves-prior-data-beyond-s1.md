---
lang: ko
lang_reason: source-material
---

# ADR-0132 — Extend "LLM failure preserves prior data" beyond S1 market sizing

- Date: 2026-09-14
- Status: accepted (implemented same day)

## Context

ADR-0131 fixed one instance of a systemic pattern: a re-run that suffers a genuine LLM failure mid-pipeline must not silently overwrite good prior data or advance a completion date, and the user must be told a failure happened. That fix was scoped to S1 market-sizing only. The user asked for the same principle to be applied everywhere the app calls `completeOrFallback`/`askJson` and persists the result, after confirming (via a live audit across all 9 industries) that the S1 gap was real and asking whether other surfaces had the same exposure.

An inventory of every `completeOrFallback`/`askJson` call site (20 files) split into two groups:
1. **Persists a value that can be silently overwritten** — a real instance of the ADR-0131 bug shape: `opportunity.factors_json` (S2 auto-derived factors), `opportunity.fit_verdict` (S2 fit screening), `opportunity.sketch_json` (S2 business-model sketch), `synergy_analysis`/`synergy_version` (S3), `company_profile_version` (S3 group/affiliate profiles).
2. **Computes and returns without persisting** — the various recommendation/gate-brief/monitoring-brief endpoints. These already return a `source: "llm" | "synthesis"` field in their response; a failure only degrades that one response and there is no "prior good version" to protect, so no persistence-layer change was needed there.

## Decision

Apply ADR-0131's exact distinction — protect only a **genuine failure of a configured LLM**, not the pre-existing "never configured, synthesis is the accepted mode" case — to every group-1 site:

1. **`opportunity.factors_json`** (`lib/opportunity-factors.ts`): if the existing `factors_source` is `'llm'` and a re-derive both has the LLM configured and still degrades to synthesis, `deriveAndSaveFactors` returns the untouched prior factors with `{failed: true, error}` instead of overwriting. `POST /api/opportunities/[id]/factors` passes this through; the opportunity detail page surfaces `error` via the existing error banner.
2. **`opportunity.fit_verdict`/`fit_rationale`** (`lib/opportunity-screening.ts`): new `fit_source` column (migration 0096, mirrors `factors_source`) records whether the last verdict came from the LLM. `runFitAnalysis` applies the same guard as (1).
3. **`opportunity.sketch_json`** (`app/api/opportunities/[id]/sketch/route.ts`): if the current sketch's `sketch_source` is `'llm'` and a forced regeneration degrades to synthesis while the LLM is configured, the route returns the untouched prior sketch with `{failed: true, error}` instead of inserting a new `opportunity_sketch_version` row and overwriting the pointer.
4. **`synergy_analysis`/`synergy_version`** (`lib/synergy-pipeline.ts`): identical mechanism to ADR-0131 — new `rerun_in_progress`/`error_message` columns (migration 0096) on `synergy_analysis`; rerunning an already-`completed` analysis no longer touches `status`/`completed_at` at request time; an `askJsonTracked` wrapper (same pattern as `market-sizing-pipeline.ts`) flags a genuine failure across all `askJson` calls plus the one direct `completeOrFallback` call; on a protected rerun with a genuine failure, the pipeline skips the version insert and the `opportunity.synergy_score` write entirely. The S3 list screen gains the same "재분석 중 (이전 버전 유지)" / "재분석 실패 (이전 버전 유지)" chips as S1.
5. **`company_profile_version`** (`lib/company-profile-pipeline.ts`): this pipeline is already versioned (append-only) and already tracks a `degraded` reason per version. If the latest existing version has `degraded === null` (genuinely good) and this run's `degraded` is non-null while the LLM is configured, the pipeline throws instead of inserting the degraded version — the existing `startCompanyProfilePipeline` catch handler already turns a thrown error into a `status: "failed"` job the polling route surfaces, so no new persistence-layer plumbing was needed here beyond the guard itself.

Group-2 (compute-and-return) sites are left as-is: they already report `source` in their response, and there is no persisted "prior good version" for a transient failure to threaten.

## Consequences

- The class of bug ADR-0131 fixed for S1 (a rate-limited or erroring LLM silently replacing verified analysis with degenerate placeholder data) can no longer happen for S2 factor/fit/sketch data or S3 synergy analysis either.
- Reruns performed while the LLM is simply not configured still complete with synthesis output, same as before ADR-0131/0132 — this remains the accepted, labeled degraded mode for first-time analyses and for deliberate no-LLM operation, not a silent failure.
- `company-profile-pipeline.ts`'s guard reuses the existing in-process job-status mechanism (`profileJobs` map) rather than adding new schema, since that pipeline was already versioned and already tracked a per-version degradation reason.
- Migration 0096 is additive-only (four new nullable/defaulted columns across `opportunity` and `synergy_analysis`); no existing data is rewritten.

## Related

ADR-0131 (the S1 precedent this generalizes), ADR-0128 (LLM call ledger), ADR-0127 (opportunity sketch versioning), ADR-0093 (company profile schema v2/v3).
