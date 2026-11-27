---
lang: en
counterpart: beta-series-collection_ko.md
---

**Audience**: operators, deal analysts
**Owner**: backend-engineer
**Screens**: /projects/[id]/wacc

## Purpose

Daily-close time series (KOSPI/KOSDAQ index + subject/target company closes) feed the WACC beta regression panel ("`수집 데이터 불러오기`"). Series are collected with `scripts/co-newbiz/beta-series.ts` into `fact_market_observation` via the same ensure_fresh path as `newbiz fetch`.

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

## In-app collection ("`수집 실행`")

Analysts can start the same collection from the WACC beta panel: step 1 ->
collected source -> "`수집 실행`" (shown while nothing usable is collected;
the copyable command stays as the fallback). The button calls
`POST /api/projects/<id>/wacc/beta-series/collect`, which answers `202` at once
and runs `runBetaCollection` (`scripts/co-newbiz/beta-series-core.ts`, the CLI's
own core) inside the web server; the panel polls `GET` on the same path and
refills the status/data when the run finishes. A cold run takes minutes (one
paced KRX call per service per weekday, default last 13 months).

- Needs `KRX_API_KEY` on the server (else `503 krx_api_key_missing`) and an
  analyst account that is a project member (viewer 403, non-member/admin 404).
- One run per project (`409 already_running`) and one at a time per server
  (`409 collection_busy`) — the KRX adapter's run state is process-wide.
- Each run is a `job_run` row (`job_key = beta-series.collect`, trigger
  `manual`, actor = the calling user) plus an `audit_log` entry
  `beta_series.collect_requested`. A run whose server died stays `running`
  until the 60-minute stale sweep fails it; then retry (reruns are cache hits).
- Failures show on the run (status `failed` + reason), not as an HTTP error.

## In-app ECOS rate collection ("`ECOS 금리 수집 실행`")

The WACC reference card reports the risk-free rate and the credit spread as
missing until the three ECOS series are collected: Korean Treasury 3-year
(ECOS `721Y001`, item `5020000`), corporate bond 3-year AA- (item `7020000`) and
corporate bond 3-year BBB- (item `7030000`, ADR-0208: the lower anchor of the
rating-to-spread map; without it the spread falls back to the AA- figure).
Analysts can collect them from the WACC panel with "`ECOS 금리 수집 실행`"; the
panel then reloads the reference values. The button calls
`POST /api/projects/<id>/wacc/ecos/collect` (same model as the beta route: `202`
at once, the panel polls `GET`), which collects the last 12 months of both
series through the library behind `fetch --source ecos`.

- Needs `ECOS_API_KEY` on the server (else `503 ecos_api_key_missing`) and an
  analyst account that is a project member (viewer 403, non-member/admin 404).
- ECOS series are market-common, so the run slot and the status are global: a
  second request while one runs gets `409 already_running`, and `GET` shows the
  latest run to every member.
- Each run is a `job_run` row (trigger `manual`, actor = the calling user) plus
  an `audit_log` entry `wacc_ecos.collect_requested`. Failures show on the run
  (status `failed` + reason), not as an HTTP error.
- The public demo key `sample` is capped at 10 rows per request and is not
  enough for a 12-month collection; the server key must be a personal ECOS key.

## In-app credit-rating collection (disclosed rating, ADR-0208 slice 2)

The `credit_spread` reference follows the subject company's credit rating. The
rating comes first from DART (`rating_source: "disclosed"`); until it is
collected the card shows the default `BBB-` with the reason
`rating_not_collected` and a collect hint, and "apply all" skips that row.
`POST /api/projects/<id>/wacc/credit-rating/collect` (add `?target_id=<id>` for a
shortlisted target's company) collects it: `202` at once, the client polls
`GET` and then reloads `GET .../wacc/suggestions`, which reads the cache only and
never calls DART.

What a run does, per company: (1) finds the latest business report (the cached
`dart_disclosure` list first; typed `list.json` `pblntf_detail_ty=A001` when the
cache has none or only one older than about 13 months); (2) fetches that report
ONCE per `rcept_no` and parser version, parses the credit-rating section and the
debt-securities issuance table; (3) asks OpenDART `bdRs.json` (public offerings
only) for the last 18 months of registrations and their `cdrt_int` rating text.
Each result is one immutable `dart_credit_rating_snapshot` row (migration 0200).

- Needs `DART_API_KEY` on the server (else `503 dart_api_key_missing`), an
  analyst project member (viewer 403, non-member/admin 404) and a company with a
  DART corp code (else `400 no_dart_corp_code`; no company: `400 no_subject_company`).
- One run per project and one per company at a time (`409 already_running`):
  DART evidence is shared across projects.
- Each run is a `job_run` row (`job_key = wacc-credit-rating.collect`, trigger
  `manual`, actor = the calling user) plus an `audit_log` entry
  `wacc_credit_rating.collect_requested`. Failures show on the run (status
  `failed` + reason), not as an HTTP error; a run fails only when every DART
  step failed, partial failures are `warnings` on a successful run.
- Reading the outcome: `report_status` is the recorded parse status. A missing
  rating is never "unrated": `not_disclosed` (the filing says nothing applies),
  `section_present_no_bond_rating` (for example commercial paper only),
  `section_absent` and `parse_failed` (layout drift: ask for a parser fix) all
  leave the default rating with `disclosed_status` saying which. A transient
  fetch failure writes nothing, so the next run simply retries.
- A new parser version (`CREDIT_RATING_PARSER_VERSION`) re-parses each filing
  once; snapshots of older versions are ignored by the reads.
- Rolling back migration 0200 drops the cache only; it is re-fetchable from DART.

## Interest-coverage estimate and the one-time financial re-sync (ADR-0208 slice 3)

When a company has no fresh disclosed corporate-bond rating and no fresh
credit-bureau rating, the `credit_spread` reference uses a **synthetic** rating
(`rating_source: "synthetic"`, chip "interest-coverage estimate"): coverage =
operating income / interest expense of the latest fiscal year that has both,
mapped through the published coverage-to-rating table in
`region-profiles/KR.yaml` (`credit_rating_references.synthetic`). It is an
estimate, not an agency rating, so it is NOT part of "apply all" (`credit_rating_synthetic_basis`); apply it from its own row. The same inputs
feed the cost-of-debt cross-check (implied cost = interest expense / average
interest-bearing debt, compared with the market Kd; a warning only, never a
change of the number).

The inputs are DART accounts that the collector did not read before: interest
expense (`dart_AdjustmentsForInterestExpenses` / `ifrs-full_InterestExpense`),
finance costs, interest paid (two rows), pre-tax income and the borrowing rows
(migration `0201_md_account_interest_debt.sql`). **A company whose financials
were synced before this release has none of them**, so the card shows the
default rating with `synthetic_interest_not_collected` and a "financial data"
row in the "reference data collection" block with a **Run financial sync**
button (it calls the existing `POST /api/companies/<id>/sync`).

One-time re-sync after the release:

1. Apply migration 0201 first (migrations before the collector release,
   ADR-0014). Back up the database as for any migration; rollback is the
   `ROLLBACK-SQL` block in the file (it deletes the new accounts and their
   facts, nothing else).
2. The migration clears `dart_corp_sync_state.financial_checked_at`, so the next
   **incremental** sync (ADR-0199, the S6 bulk evaluation) re-fetches the latest
   fiscal year of every synced company and fills the new accounts for it. An
   incremental sync does NOT re-fetch closed earlier years.
3. The **manual** company sync (`POST /api/companies/<id>/sync`, the "sync DART
   financials" button on the company screen and the new row in the WACC panel)
   always pulls five years and fills every year. Use it for the companies you
   are valuing now; the cross-check needs two fiscal years of borrowing balances
   for its two-year average (with one year it uses the year-end balance and says so).
4. Nothing is lost if it is skipped: a company without the new accounts keeps the
   default rating and a re-sync hint; the WACC tax-rate suggestion keeps using
   operating income until pre-tax income is stored, then prefers pre-tax income.

Reading the outcome: `synthetic.reason_code` says why there is no estimate:
`synthetic_interest_not_collected` (re-sync), `synthetic_no_interest_expense`
(the latest year shows no interest), `synthetic_no_financials`,
`synthetic_not_applicable_financial` (a bank, insurer or similar, detected from
the company name by the registry rule `synthetic.financial_sector`). Interest
source order: interest expense, interest paid (operating plus financing
activities), finance costs (a proxy that overstates interest). Cross-check
reasons are `crosscheck_unavailable_*` and `crosscheck_unreliable_non_positive_debt`. A warning with `crosscheck_implied_far_below_market` means the actual cost is far below the market Kd (policy finance or low-rate borrowing?); it is also raised when the implied cost is below the risk-free rate.

## KOFIA grade yields: automated collection is OFF by default (ADR-0208 slice 4)

The credit spread can be built directly from the Korea Financial Investment Association's (KOFIA) published
grade-by-rating corporate bond yields (`kofiabond.or.kr`, menu `시가평가 > 채권시가평가수익률 > 일자별`; valuation-firm
average, public-offering unsecured corporate bonds AAA to BBB-, 3-year column) instead of interpolating between the two
ECOS anchors. The suggestion then has `spread_basis: "kofia_grade"` (chip "grade yield (KOFIA)"): spread = the grade's 3y
yield minus the KOFIA KTB 3y **of the same date**; no interpolation; Rf of the suggestion stays the ECOS risk-free entry.

**The gate.** KOFIA publishes no API for this and has not confirmed that automated collection is permitted (design
section 4.1: no terms clause found, `robots.txt` absent, the Q&A of 2022-08-05 says the yields are for simple information
only and accepts no liability; nothing is said about automation or redistribution). Therefore:

- Automated collection runs **only when `CO_NEWBIZ_KOFIA_COLLECT=on`** in the repo-root `.env` (restart the server after
  a change). The default, and any other value, is **off**. It stays off until KOFIA confirms **in writing** that automated
  collection of these yields is permitted; keep that confirmation with the ADR-0208 record before switching it on.
- Off: `POST /api/projects/<id>/wacc/kofia/collect` answers `503 kofia_collect_disabled` (no run, no audit row, no network
  call), the collector refuses by itself (so no script or test can fetch by accident), and the WACC panel shows **no**
  KOFIA row in "reference data collection". The spread uses the ECOS bases as before.
- On: the analyst sees a "grade yields" row in "reference data collection"; one run is three POSTs (latest published date,
  column heads, that day), sequential, a generic client User-Agent, no cookie, no login; it stores the KTB 3y and the ten
  grades of that day as day-grain observations (`kofia:ktb:3y`, `kofia:corp-public-unsecured:<GRADE>:3y`, source `kofia`,
  unit percent). Run it as often as you need (the latest day each time; a re-run of the same day writes nothing). Each run is
  a `job_run` (`wacc-kofia.collect`) and an audit row `wacc_kofia.collect_requested`.
- **Stored data is always read**, whatever the switch says: turning the switch off stops fetching, it does not hide what was
  collected. To stop using KOFIA data entirely, delete nothing: ask for a decision (ADR) first.

**Scheduled collection (the data path) and the manual button (a fallback).** The suggestions never fetch: `GET .../wacc/suggestions`
reads the stored observations only (and the status below from the stored data and the schedule row). The store is kept
current by the scheduler job **`collect.kofia`** (ADR-0019/ADR-0189, `docs/runbooks/scheduler.md`), default **weekday 18:45
KST** (15 minutes after `collect.krx`; KOFIA states no publication time, so a day's yields are assumed published from 18:30 KST
and a later publication is picked up the next day). Edit the cron on the admin schedule page if needed (no OS re-registration).

- Same gate: with `CO_NEWBIZ_KOFIA_COLLECT` not `on`, the job run ends **skipped** (`kofia_collect_off` in `job_run.detail_json`),
  with no network call. The job is a dedicated handler; the collector is deliberately **not** a `SOURCE_ADAPTERS` entry, so the
  generic `fetch` / `md:sync` / `collect.*` paths can never reach KOFIA.
- Each run asks for the service's latest published day (1 POST); if that day is stored it stops there (a holiday weekday costs
  one POST), otherwise it fetches and stores it (3 POSTs) and then backfills the business days still missing after the latest
  stored day, within the last 10 calendar days (2 POSTs per day, newest first; a day with no rows, i.e. a public holiday, is
  skipped; a failed backfill day is listed in the run detail and ends the backfill but never fails the run). A day is stored in
  one transaction, so a day is either complete or absent. The run detail carries `max_published_date`, `days_stored`,
  `days_already_stored`, `backfill_no_data`, `backfill_failed`. A layout change fails the run (terminal, a `batch_failure`
  notification); a 5xx/timeout is retried (max 2).
- **The manual button never fetches needlessly.** While the stored data is up to date (the latest stored day reaches the most recent
  weekday whose 18:30 KST publication has passed, or a successful check after that moment saw nothing newer, which settles
  public holidays) a click answers `200 up_to_date` ("already up to date", latest day shown): no network call, no run, no audit
  row. When the data is stale any analyst's click collects the latest day (no backfill). There is no force flag on the project
  route: admins cannot reach project routes (FR-SEC-03). An admin forces a re-collect with **Run now** of `collect.kofia` on the
  admin schedule page (a manual run fetches the latest day again; unchanged values write nothing, changed values become a revision).
- The panel row shows the latest stored day, whether the grade yield is used for this spread, and the **next scheduled run**
  (KST) - or that the job is switched off / not registered yet.

What is known and what is not (verified 2026-11-27, by reading the page's own client file and one probe each of three calls;
no login): the page calls one undocumented XML service (`POST https://www.kofiabond.or.kr/proframeWeb/XMLSERVICES/`, app
`BIS-KOFIABOND`, service `BISBndSrtPrcSrchSO`, functions `getExistMaxDate`, `getHeadList`, `selectDay`) and the answers
carried the expected rows. **Unverified**: that the service stays stable (it is internal, not a contract), and anything about
KOFIA's permission for automation. A layout change makes the run **fail** (`not a service response`, `no 3-year column`,
`no KTB row`, ...) and writes nothing; it is never read as a zero. Fix the parser (`db/lib/kofia-grade-yield.ts`,
`KOFIA_PARSER_VERSION`) against a fresh fixture (`tests/fixtures/kofia/`).

Reading the result: the credit row of the WACC card shows the chip, the grade yield, the same-date KTB, the date and a link
to the KOFIA page. The confirmation audit records `spread_basis=kofia_grade`, `kofia_date=<date>` and `kofia_series=<id>`
from the server's re-derivation at the cited month. KOFIA data wins over ECOS for the same or an older ECOS month; a newer
ECOS month (not yet matched by KOFIA data) wins. A rating KOFIA does not publish (BB+ and below) uses the ECOS bases.

## FSC bond cross-check (data.go.kr, ADR-0208 slice 4)

Next to the credit spread the WACC card offers **Look up outstanding bonds**: the company's outstanding bonds (coupon,
maturity, balance) and the latest price-implied yield of the largest five, from the data.go.kr FSC bond APIs
`금융위원회_채권기본정보` (`getBondBasiInfo_V2`) and `금융위원회_채권시세정보` (`getBondPriceInfo_V2`). It is **reference
evidence only**: never an applied value, never in "apply all", never stored, never an input to an audit row.
`GET /api/projects/<id>/wacc/bond-evidence` (optional `?target_id=`).

- Key: `DATA_GO_KR_API_KEY`, one `활용신청` per dataset (both approved on the development account; renew before
  2028-11-26; registry `docs/runbooks/data-go-kr-datasets.yaml`). Missing key: `503 data_go_kr_api_key_missing`.
  `SERVICE_KEY_IS_NOT_REGISTERED_ERROR` (a new approval not yet propagated, an unapproved dataset) is **not** an HTTP error:
  the answer is `200` with `evidence.status: "unavailable"`, `reason_code: "service_key_not_registered"`, and the panel says
  to look up again shortly. Quota (`quota_exceeded`) and an expired approval (`service_expired`) are shown the same way.
- Key form: the key in `.env` is the **Encoding** form (percent escapes). The client decodes it once and escapes it once; a
  key passed through `curl --data-urlencode` or `URLSearchParams` unchanged is escaped twice and answers
  `SERVICE_KEY_IS_NOT_REGISTERED_ERROR` even though it is valid.
- Issuer matching: by **name** (`md_company.name_ko`, company-form words and spaces ignored). `md_company` stores the 10-digit
  business registration number (`biz_reg_no`), not the 13-digit corporate registration number (`crno`) this API uses, and a
  `crno`-only query is not reliable (it answered 30,422 rows). The response `crno` is shown as evidence; several `crno` under
  one name means `ambiguous_issuer` and nothing is shown.
- Cost: one basic-info call plus at most five price lookups per press (the price API has no issuer filter and lists only
  days with a trade; window 12 months), cached in process for 15 minutes. A development account is traffic-capped.
- Terms (`공공누리`): basic info is **type 2** (source attribution, no commercial use; commercial users contract with
  `한국예탁결제원`); price info is **type 4** (source attribution, no commercial use, **no modification**, no redistribution;
  commercial use is bought from KRX). The panel shows the notice with links to both datasets; the price yield is displayed
  exactly as published with its trading day and is not stored or exported. Whether internal valuation work counts as
  "commercial use" is a legal-counsel reading (design section 4.2) that is **not** settled here.
- Verified live 2026-11-27 with the repo key: both operations answered HTTP 200 / `resultCode 00` and the field names
  listed in the registry notes. Not verified: behaviour for issuers with thousands of bonds (the client reads at most three
  pages of 100), and pagination order guarantees (none are assumed).

## Index choice (listing market)

The beta regression pairs the stock with the index of its **listing market**
by default: a KOSDAQ-listed company (e.g. `로보티즈` 108490, `레인보우로보틱스`
277810) is regressed against the KOSDAQ index, a KOSPI-listed one against
KOSPI. The other index stays selectable in the panel ("`시장 지수`" select next
to "`수집 데이터 불러오기`") and through `GET .../wacc/beta-series?index=KOSPI|KOSDAQ`.

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
re-apply via portal `마이페이지` → API `사용 신청`).
Until then every call returns `respCode 401 — Unauthorized API Call` and the
script exits 1 with 0 observations. Re-apply, wait for approval, and rerun;
resolved `단축코드` are cached in `db/data/krx-stock-code-cache.json`.

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
| `respCode 401 ... re-apply` | key valid but service not approved/expired | re-apply at portal `마이페이지` → API `사용 신청` |
| `HTTP 403` / `5xx` / timeout after retry | KRX burst throttling (seen at concurrency 4) or outage | wait and rerun (reruns are cache hits) |
| `not found in KOSDAQ master` / `ambiguous` | name does not match the listed abbreviation | pin with `--ticker 회사명=<6-digit code>` |
| `call budget exhausted` | range too large for the budget | raise `--budget` or narrow the range |
