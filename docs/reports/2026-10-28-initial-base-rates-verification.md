# Verification: Initial Public Base Rates (2026-10-28)

- **Subject**: `data/base-rates/2026-10-28-initial-public.json` (29 rows) and `docs/reports/2026-10-28-initial-base-rates.md`, both by `risk-officer`
- **Verifier**: `industry-lead`, acting as the independent cross-domain (AI 2nd) reviewer
- **Method**: I downloaded both arXiv abstract pages and PDFs myself. I extracted the text with `pdftotext -layout` and compared each row with the source table. I did not rely on the author's report.
- **Status**: decision support only. No PASS stamp. Import is a human decision.

## 1. Source identity

| Source | Check | Result |
|---|---|---|
| S1, arXiv:2606.15757 | Abstract page title: "Towards a Theory of Modular Natives: Explaining Superscaling, China's Greatest Innovation Yet". Authors: Flyvbjerg, Budzier, Christodoulou. Posted 2026-06-14. The PDF footer reads "draft 4.2". | Verified |
| S1 | Table 1 covers **23** project types with N = 11,011. Real terms, baselined at FID. "Tail" is the % of projects with overrun > 1.5. | Verified. "12 types" in the brief is the author's selection, not the paper's scope. The report says so correctly (it lists the 11 excluded types). |
| S2, arXiv:1303.6654 | Title: "How (In)accurate Are Demand Forecasts in Public Works Projects? The Case of Transportation". Authors: Flyvbjerg, Holm (Skamris), Buhl. Posted to arXiv 2013-03-20. | Verified |
| S2 | The arXiv PDF is the **pre-publication "DRAFT 9.0"** manuscript, marked "please do not quote" and sent to referees. It is not the published JAPA 71(2) article. | Could not verify that the published JAPA version has the same Table 1 values. The citation's "(2005) JAPA 71(2)" is accurate as bibliography, but the numbers were checked against the draft. |

## 2. Row-by-row verification

Unit conventions: the JSON stores S1 percentages as proportions (2.44% → 0.0244) and S2 percentages as decimals (-51.4% → -0.514). These conversions are correct.

| # | reference_class_key | metric | n (JSON / source) | value (JSON / source) | Result |
|---|---|---|---|---|---|
| 1 | capex_overrun.solar_power | ratio_mean | 41 / 41 | 1.01 / 1.01 | Verified |
| 2 | capex_overrun.solar_power | share_gt_1_5 | 41 / 41 | 0.0244 / 2.44% | Verified |
| 3 | electricity_transmission | ratio_mean | 50 / 50 | 1.08 / 1.08 | Verified |
| 4 | electricity_transmission | share_gt_1_5 | 50 / 50 | 0.04 / 4.00% | Verified |
| 5 | wind_power | ratio_mean | 84 / 84 | 1.12 / 1.12 | Verified |
| 6 | wind_power | share_gt_1_5 | 84 / 84 | 0.0714 / 7.14% | Verified |
| 7 | pipelines | ratio_mean | 437 / 437 | 1.14 / 1.14 | Verified |
| 8 | pipelines | share_gt_1_5 | 437 / 437 | 0.0961 / 9.61% | Verified |
| 9 | fossil_thermal_power | ratio_mean | 136 / 136 | 1.18 / 1.18 | Verified |
| 10 | fossil_thermal_power | share_gt_1_5 | 136 / 136 | 0.1544 / 15.44% | Verified |
| 11 | water | ratio_mean | 265 / 265 | 1.20 / 1.20 | Verified |
| 12 | water | share_gt_1_5 | 265 / 265 | 0.1321 / 13.21% | Verified |
| 13 | mining | ratio_mean | 886 / 886 | 1.27 / 1.27 | Verified |
| 14 | mining | share_gt_1_5 | 886 / 886 | 0.1693 / 16.93% | Verified |
| 15 | oil_and_gas | ratio_mean | 116 / 116 | 1.31 / 1.31 | Verified |
| 16 | oil_and_gas | share_gt_1_5 | 116 / 116 | 0.1983 / 19.83% | Verified |
| 17 | buildings | ratio_mean | 186 / 186 | 1.58 / 1.58 | Verified |
| 18 | buildings | share_gt_1_5 | 186 / 186 | 0.2849 / 28.49% | Verified |
| 19 | it | ratio_mean | 5360 / 5360 | 1.73 / 1.73 | Verified |
| 20 | it | share_gt_1_5 | 5360 / 5360 | 0.1826 / 18.26% | Verified |
| 21 | hydroelectric_dams | ratio_mean | 300 / 300 | 1.75 / 1.75 | Verified |
| 22 | hydroelectric_dams | share_gt_1_5 | 300 / 300 | 0.3733 / 37.33% | Verified |
| 23 | nuclear_power | ratio_mean | 196 / 196 | 2.20 / 2.20 | Verified |
| 24 | nuclear_power | share_gt_1_5 | 196 / 196 | 0.5459 / 54.59% | Verified |
| 25 | demand_forecast.transport.rail | forecast_inaccuracy_mean | 25 / 25 (27 minus 2 outliers) | -0.514 / -51.4% (sd 28.1) | Verified (draft text) |
| 26 | demand_forecast.transport.rail | share_actual_below_forecast_by_gt_20pct | 25 / 25 | 0.84 / 84% | Verified. See note A. |
| 27 | demand_forecast.transport.road | forecast_inaccuracy_mean | 183 / 183 | +0.095 / +9.5% (sd 44.3) | Verified (draft text) |
| 28 | demand_forecast.transport.road | share_abs_inaccuracy_gt_20pct | 183 / 183 | 0.50 / 50% | Verified |
| 29 | demand_forecast.transport.road | share_abs_inaccuracy_gt_40pct | 183 / 183 | 0.25 / 25% | Verified |

**Totals: 29 verified, 0 value mismatches, 0 rows unverifiable against the arXiv text.** Rows 25 to 29 carry the residual uncertainty about the published version (section 1).

Definition and sign checks:
- **S1.** Overrun = actual / estimated cost, in real terms (inflation excluded), baselined at FID. The JSON notes say exactly this. The paper calls the figures conservative, and the notes record that. Each ratio_mean row stores the mean; Table 1 gives no median.
- **S2.** Inaccuracy = (actual − forecast) / forecast, for the first operating year, with the forecast taken at the decision to build. Negative means actual traffic was below forecast. The JSON sign convention matches.
- **Note A.** Table 1 labels its 84% as "inaccuracies larger than ±20%". The JSON metric says "below forecast". The paper's body text supports the narrower label: 84% have actual traffic more than 20% below forecast, and none are more than 20% above. The label is correct.
- **Rail n.** Excluding the two outliers is the paper's own primary presentation. The JSON note records the version with the outliers included (−39.5%, 85%, n = 27). Correct.
- **Road ±20% split.** The paper gives 21.3% below and 28.4% above. The JSON does not record this split. Adding it to the note is optional.

## 3. Semantics: `p50` holding a mean

Facts:
- `db/lib/base-rate.ts`: `p50` is the only required numeric field. The validator enforces only p10 ≤ p50 ≤ p90 and nothing about what the number means.
- `docs/architecture/base-rate-import-format.md` does not define `p50` as a median. Even so, the name means "median" to every reader by convention.
- The `_mean` suffix in the metric name and the note on each row already disclose the mean.

The risk: a consumer that shows the column header ("P50") or reads `p50` as a median would silently mislead. Right-skewed overrun data (S1 says the tails are fat) has mean > median, so a mean shown as P50 overstates the typical overrun. For base-rate challenges, that error is conservative, but it is still wrong. All 12 capex and both demand mean rows are affected. The 15 share rows are unaffected, because a proportion is a single value.

**Recommendation: keep with a note**, under three conditions:
1. Amend `base-rate-import-format.md` to say that `p50` holds the row's central statistic and that the metric suffix (`_mean`, `_median`) states which one it is.
2. Any UI or skill that shows base rates must show the `metric` name beside the value, not a bare "P50".
3. Keep the `_mean` suffix as a required convention.

Renaming the column needs a schema change and an ADR, which is out of proportion here. Dropping the rows loses the only capex reference classes we have. If the owner will not accept condition 2, drop the 14 mean rows and keep the 15 share rows.

## 4. Fitness as reference classes for this system

This system screens industrial greenfield plants and M&A in Korea and overseas. The industry profiles are KSIC-anchored manufacturing. No source here covers manufacturing plants or M&A directly. Every row is a **proxy**, and the data-confidence rule caps any conclusion that rests on it.

| Rows | Fitness | Reasoning |
|---|---|---|
| fossil_thermal_power, oil_and_gas, mining, pipelines, water | **Usable proxy** (closest) | Heavy industrial capex with process plant, civil works and EPC contracting. These are the nearest analogue to a greenfield process or manufacturing plant. |
| solar_power, wind_power, electricity_transmission | **Usable with caution** | Highly modular and repeatable, so they understate the risk of a bespoke first-of-kind plant. Use them only for modular or repeat-build plants, such as battery or solar module lines. |
| buildings | **Usable, narrow** | Applies to the factory building and civil scope, not the whole plant. |
| it | **Exclude from plant capex**; keep for system or digital scope | The project type differs. Its n = 5,360 dominates any pooled average. |
| hydroelectric_dams, nuclear_power | **Exclude** as plant proxies | Bespoke mega-projects whose regulatory regimes have no counterpart in this pipeline. They would inflate a challenge baseline without justification. Store them as context only, if at all. |
| rail demand (rows 25, 26) | **Weak proxy** for a new, unproven demand stream | The forecast optimism mechanism carries over, but the sector does not: public transport ridership, 1969 to 1998. |
| road demand (rows 27 to 29) | **Weak proxy** for extending an existing market | Use it for dispersion (±20% and ±40% shares) only, not for direction. |
| M&A | **No coverage** | No row is a reference class for M&A synergy or premium outcomes. The report itself records that it could not build any M&A row. I register this as a gap. |

A greenfield plant row also needs a regional and KSIC qualifier. S1 is a global sample from 126 countries, not split by country. Whether it applies to Korea is UNKNOWN.

## 5. What I could not verify

1. Whether the published JAPA 71(2) (2005) article's Table 1 matches the arXiv "DRAFT 9.0" values (rows 25 to 29). The published version sits behind a paywall and I did not open it.
2. S1 is a non-peer-reviewed draft (4.2). Its values may change in later drafts or on publication.
3. S1 does not report medians or p10/p90. The distribution shape behind each mean cannot be checked from Table 1.
4. S1 does not break the data down by country or by public vs private projects, so its fit to Korean projects is UNKNOWN.
5. I did not re-check the report's list of sources it considered and rejected (for example, NBER w10200).

## 6. Verdict (proposal)

**Import after correction.** No values need correcting. The corrections are about metadata and use:
- Add the draft/version caveat to the S2 `note` field ("values checked against the arXiv pre-print draft 9.0").
- Apply the `p50` documentation and display conditions in section 3.
- Exclude rows 21 to 24 (hydroelectric dams, nuclear power) from plant use. Flag row 19 (IT) as non-plant. Either leave these rows out or tag them context-only.
