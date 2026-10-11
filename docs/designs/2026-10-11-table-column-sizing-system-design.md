---
title: Table column sizing system - percentage colgroup presets, shared fixed-pct rule, regression guard
status: approved
date: 2026-10-11
owner: platform-lead
domain: technical
---

# Table column sizing system

Source: logged-in browser audit on 2026-10-11 (1280 px vs 1024 px). "Absorption" = the share of the
table-width change taken by a single column. Base pattern: PR 509 (`MEMBER_COL_PCT`,
`COMPETITOR_COL_PCT` in `components/stages/our-company/constants.ts`, rendered as a percentage
`<colgroup>` in `MembersPanel.tsx`). This design generalises that pattern; it does not redo it.

All changes are display-layer only (JSX + `app/styles.css` + one test + one lint rule). Korean UI
strings are not touched. Design doctrine: Onyx 3.0 (`docs/design-system/design-guide.md`) - shared
components over new ones, tokens only, no colour-only state.

**ADR assessment**: none required. No DB schema, auth, MCP tool scope, policy or procedure change.

## 0. Problem

About 125 `<table>` markups, no `<colgroup>` outside PR 509, no shared table component. Widths come
from per-`th` rem classes or `auto`. Two failure modes:

1. **Single-column absorption** - under `table-layout: fixed` with all-but-one fixed rem widths, the
   one `auto` column takes 100% of any width change (s2 funnel, dd checklist, PAT table). Under
   `table-layout: auto`, the column with the longest content takes 70-99% (greenfield decision history,
   s4 competitive structure, agents roster).
2. **Unwrapped overflow** - the s6/s7 pre-review / committee recommendation table is 1424 px wide with
   no `.table-scroll`, so it crosses its wrapper.

Target behaviour: every column keeps a stable share of the table width; the table scrolls inside
`.table-scroll` below a declared minimum width instead of crushing a column.

## A. Shared mechanism

### A.1 `ColGroup` helper

New export in `app/web-next/components/ui.tsx` (no new file; ui.tsx already hosts the shared
primitives):

```tsx
export function ColGroup({ widths }: { widths: readonly number[] }) {
  if (process.env.NODE_ENV !== "production") {
    const sum = widths.reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 100) > 0.01) throw new Error(`ColGroup: widths sum to ${sum}, expected 100`);
    if (widths.some((w) => !Number.isFinite(w) || w <= 0)) throw new Error("ColGroup: every column needs a positive percentage");
  }
  return <colgroup>{widths.map((w, i) => <col key={i} style={{ width: `${w}%` }} />)}</colgroup>;
}
```

- Widths are numbers only; there is no way to express `auto`, which is the point.
- Presets live next to the screen as `const X_COL_PCT = [..] as const` (PR 509 convention), so the
  column count stays visible beside the JSX. A dev-only check that `widths.length` equals the header
  cell count is done by the guard test (A.5), not at runtime.
- PR 509's inline `MEMBER_COL_PCT.map(...)` is switched to `<ColGroup widths={MEMBER_COL_PCT} />` in
  batch 1 (pure refactor, identical DOM).

### A.2 CSS rule set

One rule in `styles.css`, next to `.list-table`:

```css
.table-fixed-pct { table-layout: fixed; width: 100%; min-width: var(--table-min, 40rem); }
.table-fixed-pct.tmin-32 { --table-min: 32rem; }
.table-fixed-pct.tmin-40 { --table-min: 40rem; }
.table-fixed-pct.tmin-48 { --table-min: 48rem; }
.table-fixed-pct.tmin-56 { --table-min: 56rem; }
.table-fixed-pct.tmin-64 { --table-min: 64rem; }
.table-fixed-pct.tmin-80 { --table-min: 80rem; }
```

- Modifier tokens, not inline `style`, so design-lint can see them and values stay on a 8 rem scale.
- Always used inside `.table-scroll` (existing: `overflow-x: auto; max-width: 100%`). Below
  `--table-min` the table scrolls; above it, percentages hold.
- The existing generalisation `.table-scroll .data-table { width: max-content; ... }` (styles.css
  ~3763, mobile block) must not apply to fixed-pct tables. Add the exclusion
  `.table-scroll .data-table:not(.table-fixed-pct)` there; otherwise max-content would re-enable
  content-driven widths on mobile.
- Composes with `.data-table` (typography, borders, header style) and `.list-table` (max-width cap).
  `.list-table` keeps `max-width: 64rem` for list screens; a fixed-pct table that should use the full
  content width simply omits `.list-table`.

### A.3 Bespoke variants: migrate, then delete

Decision: **migrate and delete** the rem width rules; keep only the class names that still carry
non-width styling.

| Class | Action |
|---|---|
| `.opp-funnel-table` | Delete rule (`max-width 80rem; min-width 56rem`); markup becomes `list-table table-fixed-pct tmin-56` + `ColGroup`; raise `.list-table` cap with an inline-free modifier `.list-table.list-wide { max-width: 80rem; }` |
| `.synergy-list-table` | Same as funnel (`list-wide tmin-56`); preset derived in batch 2 from its current th rem sums (proportional) |
| `.market-list-table` | Keep `max-width: 72rem` as `.list-table.list-mid`; th rem classes replaced by a proportional preset (batch 3, low priority - already stable since all th are fixed) |
| `.members-list-table` | Already PR 509; only the `ColGroup` refactor |
| `.dd-table` | Delete `.dd-col-*` width rules and `min-width` (now `tmin-48`); KEEP the mobile card-stack block (thead clip, block rows, `data-label`) - it is layout, not sizing |

Rationale: thin aliases would keep two sources of truth for width; the guard test (A.5) can only
enforce one.

### A.4 Cell rules

| Column role | Rule |
|---|---|
| Identifier / name (first column, company, item) | `.cell-truncate`: `overflow: hidden; text-overflow: ellipsis; white-space: nowrap;` + `title={fullText}` on the cell. Link stays focusable; the ellipsis never hides the only link text from AT because `title` and the link text are the full string. |
| Free-text (rationale, notes, evidence) | Wrap allowed: `.cell-clamp-3`: `display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere;` with a `<details>`-style "show more" only where text routinely exceeds 3 lines (greenfield decision history). |
| Numbers / dates / short enums | Existing `col-num` / `col-date` / `col-label`: nowrap, right-align numbers, tabular-nums. A preset must give these enough % that nowrap fits at `--table-min`. |
| Status chips | Existing `.list-table .status-chip { white-space: normal; }` stays. |
| Actions | Buttons wrap to a second line inside the cell (`flex-wrap: wrap; gap`), never overflow. Buttons keep `min-height: 2.75rem` (44 px touch target, Onyx 3.0). |

Header alignment: `th` takes the same alignment class as its column cells (`col-num` on both). The
`/strategy` table gains `.data-table` so header styling matches.

### A.5 Regression guard

**Unit test** `app/web-next/tests/table-sizing.test.ts` (bun test, static scan of `app/` and
`components/` `.tsx`):

1. Every `<table` must have a `.table-scroll` ancestor element in the same JSX file (heuristic: the
   nearest enclosing JSX element chain within 15 lines contains `table-scroll`), or be allowlisted.
2. Every `<table` whose className contains `table-fixed-pct` must contain a `<ColGroup` child, and
   the preset length must equal the count of `<th` in its first header row (best-effort parse;
   mismatches reported with file:line).
3. A `<table` with neither `table-fixed-pct` nor an allowlist entry, and with more than 3 header
   cells, fails only if it is in the offender list below (ratchet). New tables of 4+ columns must
   opt in or be allowlisted with a reason.
4. No `width: auto` / `width: 100%` declared on a column class (`th`/`col-*`) in `styles.css`
   (catches the `pat-col-label` pattern).

Allowlist lives in the test as `CONTENT_SIZED_TABLES: Array<{ file: string; className: string; reason: string }>`.

**design-lint rule** (Row 4, `scripts/co-newbiz/design-lint.ts`): `table-sizing/fixed-pct-needs-colgroup`
and `table-sizing/no-bare-wide-table` (a table of 6+ `th` not inside `.table-scroll`), reporting the
same conditions at lint time so authors see them before tests run.

## B. Presets

Presets are derived from the 1280 px measured widths, rounded to whole percent, then adjusted so
nowrap columns fit at `--table-min`. Implementer re-measures and may move any value by up to 3 pp;
larger changes are a design change.

| # | Table (file area) | Columns (in order) | Preset % | Min |
|---|---|---|---|---|
| 1 | s2 opportunity funnel | name, stage, score, owner/date, actions | 34 / 14 / 12 / 16 / 24 | tmin-56 |
| 2 | /greenfield decision history | date, decision, decider, rationale | 14 / 16 / 14 / 56 | tmin-48 |
| 3 | /greenfield required-capability check | capability, required level, current, gap, note | 30 / 14 / 14 / 14 / 28 | tmin-48 |
| 4 | project dd checklist (dd-table) | item, required, judgement, actions | 44 / 9 / 17 / 30 | tmin-48 |
| 5 | s4 competitive structure | company, share, positioning, strength, weakness | 20 / 12 / 30 / 19 / 19 | tmin-56 |
| 6 | /agents roster | name, domain, role, tier, model | 20 / 14 / 40 / 12 / 14 | tmin-48 |
| 7 | personal API token | label, prefix, created, last used, expires, action | 28 / 16 / 14 / 14 / 14 / 14 | tmin-48 |
| 8 | project ic-review establishment status | item, status, owner, date, note | 34 / 16 / 16 / 14 / 20 | tmin-48 |
| 9 | project backtest | metric, predicted, actual, error, note | 30 / 15 / 15 / 12 / 28 | tmin-48 |
| 10a | /deals aging | deal, stage, days in stage, owner, next action | 30 / 16 / 12 / 16 / 26 | tmin-48 |
| 10b | /pipeline | same column roles as 10a | 30 / 16 / 12 / 16 / 26 | tmin-48 |
| 11 | s6/s7 Long List | candidate, country, revenue, fit, screening, action | 26 / 12 / 14 / 14 / 18 / 16 | tmin-56 (removes the 40 px squeeze) |
| 12 | project charter KPI | KPI, target, baseline, unit, owner | 40 / 16 / 16 / 12 / 16 | tmin-40 |
| 13 | s6/s7 pre-review / committee recommendation | per column; preset fixed in batch 1 from its 1424 px natural widths scaled to 100 | proportional | tmin-80 inside new `.table-scroll` |
| 14 | /strategy | add `.data-table`; preset in batch 3 | proportional | tmin-40 |

Column names above are role descriptions from the audit; if the real header order differs, the
implementer keeps the percentages attached to the role, not the position.

### B.1 Content-sized allowlist

| Table | Reason |
|---|---|
| `.param-table` (WACC parameters and other key-value tables) | Two-column key/value; `param-label` 40% already; value column is numeric nowrap |
| Stage timeline with progress-bar column | The bar column must take the remainder by design |
| `.report-table` (DART financials, year columns) | Variable year count; already `min-width: 48rem` in `.table-scroll` |
| 12-column partnership table and other 10+ column tables | Scroll-first; percentages would make every column too narrow. Must still sit in `.table-scroll` |
| Tables with 3 or fewer columns | Proportional shrink is acceptable |

### B.2 The ~100 other auto tables

Claim: they shrink proportionally and need no change. Code samples checked (static, this session):
`app/projects/page.tsx`, `app/projects/archives/page.tsx`, `app/projects/[id]/proxy-chain/page.tsx`
all use plain `className="data-table"` with short, similar-length cell content and no free-text
column, so auto layout distributes change roughly by content width. This is a code-level check only;
batch 1 verification must confirm it by measuring those three pages at 1280/1024 (pass if no column
absorbs more than 40% of the change). Any that fail join batch 3.

### B.3 Rule for future presets

1. Measure natural widths at 1280 px; start from those proportions.
2. Identifier column: 20-35%. Free-text column: the largest share, 28-56%. Numeric/date/enum: 9-16%.
   Actions: enough for its buttons at `--table-min` (typically 16-30%).
3. Sum exactly 100. `--table-min` = the width at which the narrowest nowrap column still fits,
   rounded up to the next token.
4. 10+ columns or year-series: content-sized + `.table-scroll` (allowlist), not a preset.

## C. Rollout

| Batch | Row | Scope | Verification |
|---|---|---|---|
| 1 | Row 1 frontend-engineer | `ColGroup`, `.table-fixed-pct` + tokens, mobile-rule exclusion, guard test with allowlist and ratchet list, PR 509 refactor; tables 13 (add `.table-scroll`), 1, 4; delete funnel and dd width rules | Measure below; plus B.2 sampling |
| 2 | Row 2 frontend-engineer | tables 2, 3, 5, 6, 10a, 10b, 7; synergy-list-table migration; remove `pat-col-label width:100%` | Measure below |
| 3 | Row 3 frontend-engineer | tables 8, 9, 12, 11, 14; market-list-table preset; any B.2 failures | Measure below; ratchet list must be empty |
| 4 | Row 4 design-system-agent | design-lint rules (A.5) | `bun run design:lint` clean; seeded violation fixture fails |

Per-batch measurement (logged-in browser, script via javascript tool): for each migrated table at
1280 / 1024 / 768 / 375 px, record each column's `getBoundingClientRect().width / table width`;
record `table.scrollWidth > wrapper.clientWidth` and whether the wrapper is `.table-scroll`; for every
cell, `cell.scrollWidth > cell.clientWidth + 1` excluding `.cell-truncate` and `.cell-clamp-3` cells.
Attach the table of numbers to the PR. Plus `bun test`, `bun run design:lint`, type check.

## D. Accessibility, preview, success

- `th scope="col"` on all header cells (and `scope="row"` on the key column of key-value tables);
  every table has a visually hidden `<caption>` or `aria-label`.
- `.table-scroll` wrappers that can scroll get `tabIndex={0}`, `role="region"`, `aria-label` (same
  pattern already used); focus ring from tokens.
- Truncated cells keep full text available through `title` and the link name.
- Touch targets 44 px in action cells; no hover-only affordances.
- Preview verification: each batch PR is checked in the Browser preview at the four widths, both
  light and dark themes.

**Success criteria**
1. For every migrated table, each column's share differs by at most 2 pp between 1280 and 1024 px.
2. No non-truncated cell content crosses its cell at any of the four widths.
3. No table is wider than its wrapper unless the wrapper is a keyboard-focusable `.table-scroll`.
4. Guard test passes with an empty ratchet list after batch 3; design-lint reports zero
   table-sizing findings.

**Non-goals**: a full shared `<DataTable>` component (sorting, pagination); column resizing by the
user; redesign of table content or labels; changing the content-sized allowlist tables.

## Open questions for the human

1. s2 funnel: the code comment intentionally made the name column "the only unbounded column".
   Accept a 34% cap with ellipsis + tooltip?
2. Greenfield decision history rationale: 3-line clamp with "show more", or always full text?
3. Mobile (375 px): keep horizontal scroll for preset tables, or extend the dd-table card-stack
   pattern to other wide tables (larger change, not in this design)?
4. Should `.list-table`'s 64rem cap remain for list screens, or should fixed-pct tables fill the
   content width?

## E. Implementation notes (batch 1)

- Guard test lives at `tests/unit/table-sizing.test.ts` (repo unit tests dir), not under `app/web-next/tests/`.
- Ratchet scope: header-cell counting is heuristic, so "no auto table with 4+ header cells" would flag about 150 tables
  that B.2 says need no change. The ratchet therefore tracks (a) the audited tables of section B (`AUDITED_TABLES`),
  (b) tables with 6+ header cells outside `.table-scroll` (same threshold as the design-lint rule), and (c) column-class
  `width: auto|100%` CSS. The `no-scroll` entries for wide tables outside section B (proxy-chain, share, DataTab,
  admin users, synergy tabs, WACC beta) need a wrapper or an allowlist reason in batch 3.
- Computed presets: the s6/s7 pre-review table has a checklist-driven column count, so its preset is
  `shortlistColPct(n)` (14 / equal item shares / remainder) in `brownfield/constants.ts`; the guard validates it for n = 1..20.
- DD checklist: read-only viewers have no actions column, so a second preset `DD_COL_PCT_READONLY` (64/12/24) exists.
- `.dd-table` keeps `min-width: 0` below 641 px so the card stack is not forced to `--table-min`; the mobile
  `display: table` rule excludes `.dd-table`.
- Members table `min-width` moved from 54rem to the nearest token `tmin-56`.
