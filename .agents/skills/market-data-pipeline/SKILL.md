---
name: market-data-pipeline
scope: co-newbiz
description: >
  Fetches and maintains external statistical series under the cache-first,
  revision-preserving policy (ADR-0004): reuse cache within its validity
  window, conditional requests otherwise, and on a genuine change insert a
  new `revision_no` row rather than overwrite — all revisions preserved in
  `data_change_log`. Implemented 2026-09-09 (design
  `docs/designs/2026-09-09-source-adapter-framework-design_ko.md`): the
  source-adapter framework maps the k-* skills to executable adapters
  (`scripts/co-newbiz/source-adapters.ts`); `fetch --source
  <dart|kosis|law|opendata>` runs collection through `ensure_fresh`, and
  `md:sync --source <dart|law>` performs idempotent natural-key catalog
  upserts. Fail-closed: a missing credential disables the adapter (exit 2),
  an unknown KOSIS unit is quarantined (kosis-units.ts), and seed statIds
  ship `_verified: false` until confirmed against the live API.

  Use when: "fetch market data", "series revision policy", "data change
  log", "market data pipeline".
version: 1.1.0
last_reviewed: 2026-08-20
status: active
owner: data-architect
prerequisites: none
metadata:
  type: implementation
  triggers:
    - fetch market data
    - series revision policy
    - data change log
    - market data pipeline
---

## Context

**Implementation note**: Wave A1 landed the source-adapter framework in
`scripts/co-newbiz/source-adapters.ts` and wired it into
`scripts/co-newbiz/newbiz.ts` as `fetch` and `md:sync`. This skill is now the
operating manual for the live pipeline: k-* skills define source-specific
usage discipline, adapters execute collection, and `ensure_fresh()` owns
cache-first revision preservation.

## Policy (ADR-0004)

External statistical series get revised after first publication —
overwriting on refetch would make a three-month-old analysis
unreproducible. `ensure_fresh(series_id)`:

1. Reuses cache within its validity window — no network call at all if the
   cached data is still fresh
2. Uses conditional requests (ETag / content-hash) when the cache window
   has expired — cheap check for "did the source actually change"
3. On a genuine change, inserts a **new** `revision_no` row rather than
   overwriting the existing one — every revision is preserved in
   `data_change_log`, so a past run's exact inputs remain reconstructible
   even after the source agency restates history

Storage grows monotonically with revisions, offset by the archival policy
(ADR-0042) — this is an accepted tradeoff, not an oversight.

## When to Use

- Any time a project needs external market/industry time-series data
- When refreshing master-data catalogs from DART or law sources

## Execution Steps

1. Check cache validity for the requested `series_id` before any network call
2. If expired, issue a conditional request (ETag/content-hash) — a 304-equivalent means no revision needed
3. On an actual content change, insert a new `revision_no` row, never overwrite
4. Log the change in `data_change_log` with old/new values (as
   `observation.repository.ts`'s existing change-detection logic already
   does downstream of ingestion)
5. Respect SSRF-guard constraints on any outbound fetch (design's fetcher
   requirement) — never fetch an unvalidated URL

## Output Format

- Fetched/refreshed series data with revision history preserved

## Related Skills

- `data-freshness-and-revision-control` — the platform-side operational counterpart
- `proxy-industry-chain` — a consumer of the series data this pipeline would fetch
