---
lang: ko
lang_reason: source-material
title: "Wave A1 Design — Source-Adapter Framework + fetch + md:sync"
date: 2026-09-09
owner: pm
status: accepted — approved 2026-09-09 (basic seed set + law whitelist decisions included)
related:
  - "docs/planning/product-backlog-roadmap.md"
  - "ADR-0004"
  - "ADR-0025"
  - "scripts/co-newbiz/source-adapters.ts"
---

# Wave A1 Design — Source-Adapter Framework + fetch + md:sync

## 0. Problem and goal

The `market-data-pipeline` skill defines the collection pipeline, but `fetch`/`md:sync`
were unimplemented — S1 market analysis had no automated external data supply. The
harder half of collection (cache-first, revision preservation, change log) already
exists as `ensure_fresh()` (`db/repositories/observation.repository.ts`, ADR-0004).

This design defines (1) a **source-adapter framework mapped 1:1 to the k-* skill
family** (user-directed: the engine must leverage k-dart, k-kosis, k-opendata AND
k-law), (2) the `fetch` CLI, and (3) master-data catalog seeding via `md:sync`.

## 1. Source-adapter framework

### 1.1 Registry

```ts
// scripts/co-newbiz/source-adapters.ts
export interface SourceAdapter {
  code: "dart" | "kosis" | "opendata" | "law";
  kSkill: string;                // k-dart | k-kosis | k-opendata | k-law
  credentialEnv: string;         // DART_API_KEY | KOSIS_API_KEY | LAW_API_OC | DATA_GO_KR_API_KEY
  kind: "observations" | "catalog";
  isEnabled(): boolean;          // false when the credential is absent (fail-closed)
  listSeries(): Promise<SeriesDescriptor[]>;
  fetcher(ctx): Fetcher;         // the ensure_fresh contract: (seriesId) => {value, contentHash, raw}
  listCatalog?(opts): Promise<CatalogUpsert[]>;
}
export const SOURCE_ADAPTERS: Record<string, SourceAdapter>;
```

- The `Fetcher` shape is the existing `ensure_fresh` contract — coupling requires no
  new engine code, only injection.
- Adding a source = one `SOURCE_ADAPTERS` entry + the k-* skill doc refresh. Skills
  are each adapter's operating manual; adapters are the executables.

### 1.2 The four adapters

| Adapter | kind | Endpoint | Credential | Output |
|---|---|---|---|---|
| `dart` | catalog | DART OpenAPI (generalizes `dart-collect.ts`) | `DART_API_KEY` | `md_company` (dart_corp_code) via corpCode.xml |
| `kosis` | observations | KOSIS stats API | `KOSIS_API_KEY` | `fact_market_observation` series |
| `law` | catalog | 법제처 법령검색 (`law.go.kr/DRF/lawSearch.do`, JSON) | `LAW_API_OC` | `md_statute` (korea_statute_id) |
| `opendata` | catalog | data.go.kr (extension point — transport shared with law) | `DATA_GO_KR_API_KEY` | none onboarded yet |

- Grades: kosis=A (official statistics), dart=A (primary filings), law=A (statute
  text), opendata=B default (per-dataset).
- All HTTP goes through `scripts/lib/ssrf.ts` `safeFetch`.
- Credentials load from the root `.env` via the new `scripts/lib/env-keys.ts`
  (whitelisted keys, walk-up, never overrides set values — the `llm.ts` pattern
  generalized). Missing key → adapter reports disabled; the CLI exits 2 (silent
  empty results are forbidden).

### 1.3 KOSIS series mapping

- `SeriesDescriptor` = `{seriesId, adapter, title, unitCode, periodType, orgId,
  tblId, itmId, objL1..objL8, _verified}`. New seed entries ship
  **`_verified: false` by design** until the `orgId`/`tblId`/`itmId`/required
  `objL*` coordinates are confirmed against the live KOSIS API. The initial
  monthly index seeds were verified on 2026-09-09.
- KOSIS responses normalize to per-period `{value, contentHash=sha256(raw), raw}`.
  Unknown unit strings are **quarantined** (`kosis-units.ts`) — a silently wrong
  unit would poison downstream analysis (FR-DATA-03).

## 2. fetch CLI

```
bun scripts/co-newbiz/newbiz.ts fetch --source kosis [--series <id>] [--from YYYY-MM] [--to YYYY-MM]
bun scripts/co-newbiz/newbiz.ts fetch --source law [--all]
bun scripts/co-newbiz/newbiz.ts fetch --source dart --all   # corpCode is a full-market dump — --all required
```

- Observation series: current-year months, one `ensure_fresh()` per period — the
  engine owns revision preservation and `data_change_log`.
- Catalog sources: `listCatalog()` natural-key upserts (idempotent).
- Isolation: per-series/per-period errors are caught, reported, counted; exit 1
  if any failure. `md_source` rows are auto-registered per used adapter (grades above).
- law syncs a **whitelist by default** (상법, 독점규제법, 자본시장법, 전자거래기본법 —
  decided 2026-09-09); `--all` sweeps the full statute DB.

## 3. md:sync

```
bun scripts/co-newbiz/newbiz.ts md:sync --source <dart|law> [--all]
```

`upsertCatalog()` performs natural-key upserts (md_company.dart_corp_code,
md_statute.korea_statute_id); re-runs are no-ops. Schema-violating rows are
reported and skipped individually.

## 4. Testing

Adapter-common fixture suite (`tests/unit/source-adapters.test.ts`): registry
shape, credential fail-closed toggle, unknown-series error before credential
error, unit quarantine, natural-key upsert idempotency (against real scratch
SQLite). Live KOSIS/DART/law smoke runs happen only with keys present; results
recorded in the PR body. Limitations recorded otherwise.

## 5. Deliverables

- `scripts/co-newbiz/source-adapters.ts`, `kosis-units.ts`, `scripts/lib/env-keys.ts`
- `newbiz.ts` v1.14.0: `fetch`, `md:sync` cases
- `tests/unit/source-adapters.test.ts`
- market-data-pipeline skill v1.1.0 (gap note replaced by the real mechanism),
  SCRIPTS.md registry entries, `.env.sample` key documentation (KOSIS/LAW_API_OC/DATA_GO_KR
  already present)

## 6. Out of scope

- OS-scheduler automation (manual CLI only for now)
- Per-dataset opendata adapters (transport ready; onboard when needed)
- value_chain_link coupling (Wave A2 calibrate and beyond)

## 7. Open questions resolved (2026-09-09)

1. KOSIS seed: small default set shipped; initial monthly index seeds verified on 2026-09-09, future additions remain unverified until live coordinates are recorded.
2. law scope: whitelist default, `--all` for the full sweep.
