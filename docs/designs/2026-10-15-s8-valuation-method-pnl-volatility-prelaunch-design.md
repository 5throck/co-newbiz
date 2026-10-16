---
title: S8 valuation method — S5 plan lines as P&L items, per-item volatility, separate pre-launch investment
status: accepted
date: 2026-10-15
owner: platform-lead
lang: ko
lang_reason: proper-noun
---

# S8 valuation method — S5 plan lines as P&L items, per-item volatility, separate pre-launch investment

Korean appears only as UI labels/product terms in backticks. All prose is English. Paths are relative to `app/web-next/` unless stated.

- Decider: human decider, chat 2026-10-15. Round 1: recommended option on all three questions (split volatility by item, S5 plan lines as P&L items, separate pre-launch year-0 investment). Round 2 (same day) answers: year-0 by per-line marking `startYear: 0` (OD-1/2/3 as recommended); S5 cost lines are entered with the ramp already reflected, so utilization scales revenue only (OD-7); **cost uncertainty comes from the confirmed S5 investment simulation run, not from a separate S8 sigma**; OD-4..OD-8 as recommended, adjusted. Round 3 (same day): Green Field S5-S8 linkage = option B — **S5 is the single source, S8 holds a pinned reference** (no row copy for the new path, no live read; §4A). ADR-0178 accepted by the decider in chat 2026-10-15 ("승인 + OPEN-1~3 추천안"), recorded in DEC-20261015-06. Drafted by platform-lead.
- ADR: [ADR-0178](../adr/0178-s8-valuation-pnl-volatility-prelaunch.md) (Accepted 2026-10-15, DEC-20261015-06).
- Builds on: ADR-0174 (total investment, `bc.investment_basis`, promotion copy, `s5_line_hash`), ADR-0175 (staffing plan, salary human-sourced only), ADR-0176 (S5 investment simulation, per-draw pairing, `s5_sim` hash, `재평가 필요`), ADR-0170 (staleness pattern), ADR-0052 §D.4 (seeded reproducibility), the Brown Field anchor/benchmark designs of 2026-10-10.
- Valuation review: valuation-agent findings that still apply are folded into §5, §7 and §13. Items marked **[VR-moot]** were open review points in round 1 and are closed by the round-2 answers.

## 1. Problem statement

1. **One sigma for everything.** `runSeededSimulation` draws only revenue growth (`anchorGrowth + disp * z`), `disp` clamped to [`DISP_FLOOR` 2%, `DISP_CAP` 25%], derived from DART historical revenue vol blended with WACC asset vol (Green Field: asset vol only). Cost moves only as a ratio of revenue; investment uncertainty enters only through the ADR-0176 S5 capability/manual factors.
2. **Ratio P&L.** On the ratio basis a year's flow is `revenue x (1 - opexRatio(0.6) - capexRatio) x utilization`. Under `s5_plan` / `s5_plan_full` the plan partially substitutes; the plan's line structure is not the P&L.
3. **Year-0 conflation.** Year-0 is `initial_investment_ratio x year-1 revenue`, or under `s5_plan` the plan's Year-1 capex (OD-3 of ADR-0174), mixing pre-launch outlay and launch-year capex.

## 2. Verified current state (code, 2026-10-15)

- `lib/business-case-generator.ts`: `DISP_FLOOR=0.02`, `DISP_CAP=0.25`, `clampDisp`; market disp derivation (~l.180-212). `runSeededSimulation` (~l.356): `scenarioSeed` -> `mulberry32`; one `normalPair` per year > 1 (only `z1` used). S5 factors `capFactors/manFactors[it % drawCount]` precomputed so the revenue rng stream is untouched. Under `s5_plan` the paired factors perturb capex (`drawnCapex`) every year; labor/opex is perturbed (`drawnLaborOpex`) only under `s5_plan_full` and only for plan-covered years. Deterministic BEP path recomputes flows without noise and calls `discountedPaybackYear(detInitial, ...)`.
- `lib/investment-simulation-s8.ts`: `S5SimConsumption` carries only `capFactors` and `manFactors`, computed by `drawInvestmentFactors(run.seed, run.draw_count, run.assumptions)`. Its own comment states the ramp/salary groups are not consumed because S8 does not carry the staffing plan. `resolveS5SimConsumption` picks the latest confirmed run by opportunity id; `s5SimStatusForProject` already distinguishes `run_changed`, `s5_lines_changed`, `run_missing`.
- `lib/investment-simulation.ts`: `DrawFactors { salary, inc, onc, ramp, cap, man }`, `drawInvestmentFactors`, `simulateInvestment`, `simulationInputHash(input, seed, draws)`. `lib/investment-vectors.ts`: `buildInvestmentVectors`, `staffingAnnualVectorWithFactors`, `effectiveAssumptions`. `lib/investment-simulation-input.ts`: `loadInvestmentVectorsInput` (loads the S5 source of an opportunity).
- `initialInvestmentOf` (~l.874): Brown Field -> `anchor revenue x EV/Revenue` unless the user pinned `bc.initial_investment_ratio`; else ratio x Y1 revenue.
- `InvestmentBasis = "ratio" | "s5_plan" | "s5_plan_full"`, codes 0/1/2 in `bc.investment_basis`.
- `lib/capability-cost-lines.ts`: lines carry `startYear` (validated `1 <= startYear <= endYear <= horizon`), `endYear`; year 0 is not representable.
- The S5 plan reaches S8 only through the one-time promotion copy; a human-triggered re-import is in flight (uncommitted, not reviewed).
- The python sim-engine is bypassed whenever explicit plan vectors are in play.

## 3. Decision summary (all opt-in)

| Axis | Today (kept bit-identical) | New (opt-in) |
|---|---|---|
| P&L | ratio, or ratio with plan substitution | `bc.investment_basis = 3` (`s5_pnl`): S5 lines are the P&L items |
| Year 0 | ratio x Y1 revenue, BF acquisition EV, or plan Y1 capex (OD-3) | sum of lines marked pre-launch (`startYear: 0`); Y1 capex stays in Y1 |
| Volatility | one revenue sigma; S5 capability/manual factors on capex | `bc.vol_mode = 1` (`split`): revenue sigma (as today, optionally person-confirmed) + **all** plan cost lines (labor/staffing, opex, gov_rnd, capex incl. Y0) take uncertainty from the confirmed S5 run's per-draw, per-year, per-category vectors |

Nothing changes for a project until a person sets the new basis/mode. Brown Field excluded from slices 1-4 (§6).

## 4. Data model

### 4.1 Pre-launch flag (decided: `startYear: 0`)

`startYear: 0` on S5 line JSON means "pre-launch / `출시 전`". No new field, no `plan_meta` list, no column. Legacy lines cannot carry 0 (the validator rejects it today), so every existing line hashes and computes identically. Rules (decided OD-2): only `capex`-category and manual lump-sum lines may be pre-launch; such lines must have `endYear` null/0. `activeYearsOf` stays Y1..YN; new `preLaunchAmountOf(lines)` returns the year-0 sum; `validateLineYears` accepts 0 for eligible lines only. `s5_line_hash` changes only for lines that actually use 0.

Rejected: `phase` field (redundant, can contradict `startYear`), `plan_meta` list (splits a line's timing), `business_case_line` column (does not reach opportunity-keyed S5 JSON).

### 4.2 Promotion/re-import copy

Both copy `startYear` verbatim. Verified: `business_case_line.start_year` is `INTEGER NOT NULL DEFAULT 1` with no CHECK (migrations 0044/0102/0143), so `0` is storable without a migration; the copy's own validation must accept it (Slice 1). On the pinned path (§4A) the flag is read from the S5 source directly and the copy is irrelevant to computation.

### 4.3 New assumptions (all human-set)

- `bc.investment_basis = 3` (`s5_pnl`); unknown/absent codes keep today's behavior.
- `bc.vol_mode` (0 = single, default; 1 = split).
- `bc.vol.revenue` — optional person-confirmed revenue sigma, 0-50%, source note mandatory, >50% rejected (400). No cost or investment sigma assumption exists (round-2 decision: cost uncertainty is the S5 run's).

### 4.4 Bit-identical guarantee

Golden tests (Slice 1) freeze `runSeededSimulation` outputs (p05/p50/p95/mean/std/bepYear) and notes for: ratio GF, ratio BF with anchor + acquisition, `s5_plan`, `s5_plan_full`, `s5_plan` + confirmed S5 run, GF without historical data. Every slice keeps them byte-equal; new code branches only on `basis === "s5_pnl"` or `volMode === "split"`.

## 4A. S5-S8 linkage: pinned reference (decided, option B)

### 4A.1 Principle

S5 is the single source of the Green Field plan. On the new path S8 does not copy S5 rows; it stores only a **pin** — a reference to one specific S5 plan version identified by a hash — and reads the S5 source (`greenfield_assessment.business_case_lines_json`: lines incl. `startYear`/pre-launch, `plan_meta` incl. simulation overrides, staffing plan; the capability register judgements that `buildInvestmentVectors` uses; the confirmed `investment_simulation_run`) through the shared modules `loadInvestmentVectorsInput` / `buildInvestmentVectors` (and §7.2's per-draw function). There is no live-read mode (rejected option C): S8 computes only against the pinned version, and if the source no longer hashes to the pin, S8 does not silently use the new source.

### 4A.2 Where the pin is stored — decision: a small append-only table

| Option | Verdict |
|---|---|
| Assumption row (`bc.*`) | Rejected: the assumption store is numeric per key; a hash plus run id plus audit history does not fit, and assumption edits have their own invalidation semantics |
| New column on `project` / `business_case_model` | Rejected: no history of re-pins; a model-level column ties the pin to one case while all cases of a project must share it |
| **New table `s5_plan_pin`** | **Recommended**: `id`, `project_id`, `opportunity_id`, `plan_hash`, `s5_sim_run_id` (nullable), `s5_sim_input_hash` (nullable), `pinned_by`, `pinned_at`, `superseded_at` (null = current), `reason` (`initial` / `repin`); one current row per project (partial unique index). Append-only; old pins are superseded, never deleted |

Accepted addition (OPEN-1): the row also stores `input_snapshot_json` — the pinned `loadInvestmentVectorsInput` result. S8 computes against this snapshot; the live S5 source is read only to compute the current hash for the stale check and to build the next pin at re-pin time.

This is a schema change, so a migration is required; it is assigned to **Slice 0**. ADR-0178 itself carries it (it is the ADR that decides the table); no separate ADR is needed provided ADR-0178 is accepted with this section. If the decider wants the table decided separately, an ADR-0178 amendment suffices.

### 4A.3 What is hashed (`plan_hash`)

A canonical JSON (sorted keys, numbers as stored) over: every S5 plan line with category, amount fields, `startYear` (incl. `0` = pre-launch), `endYear`, lump-sum/spread, source (`manual` / `capability` / `staffing_plan`); the staffing plan entries (headcount by year, salary, increase, on-cost, recruiting); `plan_meta` incl. horizon and simulation overrides; the capability register judgement fields that change capability line amounts (the inputs `buildInvestmentVectors` reads). This is exactly the input of `loadInvestmentVectorsInput`, so the recommended implementation is `plan_hash = hash(loadInvestmentVectorsInput(opportunity))` — one definition shared with the S5 simulation's `simulationInputHash` (minus seed/draws). The existing `s5_line_hash` (computed over the copied model's year vectors, keyed by model id) stays for the compat path only.

### 4A.4 Stale rules

S8 shows `재평가 필요` (ADR-0170 pattern) for a pinned project when any of:
1. `hash(current S5 source) != pin.plan_hash` — S5 lines, staffing, plan_meta or capability judgements changed.
2. A newer confirmed S5 simulation run exists than `pin.s5_sim_run_id`, or the pinned run was superseded.
3. A case/run was generated against a pin that is no longer current (case note `s5_pin=` != current pin id).

Stale never blocks a gate, never changes a grade, never changes a result.

### 4A.5 Re-pin action (`최신 S5로 갱신`)

- One human action on the S8 ParamsPanel; shows the diff between pinned and current S5 (totals by category and year, pre-launch total, staffing totals, run id) before confirming.
- Effect: supersede the current pin row, insert a new one with the current `plan_hash` and the latest confirmed S5 run; audit `s5_plan_pin.repinned` (actor, old/new hash, old/new run id).
- Permissions: human only (no MCP write tool, no agent path), role analyst or above on the project; agents may only read pin state and propose a re-pin in text.
- It does not regenerate cases. Re-pinning only moves the reference; the person then regenerates S8 (existing action).

### 4A.6 Cases and simulations generated against an old pin

Persisted cases, `valuation_simulation` rows and adopted/confirmed results are never recomputed or altered by a re-pin. Their notes carry `s5_pin=<pin id>` and `plan_hash=`; after a re-pin they show `재평가 필요` and stay as the record. An adopted case remains adopted until a person adopts another one.

### 4A.7 Interaction with ADR-0176 `s5_sim`

The pin carries the S5 run reference: S8 consumes `pin.s5_sim_run_id`, not "the latest confirmed run". `resolveS5SimConsumption` gains a pinned variant (run by id). The existing `s5_sim=<input_hash>` note fragment stays; the `run_confirmed_after_generation` / `run_changed` staleness reasons map to stale rule 2. Under the compat path (no pin) ADR-0176 behavior is unchanged.

### 4A.8 Compatibility and the re-import action (PR #590)

- **Compat path (bit-identical)**: a project without a pin row keeps reading the copied `greenfield_cost` model exactly as today (`resolveS5InvestmentPlan`, `s5_line_hash`, latest-confirmed S5 run). Golden tests cover it.
- **Promotion copy kept**: `promoteOpportunity` keeps writing the one-time `greenfield_cost` copy (via `writeS5CostModel`) because the compat path, the S8 business-case line editor/view (`lib/business-case.ts`, `app/api/projects/[id]/business-case/route.ts`) and Brown Field/other paths still read model lines. Additionally, promotion writes the initial pin row (`reason=initial`) once Slice 0 ships — but a pin only changes S8 computation once the new path is switched on (§4A.9).
- **Re-import (PR #590: `db/repositories/s5-cost-import.ts` `applyS5Reimport`, the `s5-reimport` route, ParamsPanel button)**: kept unchanged as the interim mechanism until Slice 0 ships. In Slice 0 the same button becomes `최신 S5로 갱신`: for pinned projects it re-pins (§4A.5) and also refreshes the compat copy through the existing `writeS5CostModel` (so line views stay consistent); for unpinned projects it behaves exactly as today. Once all consumers in §4A.10 read the pin (end of Slice 2), the copy refresh is reduced to a display convenience and may be retired by a later decision (not proposed now).

### 4A.9 Switching a project to the pinned path

**Amended 2026-10-16 (ADR-0178 amendment; DEC-20261016-01): the pinned path is the DEFAULT, not opt-in.** For every Green Field project with an importable S5 plan — existing projects included — the pinned-reference read path and the unified S5-plan investment basis are the default from the next generation (`bc.s5_source` defaults to pinned; auto-switch, not new promotions only). The person retains `복사본으로 되돌리기` (explicit revert, audited `s5_plan_pin.disconnected`); a reverted project can be reconnected by pressing `S5와 연결하기` again. Existing cases, simulations and adopted results are never recalculated silently by the switch; regeneration reflects the new basis. Projects with no importable S5 plan stay on the ratio estimate. The original opt-in wording (`bc.s5_source = 1` chosen per project by a person, default 0, "new projects may default to pinned only by a later decider choice") is superseded by this amendment. The investment basis is now the single `S5 투자 계획` (stored `s5_plan_full` code; the capex-only variant is a legacy stored value moved to unified on the next connect — PR #594). `s5_pnl` (§5) and `split` (§7) still require the pinned path; on the pinned path the plan bases read the same vectors from the source, so results equal the copy path when the copy is fresh — verified by a parity test in Slice 0.

### 4A.10 Consumers of the copied `greenfield_cost` model (graft grep, 2026-10-15)

| Consumer | Reads | Moves to pinned-source read |
|---|---|---|
| `resolveS5InvestmentPlan` (`lib/business-case-generator.ts` ~L1001), via `caseInputsBaseForProject` -> `caseInputsForProject` / `caseInputsForTarget` / `generateBusinessCases` | copied model lines -> `S5InvestmentPlan` | Slice 0 (pinned branch beside the compat branch) |
| `resolveBusinessCaseParams` (~L659, L703) | presence of a `greenfield_cost` model (basis resolution) | Slice 0 (pin presence counts as plan presence) |
| `buildS8JobSpec` (~L1328) | `s5.plan` year-0 / model id for the job note | Slice 0 (note gains `s5_pin=`) |
| `defaultExecutor` (~L1465) | fallback note when no model | Slice 0 |
| `writeS5CostModel` / `activeCostModels` / `applyS5Reimport` (`db/repositories/s5-cost-import.ts`) and `promoteOpportunity` (`db/repositories/project.repository.ts`) | writers of the copy | Stay (copy kept, §4A.8); re-import becomes re-pin in Slice 0 |
| S8 business-case view/editor (`lib/business-case.ts` ~L199, `business-case/route.ts`) | `business_case_line` of case models (generated cases, not only the copy) | Not moved: they show a case's own lines |
| S10 carry (`lib/greenfield-execution.ts` ~L143) | capex lines of the **adopted** case model | Not moved in this ADR: it reads the adopted case, which is frozen by design (§4A.6). Whether the adopted model is the copy or a generated case: not verified |
| IC package, gate brief, report composer (`lib/report-composer.ts`, `lib/s8-lens-summary.ts`, `lib/mcp/in-process-port.ts`) | no direct `greenfield_cost` read found; they read cases/runs/notes | Slice 4: surface `s5_pin` / stale state in text only |

## 5. P&L structure under `s5_pnl`

Cost input basis (decided OD-7): S5 labor/opex lines are entered per year with the utilization ramp already reflected. Therefore utilization scales revenue only; plan cost lines are not scaled by utilization.

Per year t = 1..N:

```
revenue_t   = drawn revenue
opex_t      = plan labor/staffing_t + plan opex_t + plan gov_rnd_t       (plan-covered years; NOT x util_t)
            = revenue_t x util_t x opexRatio                             (ratio-fallback years)
capex_t     = plan capex lines active in t                               (Y1 capex stays in Y1)
flow_t      = revenue_t x util_t - opex_t - capex_t
year 0      = -(sum of pre-launch lines), undiscounted
```

- **Fallback per year**: a year with no plan opex coverage uses ramped revenue x `opexRatio`; capex for a year inside the plan horizon with no line is 0; beyond the horizon `revenue_t x util_t x capexRatio`. Each fallback year is labelled `비율 대체 (계획 미포함 연도)`.
- **No plan** (decided OD-6): `s5_pnl` without an S5 plan is refused at save (400 with reason).
- **Pre-launch empty** (decided OD-3): year 0 = 0 with warning `출시 전 투자 미지정`; no ratio fallback.
- **Pre-tax cash proxy**: no tax, working capital or depreciation; the methodology panel labels the result `세전 현금흐름 근사` and lists taxes under "could not verify".
- **Terminal value vs plan margin flag**: exit value stays `revenue_N x exitMult` (an EV/Revenue multiple that embeds a market margin). When the plan-implied final-year margin `(revenue_N x util_N - opex_N) / revenue_N` diverges from the margin implied by the comparable set, the panel shows a flag `처분가치 배수와 계획 마진 불일치 가능` — a flag only, no adjustment.
- **Year-0 undiscounted**: the pre-launch outlay is placed at t=0 regardless of its actual pre-launch duration; multi-year construction before launch is understated in time value. Stated as a limit.

## 6. Brown Field

Out of slices 0-4 (decided OD-5), including the pin model of §4A: the S7 per-target structure and Brown Field year 0 are unchanged, and Brown Field projects never get a pin row. `s5_pnl` is rejected for BF projects with a reason. BF year 0 stays the acquisition EV. Optional Slice 5: acquisition EV plus BF lines marked pre-launch shown as a separate `인수 후 즉시 투자` row, never merged without provenance.

## 7. Monte Carlo, engine bypass, deterministic path

### 7.1 Revenue

Unchanged draw `revenue *= 1 + g + sigma_rev * z1`, same rng stream, same `normalPair` call; the second normal stays unused (round-2: it is NOT a cost source). `sigma_rev` = today's derived `disp`, unless a person confirmed `bc.vol.revenue` (0-50%, source note mandatory). Zero-truncation: the per-year growth factor `1 + g + sigma_rev * z1` is truncated at 0 (revenue cannot go negative); the note records the effective sigma (sample std of applied growth) and the truncation count. With the derived `disp` (<= 25%) truncation is practically unreachable, so today's outputs stay identical; the truncation guard is applied only on the `split` path to keep the golden tests byte-equal.

### 7.2 Cost and investment — from the confirmed S5 run (decided)

Every plan-derived cost line — labor/staffing, opex, gov_rnd (where the basis includes it), capex including year-0 pre-launch lines — takes its uncertainty from the confirmed S5 simulation run via ADR-0176 per-draw pairing (`pairedDrawIndex(it, drawCount)`). No S8 cost sigma exists.

**What must be extended (today vs target):**

| Item | Today (ADR-0176 slice 3) | Target (`split`) |
|---|---|---|
| Capex Y1..YN | paired `cap`/`man` factors applied to promoted plan capex | per-draw S5 capex vector |
| Capex Y0 | n/a | per-draw S5 vector's year-0 component |
| Manual opex/labor lines | perturbed only under `s5_plan_full`, plan-covered years | per-draw S5 vector, every plan-covered year |
| Staffing labor | not perturbed (salary/inc/onc/ramp factors not consumed — staffing plan is not promoted to S8) | per-draw S5 staffing vector (salary, increase, on-cost, ramp factors applied) |
| gov_rnd | single-point | per-draw S5 vector if the S5 run perturbs it; else single-point with label |

**How S8 carries them — decision: recompute from seed at the S5 source, not from promoted lines.** With §4A this is the pinned-source read: S8 uses the pinned run (`pin.s5_sim_run_id`), loads the opportunity's S5 source with `loadInvestmentVectorsInput`, verifies `simulationInputHash(input, run.seed, run.draw_count) === run.input_hash`, and recomputes per-draw, per-year, per-category vectors with `drawInvestmentFactors` + the `buildInvestmentVectors` / `staffingAnnualVectorWithFactors` path (one shared function in `lib/investment-simulation.ts`, e.g. `drawInvestmentVectorsPerDraw(input, seed, draws, eff)`, also used by `simulateInvestment` so S5 bands and S8 draws cannot diverge).

Justification:
- The staffing factors need the staffing plan, which is not promoted; S5 source is the only place they can be applied correctly.
- Per-draw vectors are not stored (ADR-0176 decision 4); recomputation from (seed, source, ranges) is the designed reproduction path.
- The input-hash check makes the pairing honest: if the S5 source changed since the run, S8 does not mix a new plan with an old run.
- Rejected: applying more factors to promoted lines (cannot reconstruct staffing vectors from aggregated promoted lines; would be a second, divergent formula); storing per-draw vectors in a new table (storage + a migration for data that is reproducible).

Consequences: `split` requires the pinned path (§4A.9); both the deterministic P&L and the draws read the pinned S5 source, so they cannot disagree. If the S5 source no longer hashes to the pin (S5 edited, not re-pinned), the mismatch path below fires.

**Failure modes (never fabricate):**
- No pinned confirmed run, or input-hash mismatch: cost lines are single-point from the pinned plan version, labelled `원가 불확실성 미반영 (S5 시뮬레이션 미확정/변경됨)`, and the case shows `재평가 필요` per ADR-0170/0176 (`run_missing` / `run_changed` / `s5_lines_changed`).
- Ratio-fallback years (no plan line): cost carries no volatility, labelled `비율 대체 연도는 원가 불확실성 미포함` ("cost uncertainty not included for fallback years"). No sigma is invented.

### 7.3 Independence (explicit simplification, not a finding)

The revenue draw (S8 rng stream) and the S5-run draws (S5 seed) are independent by construction. This is a stated simplification: in reality cost and investment may co-move with volume and prices. Revenue-to-cost/investment correlation is out of scope for this ADR (decided OD-4).

### 7.4 Engine bypass and deterministic path

- Python engine bypassed for `s5_pnl` and `split`; note records `engine=ts` and the reason.
- Deterministic BEP/payback: noise-free flows, year 0 = pre-launch sum, plan opex/capex from the pinned S5 source (no draws). Guard: when pre-launch = 0, `discountedPaybackYear` is not called with a zero initial outlay; payback is reported as `해당 없음 (출시 전 투자 0)`.

## 8. Provenance, hashes, staleness

- Pinned-path notes gain `s5_pin=<pin id>` and `plan_hash=`; stale rules are §4A.4.
- Run note gains `vol_mode=`, `sigma_rev=` (applied), `sigma_rev_eff=`, `rev_trunc=`, `sigma_rev_src=derived|confirmed`, `cost_unc=s5_run|none|stale`, `prelaunch_krw_m=`, alongside `seed=`, `basis=`, `s5_line_hash=`, `s5_sim=`.
- `s5_line_hash` covers `startYear`; the S5 input hash covers the staffing plan. Either change raises `재평가 필요` through the existing comparison.
- A change to confirmed `bc.vol.revenue` must mark the case `재평가 필요` (verify in Slice 3 whether assumption edits already invalidate; if not, add `vol_hash` to the note).

## 9. Human-owned inputs

- Revenue sigma: derived value shown with source; a person may confirm an override (0-50%, source note mandatory). Cost/investment ranges are the S5 simulation's human-confirmed ranges (ADR-0176) — no S8-side ranges.
- Pre-launch flag: set per line by a person; an AI may suggest as a labelled proposal only.
- No default prices, salaries or cost lines; salaries only analyst-sourced (ADR-0175).
- Decision support only: no gate block, no RAG grade effect, adoption stays human. Data confidence continues to cap the RAG grade (non-negotiable #4).

## 10. UI surfaces

- **S5 cost lines**: `출시 전 (Y0)` option for capex/manual lump-sum lines; `투자비 요약` gains a `출시 전 투자` tile and a Y0 column; the S5 simulation bands include Y0.
- **S8 ParamsPanel**: source row showing `S5 고정 참조` (pin id, pinned at/by, run id) or `복사본 (기존 방식)`; the existing re-import button becomes `최신 S5로 갱신` with a diff preview (§4A.5); basis selector gains `S5 계획 손익 (s5_pnl)` (disabled with reason for BF / no pin); `변동성` section: mode toggle, revenue sigma row (derived value + source, optional confirmed override with source note), a read-only cost row showing the pinned S5 run state (`S5 시뮬레이션 기반` / `미확정` / `재평가 필요`).
- **ValuationMethodology.tsx**: P&L table by item and year with `계획` / `비율 대체` badges; `출시 전 투자` year-0 row; volatility table (revenue sigma applied/effective/truncations; cost = S5 run id/hash); pinned S5 version; independence simplification, pre-tax proxy, terminal-margin flag, year-0-undiscounted limit stated verbatim.
- **Scenario comparison**: basis, vol mode and pin id per case labelled; cases on different pins flagged.
- Onyx 3.0 shared components only.

## 11. Dependency on the S5 re-import (PR #590)

The re-import action merged in PR #590 is not redesigned; §4A.8 states how it is absorbed: unchanged until Slice 0, then the same button re-pins (and refreshes the compat copy) for pinned projects, and behaves as today for unpinned projects.

Amended 2026-10-16: with the linkage default flipped (§4A.9), the connect/re-pin action is now the **default path** and the copy is the exception. A Green Field project with an importable S5 plan is connected (pinned + unified `S5 투자 계획` basis) by default from its next generation; `복사본으로 되돌리기` is the explicit, audited exception, and unpinned (copy-path) behavior survives only through that revert or for projects with no importable S5 plan.

## 12. Slices (reordered)

| Slice | Scope | Behavior change | Migration |
|---|---|---|---|
| 0 | Golden tests freezing current outputs (all bases, compat path, BF); `s5_plan_pin` table with snapshot JSON; `plan_hash` = hash of `loadInvestmentVectorsInput`; pinned branch in `resolveS5InvestmentPlan` / `resolveBusinessCaseParams` / `buildS8JobSpec` / `defaultExecutor`; pinned run in `resolveS5SimConsumption`; stale rules §4A.4; `최신 S5로 갱신` re-pin (absorbs PR #590 button) with diff, audit, analyst+ human-only; `bc.s5_source` opt-in; promotion writes the initial pin; parity test copy-path vs pinned-path for `s5_plan` / `s5_plan_full` | None until a person sets `bc.s5_source = 1` (as shipped; superseded by the 2026-10-16 default flip — see below); parity test guarantees equal results on a fresh copy | **Yes — `s5_plan_pin` incl. snapshot (this slice)** |
| 1 | `startYear: 0` pre-launch flag (validator, `preLaunchAmountOf`, S5 UI option/tile, Y0 in S5 vectors, simulation bands and `plan_hash`); copy and re-import accept 0 | None for S8; S5 summary/bands show Y0 only when a person marks a line | None (`start_year` has no CHECK) |
| 2 | `s5_pnl` basis, GF only, pinned path required: plan lines as P&L, utilization on revenue only, ramped-revenue ratio fallback, year 0 = pre-launch, payback guard, pre-tax/terminal-margin/year-0 labels | Only for projects a person switches to `s5_pnl` | None |
| 3 | `vol_mode = split`, pinned path required: shared `drawInvestmentVectorsPerDraw`; S8 recomputes per-year per-category draw vectors of the pinned run from seed at the pinned source (input-hash check), applied to all plan cost lines incl. staffing and Y0; fallback-year and no-run labels; revenue sigma human-confirmed path (0-50%, source note, truncation at 0 recorded); run-note fields | Only when a person sets split mode | None |
| 4 | Scenario comparison labelling; IC package / gate brief / report composer / AI support text show pin id, stale state and new note fields | Presentation only | None |
| 5 (optional) | Brown Field: acquisition EV + separate post-close pre-launch lines | Only on decider opt-in | TBD |

Slice 0 must land before Slice 1 is used by S8 (Slice 1 alone is S5-only and safe). Each slice is independently shippable and behavior-preserving by default.

Default flip (amendment 2026-10-16, before Slice 2): Slice 0's opt-in wording above is superseded — the pinned branch is the DEFAULT. Implementation consequence: the four generator consumers listed in §4A.10 (`resolveS5InvestmentPlan`, `resolveBusinessCaseParams`, `buildS8JobSpec`, `defaultExecutor`) take the pinned branch by default whenever a current pin exists, and the promotion copy keeps being written as the compat path plus the initial pin (revert via `복사본으로 되돌리기` returns a project to the copy branch).

## 13. Honest limits

- Independence between revenue draws and S5-run draws is a stated simplification (§7.3).
- Cost uncertainty is only as good as the S5 simulation's human-confirmed ranges; categories the S5 run does not perturb stay single-point.
- Fallback years carry no cost uncertainty, so dispersion is understated for projects with thin plans.
- Pre-tax cash proxy; taxes, working capital, depreciation not modelled.
- Year-0 outlay is undiscounted and lumped at t=0.
- Terminal value uses a market EV/Revenue multiple that may embed a margin inconsistent with the plan — flagged, not reconciled.
- Python engine parity not addressed.
- Two S5 paths (copy and pin) coexist until a later decision retires the copy for computation; the compat copy can drift from S5 for unpinned projects exactly as today.
- S5 keeps no line history; the pinned version is re-readable only because `s5_plan_pin` stores its snapshot (OPEN-1 resolved). The snapshot is a copy of the input, not of S5 rows, and is never edited.
- Brown Field is out of scope (S7 per-target structure unchanged).

## 14. Decisions and remaining open items

Decided (chat 2026-10-15):

| ID | Decision |
|---|---|
| OD-1 | Pre-launch captured as `startYear: 0` on line JSON |
| OD-2 | Only capex and manual lump-sum lines may be pre-launch |
| OD-3 | No pre-launch line under `s5_pnl` -> year 0 = 0 with warning |
| OD-4 | Independence between revenue draws and S5-run draws, stated as a simplification; correlation out of scope |
| OD-5 | Brown Field out of slices 0-4; optional Slice 5 |
| OD-6 | `s5_pnl` without an S5 plan refused at save |
| OD-7 | Utilization scales revenue only; plan cost lines are ramp-inclusive; fallback opex uses ramped revenue |
| OD-8 | Revenue sigma bounds only: person-confirmed 0-50%, source note mandatory, >50% rejected, truncation at 0 recorded |
| Cost volatility | From the pinned confirmed S5 run, recomputed from seed at the S5 source; no S8 cost sigma |
| Linkage | Option B: S5 single source, S8 pinned reference, human re-pin, no live read; BF out |

[VR-moot] after round 2: DART-based cost sigma source; reuse of the discarded second normal as cost shock; cost-sigma bounds; revenue-cost correlation parameter; utilization-on-revenue-only question.

Resolved at acceptance (chat 2026-10-15, "승인 + OPEN-1~3 추천안"):

| ID | Decision |
|---|---|
| OPEN-1 | `s5_plan_pin` stores a snapshot JSON of the pinned S5 input (the `loadInvestmentVectorsInput` result) alongside `plan_hash`, in the Slice 0 migration; S8 computes against the snapshot, so the pinned version stays re-readable after S5 is edited |
| OPEN-2 | Copy path stays the default for Green Field projects promoted after Slice 0 until Slices 0-1 have run on real projects; flipping the default is a later decision — **amended 2026-10-16: reversed; the pinned path is the default for all Green Field projects with an importable S5 plan, existing included, from the next generation (ADR-0178 amendment, DEC-20261016-01)** |
| OPEN-3 | Re-pin by a human with analyst role or above on the project; no agent/MCP path |

Remaining open decisions: none.

Implementation-time verifications (not decisions): whether assumption edits already invalidate cases; whether the S5 run perturbs gov_rnd; whether the S10 carry's adopted model can be the promotion copy; the PR #590 re-import behavior as implemented.
