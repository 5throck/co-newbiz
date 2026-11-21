---
lang: en
date: 2026-11-21
status: implemented
owner: ux-designer-agent (design), pm (dispatch)
related: docs/designs/2026-10-08-wave-u-ux-overhaul-design.md (§3.4 stage-tab map of record), docs/designs/2026-09-20-wave3-project-stage-tabs-design.md, docs/designs/2026-10-23-i18n-ui-adoption-design.md (§3.6 i18n-lint Korean baseline), ADR-0159, ADR-0161, ADR-0169
spec: s8-overview-tab
---

# Design — S8 gains `개요` as its first tab; `사업 목표` keeps business-case content only

## Problem

After promotion, the post-promotion landing (`PromotionPanel` → `/projects/{id}`)
presented the charter block under the wrong tab. `lib/stage-tabs.ts` had the S8
`사업 목표` tab carrying `extraSegs: [""]`, so the project overview page — whose
first block is the charter summary (heading `프로젝트 개요`, `추진계획 요약`,
`프로세스 현황` — `app/projects/[id]/page.tsx`) — highlighted `사업 목표`. The
owner reviewing a freshly promoted project saw the charter presented as "the
`사업 목표` tab", conflating the project overview with the business-case content
that the tab name promises (ADR-0159 wording).

Owner decision (2026-11-21, in chat): the overview page becomes its own first
tab (`개요`); `사업 목표` keeps only business-case content.

## Decision

All in `app/web-next/lib/stage-tabs.ts` (the single tab-map config, Wave U-1 §3.4),
plus its renderer and the deals landing:

- **First tab**: the S8 tab group gains a FIRST tab
  `{ seg: "", query: "overview", labelKey: "common.overview", isDefault: true }`.
  Deep links: `/projects/{id}?tab=overview` (exact `?tab=` match) and bare
  `/projects/{id}` (`isDefault`). `label` stays empty — the label resolves at
  render.
- **`사업 목표` decoupled**: drops `extraSegs: [""]`, so `/projects/{id}` no
  longer highlights it; the tab keeps only its business-case content
  (`?tab=goals`).
- **`labelKey` mechanism**: new optional `StageTabDef.labelKey` field — tabs may
  reference a translations-catalog key instead of a Hangul code literal;
  `components/StageTabs.tsx` `labelOf` renders `tr(t.labelKey)` when set, `t.label`
  otherwise. All a11y wiring (roles, aria-current, keyboard nav) unchanged.
- **Cap**: `MAX_PRIMARY_TABS` 5 → 6. The cap stays the guard against unbounded
  tab rows, not a target; every stage still declares its tabs in the map.
- **Deals landing unchanged in behaviour**: `app/deals/page.tsx`
  `projectStageHref` picks the first tab with `seg !== ""`, so opening a deal in
  S8 still lands on `/business-case` (the workspace starts at the first content
  tab; the overview seg is skipped). The `/deals/[id]/s8` redirect to
  `/projects/{pid}/business-case` preserving `?tab=` is unaffected.

Untouched by design: the financial-lens `?tab=overview` alias on
`/business-case` (seg `/business-case` + `tab=overview` still resolves to the
`재무적 타당성` financial tab via its aliases; the new tab only claims
seg `""`) — pinned by tests; greenfield track filtering (`ADR-0161`) drops
`?tab=targets` but keeps the new first tab; PMI guard passthrough
(`ADR-0161`/`ADR-0169` helpers) untouched.

## Consequences

- **i18n-lint Korean baseline constraint** (motivating `labelKey`): the Korean
  baseline from design 2026-10-23-i18n-ui-adoption §3.6 only shrinks — new tabs
  must not add Hangul code lines, so post-adoption tabs carry their text in
  `ko/en.json` under a catalog key and leave `label` empty (`common.overview` =
  `개요`/`Overview`). INTERIM-WORDING siblings (e.g. `사업 목표`, ADR-0159)
  keep their code literals until their own extraction batch.
- **Overview page belongs to S8** in the tab map (`groupForSegment("")`), as it
  already did via the old `extraSegs` route; promotion lands on a highlighted
  tab that matches what the page shows.
- **Wiki page 30 (`공통 S8`) staleness noted for a docs pass** — not part of this
  change; the tab list there predates the first tab.

## Verification

Implemented and verified in the same pass (owner decision in chat 2026-11-21):

- Targeted unit tests pass: `tests/unit/stage-tabs.test.ts` (owner-decision case:
  tabs[0] matches `{ seg: "", query: "overview", labelKey: "common.overview" }`,
  deep-link and bare-path highlighting, `MAX_PRIMARY_TABS = 6`) and
  `tests/unit/s8-goals-ui.test.ts` (tab order overview → goals → technical →
  financial → targets → decision; financial sub-tab row intact).
- `tsc` exit 0; design-lint clean; i18n parity green; spec-check exit 0.
