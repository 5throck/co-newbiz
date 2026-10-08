---
title: UI critique fixes (2026-10-09 website critique meeting)
status: implemented
date: 2026-10-09
owner: ux-designer-agent
contributors: frontend-engineer (implementation), design-system-agent, i18n-specialist, process-governance-manager (dissent seat)
related_adrs: []
---

# UI critique fixes

Source: `memory/meeting-2026-10-09-ui-critique.md` (proposal items 1 to 10). Doctrine: Onyx 3.0, tokens only, boundary #2 (the review surface never shows a PASS stamp and never softens "could not verify").

## Decisions per item

| # | Change | Where |
|---|---|---|
| 1 | Root cause: a HOLD verdict whose `missing` list held blank entries overwrote the stage's required artifacts with blanks, so AI 1st printed an empty "Missing:" list next to an empty "needs supplement" label. Blank entries are now dropped at the source (`holdBlockerText`, `cleanList` in `lib/process-flow.ts`) and in the AI 1st formatter (`lib/review/ai-first.ts`); a dangling label becomes "needs supplement: confirm evidence". | `lib/review/review-display.ts`, `tests/unit/review-display.test.ts` |
| 2 | One shared `FilterChip` (`aria-pressed`, filled = selected, outline = not, check mark so state is not color alone). Inbox now has an explicit "All" chip; nothing is filled by default except it. Deal board uses the same component. `ControlChip` is a deprecated alias. | `components/ui.tsx` |
| 3 | `.btn-primary` is self-sufficient (padding, radius, inline-flex), so link-based primaries such as "start new review" no longer render as flat text. | `app/styles.css` |
| 4 | Inbox detail: facts as one inline row; review header shows title, the 3-count strip and the single primary link; buckets expanded below; layout uses the full content width (list column 20 to 28rem, detail takes the rest). | `app/inbox/page.tsx`, `ReviewBuckets` `headerSlot` |
| 5 | ko catalog for the deterministic AI 1st reasons, gate display names and bucket titles. Titles stay exactly the three Korean strings for Verified, Could not verify and Needs judgement (never softened); English is only a `title` tooltip. File paths and identifiers moved into a collapsed developer-details disclosure, with the original English record. Unknown text (AI 2nd) passes through unchanged. Stored reviews and hashes are untouched. | `lib/review/review-display.ts`, `lib/inbox.ts` |
| 6 | Stage screens: `ReviewBuckets` defaults to `variant="summary"`, a strip with the three counts that expands to the buckets. It has no close control (not dismissible). The could-not-verify count uses the existing warning status chip (amber token pair, contrast-checked) plus an icon and the words "needs check" (Korean UI text) whenever it is above 0. Gate surfaces (`GateDecisionPanel`, proposal confirm, S12 transition, inbox) use `variant="expanded"`. On S8 the strip sits directly under the page header, above the analysis tabs. | `components/ReviewBuckets.tsx` |
| 7 | Buckets are a container-query grid: 3 columns at 1100px container width or more, otherwise stacked; one indent level (no bullets inside the card). | `app/styles.css` |
| 8 | Artifact tab labels in Korean display names instead of raw spec strings. Keys unchanged (parity test keeps passing). | `lib/review/stage-artifact-labels.ts` |
| 9 | Sidebar badge counts open decision items only (`countOpenDecisions`, excludes notification rows); the bell counts unread notifications. Each has a tooltip stating what it counts. | `lib/inbox.ts`, `AppShell.tsx` |
| 10 | The collapse icon was squeezed to 2px by default button padding; fixed. Stepper is one row with horizontal scroll and the current stage centered; the gate badge is a separate marker after the steps. | `StageFrame.tsx`, `app/styles.css` |

Also fixed while verifying: the deal board's fourth column overflowed the content box at 1280px; the inbox deal filter overflowed at 390px.

## Preserved dissent (process-governance-manager, item 6)

"On stage screens, a collapsed review summary risks being skimmed past. I want the could-not-verify count rendered in the warning color whenever it is non-zero, and the strip must not be dismissible." Both are implemented. Known limit: on screens with several artifact tabs the strip shows the counts of the active artifact and names it; the other artifacts are one tab away.

## Accessibility

- WCAG 2.1 AA. The strip toggle is a real button with `aria-expanded` and `aria-controls`, 44px minimum height, visible focus ring.
- The warning state is conveyed by an icon, the words "needs check" and the count, not by color alone. Colors are the existing amber status tokens; `contrast:check` passes in both themes.
- Filter chips expose `aria-pressed` and a check mark when selected.
- `title` tooltips carry the English text only as a supplement; every Korean label is visible text.
- The tooltips on the inbox badge and bell explain the two counts; the bell keeps its accessible name with the number.
- axe: 0 serious or critical violations across the five E2E scenarios (inbox, gate panels, confirm page included).

## Preview Verification

Screenshots of `/inbox` (with a HOLD item), the deal board and S8 at 1920, 1280 and 390 px, light and dark, are in `docs/evidence/gui-review/critique-2026-10-09/`. They were taken on a private production build with a temp database and a free port (the operator's dev server was not touched). Checks run: `test:unit`, `test:e2e` (5 of 5), `typecheck`, web-next `tsc` (0 errors), `design:lint`, `contrast:check`, `generate-skill-graph`, `verify-scripts`, `audit.ts`.

## Follow-up (2026-10-09): leftovers from the critique

1. **Search button.** The icon stacked above the "Search" label because `.btn-ghost` was a plain block button. It is now `inline-flex` with centered items and a gap, so every ghost button with an icon (the deal board search and the others) renders icon and text on one line at the input height.
2. **Developer-details disclosure.** The `details.review-dev` summary is now a bordered control with a chevron that rotates when open, a hover state, a `focus-visible` ring and a 44px target. It stays collapsed by default; the native `<details>`/`<summary>` keeps keyboard and screen-reader semantics. The chevron animation respects `prefers-reduced-motion`.
3. **"S11 HOLD" card chip.** This was a display bug, not data: the card used the project's current stage and appended "HOLD" when any gate held, so a deal at S11 held at the FS gate read "S11 HOLD". The new `lib/deal-card-label.ts` (`buildCardChips`) returns two chips: the current stage ("S11") and a separate amber chip naming the holding gate(s) ("FS HOLD"). Covered by `tests/unit/deal-card-label.test.ts`.

Evidence: `docs/evidence/gui-review/critique-2026-10-09/followup-*.png`. The "before" images are the original critique captures; the "after" images were taken on a private build with a temp database and a free port.
