---
lang: en
date: 2026-11-21
status: implemented (defect remediation ruled 2026-11-23, awaiting implementation — see § Defect Remediation — 2026-11-23)
owner: ux-designer-agent (design), pm (dispatch)
amendments: Defect Remediation 2026-11-23 (user-reported: bare `/projects/{id}/business-case` opens the `재무적 타당성` lens instead of `개요`; ruled at Design Gate Row 0 — absent `?tab=` must land on `개요`; see § Defect Remediation — 2026-11-23)
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

## Defect Remediation — 2026-11-23: bare `/business-case` lands on the wrong tab

**Status**: user-reported 2026-11-23 (`/projects/01M7YG6YG16FTJRCYZMD4Z6AGY/business-case`
opens the `재무적 타당성` tab), ruled at Design Gate Row 0 the same day. The defect
is pre-existing — `resolveS8Tab` predates this spec — but the `개요` tab this
spec added is what makes the current landing unambiguously wrong: S8 now HAS a
declared first tab, and a bare entry into the stage skips it.

**Current behavior (observed)**. Navigating to `/projects/{id}/business-case`
with no `?tab=` renders the `재무적 타당성` lens (its `설명·생성·권고` sub-tab)
with `재무적 타당성` highlighted — not `개요`.

- **Anchor — the page**: `app/web-next/app/projects/[id]/business-case/page.tsx:11-26`
  wraps `BusinessCaseStage` in page mode (URL `?tab=` sync, per its header
  comment). In `components/stages/BusinessCaseStage.tsx:245-251`,
  `tabParam = searchParams.get("tab")` is **null** on the bare URL and
  `tab = resolveS8Tab(tabParam, { greenfield })` resolves it.
- **Anchor — the resolution**: `app/web-next/lib/business-goals-view.ts:85-93`
  — `resolveS8Tab(null)` takes `raw = ""`, which is not in `S8_TAB_KEYS`
  (`:30`), so it falls to the catch-all `"overview"`. That key is the
  **financial-lens sub-tab** `설명·생성·권고` (`S8_FINANCIAL_SUBTABS`, `:37`;
  `lib/stage-tabs.ts:101`) — not the `개요` tab this spec added
  (`lib/stage-tabs.ts:82`, seg `""`). `primaryKeyOfS8Tab("overview")`
  (`business-goals-view.ts:73-77`) maps it to `financial`, so the primary
  highlight is `재무적 타당성` (whose seg-fallback `isDefault: true`,
  `lib/stage-tabs.ts:91`, agrees with the same wrong answer).
- **Anchor — the main entry**: the deals landing builds S8 card hrefs via
  `projectStageHref` (`app/web-next/app/deals/page.tsx:559-562`) — the first
  tab with `seg !== ""`, appending **only the seg**, so every S8 deal-card
  click opens bare `/projects/{id}/business-case` with no `?tab=` and hits
  this. The `/deals/{id}/s8` tab forwards the incoming query verbatim
  (`app/deals/[id]/[stage]/page.tsx:356`), so an s8 URL without a tab lands
  here too — as do bookmarks and typed URLs.

**Intended behavior (ruling)**. The absent-`?tab=` default of the S8 stage is
`개요` — the stage's first tab and the promotion landing
(`components/PromotionPanel.tsx:188`, `router.push(/projects/{id})`). Bare
`/projects/{id}/business-case` **redirects to `/projects/{id}`** (the `개요`
tab's canonical URL, already `isDefault`-highlighted per this spec's tab
definition, `lib/stage-tabs.ts:82`). Because `개요` is its own page (seg `""`,
this spec's Decision), a redirect is the only mechanism that honors the rule —
the `business-case` body cannot render another seg's page. Mechanism precedent
in the same stage: mount-time URL normalization via `router.replace`
(`BusinessCaseStage.tsx:263-265` for `?tab=targets` on greenfield; `:258-261`
for the legacy `wacc`/`financial-analysis` deep links) — implemented at the
page-mode wrapper, which owns URL sync.

Edges, stated so the implementer cannot guess wrong:

1. **`?tab=overview` on `/business-case` is NOT the absent case.** It keeps
   resolving to the financial-lens sub-tab `설명·생성·권고` (the alias
   `financial → overview`, `business-goals-view.ts:40-43`; pinned by this
   doc's Decision section "Untouched by design" paragraph and its unit
   tests). Only the ABSENT param changes meaning. The redirect must key on
   `searchParams.get("tab") == null`, not on the resolved value.
2. **Deep links keep working**: every explicit `?tab=` (goals, technical,
   financial, scenarios, targets, params, target-costing, decision, aliases)
   renders unchanged. The financial entry's `isDefault` (`stage-tabs.ts:91`)
   stays — it still correctly highlights `재무적 타당성` for an unknown `?tab=`
   value; the redirect simply removes the bare-URL case from its input.
3. **Embedded mode is out of scope**: `/deals/[id]/s8` with an explicit
   `?tab=` keeps it (the forward preserves the query); the embedded tab's
   internal default (`useState("overview")`, `BusinessCaseStage.tsx:245`) is
   internal state on a surface without this URL contract — unchanged by this
   ruling, noted here so its non-change is a decision, not an oversight.
4. **Consequence for the deals landing** (amends this doc's Decision bullet
   "Deals landing unchanged in behaviour"): the S8 deal card now lands on
   `개요` (bare `/business-case` redirects through to `/projects/{id}`). The
   Decision section's "the workspace starts at the first content tab" wording
   predates the `개요` tab; with `개요` declared as the first tab, S8 has ONE
   canonical entry and it is the same page the promotion flow lands on.

**Acceptance criteria**.

1. Bare `/projects/{id}/business-case` lands on `/projects/{id}` with `개요`
   highlighted (exactly one tab marked current) and no `재무적 타당성` content
   rendered.
2. `/projects/{id}/business-case?tab=goals` still opens `사업 목표`; every other
   explicit `?tab=` is byte-identical to today; `?tab=overview` still opens
   the financial lens `설명·생성·권고` (existing `tests/unit/stage-tabs.test.ts`
   and `tests/unit/s8-goals-ui.test.ts` keep passing).
3. `/deals/{id}/s8` without a tab lands on the project `개요`; with `?tab=X`
   it still lands on X.
4. Greenfield: the `개요` tab remains present and the `?tab=targets` redirect
   path is unaffected (ADR-0159/ADR-0161 behavior preserved).

Spec registry entry (`docs/specs/entries/2026-11-21-s8-overview-tab-design.json`)
carries no amendment/defect field in the registry schema — it stays untouched.
