---
title: UI label and mobile table sweep - raw enum labels, stage chrome headings, 375px table squeeze
status: approved
date: 2026-10-11
owner: platform-lead
domain: technical
---

# UI label and mobile table sweep

Source: read-only logged-in QA sweep on 2026-10-11. Base: PR 497 (adds `lib/sim-note.ts`, review-display
fixes, `.targets-table` nowrap rule). This design does not redo those.

All changes are display-layer only. No stored enum, API field, DB schema, auth, or MCP tool scope
changes. Korean UI strings are described here in English; the implementer writes the Korean wording
from `glossary/*.yaml` or the existing maps in `app/web-next/lib/labels.ts`.

**ADR assessment**: none required. No item touches the ADR trigger list (DB schema, auth, MCP scope,
policies/procedures). Glossary YAML is not edited; if an open question below resolves to a new term,
that goes through glossary-curator separately.

## 1. Raw values in the Korean UI

### 1.1 Approach

- Extend `app/web-next/lib/labels.ts` as the single label map (it already holds `GATE_LABEL`,
  `DECISION_LABEL`, `TRACK_LABEL`, `CLOSURE_TYPE_LABEL`). No new per-component maps; existing local maps
  (`PortfolioStage.tsx` decision map at L56-58, `localizeMessage` S12 names) move into `labels.ts` and are
  imported back so wording cannot drift.
- New exports (names indicative):
  - `SUB_TRACK_LABEL` (`m_and_a`, `existing_business_rbd`, `partnership`, plus any other sub-track key in
    `procedures/`), `STAGE_STATUS_LABEL` (`in_progress`, `complete`, `current`, ...),
    `DECISION_MODE_LABEL` (`agent_team`, `human_only`, `hybrid`), `TRANSITION_DECISION_LABEL`
    (`next_tranche_released`, `held_evidence_incomplete`, `graduate_to_core`, `reduce_or_divest`,
    `kill_with_learning_captured`), `RAG_DIMENSION_LABEL` (`financial`, `market`, `regulatory_permit`,
    `technical_execution`, `risk`, and the sixth dimension), `RECORD_KEY_LABEL` (`deal_structure`,
    `venture_transition_decision`, `decided_by`), `GLOSSARY_CATEGORY_LABEL` (`BUSINESS`, ...).
  - Helpers: `label(map, key)` returning `{ text, raw, known }`; `trackLabel(track, subTrack)`;
    `gateLabel(id)`; `ragDimensionsLabel(keys[])` joining with the Korean list separator.
- Glossary-backed: where a glossary term exists (FS, IC, DD, Green Field, Brown Field, Screening), the
  label uses the glossary `term_ko` wording verbatim; a source-reading test asserts it.
- Fallback: an unknown key renders a neutral Korean placeholder (e.g. "unclassified") in the visible
  text; the raw key is shown only inside a `<details>` "developer details" disclosure via a small
  `RawKey` component. It never renders blank and never renders the raw key inline in prose.

### 1.2 Site list per page (bounded)

| Page | File:line | Raw value | Fix |
|---|---|---|---|
| /projects/[id] | `app/projects/[id]/page.tsx` L99 | `track` / `subTrack` | `trackLabel()` |
| /projects/[id]/process | `app/projects/[id]/process/page.tsx` L140 | track, subTrack, currentStage/nextStage | `trackLabel()`; stage id + stage name |
| /projects/[id]/process | same file L87-95 (`StageList` gate chips, `title`) | `screening`, `pre_fs`, `target_screening`, `entity_ic`, `group_ic` | `GATE_LABEL` text; `title` uses label + decision label |
| /projects/[id]/process | same file `requiredArtifacts.join` L84 | artifact keys | `RECORD_KEY_LABEL` with fallback |
| /deals/[id] | `app/deals/[id]/page.tsx` L94 | track, subTrack | `trackLabel()` (keep "undecided" wording) |
| /deals/[id]/[stage] | `app/deals/[id]/[stage]/page.tsx` L249 | `stage.status` (`in_progress`) | `STAGE_STATUS_LABEL` |
| /projects/[id]/charter | `app/projects/[id]/charter/page.tsx` L165 | subTrack | `trackLabel()`; intent text already Korean - move to `INTENT_LABEL` in labels.ts (shared with `route-decision/DecisionTab.tsx` L174) |
| /projects/[id]/charter | charter ledger rendering of `venture_transition_decision`, `decided_by=...` | record keys | `RECORD_KEY_LABEL`, `TRANSITION_DECISION_LABEL` |
| S12 portfolio | `components/stages/PortfolioStage.tsx` L56-81, L362, L375 | decision keys, `decided_by`, `tranche_condition`/`core_handoff` in field labels | move map to labels.ts; remove key names from Korean field labels and prose (keep in developer disclosure) |
| Closure modal | `components/ClosureModal.tsx` L48 | `graduate_to_core`, `core_handoff` in hint | `TRANSITION_DECISION_LABEL` |
| Deal structure | `components/stages/DealStructureStage.tsx` L180, L326 | `deal_structure_review` in error/placeholder | Korean wording, key in disclosure |
| Committee panel | `components/CommitteePanel.tsx` L264 option text, L547 meta line | `agent_team`, `human_only`, gate, status | `DECISION_MODE_LABEL`, `GATE_LABEL`, status label |
| IC review | `components/stages/IcReviewStage.tsx` L306 | `missing_dimensions` keys | `ragDimensionsLabel()` |
| IC review / DD | `IcReviewStage.tsx` L266, `DdStage.tsx` L554 | finding `category` | DD category label (reuse `DD_DOMAIN_LABEL` if the domain set matches, else new map) |
| IC review prose | the IC review page copy containing the UI term "select" | developer term in prose | replace with the Korean verb used by the button it refers to |
| /glossary | `app/glossary/page.tsx` L83, L168 | category `BUSINESS` | `GLOSSARY_CATEGORY_LABEL` |
| /glossary | glossary card title | duplicate "Green Field - Green Field"; `corp_code` shown as a term | render `term_en` only when it differs from `term_ko` (case-insensitive); `corp_code` see open question Q3 |
| /strategy | `app/strategy/page.tsx` L53 | field name `why_it_matters_ko` in prose | rewrite as "why-it-matters explanation" in Korean |
| /companies/[id] | `app/companies/[companyId]/page.tsx` L81 | "dart corp code" | Korean "DART corporate code" label; see section 4 for h1 |
| Financial panel | `components/FinancialAnalysisPanel.tsx` L117 | "dart corp code" | same label constant |

Out of list items found during implementation are added to the PR description, not silently fixed.

## 2. Page headings for /agents and /our-company

Root cause: both pages wrap their content in `StageFrame` (`components/StageFrame.tsx` L97-98), which
renders the stage h1 and stage chrome. `app/agents/page.tsx` L61 passes `stageId="S2"` and
`app/our-company/page.tsx` L14 passes `stageId="S3"` with `heading="S3 group/affiliate analysis"`; the
`layout.tsx` files set the same stage names as document titles. The content (agent roster / our-company
profile) is not a deal stage.

Spec (no route change):
- Stop using `StageFrame` on these two pages; use the standard page shell (main + page h1 + breadcrumb
  per design-guide standard screens).
- /agents: h1 and document title "Agents" (Korean equivalent of the nav label); breadcrumb Home > Agents.
- /our-company: h1 and title "Our company" (match the nav label); breadcrumb Home > Our company. A
  one-line paragraph may say the profile feeds stage S3; no stage chips.
- If the deal-tab reuse of the our-company component needs the stage frame, it keeps it there only
  (`deals` tab path), per the comment at `our-company/page.tsx` L5.
- Nav labels are the source of truth for wording; the frontend-engineer copies them, not invents them.

## 3. Mobile (375px) table squeeze

Root cause: the global rule in `app/styles.css` L3715-3718 (`@media (max-width: 640px)`) sets chips and
buttons to `white-space: normal; overflow-wrap: anywhere`, and tables inside `.table-scroll` shrink
columns to the viewport, so dates, project numbers and names break per character. PR 497 fixed only
`.targets-table`.

Shared fix (one rule set, no per-page hacks):
- Generalize the PR 497 rule into an opt-out pattern: inside `.table-scroll`, `.data-table` becomes
  `display: table; width: max-content; min-width: 100%` and `.status-chip`, `.btn-ghost` and new cell
  tokens stay `nowrap`. `.targets-table` rules then become redundant and are folded in.
- Cell tokens in `styles.css`: `.cell-nowrap` (dates, ids, project numbers, user names, chips),
  `.cell-wrap` (free text, max-width 28ch, normal wrapping). Tables mark id/date/name columns
  `cell-nowrap`; descriptive columns `cell-wrap`.
- Horizontal scrolling stays inside the existing `.table-scroll` wrapper (it must have
  `overflow-x: auto`, `tabindex="0"`, and an `aria-label`/caption so keyboard users can scroll).
- No card layout below 640px in this change (larger redesign; open question Q8).
- Non-table: `/projects/[id]/process` `StageList` (L77-97): the name span is `flex-1` with no
  `min-w-0`, squeezed by fixed-width chips. Fix: on narrow screens stack the gate chips under the name
  (`flex-wrap`, chips row `basis-full`), give the name span `min-w-0`, and drop the fixed `w-[5.2rem]`
  in favour of `nowrap` chips.

Affected tables: `app/projects/page.tsx` L83, `app/deals/page.tsx` (deal list), `app/projects/[id]/agent-runs/page.tsx`
L39, `app/projects/[id]/dd` (DD workspace tables in `components/stages/DdStage.tsx`),
`app/projects/[id]/ic-review` (`components/stages/IcReviewStage.tsx`), `app/projects/archives/page.tsx`
L118, `app/portfolio-view/page.tsx` L61, `app/projects/[id]/incentives/page.tsx` L59, plus
`BusinessCaseStage.tsx` L570 (already targets-table; migrate to tokens). Any `data-table` not inside a
`.table-scroll` gets wrapped.

## 4. Low items

- **Admin access**: one consistent behaviour for all `/admin/*` sub-pages for non-admin users: render an
  in-place notice "Administrator access is required" (Korean, matches `localizeMessage` wording) with a
  link back to /deals, HTTP status unchanged. Implement once in `app/admin/layout.tsx` (or the existing
  admin guard it calls) and remove any per-page silent redirect to /deals; Row 2 locates the redirect
  source (layout, middleware/proxy, or client guard) and records it in the PR.
- **/settings 404**: add `app/settings/page.tsx` that server-redirects to `/settings/connected-apps` (only
  child today). If a second settings page is added later it becomes an index.
- **Company page h1**: `app/companies/[companyId]/page.tsx` L79-81 - h1 holds only `name_ko`; the DART
  code and other info move to a paragraph under the h1.
- **Inaccessible project (non-member, e.g. demo-s1-s12-project)**: `app/projects/[id]/layout.tsx` must
  not render stage chrome when the process fetch returns 403/404. Render a Korean not-found state: h1
  "Project not found", paragraph "The project does not exist or you do not have access", link to
  /projects. No raw English "Not found." text (also reuse it for `ReviewBuckets.tsx` L156 and the
  `StageFrame.tsx` L25 path). Does not distinguish 403 from 404 to the user (no existence leak).

## 5. Non-goals and open questions (product decision pending)

Non-goals: inbox link destination; FS gate inside the inbox; /greenfield auto-redirect to an arbitrary
deal; S5 CTA text "S8 business analysis (after promotion)" linking to S6; membership model behind the
demo project 404s (only the graceful screen is in scope).

Open wording questions (do not invent; route to glossary-curator / product owner):
- Q1 Korean names for sub-tracks `existing_business_rbd` and `partnership` (no glossary term).
- Q2 Korean names for `held_evidence_incomplete` and `next_tranche_released` (PortfolioStage has an
  interim wording for the latter; confirm it).
- Q3 Should `corp_code` be a glossary term at all, or removed from the glossary list.
- Q4 Glossary category display names (`BUSINESS` and the rest of the `_schema.yaml` enum).
- Q5 Korean label for decision mode `hybrid` vs `agent_team` (the option text mixes key and description).
- Q6 RAG dimension Korean names (confirm against `rag-scoring-framework` wording).
- Q7 Whether the fallback placeholder should be "unclassified" or "label pending".
- Q8 Card layout below 640px for list pages (future change).

Until answered, the label maps carry a clearly marked interim value and a test lists the interim keys.

## 6. Tests

- Row 1: `lib/__tests__/labels.test.ts` - every key in each new map has a non-empty Korean value with no
  ASCII snake_case; `label()` fallback returns `known: false` and preserves `raw`; `trackLabel`
  combinations; `ragDimensionsLabel` ordering; glossary-backed entries equal `glossary/*.yaml`
  `term_ko` (source-reading test parses the YAML).
- Row 2 source-reading tests: the files in the section 1.2 table no longer interpolate the raw fields
  (`{data.track}`, `{process.track}`, `{stage?.status}`, `missing_dimensions.join`, `{t.category}`) and
  import from `lib/labels`; `app/agents/page.tsx` and `app/our-company/page.tsx` do not import
  `StageFrame`; `styles.css` contains the shared `.table-scroll .data-table` rule and the cell tokens;
  `app/settings/page.tsx` redirects; the project layout has the not-found branch.
- `bun run design:lint`, typecheck, and existing web-next tests stay green.

## 7. Accessibility

- Each `.table-scroll` is focusable (`tabindex="0"`), labelled, and keeps a `<caption>` or `aria-label`
  so horizontal scroll is reachable by keyboard (WCAG 2.1.1, 1.4.10 reflow exception for data tables).
- Gate and status chips keep text, not colour only; `title` attributes are not the only carrier of
  meaning (labels are in the visible text).
- One h1 per page; headings for /agents and /our-company match nav labels and document titles (2.4.2,
  2.4.6). Not-found state uses h1 and a real link.
- Developer-details disclosure uses native `<details>/<summary>` and is collapsed by default.
- `lang` stays `ko`; raw English keys inside the disclosure are wrapped in `<code lang="en">`.

## 8. Preview verification

Frontend-engineer verifies in the preview at 375px and 1280px (and 768px for tables) on: /projects,
/deals, /projects/[id]/process, agent-runs, dd, ic-review, charter, portfolio (S12), /glossary,
/strategy, /companies/[id], /agents, /our-company, /settings, one /admin sub-page as non-admin, and a
non-member project URL. Pass: no raw snake_case or English keys in visible text outside the disclosure,
no cell breaking a date/id/name across lines, horizontal scroll inside the wrapper only (no page-level
horizontal scroll). Screenshots go in the PR.

## 9. Task split

| Row | Agent | Scope |
|---|---|---|
| 1 | backend-engineer | `lib/labels.ts` new maps and helpers, move PortfolioStage/localizeMessage/intent maps in, `RawKey` data contract, `labels.test.ts` incl. glossary source-reading test |
| 2 | frontend-engineer | wire all section 1.2 sites, `RawKey` disclosure component, /agents and /our-company shell, styles.css table tokens and StageList layout, admin notice, /settings redirect, company h1, project not-found state, source-reading tests, preview verification at 2+ breakpoints |
