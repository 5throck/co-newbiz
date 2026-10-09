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

## Prerequisite: KRX service approval

The KRX Data Marketplace key must have the six services approved
(idx/kospi_dd_trd, idx/kosdaq_dd_trd, sto/stk_bydd_trd, sto/ksq_bydd_trd, sto/stk_isu_base_info, sto/ksq_isu_base_info —
re-apply via portal 마이페이지 → API 사용 신청).
Until then every call returns `respCode 401 — Unauthorized API Call` and the
script exits 1 with 0 observations. Re-apply, wait for approval, and rerun;
resolved 단축코드 are cached in `db/data/krx-stock-code-cache.json`.
