---
title: QA sweep fixes - S8 valuation explanation NaN, inbox review text, S8 target table chip wrap
status: implemented (adjudicated 2026-10-25, DEC-20261025-03)
date: 2026-10-11
owner: platform-lead
domain: technical
---

# QA sweep fixes (S8 explanation, decision inbox, S8 target table)

Source: logged-in browser review on 2026-10-11. Three verified display defects. All fixes are
display-layer only: no stored enum, API field, DB schema, auth or MCP scope changes.

**ADR assessment**: none required (no trigger from the design-doc ADR list is touched).

## Defect A - S8 "explanation" tab shows "NaN x = NaN eok-won" for year-0 investment

- **Where**: `app/web-next/components/business-case/ValuationMethodology.tsx` L38 (`parseNote`), L73-81, L115, L148.
- **Root cause**: the simulation note written by `app/web-next/lib/business-case-generator.ts` (~L1167)
  stores multiples with a unit suffix (`acq_ev=3.00x`, `exit_ev=3.00x`). The component does
  `Number(n.acq_ev)`, which yields `NaN` for `"3.00x"`. The same unguarded `Number(...)` pattern is
  used for `wacc`, `iterations`, `horizon` (`Number(n.horizon) || 5`), `growth`, `sigma`,
  `xcheck_terminal_growth`, `xcheck_fade_npv`; any of them breaks the same way if the generator ever
  writes a suffix, `"null"`, or an empty value.
- **Fix**:
  1. Add a client-safe pure module `app/web-next/lib/sim-note.ts` (no imports from DB-touching modules):
     `parseSimNote(note)` (key=value map, same grammar as today's `parseNote`) and
     `noteNumber(value): number | null` - trims, strips one trailing `x` / `%`-free unit suffix `x`,
     returns `null` for missing, empty, `"null"`, `"NaN"` or non-finite results.
  2. `ValuationMethodology.tsx`: replace local `parseNote` and every `Number(n.*)` read with
     `noteNumber(...)`; a `null` renders the existing em-dash placeholder, never `NaN`.
  3. Move the parse part of `crossCheckOfNote` (`business-case-generator.ts` L1527) onto
     `parseSimNote`/`noteNumber` so server and client share one grammar (generator keeps its export).
- **Tests** (`app/web-next/lib/sim-note.test.ts`): `"3.00x"` -> 3, `"3.0"` -> 3, `"null"` -> null,
  missing key -> null, `""` -> null, `"abc"` -> null, `"0.1"` -> 0.1; plus a parse test on a real
  note string containing `acq_ev=3.00x;exit_ev=3.00x;wacc=0.1`.
- **Accessibility**: placeholder em-dash keeps an accessible label equivalent to "not available"
  (existing pattern); no color-only meaning.
- **Preview verification**: open S8 explanation tab of the reviewed project at 1280px and 375px;
  confirm year-0 investment row shows "3.00x = N eok-won" and no "NaN" anywhere on the page
  (`get_page_text` search for "NaN").

## Defect B - Decision inbox review text (stray punctuation, English and raw enum leaks)

Rendered by `app/web-next/app/inbox/page.tsx` -> `components/ReviewBuckets.tsx`
(data via `lib/use-inbox.ts`, `lib/inbox.ts`). Display helpers live in the client-safe
`app/web-next/lib/review/review-display.ts` (this is the existing labels module for review text;
general labels are in `lib/labels.ts`).

### B1 - "Screening hold - needs supplement: . Missing artifacts: .."

- **Root cause**: AI 1st builds the reason in `lib/review/ai-first.ts` L49-53 as
  `joinBlockers(s.blockers) + " Missing: <list>."`. `cleanList` only drops blank strings, so entries
  that are just punctuation (".") survive and render as `: .` / `..`; `joinBlockers` repairs a
  dangling "needs supplement:" label only at end-of-string, which fails when the Missing clause follows.
  `localizeItem` then translates the labels but keeps the empty payloads.
- **Fix (display only, stored rows and content hashes unchanged)**:
  `cleanList` also drops entries with no letter/digit; `localizeItem` / a new
  `tidyReasonText(text)` in `review-display.ts` omits a "Missing artifacts" clause whose list is empty
  and replaces an empty "needs supplement:" payload with the existing "check rationale" wording
  (same text `holdBlockerText` already uses); collapses repeated periods.
- **Tests** (`lib/review/review-display.test.ts`): blockers `["screening hold - needs supplement: ."]`
  with missing `["."]` -> no `: .`, no `..`, no empty Missing clause; non-empty lists unchanged;
  unknown text passes through unchanged.

### B2 - "AI 2nd - ? domain - none - not performed: AI 1st found structural gaps ..."

- **Root cause**: `ReviewBuckets.tsx` L104-108 `originOf` prints `reviewer_domain ?? "?"` and the raw
  `reviewer_agent` (`"none"` written by `lib/review/ai-second.ts` L203-208 when not performed). The
  not-performed `reason` strings in `ai-second.ts` (L159, L208 and the `selectReviewer` failure
  reasons) are English and have no entry in `localizeItem`.
- **Fix (display only; enum values and API fields untouched)**: in `review-display.ts` add
  `reviewOriginText(stage)` - when not performed or agent is `none`/domain null, show
  "AI 2nd - not performed" with no domain/agent segment; map domain ids via a
  `REVIEW_DOMAIN_LABEL` (functional/technical/industry/region -> Korean labels, reused or added in
  `lib/labels.ts`). Add catalog entries to `localizeItem` for each not-performed claim/reason
  template in `ai-second.ts` (Korean wording: AI 1st found structural gaps such as incomplete or
  locked stages, so cross-domain review is not yet meaningful). Unknown reasons pass through.
- **Tests**: `reviewOriginText` for performed/not-performed/null domain/`none` agent; one test per
  `ai-second.ts` not-performed template asserting Korean output with no ASCII sentence left and no
  `?`; a guard test that iterates the template strings exported from `ai-second.ts` so a new
  template without a catalog entry fails.
- **Accessibility**: origin line remains plain text; English original stays available only as a
  `title` tooltip (existing BUCKET_TITLE pattern).
- **Preview verification**: `/inbox` at 1280px and 375px; text search for `?`, `none`, `..`, `: .`,
  and the English phrase "not performed" returns no hits in item text.

## Defect C - S8 target comparison chips wrap one character per line at 375px

- **Where**: `app/web-next/components/stages/BusinessCaseStage.tsx`, targets tab table inside the
  `table-scroll` wrapper; status chips ("band not confirmed", "DART revenue anchor") and the
  "select target" button.
- **Root cause**: cells have no minimum width, so on narrow viewports the table compresses columns
  instead of scrolling and chips break per character.
- **Fix**: chips and the action button get `whitespace-nowrap`; status/action columns get a
  token-based `min-width` (spacing tokens only); the table gets `min-width: max-content` (or
  equivalent token-sized minimum) so overflow goes to the existing horizontal scroll. Prefer a shared
  chip class/component change if the chip is the shared `ui.tsx` chip and other tables benefit; no
  hardcoded colors or px font sizes; run `design:lint`.
- **Tests**: existing component/e2e suite stays green; `design:lint` clean.
- **Accessibility**: scroll wrapper keeps keyboard focusability and an accessible name (existing
  `table-scroll` pattern); button keeps >= 44px touch target; chip status is text, not color only.
- **Preview verification**: S8 targets tab at 375px and 768px (and 1280px sanity): no chip wraps
  mid-word, table scrolls horizontally, screenshot attached to PR.

## Task split

| Row | Agent | Scope |
|---|---|---|
| 1 | backend-engineer | B1, B2: `lib/review/review-display.ts` helpers + catalog, domain label map in `lib/labels.ts`, unit tests; `lib/sim-note.ts` + tests and `crossCheckOfNote` reuse (A, steps 1 and 3). No change to stored review rows, enums, or API payloads. |
| 2 | frontend-engineer | A step 2 (`ValuationMethodology.tsx`), B2 wiring in `ReviewBuckets.tsx` (`originOf` -> `reviewOriginText`), C (`BusinessCaseStage.tsx` targets table); `design:lint`; preview verification at >= 2 breakpoints per defect. Depends on Row 1. |

## Non-goals / Open questions (pending human product decision)

- Inbox item link destination for gate HOLD items (`lib/inbox.ts` L181) is not changed.
- Whether an in-progress FS gate belongs in the inbox at all is not changed.

## Observed, not fixed

- Valuation uses the default WACC of 10 percent (`wacc_source=default`) until a person confirms a
  WACC session; this is correct per boundary #2 but should be visible to reviewers.
- Market-forward growth 40 percent vs historical 14.9 percent for the reviewed case; flag for
  risk-officer base-rate check, not a code defect.
