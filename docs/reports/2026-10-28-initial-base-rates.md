# Initial base rates from public studies (2026-10-28)

Author: risk-officer (methods per quant-methodologist). Status: **proposal**.

These rows are proposals only. They enter the `base_rate` table only when the owner runs
`bun scripts/co-newbiz/import-base-rates.ts --file data/base-rates/2026-10-28-initial-public.json --actor <app_user id>`.
The ADR-0187 D2 thresholds are a separate decision. This file does not set or imply any threshold.

## Method

1. Searched for public, preferably peer-reviewed, reference-class studies for each priority class in the brief.
2. A row was written only when the source document was actually opened and the figure and sample size were read in its text or tables. PDFs were converted with `pdftotext` and the tables were read directly. No figure comes from memory or from a secondary summary.
3. Provenance: `verified_on` = 2026-10-28, `maintainer` = risk-officer, `evidence_kind` = public_study.
4. **Schema convention (read this before using the rows).** Neither source publishes percentiles. Two kinds of row are therefore used:
   - `*_mean` metrics: `p50` holds the **reported arithmetic mean, not the median**. `p10` and `p90` are null. The note on every such row says this. Cost-overrun distributions are right-skewed (the source fits a Pareto tail), so the mean sits **above** the median. Do not read these rows as medians.
   - `share_*` metrics: `p50` holds a reported point proportion (unit `proportion`). It is not a distribution.
   - Decision (coordinator, 2026-10-28): keep the `_mean` rows. `docs/architecture/base-rate-import-format.md` now states that the metric suffix tells you which statistic `p50` holds, and that consumers must show the metric name, never a bare "P50".
5. Validation: dry-run against a temporary database (`/tmp/br/tmp.sqlite`, all 185 migrations applied, temporary app_user `tmp-dryrun`). Ports 7748 and 7749 were not touched. First run (29 rows): `accepted: 29`. After the verification corrections, the file has 23 rows. The re-run on a fresh temporary database gave `accepted: 23, rejected: [], duplicates: 0, dryRun: true`, exit code 0, and `base_rate` stayed at 0 rows.

## Sources

- **S1**: Flyvbjerg, B., Budzier, A. & Christodoulou, M. (2026). *Towards a Theory of Modular Natives: Explaining Superscaling, China's Greatest Innovation Yet*. Working paper, draft 4.2, Oxford / ITU Copenhagen. arXiv:2606.15757. Table 1 covers N = 11,011 projects of 23 types in 126 countries. Cost overrun is actual divided by estimated cost, in real terms, baselined at the final investment decision (FID). **This is a draft working paper and has not been peer-reviewed.** The underlying database is the same one behind *How Big Things Get Done* (2023).
- **S2**: Flyvbjerg, B., Skamris Holm, M. K. & Buhl, S. L. (2005). *How (In)accurate Are Demand Forecasts in Public Works Projects? The Case of Transportation*. Journal of the American Planning Association. arXiv:1303.6654. Peer-reviewed. Covers 210 projects in 14 nations, using Table 1. Values were checked against the arXiv referee draft 9.0, not the published JAPA 71(2) text, and every S2 row's note says so.

## Class: capex overrun by project type (S1, Table 1)

The key is `project.capex_overrun.<type>`. There are two metrics per type: `capex_overrun_ratio_mean` (ratio) and `share_projects_overrun_gt_1_5` (the proportion of projects that came in more than 50% over budget).

| Type | N | Mean overrun (ratio) | Share > 1.5 |
|---|---:|---:|---:|
| solar_power | 41 | 1.01 | 0.0244 |
| electricity_transmission | 50 | 1.08 | 0.0400 |
| wind_power | 84 | 1.12 | 0.0714 |
| pipelines | 437 | 1.14 | 0.0961 |
| fossil_thermal_power | 136 | 1.18 | 0.1544 |
| water | 265 | 1.20 | 0.1321 |
| mining | 886 | 1.27 | 0.1693 |
| oil_and_gas | 116 | 1.31 | 0.1983 |
| buildings | 186 | 1.58 | 0.2849 |

Caveats:
- The FID baseline and real terms understate overrun against an early business case. The authors say so explicitly and call the numbers conservative.
- No class here is a "manufacturing plant". The closest proxies for a greenfield industrial plant are fossil thermal, oil and gas, mining and buildings. Mapping a co-newbiz plant onto one of these is a judgement the deal team must make and state.
- S1 types left out as irrelevant to this pipeline: roads, bridges, tunnels, rail, rail stations, defense, aerospace, dams (other), Olympics, nuclear storage, nuclear decommissioning.

## Class: demand-forecast inaccuracy (S2, Table 1)

Inaccuracy is (actual - forecast) / forecast traffic in the first operating year, with the forecast taken at the decision to build.

| Key | Metric | N | Value | Note |
|---|---|---:|---:|---|
| demand_forecast.transport.rail | forecast_inaccuracy_mean | 25 | -0.514 | Mean, sd 28.1 pp. Two outliers excluded; with them, n = 27 and the mean is -0.395 |
| demand_forecast.transport.rail | share_actual_below_forecast_by_gt_20pct | 25 | 0.84 | 0.85 with the outliers included |
| demand_forecast.transport.road | forecast_inaccuracy_mean | 183 | +0.095 | Mean, sd 44.3 pp |
| demand_forecast.transport.road | share_abs_inaccuracy_gt_20pct | 183 | 0.50 | |
| demand_forecast.transport.road | share_abs_inaccuracy_gt_40pct | 183 | 0.25 | |

Caveat: this is transport infrastructure, a **proxy** for new-market or new-plant volume forecasts. It is not the same reference class. Rail is the closer analogue for a new, unproven demand stream; road is the closer analogue for an extension of an existing market.

## Verification outcome and fitness tiers

industry-lead checked all 29 original rows against both sources and found no value mismatches (`docs/reports/2026-10-28-initial-base-rates-verification.md`). The corrections were applied as follows.

| Tier | Types | Use |
|---|---|---|
| Usable proxy (closest) | fossil_thermal_power, oil_and_gas, mining, pipelines, water | Heavy industrial capex with process plant, civil works and EPC contracting. The nearest analogue to a greenfield plant |
| Usable with caution | solar_power, wind_power, electricity_transmission | Modular and repeatable, so they understate the risk of a bespoke first-of-kind plant. Use them only for modular or repeat-build plants |
| Usable, narrow | buildings | The factory building and civil scope only |
| **Excluded (removed from the import file)** | it (N=5,360, mean 1.73, share >1.5 = 0.1826); hydroelectric_dams (N=300, 1.75, 0.3733); nuclear_power (N=196, 2.20, 0.5459) | Not plant capex proxies for this system. IT is a different project type, and its N would dominate any pooled average. Dams and nuclear are bespoke mega-projects whose regulatory regimes have no counterpart in this pipeline, so they would inflate a challenge baseline without justification. These were the six rows numbered 19–24 in the original file |

The demand-forecast rows (S2) are a transport proxy and fall under **usable with caution**.

## Rejected or unavailable candidates

| Candidate | Reason |
|---|---|
| Merrow, Phillips & Myers (1981), RAND R-2569, pioneer process plants (cost growth and performance shortfall) | Most relevant source for new plants, but the page returned HTTP 403 and could not be opened |
| Flyvbjerg (2014), *What You Should Know About Megaprojects* (arXiv:1409.0003) | Only the abstract was opened. It contains no statistics |
| *How Big Things Get Done* (2023), Appendix A | Seen only through secondary book notes. Superseded by S1, which reads from the same database |
| McKinsey (Christofferson, McNish & Sias, 2004), *Where mergers go wrong*: cost and revenue synergy capture | Fetch timed out twice. It is also a consultancy source. **Gap** |
| BCG (2016), *The Real Deal on M&A, Synergies, and Value* | Seen only in a search snippet, not opened. It is a consultancy source and gives an internal-versus-announced gap, not a realization rate |
| Dealroom blog: "70-85% cost / 25-35% revenue synergy capture" | Secondary blog with no primary citation. Rejected |
| Moeller, Schlingemann & Stulz (2004/2005), NBER w10200 | Abstract opened. It gives aggregate dollar losses (12 cents per dollar, 1998-2001) but no sample size in the abstract and no rate distribution. No row could be built honestly |
| Dutordoir et al. (2014), synergy disclosures | Search snippet only. It covers disclosure frequency, not realization |
| KDI/PIMAC preliminary feasibility post-evaluations: cost and demand deviation | No quantitative post-evaluation statistic was found in the opened pages. KDI pub 18015 is a single-project simulation, not a reference class. **Gap** |
| Schedule overrun, time to commercial operation, ramp-up duration for new plants | No open primary source with a sample size was located in this pass. **Gap** |
| M&A deal success/failure and post-merger value-creation rate | No open, peer-reviewed rate with a sample size was opened. **Gap** |

## Known biases

- **Survivorship and selection.** S1 includes only projects with written records of both estimated and actual cost. Cancelled projects and projects that never reached completion are under-represented, which biases overrun downward. S2 includes only projects that opened.
- **Baseline.** An FID baseline understates overrun compared with the S2/S3 business-case stage, which is where co-newbiz estimates are made.
- **Sector mix.** S1 is dominated by infrastructure, energy and IT (IT is 5,360 of 11,011 projects). Manufacturing plants are absent.
- **Geography.** Both sources are global or Western-heavy. Neither is Korea-specific. Korean reference classes remain a gap.
- **Era.** S2 covers projects completed between 1969 and 1998, so it is old. S1 is mostly 21st-century.
- **Mean versus median.** In skewed distributions the mean exceeds the median. Treating a mean row as the median overstates the typical overrun but understates the tail. Use the `share_*` rows for the tail.
- **Single research group.** Every row comes from Flyvbjerg and co-authors, so there is no independent triangulation yet.
