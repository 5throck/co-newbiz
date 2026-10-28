# Monte Carlo verification — engines and every consumer (2026-10-28)

> **Update 2026-10-28:** the owner decided to fix D1 (deterministic downside DSCR from the financing plan) and D4–D7. The fixes are in the same PR as this report; the findings below describe the state at verification time.

Scope: verification only. No product code was changed. All runs used temp SQLite DBs and isolated servers
(scenario harness on a free port); the 7748 dev server/DB and the 7749 prod container were not touched.
Throwaway test files were kept outside the repo (`/tmp/mcv/`).

## 0. Verdict

- **The S8 NPV engine is correct.** The Python `sim_engine` and the in-process TS fallback agree with each other
  (all nine percentile cells within 0.05 % at N = 200 000) and with analytic and independent-reference values.
  Determinism, snapshot reproducibility, quantile ordering and convergence all pass.
- **The S5 investment simulation is correct.** It matches the analytic triangular quantiles within 0.3 %.
- **Rows written to `valuation_simulation` reach every reader unchanged.** The business-case API, IC package, S8 UI
  tables and BEP panel all show the stored numbers in KRW millions.
- **The debt / contingent-liability / covenant simulation does not work anywhere it is used.** The S10 covenant check,
  the covenant headroom views and the RAG covenant variable all read `simulation` / `covenant_test` rows that no
  production code path can create. Where the unreachable orchestrator is used, it also has a unit bug.
- **Two consumers judge the same adopted case differently** (`/target-check` vs the S8 lens summary), and the S8
  completion predicate can be blocked by the downside scenario's BEP.
- **Existing tests: 477 pass, 0 fail** across 35 related files. One transient `SQLITE_IOERR_VNODE` appeared only while a Next build ran concurrently (see §4).

## 1. Inventory

There are four distinct Monte Carlo implementations, not one.

| # | Engine | File:line | Used by |
|---|---|---|---|
| E1 | Python `sim_engine` (numpy default_rng; seed = fnv1a32(case_id : sha256(canonical drivers))) | `python/sim_engine/engine.py:48` `run_case`; `job_spec.py`; `metrics.py`; `rng_policy.py` | S8 business-case generation (primary path) |
| E2 | TS fallback `runSeededSimulation` (mulberry32 + Box-Muller; seed = fnv1a(projectId[:targetId]:scenario)) | `app/web-next/lib/business-case-generator.ts:391` (seed `:283`, `irr` `:327`, payback `:363`) | S8 kill switch / engine failure / **all S5-linked cases** (engine bypassed, `:2106`) |
| E3 | S5 investment-plan simulation (triangular draws, common-factor correlation) | `app/web-next/lib/investment-simulation.ts:162` `simulateInvestment`, `:143` `drawInvestmentFactors` | S5 route, S8 pairing, lens, gate brief |
| E4 | Legacy contingent-liability MC | `python/monte_carlo.py`; orchestrator `db/lib/simulation.ts:175` `runSimulationForRun`; CLI `scripts/co-newbiz/simulate.ts:65` | CLI `newbiz simulate` only (orchestrator has no caller) |
| E5 | Calibration sweep sampler (triangular ±50 %) | `app/web-next/lib/calibration-sweep.ts:23,86` | `/api/market-overview/industry/[id]/calibration-sweep` (not verified, tests pass) |

| Consumer | File:line | How invoked |
|---|---|---|
| E1 job-spec builder / bridge | `business-case-generator.ts:1867` `buildS8JobSpec`, `:1956` `runEngineSimulation`; `lib/sim-engine.ts:123` `runSimJob` (spawn, 120 s timeout, silent fallback) | `POST /api/projects/[id]/business-case/generate` |
| Persisted result | `business-case-generator.ts:2190` `INSERT INTO valuation_simulation` (p05/p50/p95 rows; IRR/BEP on p50 only) | same |
| Reader: case list / API / UI tables | `lib/business-case.ts:208` `listBusinessCases`; UI `BusinessCaseStage.tsx:1077` (`fmtNpvKrwM`) | `GET /api/projects/[id]/business-case` |
| Reader: BEP panel | `app/api/projects/[id]/business-case/bep/route.ts` → `deterministicCaseYearTable` (`generator:1734`); UI `BepAnalysisPanel.tsx` | `?tab=bep`; recomputes live, not from stored rows |
| S8 completion (NPV quantiles + BEP + snapshot) | `lib/process-flow.ts:527`, greenfield branch ~`:630-650`, brownfield ~`:560-590` | `evaluateProcess` |
| RECOMMENDED flag | `generator:2352` `recommendedFromDb` | list API |
| Goals / fs-gate evidence | `lib/business-targets.ts:262` `baseCaseSim`; `app/api/projects/[id]/target-check/route.ts:26`; `lib/business-case.ts:320` (adoption attainment) | `/target-check`, adoption |
| S8 lens (financial) | `lib/s8-lens-summary.ts:68`, `s8-lens-status.ts:48` | `/s8-lens-summary` |
| IC package | `app/api/projects/[id]/ic-package/route.ts:124` | `/ic-package`; MCP `get_project_ic_package` |
| Gate brief | `lib/gate-brief.ts:258` (case names only, no quantiles) | `/gate-brief` |
| Report | `lib/report-composer.ts:39-52` | reports |
| Backtest | `lib/backtest.ts:66` | portfolio |
| RAG (financial dimension) | `db/lib/snapshot-filler.ts:836-873` (base p50 *deterministic* IRR vs hurdle) | `run_rag_recompute` / RAG route |
| S5 sim run / confirm | `app/api/greenfield/[oppId]/investment-simulation/route.ts` (+ `/confirm`); UI `GreenfieldStage.tsx:1348` | S5 tab; S8 pairing `generator:~420-470` |
| S8 ↔ S5 staleness | `lib/investment-simulation-s8.ts:99`, `lib/s5-plan-pin-s8.ts:194` | S8 UI chips |
| **Covenant / DSCR simulation (dead)** | `lib/covenant-headroom.ts:109`; `lib/s10-checks.ts:96`; `db/lib/snapshot-filler.ts:576`; `lib/risk-heatmap.ts:177`; `api/projects/[id]/debt/route.ts:22`; `ic-package/route.ts:188` | read `simulation` + `covenant_test`; **no writer** |
| MCP | `mcp/co-newbiz/tools/stage-tools.ts:140-151` (`get/save/generate_business_case`, `set_business_case_params`, `get_business_case_run`, `recommend_case_adoption`), `tools/ic-package.ts` — all REST wrappers (ADR-0011) | `/api/mcp`; `run_simulation` MCP tool was removed (`tools/analysis.ts:7-9`, ADR-0094) |
| CLI | `scripts/co-newbiz/newbiz.ts:239` `simulate <scenario.json>` | E4 only |

## 2. Engine checks

Evidence scripts: `/tmp/mcv/engine_checks.py` (output `/tmp/mcv/engine.out`), `/tmp/mcv/ts_checks.ts`, `/tmp/mcv/s5_checks.ts`.

| Check | Result | Evidence |
|---|---|---|
| E1 seed determinism | PASS | same spec → identical npv block and seed 2381678875 |
| E1 different seeds → different results | PASS | case_id `c1` vs `c2`: seeds differ, p50 745.096 vs 744.591 |
| E1 multi-case pool (spawn) == serial | PASS | per-case results identical |
| E1 mean vs analytic (N = 1e6) | PASS | 745.159 vs 745.177 (rel 2.5e-5) |
| E1 deterministic `base` vs analytic | PASS | 745.177382 both |
| E1 p05/p50/p95 vs independent numpy reference | PASS | 704.38/744.95/786.60 vs 704.41/744.98/786.59 |
| E1 std is population (ddof 0) | PASS | 25.001 vs ref 24.991 |
| Distributions normal / uniform / triangular | PASS | mean, var within 1e-3 of theory (N = 2e6); degenerate triangular → constant |
| Lognormal | n/a (not implemented) | rejected with explicit `dist must be one of (normal, uniform, triangular, constant)` |
| Correlation | none in E1/E2 | growth is iid per year; opex/capex are per-iteration constants; E3 uses one common factor per group (documented) |
| Convergence | PASS | sd(p50) over 60 seeds: 1.24 / 0.38 / 0.133 at N = 500 / 5k / 50k vs theory 1.40 / 0.44 / 0.14 (1/√N) |
| Zero variance (sigma = 0) | PASS | std 1e-13, p05 = p95 |
| N = 1 | PASS | std 0, p05 = p50 = p95 |
| N = 0, sigma < 0, uniform low>high, triangular unordered, NaN | PASS | `JobSpecError` messages (exit 2) |
| discount_rate ≤ −1 | **FAIL** | `ZeroDivisionError` crash (exit 1), no validation — D8 |
| Overflow / Inf | PASS | non-finite → `null` (`engine.py` `_sanitize`); TS bridge then falls back |
| Growth below −100 % | INFO | no floor: revenue can go negative (sigma 2.0 → p05 −5330); not validated |
| Perf / memory | PASS | N = 1e6, H = 5: 0.1 s, RSS ≈ 354 MB; the 1e7 cap would be ~3.5 GB (extrapolated, not run) |
| Snapshot reproduces run | PASS | `inputs_echo` re-run → identical seed/npv; stored `business_case_model.inputs_json` re-run via the CLI reproduced all 9 stored percentiles **exactly** |
| E1 vs E2 same inputs (N = 200k, 3 scenarios) | PASS | all 9 cells ≤ 0.05 %; IRR and BEP identical |
| Units | PASS | rows carry `unit = KRW_M`; UI shows KRW millions; S5 UI 4,384.66/5,102.57/5,808.43 equals DB run |
| E1 vs E2 IRR bracket | **FAIL** | Python returns `None` when IRR > 1000 %, TS widens — D6 |
| E2 quantile definition | INFO | `floor(p·n)` (`generator:~507`) vs numpy interpolation: ≤ 1 rank difference |
| E3 triangular mean/var, mulberry32 uniform | PASS | 2.9993/1.1672 (theory 3, 1.1667); 0.4998/0.0833 |
| E3 band vs analytic (manual line 360, ±20 %) | PASS | engine 311.0/359.6/408.5 vs analytic 310.8/360.0/409.2 |
| E3 P(total > mode) | PASS | 0.494 (theory 0.5) |
| E3 determinism, seed sensitivity, zero range, histogram sums | PASS | – |
| E3 empty plan | INFO | returns all zeros, `percentile([])` returns 0 (`investment-simulation.ts:44`); route guards with 409 `no_investment_plan` |
| E4 `monte_carlo.py` with low = high | **FAIL** | `ValueError: left == right` crash — D3 |
| E4 timing convention | **FAIL** | `monte_carlo.py:100` discounts by `timing_year + 1`, `sim_engine` by `timing_year` (1-based) — D3 |
| E4 units via `runSimulationForRun` | **FAIL** | liabilities ×1e6 but cash flows not scaled: p50 −83,089,882 vs expected ≈ +785 — D3 |

## 3. Consumer checks

| Consumer | Status | Evidence |
|---|---|---|
| S8 generate → `valuation_simulation` (engine path, 3 scenarios) | WORKS | rows reproduce from stored snapshot exactly |
| S8 generate (kill switch / fallback) | WORKS | ≤ 0.05 % vs engine at N = 200k; note stamps `engine=inline-ts` |
| S5-linked S8 (`basis=s5_plan_full`) | WORKS (fallback-only) | `engine=inline-ts (S8 engine bypassed …)`; NPV −2,462/−2,406/−2,348 identical in DB, `/business-case`, scenario tab and BEP panel NPV −2,407.3 (deterministic) |
| `GET /business-case`, IC package `business_case.adopted.simulations` | WORKS | p05/p50/p95/IRR identical to DB |
| S8 UI scenario table (`?tab=scenarios`) | WORKS | −2,462 / −2,406 / −2,348, IRR −51.7 % = DB; no console errors |
| S8 BEP panel (`?tab=bep`) | WORKS, 1 display bug | ECharts canvas renders, no console errors; but the "Total" column sums the *cumulative* row (−10,849.9) — D9 |
| S5 simulation UI (run, bands, year table, tornado) | WORKS | UI 4,384.66/5,102.57/5,808.43 = `investment_simulation_run.results_json`; mode 5,100 = 1200×3 + 300×5 |
| S5 investment charts (`?tab=investment`) | WORKS | 2 ECharts canvases; only console errors are 409 on `entry-market-derivation` (pre-existing S2 gate response, unrelated) |
| NPV distribution chart / histogram | NOT PRESENT | S5 stores `total.histogram`, S8 stores none; neither is rendered |
| S8 lens summary (financial) | WORKS | base IRR / downside p50 91.66 from the right models |
| `/target-check` + adoption attainment | **BROKEN (inconsistent)** | adopt *base*: NPV goal `indeterminate` ("no p50 simulation for the recommended scenario") while lens shows `met 1` for the same case; adopt *upside* → `met` — D4 |
| RECOMMENDED flag | QUESTIONABLE | `recommendedFromDb` = max p05 → `upside` whenever economics are positive; inverted (downside) when margins are negative — D4 |
| S8 completion (greenfield) | **BROKEN edge** | with `opex_ratio = 0.744`: base BEP 4.93 y, downside BEP null → S8 incomplete, message says "regenerate" — D5 |
| S10 covenant / DSCR check | **BROKEN** | debt present → always the blocker "no structure simulation"; D1 |
| Covenant headroom (debt route, IC package, heatmap) | **BROKEN** | `insufficient_evidence / no_simulation` forever; heatmap hint says "run the simulation" with no way to do so — D1 |
| RAG `risk.covenants_breached` | **BROKEN** | `snapshot-filler.ts:576` → `missing` whenever debt exists — D1 |
| Contingent liabilities in S8 NPV | **NOT WIRED** | `buildS8JobSpec` has no `contingent_liabilities`; no route/MCP/UI writes `contingent_liability` — D2 |
| Gate brief | WORKS (limited) | lists case names only, no quantiles |
| MCP tools | WORKS (not live-exercised) | REST wrappers; `mcp.test.ts` incl. DB-import scan passes; `run_simulation` tool was removed |
| CLI `newbiz simulate` | WORKS | `simulate.test.ts` seeded determinism passes; inherits the E4 defects |
| Brownfield per-target, historical variant, fade-DCF, FX index, exit multiple | COULD NOT VERIFY independently | covered by existing passing tests only |

## 4. Existing tests

- 19 files (sim-engine, business-case-sim-engine, investment-simulation(-s8), investment-uncertainty-s8, simulate, s10-checks, calibration-sweep, business-case, irr-guard, wacc-session, s9-depth-routes, ic-package, s5-connect, business-case-dual-view, s8-copy-path-golden, s8-s5-pnl, business-case-targets, business-case-revenue-anchor): **209 pass, 0 fail**.
- 16 more files (mcp, snapshot-filler, rule-assessment, kill-criteria, wave-f5-rag(+recompute), model, target-costing, business-case-wacc-scope, gate-integrity-p4-wacc, gate-decisions-ic-sequence, deal-structure, project-goals, business-case-round-archival, business-case-legacy-cleanup, pipeline): **268 pass, 0 fail**.
- `share-guard.test.ts` threw `SQLITE_IOERR_VNODE` once while a Next build was running in parallel; alone it passes 7/7 (transient, environmental).
- The PM-reported pre-push failure `mcv ui > S5 simulation run in UI` was **my throwaway test's own bug** (it queried a non-existent column `results`; the column is `results_json`). It is not a product defect; after the fix the scenario passes 4/4. The files are removed from the repo and kept in `/tmp/mcv/archive/`.
- Passing existing tests give no coverage for D1–D6 (they insert `simulation`/`covenant_test` rows by hand, which is why D1 is invisible).

## 5. Defects (ranked)

### High

**D1. S10 covenant check, covenant headroom and RAG covenant variable can never be satisfied (no writer for `simulation` / `covenant_test`).**
- Readers: `lib/s10-checks.ts:96-123`, `lib/covenant-headroom.ts:109-124`, `db/lib/snapshot-filler.ts:576-600`, `risk-heatmap.ts:177`, `debt/route.ts:22`, `ic-package/route.ts:188`.
- The only writer of `simulation` is `db/lib/simulation.ts:175`. It has no caller outside tests: `/api/simulations` was removed (ADR-0094, `mcp/.../analysis.ts:7-9`), the MCP `run_simulation` tool is gone. Nothing anywhere inserts into `covenant_test`, and `runSimulationForRun` does not either.
- Repro (executed): promote a project, generate and adopt a case, insert a `debt_instrument`, call `GET /debt` → `no_simulation`; `s10CovenantHeadroom` → blocker "no structure simulation". After calling `runSimulationForRun` directly, it becomes `no_covenant_tests`. The predicate date `ADR_0187_P3_PREDICATE_DATE = 2026-10-28` makes this apply to every new project with debt. I did not verify whether the waiver flow can bypass this blocker.
- Fix: decide the owner of covenant testing. Either build the route plus a DSCR/covenant writer fed from S8/S10 cash flows (and a UI action), or make S10 (b) human-attested/advisory until it exists. Also remove the "run the simulation" hint if there is no action, and correct `api-spec.md:61-62` (still lists `/api/simulations` as as-built).

**D2. Contingent-liability Monte Carlo (ADR-0026) is not part of any shipped flow.**
- `buildS8JobSpec` (`generator:1867-1950`) never passes `contingent_liabilities`, although `sim_engine` supports them (`engine.py:116-122`).
- No route, MCP tool or UI creates `contingent_liability` rows (`LiabilitiesResponse` in `lib/api.ts:399` is orphaned). `snapshot-filler.ts:550` reads them only for a deterministic EV rule.
- The skill `debt-and-contingent-liability-simulation` promises that "the downside tail visibly thickens"; in the product it cannot.
- Fix: carry the project's `contingent_liability` rows (with the ×1e6 → KRW-M handling decided once) into the S8 job-spec, or retire the claim.

**D3. `runSimulationForRun` / `monte_carlo.py` are wrong if D1 is "fixed" by reconnecting them.**
- Unit bug: `db/lib/simulation.ts:~222-260` scales liability amounts ×1e6 into won but leaves `sim.cfN` unscaled. Repro: cf1 = cf2 = 500, one certain liability 80/100/120 at year 1 → stored p50 = −83,089,882 (expected ≈ +785). The comment says outputs are "engine-native", but the inputs are mixed-unit.
- `python/monte_carlo.py:~98` crashes (`ValueError: left == right`) for a fixed-amount liability (low = expected = high; the DB CHECK allows it, and `sim_engine` already handles it).
- `monte_carlo.py:100` discounts at `timing_year + 1`; `sim_engine` uses `timing_year` (1-based). The two engines disagree by a year.
- Fix: reuse `sim_engine` for liabilities; one unit convention.

### Medium

**D4. Goal attainment is judged on a different scenario than the adopted case, and RECOMMENDED is almost always "upside".**
- `business-targets.ts:262` `baseCaseSim` only reads the p50 whose scenario equals the *recommended* scenario. Callers: `target-check/route.ts:26-28` and `business-case.ts:320` (adoption attainment, which also forces the `goals_ack` requirement when nothing is evaluable).
- Repro (executed): goal NPV ≥ 1, adopt *base* → `/target-check` `indeterminate`; `/s8-lens-summary` for the same case → `met 1`.
- `recommendedFromDb` (`generator:2352`) picks max p05 NPV, which is the upside scenario whenever margins are positive, so the common adoption (base) is unjudgeable.
- Fix: evaluate with `evaluateTargetsForCase` (the case's own scenario) everywhere, as the lens already does; revisit the recommendation rule.

**D5. S8 completion keys on the latest-created model, which is the *downside* scenario.**
- `process-flow.ts` greenfield branch (~`:630-650`) takes `ORDER BY created_at DESC LIMIT 1` and requires `bep_year != null`. Brownfield uses the base scenario.
- Repro (executed, opex_ratio 0.744): base BEP 4.925 y, NPV +2; downside BEP null → S8 incomplete. The message "regenerate the feasibility analysis" cannot help. `null` also conflates "not computed" with "not within horizon".
- Fix: use the base/market_forward gate-primary model; accept an explicit "not reached within horizon" result.

**D6. Engine vs fallback IRR parity.** `python/sim_engine/metrics.py:18` returns `None` if IRR > 1000 %; `generator:327` (commit 95153be4) widens the bracket. Same inputs give IRR `null` on the engine path and ~19.0 on the fallback (verified: `irr([-1, 20])`). Fix: port the widening to `metrics.irr`.

**D7. The NPV band is conditional on growth noise only.** With default sigma 2 %, opex, capex, initial investment and WACC are constants (`opex_ratio`/`capex_ratio` are `constant` in `buildS8JobSpec`); the observed p05–p95 span was ≈ ±5 % (S5-linked case −2,462…−2,348). When the S5 run is not confirmed (`s5_sim=none`) the S5 investment uncertainty is absent. Not a math error, but a decision-support risk of overstated confidence; the UI states the sources. Suggest an explicit "width reflects growth noise only" label on the quantile table.

### Low

- **D8.** `python/sim_engine/job_spec.py` `parse_job_spec` does not reject `discount_rate <= -1` (crash instead of `JobSpecError`).
- **D9.** `BepAnalysisPanel.tsx:~213`: total column sums the cumulative discounted row (shows −10,849.9).
- **D10.** Path asymmetries: fallback quantile `floor(p·n)` vs numpy interpolation; fallback clamps iterations to 200k while the stored snapshot keeps the requested value (`generator:1437-1443`); fallback seed depends only on (project, scenario) while the engine's seed changes with any parameter, so scenario/parameter comparisons carry independent-stream noise on the engine path only.
- **D11.** No S8 NPV distribution chart exists (and `total.histogram` from S5 is stored but not shown). Not an error, but the task's "chart" expectation is only met for the S5 cost charts and the BEP chart.
- **D12.** Inverted scenario ordering for loss-making cases (upside NPV below downside at opex 0.80: −50 vs −36); inherent to a growth-only scenario design, but the labels "upside/downside" mislead.
- **D13.** `percentile([])` returns 0 (`investment-simulation.ts:44`) instead of signalling no data; callers currently guard.

## 6. Could not verify

- GPU/torch backend (`TorchBackend`, mps/cuda/rocm/xpu): torch is not installed here; auto selection chose cpu/numpy/float64.
- N = 1e7 memory/time (extrapolated from 1e6; not run).
- Live `/api/mcp` OAuth transport; MCP tools only via unit tests and REST equivalence.
- Brownfield per-target cases, the historical variant, fade-DCF cross-check, FX index in S8, exit-multiple cases, s5_pnl with per-draw S5 pairing (`it % drawCount`): only the existing passing tests; I did not re-derive them.
- Waiver bypass for the S10 covenant blocker (D1).
- Calibration-sweep statistics and `s5SimStatusForProject` choosing a note from a non-adopted model (`investment-simulation-s8.ts:99`): read, not exercised.
- Chart rendering for S5 `tornado` (list only) and any visual regression; screenshots exist at `/tmp/mcv/*.png` but were not pixel-compared.

## 7. Candidate permanent tests

1. `python/sim_engine`: analytic-mean and independent-reference quantile test (N = 1e6) and the reproduce-from-`inputs_echo` test.
2. Python/TS IRR parity for IRR > 1000 % (D6) and `discount_rate <= -1` rejection (D8).
3. `monte_carlo.py` with low = expected = high, and a unit-boundary test of `runSimulationForRun` against a hand-computed value (D3).
4. A "covenant path is satisfiable" scenario: debt + chosen action → `covenant_test` rows → S10 (b) passes (D1).
5. `/target-check` vs `/s8-lens-summary` agreement for an adopted non-recommended scenario (D4).
6. S8 completion with a null downside BEP (D5).
7. BEP table total row excludes the cumulative row (D9).

Throwaway sources are in `/tmp/mcv/archive/` (`_mcv-s8.test.ts`, `_mcv-ui.test.ts`, `_mcv-goals.test.ts`) and `/tmp/mcv/*.py|ts`.
