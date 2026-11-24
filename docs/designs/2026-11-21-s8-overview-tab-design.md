---
lang: en
date: 2026-11-21
status: implemented (defect remediation 2 ruled 2026-11-24, awaiting implementation — see § Defect Remediation 2 — 2026-11-24; remediation 1 of 2026-11-23 implemented)
owner: ux-designer-agent (design), pm (dispatch)
amendments: Defect Remediation 2026-11-23 (user-reported: bare `/projects/{id}/business-case` opens the `재무적 타당성` lens instead of `개요`; ruled at Design Gate Row 0 — absent `?tab=` must land on `개요`; see § Defect Remediation — 2026-11-23; Defect Remediation 2 2026-11-24 (user-reported: selecting S8 first paints `재무적 타당성`, then moves to `개요` — the 2026-11-23 redirect runs after first render and every S8 entry link still targets the bare route; ruled at Design Gate Row 0, DEC-20261124-01 — entry links target `/projects/{id}` directly and the bare-route fallback must redirect before the stage body paints; see § Defect Remediation 2 — 2026-11-24)
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

## Defect Remediation 2 — 2026-11-24: render-then-redirect flash

**Status**: user-reported 2026-11-24 (selecting S8 `사업성 분석` first shows the
`재무적 타당성` tab, then moves to `개요`), ruled at Design Gate Row 0 the same
day (decision record: `docs/decisions/DEC-20261124-01.md`). This is a defect in
the 2026-11-23 remediation above, not in the tab map: that remediation ruled the
right OUTCOME (absent `?tab=` lands on `개요`) but its mechanism and its entry
points leave the wrong tab visible for one paint.

**Persona and job**. Deal analyst or IC reviewer opening the S8 stage from the
stage rail, the project list, or a deal card. The job is to land on the stage's
first tab, `개요` (charter summary and process status), and read from there. A
transient flash of a different tab's content (`재무적 타당성` figures and the
`설명·생성·권고` sub-tab) reads as a wrong landing and, for a reviewer scanning
financials, as a stale or unrelated view.

**Current behavior (observed)**. Clicking S8 in the stage rail renders
`재무적 타당성` for one paint, then the URL is replaced with `/projects/{id}` and
`개요` appears.

- **Anchor — the redirect mechanism**: the 2026-11-23 fix is a client-side
  `useEffect` in `app/web-next/components/stages/BusinessCaseStage.tsx`
  (around lines 268-278) calling `s8BareTabRedirect` from
  `app/web-next/lib/business-goals-view.ts`. An effect runs after the first
  commit, so the stage body has already rendered when the replace is issued.
- **Anchor — what paints in that window**: `resolveS8Tab(null)` returns
  `"overview"`, the financial sub-tab key (`설명·생성·권고`) under the
  `재무적 타당성` primary tab (`lib/stage-tabs.ts`, the `financial` tab's aliases
  include `overview`). The flash is therefore specifically `재무적 타당성`.
- **Anchor — the entry links still target the bare route** (so every normal click
  exercises the flash; the redirect was meant as a fallback, not the main path):
  - `app/web-next/components/StageFrame.tsx:39` `STAGE_HREF.S8` →
    `/projects/${p}/business-case` (stage rail).
  - `app/web-next/app/projects/page.tsx:141` project-list shortcut button.
  - `app/web-next/app/deals/[id]/[stage]/page.tsx:331`
    `PROJECT_STAGE_PATH.S8 = "business-case"`: `ProjectStageTab` does
    `router.replace` to `/projects/{pid}/business-case` plus the query, so a
    `/deals/{id}/s8` entry makes three hops (deal-stage route → bare
    business-case → `/projects/{pid}`), with the stage body painting in the
    middle hop.

**Intended behavior (ruling)**. Two rules, one per failure source. The first
removes the flash for every in-app entry; the second makes the bare URL safe for
entries the app does not control.

1. **Entry links target the canonical `개요` URL directly.** Every S8 entry link
   that carries no explicit tab targets `/projects/{id}`:
   - Stage rail (`StageFrame.tsx` S8 href), project-list shortcut
     (`projects/page.tsx`), and the deal-stage S8 entry all resolve to
     `/projects/{id}`.
   - `ProjectStageTab` (`app/deals/[id]/[stage]/page.tsx`): S8 with an EMPTY
     query goes to `/projects/{pid}` (one hop, no intermediate route). S8 WITH a
     query keeps `/projects/{pid}/business-case?{query}` (an explicit tab is a
     deliberate deep link and must reach the business-case route unchanged).
   - No other S8 entry may link to the bare `/business-case` route. The tab map
     is not touched: `개요` stays seg `""` and `사업 목표`, `재무적 타당성` and the
     rest keep their `/business-case` segs.
2. **Bare-route fallback never paints the stage body.** A bookmark, a typed URL,
   or a stale link to `/projects/{id}/business-case` with no `?tab=` must be
   redirected to `/projects/{id}` BEFORE the stage renders. The acceptance
   criterion is the outcome: for a bare URL the `BusinessCaseStage` body is never
   committed to the DOM, so there is no frame in which `재무적 타당성` content,
   its sub-tab row, or any highlighted tab is visible. The mechanism is the
   implementer's choice, provided the outcome holds. Permitted mechanisms:
   - a server-side redirect, such as the `business-case/page.tsx` server
     component reading `searchParams` and calling `redirect()`, or a
     `next.config` redirect with a `missing` query condition on `tab`; or
   - a client wrapper that renders nothing (no stage body, no tab chrome) while
     the replace is pending and renders the stage only when a `?tab=` is present.
   A solution that renders the stage and then redirects in an effect is the
   defect, whatever it is named. The redirect keys on the ABSENT `tab` param, the
   same key as the 2026-11-23 edge 1 (not on the resolved value).
3. **Everything with an explicit tab resolves exactly as before.** `?tab=goals`,
   `?tab=technical`, `?tab=financial`, every alias, and `?tab=overview` (which
   still opens the financial lens `설명·생성·권고`, per 2026-11-23 edge 1) are
   byte-identical to today. Embedded mode (`/deals/{id}/s8`, `urlSync=false`) is
   unchanged, including its internal default (2026-11-23 edge 3). The greenfield
   `?tab=targets` normalization is unchanged.

Rule 1 is the primary fix; rule 2 stays because bookmarks and typed URLs exist
and the 2026-11-23 ruling (bare route redirects to `개요`) remains correct. The
2026-11-23 acceptance criteria 1-4 continue to hold, tightened by rule 2 from
"lands on `개요`" to "lands on `개요` with no intermediate paint".

**CRUD and linkage coverage**. No surface is added or removed; this ruling only
changes link targets and the bare-route fallback timing. Stage-to-stage linkage
is unchanged except that S8 now has one canonical entry URL (`/projects/{id}`)
shared by the rail, the list, the deal card, and the promotion landing.

**Single primary action and accessibility**. Unchanged by this ruling. The one
accessibility-relevant property is that no frame exposes a wrong
`aria-current` tab: before this fix, assistive technology could announce
`재무적 타당성` as current for one frame before `개요`.

**Acceptance criteria**.

1. Clicking S8 in the stage rail shows `개요` highlighted (exactly one tab
   current), with no intermediate `재무적 타당성` paint. Same for the
   project-list shortcut and the `/deals/{id}/s8` entry with an empty query.
2. Bare `/projects/{id}/business-case` (bookmark or typed URL) ends on
   `/projects/{id}` and never commits the stage body.
3. `/projects/{id}/business-case?tab=X` and `/deals/{id}/s8?tab=X` still open X;
   `?tab=overview` still opens the financial lens `설명·생성·권고`.
4. Embedded `/deals/{id}/s8` usage and the greenfield `?tab=targets` redirect
   behave as before.

**Verification (measurable)**.

- **Unit test (new)**: assert the S8 entry hrefs equal `/projects/{id}` for
  StageFrame S8, the project-list S8 shortcut, and the deal-stage S8 path with an
  empty query (`ProjectStageTab` target `/projects/{pid}`); and that S8 with a
  non-empty query yields `/projects/{pid}/business-case?{query}`. Where an href
  is built inline in JSX, the implementer may extract a tiny pure helper so the
  assertion has a seam; that is an implementation detail, not a design change.
- **Unit test (existing, must keep passing)**: `tests/unit/s8-goals-ui.test.ts`
  coverage of `s8BareTabRedirect` (with `tests/unit/stage-tabs.test.ts` and the
  rest of the S8 suite).
- **Browser check**: clicking S8 in the stage rail on a real project shows
  `개요` with no intermediate `재무적 타당성` paint (verified by observing the
  first painted frame or by asserting the stage body is absent from the DOM
  throughout the navigation); a typed bare `/projects/{id}/business-case` URL
  behaves the same.
- **Success criterion**: across rail, list, and deal-card entries plus the
  bare-URL fallback, the count of frames in which a non-`개요` S8 tab is visible
  before landing is zero.

**Handoff to `frontend-engineer`**. Real contracts consumed: the tab map in
`lib/stage-tabs.ts`, `s8BareTabRedirect` and `resolveS8Tab` in
`lib/business-goals-view.ts`, and the existing `/projects/{id}` overview page.
No new API, token, component, or pattern is introduced, so nothing escalates to
`design-system-agent`. Reasoning for the choice of rule 1 over a redirect-only
fix: a faster redirect still leaves a hop and a race with hydration, whereas a
correct link has no intermediate state at all; the redirect is retained only as
the fallback for URLs the app does not generate.

### Addendum — sub-tab key rename (2026-11-24, user decision)

The financial sub-tab `설명·생성·권고` used the key `overview`, the same word as the
`개요` tab (seg `""`, `?tab=overview` on the project page), which is how the 2026-11-24
flash was easy to misread. Decision: rename the sub-tab key `overview` to `financial-model`.

- **Code**: `S8_TAB_KEYS`, `S8_FINANCIAL_SUBTABS`, the `financial` alias and every
  `resolveS8Tab` fallback (unknown value, `financial`, greenfield `targets`) now resolve to
  `financial-model`. In `lib/stage-tabs.ts` the sub-tab query and the `재무적 타당성`
  primary-tab alias use `financial-model`; the `개요` tab (seg `""`, query `overview`) is
  unchanged. `BusinessCaseStage` panel and tab ids follow (`s8fin-tab-financial-model`,
  `s8fin-panel-financial-model`); embedded mode defaults to `financial-model`, and the
  greenfield `targets` normalization now lands on `?tab=financial-model`.
- **Legacy URL**: `/projects/{id}/business-case?tab=overview` no longer names a business-case
  tab. In page mode it redirects to `/projects/{id}` (the `개요` page) before the stage
  renders: `s8BareTabRedirect` returns the project URL for an absent `tab` or `tab=overview`,
  and the page wrapper renders nothing for both. This supersedes the 2026-11-23/2026-11-24
  rulings that kept `?tab=overview` opening the financial lens (acceptance criterion 3 now
  reads: every other explicit `?tab=` is unchanged; `?tab=financial` and
  `?tab=financial-model` open the financial lens).
- **Verification**: `tests/unit/s8-goals-ui.test.ts`, `stage-tabs.test.ts`,
  `technical-lens.test.ts` and `s8-entry-href.test.ts` cover the new key, the legacy
  redirect, and the unchanged `개요` tab.
