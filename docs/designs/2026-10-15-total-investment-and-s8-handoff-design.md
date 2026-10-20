---
title: Total investment definition, S5 investment summary and S8 hand-off
status: proposed
date: 2026-10-15
owner: platform-lead
lang: ko
lang_reason: source-material
---

# Total investment definition, S5 investment summary and S8 hand-off

Korean appears only as UI labels in backticks. All prose is English. Paths are relative to `app/web-next/` unless stated.

- Decider: human decider, chat 2026-10-15 feedback (F1-F3 below). Drafted by platform-lead.
- ADR: [ADR-0174](../adr/0174-total-investment-and-s8-handoff.md) (Accepted 2026-10-15).
- Builds on: [ADR-0173](../adr/0173-capability-cost-and-milestone-linkage.md) and its [design](2026-10-15-capability-cost-and-milestone-linkage-design.md); absorbs its slice 2 (S8 re-import).

## 1. Problem statement

- F1: reflected capability costs show `반영됨` in S5 but do not appear among the investment items. This is a UI bug fixed separately; this design only requires that the summary below is computed from the same stored entries, so the two cannot disagree.
- F2: the S5 investment section shows one mixed number (lump sums as entered plus recurring lines annualised), so the decider cannot see the annual investment next to the total over the plan.
- F3: the total investment must be organised so that S8 business-case analysis can work.

## 2. Verified current state

### 2.1 S5 data model

- Line type `BcLine` (`components/stages/GreenfieldStage.tsx`): `line`, `category` (`labor|opex|capex|revenue|gov_rnd`), `amount`, `note?`, `period` (`monthly|quarterly|yearly|lumpsum`), `currency` (`KRW|USD|EUR|JPY|CNY`), `amountUnit?: "krw_m"` (legacy lines without it held 억, converted on load), `dupDismissed?`. No year field, no horizon.
- Capability entries (`lib/capability-cost-lines.ts`, `StoredCapabilityEntry`) live in the same array with `source: "capability"`, `capabilityKey`, `reflected`, `basisHash`, `category` (labor/opex/capex), `amount` in 백만원, `period: "lumpsum"`. The server recomputes the amount from the live judgement (`normalizeBusinessCaseLines`).
- `lineAmountKrwM` returns 백만원 (`krw_m` marker) or converts legacy 억 x100. `AMOUNT_UNIT_KRW_M = "krw_m"`.
- `investmentTotals`: reflected capability cost + manual lines where `revenue` and `gov_rnd` are skipped, non-KRW lines are excluded and counted, and each line is `amount x ANNUAL[period]` (`monthly 12, quarterly 4, yearly 1, lumpsum 1`). `grandKrwM` therefore mixes one-off and one-year amounts (F2).
- Storage: `greenfield_assessment.business_case_lines_json` (TEXT, `db/migrations/0056_greenfield_assessment.sql`); written by `POST /api/greenfield/[oppId]` via `normalizeBusinessCaseLines`. The table has no horizon column (columns: `capability_gaps_json`, `entry_strategy`, `alternatives_considered`, `business_case_lines_json`, `rationale`, audit columns).

### 2.2 Promotion copy (`db/repositories/project.repository.ts`)

- `splitForPromotion` drops unreflected capability entries, recomputes reflected ones as exact 백만원 lump sums (note flags include `일시불 총액`), and returns the rest as manual lines.
- One `business_case_model` (`kind = 'greenfield_cost'`, name `S5 투자비 검토 요건 (자동 이관)`, `horizon_years = 5` hard-coded).
- One `business_case_line` per entry: `annual_amount_krw_m = lineAmountKrwM x PERIOD_MULTIPLIER` (lump sum x1 with note `일시불 총액 — 연반복 아님`), `start_year = 1`, `growth_rate = 0`. Non-KRW lines are copied unconverted with a note flag. `unit` is not set (NULL).
- Schema: `business_case_line` (`0044`, `0102` adds `gov_rnd`, later `unit`, `sales_volume`, `unit_price_krw`) has `start_year` and `growth_rate` but no end year.

### 2.3 How S8 uses it today (`lib/business-case-generator.ts`)

- The generator never reads the `greenfield_cost` model or its lines. It only writes its own `valuation` model with three lines (revenue, opex, capex at year-1).
- Cash flows (`deterministicCashflows`, Monte Carlo loop): year 0 = `-initialInvestment`, where `initialInvestmentOf` = `year-1 revenue x bc.initial_investment_ratio` (default 0.5, ADR-0106) or, for an acquisition, anchor revenue x EV/Revenue. Years 1..H = `revenue x (1 - opex_ratio - capex_ratio) x ramp-up`, defaults `opex_ratio 0.6`, `capex_ratio 0.1`, H = `bc.horizon_years` (default 5, clamped 1..50). Optional exit value at H.
- NPV, IRR (`irr`), discounted payback (`discountedPaybackYear`) and the BEP year come from these flows only. No depreciation, tax or financing flows exist in the generator; I found no DSCR computation in it.
- Answer to the core question: S8's NPV/IRR do **not** use the S5 lines in any cash-flow year or category. What is lost: amounts, timing (spend year), recurring horizon, capex vs opex split, the capability lines, `gov_rnd` inflows, and any link to the capability-adjusted scenario (ADR-0173 slice 6). Depreciation and financing are absent in both paths, so nothing extra is lost there.
- The S8 page lists all models of the project including the copied `greenfield_cost` model (`lib/business-case.ts` reads every model and line), so the copied lines are visible but inert.

### 2.4 Later consumers of `business_case_line`

- `lib/business-targets.ts` `finalYearLineAmount`: line amount at `start_year` compounded by `growth_rate` to the horizon; every line is recurring. Revenue minus labor/opex gives the final-year margin; capex and `gov_rnd` are excluded (ADR-0114/0138). Used by S8 targets and the S12 target evaluation path (`resolveProjectTargets`, `evaluateTargets`).
- `lib/greenfield-execution.ts` (S10/S11): adopted model id from the latest done `s8_case_adopt` run; capex total = sum over capex lines of `annual x (1+g)^(y-start)` for `y = start..horizon`; requires `unit = 'KRW_M'` or reports `case_unit_not_comparable`; compares to the S10 capex tranche total with zero tolerance.
- Consequence: a lump sum copied as a normal line would be counted once per remaining year, and the promotion copy's NULL `unit` would be rejected by S10. Today this does not bite only because the adopted model is normally the generator's `valuation` model.

## 3. Definitions (deliverable a)

| Term | Definition |
|---|---|
| `검토 기간` (horizon, N years) | The single plan horizon. Same meaning as S8 `bc.horizon_years`. Default 5. |
| `연간 투자비` | Sum of recurring KRW cost lines (labor, opex, capex) at their annual run-rate: `amount x {12, 4, 1}` for monthly/quarterly/yearly. Shown as run-rate, independent of years. |
| `일시 투자비` | Sum of KRW lump-sum cost lines (manual lump sums + reflected capability lines). |
| `총 투자비` | Over the horizon: lump sums + each recurring line x number of active years `max(0, min(endYear, N) - startYear + 1)`. Reported by category (labor, opex, capex) and overall. |
| `집행 연차` (per-line timing) | `startYear` (1..N, default 1). Recurring lines also take `endYear` (default N). Lump sums spend in `startYear` only. Capability lines default `startYear = max(1, ceil(monthsToAttain / 12))` from the milestone candidate (ADR-0173), editable; if months are unknown, Y1. |
| Revenue, `정부 R&D` | Shown in the schedule in a separate block (inflows), never inside 투자비. |
| Currency | Totals are KRW 백만원 only. Non-KRW lines appear in a flagged list with original currency and amount, excluded from totals with a count; no FX is applied anywhere in S5. |

`설비 투자(capex)` vs operating cost: 총 투자비 includes labor and opex because the decider asked for the total cost of executing the strategy; the panel also shows `capex 소계` separately because only capex feeds S8's investment (section 6).

## 4. S5 screen (deliverable b)

A read-only panel `투자비 요약` directly under the investment lines (same component region; Onyx 3.0 tokens, existing table and stat components only):

1. Horizon control: `검토 기간` number input (1..20 years, default 5) with helper text `S8 사업계획 기간의 초기값이 됩니다`.
2. Three stat tiles, unit label on each: `연간(반복) 투자비 (백만원/년)`, `일시 투자비 (백만원)`, `총 투자비 (검토 기간 N년, 백만원)`.
3. Category table: rows labor/opex/capex/total, columns annual / lump sum / total over N.
4. Schedule table `연도별 투자 계획 (백만원)`: columns Y1..YN plus `합계`; rows per category, a `투자비 합계` row, then separate inflow rows `매출`, `정부 R&D` (not summed into 투자비). Caption states the unit.
5. Flags: count of excluded non-KRW lines (expandable list); lines whose `endYear` exceeds N; capability lines whose spend year comes from milestone months (`판정 기간에서 산정`).
6. Per-line timing input: each manual line row gets `시작 연차` (and `종료 연차` when period is not lump sum); each capability line gets an editable `집행 연차`.

The AI entry-strategy and judgement proposals are unaffected; they do not write timing or horizon.

## 5. Storage (deliverable c)

- S5, no migration: optional line fields `startYear?: number`, `endYear?: number` (integers, validated `1 <= startYear <= endYear <= horizon` on save; out-of-range is a 400 with a precise message). Capability entries additionally store `startYear` (human override) next to their existing fields; the server keeps recomputing amounts only.
- Horizon: one entry `{ source: "plan_meta", horizonYears: 5 }` in the same `business_case_lines_json` array. Rejected alternatives: a new `greenfield_assessment` column (schema change for one integer), overloading `rationale` text (fragile), project assumption `bc.horizon_years` (the project does not exist before promotion).
- Required consumer updates for the meta entry: `normalizeBusinessCaseLines` (validate, keep exactly one), `splitForPromotion` (exclude, return horizon), `investmentTotals`, the S5 page loader, and the promotion filter (already drops entries without `line`/valid category, but should drop it explicitly). Test that no consumer renders it as a line.
- Legacy compatibility: missing `startYear` = 1; missing `endYear` on recurring lines = N; missing meta = 5. No backfill.
- S8, one additive migration: `ALTER TABLE business_case_line ADD COLUMN end_year INTEGER` (NULL = through horizon). Reversible per ADR-0014 pattern; existing rows untouched. This is the only schema change and is why this is an ADR.

## 6. S8 hand-off (deliverable d)

### 6.1 Promotion copy

- Model: `greenfield_cost`, `horizon_years = plan_meta.horizonYears` (default 5).
- One `business_case_line` per S5 line (not per year): `annual_amount_krw_m` = annual run-rate (recurring) or the lump sum; `start_year = startYear`; `end_year = startYear` for lump sums, `endYear` (or NULL) for recurring; `growth_rate = 0`; `unit = 'KRW_M'` for KRW lines, NULL plus existing note flag for non-KRW. Capability lines use their spend year.
- Readers updated to honour `end_year`: `finalYearLineAmount` (zero after `end_year`), S10 capex total (sum `start..min(end, horizon)`), the S8 line rendering. One-line-per-year was rejected: it multiplies rows and breaks the line-to-source traceability that re-import needs.

### 6.2 S8 consumption

- New project parameter `bc.investment_basis` (human-set assumption, kind=user, with rationale): `ratio` (default, today's behaviour) or `s5_plan`.
- With `s5_plan` on a greenfield project, the generator builds an explicit capex vector from the latest `greenfield_cost` model: Y1 capex lines are discounted at year 1 (the plan has no year-0; recommendation: treat Y1 spend as year 0 to match today's year-0 convention, see OD-3), Yk at k. This vector **replaces** both `initialInvestmentOf` and `revenue x capex_ratio`; using both would double count. Labor and opex lines stay a cross-check against `opex_ratio x revenue` (shown as a variance), unless a person also selects `s5_plan_full`, where explicit labor/opex replace the opex ratio for years where lines exist. `gov_rnd` is an inflow in its year only under `s5_plan_full`.
- Run provenance records the basis, model id and line hash so a later change is detectable.
- Effects: NPV/IRR/payback move from a revenue-proportional investment to the planned amounts and timing; spreading large capability capex to later years raises NPV vs a year-0 lump. The capability-adjusted scenario (ADR-0173 slice 6) uses the same vector with capability lines shifted to their milestone years, so it needs no separate path.
- Not added: depreciation, tax and financing; the model stays pre-tax unlevered FCF as today (open as OD-5).

### 6.3 Re-import (absorbs ADR-0173 slice 2)

`S5 투자비 다시 가져오기` in S8 parameters: diff (added / removed / amount / timing / horizon changes) between current S5 lines and the latest `greenfield_cost` model; the person selects changes; a new model is written (old one archived, not edited), audit `investment_plan.reimported`. No background sync.

### 6.4 Audit and human-only boundaries

Audit events: `investment_plan.horizon_set`, `investment_plan.timing_set`, `investment_plan.basis_set`, `investment_plan.reimported`. Choosing the basis, horizon and re-import are human actions (an agent acting for a user inherits that user's permission and must still be invoked by the person). Outputs remain decision support; no gate or adoption is triggered.

## 7. Existing-data impact and migration (deliverable e)

- S5: none; legacy lines read with defaults.
- S8: additive nullable column; existing projects keep `ratio` basis and unchanged results. Already-promoted projects have copied lines with `start_year = 1`, `end_year = NULL`, `unit = NULL`; they keep working under `ratio`. To use `s5_plan` they re-import (6.3), which writes correct timing and unit. No data rewrite.

## 8. Tests

- Unit: totals (annual / lump / total) with mixed periods, horizons, start/end years, revenue and `gov_rnd` excluded, non-KRW excluded and counted, legacy 억 lines; meta entry round-trip and not rendered; capability spend year from months.
- Promotion: horizon to model, `end_year` for lump sums, unit set, unreflected capability skipped.
- Readers: `finalYearLineAmount` and S10 capex total honour `end_year`; lump sum counted once.
- Generator: `ratio` basis bit-identical to today (golden); `s5_plan` replaces both ratio investments (no double count); provenance recorded.
- Re-import diff and archive behaviour; audit events.

## 9. Risks

- Double counting if a future change adds the explicit vector on top of ratios; guarded by a single basis switch and a generator test.
- Meta entry leaking into line lists; guarded by consumer tests.
- Horizon drift between S5 and S8 after promotion; shown as a mismatch, resolved by a person.
- Year-0 convention (OD-3) changes NPV materially; must be stated on screen.

## 10. Slices

1. S5 summary panel, definitions, per-line timing, `plan_meta` storage and validation. No S8 change.
2. Migration `end_year`; promotion copy with timing and unit; readers honour `end_year`; `bc.investment_basis` and generator consumption.
3. Re-import action (ADR-0173 slice 2).
4. S10 tranche reconciliation against the explicit capex schedule per year; S12 investment variance (planned vs actual by year).

## 11. Open decisions (resolved 2026-10-15)

Resolved: the human decider directed in chat on 2026-10-15 that S5 cost items (investment, labor, operating costs) must be reflected in the S8 business-case analysis, adopting the recommendation in every row below (DEC-20261015-02). No per-item checklist was reviewed.

- OD-1 Resolved as recommended: 총 투자비 includes labor and opex, with `capex 소계` shown separately; S8 investment uses capex only.
- OD-2 Resolved as recommended: S5 `검토 기간` seeds the horizon, S8 `bc.horizon_years` governs after promotion, mismatch shown.
- OD-3 Resolved as recommended: Y1 spend = year 0 (matches today's year-0 investment), stated on screen.
- OD-4 Resolved as recommended: default basis `ratio` until a person switches, to keep results stable.
- OD-5 Resolved as recommended: depreciation, tax, financing out of scope; a separate ADR if DSCR is required.
- OD-6 Resolved as recommended: capability spend year defaults to `ceil(months/12)`, editable.

## 12. Not verified

- The F1 UI bug's exact cause (being fixed by another agent).
- Whether `s8_case_adopt` can adopt a `greenfield_cost` model (only traced that S10 reads the adopted model id from run meta).
- S12 investment tracking beyond `business-targets.ts` final-year figures; no planned-vs-actual capex store found.
- Whether the Python standalone engine (`sim_engine`) mirrors the TS cash flows exactly for an explicit capex vector; it would need the same change.
- No DSCR computation found in the generator; if it exists elsewhere it was not traced.
- Nothing exercised in a browser or against the live database.


## Amendment (2026-10-19, decider) — 계획 연차 정렬(OD-3 철회), 비용 카테고리 공유, 복리 제거, 인건비 반영

- **OD-3 철회**: "Y1 지출을 year 0으로 취급"하는 연차 관행을 버리고 **계획 연차를 그대로 정렬**한다 — 계획 Y1 = 평가 1년차. 재무분석(BEP) 탭은 Y0 열을 두어 초기 투자(진입가 등)를 분리해 보인다. 화면에 연차 규칙을 명시한다.
- **같은 테이블·같은 구조**: 재무분석 비용은 S5 투자 계획과 같은 구조(인건비 / 운영비 / 설비투자)로 같은 라인 데이터를 공유한다. `aggregatePlanLines`가 7도메인 카테고리 벡터(`laborByYear` / `opexByYear` / `laborOpexByYear` / `capexByYear`)를 만들고, 주기(`monthly·quarterly·yearly·lumpsum`)는 주기당 금액 semantics로 해석한다. 투자비·재무분석·NPV·IRR 네 뷰가 같은 원천을 본다(시나리오 NPV는 저장 실행분이므로 재실행이 필요).
- **복리 제거**: 라인 금액에 연복리를 적용하던 경로를 없앴다(계획에 적힌 금액이 그 연차의 금액).
- **인건비**: 인력 계획(staffing)의 인건비를 `applyStaffingLaborToPlan`으로 s5_plan 양 경로(핀 스냅샷·복사 경로)에 반영한다. 핀 스냅샷은 `pinPlanLinesOf`가 읽기 시점에 파생한다(재갱신 불필요).
- **BEP 분기**: `breakEvenRevenue`가 s5_plan 분기에서 pnl 공식을 재사용하던 오류를 분리했다(Y1 과대 수정).
- 검증: `bep-analysis-tab.test.ts`, S5 핀/집계 테스트. CHANGELOG 2026-10-19.
