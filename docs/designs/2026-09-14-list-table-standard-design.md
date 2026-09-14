# Design: list-table standard — one implementation pattern for row-action tables

- Date: 2026-09-14
- Status: implemented
- Related: ADR-0088 (table alignment), docs/design-system/design-components.md, design-lint, 2026-09-14-s2-funnel-table-density-design (supersedes the S2-only fix)

## Problem

User report: the S1 `산업 목록` and S2 `기회 퍼널` lists looked inconsistent — "`두 화면의 UI 구현방식이 달라서 헷갈린다`" — and predicted similar defects would
recur without a standard.

Survey of every row-action table in the app (`.data-table` containing
`.sizing-actions-cell` — 7 tables in 6 files) found two implementation styles
and several latent defects:

| Surface | Defect |
|---|---|
| S1 `분석 대상 산업` (market) | no column widths (auto layout → `산업명` absorbed all leftover width, actions drifted past the header row on wide screens); actions column had NO header |
| S2 `기회 퍼널` (opportunities) | fixed by the previous S2-only patch — but under a one-off `.opportunity-table` class, not a standard |
| `계열사 목록`` (our-company) | actions header visually empty (`sr-only `관리`) |
| `시너지 분석 목록` (synergy) | actions column had no header at all |
| `우선 시너지 영역` (synergy) | conditional actions header rendered empty |
| `관리자 사용자` (admin) | no widths (same stretch failure mode, latent) |
| `관리자 사업목표` (admin) | actions header labeled `액션` with an inline right-align inconsistent with every other screen |

Root cause: the design system documented `.data-table` alignment (ADR-0088) but
no layout or header contract for list tables, so each screen improvised.

## Approach

### Standard (docs/design-system/design-components.md, EN + KO)

Any `.data-table` that renders per-row actions is a **list table** and must:

1. carry the `list-table` modifier class — fixed column layout capped at
   64rem, so the primary label column cannot absorb all leftover width;
2. give every column except the primary label an explicit width class;
3. head EVERY column, actions column header being `작업`;
4. let long status chips wrap inside their column (`.list-table .status-chip`
   drops the global nowrap) instead of overflowing fixed columns.

design-lint v1.2.0 enforces 1 and 3 mechanically (table-block scan:
`data-table` + `sizing-actions-cell` ⇒ `list-table` class present and thead
contains `작업`).

2026-09-15 follow-up (user report: `분석일` folded onto two lines —
"2026-09-" / "14" — in the 6rem columns assigned by this pass): date columns
carry the new `col-date` class (`styles.css`, scoped to `.data-table` /
`.report-table`): 7rem standard width + `white-space: nowrap`. Applied to the
date columns of all five list tables that have one (synergy `분석 목록`,
our-company `계열사 목록`, market `분석 대상 산업`, admin `사용자` `가입일`, admin
`사업목표` `등록일`) — th for the width, td for the nowrap.

2026-09-15 follow-up #2 (user report: the visible `작업` actions header hurts
readability — row buttons are self-evident): all 10 action-column headers in
the app now render `sr-only` `작업` instead of visible text. The column keeps
its header for screen readers (design-lint check #5 still passes on the
sr-only text); sighted readers see an empty header cell above the buttons.
Column widths stay on the th, so the fixed layout is unaffected.

### Application — all 7 row-action tables

- opportunities `기회 퍼널` / market `분석 대상 산업` / our-company `계열사 목록` /
  synergy `분석 목록` / synergy `우선 시너지 영역` / admin `사용자` / admin `사업목표`:
  `.list-table` applied; explicit widths chosen per column profile; action
  headers unified to visible `작업` (replacing `sr-only` `관리`, an empty th, and
  `액션`+inline-align).
- The S2-only `.opportunity-table` class from the previous patch is retired in
  favor of the shared `.list-table`.
- Conditional action columns (synergy curation table gates both th and td on
  `canCurate`) keep column counts consistent under fixed layout.
- `admin` users table's expanded row is `colSpan={5}`, so the nested token
  table is unaffected by parent column widths.

Out of scope: report/summary tables without row actions (S4 `근거`, synergy
`리포트` etc.) — full-width text tables are legitimate; only row-action lists
follow this standard.

2026-09-15 follow-up #3 (user report: the market table's `분석 상태` folded —
`재분석 중 (4/8단계, 이전 v7 유지)` is the longest status chip in the app at
~13.6rem): that column widened 13rem → 15rem so the longest chip fits on one
line. Other tables' status chips are shorter and keep their widths.

## Verification

- `bun run design:lint` (with new check #5) — no violations; the check alone
  flags all 7 pre-fix tables when reverted (validated against the survey).
- `bunx tsc --noEmit` clean; `bun run test:unit` full suite green.
