---
title: "Dry-run session UX overhaul and wiki image sizing — design"
date: 2026-10-26
status: approved
author: ux-designer-agent
lang: en
design_of_record:
  - "docs/design-foundation.md + docs/design-system/ (Onyx 3.0: philosophy, guide P1-P6, tokens, components, screens)"
  - "docs/designs/2026-10-26-flows-ux-review-remediation-design.md (jargon, 14px floor, focus, i18n sync conventions)"
---

# Dry-run session UX overhaul and wiki image sizing (2026-10-26)

## 1. JTBD

| Item | Statement |
|---|---|
| Persona | Operator (prompt/agent tuner) for dry-run; deal analyst / IC reviewer for wiki reading |
| Job (dry-run) | "Try a changed agent prompt safely, compare it with the current one, and decide whether to send it as a proposal." |
| Input -> output | Input: a dry-run session (override + agent + sample input). Output: a run, an A/B comparison with a recorded preference, an exported proposal package or a new session. |
| Job (wiki) | "Read a guide with screenshots without scrolling past oversized images." |
| Job (list) | "Find my session about a given purpose/stage and see its status at a glance." |

Behavior and API calls are unchanged. Only layout, copy, and controls change.

## 2. Wiki images (`.library-doc-body img`, `renderWikiMarkdown`)

- Wrap each markdown image in `<figure class="doc-figure">`; caption = alt text in `<figcaption>`. Empty alt: no caption, `alt=""` kept.
- `max-width: min(100%, 40rem)` (about 640px at 16px root; no dedicated token exists, so use a rem value declared once as a custom property inside the component rule, not a new global token), `height: auto`, `margin-inline: auto`, token border and radius.
- Click or Enter/Space opens the full-size image. Dialog pattern: the repo has dialog implementations (`ClosureModal.tsx` uses `role="dialog"`) but no shared Lightbox. Decision: render the image inside an `<a href=src target="_blank" rel="noopener">` (works with no JS, keyboard native, zero new component). A Lightbox is explicitly deferred (section 9).
- Link has visible `:focus-visible` outline using `--focus-ring-offset`; accessible name = "Open full size: {alt}" (i18n key).
- Sanitizer: `figure`, `figcaption`, `a[target=_blank][rel]` must pass the wiki sanitize allow-list.

## 3. Dry-run detail information architecture (`[sessionId]/page.tsx`)

Pattern: Standard Detail screen (design-screens.md) with `StageTabs`-style tablist (`role="tablist"`, `aria-selected`, roving tabindex, arrow keys). Reuse existing tab styling; no new component.

```
[ListBackButton]  Prompt/activity title        [status badge]  Cost: total   [PRIMARY]  [More v]
[Banner, once: Proposal only - does not change live prompts]
[details v Session info (collapsed): ID (copy), owner, created, agent, group]
[ Edit | Run & compare | AI suggestions | History ]
 tab panel
```

Summary bar (sticky under the app header, `position: sticky; top` token offset, token background and bottom border):
- Status badge: text + icon, never color alone.
- Cost total (existing value, existing formatter).
- ONE primary action, state-dependent (single `btn-primary`):

| Session state | Primary | Secondary (in "More" menu) |
|---|---|---|
| No runs yet | Run | Export package (disabled with reason), Apply override |
| Has runs, override edited and unsaved | Apply override (new session) | Run, Export package |
| Has runs, no pending edit | Export package | Run again, Apply override |

- "More" menu: existing menu pattern of StageTabs (ESC-restorable "More" label); items keep their current handlers.
- Selecting a primary/secondary action that lives in another tab switches to that tab and moves focus to the relevant control.

Tabs:
1. Edit: override editor + agent picker (section 5).
2. Run & compare: run, sample input, A/B compare, preference, export.
3. AI suggestions: `suggestion-panel.tsx` unchanged internally.
4. History: run history table (`data-table`, `table-scroll`).

Default tab: Run & compare if runs exist, else Edit. Selected tab mirrored in the URL hash (`#edit`, `#run`, `#suggest`, `#history`) so reload/back keeps place.

## 4. Copy (ko and en messages in sync)

- Proposal-only warning shown exactly once, as a banner under the summary bar. Remove from header subtitle, badge row, apply warning, and package note. The apply button keeps a short confirm-dialog text only if it exists today (not a repeat of the warning).
- Remove from visible copy: bench IDs (bench labels such as "Bench A1-6" and "A3-5" in the current copy), section refs ("§6.6 (1)"), table/column names (`llm_call_log`, `is_dry_run=1`, `dry_run_group_id`). Where a technical reference helps operators, put it in a `title`/tooltip on an info icon button (keyboard-focusable, `aria-describedby`), or drop it.
- Every key added or changed lands in both `ko` and `en` catalogs in one change; no hardcoded strings.

## 5. Agent picker

Gap: no shared Combobox exists in the repo (grep found no `role="combobox"` in app code). Minimal, doctrine-safe design: a labelled text filter input plus a grouped `<select>` is NOT enough for 41 items, so specify an ARIA 1.2 combobox composed of existing input and menu styling, scoped as a local component `AgentCombobox` and flagged to `design-system-agent` for catalog registration.
- Groups (headings, `role="group"` with `aria-label`): functional, technical, industry, region, other. Group membership derived from the existing agent registry/domain field; unknown goes to "other".
- Type-to-filter on name and description; `aria-expanded`, `aria-activedescendant`, Up/Down/Home/End/Enter/Esc; empty state "No matching agent"; selected value shown with its group label.
- Fallback if the escalation is rejected: native `<select>` with `<optgroup>` per domain (still a clear improvement, zero new component).

## 6. List page (`flows/dry-run/page.tsx`)

Pattern: Standard List with `list-table`.
- Columns: Purpose + stage (primary, link to detail), Status (badge), Owner, Updated, ID (shortened to 8 chars with a copy icon button, `aria-label` "Copy session ID").
- Filter chips: status (All / Draft / Running / Done / Failed, using the real status set from the API) plus the existing All / Mine scope; chips are buttons with `aria-pressed`, visible focus, count in label. Search input over purpose/ID (client-side on the loaded page, unchanged API).
- Registration surface: existing "new session" action stays as the single primary button on the list.
- Empty state per filter with a clear-filters action.

## 7. Components, tokens, CRUD, icons (DESIGN-CHECKLIST answers)

- Pattern: Standard Detail (+ tablist) and Standard List.
- Reused: StageTabs styling, ListBackButton, data-table/list-table/table-scroll, ClosureModal-style `role="dialog"` conventions, badges, `btn-primary`/secondary buttons, `<details>` disclosure (cf. `.deal-overview-flow-details`).
- Tokens: spacing, color, border, `--touch-target`, `--focus-ring-offset`, `--primary`; no hardcoded colors. One local rem constant for image max width.
- CRUD: Create (new session, list), Read (list + detail), Update (override edit/apply), Delete: unchanged (not offered today; out of scope). Search + registration present on the list.
- Stage linkage: dry-run is a flows tool, not an S1-S12 stage; linkage = ListBackButton and the activity/prompt link in the summary bar.
- Icon registration: info, copy, more (kebab), chevron icons must use the existing icon set; any icon not already registered is registered in the icon registry by the implementer.

## 8. Accessibility

WCAG AA both themes; reading text >= 14px; tablist semantics and arrow-key navigation; focus moves to the panel heading on tab change; sticky bar must not obscure focused elements (`scroll-padding-top` equals bar height); status never color-only; tooltips reachable by keyboard and not the sole carrier of required info; combobox per ARIA 1.2; chips `aria-pressed`; figure links keyboard operable; reflow at 320px (bar wraps, actions collapse into "More"); `prefers-reduced-motion` respected.

## 9. Out of scope

Lightbox/zoom component (follow-up, needs design-system ADR); any API, DB, or `llm_call_log` change; changing proposal-only semantics; the run/compare logic; suggestion-panel internals; pagination or server-side filtering; delete of sessions; new personas.

## 10. Success criteria (measurable)

1. At 1280x800 the primary action is visible without scrolling on every tab and every session state.
2. Zero occurrences of bench IDs, "§" references, `llm_call_log`, `is_dry_run`, `dry_run_group_id` in rendered visible text (grep of rendered DOM text, ko and en).
3. The proposal-only warning appears exactly once per page.
4. Wiki images render <= 640px wide and centered at 1920px viewport; each image has a keyboard-reachable full-size link.
5. Agent selection reachable by typing: selecting a given agent takes <= 3 keystrokes after focusing the field.
6. ko and en catalogs have identical key sets for touched namespaces.

## 11. Acceptance checklist for frontend-engineer

- [ ] Summary bar sticky; status badge, cost, one primary, More menu; primary follows the state table in section 3
- [ ] Tabs Edit / Run & compare / AI suggestions / History with ARIA roles, arrow keys, hash sync
- [ ] Metadata inside collapsed `<details>` with copy-ID
- [ ] Single proposal-only banner; other three instances removed
- [ ] Internal references removed or moved to keyboard-accessible tooltips
- [ ] ko/en messages synced; i18n lint passes
- [ ] Agent picker per section 5 (or documented fallback) and escalation note sent to design-system-agent
- [ ] List: purpose+stage primary column, short ID + copy, status chips, owner column, search
- [ ] Wiki: figure/figcaption, <= 40rem centered, new-tab full-size link, sanitizer updated
- [ ] All existing API calls and handlers unchanged (diff review)
- [ ] `design:lint`, axe check in light and dark themes, 1280x800 and 320px screenshots attached
- [ ] Unit tests for `renderWikiMarkdown` figure output and for primary-action selection by state

## 12. Handoff

Reasoning: one job per tab and one primary per state removes the "everything competes" failure; the banner states the safety rule once so it is read once; internal references serve developers, not operators. Contracts consumed: existing dry-run session/run/override/suggestion/export endpoints and the agent registry list (unchanged shapes). Escalations to design-system-agent: AgentCombobox registration; Lightbox deferral; image max-width token.
