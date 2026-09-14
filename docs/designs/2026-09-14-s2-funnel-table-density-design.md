# Design: S2 opportunity-funnel table density

- Date: 2026-09-14
- Status: implemented
- Related: ADR-0088 (table alignment), S2 `기회 발굴` surface, `.data-table` component class

## Problem

User report: on the S2 `기회 발굴` list, the `기회명` column and the `매력도` column
sit far apart — the row reads as two disconnected clusters on wide screens.

Cause: the funnel table is `.data-table` (`width: 100%`) and `기회명` was the only
column without an explicit width. Auto table layout hands ALL leftover width to
the single unconstrained column, so on wide viewports the name column stretched
to ~700–1000px and pushed `매력도·시너지·작업` to the far right edge.

## Approach

Scope a fixed table layout and a width cap to this table only
(`.opportunity-table`, styles.css):

- `table-layout: fixed` — column widths come from the header width classes, not
  content; the global `.data-table` keep-all/break-word rules wrap long Korean
  names to a second line instead of widening the column.
- `max-width: 64rem` — the table stops stretching on wide viewports; the name
  column absorbs the remainder only up to ~32rem, keeping `매력도·시너지` visually
  adjacent to the names they score.
- Header width classes rebalanced for the sub-labels added by the synergy
  confirmation work: `상태` 6rem, `매력도` 6rem, `시너지` 7rem (fits `권고(미확정)`) on
  one line), `작업` 13rem (unchanged).

No data or interaction changes — column set, sort controls, and row actions are
untouched. E1–E5 exemptions don't apply (real UI change), hence this doc.

## Verification

- `bun run design:lint` — no violations.
- `bunx tsc --noEmit` clean.
- Manual: wide viewport renders the list capped at 64rem with the score columns
  adjacent to the names; narrow viewports keep the previous full-width behavior.
