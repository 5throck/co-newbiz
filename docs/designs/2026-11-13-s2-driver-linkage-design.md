# S2 Driver Linkage — S1 Calibration Drivers as Linked Signals in Opportunity Discovery

- Spec ID: `2026-11-13-s2-driver-linkage`
- Date: 2026-11-13
- Status: implemented (spec registered at landing — registry id 2026-11-13-s2-driver-linkage-design, source manual, status implemented, see docs/specs/registry.json)
- Registration note: **spec-register is deliberately NOT run by this task** — registry
  contention with in-flight batches; PM registers this spec at landing time (dispatch
  instruction 2026-11-13).
- Related: design `2026-09-18-s1-growth-gap-calibration` (whose API note — "insights
  route exposes calibration so S2 keeps the linkage" — this design completes), ADR-0129
  (curated proxy_link demand edges — the S2→S1 half of the loop), design
  `2026-11-06-s1-quantitative-web-grounding` (C-grade/RAG-cap provenance framing),
  ADR-0187 D1 (data-confidence grades), ADR-0012 family (append-only audit),
  ADR-0127 (S2 list-light/detail-heavy layout), DEC-20261113-05.

## Conclusion

S1's human-accepted calibration drivers become **visible** in S2 opportunity discovery
and **attachable** to an opportunity by an analyst — as captured-provenance evidence
records, never as automatic opportunities and never as score inputs. The existing
insights endpoint gains one additive field (`calibration.accepted_drivers` with row
IDs) so the already-consumed payload carries everything; a new additive JSON payload
column on `opportunity` (`driver_links_json`, migration at implementation time) holds
the analyst's link records; a new analyst-only audited route (`PUT/DELETE/GET
/api/opportunities/[id]/driver-links`) is the human promotion path. Every rendered
driver-derived record carries an explicit C-grade / LLM-estimated label — human
acceptance does not upgrade the evidence class (data confidence caps the RAG grade).

## Facts base (all file:line verified on the working tree, 2026-11-13)

### KNOWN

- `GET /api/market-overview/insights`
  (`app/web-next/app/api/market-overview/insights/route.ts`) returns per-industry
  `calibration` `{triggered, our_cagr_pct, external_cagr_pct, gap_pct,
  previous_gap_pct, applied_drivers}` (`route.ts:109-118`) plus
  `opportunity_factors`/`risk_factors`/`chain_direction` (`:106-108`). `applied_drivers`
  is a `string[]` of driver NAMES from the version payload — no row IDs.
- Zero S2 code consumes the calibration field (grep 2026-11-13: no
  calibration/applied_drivers references in `lib/entry-market*.ts`,
  `lib/opportunity*.ts`, `components/EntryMarketFlow.tsx`,
  `components/EntryMarketDerivationPanel.tsx`).
- `OpportunityFunnelStage.tsx` already calls the insights endpoint
  (`:239`) but its local `SizingInsight` type (`:64-83`) omits `calibration` and
  `chain_direction` — the payload arrives and is dropped on the floor.
- The per-industry calibration GET
  (`app/api/market-overview/industry/[industryId]/calibration/route.ts`) returns full
  accepted rows (with row IDs) via `acceptedCalibrationDrivers`
  (`lib/market-calibration.ts:191-203`).
- `CalibrationDriverRow` = `{id, industry_id, version_id, driver, direction
  ('upside'|'downside'), impact_pct, rationale, status('proposed'|'accepted'|'dismissed'),
  proposed_by, decided_by, decided_at, created_at}` (`market-calibration.ts:58-71`).
  Accepted rows are never hard-deleted: `decideCalibrationDriver` only UPDATEs status
  (`:322-328`), and the proposal-cycle DELETE touches only `status='proposed'` rows
  (`:221-224`) — so a stored `driver_row_id` stays resolvable.
- The opportunity carrier: `opportunity.factors_json/factors_source/factors_at`
  (migration 0051) hold factors as **bare strings** with no per-item provenance slot
  (`lib/opportunity-factors.ts:13-24`); `entry_market_derivation_json` (migration 0150)
  is the house pattern for a lineage payload document on the opportunity — strict
  whitelist on write (`lib/entry-market.ts:70-105`), strict/tolerant parse pair
  (`:110-154`).
- `opportunity.industry_id` FK exists (migration 0126, exact-match derived with
  explicit-write precedence) — the S1 link the funnel already curates
  (`OpportunityFunnelStage.tsx:246-254`).
- Grade conventions: `data_confidence_grade A|B|C|U` (ADR-0187 D1); the linked-S1
  summary renders as `v{N} · confidence {G}` (Korean copy, translated) (`s1Line`, `lib/entry-market-flow-state.ts:195-197`);
  C-grade cap framing from the web-grounding design R8 ("web snippet = B- at best,
  never A"); chain-reliability mapping A→Green, B→Amber, C→Red
  (rag-scoring-framework).
- proxy_link demand edges are **human-registered** (chain-links POST requires
  `write`; `source` defaults `user_added`, `approved` only for human-approved LLM
  proposals; ADR-0129 boundary #2 reconfirmed) — there is no automatic
  driver→industry mapping mechanism.
- House test patterns: route-level tests through `tests/unit/helpers/
  next-route-dispatch.ts` + scratch SQLite (`tests/unit/entry-market-flow-route-additive.test.ts`);
  insights route suite exists (`tests/unit/market-overview-insights.test.ts`);
  pure-view render tests under `NextIntlClientProvider` via `renderToStaticMarkup`
  (`tests/unit/market-growth-banner-render.test.ts`).

### INFERRED

- Extending the insights payload (additive) beats a new aggregated endpoint: the
  funnel fetches it already; a second fetch per industry (N×1 calibration GETs)
  is strictly worse; smallest change wins (dispatch guidance D-A).
- The attach action belongs on the **opportunity detail screen**, not the funnel
  row: ADR-0127 keeps list rows light and moves evaluation work to
  `/opportunities/{id}`; the factors tab is the evidence surface where
  opportunity/risk factors are curated, so a linked-driver evidence block is a
  peer there.
- Attach must require `opportunity.industry_id == driver.industry_id`: drivers are
  per-industry signals; allowing cross-industry attach would break the purpose
  link (the driver explains THAT industry's sizing gap) and re-introduce the
  asymmetry the user requirement #4 guards against.

### ASSUMED

- Accepted driver rows remain resolvable for the life of a link (KNOWN today by
  code; assumed forward as a design constraint — a future hard-delete path for
  driver rows would need a tombstone story before links can trust `row_status`).
- One opportunity links a handful of drivers (cap 10) — ample for v1; no
  pagination needed.

### UNKNOWN

- Whether analysts later want a "register opportunity from driver" affordance
  (creation is deliberately out of v1 — see Boundaries).
- Whether a link-staleness banner (driver dismissed after attach) is wanted at
  v1; the GET exposes `row_status` so it can be added without schema change
  (deferred — record as future work).

## Requirements (ASD-STE100)

- R1: An analyst sees the accepted S1 calibration drivers of a selected industry
  in the S2 funnel's industry-insight panel, with direction, estimated impact
  (±%p), rationale, and an explicit LLM-estimated/C-grade label on every row.
- R2: An analyst attaches an accepted driver of the opportunity's own linked
  industry to that opportunity. The attachment captures the driver's provenance
  (row ID, text, direction, impact, rationale, decided_by/at, origin version) at
  attach time.
- R3: The attachment never changes attractiveness_score, synergy_score, status,
  factors_json, or any gate/verdict value. Nothing is auto-generated.
- R4: Every driver-derived evidence record renders its C-grade/LLM-estimated
  label. The server stamps the grade; a client cannot claim a higher grade.
- R5: All writes are analyst+ (viewer denied), audited once per action, and
  unauthenticated requests are 401; unknown opportunity is 404 (404-not-403).

## Design

### D-A — Exposure surface (insights extension, no new API)

`GET /api/market-overview/insights` gains one additive field inside the existing
per-industry `calibration` object:

```json
"calibration": {
  "...existing fields unchanged...": null,
  "accepted_drivers": [
    { "id": "idc-…", "driver": "…", "direction": "upside", "impact_pct": 1.8,
      "rationale": "…", "decided_by": "…", "decided_at": "…", "version_no": 3 }
  ]
}
```

- Populated by `acceptedCalibrationDrivers(db, industry_id)` — the same resolver
  the calibration GET uses, so the names-level `applied_drivers` (payload
  snapshot at run time) and the live accepted set can in principle differ; both
  stay, each honestly labelled by its existing meaning. Industries with
  `calibration: null` stay `null` (no shape change); the array is `[]` when the
  payload has calibration but no accepted rows.
- Consumers: the funnel's local `SizingInsight` type gains the field; the
  selected-industry insight panel renders a third block "S1-verified growth
  drivers" (Korean copy, translated)
  beside the existing opportunity/risk factor blocks (details fold — list rows
  stay light per ADR-0127). Read-only there; the attach action lives on the
  detail screen (D-B). Rows with zero accepted drivers render nothing (no empty
  section — "don't show facts that don't exist").

### D-B — Promotion mechanism (analyst attaches; captured provenance)

Storage — one additive nullable column on `opportunity` following the
`entry_market_derivation_json` pattern (migration 0150 house style):

```sql
ALTER TABLE opportunity ADD COLUMN driver_links_json TEXT
  CHECK (driver_links_json IS NULL OR json_valid(driver_links_json) = 1);
```

> Schema-governance note: an additive column requires an ADR before merge
> (constitution baseline). Implementation dispatch includes that ADR (or a
> slice amendment to DEC-20261113-05's successor) — this design decides the
> carrier; the migration + ADR land together in the implementation PR.

Payload document (evidence-ledger discipline adapted to the row-per-link form):
capture at attach, reference by row ID, never rewrite history in place — removal
deletes the link record from the payload and the action is audited (content edit,
not audit-log deletion; the audit_log row persists).

```json
{
  "links": [
    {
      "driver_row_id": "idc-…",
      "industry_id": "…", "industry_name": "…",
      "driver": "…", "direction": "upside|downside", "impact_pct": 1.8,
      "rationale": "…", "decided_by": "…", "decided_at": "…", "version_no": 3,
      "confidence": "C",
      "attached_by": "…", "attached_at": "…",
      "note": "optional analyst note (why relevant to THIS opportunity)"
    }
  ],
  "set_by": "…", "set_at": "…"
}
```

Why capture-at-attach instead of a bare row-ID list: the driver row can change
status later (re-analysis proposals replace pending rows; a person may dismiss an
accepted driver's successor). The link is a record of what the analyst SAW and
accepted as relevant; the retained `driver_row_id` keeps the live join available
for freshness surfacing without a second write.

Write path — new route `app/web-next/app/api/opportunities/[id]/driver-links/route.ts`:

- `PUT` body `{ driver_row_id, note? }` → analyst+ (`requireBusinessActor(auth.auth,
  "write", …)`, viewer 403 with role message), audit
  `opportunity.driver_links.update` once. Server-side resolution: the
  `driver_row_id` must resolve to a row with `status='accepted'` in
  `industry_driver_calibration`; that row's `industry_id` must equal
  `opportunity.industry_id` (mismatch → 400 with reason, mirroring the strict
  validation convention of `normalizeEntryMarketDerivationInput` — a 400 with a
  reason, never a silent drop). Duplicate `driver_row_id` on the same opportunity
  → 409 `already_linked`. Cap 10 links → 400. `confidence` is server-stamped
  `"C"` always — a client-supplied confidence key is rejected (strict key
  whitelist).
- `DELETE` body `{ driver_row_id }` → removes the link, audit
  `opportunity.driver_links.update` with target `{id}:remove:{driver_row_id}`
  (same convention as the factors route's `…:remove:…` targets). Removing a
  non-existent link → 404.
- `GET` → `{ links, row_status }` where `row_status[driver_row_id]` is
  `accepted | changed | missing` computed from the live table (changed = row no
  longer accepted; missing = row absent). Parse is tolerant on read (invalid
  JSON → links `[]`, never a throw) and strict on write — the house
  strict/tolerant pair.
- Membership/access: reads go through the same repository-layer rules as the
  sibling opportunity routes (FR-SEC-03); the route adds no bypass path.

Pure logic lives in a new `app/web-next/lib/opportunity-driver-links.ts`
(record type, `normalizeDriverLinkInput`, `parseDriverLinksJson`, cap + dedupe
checks) — mirroring `entry-market.ts` so both the route and tests consume one
contract.

UI — new pure view `app/web-next/components/DriverLinksPanel.tsx`, mounted in the
opportunity detail factors tab (`app/opportunities/[id]/page.tsx`):

- Lists linked drivers: direction glyph + text (upside/downside — Korean copy,
  translated; text always present, status never conveyed by color alone),
  `±N%p` in mono-num, driver text,
  `S1 accepted · LLM estimated · confidence C` label (Korean copy, translated),
  decided date, optional note; expandable
  rationale (details/summary, keyboard operable).
- Attach control: a select of the linked industry's accepted drivers (from
  insights `accepted_drivers`; disabled with a reason line when
  `opportunity.industry_id` is unset — the EntryMarketFlow gating precedent:
  disabled with a reason, never silently hidden).
- Remove button per link (confirm via `useConfirm`, house destructive-action
  pattern).
- The funnel exposure block (D-A) links to the detail factors tab for the
  attach action (ADR-0127: row actions stay evaluation links, not editors).

### D-C — Driver→demand-industry suggestion: OUT for v1

The mapping from a driver like "logistics/delivery expansion" (Korean copy,
translated) to demand industries
(`proxy_link` upstream / upstream-of-upstream edges per ADR-0129 — Korean copy,
translated) is analyst judgment today: edges
are human-registered, no automatic matcher exists, and an LLM guesser would
either guess (violating no-fabrication) or need its own curation loop. v1
surfaces only the driver text/rationale; the analyst reads the chain screens
(S1 value-chain linkage — Korean copy, translated) themselves. Future work: an analyst-reviewed suggestion list
(suggest-only, human registers) — recorded here so it is not lost, not scheduled.

### D-D — Provenance rendering (reuse conventions)

- Grade line follows the house `confidence {G}` format (Korean copy, translated;
  `s1Line` precedent): each
  driver-derived record renders `confidence C` plus the origin label
  `S1 accepted · LLM estimated` (Korean copy, translated) — acceptance is
  recorded ("accepted"), estimation is
  recorded ("LLM estimated") (both Korean copy, translated), and the two are never conflated into "verified".
- Rendering reuses existing chip/card classes (`status-chip`, `sizing-grade-card`,
  `mono-num`) — no new tokens, no style prescriptions (design-lint safe).
- The RAG cap stays structural: a C-grade signal entering S2 evidence does not
  upgrade any grade anywhere; the cap is asserted in tests (R3/AC4), not just
  prose.

### D-E — Boundary statement (what this design deliberately does NOT do)

1. **No auto-generated opportunities.** No "create opportunity from driver"
   button, no LLM discovery seeded from drivers; the existing
   `/api/opportunities/discover` path is untouched.
2. **No score or verdict mutation.** Attachment never writes
   `attractiveness_score`, `synergy_score`, `status`, `factors_json`, gate
   recommendations, or any derived evaluation. Tests assert row equality
   before/after attach.
3. **No grade uplift.** Human acceptance of an LLM-estimated driver does not
   upgrade its evidence class (C stays C; data confidence caps the RAG grade —
   non-negotiable #4).
4. **No cross-deal or cross-industry driver reuse changes.** Drivers stay
   per-industry rows of `industry_driver_calibration`; links are per-opportunity
   captures scoped to the opportunity's linked industry; no global driver
   registry is introduced.
5. **No change to S1 calibration semantics.** The accept/dismiss flow, sweep
   injection, escalation history, and gate behavior are untouched — this design
   only reads the accepted set.
6. **No driver→demand-industry auto-mapping** (D-C, out for v1).

## Accessibility

Target WCAG 2.1 AA (baseline). Affected areas: keyboard operability of the
attach select, remove buttons, and expandable rationale rows (native
`details`/`summary` or buttons with visible focus); screen-reader names on the
attach select (`aria-label` naming the opportunity, house pattern of the S1-link
select at `OpportunityFunnelStage.tsx:794`) and remove buttons; direction
conveyed by text plus glyph (never color alone); C-grade label as text; no new
motion. Contrast: existing chip/card token classes only. Verification:
`renderToStaticMarkup` render test asserting label texts and names, plus the
manual checklist of the accessibility-audit skill at implementation review.

## Test plan (house patterns)

- New `tests/unit/opportunity-driver-links.test.ts` — route-level through
  `next-route-dispatch` + scratch SQLite (pattern:
  `entry-market-flow-route-additive.test.ts`):
  - PUT by viewer → 403 role message; unauthenticated → 401; unknown
    opportunity → 404 (not 403); unknown driver row → 404; dismissed/proposed
    row → 400; industry mismatch → 400; duplicate link → 409; cap-11th link →
    400; client-supplied `confidence` key → 400 (strict whitelist);
  - happy path: link stored with captured provenance, `confidence:"C"`,
    exactly one audit row;
  - no-mutation assertion: attractiveness_score, synergy_score, status,
    factors_json byte-identical before/after PUT (AC4 — lib-level row
    comparison in the same file);
  - DELETE removes only the targeted link, audit row written; removing absent
    link → 404;
  - GET tolerant parse: hand-corrupted `driver_links_json` → `links: []`, no
    throw; `row_status` mapping accepted/changed/missing.
- Extend `tests/unit/market-overview-insights.test.ts`: an industry with
  accepted rows returns them with row IDs inside `calibration.accepted_drivers`;
  an industry without calibration keeps `calibration: null`; payload-shape
  regression (existing assertions unchanged).
- New `tests/unit/driver-links-panel-render.test.ts` — pure-view render under
  `NextIntlClientProvider` via `renderToStaticMarkup` (pattern:
  `market-growth-banner-render.test.ts`): C-grade/LLM-estimated label text
  present on every rendered link; direction text present (not color-only);
  aria-labels on select and remove; empty industry link renders the disabled
  reason line.
- Source assertion (same render test file or the route test): no code path in
  `opportunity-driver-links.ts` writes `attractiveness_score` /
  `synergy_score` / `status` / `factors_json` (grep-style assertion, the
  GrowthBannerViews house source-assertion pattern).
- Gates at implementation: `bun run test:unit`, `typecheck:web`,
  `biome ci --changed`, `lint:i18n`, design-lint, migrate + integrity.

## Touched files (implementation-time; none changed by this design task)

- `app/web-next/app/api/market-overview/insights/route.ts` — additive
  `calibration.accepted_drivers` (D-A).
- `db/migrations/0NNN_opportunity_driver_links.sql` — NEW additive nullable
  column, 0150 pattern (@reversible) + the schema ADR note (D-B).
- `app/web-next/lib/opportunity-driver-links.ts` — NEW pure module (types,
  strict normalize, tolerant parse, cap/dedupe).
- `app/web-next/app/api/opportunities/[id]/driver-links/route.ts` — NEW
  GET/PUT/DELETE, analyst+, audited.
- `app/web-next/components/DriverLinksPanel.tsx` — NEW pure view (attach,
  list, remove, C-grade label).
- `app/web-next/app/opportunities/[id]/page.tsx` — factors tab mounts the
  panel (small edit).
- `app/web-next/components/stages/OpportunityFunnelStage.tsx` — `SizingInsight`
  type + insight-panel driver block (read-only exposure).
- `app/web-next/locales/en.json`, `app/web-next/locales/ko.json` — new keys
  (english key / korean value convention).
- `docs/architecture/openapi.yaml` — register the new route (drift gate).
- Tests: the three files named in the test plan.

## Out of scope / future work

- Driver→demand-industry suggestion list (D-C) — analyst-judgment mapping;
  suggest-only design if pursued later.
- Link-staleness banner on `row_status: changed|missing` (GET already exposes
  it; UI deferred).
- "Register opportunity from driver" affordance — even human-initiated
  creation-from-driver is not in v1; revisit only if analysts ask.
- Any consumption of driver links by scoring, gates, or downstream-stage
  prompts — deliberately none in v1; each future consumer re-enters the
  Design Gate.
