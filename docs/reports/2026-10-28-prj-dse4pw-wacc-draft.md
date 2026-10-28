# PRJ-DSE4PW WACC Draft (DRAFT — not a confirmed input)

> **Status: DRAFT.** This is a method draft from `quant-methodologist`. It is not a confirmed input. A WACC or hurdle IRR counts only when a person confirms it in the WACC screen (`kind='user'`, bf-02). Nothing was written to any database.
> It is decision support, not investment advice. Hurdle IRR is a company policy choice. The options below are not a recommendation.

- Project: PRJ-DSE4PW (`01M1MXQN21DP8KYHNW3GDSE4PW`), greenfield, sub-track `existing_business_rbd`, establishment_mode `new_entity`.
- Name: Hydraulic breaker — European Stage V market entry (strategic review). This is the hydraulic-breaker business entering the EU Stage V replacement market. It runs through the promoter's own brand, its NL sales subsidiary and its dealer network.
- Promoter: Soosan Cebotics (DART 00135111, KOSPI 017550). The company is listed. The new business is in the promoter's existing industry (hydraulic breakers and attachments), so the promoter itself is a valid peer.
- Data as of 2026-10-23 (KRX) and 2026-10-28 (ECOS). Prepared 2026-10-28.

## 0. Current state in the dev DB (read-only)

| Item | Finding |
|---|---|
| `wacc` / `hurdle_irr` / `wacc.*` assumption rows | **None.** No run of this project has any of them, so the resolver falls back to `DEFAULT_WACC = 10%` with source `default`. |
| `md_project.wacc_subject` | **NULL.** The track default resolves to `promoter` (greenfield self-execution, `trackDefaultSubject`). `wacc-confirmation.ts` lists `wacc_subject` as its own missing item, so the owner must also record the subject with a rationale. |
| Re-confirm requirement `01M619MTN5186QEE8ME3CW6RFN` | Items: `wacc_confirmed`, `ic_countersign`, `na_review` |
| Business case | Valuation models are `market_forward` with a 5-year horizon, in INTEGER KRW millions (ADR-0061). **Defect flag:** base model `01M55EHMRAXQANPP34AVG4D1P2` has revenue of 0.000405 KRW M and opex of 0.000243 KRW M against capex of 200 KRW M. That looks like a scale or unit defect (same class as the ADR-0181 incident). It is out of scope for this draft and is routed to `financial-analyst` / PM. |

## 1. Peer set (listed KR, hydraulic breaker / construction-equipment attachments and components)

| Ticker | Name (KRX) | Market | Why included | Mkt cap 2026-10-23 (KRW bn) |
|---|---|---|---|---|
| 017550 | Soosan Cebotics | KOSPI | The promoter. A hydraulic-breaker pure play. | 108.0 |
| 317850 | Daemo Engineering | KOSDAQ | Hydraulic breakers and attachments. Its business is the closest match. | 54.7 |
| 041440 | Hyundai Everdigm | KOSDAQ | Hydraulic breakers plus concrete pump trucks | 108.8 |
| 036890 | Jinsung T.E.C. | KOSDAQ | Excavator undercarriage. Same demand cycle, export-heavy. | 202.3 |
| 010240 | Heungkuk | KOSDAQ | Excavator wear and attachment parts. Same demand cycle. | 57.6 |
| 267270 | HD Construction Equipment | KOSPI | Excavator OEM and the named EU bundling channel. Same cycle but larger and more diversified. | 4,241.5 |

Excluded:
- 042670 HD Hyundai Infracore: delisted in the 2026 merger into HD CE, so the series is incomplete (226 of 265 weeks).
- 034020 Doosan Enerbility: a different industry.

The median is reported with and without HD CE.

## 2. Beta estimation

- Source: KRX Open API (`sto/stk_bydd_trd`, `sto/ksq_bydd_trd`, `idx/kospi_dd_trd`). Closing prices are unadjusted.
- Sample: weekly (Friday or the prior trading day) observations from 2021-10-01 to 2026-10-23, 265 weeks.
- Returns are log returns. OLS of stock on the KOSPI index (KOSDAQ was also run as a diagnostic).
- Two windows:
  - 2y weekly: the last 104 returns.
  - 5y monthly: the last observation of each month, 60 returns.
- Corporate actions: share-count jumps were checked. Rights or merger issuance appears at 017550 (2023-09), 267270 (2026-01) and 010240 (2026-01). There were no proportional price drops, so no split adjustment was needed. A small rights-issue bias at 017550 is possible.

| Ticker | β 2y wk (se, R²) | β 5y mo (se, R²) | β vs KOSDAQ 5y mo | Ann. vol 5y |
|---|---|---|---|---|
| 017550 | 0.451 (0.152, 0.079) | 0.582 (0.190, 0.140) | 1.070 | 49.7% |
| 317850 | 0.195 (0.148, 0.017) | 0.065 (0.222, 0.001) | 0.417 | 54.0% |
| 041440 | 0.332 (0.131, 0.059) | 0.258 (0.160, 0.043) | 0.538 | 39.8% |
| 036890 | 0.331 (0.141, 0.051) | 0.476 (0.168, 0.122) | 0.763 | 43.6% |
| 010240 | 0.099 (0.057, 0.029) | 0.330 (0.118, 0.118) | 0.503 | 30.6% |
| 267270 | 0.431 (0.173, 0.058) | 0.649 (0.216, 0.135) | 0.942 | 56.4% |

**Method warning.** Every R² is ≤ 0.14 against KOSPI. Several betas are not significantly different from zero (317850, 041440 2y). These are small, thinly traded names, and KOSPI is heavily concentrated in large caps (the index stood at 5,550 on 2026-10-23). Raw KOSPI betas are therefore biased low as a measure of systematic risk. Under the statistical-hop-only rule, these regressions support a **low-confidence** grade only. Two adjustments are shown:
- the Blume adjustment, βadj = 0.67·β + 0.33;
- an external cross-check: Damodaran, Machinery, Jan-2026, βU = 0.87 (0.89 cash-corrected), 105 US firms, <https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/Betas.html>.

### Unlevering (Hamada: βU = βL / (1 + (1−t)·D/E))

- D is gross interest-bearing debt plus lease liabilities, from DART 2026 H1 consolidated BS (`fnlttSinglAcntAll`, reprt 11012, CFS).
- E is the KRX market cap on 2026-10-23.
- t is the statutory marginal rate including local income tax: 22.0% for peers with taxable income of KRW 0.2bn to 20bn, 27.5% for HD CE.

| Ticker | Debt (KRW bn) | D/E | t | βU 5y mo raw | βU 5y mo Blume | βU 2y wk Blume |
|---|---|---|---|---|---|---|
| 017550 | 54.6 | 0.506 | 22.0% | 0.417 | 0.516 | 0.453 |
| 317850 | 11.3 | 0.206 | 22.0% | 0.056 | 0.322 | 0.397 |
| 041440 | 81.0 | 0.744 | 22.0% | 0.163 | 0.318 | 0.350 |
| 036890 | 102.5 | 0.507 | 22.0% | 0.341 | 0.465 | 0.395 |
| 010240 | 1.4 | 0.024 | 22.0% | 0.324 | 0.541 | 0.389 |
| 267270 | 1,836.8 (upper bound) | 0.433 | 27.5% | 0.494 | 0.582 | 0.471 |
| **Median** | | | | **0.333** | **0.491** (ex-HD 0.516) | **0.396** |

- The 2y weekly raw median βU is 0.224.
- HD CE debt is an **upper bound**. Its XBRL BS reports borrowings only inside "other current / non-current financial liabilities" (977.6 + 727.6bn, which likely includes payables), plus 131.6bn of leases.

### Relevering (`resolveReleveredBeta`: βL* = βU·(1 + (1−t)·D/E_target), t = 22%)

| βU choice | D/E 0.25 | D/E 0.50 | D/E 0.75 |
|---|---|---|---|
| 0.333 (local raw) | 0.398 | 0.463 | 0.528 |
| **0.491 (local Blume, base)** | 0.587 | **0.682** | 0.778 |
| 0.89 (Damodaran global machinery, cash-corrected) | 1.064 | 1.237 | 1.411 |

## 3. Other inputs

| Key | Value | Source / date | Judgement needed? |
|---|---|---|---|
| Risk-free, 10y KTB (`wacc.risk_free`) | **4.108%** | ECOS 817Y002 item 010210000, 2026-10-28. 3m avg 4.323%, 1y avg 3.849%. | Yes: spot vs average. Spot is used. |
| 3y KTB (for the Kd build) | 3.799% | ECOS 817Y002 item 010200000, 2026-10-28 | No |
| Corp AA- 3y | 4.481% (spread 0.68%p) | ECOS 817Y002 item 010300000, 2026-10-28 | No |
| Corp BBB- 3y | 10.300% (spread 6.50%p) | ECOS 817Y002 item 010320000, 2026-10-28 | No |
| MRP (`wacc.erp`) | Range **4.87% to 7.0%**, base **5.5%** | Low end: Damodaran Korea total ERP 4.87% (mature 4.23% + CRP 0.64%, Aa2), updated 2026-01-05, <https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/ctryprem.html>. High end and base: KR practitioner convention, *not verified in this session*. | **Yes** |
| Size premium (`wacc.size_premium`) | 0% base, +1.0% high case | Judgement. The promoter's market cap is about KRW 108bn (micro-cap). No published KR size-premium source was fetched. | **Yes** |
| Country premium | Not added separately | The cash flows are EU-based. A KRW-denominated WACC already embeds the KR CRP through the ERP. | **Yes**: see the currency note |
| Kd (`wacc.debt_spread`) | Base **+1.5%p** over the 3y KTB (Kd 5.30%). Range +0.7%p (AA- level) to +2.5%p. | Judgement. The promoter's credit rating and its actual borrowing rate were *not* retrieved. | **Yes**. Prefer the promoter's actual loan rate from the DART notes if available. |
| Tax (`wacc.tax_rate`) | **22.0%** | Corporate Tax Act Art. 55(1) (law.go.kr MST 280349, effective 2026-07-01): 20% on income from KRW 0.2bn to 20bn, then 22% and 25%. The local income tax add-on (×1.1) is *not verified via k-law*. Use 24.2% if the promoter's taxable income exceeds KRW 20bn. | Light |
| Target D/E (`wacc.target_de`) | Options 0 / 0.25 / **0.50** / 0.75 | The promoter's current market D/E is 0.506. The peer median is about 0.5. | **Yes** (financing policy; financing-agent) |

## 4. Results

Formulas:
- Ke = Rf + βL*·MRP (+ size premium)
- Kd = Rf3y + spread
- WACC = E/V·Ke + D/V·Kd·(1−t)

| Case | βU | MRP | D/E | Spread | Size prem. | βL* | Ke | Kd | **WACC** |
|---|---|---|---|---|---|---|---|---|---|
| Low | 0.333 | 4.87% | 0.50 | 0.7% | 0 | 0.462 | 6.36% | 4.50% | **5.41%** |
| **Base A (local evidence)** | 0.491 | 5.5% | 0.50 | 1.5% | 0 | 0.682 | 7.86% | 5.30% | **6.62%** |
| Base B (global machinery beta) | 0.89 | 5.5% | 0.50 | 1.5% | 0 | 1.237 | 10.91% | 5.30% | **8.65%** |
| High | 0.89 | 7.0% | 0.50 | 2.5% | +1.0% | 1.237 | 13.77% | 6.30% | **10.82%** |

**Method view (not a deal judgement).** Base A rests on regressions with R² ≤ 0.14, so its beta is probably understated. Base B uses a US-listed reference class. The defensible draft range is **about 6.6% to 8.7%**, with 5.4% and 10.8% as the outer bounds. Choosing between A and B is the main judgement call for the owner.

### Sensitivity: WACC by MRP × target D/E (βU 0.491, spread 1.5%p, t 22%)

| MRP \ D/E | 0.00 | 0.25 | 0.50 | 0.75 | 1.00 |
|---|---|---|---|---|---|
| 4.87% | 6.50% | 6.40% | 6.33% | 6.28% | 6.25% |
| 5.50% | 6.81% | 6.69% | **6.62%** | 6.56% | 6.52% |
| 6.00% | 7.05% | 6.93% | 6.84% | 6.79% | 6.74% |
| 7.00% | 7.54% | 7.40% | 7.30% | 7.23% | 7.18% |

### Sensitivity: WACC by βU × MRP (D/E 0.50, spread 1.5%p)

| βU \ MRP | 4.87% | 5.50% | 6.00% | 7.00% |
|---|---|---|---|---|
| 0.333 | 5.62% | 5.81% | 5.97% | 6.27% |
| 0.491 | 6.33% | 6.62% | 6.84% | 7.30% |
| 0.890 | 8.13% | 8.65% | 9.06% | 9.89% |

βU moves WACC far more than MRP or D/E does. The beta choice is the weakest methodological link.

## 5. Hurdle IRR options (company policy, owner decides)

| Option | Rule | On Base A 6.62% | On Base B 8.65% | Rationale |
|---|---|---|---|---|
| H1 | WACC + 2%p | 8.6% | 10.7% | Minimal spread for a related-business extension using existing brand and channels |
| H2 | WACC + 3 to 4%p | 9.6 to 10.6% | 11.7 to 12.7% | Greenfield execution risk in a new region (CE certification, NL key-account build, parts logistics are open capability gaps in the charter) plus the estimation error in beta |
| H3 | Fixed group floor, e.g. 10% or 12% | 10% / 12% | 10% / 12% | Use this if the group has a standing hurdle policy. It was *not* found in the DB. |

## 6. Values to enter in the WACC screen (CAPM-component mode) — Base A shown; Base B differs only in `wacc.beta_unlevered`

| Key | Value | kind | Source label / anchor | as_of |
|---|---|---|---|---|
| `wacc.risk_free` | 0.04108 | live | ECOS 817Y002/010210000 10y KTB | 2026-10-28 |
| `wacc.erp` | 0.055 | user | Judgement. Range 4.87% (Damodaran KR, pages.stern.nyu.edu ctryprem) to 7%. | 2026-10-28 |
| `wacc.size_premium` | 0 (or 0.01) | user | Judgement | 2026-10-28 |
| `wacc.beta_unlevered` | 0.491 (Base B: 0.89) | derived | Peer median, KRX 5y monthly vs KOSPI, Blume-adjusted, Hamada (Base B: Damodaran Machinery Jan-2026) | 2026-10-23 |
| `wacc.beta_r2` | 0.14 (max peer; median ≈ 0.12) | derived | KRX OLS | 2026-10-23 |
| `wacc.target_de` | 0.50 | user | Judgement. The promoter's current D/E is 0.506. | 2026-10-28 |
| `wacc.observed_de` | 0.506 | derived | Promoter: DART 2026H1 CFS debt / KRX market cap | 2026-10-23 |
| `wacc.tax_rate` | 0.22 | user | Corporate Tax Act Art. 55 (20%) + local income tax | 2026-10-28 |
| `wacc.debt_spread` | 0.015 | user | Judgement. ECOS AA- spread is 0.68%p, BBB- is 6.50%p. | 2026-10-28 |
| `wacc` (confirmed scalar) | 0.0662 (Base B: 0.0865) | user | Confirmed by the owner in the screen | date of confirmation |
| `hurdle_irr` | Owner's choice from §5 | user | Company policy | date of confirmation |
| WACC subject (`md_project.wacc_subject`) | `promoter` (track default) | — | Rationale required. It is self-execution of the promoter's existing business. Note: establishment_mode is `new_entity`; if the NL entity is ring-fenced with its own financing, use `project_newco`. | — |

**Rf / Kd interaction.** The screen derives Kd = Rf + spread using the same `wacc.risk_free` (10y, 4.108%). This draft computed Kd from the 3y KTB (3.799%). Entering `wacc.debt_spread` 0.015 in the screen therefore gives Kd 5.61%, not 5.30%. That raises Base A WACC by about +0.08%p (≈6.70%). To match the draft exactly, enter `wacc.cost_of_debt` = 0.0530 instead of the spread.

## 7. Could not verify

1. **Beta reliability.** All peer R² are ≤ 0.14 and several betas are not significant. The local βU is statistically weak. The Damodaran figure is a US reference class, not Korean.
2. Unadjusted KRX closes. Dividends are excluded from returns, and the small rights issue at 017550 (2023-09) is not adjusted.
3. HD CE interest-bearing debt. XBRL does not separate borrowings from other financial liabilities, so an upper bound was used. The median is barely affected (0.491 vs 0.516 ex-HD).
4. KR practitioner MRP (the 6 to 7% band) and the 5.5% base: no primary source was fetched in this session.
5. Size premium: no KR source.
6. The promoter's credit rating and actual borrowing rate: not retrieved. The spread is a judgement.
7. Local income tax add-on (Local Tax Act): not checked via k-law. Only Corporate Tax Act Art. 55 was checked.
8. **Currency.** The cash flows are EU (EUR) sales, but the model is in KRW millions. A KRW WACC is consistent only if the EUR flows are converted at forward rates that reflect the KRW/EUR inflation differential. That was not checked.
9. Group hurdle policy: none found in the DB.
10. Business-case scale defect (revenue 0.000405 KRW M on model `01M55EHMRAXQANPP34AVG4D1P2`): out of scope here, flagged to PM.
11. The KOSPI-concentration bias on betas is a qualitative concern. It was not quantified.

## 8. Reproducibility

- Scripts in `/tmp/wacc-dse4pw/` (outside the repo; not evidence-grade, since there is no run row):
  - `fetch.ts`: KRX weekly pull
  - `dart.ts`
  - `beta.ts`
  - `wacc.ts`
- Raw snapshots: `weekly.json`, `dart.json`, `beta.json`.
- The OLS is deterministic. There is no random seed, because no simulation was run.
- Once the owner confirms, the WACC session run row becomes the ADR-0005 evidence of record.
