# Deal Overview UI Refinement - Design

- **Date**: 2026-10-11
- **Status**: proposed (Design Gate Row 0)
- **Owner**: ux-designer-agent (domain lead: platform-lead)
- **Supersedes in part**: decisions A.1-A.5 of `2026-10-11-deal-overview-and-s3-deal-scope-design.md` (presentation only; its data rules stay)
- **ADR**: none required (no DB schema, auth, or MCP tool-scope change; read-only use of existing API fields)

## 1. Problem (verified)

Verified in a logged-in browser on three deal states: (a) an S3 opportunity with attractiveness 72, track undecided, no gate decision; (b) the promoted project deal `01M2Y2SM5TM27D5YZ3CHT7T81A` at S8; (c) a HOLD deal such as `01M2C75632E8AK5GNQ6X9B5PV6`.

Everything below the page objective line (Korean string meaning "see current stage, next action, completion criteria and progress status on one sheet") in `app/web-next/app/deals/[id]/page.tsx`:

1. **No identity.** The deal name appears nowhere (body, header, `document.title`). The H1 is the generic label meaning "current review/deal overview"; `app/deals/[id]/layout.tsx` sets a static title. Regression from removing `DealBreadcrumb`.
2. **Next action is generic.** A single button labelled `NEXT_ACTION_LABEL` (meaning "go to stage screen") says neither what to do nor why.
3. **Key facts read "not recorded" everywhere.** Track shows "not recorded" before S4, where it is not yet decidable. Gate shows "not recorded" without naming which gate applies next or linking to its decision screen. "Not yet applicable" and "missing" are indistinguishable.
4. **Stepper.** An ad-hoc `sizing-step-rail` duplicates the shared `StageRail`. State words wrap below names (first three items 42px, the rest 28px). The in-progress circle looks like the not-done circles in the criteria list. No links to stage tabs, no compact mode at 375px.
5. **Input/output strip** (`.handoff`) is visually heavy and carries only adjacent stage names.
6. **No hierarchy.** Sections are unboxed `.market-section` blocks in one long column with wide empty space on desktop. HOLD is a muted list row at the bottom. Loading uses a generic `PageState`, so the identity area stays blank while several APIs resolve.

## 2. User and job

- **Who**: deal analyst (owner) and IC reviewer opening a deal from the board or inbox.
- **JTBD**: "When I open a deal, I want to confirm which deal this is, where it stands, and the one thing that unblocks it, so I can act within one click or hand it off."
- **Success criterion (measurable)**: on all three verified deal states, at 1280px and 375px, a first-time viewer can answer three questions from the first viewport without scrolling: (1) the deal name, (2) the current stage as "Sn name", (3) the concrete next action and its target screen. A design QA check passes when all three are in the first viewport and **no key fact renders the generic "not recorded" text when the value is not yet applicable**: 0 occurrences on deal (a).

## 3. Layout

### 3.1 Structure (top to bottom)

```
<main aria-labelledby="deal-title">
  header.deal-overview-head                       (identity)
    p.eyebrow           -> overview label (existing Korean string, demoted from H1)
    h1#deal-title       -> deal name
    div.chip-row        -> status-chip (deal status) | status-chip (Sn name) | status-chip status-amber "HOLD" (if any)
    p.objective         -> existing objective line (unchanged copy)
  StageRail (shared, components/StageFrame.tsx)   (progress)
  div.deal-overview-grid
    div.deal-overview-main
      section.card  #ov-stage   "Current stage"   (absorbs the input/output strip)
      section.card  #ov-next    "Next action"     (single primary action)
      section.card  #ov-done    "Completion criteria" (+ other blockers subsection)
    aside.deal-overview-side (aria-labelledby ov-facts)
      section.card  #ov-hold    "On hold"         (only when holds.length > 0; rendered FIRST in the aside)
      section.card  #ov-facts   "Key facts"
```

- **>= 1024px**: `.deal-overview-grid` is two columns, `grid-template-columns: minmax(0, 2fr) minmax(18rem, 1fr)`, `gap: 1.5rem`, `align-items: start`.
- **< 1024px**: one column. Order: Current stage, Next action, HOLD, Completion criteria, Key facts. HOLD moves up because it blocks the next action. Implement this with DOM order plus `order` only inside the grid. The DOM order stays main -> aside, so focus order follows reading order at desktop. At mobile, render the HOLD card a second time in the main column before Completion (`hidden` at >= 1024px) rather than using CSS `order`, so focus order and visual order match. Only one copy is ever exposed to assistive technology: the duplicate uses `display:none` at the other breakpoint.
- Two new layout classes go in `app/styles.css`: `.deal-overview-head`, `.deal-overview-grid` (+ `-main`, `-side`). Token-only values: `--space-*` if present, otherwise rem; `--border`, `--surface`. These are layout wrappers, not a new component. Everything visual reuses `.card`, `.status-chip status-*`, `.btn-premium`, `.btn-ghost`, `.guide-link`, and `PageState`.

### 3.2 Identity header

- H1 = deal name (`ov.identity.name`). Long names wrap; there is no truncation in the H1. `overflow-wrap:anywhere` handles unbroken strings.
- The eyebrow (existing overview label) moves above the H1 in `--fs-caption`, `--muted-fg`.
- Chips use `.status-chip` with an icon and text:
  - Deal status: label from `lib/labels.ts` status vocabulary, neutral chip.
  - Stage: "S3 <stage name>" from `STAGE_META`, neutral chip with the `Flag` icon.
  - Attractiveness: NOT a chip. It stays in Key facts, so the header never shows a number without context.
  - HOLD: `status-chip status-amber` with the `PauseCircle` icon and the text "HOLD"; it anchor-links to `#ov-hold`.
  - Terminated / killed: `status-chip status-red` with the `XCircle` icon and the existing terminated label.
- `document.title` = "<deal name> - <overview label>". Implement it with `generateMetadata` in `app/deals/[id]/layout.tsx` if the name is server-resolvable. Otherwise set `document.title` in a client effect once identity loads, keeping the static title as the fallback.

### 3.3 Progress stepper

- Replace the inline `sizing-step-rail` with the shared `StageRail` (`components/StageFrame.tsx` L200). It already provides an ordered list, `aria-current="step"`, roving focus with arrow/Home/End keys, links via `useStageLinks` (backed by `dealStageHref`), the not-promoted reason for blocked stages, and the compact `<details>` mode "Sn / 12 - name" at <= 880px with a 44px summary.
- Required additions to `StageRail` (frontend, backward-compatible props):
  1. `status?: Record<StageMetaId, "complete"|"current"|"skipped"|"pending">`. When present, each step shows an icon plus visually-hidden text: complete = `CheckCircle2` + "done"; current = filled `CircleDot` in `--primary` + "in progress"; skipped = `MinusCircle` + strike-through name + "skipped"; pending = no icon, `--muted-fg`. The state word is `sr-only` in the full rail, so every item is a single line of identical height. In the compact list the state word is visible text.
  2. The current step is emphasized with `font-weight:600`, a `--primary` bottom border, and `--fg` text. Later steps use `--muted-fg`; contrast must still be >= 4.5:1, so do not use opacity.
  3. The compact summary also names neighbours: "S3 / 12 - <name>  (previous: S2 <name>, next: S4 <name>)". Neighbours render on a second line in `--fs-caption`.
- The overview does NOT make the rail sticky (the `.stage-stepper-wrap` sticky behaviour is for stage pages). Pass `sticky={false}` or use a modifier class `.stage-stepper-wrap--static`.
- The "in progress" icon (`CircleDot`, filled, primary) is visually distinct from the "not done" criteria icon (`Circle`, outline, muted). This removes the near-identical look reported in finding 4.

### 3.4 Current stage card (absorbs the input/output strip)

- H2 "Current stage" (existing Korean string key: current stage heading).
- Line 1: **"S3 <name>"** in `--fs-h3`, plus the objective in `--muted-fg`.
- Line 2: a compact `<dl>` with two rows, replacing `.handoff`:
  - "Receives from S2 <name>": the previous stage output artifact names (stage metadata `outputs`, if present in process-flow / flow.spec). Otherwise only the stage name.
  - "Hands to S4 <name>": the next stage input artifact names.
  - First/last stage: show the existing "none" string in muted text.
- Delete the `.handoff` usage on this page. Do not delete the class itself, since other pages use it.

### 3.5 Next action card

- H2 "Next action".
- Body: the **what**, a sentence derived from the first incomplete completion criterion: "Record <artifact label>". If all criteria are done and a gate applies: "Request the <gate label> decision". If all are done and no gate applies: "Advance to S<n+1> <name>".
- **Why** line, muted: "Required to complete S3" / "<gate label> gate needs a decision before S4".
- One primary action, `.btn-premium` (`PrimaryAction` from `components/ui.tsx` with `href`). The label is specific: "Open S3 <short name>" or "Open <gate> decision". Its href targets the stage tab (`dealStageHref`) or the gate decision screen (existing `holds[].href` pattern).
- HOLD present: the primary action becomes "Resolve <gate> hold" and links to the decision screen. The why line reads "Progress is paused until the hold is resolved".
- Terminated or no action: no button. Use `role="status"` with `ov.statusText` (existing behaviour).

### 3.6 Completion criteria card

- H2 "Completion criteria", followed by a progress caption "2 of 5 done" (`aria-live` not needed: the value is static per load).
- List items each carry an icon and text: done = `CheckCircle2` in `--green-fg` + the "done" word; not done = `Circle` outline in `--muted-fg` + the "not done" word. The state word becomes a trailing `.status-chip` (green / neutral) instead of parenthesised text, for scanability.
- The first not-done item gets the `aria-describedby` target the Next action card points to, plus a "next" marker (`ArrowRight` + "next" text).
- The "other blockers" H3 subsection stays, with `AlertTriangle` in `--amber-fg` + text.

### 3.7 HOLD card (only when holds exist)

- `.card` with a left border of 4px `--amber-fg` and `--amber-bg` tint on the header row. H2 "On hold".
- Each row shows `status-chip status-amber` (`PauseCircle` + "HOLD"), the gate label, the age ("held N days", from the decision timestamp), and a `.guide-link` "Open decision screen".
- It also echoes in the identity header chip (3.2) and the Next action card (3.5).

### 3.8 Key facts card

`<dl>` rows: Attractiveness, Synergy, Track, Gate. Each value has one of four explicit states:

| State | Rendering | Example |
|---|---|---|
| `value` | bold value (+ note) | "72", "Brownfield - carve-out" |
| `pending` (not yet applicable) | muted text naming when it becomes applicable, `Clock` icon | Track before S4: "decided at S4" |
| `missing` (applicable, not recorded) | amber text + `AlertTriangle` + link to where to record it | Synergy at S4+ with no score: "not recorded - record in S3" |
| `none` (no gate decision yet) | names the next applicable gate + link | "Screening gate: no decision yet - open decision screen" |

- Gate row: recorded decisions render as the existing chips (`status-green` go, `status-red` kill, `status-amber` hold), each with an icon (`CheckCircle2` / `XCircle` / `PauseCircle`) plus the text. The current chips are text-only colour, which is a design:lint violation. If none are recorded, show the `none` state for the next gate on the deal's track. If the track is undecided, use the next gate of the current stage, from `STAGE_META[].gateIds`.
- Synergy keeps the "recommended, unconfirmed" note.
- Linked project (S8+ project deals): add a "Project" row linking to the project. Add it only if the process response already exposes the id. Otherwise this is an open question (O-3).

### 3.9 Loading, empty, error

- **Loading**: render the page skeleton immediately, never blank. Use `PageState state="loading"` per region: header (1 line H1 skeleton + 2 chip skeletons), rail (1 row), each card (3 rows). Identity and process load in parallel. Once the process call returns, the header chips and rail render even if the opportunity call is still pending.
- **Partial failure**: if the opportunity fetch fails (the current code silently substitutes nulls), Key facts shows an inline `PageState state="error"` with retry for that card only. Attractiveness and synergy must NOT show "not recorded" in that case.
- **Full failure** (process fetch): `PageState state="error"` with `onRetry` that re-runs the fetch (not `window.location.reload()`), H1 falls back to the overview label.
- **Empty completion**: keep the existing "this stage has no required artifacts" string.

## 4. Copy table

Korean UI text is chosen by the frontend engineer from existing app vocabulary (`lib/labels.ts`, `lib/stage-meta.ts`, `lib/deal-overview.ts`). Keys below are proposed names; **NEW** marks wording that does not exist yet and needs product confirmation.

| Key (proposed) | English meaning | Source |
|---|---|---|
| `overview.eyebrow` | current review/deal overview | existing H1 string (page.tsx) |
| `overview.objective` | see current stage, next action, completion, progress on one sheet | existing |
| `overview.title_suffix` | " - deal overview" (document.title) | existing layout metadata |
| `section.current_stage` | Current stage | existing |
| `section.next_action` | Next action | existing |
| `section.completion` | Completion criteria | existing |
| `section.facts` | Key facts | existing |
| `section.hold` | On hold | NEW |
| `flow.receives_from` | Receives from | NEW (replaces "Input <-") |
| `flow.hands_to` | Hands to | NEW (replaces "Output ->") |
| `flow.none` | none | existing |
| `next.record_artifact` | Record {artifact} | NEW |
| `next.request_gate` | Request the {gate} decision | NEW |
| `next.advance` | Advance to {stage} | NEW |
| `next.resolve_hold` | Resolve the {gate} hold | NEW |
| `next.why_stage` | Required to complete {stage} | NEW |
| `next.why_gate` | {gate} needs a decision before {next stage} | NEW |
| `next.why_hold` | Progress is paused until the hold is resolved | NEW |
| `next.open_stage` | Open {stage} | NEW (replaces `NEXT_ACTION_LABEL`) |
| `completion.progress` | {done} of {total} done | NEW |
| `completion.next_marker` | next | NEW |
| `state.done` / `state.not_done` / `state.in_progress` / `state.skipped` | done / not done / in progress / skipped | existing (`STAGE_STATE_TEXT`) |
| `fact.pending_track` | decided at S4 | NEW |
| `fact.missing` | not recorded - record in {stage} | NEW (extends `displayOrNotRecorded`) |
| `fact.gate_none` | {gate}: no decision yet | NEW |
| `hold.age` | held {n} days | NEW |
| `hold.open_decision` | Open decision screen | existing |
| `rail.prev_next` | previous: {stage}, next: {stage} | NEW |

## 5. Data contract changes (Row 1, backend-engineer)

All changes are in pure `app/web-next/lib/deal-overview.ts` (+ unit tests). There are no new endpoints if the opportunity/project GETs already return a name; confirm this first.

1. `OverviewOpportunity.name: string | null`. `DealOverview.identity = { name: string; statusLabel: string | null; stageId: string | null; terminated: boolean }`. For project deals, the name comes from the project carrier (`resolveDealCarrier` result).
2. `nextAction` becomes `{ kind: "record_artifact" | "request_gate" | "advance" | "resolve_hold"; subject: string; reasonKind: "stage" | "gate" | "hold"; href: string; ctaStageOrGate: string } | null`. Remove `labelKey: "go_to_stage"` and keep `NEXT_ACTION_LABEL` exported only until callers migrate.
3. `KeyFact.state: "value" | "pending" | "missing" | "none"` plus optional `href` and `applicableFrom: StageMetaId | null`. Add a `gate` fact (`nextGate: { gate, gateLabel, href } | null`).
4. `flow.previous` / `flow.next` become `{ stageId, name, artifacts: string[] } | null`. The artifacts come from stage metadata. If no artifact metadata exists, return `[]`; the UI then shows the name only.
5. `holds[]` gains `heldSince: string | null` (decision timestamp, from the existing gate decision record).
6. `completion` items gain `isNext: boolean` (first not-done).

None of these change the DB, auth, or MCP scope, so no ADR is needed.

## 6. Accessibility (WCAG 2.1 AA)

- **Headings**: one H1 (deal name). H2 per card (Current stage, Next action, Completion criteria, On hold, Key facts). H3 for "other blockers". No skipped levels.
- **Landmarks**: `main` labelled by H1. `StageRail` is `nav aria-label` (existing). The facts column is `aside` with `aria-labelledby`.
- **aria-current="step"** on the current stage in both the full and compact rails (existing in `StageRail`).
- **Focus order**: header chip link (HOLD) -> rail -> Next action primary button -> criteria -> HOLD links -> facts links. It matches visual order at each breakpoint (see 3.1 duplicate-not-reorder rule).
- **Not colour alone**: every state carries icon + text (rail, criteria chips, gate chips, HOLD, fact states). Fix the existing text-only gate chips.
- **Contrast**: muted later steps and muted fact text use `--muted-fg` on `--surface`, which must be >= 4.5:1. Verify with `design:lint`. No opacity dimming.
- **Touch targets**: >= 44x44px at 375px for rail compact summary (existing), compact list links, primary action, HOLD chip link, "open decision screen" and fact links (pad `.guide-link` to 44px min-height in this context).
- **Page title**: unique per deal (2.4.2).
- **Loading/error**: skeletons are `aria-busy="true"` regions. The error state is `role="alert"` with a focusable retry button.

## 7. Preview verification

The frontend engineer must screenshot and attach evidence for 3 breakpoints (1280, 768, 375) x 3 deals: (a) the S3 opportunity, (b) the S8 project `01M2Y2SM5TM27D5YZ3CHT7T81A`, (c) the HOLD deal `01M2C75632E8AK5GNQ6X9B5PV6`, for 9 captures. Check:
- the H1 name and the `document.title` name;
- rail items share one height at 1280 and the compact mode works at 375;
- the next action names a concrete artifact/gate;
- there is no generic "not recorded" for pending facts on (a);
- HOLD is visible in the first viewport on (c) at 375;
- the throttled-network loading skeleton, and the error state with retry (block `/api/process` in devtools);
- `design:lint` is clean.

## 8. Non-goals

- No change to stage pages or their sticky `StageRail` behaviour (other than the backward-compatible `status` prop).
- No new API endpoints, no DB fields, no change to gate decision logic or RAG computation.
- No editing on the overview. It stays read-and-route; recording happens in stage screens.
- No sidebar/AppShell changes (handled by the prior design).

## 9. Open questions (human / product)

- **O-1**: Wording for all **NEW** copy keys in section 4, especially "decided at S4" vs naming the S4 stage.
- **O-2**: Should attractiveness also appear as a header chip (scan value) or stay in Key facts only (the current proposal)?
- **O-3**: Does the process/project response expose a linked project id / source opportunity id for a "Project" fact row, or should that be deferred?
- **O-4**: Do stage-level output/input artifact names exist in stage metadata (flow.spec / process-flow) in client-safe form? If not, the flow rows show stage names only.
- **O-5**: HOLD age: is "days since the hold decision" the right measure, or should it count days since the last activity?

## 10. Task split

| Row | Agent | Scope |
|---|---|---|
| 1 | backend-engineer | `lib/deal-overview.ts` contract items 5.1-5.6 + unit tests; confirm the name field on the opportunity/project GET. Required (identity, next-action reason, and per-fact applicability are not derivable in the page without it). |
| 2 | frontend-engineer | `app/deals/[id]/page.tsx` re-layout per section 3. `StageRail` `status` prop + non-sticky option + compact neighbours. `.deal-overview-*` layout classes. Per-deal `document.title`. Skeleton/error/retry. Section 7 preview evidence. |
| 3 | design-system-agent (review) | `design:lint` and the accessibility checklist in section 6 against the Row 2 diff. |
