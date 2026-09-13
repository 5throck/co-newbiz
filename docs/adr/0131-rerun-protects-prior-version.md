# ADR-0131 — Re-analysis must not silently overwrite a good prior version on LLM failure

- Date: 2026-09-13
- Status: accepted (implemented same day)

## Context

User-reported on the live 휴머노이드 로봇 (humanoid robot) S1 market analysis report: the "growth rate" summary card showed a nonsensical value, and the underlying matrix (anchor total, region×segment baseline, CAGR) turned out to be entirely degenerate placeholder data (`anchor.total: 1`, `baseline2026` all zero, flat `cagrBase: 0.05`). Root-cause investigation (`llm_call_log`) showed every step of that analysis run used `source: 'synthesis'` — the deterministic fallback that `completeOrFallback` (`lib/llm.ts`) returns when the configured LLM provider is unavailable or a call fails, rather than the real LLM output.

The rerun endpoint (`analyses/[id]/rerun/route.ts`) immediately set `status='in_progress', completed_at=NULL` on the analysis row before the pipeline even started running. Because every "latest analysis" read query across the app gates on `market_sizing_analysis.status = 'completed'`, this had two consequences:
1. During the rerun window, the industry appeared to have *no* completed analysis at all, even though a perfectly good previous version was sitting in `market_sizing_version`.
2. If the pipeline finished — even with entirely synthesized, degenerate output, because `completeOrFallback` never throws (it always returns *something*) — it unconditionally wrote `status='completed', completed_at=now`, silently replacing the last good version with garbage and advancing the analysis date as if a real re-analysis had succeeded.

This is exactly the scenario the user asked to be protected against: an LLM outage mid-run should not corrupt or hide previously-good data, and a run that didn't genuinely complete should not update the analysis date.

## Decision

1. **`rerun_in_progress` column** (migration 0095, additive) on `market_sizing_analysis`, independent of the existing `status`/`completed_at` fields.
2. **Rerunning an already-`completed` analysis no longer touches `status`/`completed_at`** at request time — it only sets `rerun_in_progress=1` and clears `error_message`. Every existing "latest completed version" query continues to serve the untouched prior version for the whole duration of the run, with no changes needed to those queries. Reruns of a `failed` (never-succeeded) analysis keep the pre-existing immediate `status='in_progress'` behavior, since there is no good prior state to protect.
3. **Genuine-failure detection inside `runSizingPipeline`**: `isLlmConfigured()` is checked once at the top of the run. Each of the pipeline's ~15 `askJson` calls is wrapped (`askJsonTracked`) to flag `hadLlmFailure` when the LLM was configured but the call still returned `null` (an actual API error or unparseable response) — as opposed to `askJson` legitimately falling back because the LLM was never configured to begin with, which remains today's accepted, labeled synthesis mode.
4. **Quality gate at pipeline completion**: if this was a protected rerun (the analysis row's `status` is still `'completed'` at this point, proving request-time didn't touch it) *and* `hadLlmFailure` is true, the pipeline does **not** insert a new `market_sizing_version` row and does **not** touch `status`/`completed_at` — it only clears `rerun_in_progress` and records `error_message`. The previous version and its completion date remain exactly as they were. Otherwise (first-time analysis, or a rerun that completed reliably), the existing behavior applies: insert the new version and advance `status='completed', completed_at=now` — the "swap" only happens on a verified-reliable success.
5. **UI**: the S1 industry list shows a distinct amber "재분석 중 (이전 v{N} 유지)" chip while `rerun_in_progress=1`, and a red "재분석 실패 (v{N} 유지)" chip when `status='completed'` carries a non-null `error_message` from a just-failed protected rerun — both without disturbing the currently-open report, which keeps rendering the last good version.
6. **Report-level warning banner**: independent of the above (covers pre-existing corrupted versions and first-time analyses, which have no prior version to protect and so still complete with synthesized data by design), the report now shows an explicit red warning when any step's `stepSummaries[].source !== 'llm'`, instead of silently omitting the positive "8단계 전체 LLM 요약 사용" note as before.

## Consequences

- A mid-run LLM outage during a rerun of a previously-good analysis can no longer corrupt or hide that data, and the analysis date only ever advances on a verified-reliable completion.
- First-time analyses (nothing to protect) and reruns of a `failed` analysis are unaffected — they retain today's behavior, including the possibility of completing with synthesized placeholder data when no LLM is configured (an intentional, pre-existing, labeled mode used elsewhere in the app).
- The already-corrupted 휴머노이드 로봇 v5 (created before this fix existed) is not retroactively repaired — a genuine re-analysis is still required once the LLM provider's rate limit resets, and this ADR's own protection mechanism was verified live against that exact outage during implementation.
- Deferred: applying the same protection to the linked-industry serial queue's dependent analyses (ADR-0130), which today still use the pre-existing first-time-analysis path.

## Related

ADR-0128 (LLM call ledger — `llm_call_log`, the mechanism this ADR's failure detection reads), ADR-0130 (linked-industry serial queue, a related but distinct in-flight-analysis concern).
