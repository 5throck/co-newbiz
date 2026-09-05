---
lang: en
---

# Hydraulic Breaker Global Market — Driver Analysis & Regional/Segment Matrix (2026)

> **Status**: Standalone market-intelligence artifact, produced outside any formal project run
> (`co-newbiz` backend was unreachable at time of authoring — MCP `list_projects` / `set_assumption`
> calls failed with a connection error). This file exists so the estimate, its methodology, and its
> sources survive independently and can be re-ingested into the formal `assumption` registry
> (`kind='assumed'`, `db/lib/assumption.ts`, FR-DATA-07) once a real project `run_id` exists.
> **Confidence**: Yellow (capped) — see §6 Chain Grading.
> **Author**: Claude (session-generated), reviewed by: *(pending human review — see design v1.0 non-negotiable boundary #2, agent output is proposed analysis, not an approved figure)*
> **Last updated**: 2026-08-25

---

## 1. Purpose and Scope

Estimate the global hydraulic breaker (유압브레이커) market's trajectory 2026–2030, decomposed by
region and end-use segment, using a proxy-chain methodology (`skills/proxy-industry-chain`) anchored
on the construction industry as the upstream driver, cross-checked against direct 1st-party market
data where available.

## 2. Methodology

### 2.1 Proxy chain structure

`Global construction market (macro) → Excavator/construction-equipment (CE) unit sales →
Excavator attachment market → Hydraulic breaker market`

Per `skills/proxy-industry-chain`, all three hops are **statistical** (regression-derived, not fixed
engineering constants), so the chain grade is capped at **B**, which in turn caps the RAG
data-confidence dimension for any downstream conclusion at **Yellow** (design v1.0 non-negotiable
boundary #4: a multi-hop proxy estimate cannot reach Green regardless of financial attractiveness).

### 2.2 Driver identification (D1–D6)

Six demand drivers were identified and validated against 2021–2025 realized data before being
projected forward:

| ID | Driver | Historical validation (2021–2025) |
|---|---|---|
| D1 | Global construction/infrastructure investment (real growth) | Directionally correlated but breaker revenue is dampened/lagged relative to D1, not amplified |
| D2 | Construction-equipment (excavator) unit-sales cycle | 3 consecutive down years (2022 −5/6%, 2023 −7%, 2024 −8%) driven almost entirely by China; ex-China volumes held up or grew (+5% in 2024) |
| D3 | Mining/quarrying capex & exploration budgets | Peaked 2022, declined 2023–2025, turning up again in 2026 (top-20 miners +3.8%) |
| D4 | Rental-channel penetration | Structural uptrend (qualitative only — no time series secured) |
| D5 | Aging-equipment replacement / demolition demand | 2021 unit-sales peak implies a replacement wave concentrated 2026–2028 |
| D6 | ASP / price-mix (added in a later pass) | Confirmed as the mechanism that kept breaker *revenue* growing through 2022–2024 despite falling CE *unit* volumes — largest single-year price jump was 2023→2024 (US data) |

### 2.3 Regional differentiation

Four/five regions were found to have structurally different dominant drivers (see §4), so a single
global CAGR was rejected in favor of a bottom-up, region-weighted build.

### 2.4 China separation

China was split out of APAC because (a) it represents roughly 33% of the global CE market on its own
($56–60B of a $172B global CE market, 2025–26) and (b) its cycle is empirically decoupled from the
rest of APAC — China CE unit sales fell 39% (2022) and 38% (2023) while non-China APAC/emerging
markets grew.

### 2.5 Segment mix calibration

Regional construction/mining/other splits were built from qualitative regional structure, then
**calibrated** so the global weighted-average mining share converges on the cross-checked global
figure (35–39% mining share per multiple vendor reports, and independently corroborated — see §5 —
by Epiroc's actual FY2025 result showing mining demand strong vs. a weak attachments/infrastructure
market). A second calibration pass shifted global construction −2pp / mining +2pp, and North America's
mix specifically (construction −8pp / other +8pp) based on Epiroc's 2024 Stanley Infrastructure
acquisition (expansion into US specialty attachments).

### 2.6 Segment-specific CAGR differentiation

Construction-segment CAGR = region's macro CAGR as-is (D1-sensitive). Mining-segment CAGR = widened
band, skewed to a higher upside (D3/commodity-cycle sensitive). Other-segment CAGR = generally the
most stable (D5-sensitive), **except Europe**, which carries a regulatory-premium upside (EU Stage V
emissions deadline forcing replacement) not present elsewhere.

---

## 3. Sources (full citation list, in order of first use)

1. GII Research / The Business Research Company — [Hydraulic Breaker Global Market Report 2026](https://www.giiresearch.com/report/tbrc1932611-hydraulic-breaker-global-market-report.html) — primary consensus figure: $2.18B (2026) → $2.79B (2030), CAGR 6.3%
2. The Business Research Company — [Hydraulic Breaker Market Trends Analysis Report 2026-2030](https://www.thebusinessresearchcompany.com/report/hydraulic-breaker-global-market-report)
3. Custom Market Insights — [Global Hydraulic Breaker Market Size, Share 2025-2034](https://www.custommarketinsights.com/report/hydraulic-breaker-market/) — bullish outlier: $3.83B (2025) → $8.92B (2034)
4. Verified Market Reports — [Rock Breaker Market Size, Growth, Landscape & Forecast 2033](https://www.verifiedmarketreports.com/product/rock-breaker-market/)
5. AECOM Insights — [Global construction prospects 2026](https://insights.aecom.com/insights/article/global-construction-prospects-2026)
6. Market Research Future — [Infrastructure Construction Market Size, Share & Global Forecast 2035](https://www.marketresearchfuture.com/reports/infrastructure-construction-market-16136)
7. GlobalData — [Construction Market Size, Trends & Forecast 2026-2030](https://www.globaldata.com/store/report/construction-market-analysis/)
8. Truecasteng — [Global Excavator Attachments Market Analysis: 2026–2033](https://www.truecasteng.us/global-excavator-attachments-market-analysis-2026-2033/)
9. Coherent Market Insights — [Excavator Attachments Market Size and Forecast, 2026-2033](https://www.coherentmarketinsights.com/industry-reports/excavator-attachments-market)
10. Global Growth Insights — [Excavator Attachments Market Size, Share 2035](https://www.globalgrowthinsights.com/market-reports/excavator-attachments-market-112936)
11. Allied Market Research — [Hydraulic Breaker Market](https://www.alliedmarketresearch.com/hydraulic-breaker-market) — historical anchor: $1,993.9M (2021)
12. S&P Global Market Intelligence — [Capex for 30 biggest-spending miners](https://www.spglobal.com/market-intelligence/en/news-insights/research/capex-for-30-biggest-spending-miners-to-rise-6-2-in-2023), [Top 20 miners' CapEx 2026](https://www.mining-technology.com/analyst-comment/top-20-miners-capex/), [World Exploration Trends](https://www.spglobal.com/market-intelligence/en/news-insights/research/2026/03/world-exploration-trends-2026-what-the-latest-data-says-about-budgets-risk-appetite-and-the-project-pipeline)
13. Off-Highway Research (via Aggregates Business / Construction Briefing / Chris Sleight) — global CE unit-sales single-source series 2019–2025: [Return to normal for global construction equipment sales](https://www.aggbusiness.com/return-normal-global-construction-equipment-sales)
14. Equipment World — [Excavator Sales Trends 2025](https://www.equipmentworld.com/market-pulse/article/15822167/excavator-sales-trends-2025-new-and-used-models) — used-excavator ASP data
15. GMInsights — [Rock Breaker Market Size & Share](https://www.gminsights.com/industry-analysis/rock-breaker-market) — global mining segment share (39%, 2024) and regional mining-demand split (APAC 58%, Australia 16%)
16. Cognitive Market Research — [South America Hydraulic Breaker Market Report](https://www.cognitivemarketresearch.com/regional-analysis/south-america-hydraulic-breaker-market-report), [Middle East and Africa Hydraulic Breaker Market Report](https://www.cognitivemarketresearch.com/regional-analysis/middle-east-and-africa-hydraulic-breaker-market-report)
17. Grand View Research — [Middle East & Africa Mining drills breakers Market outlook](https://www.grandviewresearch.com/horizon/outlook/mining-drills-breakers-market/mea) — MEA = 4.9% of global mining-drills-breakers category
18. Arizton / MarketsandMarkets — [South Africa Heavy Construction Equipment Market](https://www.marketsandmarkets.com/Market-Reports/geography/construction-mining-equipment-market/south-africa)
19. Global Growth Insights — [Hydraulic Attachments for Demolition Market](https://www.globalgrowthinsights.com/market-reports/hydraulic-attachments-for-demolition-market-102078) — global cross-check: construction/renovation 42%, mining 35%
20. Mordor Intelligence — [Europe Residential Construction Market](https://www.mordorintelligence.com/industry-reports/europe-residential-construction-market) (renovation = 54.1% of 2025 residential construction), [Europe Construction and Demolition Waste Management Market](https://www.mordorintelligence.com/industry-reports/europe-construction-and-demolition-waste-management-market)
21. Persistence Market Research — [Hydraulic Hammer Market](https://www.persistencemarketresearch.com/market-research/hydraulic-hammer-market.asp) — CR4 concentration (Epiroc, Sandvik, Caterpillar, Atlas Copco ≈ 15–20% combined share)
22. **Epiroc AB — [Annual and Sustainability Report 2025](https://www.epirocgroup.com/content/dam/epiroc/corporate/documents/quarterly-results-presentations-/2025-yr/Epiroc%20Annual%20and%20Sustainability%20Report_2025.pdf)** and [Q3 2025 interim report](https://www.epirocgroup.com/en/media/corporate-press-releases/2025/20251029-epiroc-interim-report-q3-2025) — **primary-source (1st-party filed) evidence**: FY2025 revenue SEK 62.0bn (−3% nominal / +2% organic); mining demand strong (copper, gold) vs. weak infrastructure/attachments demand; largest markets = USA, Western Europe, China, India; Stanley Infrastructure acquisition (2024, ~SEK 4.7bn revenue at closing) expanded US specialty-attachments presence
23. Market Reports World — [Rock Breaker Market Report](https://www.marketreportsworld.com/market-reports/rock-breaker-market-14715691) — APAC 2023 unit volumes: China ~37,000 units, India ~19,000 units of 124,000 regional total

---

## 4. Final Region × Segment Matrix

### 4.1 Regional weights and segment mix (post-calibration)

| Region | Weight | Construction | Mining | Other (demolition/renovation) | Key adjustment applied |
|---|---:|---:|---:|---:|---|
| China | 26% | 46% | 36% | 18% | Global −2pp construction / +2pp mining (source #22) |
| APAC ex-China | 14% | 29% | 57% | 14% | Same global shift; mining weighted by Australia (source #15) |
| North America | 18% | 28% | 42% | 30% | Construction −8pp / Other +8pp (source #22, Stanley Infrastructure) |
| Europe | 24% | 35% | 15% | 50% | Same global shift; "other" carries a regulatory (EU Stage V) upside premium not applied elsewhere |
| MEA | 8% | 45% | 42% | 13% | Weight reduced from an earlier 10% assumption after source #17 showed MEA = only 4.9% of the global mining-drills-breakers category |
| Latin America / RoW | 9% | 23% | 67% | 10% | Highest mining concentration (Chile/Peru copper, source #12) |

### 4.2 2026 baseline ($B), by region × segment

Baseline total: **$2.00B (2026)**, rounded consensus of source #1/#2 ($2.18B) and source #3 ($3.83B outlier excluded from the anchor).

| Region | Construction | Mining | Other | Total |
|---|---:|---:|---:|---:|
| China | 0.239 | 0.187 | 0.094 | 0.520 |
| APAC ex-China | 0.081 | 0.160 | 0.039 | 0.280 |
| North America | 0.101 | 0.151 | 0.108 | 0.360 |
| Europe | 0.168 | 0.072 | 0.240 | 0.480 |
| MEA | 0.072 | 0.067 | 0.021 | 0.160 |
| Latin America / RoW | 0.041 | 0.121 | 0.018 | 0.180 |
| **Global** | **0.702 (35.1%)** | **0.758 (37.9%)** | **0.520 (26.0%)** | **1.980** |

### 4.3 Segment-specific CAGR assumptions (base scenario; down/up bands in §4.4)

| Region | Construction | Mining | Other |
|---|---:|---:|---:|
| China | 6% | 5% | 5% |
| APAC ex-China | 7% | 9% | 6% |
| North America | 5% | 6% (band: 2–11%, see §4.5) | 5% |
| Europe | 5% | 4% | 6% (regulatory premium) |
| MEA | 7% | 6% | 5% |
| Latin America / RoW | 4% | 8% | 4% |

### 4.4 2030 projection, base scenario ($B)

| Region | Construction | Mining | Other | Total |
|---|---:|---:|---:|---:|
| China | 0.302 | 0.227 | 0.114 | 0.643 |
| APAC ex-China | 0.106 | 0.226 | 0.049 | 0.381 |
| North America | 0.123 | 0.191 | 0.131 | 0.445 |
| Europe | 0.204 | 0.084 | 0.303 | 0.591 |
| MEA | 0.094 | 0.085 | 0.026 | 0.205 |
| Latin America / RoW | 0.048 | 0.165 | 0.021 | 0.234 |
| **Global** | **0.877 (35.1%)** | **0.977 (39.1%)** | **0.644 (25.8%)** | **2.499** |

Implied global CAGR (2026→2030, base scenario): **5.7%** (bottom-up), vs. 6.3% top-down consensus
(source #1) — within tolerance, used as an internal consistency check, not as independent
confirmation (both ultimately trace to the same class of vendor reports for the anchor year).

### 4.5 Scenario bands (global roll-up only; region-level bands in prior session turns, not repeated here)

| Scenario | Global CAGR (2026–2030) | 2030 total |
|---|---:|---:|
| Downside | ~2.8% | $2.23B |
| Base | ~5.7–5.9% | $2.50–2.55B |
| Upside | ~8.3–9.2% | $2.74–2.84B |

North America mining specifically carries the widest single-segment uncertainty band in the whole
matrix (2%–11% CAGR) because two source classes disagree on whether mining or construction is the
region's largest end-use segment (§5.2).

---

## 5. Cross-Validation Against 1st-Party Company Sources

### 5.1 What could NOT be validated

No top-10 manufacturer (Epiroc, Sandvik/Rammer, Komatsu/Montabert, Caterpillar, HD Hyundai/Develon,
Furukawa, NPK, Soosan, Indeco, Doosan Bobcat) publicly discloses hydraulic-breaker-specific revenue
broken out by both region AND end-use segment. The category is bundled inside larger reporting units
(Epiroc's "Tools & Attachments" business area; Komatsu's Montabert brand; HD Hyundai's consolidated
construction-equipment revenue). This is a **structural limit of public disclosure**, not a search
gap — a full bottom-up reconciliation from 10-K/annual-report level data is not achievable for this
product category without a paid analyst database (Off-Highway Research, KHL Yellow Table, S&P Global
Market Intelligence).

### 5.2 What WAS validated (source #22, Epiroc FY2025, primary filed data)

| Claim in this matrix | Epiroc FY2025 confirms? |
|---|---|
| Mining (D3) outgrew construction (D1) in 2025 | **Yes** — explicit: "demand from mining customers remained strong, driven by copper and gold, while demand from infrastructure customers remained at a low level, mainly explained by a weak market for attachments" |
| China / Western Europe / North America are the top-weighted regions | **Directionally yes** — Epiroc names USA, Western Europe, China, India as its largest markets (does not confirm relative ranking or %) |
| MEA / Latin America are minor regions | **Yes** — absent from Epiroc's "largest markets" list |
| North America "other" (specialty demolition attachments) segment is a real, growing pocket | **Yes** — Stanley Infrastructure acquisition (2024) was explicitly to expand US specialty-attachments presence |

---

## 6. Known Limitations (carried forward, not resolved)

1. Regional weights are proxied from the broader construction-equipment market (no breaker-specific regional revenue split exists in public sources).
2. Segment mix (construction/mining/other) per region is a qualitative allocation calibrated to match a global cross-check figure — it is not a bottom-up sum of sourced regional segment data.
3. The North America mining band (2–11% CAGR) reflects genuine source disagreement, not modeling uncertainty alone — should be the first item resolved if a paid data source becomes available.
4. Europe's regulatory-premium adjustment (EU Stage V) is a judgmental calibration, not tied to a specific compliance-deadline calendar.
5. China's 2025–2026 rebound (excavator sales +17% to +27% YoY) is a low-base rebound from the 2022–2023 collapse and should NOT be extrapolated linearly — the base-case CAGR (6%) already assumes normalization, not continuation of the current rebound rate.
6. Chain grade is capped at B (3 statistical hops) — per `skills/proxy-industry-chain` and design v1.0 boundary #4, no conclusion drawn from this matrix should be represented as Green-confidence.

## 7. Next Steps for Formal Registration

Once a `co-newbiz` project run exists for a hydraulic-breaker-related deal or market screen, this
file's §4.2–4.4 figures should be re-entered via `set_assumption` (`kind='assumed'`, with
`rationale` pointing back to this file's section number) — one row per region×segment×scenario
combination, per the design's registry-backed evidence-plane contract (`docs/evidence/README.md`).
