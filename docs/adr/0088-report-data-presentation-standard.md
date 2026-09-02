# ADR-0088: Report data-presentation standard — charts, bullets, wide-table handling

**Status**: Accepted — implemented in the same change (styles.css primitives, synergy report rework)
**Date**: 2026-09-01
**Deciders**: user (standing directive), frontend-engineer (implementation), design-system-agent (review)
**Design of record**: `app/web-next/styles.css` (`table-scroll`, `report-table`, `report-bullet-list`, `report-chart-card`), `app/web-next/design/design-tokens.json` (reportDataPresentation)
**Pattern**: P2 Report (ADR-0086)

## Context

The synergy report (S3) surfaced three recurring readability defects of generated reports:
(1) financial time-series rendered as a long per-row table (계정×연도×금액×출처 — dozens of
rows, no trend visibility), (2) multi-sentence list content (강점/약점) rendered as dense
text blocks, (3) five-column narrative tables (연계 시너지 영역) squeezing long text into
narrow columns. These are generic P2-Report presentation issues, not synergy-specific —
every analysis report (S1/S8/S9) renders the same payload shapes.

## Decision

1. **Time-series numbers**: render a chart first (grouped bars, one series per year, token-
   themed) with a pivot table beside/below it — accounts as rows, years as columns
   (newest first). Long account-per-row listings are retired.
2. **Long-text lists**: bullet lists (`.report-bullet-list` — disc markers, 0.45rem item
   gap) instead of paragraph blocks.
3. **Wide tables**: four-or-more-column tables with narrative cells are wrapped in
   `.table-scroll` (horizontal scroll instead of squeeze) with column minimum widths
   (`col-label` 10rem / `col-type` 6rem / `col-text` 16rem).
4. **Units and provenance always visible**: amounts carry unit labels (억원) and a source
   chip/link (DART) next to the data, and numeric-integrity warnings (e.g. ADR-0087-era
   summation checks) render as a warning banner beside the data.

The standard is registered in `design-tokens.json` (reportDataPresentation), the review
checklist (§F 데이터 표현), and the P2 pattern definition — so all current and future
reports (S1, S8, S9) inherit it, not just the synergy report.

## Consequences

- Reports gain trend readability and stop truncating/squeezing; the synergy report is the
  reference implementation.
- Chart rendering requires the shared ECharts wrapper and theme tokens; report tabs that
  opt out of charts still owe the pivot-table and bullet/wide-table rules.
