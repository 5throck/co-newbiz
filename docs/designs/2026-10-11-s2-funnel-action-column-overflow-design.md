# S2 Funnel Action Column Overflow - Design

- **Date**: 2026-10-11
- **Status**: implemented (Design Gate Row 0; adjudicated 2026-10-25, DEC-20261025-03)
- **Owner**: platform-lead
- **ADR**: none required (display layer only; no schema, auth, or MCP scope change)

## 1. Problem

In the S2 opportunity funnel table (`OpportunityFunnelStage.tsx`, class `data-table list-table`) the
actions cell is 13rem wide, `display:flex`, right-aligned, `nowrap`. With two or three buttons (up to about
272px) the content overflows to the LEFT of the cell by 9-72px and covers the synergy column text. The
table is `table-layout: fixed`, so the cell cannot grow.

## 2. Decision

- `.sizing-actions-cell > .actions-row` gets `flex-wrap: wrap` so buttons wrap to a second line inside the
  cell, still right-aligned, with the existing gap token.
- A new modifier `.opp-funnel-table` (same pattern as `.market-list-table`) raises the table max width and
  sets a minimum width so narrow viewports scroll inside the existing `.table-scroll` wrapper instead of
  squeezing columns.
- Column widths are rebalanced in rem: status 6, attractiveness 6, synergy 10, actions 20; the opportunity
  name column absorbs the rest and keeps its current wrapping.
- No label, behaviour, or colour change. Tokens and rem only.

## 3. Verification

Programmatic overlap check in the browser at the default width, 1024, 768 and 375: every action button left
edge >= its cell left edge and no leaf element crosses its cell rect. Sibling S1/S3, `/projects` and
`/deals` tables get the same check. A source-reading unit test pins the class names and the wrap rule.
