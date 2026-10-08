---
title: Wave U — UX Overhaul (2-layer IA, pending-decisions inbox, readability, component decomposition)
status: approved
date: 2026-10-08
owner: ux-designer-agent
contributors: frontend-engineer (implementation), design-system-agent (design:lint), platform-lead (inbox API review)
related_adrs: []
---

# Wave U — UX Overhaul Design

> Pre-approved by the user in chat on 2026-10-08 (all Wave U designs). Registered as `approved`.
> Doctrine: Onyx 3.0 (`docs/design-system/design-guide.md`, `design-tokens.md`, `design-components.md`, `design-screens.md`, `design-accessibility.md`; tokens in `app/web-next/app/styles.css`). Nothing here introduces a new visual language; it re-applies existing tokens and shared components.

## 1. Context and evaluation findings (2026-10-08)

A GUI evaluation of the shipped app (evidence: `docs/evidence/gui-review/*.png`, e.g. `t20-s8-params-panel.png`, `s4-fact-grid.png`) found six problems:

| # | Finding | Evidence in code |
|---|---|---|
| 1 | Five navigation layers on one screen: sidebar, 12-stage stepper (`StageFrame.tsx`), about 30 sub-links in 3 rows (`ProjectSubNav.tsx`, S8–S12 + site + tools), tabs, input/output strip. Sidebar carries the transitional label "legacy stage screens" (`단계 화면(기존)`) and `/brownfield-mockup` is reachable. | `lib/navigation.ts` L36-65; `ProjectSubNav.tsx` `SUB_PAGES` |
| 2 | Readability: body and stepper text 12–13px; parameter tables push label and value to opposite edges; value and source fuse (`60.0%기본값`); high density. | 139 `font-size` declarations in the 0.7–0.8rem range in `styles.css` |
| 3 | Work efficiency: no single Primary Action per screen; no "my pending decisions" place although Waves F/M created many human-only decisions. | Gate proposals, `/proposals/{id}/confirm`, checklist approvals, transitions, closure preconditions are scattered |
| 4 | Giant components: `MarketAnalysisStage` 2,871 lines; `OurCompanyStage` 1,598; `BrownfieldStage` 1,239; `SynergyStage` 1,208; `RouteDecisionStage` 1,043; plus two more near or above 1,000 once co-located helpers are counted. | `components/stages/*` |
| 5 | The bottom-left floating button overlaps the sidebar footer. | Fixed-position control vs `.app-sidebar` |
| 6 | Wave F/M surfaces (`ReviewBuckets`, `ClosureModal`, proposal confirm page, connected apps) have no home in the IA. | `components/ReviewBuckets.tsx`, `ClosureModal.tsx`, `app/proposals/[id]`, settings |

Success criterion for the wave: the same five representative tasks (section 11) take at least 30% fewer clicks and at least 25% less time, and the SUS proxy rises by at least 10 points, measured before and after by the same agent protocol.

## 2. Jobs to be done

**Deal analyst** (builds the case, S1–S10)
- When I open a deal, I want to see which stage I am in and the one thing to do next, so I do not hunt through links.
- When I tune a parameter, I want label, value, unit and source in separate readable columns, so I can verify an assumption in one glance.
- When I finish a stage, I want the hand-off to the next stage to be one click, with outputs visibly feeding it.

**IC reviewer** (judges, S9–S11; human-only decisions)
- When I sit down to review, I want a single list of everything waiting for my decision, ordered by urgency, so nothing is missed.
- When I read AI output, I want it split into verified / could not verify / needs judgement, with the AI proposal clearly labelled as a proposal, so accountability stays with me.
- When I decide, I want the evidence, the proposed RAG grade (confidence-capped) and the decision control on one screen.

**Operator** (runs the platform, admin and agents)
- When something blocks a deal (closure precondition, waiver, failed run), I want it surfaced in my queue, not discovered by browsing.
- When I connect an MCP client, I want to see connected apps and revoke them in one place.

## 3. Information architecture

### 3.1 Principle: two layers

Layer 1 is the **sidebar** (where am I in the product). Layer 2 is the **stage stepper** (where am I in this deal). Everything else is content inside a stage, not navigation: per-stage tabs live inside the content area as ordinary tabs (`TabNav.tsx`), at most 5 per stage, with overflow ("More") beyond that. No third row of links; no input/output strip as a nav element (it becomes a collapsible "Inputs and outputs" panel in the stage header).

### 3.2 Sidebar (layer 1)

| Section | Items | Notes |
|---|---|---|
| Work | **Inbox** (badge = open count), Deals board (`/deals`) | Inbox is the new landing for reviewers; `/deals` stays the landing for analysts |
| Deal (visible only inside a deal/project) | Overview, then the 12 stages are NOT repeated here | The stepper owns stage navigation |
| Reference | Benchmarks, Library, Glossary, R&BD strategy | Unchanged from the former "Analysis and reference" section (`분석·참조`) |
| Admin (role-gated) | Users and agents, Data changes, Connected apps, Settings | Connected apps moves here from scattered settings |

Removals: the section label "legacy stage screens" (`단계 화면(기존)`) is deleted. The legacy stage routes (`/market`, `/opportunities`, `/our-company`, `/synergy`, `/route-decision`, `/greenfield`, `/brownfield`) remain as routes (ADR-0120 compatibility) but leave the sidebar; they are reached through the deal stepper. `/brownfield-mockup` is removed from `NAV_SECTIONS` and from `menuHrefs()`, and the route returns a 404 outside development (kept in `NON_MENU_ROUTES` while it exists). `tests/unit/navigation.test.ts` parity is updated in the same PR.

### 3.3 Stage stepper (layer 2)

- One horizontal stepper, S1–S12, 14px labels, status shown by icon plus text (never color alone).
- The current stage is the only expanded one; the stepper does not show sub-links.
- On 390px it collapses to "S8 of 12 · Business case analysis" (`S8 of 12 · 사업성 분석`) with a bottom-sheet list.

### 3.4 Sub-link regrouping (the 30 links)

Mapping from `ProjectSubNav.SUB_PAGES` and sibling routes under `/projects/[id]` to per-stage tabs:

| Stage | Tabs (default first) | Overflow ("More") |
|---|---|---|
| S8 Business case | Summary, Analysis, WACC, Financial analysis | Target costing, Risk heatmap |
| S9 Due diligence | DD workspace, Value-chain linkage | Interviews, Comp parity, Customer CoC, Backtest |
| S10 Deal structure | Structure, Debt | Incentives, Sites and facilities, Permits and certifications |
| S11 IC review | IC review, Reports | Share, Agent runs |
| S12 Post-close | Portfolio, PMI, Charter | Partnership/JV, Process, Timeline |

Rule: the first two tabs cover the primary job; the long tail sits in "More". Site and tools groups cease to be a separate row; they are folded into S10 (site) or "More" of the relevant stage. `ProjectSubNav.tsx` is retired (replaced by `StageTabs` driven by one config map).

### 3.5 Placement of Wave F/M surfaces

| Surface | Home in new IA |
|---|---|
| `ReviewBuckets` (verified / could not verify / needs judgement) | Tab "Review" inside S9 and S11, and the detail pane of Inbox items of kind review |
| `ClosureModal` | Opened from the S12 header primary action and from Inbox "closure precondition" items; never from the sidebar |
| Proposal confirm page (`/proposals/[id]`) | Inbox item detail; the same page remains deep-linkable from MCP |
| Connected apps | Admin > Connected apps (list, scopes, revoke) |

## 4. Pending-decisions inbox

Route `/inbox`. The inbox is a **read model over existing APIs**; it creates no new decision authority. Every action button routes to the existing human-only endpoint, so Boundary #2 holds. LLM-drafted summaries may appear as a clearly labelled "AI proposal (draft)" line on an item; they never act.

### 4.1 Data sources

| Item kind | Existing source | Open predicate | Human action target |
|---|---|---|---|
| Gate proposal | `GET /api/proposals` (kind gate) and gate decisions of a project | status = proposed | Gate decision panel (`GateDecisionPanel`) |
| MCP decision proposal | `GET /api/proposals`, `GET /api/proposals/{id}` | status = pending; confirm via `/proposals/{id}/confirm` | `app/proposals/[id]` confirm page |
| Checklist approval | `GET /api/reviews` and checklist routes under `/api/projects/{id}` | awaiting approver = current user | Review tab, approve control |
| Transition decision | `GET /api/projects/{id}` transition state, `/api/portfolio` | transition requested, undecided | Project header transition control |
| Closure precondition | `POST /close` precheck on `/api/projects/{id}` (Wave F) | precondition unmet or awaiting typed closure | `ClosureModal` |
| Mentions and notifications | `GET /api/notifications` | unread | Link target of the notification |

Unification: a client-side adapter `lib/inbox.ts` merges the sources into `InboxItem { id, kind, dealId, dealName, stage, title, dueAt?, ageDays, severity, href, aiDraft? }`. If no single list endpoint exists for a kind, the PR adds a thin read-only aggregation route `GET /api/inbox` (platform-lead reviews; no ADR needed because there is no schema, auth or tool-scope change, and it inherits the caller's permissions). Items outside the caller's project need-to-know are never returned (Boundary #1).

### 4.2 Screen spec

- Layout: two-pane at 1280px (list 40% / detail 60%); single column at 390px with detail as a pushed view.
- Filters: kind (multi), deal, stage, age; default "Mine, open", sorted by severity then age.
- Row: kind icon plus text label, title, deal and stage chip, age ("3d"), severity chip (icon plus text). Rows are real list items with `aria-current` on selection.
- Detail pane: the evidence summary, the `ReviewBuckets` block where relevant, an optional labelled AI draft, and exactly one Primary Action (see section 5). Secondary: "Open in stage", "Snooze 1d" (client-side only), "Reassign" only where the target API already supports it.
- Empty state: "Nothing is waiting for you" with the last-cleared time; never a spinner without a timeout.
- Badge: the sidebar count uses the same query, polled on focus and every 60s; announced via `aria-live="polite"` when it changes.
- Performance: list virtualized beyond 100 rows; each source fetched in parallel, partial failure shows an inline "could not load: <kind>" row (never silent).

## 5. Primary action per screen

Rule: one filled primary button per screen; everything else is secondary or tertiary. The primary action is verb plus object, placed in the page header (top right) and mirrored as the last element in the focus order of the content.

| Screen | Primary action | Condition |
|---|---|---|
| Inbox | Open the top item (detail pane: its decision action) | Always |
| Deals board | New review | Always |
| S1 Market analysis | Run market sizing | Inputs complete; else "Complete inputs" scrolls to the gap |
| S2 Opportunities | Promote to screening | Row selected |
| S3 Group and synergy | Save fit assessment | Dirty |
| S4 Route decision | Propose route (human confirms) | Facts complete |
| S5/S6/S7 Greenfield / Brownfield | Run feasibility check | Inputs complete |
| S8 Business case | Recompute valuation | Parameters changed |
| S9 DD | Request AI 2nd review | Author review done |
| S10 Deal structure | Save structure | Dirty |
| S11 IC review | Record decision (human) | Review buckets reviewed |
| S12 Portfolio | Close project (opens `ClosureModal`) | Preconditions shown inline |
| Proposal confirm | Confirm proposal | Evidence displayed |
| Connected apps | Connect an app | Always |

Disabled states always show the reason as text beside the button, not only a tooltip.

## 6. Typography and table rules

All values use existing tokens; new tokens are added only to `styles.css` and documented in `design-tokens.md`.

| Rule | Value |
|---|---|
| Base body | 14px minimum (0.875rem); long-form 15–16px |
| Stepper labels, tab labels, table cells | 14px |
| Captions, source and units | 13px minimum, only for secondary metadata, never for values |
| Line height | 1.5 body, 1.35 tables |
| Spacing scale | 4/8/12/16/24/32 via `--space-*` tokens (add if absent); no ad hoc rem values in new CSS |
| Sweep | Replace the 139 sub-14px declarations by token classes; `design:lint` gains a rule rejecting font-size below 0.875rem except `.caption` |

Parameter and data tables (the "param table" pattern, shared component `DataTable` / `ParamTable` in `ui.tsx`):

1. Columns: **Label** (left, 40%), **Value** (right-aligned, `font-variant-numeric: tabular-nums`, monospace-free), **Unit** (left, narrow), **Source** (left, 13px caption with `SourceTooltip`), optional **Confidence** chip. Label and value are never at opposite edges of a wide row; the table has a max width of 880px and the value column sits adjacent to the label.
2. Value and source are always separate cells. `60.0%기본값` becomes `60.0%` in Value and `기본값` (default) as a chip in Source.
3. Numbers: right-aligned, tabular, fixed decimals per unit; negatives use a minus sign plus text color pair, not color alone.
4. Density: row height 40px (compact option 32px behind a user toggle, default comfortable); zebra off, 1px row separators from `--border`.
5. Group headers (collapsible, 16px semibold) split long tables; at most 12 rows visible per group before "Show all".
6. At 390px, each row becomes a stacked card: label on top, value and unit large, source below.
7. Headers use `<th scope>`; captions via `<caption>`; sort state announced with `aria-sort`.

## 7. Floating button overlap (finding 5)

The bottom-left floating control is removed from the viewport corner and re-homed: its action moves into the sidebar footer as a normal button within the flow (so it can never overlap), and on mobile into the header overflow. The toast region stays bottom-right. Verified by a layout test that no fixed element's rect intersects `.app-sidebar` at widths 1024, 1280 and 390 (drawer closed).

## 8. Component decomposition plan

Principles: split by responsibility (data hook, panel, table, chart, form), keep each file under 400 lines, move shared pieces to `components/` rather than creating new look-alikes, no behavior change in the same PR as a move.

| Source | Lines | Target structure |
|---|---|---|
| `MarketAnalysisStage` | 2,871 | `stages/market/` with `MarketAnalysisStage.tsx` (shell and tabs, under 250), `useMarketAnalysis.ts` (data and mutations), `SizingPanel`, `ProxyChainPanel`, `DemandPanel`, `CompetitorPanel`, `ConfidenceBanner`, `marketFormat.ts` |
| `OurCompanyStage` | 1,598 | `stages/our-company/` shell, `useOurCompany`, `PortfolioFitPanel`, `GroupMapPanel`, `AffiliateTable` |
| `BrownfieldStage` | 1,239 | `stages/brownfield/` shell, `useBrownfield`, `TargetListPanel`, `SixValidatorsPanel`, `ScreeningFormPanel` |
| `SynergyStage` | 1,208 | `stages/synergy/` shell, `useSynergy`, `SynergyMatrixPanel`, `StrategicFitPanel` |
| `RouteDecisionStage` | 1,043 | `stages/route-decision/` shell, `useRouteDecision`, `FactGrid`, `DecisionTab`, `EvalTab` |
| `BusinessCaseStage` | 673 | `ParamsPanel`, `ValuationPanel` (hold as is unless touched by U-2) |
| `OpportunityFunnelStage`, `DdStage` | under 500 | untouched |

Execution order is by blast radius: Market first (largest), then OurCompany, Brownfield, Synergy, RouteDecision. Each split keeps the old default export path as a re-export so importers and tests do not change. A unit test per extracted hook; the existing stage tests stay green unchanged as the regression net. Shared extractions (`ParamTable`, `DataTable`, `StageTabs`, `PrimaryAction`, `InboxList`) go to `components/ui.tsx` or siblings and are reused by all stages.

## 9. Accessibility (WCAG 2.1 AA)

Embedded in every PR, checked with the `accessibility-audit` skill (axe-core) and manual keyboard passes.

- Contrast: text 4.5:1, large text and UI boundaries 3:1; the 13px caption tier must still meet 4.5:1. Status never by color alone (icon plus text), consistent with the existing "color-only states" lint.
- Landmarks: `header`, `nav aria-label="Primary"` (sidebar), `nav aria-label="Stages"` (stepper), `main`, and `aside` for the inbox detail. One `h1` per screen.
- Skip link "Skip to main content" as the first focusable element.
- Keyboard paths:
  - Sidebar: Tab/Shift+Tab through items; Enter activates; the mobile drawer traps focus (existing `useModalFocus`), Esc closes and returns focus to the trigger.
  - Stepper: a single tab stop with roving tabindex; Left/Right moves between stages, Enter opens; current stage has `aria-current="step"`.
  - Stage tabs: ARIA tabs pattern (`role=tablist`, arrow keys, Home/End), "More" is a menu button (`aria-haspopup`, Esc to close).
  - Inbox: list is `role=listbox` or a list of links; Up/Down changes selection, Enter opens the detail, `j/k` optional; focus moves to the detail heading after selection on mobile.
  - Tables: arrow-key navigation is not required; sortable headers are buttons.
  - Modals (`ClosureModal`): focus trap, labelled by its title, initial focus on the first field or the cancel button for destructive confirmations, focus restored on close.
- Focus order per screen: skip link, sidebar, stepper, page header (title, then Primary Action), stage tabs, content in DOM order, secondary actions. Visible focus ring from `--focus-ring`, never removed.
- Dynamic updates (inbox badge, save results, toasts) use `aria-live="polite"`; errors use `role=alert` and name the field and the fix.
- Touch targets at least 44x44px on mobile; no hover-only information (source tooltips also open on focus and tap).
- Reduced motion respected for stepper and drawer transitions (`prefers-reduced-motion`).

## 10. Preview Verification

Run for every PR with the Browser pane (dev server) at **1280px** and **390px** (mobile preset, reload after switching), then reset to desktop.

| Check | 1280px | 390px |
|---|---|---|
| Layers | Only sidebar plus stepper visible; no third link row | Drawer plus compact stepper |
| Sidebar | No legacy stage screens label (`단계 화면(기존)`), no mockup route; Inbox badge shown | Floating control absent; drawer does not overlap |
| Inbox | Two-pane, filters, empty state | Single column, detail pushed, back control |
| Readability | Computed font-size of body, stepper, cells at least 14px (checked via script on 10 sampled nodes) | Same; param rows stacked |
| Param table | Label, value, unit, source in separate columns; values right-aligned | Stacked card rows |
| Primary action | Exactly one `.btn-primary` per screen (script count) | Same, reachable without horizontal scroll |
| Wave F/M | ReviewBuckets in Review tab; ClosureModal opens from S12 and Inbox; proposal confirm reachable from Inbox; Connected apps under Admin | Same |
| Interactions | Tab through the whole screen in the order of section 9; Esc closes modal and returns focus; stepper arrow keys | Open and close drawer; tap targets |
| Console and network | No errors; inbox requests parallel and permission-scoped | Same |

Evidence screenshots are saved to `docs/evidence/gui-review/` with the prefix `u-`.

## 11. Task-based usability test protocol

Runs before U-1 (baseline, on current main) and after U-3 (on the branch), by an agent driving the browser against seeded data, in a fresh session with no prior hints. The test measures the product, not the agent: the same agent persona, same seed, same prompt.

Five representative tasks:

| ID | Persona | Task | Success |
|---|---|---|---|
| T1 | Analyst | Open deal "X", find the WACC input of the business case and change the equity-risk premium | Value saved and visible |
| T2 | Analyst | From S4, advance to the next stage and locate the S9 DD workspace | DD workspace open |
| T3 | IC reviewer | Find all items waiting for your decision and open the oldest | Correct item detail open |
| T4 | IC reviewer | Read the AI 2nd review of a deal, name what could not be verified, then record the gate decision | Decision recorded after viewing the buckets |
| T5 | Operator | Confirm a pending MCP decision proposal, then find where connected apps are listed | Proposal confirmed; page reached |

Metrics per task:

- **Time** to success (seconds, from first navigation to success state), cap 180s (failure at cap).
- **Clicks** (count of click, key-activation and navigation events from the browser event log; typing counts as one per field).
- **Errors** (wrong-route or back-navigation events).
- **SUS proxy**: after each run the agent answers the 10 SUS statements (1–5) against its own trace, with a one-sentence evidence cite per answer; score computed by the standard SUS formula. Reported as a proxy, not a human SUS; a human spot-check by 2 users is recommended but optional.

Protocol: 3 runs per task per condition, report median. Capture the event log, a screenshot per task end, and the prompt text. Acceptance for the wave: median clicks down at least 30%, median time down at least 25%, SUS proxy up at least 10 points, zero tasks that pass before and fail after. Findings below target go to the next wave backlog, not hidden.

## 12. PR split

| PR | Scope | Key files | Exit |
|---|---|---|---|
| **U-1 IA + inbox** | Two-layer IA, sidebar rework, remove legacy label and mockup entry, `StageTabs` replacing `ProjectSubNav`, `/inbox` plus `lib/inbox.ts` (and `GET /api/inbox` only if needed), Admin > Connected apps placement, floating-button fix; baseline usability run recorded first | `lib/navigation.ts`, `AppShell.tsx`, `StageFrame.tsx`, new `app/inbox/`, `ProjectSubNav.tsx` removed, `tests/unit/navigation.test.ts` | Preview Verification rows Layers, Sidebar, Inbox, Wave F/M pass |
| **U-2 Readability + primary actions** | Typography sweep (14px floor), spacing tokens, `ParamTable`/`DataTable` rules, value/source split, `PrimaryAction` header slot and the section 5 table, design:lint rule | `styles.css`, `ui.tsx`, stage headers, `design:lint` config | Readability, Param table, Primary action rows pass; axe clean |
| **U-3 Decomposition** | Section 8 splits in the stated order, no behavior change, re-exports preserved, hook unit tests; "after" usability run and report | `components/stages/**` | All stage tests green; no file over 400 lines in split dirs; usability acceptance met |

Each PR runs `bun run design:lint`, the unit suite and `bun scripts/audit.ts` before sync; any change under `lib/navigation.ts` keeps the page-to-menu parity test in the same PR. No DB schema, auth or MCP tool scope changes are in this wave, so no ADR is required; a new `/api/inbox` route, if added, is read-only and inherits caller permissions. U-2 depends on U-1 only for the stage header slot; U-3 is independent of both and may run in parallel after U-1 merges (sequential-branch rule: merge U-1 before opening U-2).

## 13. Risks and open points

- Inbox completeness depends on each kind exposing an "open for me" filter; where an endpoint lacks one, the adapter filters client-side and the aggregation route is the fix (flagged in the U-1 PR).
- Moving stage routes out of the sidebar could hurt discoverability for returning users; mitigated by the Deals board entry and a one-time "Where did stages go?" notice (dismissible, no persistent nag).
- Decomposition risk is regressions in memoized state; mitigated by hook-first extraction and unchanged stage tests.
- All AI-drafted items in the inbox remain proposals; the design deliberately offers the draft to shorten reading time while the decision control stays human-only.
