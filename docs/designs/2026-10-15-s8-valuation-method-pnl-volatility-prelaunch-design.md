---
title: S8 valuation method — S5 plan lines as P&L items, per-item volatility, separate pre-launch investment
status: proposed
date: 2026-10-15
owner: platform-lead
lang: ko
lang_reason: proper-noun
---

# S8 valuation method — S5 plan lines as P&L items, per-item volatility, separate pre-launch investment

Korean appears only as UI labels/product terms in backticks. All prose is English. Paths are relative to `app/web-next/` unless stated.

- Decider: human decider, chat 2026-10-15 — the recommended option chosen on all three questions: (1) split volatility by item, (2) S5 plan lines become the P&L items, (3) a separate pre-launch (year-0) investment. Drafted by platform-lead.
- ADR: [ADR-0178](../adr/0178-s8-valuation-pnl-volatility-prelaunch.md) (Proposed).
- Builds on: ADR-0174 (total investment, `bc.investment_basis`, promotion copy, `s5_line_hash`), ADR-0175 (staffing plan, salary human-sourced only), ADR-0176 (S5 investment simulation, per-draw pairing, `s5_sim` hash, `재평가 필요`), ADR-0170 (staleness pattern), ADR-0052 §D.4 (seeded reproducibility), and the Brown Field anchor/benchmark designs of 2026-10-10.
- Valuation-method judgement in this document that goes beyond the code is marked **[VR]** and must be reviewed by `valuation-agent` and `quant-methodologist` before Slice 3 ships.

## 1. Problem statement

1. **One sigma for everything.** `runSeededSimulation` draws only revenue growth (`anchorGrowth + disp * z`), with `disp` clamped to [`DISP_FLOOR` 2%, `DISP_CAP` 25%] and derived from DART historical revenue vol blended with WACC asset vol (Green Field: asset vol only). Cost moves only as a ratio of revenue, so operating leverage is invisible; investment uncertainty enters only through the ADR-0176 S5 draws.
2. **Ratio P&L.** On the ratio basis a year's flow is `revenue x (1 - opexRatio(0.6) - capexRatio) x utilization`. Under `s5_plan` / `s5_plan_full` the plan partially substitutes (capex schedule; labor/opex years under `full`), but the plan's line structure is not the P&L — it is a substitution inside a ratio model.
3. **Year-0 conflation.** Year-0 is `initial_investment_ratio x year-1 revenue`, or under `s5_plan` the plan's Year-1 capex (OD-3 of ADR-0174). A plan line "factory construction, Y1" and "first-year equipment top-up, Y1" are indistinguishable, so pre-launch outlay and launch-year capex are mixed, and the Year-1 capex is then *not* in Year 1 (it was moved to year 0).

## 2. Verified current state (code, 2026-10-15)

- `lib/business-case-generator.ts`: `DISP_FLOOR=0.02`, `DISP_CAP=0.25`, `clampDisp`; market disp = blend of clamped hist vol and beta/asset vol, else one of them, else floor (~l.180-212). `runSeededSimulation` (~l.356): `scenarioSeed` -> `mulberry32`; one `normalPair` draw per year > 1 (only `z1` used); S5 draw factors `capFactors/manFactors[it % drawCount]` precomputed so the revenue rng stream is untouched (ADR-0176 slice 3). The deterministic BEP path recomputes flows without noise and uses `discountedPaybackYear(detInitial, ...)`.
- `initialInvestmentOf` (~l.874): Brown Field with `revenueAnchor` + `acquisition` -> `anchor revenue x EV/Revenue` (unless the user pinned `bc.initial_investment_ratio`); otherwise ratio x year-1 revenue.
- `InvestmentBasis = "ratio" | "s5_plan" | "s5_plan_full"` with codes 0/1/2 stored as the numeric assumption `bc.investment_basis`.
- `lib/capability-cost-lines.ts`: lines carry `startYear` (validated `1 <= startYear <= endYear <= horizon`), `endYear`, lump-sum vs spread; `plan_meta` holds horizon. Year 0 is not representable today.
- The S5 plan reaches S8 only through the one-time promotion copy (ADR-0174); a human-triggered re-import route and ParamsPanel button are being implemented in parallel (`app/api/projects/[id]/business-case/s5-reimport/`, `db/repositories/s5-cost-import.ts` — uncommitted, not reviewed here).
- The python sim-engine is bypassed whenever explicit plan vectors are in play (engine parity unverified, ADR-0174 honest limits).

## 3. Decision summary (recommended; all opt-in)

A new, explicit **valuation method** is introduced beside the existing bases, not over them:

| Axis | Today (kept bit-identical) | New (opt-in) |
|---|---|---|
| P&L | ratio, or ratio with plan substitution (`s5_plan`, `s5_plan_full`) | `bc.investment_basis = s5_pnl` (code 3): S5 lines are the P&L items |
| Year 0 | ratio x Y1 revenue, BF acquisition EV, or plan Y1 capex (OD-3) | sum of lines flagged pre-launch (`startYear: 0`); Y1 capex stays in Y1 |
| Volatility | one revenue sigma | `bc.vol_mode = split` (code 1): revenue / cost / investment sigma, each with its own source |

Nothing changes for a project until a person sets the new basis/mode. Brown Field is excluded from the first slices (§6).

## 4. Data model (deliverable a)

### 4.1 Pre-launch flag — where it lives

Options considered:

| Option | Migration | Verdict |
|---|---|---|
| A. Allow `startYear: 0` on S5 line JSON (meaning "pre-launch / 출시 전"); lump-sum only | none | **Recommended** |
| B. New field `phase: "pre_launch"` on S5 line JSON | none | Redundant with a year axis; two fields can disagree (`phase=pre_launch, startYear=3`) |
| C. `plan_meta.preLaunch` list of line ids | none | Splits a line's timing across two places; breaks on line edit/delete |
| D. New `business_case_line.phase` column | yes | Only needed post-promotion; S5 is opportunity-keyed and lives in `business_case_lines_json` — a column alone does not reach S5 |

Rationale for A: year 0 is exactly the NPV index the engine already uses for the initial outflow; a line's timing stays in one field; legacy lines never carry `startYear: 0` (the validator rejects it today), so every existing line hashes and computes identically. Rules: `startYear: 0` allowed only for `capex`-category and manual lump-sum lines (labor/opex/gov_rnd cannot be pre-launch in slice 1 — **open decision OD-2**); `endYear` must be null/0 for such lines; `activeYearsOf` keeps returning Y1..YN counts and a new `preLaunchAmountOf(lines)` returns the year-0 sum. `validateLineYears` gains the 0 case behind the same message style. `s5_line_hash` changes only for lines that actually use 0 (desired: it is a real plan change).

### 4.2 Promotion/re-import copy

The promotion copy and the in-flight re-import copy carry `startYear` verbatim, so the flag reaches S8 without a schema change, provided the copy does not re-validate with the old `>= 1` rule. If the post-promotion `business_case_line` table normalizes `startYear` into a column with a `CHECK (start_year >= 1)` or similar, Slice 1 needs a migration — **not verified** (see §11); if needed it is assigned to Slice 1.

### 4.3 New assumptions (all human-set, numeric assumption rows)

- `bc.investment_basis = 3` (`s5_pnl`). `INVESTMENT_BASIS_CODES` gains `s5_pnl: 3`; unknown/absent codes keep resolving to today's behavior.
- `bc.vol_mode` (0 = single, default; 1 = split).
- `bc.vol.revenue`, `bc.vol.cost`, `bc.vol.investment` — optional person-confirmed overrides with mandatory source note; absent -> derived proposal shown, not used, until confirmed (§8).

### 4.4 Bit-identical guarantee

Golden tests (Slice 1, before any engine change): freeze `runSeededSimulation` outputs (p05/p50/p95/mean/std/bepYear) and persisted notes for fixtures covering ratio GF, ratio BF with anchor + acquisition, `s5_plan`, `s5_plan_full`, `s5_plan` + confirmed S5 sim run, Green Field without historical data. Every slice must keep them byte-equal. New code paths branch only on `basis === "s5_pnl"` or `volMode === "split"`.

## 5. P&L structure under `s5_pnl` (decision 2)

Per year t = 1..N:

```
revenue_t   = drawn revenue (existing path; ramp/utilization applies to revenue only) [VR]
opex_t      = labor_t (staffing plan / labor lines) + opex lines_t + gov_rnd_t
capex_t     = capex lines active in t (Y1 capex stays in Y1)
flow_t      = revenue_t x util_t - opex_t - capex_t
year 0      = -(sum of pre-launch lines)
```

- **Fallback per year**: a year with no plan coverage for opex (`opexCovered[t] === false`) uses `revenue_t x opexRatio`; capex absent for a year is 0 (not the ratio) only if the plan's horizon covers that year, else `revenue_t x capexRatio`. Each fallback year is listed in the methodology panel as `비율 대체 (계획 미포함 연도)`.
- **No plan**: `s5_pnl` without an S5 plan is refused at parameter save (400 with reason) rather than silently falling back — avoids a project labelled "plan-based" computing on ratios.
- **Pre-launch empty**: if no line is flagged pre-launch, year 0 = 0 and a warning `출시 전 투자 미지정` is shown; it does not fall back to the ratio (that would reintroduce the conflation). **OD-3.**
- **[VR]** Applying utilization to revenue only (costs are planned absolute amounts) differs from today's `(revenue - opex) x util`; this is deliberate (plan costs are already ramp-aware) but needs valuation-agent sign-off.
- Exit value unchanged (`revenue_N x exitMult`).
- Tax, working capital, depreciation: unchanged (not modelled today) — stated as a limit, not added here.

## 6. Brown Field (deliverable b)

**Recommendation: Brown Field stays out of Slices 1-4.** `s5_pnl` is rejected for BF projects with a reason. Rationale: BF year 0 is the acquisition EV (`anchor x EV/Revenue`, benchmark design), its P&L base is the target's existing revenue/cost structure from DART rather than an S5 build-out plan, and a combined "acquisition price + pre-launch S5 lines (e.g. PMI capex)" year 0 needs its own design. Sketch for a later slice (Slice 5, optional): year 0 = acquisition EV (unchanged source) + S5 lines flagged pre-launch shown as a separate `인수 후 즉시 투자` row; never merged into one number without provenance. **OD-5.**

## 7. Monte Carlo, engine bypass, deterministic path (deliverable c)

Under `volMode = split` (any basis that has plan cost lines; under ratio basis only revenue and investment sigma apply):

- **Revenue**: unchanged draw `revenue *= 1 + g + sigma_rev * z1` using the existing rng stream — so `sigma_rev = disp` reproduces today exactly.
- **Cost**: a multiplicative per-year factor `opex_t *= 1 + sigma_cost * z2`, where `z2` is the **second Box-Muller output already computed and discarded** in the same `normalPair` call. Using `z2` leaves the rng stream (and every revenue draw) unchanged, so turning cost vol on cannot perturb revenue paths. Applied to plan opex lines and to ratio-fallback opex alike.
- **Investment**: no new random draw at S8 (ADR-0176 layering — S8 never re-simulates investment). It comes from the confirmed S5 run via per-draw pairing (`it % drawCount`), extended so year-0 pre-launch lines are perturbed with the same `capF/manF` factors. `sigma_inv` is *reported* (from the S5 run's total-investment distribution) for evidence, not drawn. Without a confirmed S5 run, investment is single-point and the panel says `투자 변동성 없음 (S5 시뮬레이션 미확정)`.
- **Independence — explicit simplifying assumption (flagged)**: revenue and cost shocks are independent (z1, z2 are independent normals), and both are independent of the S5 investment draw. In reality cost co-moves with volume and input prices; independence likely *overstates* NPV dispersion for cost-plus businesses and *understates* it where input-price shocks hit margin. A correlation parameter rho (z2' = rho z1 + sqrt(1-rho^2) z2) is a cheap later addition but its value must be human-sourced. **OD-4, [VR] quant-methodologist.**
- **Sources for sigma** (each shown with origin): revenue — today's derivation (unchanged); cost — DART historical std of cost-of-sales + SG&A growth for the anchor/peer company if available, else WACC asset vol is **not** reused (it is a revenue/asset measure) and the field is left unconfirmed; investment — S5 run. Clamp [`DISP_FLOOR`, `DISP_CAP`] applies to derived proposals only; a person-confirmed value is clamped to a wider sanity bound (0-100%) and stored as entered. [VR]
- **Python engine**: bypassed for `s5_pnl` and for `split` (as for `s5_plan` today); the run note records `engine=ts`, `vol_mode=split`, `basis=s5_pnl` and why. Engine parity is a separate, later task.
- **Deterministic BEP/payback**: noise-free flows with the same structure — year 0 = pre-launch sum, opex/capex from plan, no volatility. Volatility never enters BEP. `discountedPaybackYear(detInitial=preLaunch, ...)`; if pre-launch = 0 payback is reported as not meaningful rather than year 0.

## 8. Provenance, hashes, staleness (deliverable d)

- Run note gains `vol_mode=`, `sigma_rev=`, `sigma_cost=`, `sigma_inv=` (reported), `prelaunch_krw_m=`, alongside existing `seed=`, `basis=`, `s5_line_hash=`, `s5_sim=`.
- `s5_line_hash` already covers `startYear`; flipping a line to pre-launch therefore changes the hash and triggers the existing `재평가 필요` via the ADR-0170/0176 compare. No new hash.
- Changing a confirmed `bc.vol.*` value marks the case `재평가 필요` through the existing assumption-change path (verify in Slice 3 that assumption edits already invalidate; if not, add `vol_hash` to the note).

## 9. Human-owned inputs (deliverable e)

- Volatility values: the system *proposes* a derived value with its source; it enters the simulation only after a person confirms it (audited assumption write with source note). No silent default beyond today's single-sigma path, which remains the default mode.
- Pre-launch flag: set by a person per line in S5. No auto-classification of lines (e.g. by name "건설"); an AI may *suggest* in the S5 UI as a labelled proposal.
- No default prices, salaries, or cost lines are introduced; plan amounts come only from S5 lines, staffing salaries only as analyst-sourced (ADR-0175).
- Decision support only: no gate block, no RAG grade effect, adoption of a case remains a human act. Data confidence continues to cap the RAG grade (non-negotiable #4) — a richer P&L does not raise confidence of a proxy-estimated revenue.

## 10. UI surfaces (deliverable f)

- **S5 cost lines**: a `출시 전 (Y0)` option in the line's start-year control for capex/manual lump-sum lines; the `투자비 요약` gains a `출시 전 투자` tile and a Y0 column in the schedule.
- **S8 ParamsPanel**: basis selector gains `S5 계획 손익 (s5_pnl)` (disabled with reason for BF / no plan); a `변동성` section with mode toggle and three rows (proposed value, source, confirm control).
- **ValuationMethodology.tsx**: P&L table by item and year with per-year `계획` / `비율 대체` badges; year-0 row labelled `출시 전 투자`; volatility table with three rows (value, source, confirmed-by); independence assumption stated verbatim.
- **Scenario comparison**: show basis and vol mode per case so a `s5_pnl/split` case is never compared unlabelled against a ratio case.
- All within Onyx 3.0 shared components (design-guide.md, `design:lint`).

## 11. Dependency on the in-flight S5 re-import (deliverable g)

The re-import action (human-triggered S5 -> S8 copy, ParamsPanel button) is being implemented separately and is not redesigned here. Dependency: Slice 1's pre-launch flag reaches S8 only through that copy (or the original promotion). Slice 1 must (i) confirm the copy preserves `startYear: 0` and (ii) add a golden test for it once the re-import lands. If the re-import ships after Slice 1, already-promoted projects see the flag only after a promotion/re-import — stated in the S8 UI as `S5 계획을 다시 가져와야 반영됩니다`.

## 12. Slices (deliverable h)

| Slice | Scope | Behavior change | Migration |
|---|---|---|---|
| 1 | Golden tests freezing current outputs; `startYear: 0` pre-launch flag in S5 line JSON + validator + `preLaunchAmountOf` + S5 UI option/tile; verify promotion/re-import copy preserves it | None for S8 (no basis reads Y0 yet); S5 summary shows Y0 | Only if `business_case_line` constrains start year (to verify); assigned here |
| 2 | `s5_pnl` basis (code 3): plan lines as P&L, year 0 = pre-launch, per-year ratio fallback, deterministic BEP; GF only; methodology P&L table | Only for projects a person switches to `s5_pnl` | None |
| 3 | `vol_mode = split`: z2 cost shock, investment via S5 pairing incl. Y0, sigma proposals + human confirmation, run-note fields, staleness check; volatility UI | Only when a person sets split mode | None |
| 4 | Scenario comparison labelling, gate-brief/AI support text consuming the new note fields | Presentation only | None |
| 5 (optional) | Brown Field: acquisition EV + separate post-close pre-launch lines | Only on decider opt-in | TBD |

Each slice is independently shippable; golden tests from Slice 1 gate all later slices.

## 13. Honest limits

- Independence of revenue/cost/investment shocks is a simplification (§7).
- Cost sigma has no reliable source for Green Field projects without peer cost data; it will often stay unconfirmed, and split mode then runs with cost sigma = 0 (shown).
- No tax, working capital or depreciation in any basis; P&L is a pre-tax cash proxy.
- Utilization-on-revenue-only under `s5_pnl` changes the economics vs `s5_plan`; results across bases are not comparable without labels.
- Python engine parity for new paths not addressed.
- Not verified: whether `business_case_line` has a start-year constraint; whether assumption edits already invalidate cases; contents of the uncommitted re-import code.

## 14. Open decisions for the human decider

| ID | Question | Recommendation |
|---|---|---|
| OD-1 | Pre-launch capture: `startYear: 0` vs `phase` field vs plan_meta vs column | `startYear: 0` (no migration, single timing field) |
| OD-2 | Which categories may be pre-launch | capex and manual lump-sum only in slice 1; pre-launch labor (pre-opening hiring) later |
| OD-3 | `s5_pnl` with no pre-launch line: year 0 = 0 or ratio fallback | 0 with a visible warning |
| OD-4 | Correlation between revenue and cost shocks | Independence now, flagged; add rho only with a human-sourced value |
| OD-5 | Brown Field in scope | Out of slices 1-4; optional Slice 5 |
| OD-6 | `s5_pnl` without an S5 plan | Refuse at save (400 with reason) |
| OD-7 | Utilization applied to revenue only under `s5_pnl` | Yes, subject to valuation-agent review |
| OD-8 | Confirmed sigma bounds | Derived proposals clamped [2%, 25%]; confirmed values 0-100% stored as entered |
