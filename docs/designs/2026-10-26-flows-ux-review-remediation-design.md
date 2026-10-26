---
lang: ko
lang_reason: source-material
title: "/flows console — cross-project UX review remediation — design"
date: 2026-10-26
status: approved
status_note: Cross-project UX review 2026-10-26 (real-browser evidence); PM-triaged. Implemented scope is 12 of 13 findings; finding 2 is dispositioned by-design and excluded (see §Out of scope).
author: ux-designer-agent
design_of_record:
  - "docs/designs/2026-10-25-agent-assignment-prompt-standard-design.md §6 + §14 (serpentine geometry, machine-checked by tests/unit/flows-console-view.test.ts)"
  - "docs/design-foundation.md + docs/design-system/design-tokens.md (Onyx doctrine: 14px reading floor, visible :focus-visible, tokens as the only color source)"
lang: en
---

# /flows 콘솔 UX 리뷰 해소 설계 (2026-10-26)

## Background

A cross-project UX review (2026-10-26, real-browser evidence at a 1280px viewport) audited the /flows console and recorded 13 findings: SVG text below the 14px reading floor, missing `aria-selected` on tabs, a keyboard-impossible help instruction, weak fork-band direction cues, a summary/chart scope mismatch placed below the fold, inverted chart legend color semantics, invisible chip focus, bidirectional i18n leaks, internal jargon in the legend, distant click feedback, unsynced stage selection, and a bare document title. Finding 2 (auth gate on /flows) was dispositioned by-design and is out of implementation scope. This document is the Design Gate artifact for the remediation; geometry constants of record are §14 of the prompt-standard design and the machine-check in `tests/unit/flows-console-view.test.ts` (v1.6.0 at review time).

## Goals / Non-goals

**Goals**: bring every /flows surface to the Onyx floor (≥14px reading text, visible keyboard focus, tokens-only color, catalog-only strings, convention-correct status colors) with zero API/SSOT changes — presentation layer, shared UI primitives, and locale catalogs only.

**Non-goals**: any `/api/flows` contract change; `SPECIALIST_TRACK_AFFINITY` / generator changes (notes stay in the payload as fallback); flow.spec, prompts.json, auth model; chart library swap; the dry-run session-page usability overhaul (owned by design `2026-10-25-flows-decider-feedback-chart-axis-dryrun-ux-design`).

## Remediation table

| # | Finding (review) | Fix | Acceptance (implementer must meet) |
|---|---|---|---|
| F1 [P0] | SVG text below 14px floor: names 12px, captions 9.5px, badges 10px rendered | Raise SVG fonts + card geometry together (§F1) | Rendered ≥14px names, ≥12px badges, ≥12px captions at 1280px viewport; machine-check re-pinned green |
| F3 [P1] | `role="tab"` without `aria-selected` | Add `aria-selected` synced to `?tab=` (§F3) | Active tab `aria-selected="true"`, inactive `"false"` |
| F4 [P1] | Stage nodes `<g onClick>` non-focusable vs "click a node" help text | Keyboard-operable nodes (§F4) | Tab reaches each node; Enter/Space filters; visible 2px accent focus ring |
| F5 [P1] | Weak arrowheads; R→L band reads poorly; overflow scroll un-signaled | Stronger arrow tokens + band labels + edge fade (§F5) | Arrowheads legible; band labeled; fade appears only when overflowing |
| F6 [P1] | Summary vs last-100-runs chart mismatch explained below the fold | Scope caption next to chart title (§F6) | Caption visible beside chart title without scrolling |
| F7 [P1] | Legend colors inverted (success=blue, failure=green) | Re-map to convention tokens (§F7) | success=green family, failure=red family; ✓/✕ pairing kept |
| F8 [P1] | Track chips: focus indistinguishable from selection | Standard accent focus ring (§F8) | `:focus-visible` ring visible on pressed AND unpressed chips |
| F9 [P1] | i18n leaks both directions | Catalog keys for all leaked strings (§F9) | 0 raw/payload-borne display strings; i18n-resolution + i18n-lint green |
| F10 [P1] | Legend jargon: DEC id, raw domain keys, note wall | Tooltip DEC, clean labels, collapsed notes (§F10) | No DEC literal as visible text; human labels; notes behind disclosure |
| F11 [P2] | Node-click feedback lands far away | Selection chip adjacent to graph (§F11) | Filter state visible+clearable without scrolling |
| F12 [P2] | Stage selection not URL-synced | `?stage=S9` like `?tab=` (§F12) | Restore on load; clear removes param |
| F13 [P2] | Bare document title | Per-page title layout (§F13) | "Flow console · {brand}" pattern |
| 2 [—] | Auth gate on /flows | **By design — excluded** | Documentation only |

## Per-fix design

### F1 — SVG text sizes + serpentine geometry re-pin

Raise font sizes inside `flow-graph.tsx` and grow the card constants proportionally so the longest strings still fit un-truncated; the machine-check (`flows-console-view.test.ts` → **v1.7.0**) re-pins per-row assignment, pairwise non-overlap, edge anchors, viewBox containment, and the longest-stage-name arithmetic as one unit — constants and test change in the same PR.

- Fonts: stage id + stage name `12→14`, activity count + marker gutter labels `9.5→12`, track badge `10→12`.
- Geometry targets: `NODE_W 232→264`, `NODE_H 64→80`, `COL_GAP 36→32` (pitch 296), `VIEW_W 1068→1184`, `VIEW_H` re-derived (row Y table shifts with the gutter for 12px labels). At a 1280px viewport the review measured scale ≈1.0, so rendered sizes land at ≈14/12/12px — exactly the floor.
- Arithmetic that must re-pin: longest stage name "시너지·전략적 적합성" ≈141px @14 < `NODE_W−24` = 240 (un-truncated; the `truncateToWidth(…, 14, NODE_W − 24)` call site pin updates with it); longest marker gutter label ≈226px @12 ≤ `NODE_W−8` = 256; badge width formula `len×5.5+16` re-derived for 12px (≈`len×6.6+16`); dot row / count label / badge non-overlap at the new baselines (id +22, name +46, dots +64, count +67).

### F3 — Tabs `aria-selected`

In the shared `Tabs` primitive (`components/ui.tsx`): add `aria-selected={active === t.key}` to each anchor, remove the mismatched `aria-current="page"`, keep `role="tab"`/`role="tablist"`. This is ARIA-tabs-lite — anchors are natively focusable and Enter-activatable, so no roving tabindex; `aria-controls` is omitted (panels have no stable ids; the URL `?tab=` is the state carrier). The change is shared across all pages using `Tabs` — a11y-improving and additive; existing markup pins elsewhere are swept in the same PR.

### F4 — Keyboard-operable stage nodes

This amends the §6.4 rule "no focusable elements inside the SVG" (append-only — this section prevails): the help text promises pointer-or-keyboard filtering, so the nodes themselves become operable. On each stage `<g>`: `role="button"`, `tabIndex={0}`, `aria-label` = existing `nodeTitle` interpolation, `onKeyDown` Enter/Space → `onSelectStage(s.id)` (same handler as click). Focus indicator: a state-driven focus ring `<rect>` (accent stroke, 2px, offset 2, radius 10) rendered while the node matches `:focus-visible` — CSS `outline` on SVG internals is browser-inconsistent, so the ring is explicit. The v1.3.0-era "graph stays out of the tab order" regression pins are reversed in v1.7.0. Fallback (only if hit-area complexity proves prohibitive during implementation): amend `graph.sectionHint` to state keyboard inoperability — partial a11y credit; the real fix above is preferred.

### F5 — Fork-band direction cues

- Arrowheads: marker fill `var(--border)` → `var(--muted-fg)`, edge `strokeWidth 1.4→1.6`, marker `markerWidth/Height 7→9` — tokens only, no raw hex (design-lint).
- Band labels: compact track-direction labels rendered in the row-2 gutter near the S5 lane and the S6→S7 lane, keyed `graph.trackGreenfield` / `graph.trackBrownfield` (12px, `var(--muted-fg)`), with the direction carried by the existing arrowheads (no arrow glyph inside the catalog string).
- Overflow hint: an overlay element on the scroll container — `linear-gradient(to right, transparent, var(--bg))` mask strip on the right edge, visibility toggled by a scroll/resize listener (`scrollLeft + clientWidth < scrollWidth`). Visible only while overflowing; colors are tokens. A `title`-based native hint reuses `graph.scrollHint`.

### F6 — Chart scope caption at the point of clash

Add a chart heading row directly above the EChart: `ledger.chartTitle` ("호출 수 추이" / "Call volume") + `ledger.chartScopeCaption` ("화면에 불러온 최근 {p1}건 기준" / "Covers the last {p1, plural, one {# record} other {# records}} loaded on this screen") — the clash between the summary card (whole-window, e.g. 2,687 calls) and the chart (cursor page, ≤100) is explained where it is felt, not only below the table. The existing below-table `chartTableNote` stays.

### F7 — Status color convention

`chartOption` sets explicit per-series colors: success bar → `var(--chart-2)` (green, #0c9d6c), failed bar → `var(--chart-4)` (red, #dc2626). Canvas cannot read CSS vars, so resolution goes through `lib/echarts-theme.ts`: extend `chartTokens()` to also read `--chart-2`/`--chart-4` as named `statusOk`/`statusFailed` fields (presentation-layer lib addition; UNRESOLVED fallback extended), and bind series `itemStyle.color` from the resolved theme. Cost line keeps the palette default. Legend/table ✓-marker pairing (color-never-sole-channel) is unchanged. Machine-check v1.7.0 pins: success series resolves the green token, failed the red, in that order.

### F8 — Chip focus ring

`.control-chip:focus-visible` currently rings with `var(--primary)` — the same color as the pressed fill, so focus on a selected chip is invisible (the review's "focus indistinguishable from selection"). Fix: ring with `var(--accent)` at `var(--border-width-strong)` (2px) + 1px offset, matching the global `:focus-visible` rule and the tab/skip-link pattern; verified on pressed and unpressed chips in both themes.

### F9 — i18n leak sweep (ko master, en deep-merge)

Verified leak sites and their keys (values below are ko master; en deep-merges its own):

- `pages.flows.dryRunSession.createdValue` — `{p1} · by {p2}` → ko `{p1} · {p2} 님 작성`, en `{p1} · by {p2}` (keyed attribution template).
- `pages.flows.dryRunSession.ledgerLine` — ko `LLM 호출 {p1}회 · 런 {p2}회`, en `{p1, plural, one {# LLM call} other {# LLM calls}} · {p2, plural, one {# run} other {# runs}}` (ICU plural; "llm"→"LLM" fixed in the ko value).
- `pages.flows.dryRunSession.labelBaseAgent` and the base/override family (`basePromptRef`, `abScopeNote`, `legBaseTitle`, `legBaseEmpty`, `prefBase`, `prefGroup`, `diffNote`, `blockedNoOverride`) — Korean-first wording with the domain term parenthesized: "기본(base) 에이전트", "대체(override) 에이전트" pattern; wording coordinated with glossary-curator (base/override stay defined domain terms, never bare jargon).
- `chips.costMeasuredNote` — ko value "…{p2}회 llm 호출…" → "…LLM 호출 {p2}회…".
- `pages.flows.ledger.filterSourceLlm` (new) — the hardcoded `<option>llm (AI)</option>` becomes a key; ko `LLM (AI)`.
- Hardcoded `greenfield`/`brownfield` chip labels in `blueprint-view.tsx` → `tg("trackGreenfield")` / `tg("trackBrownfield")` (new keys, also consumed by F5).
- The four specialist-marker interpretations are payload-borne Korean (`note` from `SPECIALIST_TRACK_AFFINITY` via the API) and leak into the EN view. Remediation is presentation-layer only: `flow-graph.tsx` gains `markerNoteKey(stageId, activityId)` → `markers.notes.<ref_underscored>`; resolve via `t.has()` and fall back to the payload `note` (unknown future markers stay safe). New keys: `markers.notes.s2_business_model_sketch`, `markers.notes.s4_deal_shape_evaluation`, `markers.notes.s9_capability_dd`, `markers.notes.s11_investment_structuring` — ko keeps the curated wording, en carries faithful translations.
- Counter keys (`activityCount`, `recentRunsCount`, `sourcePrompts`, `footnoteTail`…) already resolve in both catalogs; en counter keys gain ICU plural where number-sensitive. `flows-i18n-resolution.test.ts` (static extraction of every `t()/tg()/tc()/tr()` call site) must stay green; `i18n-lint` 0 violations.

### F10 — Legend jargon and the note wall

- Domain labels: `legend.domains.*` values drop the raw-key parenthetical — `functional` → "기능"/"Functional", `_core` → "핵심"/"Core", `_shared` → "공유"/"Shared", plus industry/region/technical in the same pattern. Keys unchanged; values cleaned.
- DEC id: `DEC-20261025-02` must never render as visible legend text. It moves into a tooltip: `markers.decisionRef` ("판정 근거: DEC-20261025-02" / "Decision record: DEC-20261025-02") as the `title` on the marker-notes disclosure. v1.7.0 adds a regression pin: no `DEC-` literal in visible text nodes of the legend.
- Note wall: the marker interpretation `<ul>` collapses behind a native `<details>` with `markers.detailsSummary` ("마커 해설 {p1}건" / "{p1, plural, one {# marker note} other {# marker notes}}") — same disclosure pattern as `viewAsTable`.

### F11 — Adjacent selection feedback

When `selectedStage` is set, `BlueprintView` renders a chip in the graph section, directly under the graph (before the activity table): `graph.filterChipLabel` ("{stage} 단계로 활동 표가 필터되었습니다" / "Activity table filtered to {stage}") + `graph.filterChipClear` ("필터 해제" / "Clear filter"). Clearing here and at the existing bottom chip share one handler (F12 URL sync included); the bottom Clear button stays.

### F12 — `?stage=` URL sync

`BlueprintView` reads `useSearchParams`: initial `selectedStage` from `stage`; every select/clear writes/removes the param via `router.replace(…, { scroll: false })`, preserving unrelated params — the exact `?tab=` pattern. `LedgerView`'s filter sync already preserves foreign params, so the param survives tab switches and restores the selection on return.

### F13 — Document title

`/flows` is a client page, so add `app/web-next/app/flows/layout.tsx` with `generateMetadata` reading `pages.titles.flows` (new key: "플로우 콘솔" / "Flow console") — the root layout title template supplies the brand suffix, rendering "Flow console · {brand}" exactly like `pipeline/layout.tsx` and the other R2 page contracts (WCAG 2.4.2).

## Test plan

| Target | Method |
|---|---|
| Geometry + view conventions | `flows-console-view.test.ts` v1.6.0 → **v1.7.0**: re-pin NODE_*/VIEW_* arithmetic (per-row assignment, non-overlap, edge anchors, containment, longest-name/badge/gutter-label fits); new pins — `aria-selected` call site, node `role="button"`+`tabIndex`, focus-ring rect, arrow token/width, band labels, edge-fade overlay, chart series color order (green success, red failed), chip `:focus-visible` accent rule, no visible `DEC-` literal, F11 chip call sites |
| i18n | `flows-i18n-resolution.test.ts` green (statically resolves every call site against ko+en, placeholders intact); `i18n-lint` 0 violations; manual ko/en sweep of /flows, /flows/dry-run, session detail |
| Tokens / design | `design-lint` (edge-fade gradient, arrow fill, focus ring all token-based) |
| Types | `tsc` in app/web-next (ChartTheme extension, prop changes) |
| Rendered sizes (F1) + focus visibility (F4/F8) | Manual in-browser check at 1280×800, light+dark, recorded in the task report |
| Regression sweep | Existing unit suite green; `Tabs` consumers spot-checked (aria-selected additive) |

## Risks

| Risk | Mitigation |
|---|---|
| Geometry regression after F1 resizing | Constants and v1.7.0 machine-check land in one PR; the checker fails on any overlap/truncation/containment violation before merge |
| Focus ring on SVG nodes inconsistent across browsers | Ring is an explicit state-driven `<rect>`, not CSS outline; verified manually in Chromium + WebKit |
| Chart colors unresolved before first paint | `useChartTheme` already retries once after paint; UNRESOLVED fallback extended with gray status pairs — never the wrong hue |
| Shared `Tabs` change touches other pages | Additive attribute; unit pins swept in the same PR |
| F4 fallback weakens a11y | Fallback (help-text amendment) is recorded as partial credit only; the keyboard-operable node is the primary design |
| ko wording changes (base/override family) drift from domain vocabulary | Glossary-curator coordination noted; domain terms preserved in parentheses |

## Out of scope

- **Finding 2 (auth gate on /flows) — BY DESIGN, excluded.** The app enforces session auth client-side in AppShell per the security model (ADR-0038 deny-by-default); the flow console is an internal governance surface, not public. Remediation is documentation/notice only (this section); no code change.
- Any API/SSOT change (`/api/flows` payload, `SPECIALIST_TRACK_AFFINITY`, generator, flow.spec, prompts.json) — the payload `note` stays as the locale-neutral fallback.
- Backend run-ledger windows or cursor limits (F6 explains the scope; it does not change it).

## Recorded follow-ups (AI-2nd review 2026-10-26)

- **FU-A (F1 scale condition)** (implemented 2026-10-26 — see Design delta): the Onyx 14px floor for SVG stage names is met at uniform scale ≈1.0 (sidebar collapsed); at 1280px with the default open sidebar the viewBox scales to ≈0.785, rendering names ≈11px. Uniform SVG scaling pre-existed this design. Follow-up options: raise the graph `minWidth` toward 74rem (letting scroll+fade carry narrower containers) or record sidebar-collapsed as the reference condition in the machine-check. Owner: PM routing.
- **FU-B (EN stage names)** (implemented 2026-10-26 — see Design delta): the EN view still renders Korean stage names — payload-borne from `process/flow.spec.yaml` via `/api/flows` (`stageDisplayName`, `flows-view-lib.ts`), not chrome text; outside this design's F9 enumeration, and the SSOT is a stated non-goal. Remedy direction: a `stageNames.*` catalog family via the `markerNoteKey` pattern, needing a small design delta (SSOT-adjacent decision). Owner: PM routing.

## Design delta (2026-10-26, PM-approved follow-up round)

> Attribution: both rulings below are **PM decisions** (recorded in the 2026-10-26 follow-up dispatch), resolving the two open follow-ups above. Implemented by frontend-engineer the same day. Append-only — nothing above is rewritten.

### FU-A — SVG scale condition: `minWidth` 50rem → 74rem

- **Ruling (PM)**: raise the scroll container's SVG `minWidth` from `50rem` to `74rem`. The graph's natural width is `VIEW_W` 1184px = 74rem (at the 16px root-font regime, i.e. below the 1920px root step), so the 1:1 equality means the graph **always renders at scale ≥ 1.0 — never downscaled**. The 14px/12px reading floors therefore hold at any viewport: containers narrower than 74rem get the existing horizontal scroll + edge-fade hint (F5 affordance) instead of a shrunken graph. This resolves the AI-2nd measurement (1280px viewport, sidebar OPEN: scale ≈0.785, names ≈11px < 14px floor). At ≥1920px the root-font step (15px/rem) would make 74rem = 1110px, but there the viewport itself exceeds the graph's natural width, so `minWidth` never binds — the 1:1 guarantee is unaffected.
- **Implementation**: `flow-graph.tsx` container `minWidth: "74rem"` (+ comments); machine-check `flows-console-view.test.ts` **v1.7.0 → v1.8.0** — new pin asserts `minWidth: "74rem"`, the `74 × 16 = VIEW_W` equality, and that no `"50rem"` remnant survives; F1 render-size rationale updated (scale ≥ 1.0 invariant replaces the "scale ≈1.0 at 1280px" assumption).
- **Acceptance**: rendered stage-name size ≥ 14px at 1280px with the sidebar OPEN (browser re-check owned by the AI-2nd pattern); scroll+fade engages below 74rem (F5 pins unchanged).

### FU-B — EN stage names: chrome-side `pages.flows.stageNames.*` catalog family

- **Ruling (PM)**: catalogize the payload-borne stage display names chrome-side — `pages.flows.stageNames.<stageId>` (S1–S12) resolved via the `markerNoteKey` pattern: `t.has()` lookup keyed by the payload stage id, **falling back to the payload Korean name when a key is absent**. The SSOT (`process/flow.spec.yaml`) stays untouched and there is **no API change**; a future stage without a catalog key degrades gracefully to the payload name.
- **Values**: ko = the exact flow.spec names verbatim (SSOT echo — machine-pinned); en = the house English names — Market analysis; Opportunity discovery; Synergy & strategic fit; Route decision; Greenfield entry; Target longlist; Target shortlist; Business feasibility; Due diligence & verification; Investment structuring; Investment review & execution; Post-investment management. Alignment source: `docs/wiki/en/` does not exist (wiki is ko-only), so the PM-specified house names govern; S1/S2/S3/S5 agree with existing en catalog usage ("Market analysis", "Opportunity discovery", "Synergy & strategic fit", "Greenfield entry" already present in `locales/en.json`).
- **Implementation**: resolution is single-owned in `flow-graph.tsx` — `stageNameKey(stageId)` + `stageDisplay(stage, tp)` (payload fallback = `stageDisplayName`'s id defense) — applied at every chrome consumption site found by grepping `stageDisplayName`: the graph node name text and node `aria-label`/`<title>` (`flow-graph.tsx`), and the F11 selection chip (`blueprint-view.tsx` `selectedStageName`). `flows-view-lib.ts` stays payload-only (its "no `stageNames` copy" pin is kept and re-commented). `layout.tsx`'s title helper was verified to carry no stage-name consumption ("Flow console" is stage-free) — no change needed there; the activity-table stage column and header clear chip render the stage **id** (locale-neutral code), likewise unchanged.
- **Tests**: `flows-i18n-resolution.test.ts` **v1.1.0 → v1.2.0** — `stageNameKey(...)` joins the dynamic-key allowlist exactly like `markerNoteKey`; translator var `tp` (`pages.flows`) joins the FILES map for `flow-graph.tsx`/`blueprint-view.tsx`; a dedicated enumeration asserts every serving stage id resolves in BOTH catalogs, ko echoing flow.spec verbatim, en placeholder-free. `flows-console-view.test.ts` v1.8.0 extends the longest-stage-name arithmetic to **both locales**: en longest "Investment review & execution" ≈223px @14 fits the 240px card cap un-truncated (ko pin ≈141px unchanged) — no truncation needed in either locale; the truncation defense-line pin re-binds to the `stageDisplay` call site.
