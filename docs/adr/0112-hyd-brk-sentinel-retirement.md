---
lang: ko
lang_reason: source-material
---

# ADR-0112: Retire the HYD-BRK freeze sentinel — the hydraulic-breaker report becomes a regular persisted analysis version

- Status: Accepted
- Date: 2026-09-10
- Deciders: New Business Review Lead (PM)
- Deciders note: owner judged the freeze setup "the wrong direction"; this ADR records the retirement and the standard-path replacement. Supersedes the sentinel allowance of ADR-0111 and the frozen-showcase behavior of the S1 report.
- Related: ADR-0111 (nullable ksic_code, whose sentinel allowance is hereby revoked), ADR-0066/0077 (chain scenarios, assumption registry), design guide §1 P3 ("one source per fact")

## Context

The 유압브레이커 industry carried `ksic_code = 'HYD-BRK'` — a marker string in
the classification column — and its market-sizing report was rendered from a
hardcoded frontend constant (`HYD_BRK_MATRIX` in `lib/market-sizing.ts`),
with three special-case branches keyed on the sentinel: the report view's
`isFrozen` path, the insights API's bottom-up-CAGR constant supplement, and
the input-validation allowlist. The showcase had real value (a genuine,
Epiroc-calibrated golden-sample report), but the mechanism violated the
project's own rules: P3 says values render from persisted records, never
from code; and a fake value in a real column is exactly the pattern the
`NEW-*` cleanup (ADR-0111, migration 0078) removed. Editing the report
required a code change and redeploy.

## Decision

1. **The report becomes data.** The matrix is persisted as a regular
   `market_sizing_version` payload (`provenance: 'frozen-research'`) via
   `scripts/co-newbiz/backfill-hyd-brk-report.ts` — idempotent, re-run safe:
   it finds the industry, ensures a completed analysis, appends a version
   carrying the matrix unless the latest version already has one, and marks
   the analysis completed. The report view renders it through the normal
   version-loading path; the version changelog records the research-doc
   authorship.
2. **No industry-based branching remains.** `isFrozen` disappears from the
   report view and the insights API; the UI's "연구문서 기반 수동 분석 vs
   8단계 파이프라인 산출" distinction derives from the matrix's own
   `provenance` field. The step-8 registry panel keys on the assumptions'
   `run_label` (`REGISTRY.runLabel`) — data, not a sentinel.
3. **The sentinel is retired.** Migration 0080 remaps
   `ksic_code = 'HYD-BRK'` to the real KSIC **29241** (건설 및 채광용 기계장비
   제조업 — verified via DART-registered induty codes of Soosan-group breaker
   affiliates, e.g. 수산서비스 = 29241); if 29241 is already owned the row
   falls back to NULL (미지정). `parseKsicInput` no longer accepts any
   non-numeric value. `HYD_BRK_MATRIX`/`SIZING_SOURCE_DOC` are removed from
   the runtime bundle — the backfill script is their only home.
4. The chain-scenario seed script (`seed-hydraulic-breaker-matrix.ts`,
   v1.1.0) now looks the industry up by KSIC 29241 and migrates any legacy
   sentinel row it encounters.

## Consequences

- Updating the breaker report is a data change (append a new version), not a
  code change; the golden sample survives as an ordinary version.
- `ksic_code` no longer contains any fabricated values — the /market column
  shows real codes or "—" only.
- Fresh environments show the breaker report only after the backfill script
  runs once (same operational class as the other seed scripts; deployment
  runbook covers seeding).
- The insights bottom-up CAGR comes from the persisted matrix payload; the
  constant supplement is gone.
- A row that could not be remapped due to a 29241 collision ends up NULL and
  can be assigned any code through the normal inline editor.
