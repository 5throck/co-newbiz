---
lang: en
counterpart: beta-series-collection_ko.md
---

**Audience**: operators, deal analysts
**Owner**: backend-engineer
**Screens**: /projects/[id]/wacc

## Purpose

Daily-close time series (KOSPI/KOSDAQ index + subject/target company closes) feed the WACC beta regression panel ("수집 데이터 불러오기"). Series are collected with `scripts/co-newbiz/beta-series.ts` into `fact_market_observation` via the same ensure_fresh path as `newbiz fetch`.

## Scheduling story

There is no host scheduler running locally — collection is **manual** until a
host cron exists (see [rag-host-scheduler.md](rag-host-scheduler.md) for the
same pattern). Run monthly, or more often; ensure_fresh makes reruns cache-hit,
so over-collecting costs API quota, not correctness.

```bash
bun scripts/co-newbiz/beta-series.ts --project <md_project.id>            # last ~13 months
bun scripts/co-newbiz/beta-series.ts --project <id> --from 2025-10 --to 2026-10
bun scripts/co-newbiz/beta-series.ts --project <id> --ticker 회사명=058050   # pin an unresolved short code
```

## Index choice (listing market)

The beta regression pairs the stock with the index of its **listing market**
by default: a KOSDAQ-listed company (e.g. 로보티즈 108490, 레인보우로보틱스
277810) is regressed against the KOSDAQ index, a KOSPI-listed one against
KOSPI. The other index stays selectable in the panel ("시장 지수" select next
to "수집 데이터 불러오기") and through `GET .../wacc/beta-series?index=KOSPI|KOSDAQ`.

- The collector records the resolved short code and market in the DB raw
  layer (`raw_payload`, id `krx:stock-master:<md_company.id>`); the web route
  reads it from there (the local `krx-stock-code-cache.json` is not visible to
  the web app).
- Unknown market (collected before this record existed) -> KOSPI default, as
  before.
- If the default index has no collected rows but the other one does, the API
  falls back to it and reports `hint_code: index_fallback`; it never pairs
  with an empty series silently.

Backfill for companies collected before v1.2.0 (one-time, idempotent, no KRX
calls, no API key needed — reads the local cache only):

```bash
bun scripts/co-newbiz/beta-series.ts --project <md_project.id> --backfill-market
```

## Prerequisite: KRX service approval

The KRX Data Marketplace key must have the six services approved
(idx/kospi_dd_trd, idx/kosdaq_dd_trd, sto/stk_bydd_trd, sto/ksq_bydd_trd, sto/stk_isu_base_info, sto/ksq_isu_base_info —
re-apply via portal 마이페이지 → API 사용 신청).
Until then every call returns `respCode 401 — Unauthorized API Call` and the
script exits 1 with 0 observations. Re-apply, wait for approval, and rerun;
resolved 단축코드 are cached in `db/data/krx-stock-code-cache.json`.

## Request shape: one call per (service, weekday)

Every KRX daily service takes a single reference date, `basDd=YYYYMMDD`, and
returns all rows of that day (every index of the family, or every listed stock
of the market). A date range (`bgnDd`/`endDd`) is not supported: KRX answers
HTTP 200 with an empty `OutBlock_1`. Request and field names were verified live
on 2026-10-12.

- The collector iterates the weekdays of each month (Saturdays, Sundays and
  future dates are skipped) and calls each service once per day with a
  two concurrent workers spaced at least 250 ms apart, and one retry on network errors, 5xx, or throttling (403/429, longer backoff).
- A day payload is cached in-process per (service, day), so the KOSDAQ index
  and every KOSDAQ-listed company share one call per day.
- An empty `OutBlock_1` on a weekday is a holiday/non-trading day; it is
  skipped and counted.
- Index rows are picked by exact `IDX_NM` (`코스피`, `코스닥`) with a numeric
  `CLSPRC_IDX`; rows such as `코스피 (외국주포함)` (empty close) are never used.
  Stock rows are picked by `ISU_CD` (6-digit short code) with close
  `TDD_CLSPRC`.
- The stock master (`sto/*_isu_base_info`) is called with `basDd` of the most
  recent non-empty weekday and matched on `ISU_ABBRV`/`ISU_NM` (exact, then
  prefix, then substring; ambiguity is reported, not guessed).

**Call volume**: about weekdays x distinct services. Thirteen months is about
280 weekdays; with the KOSPI index, KOSDAQ index, and one stock service that is
roughly 850 calls, plus 1-2 master calls per company. The default per-run call
budget is 2000 (`--budget N` to change it). The script prints calls, cache
hits, and empty-day counts.

## Troubleshooting

| Symptom | Meaning | Action |
|---|---|---|
| `0 observations` and "every KRX payload was empty" | wrong params (range instead of `basDd`) or only non-trading days in range | check the script version; widen `--from/--to` |
| `respCode 401 ... re-apply` | key valid but service not approved/expired | re-apply at portal 마이페이지 → API 사용 신청 |
| `HTTP 403` / `5xx` / timeout after retry | KRX burst throttling (seen at concurrency 4) or outage | wait and rerun (reruns are cache hits) |
| `not found in KOSDAQ master` / `ambiguous` | name does not match the listed abbreviation | pin with `--ticker 회사명=<6-digit code>` |
| `call budget exhausted` | range too large for the budget | raise `--budget` or narrow the range |
