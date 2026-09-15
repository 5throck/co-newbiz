---
lang: ko
lang_reason: source-material
---

# ADR-0077: Dynamic final-demand segments in systematic-market-sizing

**Status**: Accepted — implemented in the pipeline and report UI in the same change
**Date**: 2026-08-31
**Deciders**: user (standing directive), market-intelligence-agent (methodology owner)
**Design of record**: `app/web-next/lib/market-sizing-pipeline.ts` (step 1/3/4), `app/web-next/lib/market-sizing.ts` (`SizingMatrix.segments`, `segmentsOf()`), `/market` report components

## Context

The market-sizing matrix schema was shaped by its first subject, the frozen hydraulic-breaker
analysis: every industry was forced into the fixed final-demand segment trio
**construction / mining / other**. The pipeline's LLM prompts literally demanded
"6개 권역 × construction/mining/other", and the report UI (segment-mix chart, region×segment
table, CAGR chart, scenario bands, 2030 projection) iterated the global `SEGMENTS` constant.

Result: a 휴머노이드 로봇 analysis reported "최종수요 세그먼트: 건설 / 광산 /
기타·철거·리노베이션 (3개)" — a hydraulic-breaker segment plan transplanted onto an industry
whose actual demand sides are manufacturing, logistics/warehouse, services, etc. The segment
axis is the foundation of every downstream number (region weights, mixes, per-cell CAGRs,
scenario bands), so a wrong axis invalidates the whole matrix.

Alternatives considered: (a) per-industry segment presets in code — rejected, every new
industry would need a code change and the pipeline is supposed to be agentic; (b) free-form
segment labels without codes — rejected, cells and band overrides need stable keys
(`region|segment`) for versioning and overrides.

## Decision

1. **Segments are defined per analysis, not globally.** Pipeline step 1 (시장 구조 정의) now
   also asks the LLM to propose 2–4 final-demand segments for THIS industry
   (`{code: short_english_snake, label: 한글명}`), with an explicit instruction not to reuse
   construction/mining/other unless genuinely applicable. The proposal is recorded verbatim as
   LLM-estimate provenance — validation stays with the analyst.
2. **Fallback, never a hard dependency**: if the LLM proposes fewer than two valid segments,
   the pipeline falls back to the default `SEGMENTS` trio so the 8-step run always completes.
3. **Codes remain the stable key.** Segments are stored on the matrix as
   `segments: [{code, label}]`; `baseline2026`/`cagrBase`/`mix`/`bandOverrides` stay
   code-keyed (`region|segment`), so run versioning (ADR-0005) and band overrides keep
   working unchanged.
4. **Schema loosened, not broken**: `SizingMatrix.segments` is optional; `segmentsOf(matrix)`
   returns the matrix's segments or the default trio. The frozen hydraulic-breaker matrix
   (no `segments` field) renders exactly as before. Typed helpers (`bandFor`, `regionTotal`,
   `global2026`, `projection2030`) and the report UI now derive the segment list from the
   matrix, including the region table's dynamic per-segment columns.
5. **Existing persisted analyses keep their old matrices** (they contain no `segments` field
   and the old construction/mining/other cells). They remain renderable; running **재분석**
   regenerates the matrix under the new dynamic-segment pipeline as a new version.

## Consequences

- **Positive**: the segment axis reflects each industry's real demand structure; new
  industries need no code change; the schema stays backward-compatible with all persisted
  matrices.
- **Risk accepted**: LLM-proposed segments are estimates until the analyst confirms them
  (same honesty discipline as every other pipeline step — pendingInputs and provenance notes
  apply). Segment quality gates on the step-1 summary, which lists the proposed segments
  explicitly.
- **Migration**: no schema migration (JSON payloads inside `market_sizing_version`). Old
  matrices are valid; re-analysis is opt-in per industry.
