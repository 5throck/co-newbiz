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

---

## Delta 2026-10-26b — single-page dry-run

> **Supersession notice (append-only).** This delta supersedes the tab information architecture in sections 3 (summary-bar/primary-state table where it names tabs) and 11 (checklist items "Tabs Edit / Run & compare / AI suggestions / History"). The wiki image work, list redesign, banner, metadata disclosure and i18n items of this document remain in force. Owner decisions below are fixed.

### D1. JTBD (unchanged persona, narrower loop)

Persona: deal analyst / operator tuning a catalog prompt or agent. Job: edit a prompt or agent, run it on a sample, compare previous (A) with new (B), and export a proposal package. Input: catalog prompt key plus optional override (prompt text, agent key) plus sample input. Output: A/B outputs, one preference line, a proposal package. Safety rule unchanged: override is session-scoped, never SSOT; persistent change only via proposal package and repository PR (ADR-0183 D5).

### D2. Page structure (no tabs; top to bottom)

1. Summary bar (sticky): status badge, session cost, one primary action, More menu. Primary: no run yet = **Run**; after at least one run = **Export proposal package**. Run remains a visible secondary button in section 3.
2. **Edit**: prompt editor with "Get AI improvement". The suggestion result renders inline beside the editor (stacked under it at narrow widths) as a highlighted diff (existing +N/-M line comparison plus original-vs-proposed `<pre>` pair), a short rationale callout, and Apply / Discard. Apply writes into the editor buffer only (not yet saved). Agent picker below the editor with AI-recommended candidate chips; clicking a chip fills the picker (buffer only). "Revert edits" resets the buffer to the current session's stored override (second press level: clear buffer to base, behind a confirm).
3. **Run**: sample input textarea and Run (secondary after first run). Clean buffer: Run executes the current session. Dirty buffer: the primary Run button label changes to "Run as new session" (see D3) and creates a derived session first. Existing cost confirm dialog is kept.
4. **Result**: A (previous = base catalog) and B (new = this session's override) side by side; stacked at narrow widths. Each pane shows source chip (llm / synthesis), cost, and the snapshot label it ran with.
5. One-line preference record under A/B: chips base / override / tie plus inline optional note (max 500 chars, one line). Disabled with explanation until a run exists.
6. Collapsed disclosure "Run history (N)" at the bottom: per run time, cost, source, and the override snapshot used (agent key plus short prompt hash; row marks which equals the current session's override). Because each applied edit lives in its own derived session, the disclosure also lists the parent/derived sessions as links (evidence trail). Session info stays a collapsed disclosure below it.

Single primary action per state is preserved; Apply/Discard are local to the suggestion callout and are not page-level primaries.

### D3. Behavior: Run on a dirty editor creates a new derived session (owner decision 2026-10-26, reverses the earlier in-session-edit proposal)

- No in-session editing. A session's stored override is immutable evidence once created; the editor buffer is local state only.
- **Run when the buffer is clean**: execute the current session (existing `POST .../execute`).
- **Run when the buffer is dirty**: create a new derived session carrying the edited override via the existing `POST /api/flows/dry-run/sessions`, navigate to the new session page, and execute there (existing cost confirm first). The current session is kept untouched as evidence; its history disclosure links to the derived session.
- Button label reflects the state: clean = "Run"; dirty = "Run as new session" (text, not color). Dirty indicator is the text label "Unsaved edits" plus the Revert control. "Revert edits" and the dirty label stay.
- If session creation fails, execute is not called and the error is shown inline; the buffer is preserved. If creation succeeds but execute fails, the user lands on the new session (not yet run) with the error shown and can retry Run there.
- Deviation #B in `2026-10-24-flow-console-screen-design.md` ("apply creates a new derived session") is **not retired**; it is confirmed as the owner's decision (2026-10-26).

### D4. API contract: no change

- The PATCH endpoint proposed earlier is **removed**. No new endpoint, no change to the Row 5 API contract. Consumed: existing session create/GET/execute/preference/export/suggestion routes only.
- Create already accepts `overrideSystem` / `overrideAgentKey` with the existing validations (`empty_override_system`, `unknown_agent`); the derived session reuses them unchanged.

### D5. Snapshot per run: attribution via existing columns (no schema change)

**Finding: no schema change and no ADR needed.** Evidence:

- `llm_call_log.agent_key` (0092) records the agent used for each leg.
- `llm_call_log.prompt_hash` (0130) exists but `executeDryRun` does not populate it today (NULL for dry-run rows).
- Join key `dry_run_group_id = sessionId` (0171) groups a session's runs; each execute adds a base row and an override row.

Design: on each execute, pass `promptHash` (sha256, first 16 hex of the effective system text) on **both legs**: the override leg gets the hash of the effective override text, the base leg gets the hash of the base catalog text. Hash plus agent key attribute every run and let History show "same as this session's override / different". Parent-to-derived linkage is by session (the derived session's override is its own evidence); no new linkage column is required, the UI may keep the parent id in client navigation state only.

Limits the owner should know (not blockers):
1. A hash identifies a snapshot but does not reproduce its text. Because every applied edit becomes its own session, the override text is preserved in that session's `dry_run_session` row, so this limit is largely mitigated; a text-per-run table is not needed.
2. `base_output`/`override_output` on a session are "latest run" only (0172). With a new session per edit this matters less (each session normally has one run), but re-running the same session overwrites its bodies. Retaining all bodies would be a schema change (ADR); not proposed.

### D6. Session status: unchanged

`executeDryRun` continues to set `status = 'closed'` and `finished_at` after a run. Because edits never mutate a session, the previous status conflict no longer exists. Re-running a closed session with a clean buffer follows existing behavior (no change by this delta). Summary-bar badge keeps existing status semantics. The `no_override` rule in execute remains; UI disables Run with an explanation when the buffer equals base.

### D7. ADR-0183 conformance

- D5 (session-scoped, SSOT-invariant, same `completeOrFallback` path, no business-table writes): preserved.
- D7 (three additive migrations): preserved; this delta adds zero migrations.
- D6 (AI suggestion proposal-only; accept applies to the override only): preserved; Apply writes the editor buffer, and the override only becomes a session via a new derived session on Run.
- **No change to the session lifecycle**; no ADR-0183 amendment needed for this delta. No new endpoint, so no OpenAPI change from this delta.

### D8. Acceptance criteria

Backend:
- [ ] No new endpoint and no schema migration; any uncommitted PATCH route/OpenAPI/`lib/dry-run.ts` update-session code added for the earlier proposal is removed.
- [ ] `executeDryRun` passes `promptHash` and the real agent key on both legs (override leg: effective override hash; base leg: base text hash); unit test asserts `llm_call_log.prompt_hash` and `agent_key` are populated and differ across two sessions with different overrides, and that earlier rows are unchanged.
- [ ] Session status behavior after execute is unchanged (`closed`); existing tests pass.
- [ ] Session GET (or history within existing shapes) exposes per-run snapshot (agent key, prompt hash, time, cost, source) from `llm_call_log`; "equals this session's override" computed from the same hash function.
- [ ] No business table written (existing invariant tests pass).

Frontend:
- [ ] No tabs; section order per D2; no ARIA tab roles; hash/tab URL sync removed.
- [ ] Summary-bar primary follows D2 (Run before first run, Export after); exactly one primary button visible in the bar; Run visible secondary in the Run section.
- [ ] "Get AI improvement" result inline beside the editor with highlighted diff, rationale callout, Apply/Discard; changes not conveyed by color alone (+/- markers and text labels).
- [ ] Agent picker candidate chips fill the picker; keyboard operable.
- [ ] Clean buffer: Run executes the current session. Dirty buffer: Run label reads "Run as new session", calls `POST /sessions` with the edited override, navigates to the new session, then executes there with the existing cost confirm; the original session remains unchanged and is linked from History. Creation failure blocks execute, shows inline error, preserves buffer.
- [ ] "Unsaved edits" text label and "Revert edits" shown when dirty; clear-to-base behind a confirm.
- [ ] A/B side by side at >=1024px, stacked below; preference is a single line with note inline.
- [ ] "Run history (N)" collapsed disclosure showing snapshot per run and derived-session links; session info collapsed.
- [ ] ko/en keys added and synced (including "Run as new session"); `design:lint` and axe pass in light and dark; screenshots at 1280x800 and 320px.
- Success criterion: an analyst completes edit -> run -> compare -> record preference -> export on one page flow, where each edited run lands in exactly one new derived session (scripted walkthrough: N edited runs produce N derived sessions, originals unmodified).

### D9. Handoff

Reasoning: tabs split one edit-run-compare loop across views; a single vertical page matches the job order, while derived sessions keep each iteration as immutable evidence (owner decision). Contracts consumed: existing session create/GET/execute/preference/export/suggestion endpoints; tables `dry_run_session`, `llm_call_log` (existing columns only). Escalations: none to design-system-agent. To PM: D5 limits (hash-only per-run attribution; latest-run result bodies); schema change plus ADR only if the owner wants more.
