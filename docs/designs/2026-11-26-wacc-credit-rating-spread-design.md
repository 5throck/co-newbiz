---
lang: ko
lang_reason: proper-noun
---

# WACC credit-rating-aware cost-of-debt spread suggestion — design

- Status: Approved (2026-11-26; slice 1 under implementation, slices 2-4 pending)
- Date: 2026-11-26
- Owner: valuation-agent (design author); reviewers: quant-methodologist (method, registry maintainer), financial-analyst (DART accounts, cross-check), region-lead (region-profile contract), data-architect (new table, md_account seed), legal-counsel (third-party data terms, §4), design-system-agent (UI, per DESIGN-CHECKLIST)
- Related: ADR-0115 decision 4 (cost of debt = Rf + rating spread, rating named in the citation), ADR-0116 Phase 4 (WACC reference suggestions), ADR-0199 (DART evidence cache), ADR-0207 (ERP and tax-rate references, same suggestion mechanism), ADR-0061 (money units), proposed ADR-0208 (this change)
- Verification date for every external fact below: 2026-11-26 (probed from this repo with its own keys, or read from the publisher's page). Items marked **UNVERIFIED** were not confirmed and must not be built on until they are.

## 1. Problem

`credit_spread` in `db/lib/wacc-reference.ts` is fixed to ECOS `721Y001` "corporate bond 3y AA-" minus "KTB 3y", whatever the subject company's credit. Kd = Rf + spread therefore equals the AA- yield for everyone. Live example: Ke 10.28%, Kd 4.55%, where 4.55% is just the AA- yield (KTB 3y 3.861% + AA- spread 0.688%, ECOS 2026-10). For a company rated BBB or lower, Kd is too low against Ke and WACC is understated.

Goal: determine the subject's credit rating automatically (evidence first), map it to a spread grade, and show the result with its basis as a **suggestion**. The human applies and confirms; the confirmed row stays a user-confirmed component (ADR-0115 decision 5). A rating is an input to a proposal, never a verdict about the company.

## 2. Decisions

| # | Decision |
|---|---|
| D1 | **Rating ladder, evidence first**: (1) disclosed rating from DART; (2) synthetic rating from interest coverage; (3) default `BBB-` with a stated reason. The suggestion always states which rung produced the rating. |
| D2 | **Disclosed**: domestic agencies only (`한국기업평가`, `한국신용평가`, `NICE신용평가`), corporate-bond (`회사채`) ratings only. Per agency take the latest rating; across agencies take the **lowest** (conservative). Record agency, instrument, rating date and the filing (`rcept_no`) it came from. |
| D3 | **Synthetic**: interest coverage = operating income / interest expense, mapped with Damodaran's free published coverage-to-rating table (rating column only; his USD spreads are never used). Stored in `region-profiles/KR.yaml` under the profile provenance contract. |
| D4 | **Default**: `BBB-` with `reason_code` when neither rung produces a rating. Shown, but excluded from apply-all (§9). |
| D5 | **Spread from Korean market data only.** Rating-to-spread uses the grade-yield sources of §4, in a stated basis ladder: KOFIA grade yield (target primary, gated, §4.1) > ECOS AA-/BBB- anchors with geometric interpolation (default shipped first) > ECOS clamp. Spread = grade yield - KTB 3y yield **from the same source and date**. |
| D6 | **Cross-check, never an override**: implied actual borrowing cost (interest expense / average interest-bearing debt) against the market-built Kd; warn beyond 2.0 percentage points. |
| D7 | **Free sources only** (the ERP design's rule, ADR-0207 D2). Paid evaluators (KIS P&I, NICE P&I, KAP) are excluded. |
| D8 | The confirmation audit records the rating basis, **derived by the server** from stored evidence (as ADR-0207 does for tax brackets); the client flag for "edited" is ignored. |
| D9 | No parsing result changes a gate, RAG grade, kill criterion or data-confidence tier. A rating is not a `live` value. |

## 3. Scope

In scope: rating determination (disclosed, synthetic, default), the rating-to-spread map, the BBB- ECOS series, the interest-expense collector extension, cross-check, suggestion route fields, WACC panel rows, apply and apply-all, confirmation audit, lifecycle, tests.

Out of scope: scraping any site whose terms are unconfirmed; paid data; sector or country premia; ratings for non-KR markets; financial-sector companies (banks, insurers, securities: interest is operating cost, coverage is meaningless, synthetic rung is skipped with `synthetic_not_applicable_financial`); any change to the WACC formula; any effect on gates.

## 4. Source assessment (verified 2026-11-26)

### 4.1 KOFIA Bond Information Service (`kofiabond.or.kr`) — grade yields

| Item | Finding |
|---|---|
| Access | Public web pages, no login (home page answers 200). No documented API. No data.go.kr dataset carries the valuation-firm average yield by grade (searched); the FSC "retail bond yield summary by credit rating" dataset (data.go.kr 15094783) is **discontinued, data ends 2022-03-25**. The menu per KOFIA's own Q&A: 시가평가 > 채권시가평가기준수익률 (AAA to BBB- by maturity). |
| Machine path | One undocumented XML service (`/proframeWeb/XMLSERVICES/`, plain HTTP) appears in a community gist last active 2021. **UNVERIFIED that it still works**; not probed (undocumented internal service, terms unclear). Per the gist and KOFIA's Q&A its final-quote yields exist for only AA- and BBB-: the same two grades as ECOS, so no gain for the A range. |
| Terms | `robots.txt` absent (404). No clause on automated collection found. KOFIA Q&A 2022-08-05: the yield is published for simple information only, KOFIA accepts no liability, and each grade yield is a valuation firm's own derivation, not an average of actual issuers. Nothing is said about automation, redistribution or citation. |
| Role | **Target primary** for the rating-to-spread map: a direct yield per grade replaces interpolation between two anchors. **Not built in the first slice.** Gate: either (A) KOFIA confirms in writing that automated collection of the grade yields is permitted, then an adapter; or (B) interim human transcription: the maintainer reads the public page and records month-end 3y grade yields plus KTB 3y of the same date, with URL and `verified_on`, in an optional `credit_grade_yield_snapshots` registry section (month-end entries, never deleted). Until one of these exists the basis ladder skips this rung. |

### 4.2 data.go.kr — FSC bond APIs

| Item | Finding |
|---|---|
| Datasets | `금융위원회_채권기본정보` (`GetBondIssuInfoService_V2`, operation `getBondBasiInfo_V2`; filters `basDt`, `crno`, `bondIsurNm`; fields include coupon rate, issue/maturity dates, issue amount, guarantee type; **no rating field**). `금융위원회_채권시세정보` (`GetBondSecuritiesInfoService_V2`, operation `getBondPriceInfo_V2`; KRX-sourced prices and yields; filters by ISIN or item name; **no issuer or corporate-registration filter**, so it needs ISINs from the basic-info call first). Response field names are not listed on the portal pages: **UNVERIFIED**. |
| Terms | Basic info: KOGL type 2 (attribution, no commercial use; commercial users contract with KSD). Price info: KOGL type 4 (attribution, no commercial use, **no modification, no redistribution**; commercial use is bought from KRX). Whether internal valuation work counts as "commercial use", or a derived Kd counts as a modification, needs legal-counsel. |
| In this repo | `DATA_GO_KR_API_KEY` is configured and the `opendata` source adapter has its transport but no financial dataset onboarded (k-opendata documents customs only). Live probe: both operations exist, but this key returns `SERVICE_KEY_IS_NOT_REGISTERED_ERROR` (HTTP 403): a separate `활용신청` per dataset is required; approval type **UNVERIFIED**. |
| Role | **Optional, later (phase 3)**: traded yield of the subject's listed bonds as one more cross-check line. Not needed for the issuance-rate cross-check: DART already provides coupon, rating and maturity per issue (§4.3). Blocked on activation and the legal reading above. |

### 4.3 DART — disclosed rating and issue-level evidence (usable now)

Verified with the repo's existing DART key and client (`fetchDisclosureText`, plus a direct `bdRs.json` call):

- **Business-report section `신용평가에 관한 사항`**, inside `I. 회사의 개요 > 1. 회사의 개요` (heading letter varies: observed as `사.`, so match the heading text, not the letter). It sits near the start of the document (about character 3,000), well inside the 500,000-character cap of `fetchDisclosureText`. Three real shapes: narrative sentence plus table (한화솔루션: table header `평가일 | 평가대상 유가증권 | 신용등급 | 평가회사 | 평가구분`, rows like `2025.05.13 회사채 AA- NICE신용평가(주) (AAA~D) 정기평정`); table only, with multi-year history (대한항공: `2025-09-17 회사채 A 나이스신용평가 본평정`, older rows at A-, BBB+); and `해당사항이 없어 기재를 생략합니다` (동국제강, no rating).
- **Debt-securities issuance table** in the same report (`채무증권 발행실적`, columns include `이자율`, `평가등급(평가기관)`, `만기일`, `상환여부`; verified in both filings). Ratings appear as `A1(한국기업평가/NICE신용평가)`, `BBB+, BBB+(NICE신용평가, 한국기업평가)`, and foreign agencies too (`AA-, Aa2(R&I, Moody's)`).
- **OpenDART `bdRs.json`** (증권신고서 주요정보, 채무증권): works with the existing key; group `일반사항` carries `cdrt_int` (for example `AA-(안정적)\n(한국기업평가(주) / NICE신용평가(주))`), `fta`, `rpd`, `sbd`, `pymd`, guarantee fields `grt_int` / `grt_amt`. `intr` and `isrr` were `-` in the sampled filings (rate fixed after book-building); the final coupon is in the report's issuance table. Public offerings only: a private placement has no registration statement.
- Terms: OpenDART is a keyed API used by the repo already (budget via `dartFetch`).
- Role: **the disclosed-rating source** (D2) and the issuance-rate evidence for the cross-check.

### 4.4 KRX data portal (`data.krx.co.kr`)

Download needs a member login. The terms bar copying or distributing site data without KRX's prior permission; bulk or commercial use is a paid product (`krxdata@krx.co.kr`). `robots.txt`: absent. Listed-bond yields are thinly traded. **Role: none in the data flow**; a human may look at it manually. (The FSC price API of §4.2 is the same KRX data under KOGL 4.)

### 4.5 Rating agencies' own sites

NICE's copyright policy bars reproducing, processing, redistributing or storing site data (ratings included) beyond purpose without prior written permission, and its `robots.txt` disallows all crawlers except named search engines. KIS's notice bars copying or distribution without prior written consent (its `robots.txt` was not retrievable: **UNVERIFIED**). 한국기업평가: terms and `robots.txt` not retrievable: **UNVERIFIED**. **Role: human verification aid only.** The suggestion row shows agency home-page links from the registry; no automated fetch.

### 4.6 Excluded and constrained

- Paid evaluators (KIS P&I, NICE P&I, KAP): excluded by D7.
- Damodaran coverage-to-rating table (`pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/ratings.html`): free, no login, "data as of January 2026". Two tables on the page: large non-financial firms and financial services. Each row = lower bound, upper bound, rating, spread. The page states no usage terms; the maintainer records "free access, no login" in `note`. Used for coverage-to-rating **only**.
- BOK ECOS: `721Y001` carries `7020000` AA- (monthly, from 1987), `7030000` **BBB-** (monthly, from 2000-10; verified item code and data), `8010000` AA- valuation-firm average (monthly, from 2014), and KTB 3y `5020000`. The daily table `817Y002` carries the same AA- and BBB- pair. ECOS has no grade between them.

## 5. Rating determination

```
company bound? ── no ──> no credit suggestion (unchanged from today)
   │ yes
   ├─ rung 1 disclosed (cached DART snapshot)         -> rating, source=disclosed
   ├─ rung 2 synthetic (coverage x from fact_financial) -> rating, source=synthetic
   └─ rung 3 default                                    -> BBB-, source=default, reason_code
```

### 5.1 Disclosed (rung 1)

Collection is explicit, not in the GET path (the document is megabytes): `POST /api/projects/[id]/wacc/credit-rating/collect`, async 202 with `job_run` like `.../wacc/ecos/collect` (analyst role, project visibility, audit `wacc_credit_rating.collect_requested`); it also runs after a company financial sync. The suggestions GET reads the cache only and, with nothing cached, answers rung 2/3 with `reason_code: rating_not_collected` and a "collect" hint.

Steps (a pure parser in a new `db/lib/credit-rating-disclosure.ts`; the fetch uses the existing client):

1. **Find the filing.** Use the ADR-0199 cached `dart_disclosure` rows with `selectEvidenceBusinessReport` (newest including corrections). When the cache is empty, query `list.json` with `pblntf_detail_ty=A001` (verified to return the 사업보고서 of a high-volume filer such as 삼성전자). Do **not** use `searchDisclosures(..., "business")` for this: it filters client-side across five pages of 100 rows and missed the report for 삼성전자.
2. **Fetch once per `rcept_no`** with `fetchDisclosureText`; parse; persist (§8.2). Same cache discipline as ADR-0199: only complete parses and deterministic negatives are cached; a transient failure writes nothing.
3. **Section parse.** Locate the heading `신용평가에 관한 사항` (NFKC-normalised, tolerant of spacing and numbering). The text is tag-stripped and single-line, so table cells cannot be read by column: extract rows by pattern `date + instrument + grade + agency`. Date `\d{4}[.\-]\d{2}[.\-]\d{2}`; instrument `회사채` kept, `기업어음`/short-term kept in the snapshot but not mapped; grade `AAA|AA[+-]?|A[+-]?|BBB[+-]?|BB[+-]?|B[+-]?|CCC|CC|C|D`; agency by alias list from the registry. Strip the scale-range token `(AAA~D)` before grade matching, and never read `A1`/`A2` as grades. The sentence form (`...로부터 각각 2025년 5월 회사채등급 AA-등급...`) is a fallback when no table rows parse. Whether some filers write flat grades as `AA0` instead of `AA` is **UNVERIFIED**; add a normaliser only with a fixture proving it.
4. **Issuance table parse** (same document): rows with issue date, amount, coupon, `평가등급(평가기관)` split into a grade list zipped with the agency list, maturity, outstanding flag. Domestic agencies only for ratings; foreign grades (`Aa2`, `Moody's`, `R&I`) are different scales and are dropped from rating selection (kept as raw text). Guaranteed, secured or structured issues carry the guarantor's or structure's rating and are not issuer ratings: skipped.
5. **`bdRs.json`** (supplement): for filings in the last 18 months, parse `cdrt_int` into grade, outlook (stripped) and agencies; skip rows where `grt_amt` is a real amount. Rating date = `pymd` (payment date) else the filing receipt date, labelled "at issuance". Used when the report section is empty, absent or stale; when both exist and differ, show both and use the lower.
6. **Select.** Domestic agencies, `회사채`, latest row per agency, lowest across agencies; ties resolved by the newest date. A rating older than **18 months** (registry `disclosed.stale_months`) carries a stale chip, stays visible and applicable, and is excluded from apply-all, as stale ERPs are (ADR-0207 D6).

A parse that finds the section but no `회사채` row (CP-only, or `해당사항이 없어`) yields `section_present_no_bond_rating` or `section_absent_na`, and the ladder falls to rung 2. A CP rating is shown as information; it is not mapped to a long-term spread.

### 5.2 Synthetic (rung 2)

Definition: coverage x = operating income (`영업이익`) / interest expense, latest fiscal year in `fact_financial` where both exist, same year, same statement basis (CFS preferred as the collector does).

**What DART data exists today.** `WANTED_ACCOUNTS` in `app/web-next/lib/dart-client.ts` and the `md_account` seed (migration 0083) carry 8 accounts: revenue, cost of sales, SG&A, operating profit, net income, total assets, total liabilities, total equity. **Interest expense is not collected, nor is pre-tax income, nor any borrowings line.** The design therefore includes a collector extension (§8.3). Live shape from `fnlttSinglAcntAll` (2025, verified for 한화솔루션, 대한항공, 동국제강):

| Concept | Where it appears | Note |
|---|---|---|
| `금융비용` (`ifrs-full_FinanceCosts`) | income statement, all three | includes FX and derivative losses: overstates interest |
| `이자비용` (`dart_AdjustmentsForInterestExpenses`) | cash-flow adjustments, one of three | closest to true interest expense when present |
| `이자지급`/`이자의 지급` | cash flow, **two rows with the same name** (`...InterestPaidClassifiedAsOperatingActivities` and `...FinancingActivities`) | cash basis; must be summed. The current collector dedupes by account name, first wins, so it would silently keep one |
| `법인세비용차감전순이익` (`ifrs-full_ProfitLossBeforeTax`) | income statement, two of three | the alias exists in `ACCOUNT_ALIASES` but the account is not in the whitelist |

Interest-expense hierarchy (recorded as `interest_source` on every synthetic result): (1) `이자비용` when present; (2) `이자지급` operating plus financing; (3) `금융비용` with a proxy note (it overstates interest, so coverage is understated and the rating comes out conservative). Zero or missing interest expense: coverage is undefined, the synthetic rung returns `synthetic_no_interest_expense` and the ladder falls to the default (a debt-free company's Kd has negligible weight in WACC anyway). Operating income at or below zero: coverage <= 0 falls into the table's lowest bucket and is flagged `synthetic_loss_making`.

Mapping: the registry's coverage table (default `non-financial`), buckets lower-inclusive, upper-exclusive. The table is Damodaran's global-scale rating and coarser than the notch scale (the rows read on the page go from `BBB` straight to `A-`, so some notches such as `BBB+` and `BBB-` may never be produced; the maintainer transcribes exactly what the page publishes), so the result goes through the same rating-to-spread map as any other rating. Known bias: a global-scale synthetic rating is typically lower than the same company's Korean national-scale rating, so using it on the domestic ECOS curve is conservative; the chip says "synthetic (estimate, not a rating)". Coverage uses reported operating income without Damodaran's lease or R&D adjustments, and one fiscal year; both are stated in the note.

### 5.3 Default (rung 3)

`BBB-` with `reason_code` one of `no_company_financials`, `no_disclosed_rating_and_synthetic_unavailable`, `financial_sector`. Rationale: the borrowing cost of an unrated, unevidenced company should not be flattered to AA-; BBB- is the lowest investment-grade point on both ECOS and KOFIA tables. It is a placeholder the human must look at, not an estimate.

## 6. Rating to spread

Notch index on the registry scale: AAA 1, AA+ 2, AA 3, AA- 4, A+ 5, A 6, A- 7, BBB+ 8, BBB 9, BBB- 10, BB+ 11 and so on.

**Basis ladder** (first available wins; the suggestion records `spread_basis`):

1. `kofia_grade_direct` (phase 3, gated by §4.1): the grade's 3y yield minus KTB 3y of the same snapshot. Covers AAA to BBB- directly; no interpolation.
2. `ecos_interpolated` (**shipped first**): anchors AA- (`7020000`) and BBB- (`7030000`), both minus KTB 3y (`5020000`), at the latest month where all three exist.
   - AAA, AA+, AA, AA-: clamp to the AA- spread (no lower anchor exists; the AAA spread is slightly lower, so this errs conservative; stated in the note).
   - BBB-: the BBB- anchor.
   - A+, A, A-, BBB+, BBB: **geometric interpolation by notch**, spread(n) = s_AA- x r^(n-4) with r = (s_BBB- / s_AA-)^(1/6).
   - BB+ and below: clamp to the BBB- spread with chip `below_investment_grade_series_understates`.
3. `ecos_clamped`: if interpolation inputs are incomplete (for example BBB- not yet collected): A-range and above use AA-, below uses BBB-, flagged.

Why geometric interpolation and not a two-bucket step rule. The ECOS anchors are far apart, and the BBB- series is thin and wide: illustration with 2026-10 ECOS (KTB 3y 3.861%, AA- 4.549%, BBB- 10.358%; spreads 0.688 and 6.497 percentage points, r = 1.454):

| Rating | Spread (pp) | Kd = Rf + spread (%) | Step rule would give |
|---|---|---|---|
| AA- and above | 0.688 | 4.549 | 4.549 |
| A+ | 1.000 | 4.861 | 4.549 |
| A | 1.454 | 5.315 | 4.549 |
| A- | 2.114 | 5.975 | 4.549 |
| BBB+ | 3.073 | 6.934 | 10.358 |
| BBB | 4.468 | 8.329 | 10.358 |
| BBB- | 6.497 | 10.358 | 10.358 |

A step rule puts an A- company at the AA- yield and a BBB+ company at 10.36% (above the 10.28% Ke of the live example): a cliff of 5.8 points between adjacent grades. Spreads rise convexly with notch, which geometric interpolation reproduces, and the figures stay deterministic and disclosed. The interpolated values are **not published figures**: they are labelled `interpolated`, the note shows both anchors, their as-of month and the formula, and the human confirms. This departs from ADR-0207's "agents must not infer values" only for a deterministic, disclosed formula over two published anchors; the alternative (step rule, recommended as the fallback basis only) is a judgment call listed in §14.

Spread, KTB and as-of month all come from one source; Rf of the suggestion stays the existing ECOS `risk_free` entry, so Kd = Rf + spread is unchanged in form. The spread is computed inside one source and one month, never across sources.

A guard is added in the WACC panel (no block): when Kd >= Ke, show a warning chip; the BBB- series reaching Ke in the live example shows low-grade ECOS yields can be extreme.

## 7. Cross-check: actual borrowing cost

- implied cost = interest expense / average interest-bearing debt, average of FY and FY-1 year-end balances from `fact_financial` (only year-end when the prior year is missing, flagged).
- Interest-bearing debt: balance-sheet rows only, matched **by name pattern** (`차입금`, `단기차입금`, `장기차입금`, `사채`, `유동성장기부채`, `리스부채`, `자산유동화차입금`), because many of these rows carry no standard account code (`-표준계정코드 미사용-`, observed on 대한항공) and names differ by filer. Summed by (account id, name) to avoid double counting. Fidelity is low by nature: this is a warning input, not a model input; when no borrowing row is found the check returns `crosscheck_unavailable_no_debt_rows`.
- Compared with the market-built Kd (Rf + mapped spread). **Warn when the absolute gap exceeds 2.0 percentage points** (registry `kd_crosscheck.warn_gap_pp`; a judgment parameter, calibrated against sampled filers before first use, see §14). Output: `implied_cost_pct`, `market_kd_pct`, `gap_pp`, `direction` (`market_above_actual` | `market_below_actual`), `interest_source`. When implied cost is below Rf, return `unreliable` (capitalised interest, measurement error) instead of a warning.
- Issuance evidence (informational): the most recent `회사채` issues of the last 36 months from the issuance table, each with issue date, rating at issue, coupon and maturity, shown next to the market-built Kd. Coupon is as filed; it is not adjusted.
- Neither check changes any number; both are shown on the row.

## 8. Data model

### 8.1 Registry — `region-profiles/KR.yaml`, optional section `credit_rating_references`

Handled like `erp_references` and `corporate_tax_rates`: `_schema.yaml` bumped to 1.4, added to `optional_top_level`; skipped when absent, held to the provenance rules when present. Values below are placeholders; no coverage threshold is asserted here, the maintainer transcribes each from the publication.

```yaml
credit_rating_references:
  source: "Rating scale, agency aliases, published coverage-to-rating table, mapping parameters"
  verified_on: "<ISO date>"
  maintainer: quant-methodologist
  data:
    rating_scale: [AAA, AA+, AA, AA-, A+, A, A-, BBB+, BBB, BBB-, BB+, BB, BB-, B+, B, B-, CCC, CC, C, D]   # best to worst; notch = index + 1
    agencies:                                  # only these count as 'disclosed'
      - id: korea-ratings   # 한국기업평가
        aliases: ["<as written in filings>", ...]
        home_url: "https://<verified home page>"   # human aid only
      - id: kis             # 한국신용평가
      - id: nice            # NICE신용평가
    disclosed: { instrument: corporate_bond, stale_months: 18, aggregate: lowest }
    default: { rating: BBB-, reason: "<text>" }
    spread_map: { upper_anchor: AA-, lower_anchor: BBB-, between: geometric, above_upper: clamp, below_lower: clamp_flagged }
    kd_crosscheck: { warn_gap_pp: 2.0 }
    synthetic:
      default_table_id: damodaran-non-financial-<edition>
      tables:
        - id: damodaran-non-financial-<edition>
          source: "<publication, table name>"
          url: "https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/ratings.html"
          basis: ebit_over_interest
          as_of: "<date the page states, e.g. January 2026>"
          verified_on: "<date>"
          maintainer: quant-methodologist
          note: "<free access confirmed, no login; rating column only, USD spreads not used>"
          rows: [ { lower_x: <n>, upper_x: <n|null>, rating: <label> }, ... ]
```

Series ids stay code constants (as `RF_SERIES_ID` is today): `CORP_BOND_BBBM_SERIES_ID = "ecos:721Y001:7030000"`. The interpolation formula is code, its parameters (anchors, method) are registry data.

`_validate.ts` additions: section provenance as for any section; `rating_scale` unique, non-empty; agencies unique ids with non-empty aliases; `default.rating`, anchors and every table rating resolve in the scale; per table `url` starts with `https://`, `as_of` / `verified_on` valid dates not in the future; rows contiguous from 0, one open top row, rating monotone non-decreasing in quality as coverage rises; `stale_months` and `warn_gap_pp` positive numbers; `default_table_id` resolves. The validator never fetches URLs and cannot re-verify the table; `verified_on` and `maintainer` stay the human attestation, with the same region-lead AI second review and human value check as ADR-0207.

### 8.2 New table — migration `NNNN_dart_credit_rating_snapshot.sql` (next free number at implementation time; additive, reversible)

`dart_credit_rating_snapshot`: `id` ULID PK; `corp_code` (8); `source_kind` CHECK in (`business_report`, `debt_securities_filing`); `source_rcept_no` (14); `parser_version`; `status` CHECK in (`parsed`, `section_present_no_bond_rating`, `section_absent`, `not_zip`); `ratings_json` (rows: agency id, instrument, grade, rated_on, raw text); `issues_json` (issue date, amount in **INTEGER KRW millions** per ADR-0061, coupon in percent points, rating raw, maturity, outstanding flag); `content_hash`; `fetched_at`. UNIQUE (`source_rcept_no`, `parser_version`); update trigger raising like `dart_disclosure`. A new `parser_version` re-parses once. Rollback: drop the table (cached evidence is re-fetchable from DART).

Why a new table, not new keys in `dart_business_report_extract`: that table's section keys feed the brownfield AI-evaluation windows (ADR-0199) and an extractor-version bump re-fetches every cached report for the S6 flow. Credit data has a different consumer and cadence.

### 8.3 Collector and master data

- `app/web-next/lib/dart-client.ts` `fetchFinancials`: today matches by normalised `account_nm`, first wins, ignores `sj_div` and `account_id`. Add an **id-keyed** extension (`WANTED_ACCOUNT_IDS`) for `ifrs-full_FinanceCosts`, `dart_AdjustmentsForInterestExpenses` (and `ifrs-full_InterestExpense` if present), the two `...InterestPaidClassified...` ids (stored as separate rows, summed at read time), `ifrs-full_ProfitLossBeforeTax`; and a **name-pattern** extension for the borrowing rows of §7, balance sheet only. The existing 8 accounts keep their current path byte for byte (regression test). **Bundled gain:** pre-tax income is what ADR-0207's tax-rate suggestion already prefers; it starts being used with no further change.
- Migration `NNNN_md_account_interest_debt.sql`: seed the new `md_account` rows (the writer fails loudly on a missing account row by design); additive. A data step sets `dart_corp_sync_state.financial_checked_at` to NULL so the ADR-0199 incremental sync re-fetches once and fills the new accounts for already-synced companies (to be confirmed against the incremental logic in the implementing PR). Values stay raw KRW as filed, the existing `fact_financial` convention; display and cross-check convert.
- ECOS: add `ecos:721Y001:7030000` ("회사채(3년, BBB-)", item code verified 2026-11-26) to `ECOS_SEED_SERIES` in `scripts/co-newbiz/source-adapters.ts`; `ECOS_SERIES` in `beta-collection-runner.ts` grows from two to three, which changes the exactly-two-series assertion in `tests/unit/wacc-ecos-collect-route.test.ts`. `computeWaccReference` reads the third series; nothing else about the ECOS flow changes.

## 9. Route, panel, apply

Route `GET /api/projects/[id]/wacc/suggestions`: the existing `credit_spread` entry keeps its key, `value` (percent points) and `as_of`, and gains additive fields: `rating`, `rating_source` (`disclosed` | `synthetic` | `default`), `rating_stale`, `rating_agencies[]` (agency, grade, rated_on), `rating_instrument`, `source_rcept_no`, `spread_basis`, `series_used[]`, `anchors` (both yields, KTB, as-of month), `synthetic` (`coverage_x`, `interest_source`, `fiscal_year`, `table_id`), `reason_code`, `crosscheck`, `issuance_evidence[]`, `agency_links[]`. Fails soft: any rung failure falls to the next; a total failure keeps today's AA- behaviour with `spread_basis: "aa_minus_legacy"` and a reason, never a placeholder. The company-financials screen payload (`company-wacc-reference.ts`) reads the same entry, so its `note` and label follow; its key list is unchanged.

Panel (DESIGN-CHECKLIST): pattern P4 as for ADR-0207; the `credit_spread` row in the "WACC 참조값" card shows rating, a source chip (공시 / 추정 / 기본값), agency and rating date, the mapped series and basis (`interpolated` stated in text), the spread, stale and cross-check chips (status by text, not colour alone), agency home-page links (human aid), and the issuance-evidence lines. Existing per-row apply button; no new tokens or components; ko/en locale keys; design-lint passes.

Apply: client-side, fills the spread input with citation (`source_label` naming the rating and basis, `anchor_ref`, `as_of`) as today; a human edit afterwards is allowed. **Apply all applicable** includes the row when `rating_source` is `disclosed` (not stale) or `synthetic`. It excludes `default` and stale-disclosed ratings and lists them in `wacc-reference-missing` with the reason ("등급 근거 없음 — 개별 확인 후 적용"), so one click never carries an unevidenced placeholder.

## 10. Confirmation audit (server-derived, as ADR-0207 tax brackets)

`wacc.debt_spread` may carry optional `credit_rating_snapshot_id`, `credit_rating_basis` (`disclosed` | `synthetic` | `default`) and `reference_as_of`. The server resolves the snapshot id (unknown id: 400, no run created), **re-derives** the rating and spread from stored evidence and the registry at the cited `reference_as_of` month, and derives `edited_from_reference` by comparing the confirmed spread with the re-derived spread (tolerance 0.0005 as a ratio); a client-sent flag is ignored. Basis, rating, agency, rated_on, `spread_basis` and mapped series are recorded from the re-derivation, not from the request. The row stays a user-confirmed component (ADR-0115), rationale gains `credit_rating=<grade>; credit_rating_source=<basis>; spread_basis=<basis>` and, when edited, `edited_from_reference: true`. The `assumption_set` audit target extends to `<run>:wacc.debt_spread:user:credit_rating=<grade|null>:credit_rating_source=<basis|null>:spread_basis=<basis|null>:edited_from_reference=<bool>`. A manual spread audits exactly as before. Apply and collection are the only other events: collect is audited (`wacc_credit_rating.collect_requested`); apply writes nothing.

## 11. What stays human

Whether to use the suggested rating at all, which rung to trust, the spread, the cross-check reading, and confirming the WACC. A rating shown here is a model input with stated provenance, not a credit opinion and not a rating issued by an agency for this purpose. No gate, RAG grade, kill-criteria or data-confidence effect. Outputs remain decision support, not investment advice.

## 12. Failure modes

| Failure | Handling |
|---|---|
| Section absent, `해당사항이 없어`, or CP-only | falls to rung 2, status recorded (`section_absent`, `section_present_no_bond_rating`) |
| Filing HTML/layout drift breaks the heading or row pattern | zero rows parsed is a distinct status, never read as "unrated"; parser_version bump and fixtures; ladder falls to rung 2 with `reason_code` |
| Grade range token `(AAA~D)`, `A1`, outlook `(안정적)`, foreign grades read as ratings | explicit strip/skip rules and fixtures (§5.1) |
| Rating older than the report (a downgrade after filing) | `rated_on` and stale chip; `bdRs.json` supplement; lookup links for a human check; the 18-month rule is a parameter |
| Report text truncated at 500,000 characters | the rating section sits near the start; the issuance table was inside the cap in both samples; a truncated flag is stored and a missing table is `issues_unavailable`, not zero issues |
| Guaranteed or structured issue ratings read as issuer ratings | skipped (§5.1 step 4/5) |
| Report not found for a high-volume filer | typed `list.json` (`A001`) fallback instead of the 5-page client filter |
| Interest expense absent or only `금융비용` | hierarchy with `interest_source` shown; zero/missing gives no synthetic rating |
| Operating income <= 0 | lowest bucket, `synthetic_loss_making` flag, clamp to BBB- series with the understatement chip |
| Financial-sector company | synthetic skipped, default with `financial_sector` |
| Global-scale synthetic rating vs Korean national scale | stated in the note; conservative direction |
| ECOS BBB- missing or stale month | `ecos_clamped` basis, flagged; Rf/spread only at a common month as today |
| ECOS BBB- extreme (Kd >= Ke) | warning chip in the panel; human decision |
| KOFIA terms unconfirmed or endpoint changed | the rung is skipped, never scraped; ladder uses ECOS |
| data.go.kr key not activated / field names unknown | feature not built until activated and verified; no effect on phases 1-2 |
| YAML parse or validator miss at runtime | fails soft to `aa_minus_legacy`; the validator in `audit.ts` should stop it reaching main |

## 13. Lifecycle and ADR triggers

- `region-profiles/**`: `credit_rating_references` carries `source` / `verified_on` / `maintainer` on every field; `_validate.ts` rejects unsourced fields. quant-methodologist maintains it, re-verifies at least yearly and on each new Damodaran edition; region-lead reviews `_schema.yaml` / `_validate.ts` as contract owner.
- ADR triggers (project CLAUDE.md and ADR README): **DB schema** (new table), **master-data code system** (new `md_account` rows), **external data source changes** (ECOS BBB- series; DART section and `bdRs.json` as new evidence uses; KOFIA and data.go.kr are not onboarded here and each needs its own ADR amendment when they are). ADR-0208 covers these and amends ADR-0115 decision 4 (rating named in the citation becomes rating basis recorded and server-derived).
- `agents/**` untouched. `skills/**`: align `wacc-input-session` and `k-dart` wording in the implementing PR if they describe the spread as AA-only or the account set as 8 accounts.
- Collector change (`dart-client.ts` version bump) and migrations follow the release-engineer ordering (ADR-0014): migrations before the collector release; reversible metadata on both.

## 14. Test plan

- Parser fixtures from real filings (anonymised text excerpts, not live calls): narrative plus table, table with multi-year history, `해당사항이 없어`, CP-only, `(AAA~D)` token, outlook suffix, foreign-agency issue row, guaranteed issue, heading letter variants; selection (latest per agency, lowest across, stale boundary at 17/18/19 months); `bdRs` `cdrt_int` parsing including two-agency and foreign forms.
- Report locator: cached list, `A001` fallback, correction preferred.
- Spread mapping: every rating of the scale at known anchors (exact anchors, clamp above, clamp below with chip, interpolation values to 3 decimals), missing-anchor fallback, as-of month alignment, zero/negative spread guard.
- Synthetic: bucket boundaries (lower-inclusive), interest hierarchy, summed `이자지급`, loss-making, zero interest, financial sector, same-year pairing.
- Collector: the 8 existing accounts byte-identical; new id-keyed accounts including duplicate-name `이자지급`; borrowing name patterns; re-sync trigger.
- Cross-check: gap boundary at 1.9 / 2.0 / 2.1 pp, direction, implied < Rf, no debt rows, single-year average.
- Validator unit tests: every rule of §8.1 (missing fields, unresolved ratings, non-contiguous rows, future dates, non-https URL), absent section still passes.
- Route: rung order, fail-soft to legacy, no-company behaviour unchanged, `target_id` per-target, additive fields only, `suggestion_count`.
- Panel: chips, apply, apply-all inclusion/exclusion (disclosed fresh, synthetic in; default and stale out with missing-list reason), Kd >= Ke chip.
- Confirmation: snapshot id unknown gives 400; server re-derivation; client edited flag ignored; audit target string; manual spread unchanged; ECOS collect test updated to three series.
- Regression: `snapshot-filler.ts` keys byte-identical; `assembleDerivation()` unchanged for identical inputs; company-financials payload keys unchanged; design-lint and ko/en keys.

## 15. Slicing (suggested, one PR each, sequential per the branch rule)

1. BBB- ECOS series, registry section and validator, spread map with interpolation, route fields, panel row (rating typed by default only); ADR-0208 accepted.
2. DART disclosed rating: table, parser, collect route, `bdRs` supplement, confirmation audit.
3. Collector extension and migrations, synthetic rung, cross-check, issuance evidence.
4. Optional: KOFIA grade yields (after §4.1 gate); data.go.kr (after activation and legal review).

## 16. Open risks

- Parser fragility is the dominant risk: filers format the section differently and the text is cell-less. The mitigation is statuses that never read "could not parse" as "unrated", fixtures, and a human-visible source filing number.
- The BBB- ECOS series is thin; interpolation inherits its extremes (and a Kd above Ke is possible). KOFIA direct grade yields would remove most of that, which is why they are the target primary.
- Cross-check threshold and 18-month staleness are judgment parameters until calibrated on real filers.
- Third-party terms: KOFIA, KOGL 2/4, KRX and agency policies are read from public pages, not legal advice; legal-counsel owns the reading before any automation beyond DART and ECOS.
