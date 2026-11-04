# Design: DART fsDiv Per-Year Fallback and Provenance Display (2026-11-04)

**Status**: Proposed (Row 0 — pending user gate approval)
**Scope**: `app/web-next/lib/dart-client.ts` `fetchFinancials`, its `DartFinancials` payload shape, the derived-analysis note path, the two financial-table render sites, locale files, and unit tests
**Gate ruling**: DEC-20261104-05 (Spec NEW — no DART spec exists in `docs/specs/registry.json`, grep-verified 2026-11-04)
**Origin**: PM defect investigation 2026-11-04 — (`주`)`수산아이앤티` (corp_code 00577016, stock 050960, KOSDAQ) showing financials only up to FY2023 despite FY2024/FY2025 `사업보고서` filings

## 1. Problem

`fetchFinancials` (`app/web-next/lib/dart-client.ts:477-538`, line numbers current
at `64e0dd7a`) documents itself as per-year fallback — the JSDoc at line 487
says "`연결`(CFS) `우선` — `연도별로 개별`(BFS) `폴백이 발생하면` fsDiv`로 표기` (P2-6)" —
but the implementation is a **window-level** fallback: the outer loop
`for (const fsDiv of ["CFS", "BFS"])` runs the whole year loop per statement
basis, and `anyFound` is set if *any* year returns data under CFS. Line 532
then `break`s before BFS is ever tried. Years where CFS answers status `013`
(no data) are silently skipped (`continue` at line ~503).

Live reproduction, verified by direct OpenDART calls on 2026-11-04:

| Year | CFS (reprt_code 11011) | OFS (reprt_code 11011) |
|---|---|---|
| 2023 | status 000, 144 items | 96 items |
| 2024 | status 013 (no data) | 144 items (`매출` 26,671,468,809 KRW) |
| 2025 | status 013 (no data) | 141 items (`매출` 30,711,816,841 KRW) |

The company filed `사업보고서` (2024.12) on 2025-03-21 and (2025.12) on
2026-03-23 — filings continue; from FY2024 it submits only `개별재무제표` (no
consolidated XBRL in its annual reports; the likely business reason —
subsidiary disposed/merged — is INFERRED, not verified, and is irrelevant to
the fix).

Net effects, all downstream of the one loop defect:

- **Missing years**: callers pass `years: 5` (`lib/dart-financial-facts.ts:121`
  → `fact_financial` persistence; `lib/company-profile-pipeline.ts:295`;
  `lib/synergy-pipeline.ts:253`), yet the UI shows data only up to FY2023.
- **Misleading coverage note**: `company-profile-pipeline.ts:299-303` derives
  `coverageNote` from `yearsFound` and would state "2023`년 사업보고서가 마지막`
  `제출입니다` — `이후 사업보고서 미제출`(013)" — factually wrong: filings exist,
  they are individual-only.
- **Invisible provenance**: `fsDiv`/`fsDivLabel` describe the *whole* fetch
  window. `company-financials.ts:125` pushes the note "`연결재무제표 미제출` —
  `개별`(BFS) `기준`" only when `dart.fsDiv === "BFS"`, i.e. only when CFS failed
  for *all* years; the partial-CFS case sets `fsDiv: "CFS"` and no note
  appears. No render site shows per-year provenance:
  `components/stages/synergy/types.ts:8` declares `fsDivLabel?: string` but
  nothing renders it (grep-verified), and the two table render sites
  (`components/stages/our-company/ProfileFinancialsTab.tsx:48`,
  `components/brownfield-target/TargetDataTabs.tsx:51`) print bare year
  column headers.

The user requirement is two-part: recover the missing years, and make each
year's data provenance (`연결`/`개별`) **visible on screen** so mixed-source years
are auditable.

## 2. Design

### 2.1 Per-year fallback algorithm (the core fix)

One pass over years; per year, CFS first, BFS only for that same year:

```
for each year y in [latest-0 … latest-(yearsToFetch-1)]:
    cfs = fetchBlock(y, "CFS")        // status + WANTED_ACCOUNTS-filtered items
    chosen = cfs.ok ? { fsDiv: "CFS", items: cfs.items } : null
    if (!chosen) {
        bfs = fetchBlock(y, "BFS")
        chosen = bfs.ok ? { fsDiv: "BFS", items: bfs.items } : null
    }
    if (!chosen) { lastError = …; continue }
    stamp chosen.items with fsDiv; push to yearly and items
```

Definitions and rules:

- **A block "yields"** when `status === "000"` AND the account filter
  (`WANTED_ACCOUNTS` + `thstrm_amount` present, first-wins dedup — unchanged
  from the current inner loop) leaves at least one item. A `000` response with
  zero wanted accounts is treated as a miss for fallback purposes; this is the
  edge the current code never handles because it never re-tries a year.
- **One statement basis per year, never mixed within a year.** A year chooses
  exactly one block; when both CFS and BFS yield for the same year (not
  observed in practice), CFS wins for that year and BFS is discarded. This
  makes same-account/same-year CFS+BFS mixing structurally impossible rather
  than guarded — there is no concat step to get wrong. Rationale: CFS and BFS
  values for the same account+year are different reporting scopes (`매출액`
  consolidated vs standalone); a series that splices them per account is
  incoherent for YoY trend derivation in `company-financials.ts`.
- **`lastError` discipline** changes: today every non-`000` overwrites
  `lastError` even mid-success, so a successful mixed fetch still carries a
  stale error-looking string. New rule: `lastError` is set only when a year
  ends with *no* data from either basis, and `out.error` is only assigned when
  `anyFound` is false (line 536's existing rule, unchanged).
- **API cost**: worst case doubles per-year calls (10 for `years: 5`) but only
  for companies where CFS misses — exactly the companies whose data is
  currently *wrong*. Pure-CFS companies see no change (5 calls). Against
  `DAILY_BUDGET = 15_000` (dart-client.ts:52, itself a 75% safety margin on
  OpenDART's 20,000/day) the delta is negligible.
- The integrity check (`checkSummation`, P2-5) runs per fetched block as
  today, keyed by year; no change.

### 2.2 Payload shape

`DartFinancials` (`dart-client.ts:15-33`) changes — all additions optional, so
the wire format is backward compatible:

```ts
export interface DartFinancials {
  // …existing fields…
  /** Aggregate statement basis over the fetched window (P2-6, per-year) */
  fsDiv?: "CFS" | "BFS" | "mixed";
  fsDivLabel?: string;
  items: Array<{
    name: string; value: number; unit: string; year?: string;
    /** Statement basis THIS item came from — the canonical per-year provenance */
    fsDiv?: "CFS" | "BFS";
  }>;
  yearly?: Array<{
    year: string;
    fsDiv?: "CFS" | "BFS";
    items: Array<{ name: string; value: number; unit: string }>;
  }>;
}
```

Decisions locked:

- **`items[].fsDiv` is the canonical per-year provenance.** It rides on the
  structure every UI consumer already iterates (`ProfileFinancialsTab` and
  `TargetDataTabs` build `byKey` maps from `items`; the profile pipeline
  derives `yearsFound` from `items`), so the UI needs no join against
  `yearly`. `year` is already on each item, so provenance+period travel
  together.
- **`yearly[].fsDiv` is stamped too, not derived.** `yearly` is what
  `dart-financial-facts.ts:130` iterates when persisting `fact_financial`, and
  keeping both stamped at the single write site (the per-year loop) avoids
  derivation drift; the aggregate is computed once at loop end from the
  per-year set.
- **Aggregate `fsDiv` widens to `"CFS" | "BFS" | "mixed"`**: all years one
  basis → that value; differing bases → `"mixed"`. `fsDivLabel` correspondingly
  "`연결재무제표`" / "`개별재무제표`" / "`연결·개별 혼합` (`연도별 기준 상이`)". The
  label is a persisted product string (profile JSON payloads embed it), so it
  stays set in the lib; the UI renders its own i18n strings from the enum
  (§2.5), not from this label.
- **Aggregation rule**: derived from the set of per-year bases; zero years
  found → `fsDiv` stays unset and `found: false` (existing behavior).

### 2.3 Provenance persistence — no DB schema change

`fact_financial` keeps its schema (company_id, period_id, account_id, value,
revision_no, source_id, created_at; unique on company+period+account+revision).
Provenance lives in the fetch-path payload only.

Rationale:

- Statement basis is a property of the *retrieval*, not of the financial fact:
  "`매출액` FY2025 = 30,711,816,841" is true regardless of which statement
  reported it. The fact store's job is canonical values with revisioning.
- Adding `fs_div` to the unique index would fork facts for the same
  period/account when provenance differs across syncs — corrupting the
  canonical-value model. Adding it as a plain attribute column costs a
  migration and null-handling in every consumer for zero current consumers:
  nothing queries "facts by statement basis" today.
- The auditable surface the user asked about is the profile payload
  (`profile.dartFinancials`), which `company-profile-pipeline.ts:557` already
  persists wholesale via `{ ...dart, available: dart.found }` — new fields
  ride along automatically on the next profile run.

Recorded trigger for reopening: if a future feature needs to query fact
provenance (e.g. audit trails per statement basis), that is a new design with
a migration — this one deliberately does not pre-provision it.

### 2.4 Derived-analysis note logic (`company-financials.ts`)

Line 125 (`if (dart.fsDiv === "BFS") out.notes.push("연결재무제표 미제출 — 개별(BFS) 기준")`)
keeps its semantics and gains the mixed case immediately after:

```ts
if (dart.fsDiv === "BFS") out.notes.push("연결재무제표 미제출 — 개별(BFS) 기준");
if (dart.fsDiv === "mixed") out.notes.push("연결·개별 재무제표가 혼합되어 있습니다 — 연도별 작성 기준이 다릅니다 (연도별 표기 참조)");
```

Old payloads without `fsDiv` produce no note, as today. The dedup comment at
`company-financials.ts:91` ("same account+year may appear from CFS/BFS
overlap") becomes dead-letter after §2.1 — one basis per year guarantees no
overlap — and its comment is updated to say so, so a future reader does not
hunt for a mixing path that no longer exists.

### 2.5 UI rendering and i18n

**Render sites.** Exactly two components render the yearly table+chart;
grep-verified there is no third (the synergy tab declares `fsDivLabel` in its
payload type but renders no dartFinancials table):

1. `components/stages/our-company/ProfileFinancialsTab.tsx`
2. `components/brownfield-target/TargetDataTabs.tsx`

**Pattern (identical in both)**: build `fsDivByYear` from `items` once, then
suffix the year wherever it is displayed as a label:

```ts
const fsDivByYear = new Map(
  items.filter((i) => i.year && i.fsDiv).map((i) => [i.year as string, i.fsDiv as "CFS" | "BFS"]),
);
const yearLabel = (y: string) => {
  const d = fsDivByYear.get(y);
  return d === "BFS" ? `${y} (${t("separate")})` : d === "CFS" ? `${y} (${t("consolidated")})` : y;
};
```

- **Table column headers**: `<th>{yearLabel(y)}</th>` — "2023 (`연결`)", "2024 (`개별`)".
- **Chart series names**: the ECharts legend uses `yearLabel(y)` too, so the
  chart and the table stay in agreement and the chart is readable without the
  table.
- **Mixed-source caption**: when the aggregate is `"mixed"` (available on
  `profile.dartFinancials.fsDiv` for new payloads), one visible caption line
  under the table via `t("mixedSourceNote")` — "`연결·개별 재무제표가 혼합되어`
  `있습니다` — `연도별 작성 기준이 다릅니다`." Not `sr-only`: the audit concern is a
  sighted-reader concern.
- **Graceful degradation**: legacy persisted payloads carry items without
  `fsDiv`; `yearLabel` falls back to the bare year. No migration, no "unknown
  basis" noise.
- **Accessibility**: provenance is text in the header/caption — never
  color-only. No new aria attributes required beyond the existing table
  captions.

**i18n additions** — three keys, in BOTH existing locale files
(`app/web-next/locales/ko.json`, `en.json`), under two namespaces (both
already exist; keys appended, no restructuring):

| Namespace | Key | ko | en |
|---|---|---|---|
| `components.ourCompany.profileFinancialsTab` | `consolidated` | `연결` | Consolidated |
| `components.ourCompany.profileFinancialsTab` | `separate` | `개별` | Separate |
| `components.ourCompany.profileFinancialsTab` | `mixedSourceNote` | `연결·개별 재무제표가 혼합되어 있습니다` — `연도별 작성 기준이 다릅니다`. | Consolidated and separate statements are mixed — the reporting basis differs by year. |
| `components.brownfieldTarget.dataTabs` | (same three keys) | (same ko values) | (same en values) |

### 2.6 Type-surface changes (Row 1 file map)

- `app/web-next/lib/dart-client.ts` — loop restructure (§2.1), `DartFinancials`
  widening (§2.2), JSDoc at line 487 rewritten to describe per-year fallback
  (the current text already promises this behavior; after the fix it will be
  true).
- `app/web-next/lib/company-financials.ts` — note logic + dead-letter comment
  (§2.4). Type-wise unchanged: `dart.fsDiv === "BFS"` comparisons survive the
  union widening.
- `app/web-next/components/stages/synergy/types.ts:8` — widen the inline
  `dartFinancials` type: item elements gain `fsDiv?: string`, and the object
  gains `fsDiv?: "CFS" | "BFS" | "mixed"` (today only `fsDivLabel` is
  declared, so a stored `"mixed"` payload would not typecheck against it).
- `app/web-next/lib/synergy-pipeline.ts:32-38` — the local `dartFinancials`
  type declaration mirrors the same widening. The construction at :520-526
  (`items: dart.items`) carries the new fields automatically on the
  fresh-fetch path. The two profile-reuse lambdas at :196-198 and :224-225 map
  items to `{ name, value, unit: "KRW" }`, dropping `year` (pre-existing
  quirk, see §3): they gain `fsDiv: i.fsDiv` so the reuse path carries
  provenance too; the year-drop itself stays untouched.
- `app/web-next/components/stages/our-company/ProfileFinancialsTab.tsx` and
  `app/web-next/components/brownfield-target/TargetDataTabs.tsx` — §2.5.
- `app/web-next/components/stages/our-company/types.ts:11` — the `Profile`
  type's inline `dartFinancials` gains the same optional fields (it currently
  declares neither `fsDiv` nor `yearly`).
- `app/web-next/locales/ko.json`, `en.json` — §2.5 table.

`dart-financial-facts.ts` and `company-profile-pipeline.ts` need **no code
change**: both consume `yearly`/`items` generically, and corrected years plus
provenance fields flow through. `company-profile-pipeline.ts`'s coverage note
(:299-303) self-corrects — for `수산아이앤티`, `yearsFound` extends to
2023/2024/2025 after the fix, so the wrong "`이후 사업보고서 미제출`" note stops
firing.

## 3. Non-goals

- **`fact_financial` schema change** — rejected with rationale and a recorded
  trigger condition (§2.3).
- **Synergy tab provenance rendering** — the synergy view shows strengths/
  weaknesses synthesis, not the yearly table; its payload type widening (§2.6)
  is for typecheck accuracy only.
- **The profile-reuse lambdas' year-drop** (`synergy-pipeline.ts:196-198`,
  `:224-225`) — a pre-existing latent quirk (stored-profile items lose `year`
  when reused by synergy); recorded here so a future cycle can close it
  deliberately rather than by surprise.
- **Business-reason verification** for `수산아이앤티`'s consolidated-statement
  absence (subsidiary disposal is INFERRED) — not needed for the fix.
- **Refetch/repair of already-persisted profiles** — profiles pick up the new
  fields on their next scheduled or user-triggered run; no backfill job.

## 4. Verification

All new `fetchFinancials` tests stub `globalThis.fetch` (routing on the URL's
`bsns_year`/`fs_div` params) and set `process.env.DART_API_KEY` in the test —
`dartFetch` calls the global `fetch` directly (dart-client.ts:90), so no new
injection seam is added. Stubs must return
`content-type: application/json` (dartFetch backs off HTML responses,
dart-client.ts:96). The module-level daily budget (15,000) is not reachable by
test volumes.

`tests/unit/dart-client.test.ts` (extends the existing pure-logic suite):

- **T1 — mixed window (the reproduction case)**: CFS 2023 → 000+items, CFS
  2024/2025 → 013; BFS 2024/2025 → 000+items, BFS 2023 → 013. Expect: items
  include 2024 and 2025, 2023 items tagged `fsDiv: "CFS"`, 2024/2025 items
  tagged `fsDiv: "BFS"`, aggregate `fsDiv === "mixed"`, mixed `fsDivLabel`.
  **Fails before the change** (items stop at 2023, `fsDiv === "CFS"`); passes
  after.
- **T2 — pure-CFS efficiency**: all years 000 under CFS. Expect aggregate
  `"CFS"` and zero fetches whose URL contains `fs_div=BFS`.
- **T3 — pure-BFS**: all years 013 under CFS, 000 under BFS. Expect `"BFS"` —
  pins the existing window-level behavior the fix must preserve.
- **T4 — no same-year mixing**: CFS 2024 → 000 but zero wanted accounts;
  BFS 2024 → 000+items. Expect 2024 items all `fsDiv: "BFS"` and exactly one
  entry per account+year in `items` (no CFS/BFS duplicates for 2024).
- **T5 — `000`-with-no-wanted-accounts is a miss**: covered by T4's CFS side;
  asserted via BFS being fetched for that year.

`tests/unit/dart-financial-facts.test.ts`:

- **T6 — mixed payload syncs all years**: the fake fetcher (existing
  `opts.fetcher` seam) returns `yearly` entries stamped `fsDiv` per year,
  CFS for one year and BFS for the rest. Expect facts inserted for every year
  (the corrected FY2024/FY2025 rows) and the existing suite green — payload
  widening is optional fields, so old fixtures pass unchanged.

Build/test gates: `bun test tests/unit/dart-client.test.ts
tests/unit/dart-financial-facts.test.ts` green; `bun run build` (or the
web-next typecheck) green with the widened types; manual check — a profile run
against corp_code 00577016 renders "2024 (`개별`)" and "2025 (`개별`)" columns with
the mixed-source caption, and the profile coverage note no longer claims
`이후 사업보고서 미제출`.
