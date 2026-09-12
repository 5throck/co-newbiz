# Deal-Centric Workspace UI Redesign — Design

- **Spec ID**: 2026-09-12-deal-workspace-ui-redesign-design
- **Date**: 2026-09-12
- **Status**: proposed (implementation gated on mockup approval)
- **ADRs**: ADR-0119 (primary action + chip separation), ADR-0120 (deal-centric IA), ADR-0121 (PageState/Toast/DataTable/Tabs)
- **Mockup**: docs/designs/mockups/deal-workspace.html
- **Method**: ui-information-architecture + ui-ux-design-intelligence checklists; ADR-0087 order (principles → tokens → components → patterns → screens)

## 1. Problem (evidence)

Usability review of 2026-09-12: 47/47 pages are single-file client components
(13,053 lines); one page stacks 16 tables; 140+ identical ghost buttons;
`.status-chip` doubles as filter/sort/score control; four stacked navigation
systems; 27 ad-hoc loading strings and 45 one-off alert paragraphs; a deal's
S1–S12 journey is scattered across six top-level pages. Full findings are in
the audit notes appended to memory/2026-09-12.md.

## 2. Information architecture (ADR-0120)

```
Sidebar
├─ Deals
│  ├─ Deal board            /deals            (funnel + project snapshot + gate aging + paused chips)
│  └─ Deal list            /deals/list
├─ Reference
│  ├─ Market analysis           /market           (deal-independent industry analysis)
│  ├─ Group/affiliates        /our-company
│  ├─ Companies               /companies
│  ├─ Benchmarks           /benchmarks
│  ├─ Library         /library
│  └─ Glossary             /glossary
└─ Admin (role-gated)     /admin/**

Deal workspace
├─ /deals/{id}                     overview — current stage, next action, completion checklist, gate status
└─ /deals/{id}/s1 … s12            stage tabs — track-inapplicable tabs hidden (S5 GF / S6·S7 BF)
```

`{id}` resolves opportunity or project via `source_opportunity_id`. The
sidebar, stepper, tabs, and completion guidance all render from the spec
projections (`STAGE_META` / `STAGES` — parity-locked by test).

## 3. Screen patterns

### 3.1 Deal overview (`/deals/{id}`)

StageFrame (ADR-0086) + single guidance panel: current stage, the ONE primary
next action (ADR-0119), completion checklist from `evaluateProcess` blockers +
requiredArtifacts, gate status chips (read-only), paused-pipeline chip
(ADR-0102 deep link). No data tables on the overview.

### 3.2 Stage tab (`/deals/{id}/s{n}`)

StageFrame + Tabs (ADR-0121) splitting today's stacked sections. Reference:

| Stage | Tabs (within the page) | Primary action |
|---|---|---|
| S4 advisory · scoring · decision · gates | save decision
| S5 capability gaps · entry strategy · BC lines | save assessment
| S6/S7 universe · long list · screening | per-row shortlist
| S8 cases · simulations · adoption | adopt case
| S9 checklist · findings · waivers | save checklist
| S10 structure hypothesis · financing | confirm hypothesis
| S11 IC package · establishment · gates | record gate (entity_ic → group_ic)
| S12 scorecard · transition ledger | record transition decision

PromotionPanel renders at the bottom of S5/S7 tabs and the overview when the
track-final stage completes.

### 3.3 Reference pages

Keep current URLs; adopt the new primitives (DataTable, PageState, Tabs) and
content-max. `/market` splits industry list (left) from the analysis report
tabs (right) instead of stacking 16 tables.

## 4. Visual hierarchy (ADR-0119)

- One `btn-primary` per screen/section = the stage's purpose action.
- `control-chip` for filters/sorts/scores; `status-chip` read-only.
- Content max width enforced; tables scroll horizontally inside
  `.table-scroll`.

## 5. Feedback (ADR-0121)

PageState for loading/empty/error; toast confirmation for every human-recorded
decision (gate, adoption, promotion, charter confirm, transition decision) in
addition to inline state change.

## 6. Migration & compatibility

Phase 3 lands primitives + cleanup (dead components, legacy CSS blocks).
Phase 4 lands `/deals` skeleton + sidebar re-plane + navigation-test update +
`pauseLinkFor` remap; legacy pages become thin wrappers. Phase 5/6 migrate the
core journey pages, then project pages, then flip legacy routes to redirects
and sweep residual violations. Old URLs are never broken ahead of their
replacement.

## 7. Verification per phase

`bun run test:unit` (navigation parity, process-flow, pipeline boundary),
both design lints (new rules: single btn-primary per section, no status-chip
buttons, no raw loading text nodes), `contrast:check` (btn-primary and
control-chip pairs in both themes), web-next build.
