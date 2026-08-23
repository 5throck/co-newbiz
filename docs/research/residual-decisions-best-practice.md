# Research Report: Best Practice for the Residual Decisions Pack

> **Provenance:** researched 2026-08-24 by four research agents (R1 — JV governance/scorecard; R2 — TRL/MRL gating; R3 — M&A synergy/PMI; R4 — deal shape, calibration corpus, antitrust), as **non-binding decision support** for [`docs/decisions/2026-08-24-residual-decisions-pack.md`](../decisions/2026-08-24-residual-decisions-pack.md). Method: the built-in WebSearch channel was unavailable (Z.ai quota exhausted — HTTP 429, resets 2026-09-01 08:56) and its fallback text is unsourced model knowledge, **excluded from evidence** throughout; the working channels were direct WebFetch of canonical URLs and Brave search HTML (R4). Evidence tiers are marked inline: `[live]` = page fetched this session; `[snippet]` = search-result fragment of a paywalled or blocked page (title/abstract only); `[model-knowledge]` = not live-verified, flagged wherever used. Fetch failures are consolidated in §7. All "research-suggested defaults" below are decision support only: gate approval and investment decisions belong to humans (boundary #2), and nothing here becomes enforcement-active without the user's decision and the reflection PR passing the anti-tamper gate.

---

## Item 1 — (b) JV health-scorecard weights and review cadence

### 1.1 Prior internal coverage

`pmi-jv-lifecycle-best-practice.md` B.1–B.3 already carries the seven dimensions (Ankura/Watermark lineage), the quarterly JV board + annual strategy off-site, the annual strategic asset review (SABIC), and the external governance review every 3 years (BHP); `venture-governance-best-practice.md` A.2 has weighted scoring at SCREENING gates (Cooper 0–10 weighted, ≥60/100); `readiness-gap-best-practice.md` Area 1 carries the balanced-scorecard discipline. The gap this section fills: **weighting methodology and scorecard cadence**.

### 1.2 Findings

- **The dominant JV-governance benchmark scores flat/unweighted; no published JV framework discloses dimension weights.** The Ankura/Watermark JV Governance Index: "We assign the joint venture with one of four ratings (fully meets, mostly meets, somewhat meets, or does not meet) linked to a numeric value. We then roll-up these standard-level scores into dimension-level scores and an overall JV Governance Index score on a scale of 0-10." — no weights published; the instrument's purpose is calibration. `[live]` https://jvalchemist.ankura.com/governance-and-restructuring/calibrating-joint-venture-governance-strength/ , https://corpgov.law.harvard.edu/2020/03/13/joint-venture-governance-index-calibrating-the-strength-of-governance-in-joint-ventures/
- **Portfolio standard set (20 standards / 6 categories)**: the same fully/mostly/somewhat/not-meeting pattern aggregated to a 10-point scale (median 3.2), no weighting stated. `[live]` https://jvalchemist.ankura.com/partnership-portfolios/governing-a-portfolio-of-joint-ventures-how-do-you-measure-up/
- **Escalation is threshold/trigger-based, not composite-based**: formal restructuring triggers "based on defined metrics"; "annual scorecards to track parent performance". `[live]` https://jvalchemist.ankura.com/governance-and-restructuring/why-joint-ventures-fail-and-how-to-prevent-it/
- **The balanced-scorecard origin deliberately refuses aggregation** — Jensen 2001: "The balanced scorecard does not provide an overall score or a unified view of performance with clear recommendations: it is simply a list of metrics that managers have to interpret." `[live]` https://en.wikipedia.org/wiki/Balanced_scorecard
- **Weights appear only at selection/screening gates** (Cooper); no JV-monitoring weighted-composite precedent was found.
- **Cadence is layered**: monthly management reporting vs plan; quarterly JV board + annual strategy off-site; ANNUAL per-JV health/parent scorecard; annual strategic asset review; annual board self-assessment ("virtually all corporate Boards conduct some type of annual assessment" — `[live]` https://jvalchemist.ankura.com/governance-and-restructuring/director-assessments-common-sense-but-not-common-practice/ ); triennial external governance review; event-driven restructure/deep review. No source endorses semiannual as a distinct tier; nothing prescribes quarterly full re-scoring — quarterly is the board-oversight cadence.
- **Warnings against weighting**: self-assessment inflation ("Every Director, even the worst offenders, will rate him or herself a 4 or 5 out of 5."); thin "going through the motions" assessments over-relying on anecdotes; a weighted composite masks the inflated component (the BSC dimension-legibility debate). No source explicitly prohibits weights — the absence is revealed practice, not a stated rule.

### 1.3 Research-suggested default (non-binding)

**W1-direction equal/unweighted dimension scores + per-dimension red-flag thresholds**; defer differential weights to a post-calibration decision (revisit after 4–6 quarters of accumulated cycles; stage-gate precedent: weights earn their keep from cross-case evidence). Cadence: **C1 — quarterly scoring cycle** on the landed `'YYYY-Qn'` axis, with annual deepening (strategy off-site / strategic-asset-review layer) and triennial external governance review; event-driven re-score on defined triggers (deadlock, milestone miss, capital-call deviation). Semiannual has no published support; annual-only under-uses the landed storage and decouples scoring from the quarterly board cycle that consumes it.

---

## Item 2 — (a) TRL/MRL cutoffs per gate

### 2.1 Prior internal coverage

`rbd-partnership-best-practice.md` already carries the EU Horizon G-A TRL definitions, the NASA/ISO 16290 anchor, the DoD MRL 1–10 condensed table, the G0–G6 gate table (G0 TRL1-2 / G1 TRL2 / G2 TRL3 / G3 TRL4-5+MRL4-5 / G4 TRL5-6+MRL5-6 / G5 TRL7-8+MRL7-8 / G6 TRL9+MRL9-10), Valley-of-Death TRL5–7, and the GAO four criteria. The pack's A2-1..A2-6 rows restate G0–G5 nearly verbatim — the external job here is **validation plus the two open sub-questions** (MRL applicability; vocabulary if adopted).

### 2.2 Findings

- **Cooper/Stage-Gate publishes no TRL numbers per gate**; the validated shape is the research front-end. The 5th-generation model documents "Technology Derisking (TD) projects" following "a two or three Stage model" ("ExxonMobil Chemical's research model features two stages that precede its usual five Stage new-product model") — the screening→pre-FS→FS front-end joining the commercial track at business-case is exactly this pattern. `[live]` https://www.stage-gate.com/about/5th-generation-stage-gate-model/
- **EU/EIC published non-defense TRL windows per funding gate bracket the pack's rows tightly**: Pathfinder (science) TRL 1–4; Transition "starting at TRL 4 aiming to achieve TRL 5/6" (≡ A2-5 Entity-IC TRL 5–6); Accelerator "Develop and scaleup innovations with the potential to create or disrupt markets (TRL 6-8)" (≡ A2-6 window). `[live]` https://eic.ec.europa.eu/eic-funding-opportunities/eic-pathfinder_en , https://eic.ec.europa.eu/eic-funding-opportunities/eic-transition_en , https://eic.ec.europa.eu/eic-funding-opportunities/eic-accelerator_en ; H2020/HE: "RIA typically target lower-to-mid TRLs, while Innovation Actions (IA) focus on higher TRLs" (`[live]` https://en.wikipedia.org/wiki/Technology_readiness_level ).
- **DoD milestone targets via MRL congruence**: MS-A ≈ MRL/TRL 4, MS-B ≈ 6, MS-C ≈ 8 — the same 4-5/5-6/7-8 progression as A2-4/5/6. "MRLs were designed with a numbering system to be roughly congruent with comparable levels of TRLs" (MS-A MRL 4, MS-B 6, post-CDR 7, MS-C 8, FRP 9). `[live]` https://en.wikipedia.org/wiki/Manufacturing_Readiness_Level
- **The MRL mandatory point is LATE even in the system that invented it**: "In 2011, consideration of manufacturing readiness ... was made mandatory as part of the source selection process in major acquisition programs." — earlier assessments advisory. Non-defense practice (EIC/Horizon) publishes TRL-ONLY gates — no MRL criterion at any gate. No authoritative non-defense compressed-MRL standard surfaced ⇒ **if MRL cutoffs are adopted, the citable convention is the deskbook MRL1..MRL10 mirroring D-M-TE-1** (membership enum, `in` predicate, no ordinal var) — and the genuinely open sub-decision is APPLICABILITY: MRL binds hardware-making ventures only (conditional), else it is dead weight for software/service ventures.
- **Deferring formal MRL floors to A2-4/A2-5 is externally defensible**: DoD mandates MRL only at source selection; EIC gates hardware deep-tech on TRL alone; MRL 8/9/10 presuppose production intent meaningless before the Entity-IC make/buy/partner decision. D.1 already does exactly this.
- **TRL misuse warnings** (Wikipedia TRL, verified): "A mature product may possess a greater or lesser degree of readiness for use in a particular system context than one of lower maturity."; TRL models "tend to disregard negative and obsolescence factors."; dilution — "the concreteness and sophistication of the TRL scale gradually diminished as its usage spread outside its original context (space programs)"; "New technologies often fail to make it from TRL 5 to 7; thus, these levels are popularly referred to as the 'Valley of Death'" — supports membership-treatment and making A2-4/A2-5 the recycle/hold decision zone. `[live]` https://en.wikipedia.org/wiki/Technology_readiness_level

### 2.3 Research-suggested default (non-binding)

Confirm all six A2 rows as drafted (the blanket option) — every external anchor family cross-validates. Add the **MRL applicability condition** (hardware-making ventures only, starting A2-4) and, if MRL is adopted, the **MRL1..MRL10 enum mirroring D-M-TE-1** (membership `in` predicates, no ordinal var in v1).

---

## Item 3 — (c) Synergy certification + 90-day attrition threshold

### 3.1 Prior internal coverage

`pmi-jv-lifecycle-best-practice.md` §A.3/A.4 (monthly promised-vs-actual, retention milestones, IMO demob conditions, final synergy accounting published); `ma-dd-best-practice.md` Area 4 (retention bonuses 12–24 months). Missing externally: numeric floor %, sustainment window, signer, package composition, 90d attrition %.

### 3.2 Findings

- **No consulted public source publishes a single numeric certification floor — practice is structural: Finance owns the validation machinery.** PRITCHETT/mergerintegration.com: Finance is responsible for "tracking integration synergies and costs"; the checklist includes a synergy-tracking approach/system, owners, templates, and the "ongoing status reporting format and timing"; best practice is to "Assign synergies to accountable owners and then hold them to a plan" with measurement approaches and their timing pre-agreed (`[live]` https://www.mergerintegration.com/m-a-finance ); workstream post-mortems compare "actual versus planned synergy capture" (`[live]` https://mergerintegration.com/primer-ma-integration-governance ). Bain's 10-steps was fetched live and is qualitative only (`[live]` https://www.bain.com/insights/10-steps-to-successful-ma-integration/ ). **Monthly synergy tracking to CFO/steering is the published norm.**
- **Attrition benchmarks** (PRITCHETT pages citing underlying studies, all `[live]`): "Half of acquired senior managers leave in the first year after a merger. Three out of four leave within the first three years." (Human Resource Executive); "Target companies lose 21% of their executives each year for at least ten years following an acquisition" — "more than double" non-merged turnover (Journal of Business Strategy) (https://www.mergerintegration.com/acquisitions/merger-research-statistics-acquired-organization ); "Four out of ten managers during the first twenty-four months of a merger" = "three times the rate" of non-merging firms, hostile ">50 percent" (https://www.mergerintegration.com/move-urgency-re-recruit-your-keepers ); "AMA study found that 25% of top performers leave within 90 days of major change event" (general change events, not M&A-specific) (https://www.mergerintegration.com/develop-staffing-and-retention ). Departures cluster in two peaks — "during the first several weeks" and "as the new organization finally takes shape" — day 90 sits between the peaks, which is why it works as an early-warning checkpoint.
- **Derived calibration (research-agent synthesis, non-binding)**: published rates describe broad managers/executives in mostly UNMANAGED integrations; AMA 25%-in-90d ≈ the no-intervention case; normal key-staff voluntary turnover ~5–10%/yr ≈ 1–2%/quarter ⇒ regretted key-talent loss at 90 days: ≤5% good, 10% elevated-but-recoverable (escalation), 15% alarming (hard intervention), 20%+ severe failure classification. Of the pack's 10/15/20 options, research best supports **10% as the escalation trigger**, with 15%/20% as severity bands.
- **90 days is a recognized ATTRITION early-warning checkpoint** (30/60/90 tracking; the AMA 90-day stat; the two-peak model) **but NOT where published benchmarks sit** (12/24/36-month horizons). For SYNERGY, stabilization is a 12–24+ month concept — nobody certifies at 90 days. Keep 90d as the attrition tripwire; put the sustainment burden on the certification side (12-month lookback; a retention milestone for demob at 12 months, e.g. ≤20% regretted cumulative — consistent with the 21%/yr executive stat and the internal 12–24-month retention-bonus horizon).
- **Certification-theater controls** (what to forbid): certifying "actioned" initiatives instead of P&L run-rate; one-off savings counted as run-rate; baseline drift (natural cost declines booked as synergy); certifying before a sustainment window elapses; demob before targets live in line budgets. Controls: one accountable owner per initiative; measurement approach/timing agreed BEFORE execution; synergies folded into line budgets; Finance validates vs the locked pre-deal baseline monthly; published final accounting.

### 3.3 Research-suggested default (non-binding)

- **Floor**: ≥90% of committed COST-synergy run-rate in annualized P&L actuals vs the locked baseline (revenue synergies = annex, not a precondition).
- **Sustainment**: 2 consecutive quarters (or 3 monthly closes). **Baseline**: locked at close; later adjustments need CFO approval + disclosure.
- **Signer**: CFO signs / deal controller prepares / each synergy owner countersigns / IMO lead co-signs / steering committee minuted.
- **Package**: initiative register (owner/baseline/target/actioned/run-rate/months sustained) + variance commentary with recovery plan + date for every gap + revenue annex + open-item handover register + 12-month lookback clause.
- **Attrition**: 10% regretted key-talent at 90d as the escalation trigger (numerator = regretted only, excluding planned exits and synergy-related RIF; denominator = the key-talent list locked at close); 15% steering-committee intervention; 20% failure classification feeding the deal lookback; plus a 12-month ≤20% cumulative retention milestone for demob.

---

## Item 4 — (d) Deal-shape selection at P3

### 4.1 Prior internal coverage

`rbd-partnership-best-practice.md` (G4 make/buy/partner + real-options Area 1.5; per-shape pre-signing checklists 3.1–3.4; the NVCA rights package = a concrete minimum-rights floor for capability access). Gap: **the selection logic itself (weights/minimums)**.

### 4.2 Findings

- **"Build, buy, or partner? A systematic literature review"**, Journal of Management and Governance (2022) `[paywalled, abstract via snippet]`: the decisive decision characteristics are "control, risk, flexibility, and speed" — a citable criterion-set anchor. NOTE: the "3C capability/cost/control" label did NOT surface as a canonical named framework — treat it as internal synthesis; cite the SLR's four. `[snippet]` https://link.springer.com/article/10.1007/s11301-022-00280-x
- **Mellewigt, Thomas, Grünwald & Kabst**, Strategic Management Journal 2017 (policy-capturing): the choice is driven by trust (→alliance), routines, and value certainty (→acquisition); "trust is a particularly strong predictor of future alliances, while confidence regarding value more strongly predicts future acquisitions." `[live]` https://ideas.repec.org/a/bla/stratm/v38y2017i12p2353-2369.html
- **Forrester "The Build, Buy, Or Partner Decision Framework"** (RES173053) `[snippet, paywalled]`: a five-factor framework. https://www.forrester.com/report/the-build-buy-or-partner-decision-framework/RES173053

### 4.3 Research-suggested default (non-binding)

**Two stages, not one weighted score**:

1. **INTENT SPLIT**: integration intent ⇒ majority/M&A shapes (JV/minority only as staged options); capability-access intent ⇒ control requirement bounded by an NVCA-derived rights floor (information rights, board seat/observer, pro-rata, ROFR/co-sale, separately-priced tech license with sunset exclusivity) — control above the floor is premium without purpose.
2. **Within the surviving branch**: 5 criteria (control need, capability criticality, market uncertainty, integration capacity, speed-to-capability), equal 20% weights to start (flat beats false precision at zero calibration history), 1–3 scale, PLUS a lexicographic override BEFORE the weighted sum: control need = high AND partner knowledge tacit ⇒ license/co-dev disallowed regardless of total.

**Staging default**: high uncertainty + moderate control need ⇒ minority/co-dev with a PRE-NEGOTIATED step-up (call option / ROFR / conversion trigger at the next gate) — value certainty learned during collaboration is the documented trigger to shift toward acquisition.

---

## Item 5 — Calibration corpus methodology

### 5.1 Prior internal coverage

`readiness-gap-best-practice.md` (RCF three steps + outside view; proxy-chain-as-reference-class; structured elicitation). Gap: **field design, small-n defensibility, overfitting guards**.

### 5.2 Findings

- **RCF canonical** `[live]` https://en.wikipedia.org/wiki/Reference_class_forecasting : "human judgment is generally optimistic due to overconfidence and insufficient consideration of distributional information"; names "reference class tennis"; **SILENT on minimum n**.
- **Small-n viability (practitioner)**: "Even if you are working on an innovation and you cannot identify many similar projects, there are usually some that can help you to guide you". `[live]` https://higuide.elrha.org/methods/reference-class-forecasting/
- **Flyvbjerg-method page** `[live]` https://budgetoverrun.com/reference-class-forecasting : comparables must be "genuinely comparable in scope, technology, scale, and delivery model. Not 'similar in name', similar in structure"; measure overrun "against its original approved budget (not against any later re-baseline)"; pick a percentile (UK Treasury defaults to the 80th); when no own class exists, fall back to published base rates.
- **Academic**: EJOR 2021 `[paywalled]` — class membership via statistical similarity tests (https://www.sciencedirect.com/science/article/abs/pii/S0377221721002939 ); Results in Engineering 2024 `[paywalled]` — an RCF-under-data-scarcity literature exists (https://www.sciencedirect.com/science/article/pii/S2590123024005887 ).
- **n = 5–10 sits between analogous estimating ("one or a few comparable projects") and full RCF ("a full statistical distribution")** — below ~20 cases a class percentile is not estimable.

### 5.3 Research-suggested default (non-binding)

Treat 5–10 as a bounded **ANALOGY corpus, not a distribution** — the Green-cap lift must be justified by (wider-class base rate + corpus consistency), never by corpus hit-rate alone. Minimal fields per case: (1) class-membership properties (industry, deal shape, size band, capability-vs-integration intent, gate reached); (2) ORIGINAL gate estimate vs realized outcome per calibrated dimension + the estimate's evidence tier (direct data / proxy-chain hops / expert-only) — never the revised estimate; (3) date + regime context; (4) decision taken + which kill/risk criteria fired; (5) verifiable source for the realized outcome. Overfitting guards: (i) corpus evidence moves the Green cap at most one confidence tier per revision (shrinkage written into procedure); (ii) a case enters the class only on ≥2 pre-declared membership properties; (iii) if <3 cases match a rule, widen the class instead of fitting the rule; (iv) pre-register which rules the corpus may calibrate (Green-cap lift + threshold nudges; NOT new kill criteria); (v) no rule fitted to a single case; (vi) retire cases beyond 5–7 years.

---

## Item 6 — Antitrust early-screen premise

### 6.1 Prior internal coverage

`ma-dd-best-practice.md` (merger control as a DD workstream → SPA CP/timeline; Korea KFTC 300bn/30bn + local nexus, killer-acquisition R&D ≥30bn trigger, Phase 1 30d); `rbd-partnership-best-practice.md` 3.2/3.4 (collaboration footprint + JV clearance strategy).

### 6.2 Findings

- **2023 DOJ/FTC Merger Guidelines structural presumption**: post-merger HHI >1,800 with delta >100 (CRS LSB11138 `[snippet]`); "a merger that creates a firm with a share over thirty percent is also presumed to substantially lessen competition" (FTC PDF `[snippet]`). 2010 contrast: post-HHI >2,500 highly concentrated; "increases of 100 points or less will usually not have any anti competitive effects" (Wikipedia HHI `[live]`). https://www.congress.gov/crs-product/LSB11138 , https://www.ftc.gov/system/files/ftc_gov/pdf/2023_merger_guidelines_final_12.18.2023.pdf , https://en.wikipedia.org/wiki/Herfindahl%E2%80%93Hirschman_index
- **HSR 2026 thresholds** (Covington, effective 2026-02-17) `[live]`: minimum size-of-transaction $133.9M; below $535.5M a size-of-person test applies (one party ≥$267.8M, the other ≥$26.8M). https://www.cov.com/en/news-and-insights/insights/2026/01/ftc-announces-2026-update-of-jurisdictional-and-fee-thresholds-for-hsr-premerger-notification-filings
- **EU** `[live]`: Community dimension at combined worldwide turnover >EUR 5,000M + EU-wide >EUR 250M; substantive test SIEC; sub-threshold deals fall to national NCAs. https://en.wikipedia.org/wiki/European_Union_merger_law
- **STAGE — practice screens early** `[live]`: "Early identification of potential competition law and FDI filing requirements can reduce the risks of lengthy and costly filing processes"; assessment "potentially already on the bid-stage of the process"; with overlaps "it is advisable to conduct an early feasibility assessment to identify risks (and potential remedies)"; the risk lands in CPs, break-fees, long-stop dates. https://schjodt.com/news/important-competition-law-aspects-of-m-a-transactions ; ABA BLT 2018 before-signing framing `[403 — title/snippet only]`; Ropes & Gray 2026: "early, substantive antitrust assessment is now essential, even for deals previously considered low-risk" `[snippet]`.
- **PREMISE VERDICT**: mature practice treats antitrust as an EARLY feasibility/risk-allocation screen (bid/LOI stage) whose output is a risk grade + shape/structure adjustment + conditionality design; automatic KILL is reserved for presumption-level overlaps with no divestiture path. The repo premise (regulatory workstream only) is behind practice — but practice does not support a hair-trigger kill criterion either.

### 6.3 Research-suggested default (non-binding)

An early screening CHECK (risk-layer flag) at P1/P3 rather than a new automatic kill: **Amber** when any screen trips; **Red/kill-path** only when structural-presumption territory is plausibly reached AND no remedy path exists; deep filing analysis stays in `regulatory_permit` (compatible with migration-0018 D4). Concrete screen values: combined share >30% → deeper analysis; post-merger HHI >1,800 + delta >100 → presumption-risk flag; ≥$133.9M (HSR 2026) or KFTC 300bn/30bn → filing-timeline flag; EUR 5bn/250M → multi-jurisdiction review. **CRITICAL design note**: USD/EUR thresholds index-adjust annually — store as verified_on-dated fields (the profile pattern), never constants.

---

## 7. Evidence tiers and fetch failures (consolidated, recorded honestly)

- **Channel**: the built-in WebSearch routes through the exhausted Z.ai quota (429, resets 2026-09-01 08:56); its fallback text is unsourced model knowledge — **EXCLUDED from evidence everywhere**. Workarounds used: direct WebFetch of canonical URLs + Brave search HTML (R4).
- **Fetch failures**: DuckDuckGo html/lite CAPTCHA; Bing misparse (Korean postal pages); 403 on justice.gov / ftc.gov / congress.gov / americanbar.org / BCG / PwC; timeouts on the McKinsey index; DNS failure cleary.com; gao.gov PDF >10MB fetch cap; dodmrl.com JS shell; deskbook PDF 404s; 2gc.com defunct; KPMG JV PDF unextracted (no renderer); Springer / ScienceDirect / Forrester paywalled (abstract/snippet only — marked).
- **GAO guide quotes not re-fetched** (PDF cap) — the internal `rbd-technology-checklist.yaml` rbd-14 already carries the four-criteria checklist.
- **Model-knowledge (NOT live-verified, flagged)**: R3's typical-demob-timing paragraph (12–24 months demob / revenue synergies 3+ years); any figure above not tied to a URL.

## 8. Post-2026-09-01 verification backlog

Re-fetch after the search quota resets (2026-09-01): BCG synergy articles; McKinsey PMI/synergy tracking; Deloitte/KPMG integration surveys; academic anchors (Krug; Larsson & Finkelstein 1999; Haspeslagh & Jemison); the DoD MRL deskbook PDF; GAO-20-48G full PDF; the 2023 JV Governance Benchmarking Study findings.

Prior committed research this report builds on: `ma-dd-best-practice.md`, `pmi-jv-lifecycle-best-practice.md`, `rbd-partnership-best-practice.md`, `venture-governance-best-practice.md`, `readiness-gap-best-practice.md`.
