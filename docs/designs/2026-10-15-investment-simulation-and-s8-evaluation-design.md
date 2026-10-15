---
title: Investment simulation at S5 and S8 business-paper evaluation consumption
status: accepted
date: 2026-10-15
owner: platform-lead
lang: ko
lang_reason: source-material
---

# Investment simulation at S5 (투자 시뮬레이션) and S8 business-paper evaluation consumption

Korean appears only as UI labels in backticks. All prose is English. Paths are relative to `app/web-next/` unless stated.

- Decider: human decider, chat 2026-10-15 (option B′). Drafted by platform-lead.
- Decided layering (option B′): the INVESTMENT SIMULATION lives at S5 — the investment plan's owner. S8 does NOT re-simulate investment; the S8 business-paper evaluation CONSUMES the S5 simulation output (year-by-year investment distributions) and combines it with revenue/WACC uncertainty for its own NPV/IRR distributions and gate support. Divergence prevention: one shared computation module for the yearly investment vectors; the S8 run records reference the S5 simulation hash; a changed S5 simulation flags the S8 evaluation `재평가 필요` (the ADR-0170 staleness pattern).
- ADR: [ADR-0176](../adr/0176-investment-simulation-and-s8-evaluation.md) (Proposed).
- Builds on: [ADR-0174](../adr/0174-total-investment-and-s8-handoff.md) (Accepted; total investment, horizon, per-line timing, `bc.investment_basis`, promotion copy, `s5_line_hash` provenance) and [ADR-0175](../adr/0175-staffing-plan-and-labor-cost.md) (Proposed; staffing plan, per-year labor vectors, salary human-sourced only, no statutory on-cost default). Slice 1 of this design stands alone on the deterministic ADR-0174 totals if ADR-0175 has not shipped.

## 1. Problem statement

- ADR-0174 gives S5 a deterministic total investment and a Y1..YN schedule, but the schedule is a single-point estimate: every line amount is taken exactly as entered. The decider sees a total like `총 투자비 42,000 백만원` with no sense of how wrong it can be.
- S8, under `bc.investment_basis = s5_plan`, uses that same single-point capex vector inside its Monte Carlo: investment uncertainty is currently zero in the NPV distribution even though every input to the vector is an estimate (capability cost, staffing salary, manual lines).
- The staffing plan (ADR-0175) introduces explicitly uncertain parameters (salary ±, increase rate, on-cost assumption, headcount ramp) whose uncertainty the system today neither shows nor carries anywhere.

## 2. Verified current state

- **S8 seeded Monte Carlo** (`lib/business-case-generator.ts`): `scenarioSeed` (FNV-1a over `projectId:scenario[:targetId]`), `mulberry32` PRNG, `normalPair` Box-Muller; `runSeededSimulation` draws revenue growth ~ Normal per year and discounts at the project WACC. Results carry `p05/p50/p95/mean/std`, persisted as three `valuation_simulation` rows (percentile, `npv_krw_m`, `irr`, a provenance `note` with `seed=`, `iterations=`, `basis=`, `s5_model=`, `s5_line_hash=` fragments). The whole path is a pure function of inputs — reproducible per ADR-0052 §D.4.
- **S5 plan plumbing**: `buildS5InvestmentPlan` (private in `business-case-generator.ts`, ~line 957) builds `{ capexByYear, laborOpexByYear, govRndByYear, opexCovered, skippedLines, lineHash }` from the latest `greenfield_cost` model and honors `bc.investment_basis` / `s5_plan_full`. Under `s5_plan` the python sim-engine path is bypassed (engine parity for explicit vectors unverified — ADR-0174 honest limits). `MC_ITERATIONS` and the `bc.iterations` user assumption control draw count (clamped 1..10,000,000).
- **S5 deterministic totals**: `lib/capability-cost-lines.ts` exports `planMetaOf`, `activeYearsOf`, `lineAmountKrwM`, `DEFAULT_HORIZON_YEARS = 5`, category labels; the S5 `투자비 요약` panel (ADR-0174 slice 1, shipped) renders tiles, a by-category table and the Y1..YN schedule from the stored lines.
- **Capability entries** (`lib/capability-cost-lines.ts`, `source: "capability"`) carry server-recomputed amounts; **staffing plan** (ADR-0175, `source: "staffing_plan"`) carries per-row `headcountByYear`, aggregate `avgAnnualBaseSalaryKrwM`, `salaryIncreaseRatePct`, `onCostRatePct` (empty until a person enters it), `recruitingOneOffKrwM`. Salary figures exist only when analyst-sourced; rows without salary are excluded from cost with a flag.
- **Scenario/variant axes**: cases run per scenario (`base/optimistic/pessimistic`) × variant (`market_forward/historical`) from the same seeded engine; the capability-adjusted scenario (ADR-0168 slice) is the established "fourth scenario" pattern — an additional case context, not a change to the seeded engine contract.
- **Pre-promotion storage**: `greenfield_assessment` has no free column; `business_case_lines_json` holds lines + `plan_meta` + (ADR-0175) `staffing_plan` entries. S5 is opportunity-keyed — the project-scoped `run` table (`db/migrations/0003`) cannot hold an S5 simulation (no project exists before promotion). There is a generic `run`/`run_input` pair but it is project-scoped and assumption-keyed, not a fit.
- **Staleness pattern**: ADR-0170 recomputes row hashes and flags stale judgements; ADR-0174's re-import shows a diff; run notes carry `s5_line_hash`. The same hash-compare-and-flag mechanism is what this design reuses for `재평가 필요`.

## 3. The shared computation module (deliverable b — designed first because both stages consume it)

**New file `lib/investment-vectors.ts`.** One pure computation of the year-by-year investment vectors, extracted so S5 simulation, the S5 `투자비 요약` and the S8 `s5_plan` path cannot disagree.

```ts
export interface InvestmentVectors {
  horizonYears: number;
  capexByYear: number[];      // index 0 = Y1 ... index N-1 = YN (백만원)
  laborByYear: number[];      // staffing vector when a plan exists, else manual labor lines
  opexByYear: number[];
  govRndByYear: number[];     // inflows, never inside 투자비
  foreignLines: { label: string; amount: number; currency: string }[]; // excluded, flagged
  skippedLines: { label: string; reason: string }[];
  hash: string;               // FNV-1a hex over the vectors — the divergence anchor
}
export function buildInvestmentVectors(lines: unknown, horizonYears: number): InvestmentVectors;
export function drawInvestmentVectors(base: InvestmentVectors, sim: SimulationAssumptions, rng: () => number): InvestmentVectors; // per-draw perturbation, §4
```

- `buildInvestmentVectors` is the single implementation; the private `buildS5InvestmentPlan` in `business-case-generator.ts` is refactored to call it (slice 1) — behavior-preserving, guarded by a golden test on the existing `s5_line_hash` values. The S5 summary panel's totals (ADR-0174) switch to reading the same vectors (labor from the ADR-0175 staffing vector when a plan exists).
- `drawInvestmentVectors` applies the §4 ranges with one shared `rng` stream so a draw index d means the same vectors everywhere (per-draw pairing, §6).
- The module owns no storage and no I/O; it is importable by the S5 API route, the S8 generator and tests alike.

## 4. The S5 investment simulation (deliverable a)

**New file `lib/investment-simulation.ts`** — a seeded, deterministic Monte Carlo over the investment plan only (no revenue, no WACC), mirroring the conventions of `runSeededSimulation`.

### 4.1 Variables and default ranges

All ranges are user-editable and human-confirmed before results are shown as more than a preview. Distribution for every bounded variable: **triangular (min, mode = entered value, max)** — bounded ranges must not produce negative amounts or heavy tails, unlike the unbounded revenue growth which rightly stays Normal. Salary variables only range-shift the analyst-provided base; a row without a salary is excluded from cost (ADR-0175) and therefore from the simulation, never fabricated.

| Variable | Scope | Default range | Shape |
|---|---|---|---|
| 급여 수준 (salary level) | each staffing row with a salary | base ±10% | triangular on the row's base salary multiplier |
| 연 인상률 (salary increase) | each staffing row | entered ±2%p, floored at 0 | triangular |
| 가산율 (on-cost) | each staffing row **only after the person has entered a rate** (ADR-0175: no default, HR/counsel confirm) | entered ±2%p, floored at 0 | triangular; inactive while empty |
| 인원 투입 시점 (headcount ramp) | whole plan | ±half-year: shift `headcountByYear` back/forward one year with triangular weights (0.25 / 0.5 / 0.25); the half-year fraction interpolates between the shifted and unshifted vectors | discrete mix |
| 역량 해소 비용 (capability costs) | each reflected capability entry | ±30% | triangular |
| 수기 투자 항목 (manual investment lines) | each manual line (capex, labor, opex; lump and recurring alike) | ±20% | triangular |
| 환율 (FX) | foreign lines **only if and when conversion is enabled**; today non-KRW lines are excluded from totals (ADR-0174), so this variable is defined but INACTIVE — it activates with the same condition that ever brings foreign lines into a KRW total | ±10% | triangular |

Defaults are starting points shown in an editable `가정 범위` panel; nothing runs beyond a preview until the person confirms the ranges (`가정 확정` — human-only, audited).

### 4.2 Engine

- Seed: `scenarioSeed(opportunityId, "s5_invest")` — same FNV-1a helper, deterministic and reproducible (ADR-0052 §D.4).
- Draws: default **500** (`drawInvestmentVectors` per draw over the shared `rng` stream), user-editable 100..5,000 (a draw is O(N) vector arithmetic; 500 draws × 15 years × 5 vectors is trivially fast — OD-1). Each draw produces full `InvestmentVectors`, from which the run keeps:
  - **Yearly bands**: per year Y1..YN and per category (capex, labor, opex) plus the 투자비 total, the **p05 / p50 / p95** of the drawn values (OD-2: p05/p95, not p10/p90, to match the persisted `valuation_simulation` percentile convention across the system).
  - **Total-over-horizon distribution**: p05/p50/p95/mean/std of Σ years.
  - **Tornado (민감도)**: one-at-a-time perturbation of each variable from min to max on the deterministic base, ranked by the resulting change in total investment — computed analytically from the triangular bounds (no extra draws), attributed per variable.
  - **예산 상한 초과 확률** (budget-exceed probability): when the person sets a `예산 상한` (백만원, over the horizon), the share of draws whose total exceeds it; no output when unset.
- The deterministic base case (all modes at center) is always reported alongside, and equals the ADR-0174 totals — same module, so they cannot drift.

### 4.3 Storage — recommendation: a run table

Investigated options:

1. **`business_case_lines_json` meta entry** — rejected: results are machine-scale JSON (bands × years × categories × percentiles), rewritten on every S5 save alongside line edits; the array is a plan, not a run log, and every consumer would need render-guards for a third meta shape.
2. **Existing `run`/`run_input`** — rejected: project-scoped (`project_id NOT NULL`); S5 is pre-promotion.
3. **New table `investment_simulation_run`** — **recommended**, matching ADR-0005 run-based versioning and the `valuation_simulation` precedent: an S5 run is a versioned, hash-anchored, reproducible artifact that S8 must be able to reference stably.

```sql
CREATE TABLE investment_simulation_run (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL,
  input_hash TEXT NOT NULL,        -- FNV-1a over (lines json + confirmed ranges) = the hash S8 references
  seed INTEGER NOT NULL,
  draw_count INTEGER NOT NULL,
  assumptions_json TEXT NOT NULL,  -- the confirmed ranges per variable + envelope if set
  results_json TEXT NOT NULL,      -- bands, total distribution, tornado, exceed probability
  status TEXT NOT NULL DEFAULT 'done',   -- confirmed | superseded
  superseded_by TEXT REFERENCES investment_simulation_run(id),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

Per-draw investment vectors are **not stored** — they are recomputed on demand from `(seed, draw_count, base lines, ranges)` by the shared module (deterministic), so the results JSON stays small. This migration is the ADR trigger. Legacy data: no rows → no simulation exists; the S5 panel shows only the deterministic totals, unchanged.

### 4.4 UI placement — the `투자비 요약` panel

Inside the existing panel (Onyx 3.0 tokens, existing table/stat components):

1. A `투자 시뮬레이션` collapsible sub-block under the schedule table: `가정 범위` grid (the §4.1 variables with editable min/max inputs, defaults prefilled), `시뮬레이션 실행` (writes a run row, audit `investment_simulation.run`), and `가정 확정` (human-only confirmation enabling the run, audit `investment_simulation.confirmed`).
2. Bands on the schedule table: each Y column of the 투자비 rows shows the p50 value with a `p05–p95` sub-line (muted); the inflow rows (매출, 정부 R&D) carry no bands — they are not simulated here.
3. Summary strip: `총 투자비 p50 (p05–p95)` tile, `예산 상한 초과 확률` tile when an envelope is set, draw/seed provenance line (`시드 … · 500회 · 가정 확정 일시`).
4. Sensitivity list: ranked tornado bars (variable name, ± effect on total in 백만원), proposal-only context, no gate effect.

The simulation is decision support only: it never blocks a gate, never caps a grade, and its results are proposals a person reads (design boundary 2).

## 5. Governance (deliverable d)

- **Human-only assumptions**: ranges are edited and confirmed by a person; the confirm action is audited. No LLM proposes a range for salary variables beyond an editable default that only shifts an analyst-provided base; **no salary value is ever generated** (ADR-0175 rule, unchanged).
- **Proposal-only**: no gate block, no adoption trigger, no RAG effect. AI judgement support may cite the simulation's bands and exceed probability as evidence fragments (§7), labeled as simulation output with its hash.
- **Audit events**: `investment_simulation.confirmed`, `investment_simulation.run`, each recording actor, seed, draw count and `input_hash`.
- **Wiki/glossary**: new terms `투자 시뮬레이션` (investment simulation), `예산 상한 초과 확률` (budget-exceed probability), `재평가 필요` (re-evaluation required flag — already used by ADR-0170, glossary entry to be added if missing); tooltip integration via the existing glossary pipeline.

## 6. S8 consumption (deliverable b continued)

When `bc.investment_basis = s5_plan` (or `s5_plan_full`), the S8 generator takes the **S5 simulation's drawn investment vectors as its investment uncertainty** instead of its current single-point plan vector:

- At generation, the route loads the latest **confirmed** `investment_simulation_run` for the source opportunity. If none exists, behavior is today's (deterministic vector, no investment uncertainty) with a note fragment `s5_sim=none`.
- Per-draw pairing: draw d of the S8 Monte Carlo uses `drawInvestmentVectors(base, ranges, stream)` at index d — the same vectors the S5 run computed for draw d (same seed function, same stream position), so the two stages see identical investment scenarios. S8's revenue/WACC draws keep their existing independent stream; only the capex/labor/opex vectors per draw come from the S5 sim (capex per year under `s5_plan`; labor/opex replace the opex ratio per draw only under `s5_plan_full` — the same opt-in semantics ADR-0174 defines, now per draw).
- Provenance: the run note gains `s5_sim=<input_hash>` alongside the existing `s5_line_hash` fragment; the evaluation summary displays it.
- **Staleness**: whenever an S8 view, the evaluation summary or the AI judgement support renders results whose note carries an `s5_sim` hash different from the latest confirmed S5 run's hash (or the S5 lines' `input_hash` changed), a `재평가 필요` badge is shown — the ADR-0170 pattern (hash compare, flag, never auto-recompute). Re-running S8 clears it.
- The python sim-engine path stays bypassed under `s5_plan` (ADR-0174 honest limits carry over); the seeded TS fallback is the executor for this path and the note's `engine=` fragment records it as today.

## 7. The S8 사업서 평가 surface (deliverable c)

An `투자 불확실성` block in the S8 evaluation summary (and in the generated case prose), feeding the project gate brief and the AI judgement support:

- `총 투자비 p50 / p95` (백만원, over the S5 horizon), `예산 상한 초과 확률` when the S5 run carried an envelope, and the top sensitivities (compact list, three rows).
- NPV/IRR percentile context: one line stating that the case's NPV distribution includes investment uncertainty via the S5 simulation (`S5 투자 시뮬레이션 반영` chip) or, when no run exists, `투자 불확실성 미반영 (S5 시뮬레이션 없음)`.
- Gate brief: the block's numbers are appended to the fs gate brief inputs as labeled simulation output (proposal-only); the AI judgement support may cite them with the hash. The gate decision remains human.

## 8. Slices

1. **Shared vectors module + S5 deterministic bands**: extract `lib/investment-vectors.ts` (refactor `buildS5InvestmentPlan`, golden tests on existing hashes), switch the S5 summary to it, add the p05–p95 rendering plumbing with a trivial zero-width band (no simulation yet). No S8 behavior change (bit-identical hashes asserted).
2. **S5 draws + sensitivity + envelope probability + storage**: `lib/investment-simulation.ts`, ranges panel, `가정 확정`/`실행` actions, migration `investment_simulation_run`, bands/strip/tornado UI, audit events.
3. **S8 consumption + provenance + 재평가 필요 flag**: per-draw pairing under `s5_plan(_full)`, `s5_sim` note fragment, staleness badge, `s5_sim=none` fallback note.
4. **S8 evaluation block + gate brief + AI support**: `투자 불확실성` block, gate-brief inputs, judgement-support citation fragments.

## 9. Tests

- Shared module: golden `hash` stability before/after the refactor; vector parity with `buildS5InvestmentPlan` on fixture models; staffing-vector labor; excluded/skipped lines.
- Simulation: seeded reproducibility (same seed → identical results JSON); triangular draws bounded (never negative, never beyond min/max); headcount shift weights; salary-less rows contribute nothing; on-cost variable inactive while empty; FX variable inactive while foreign lines are excluded; deterministic base equals the ADR-0174 totals; tornado ranking correct on a synthetic plan; exceed probability at 0 and 1 boundaries.
- Storage: exactly one active run per opportunity (supersede chain); run without confirm rejected (400); consumer render-guards unaffected (no lines-json change in this design).
- S8: `ratio` basis bit-identical (golden); `s5_plan` with no S5 run equals today's output; with a run, per-draw capex equals drawInvestmentVectors at the same index (pairing test); note carries `s5_sim`; hash mismatch → `재평가 필요` badge in the summary payload.
- Audit events recorded; human-only confirm enforced server-side.

## 10. Risks

- **Divergence between S5 and S8 investment uncertainty** — the core risk this design exists to kill; mitigated by the single shared module, per-draw pairing, hash provenance and the staleness flag, and by slice-1 golden tests.
- **False precision**: bands from ±ranges that were never seriously considered; mitigated by human confirmation before runs, visible provenance, and proposal-only framing.
- **Salary fabrication by implication** (a range implies a value): the range only multiplies an analyst-entered base; rows without a base stay out of cost and simulation.
- **Performance**: negligible at the recommended draw counts; the clamp (100..5,000) bounds it.
- **Engine parity**: unchanged from ADR-0174 — the TS fallback owns this path.

## 11. Existing-data impact

- S5: none until a first run; the panel gains an unexecuted simulation block. No lines-json change.
- S8: existing `s5_plan` cases keep bit-identical output until an S5 run is confirmed (fallback `s5_sim=none`); `ratio` cases are untouched throughout.
- Migration: additive new table only; no existing table altered.

## 12. Open decisions (resolved 2026-10-15)

Resolved by the human decider's chat acceptance of the ADR (2026-10-15, "ADR-0175 / ADR-0176 승인"); each is resolved as recommended below. The decider did not review a per-item checklist.

- **OD-1 Draw count and performance**: recommend default 500, user-editable 100..5,000, stored per run. Alternative: reuse S8's `bc.iterations` scale (10k+) — rejected, no accuracy gain for bounded triangular variables at this dimensionality.
- **OD-2 Percentile convention**: recommend p05/p50/p95 (matches `valuation_simulation` and every existing percentile surface) over the p10/p90 phrasing of the original request — one convention system-wide.
- **OD-3 Run storage**: recommend the new `investment_simulation_run` table (§4.3); a lines-json meta entry or the project-scoped `run` table are the rejected alternatives, each for a stated structural reason.
- **OD-4 Gate confirm vs simulation**: recommend NOT requiring an S5 simulation before an S8 `s5_plan` gate confirm — absence is surfaced (`투자 불확실성 미반영`) and the gate brief names it, but the gate stays human and unblocked. Alternative: block — rejected, it inverts the proposal-only boundary.
- **OD-5 FX distribution shape**: recommend triangular ±10%, defined but inactive while foreign lines are excluded from totals (ADR-0174); it activates only with the same future change that converts foreign lines into a KRW total.
- **OD-6 Staffing on-cost uncertainty before HR confirmation**: recommend the on-cost variable participates ONLY after the person has entered a rate (an entered rate is an editable assumption per ADR-0175; until then the sim costs salary only, and the summary already flags `가산율 미입력`). Alternative: simulate a wide default band — rejected, it would assert a statutory-shaped rate the system must not own.
- **OD-7 Half-year ramp mechanics**: recommend the discrete back/hold/forward year-shift with triangular weights and linear interpolation of the half-year fraction (§4.1) — simple, explainable in the UI. Alternative: per-row independent shifts — rejected for now, it multiplies variables before there is evidence rows are independently timed.

## 13. Not verified

- Nothing in this design is exercised in a browser or against the live database; all machinery claims come from reading `lib/business-case-generator.ts`, `lib/capability-cost-lines.ts`, the migration files and the shipped ADR-0174/0175 designs.
- Exact `MC_ITERATIONS` default value and the current `bc.iterations` usage were located but not re-derived; the draw-count recommendation stands independently of it.
- Whether any MCP greenfield handler would surface a future lines-json change — moot here (no lines-json change), noted for ADR-0175 parity.
- The glossary's current coverage of `재평가 필요` was not checked term-by-term; the wiki/glossary slice includes the check.
