---
title: Investment account sub-categories and quantity x unit-price helper
status: proposed
date: 2026-10-15
owner: platform-lead
lang: ko
lang_reason: source-material
---

# Investment account sub-categories (`세부 과목`) and quantity x unit-price helper

Korean appears only as UI labels and vocabulary values in backticks. All prose is English. Paths are relative to `app/web-next/` unless stated. ADR: [ADR-0177](../adr/0177-investment-account-subcategories.md).

## 0. Decider input (chat 2026-10-15)

- Keep the five top-level categories (`labor`, `opex`, `capex`, `revenue`, `gov_rnd`); they carry S8 calculation meaning and `business_case_line.category` keeps its DB CHECK.
- Add optional sub-categories as a JSON field `subCategory` on S5 investment lines. No S5 migration.
- Cover certification and patent/IP costs. Stage 1: S5 direct entry with a quantity x unit-price helper, no default unit prices in the system. Stage 2 (later, own ADR): cost columns on `permit` / `certification` and links from S5 lines.
- Defaults: capability judgements default a sub-category from their resolution; staffing plan lines map to `labor > 직접 인건비` (recruiting one-off to `채용·교육비`); the duplicate guard stays.

## 1. Verified current state

| Fact | Where |
|---|---|
| `CATEGORY_LABEL` for capability lines covers only `labor`/`opex`/`capex` | `lib/capability-cost-lines.ts:14` |
| `ManualCostLine` has `category?`, `amount`, `amountUnit`, `amountKrwM`, `currency`, `period` (`monthly`/`quarterly`/`yearly`/`lumpsum`), `startYear`, `endYear`, `note`, `dupDismissed` | `lib/capability-cost-lines.ts:146-164` |
| `MANUAL_CATEGORIES` = five top-level keys; `normalizeLegacyLine` drops unknown categories | `lib/capability-cost-lines.ts:166,185-205` |
| `suggestCategory(resolution)`: build -> capex (alt labor), hire -> labor, partner -> opex, invest -> capex, unset -> capex with a hint | `lib/capability-cost-lines.ts:244-251` |
| `JUDGEMENT_CATEGORIES = ["labor","opex","capex"]`; the judgement owns `category` | `lib/capability-gap.ts:25` |
| Cost basis hash `c2` covers cost, months, resolution, grade, confirmation, category | `lib/capability-cost-lines.ts:262-264` |
| Staffing plan derives labor per year and a `recruitingOneOffKrwM` spent in startYear | `lib/staffing-plan.ts:37,223-287` |
| S8 `buildS5InvestmentPlan`: `capex` -> capex vector, `gov_rnd` -> inflow (full only), everything else -> labor/opex vector; `s5_plan` uses only capex, `s5_plan_full` also replaces the opex ratio where covered | `lib/business-case-generator.ts:934-1020` |
| Promotion copies manual lines into `business_case_line (category, name, annual_amount_krw_m, unit, start_year, end_year, growth_rate, note)`; note is flags plus the analyst note | `db/repositories/project.repository.ts:300-350` |
| `permit` and `certification` tables have `name, agency, statutory_days, status` and no cost column | `db/migrations/0011_dd_finding_and_remaining_tables.sql:275-300` |
| S10 tranche reconciliation reads the S8 case capex total | `lib/greenfield-execution.ts:82-135` |
| The investment tab renders a by-category table from `summary.byCategory` | `components/stages/GreenfieldStage.tsx:828-860` |

## 2. Sub-category vocabulary (a)

One constant `SUB_CATEGORIES` in a new pure module `lib/investment-subcategories.ts` (key, Korean label, parent, default period, S8 treatment note). Keys are stable ASCII; labels may be renamed without data change.

| Key | Label | Parent | Default period | Notes |
|---|---|---|---|---|
| `land_building` | `토지·건물` | capex | lumpsum | |
| `machinery` | `기계·설비` | capex | lumpsum | |
| `it_software` | `정보시스템·소프트웨어` | capex | lumpsum | SaaS subscriptions belong under opex `outsourcing` |
| `rnd_development` | `연구개발비` | capex | yearly | capitalised development |
| `tech_license` | `라이선스·기술 도입` | capex | lumpsum | running royalties: use opex `outsourcing` with a note |
| `patent_filing` | `특허 출원·등록` | capex | lumpsum | helper-eligible |
| `patent_maintenance` | `특허 유지·연차료` | capex | yearly | helper-eligible; see OD-2 |
| `fto_search` | `FTO·선행기술 조사` | capex | lumpsum | helper-eligible; see OD-2 |
| `trademark_design` | `상표·디자인 등록` | capex | lumpsum | helper-eligible |
| `cert_equipment` | `인증·인허가 설비` | capex | lumpsum | test rigs, facilities required by a permit or certification |
| `rent_utility` | `임차·유틸리티` | opex | monthly | |
| `materials` | `재료·소모품` | opex | yearly | |
| `outsourcing` | `외주·용역` | opex | yearly | |
| `marketing_sales` | `마케팅·영업` | opex | yearly | |
| `insurance_tax_legal` | `보험·세무·법무` | opex | yearly | |
| `product_cert` | `제품 인증 (CE/KC/ISO 등)` | opex | lumpsum | helper-eligible |
| `business_permit` | `사업 인허가` | opex | lumpsum | helper-eligible |
| `cert_maintenance` | `인증 유지·갱신·감사` | opex | yearly | helper-eligible, renewal period |
| `opening_working_capital` | `초기 운전자본` | opex | lumpsum | see OD-3 |
| `direct_labor` | `직접 인건비` | labor | yearly | staffing plan default |
| `recruiting_training` | `채용·교육비` | labor | lumpsum | staffing recruiting one-off |
| `management_labor` | `임원·관리 인건비` | labor | yearly | |

`revenue` and `gov_rnd` get no sub-categories in this ADR (no request; their S8 meaning is single-purpose). Grouping "개발·무형" from the PM draft is a display group (`optgroup`) inside capex, not a separate level: two levels only.

Rules: `subCategory` is optional; when set, its parent must equal the line's `category` (route 400 `subcategory_parent_mismatch`); changing the category clears an incompatible sub-category in the UI (with a chip, not silently). Unknown keys on read are kept as `legacySubCategory` text for display and dropped on next save with a visible warning. The default period column is a UI suggestion when the row is new only; it never overwrites a period a person set.

### 2.1 S8 consequence (explicit)

Under `s5_plan` only top-level `capex` feeds the S8 investment vector. Therefore patent, licence, FTO, trademark and development costs (parent capex) count as investment, while `product_cert`, `business_permit`, `cert_maintenance` and `opening_working_capital` (parent opex) are cross-check only unless the case uses `s5_plan_full`. Under `s5_plan_full` they replace the opex ratio in covered years.

Assessment and recommendation:

- Certification and permit acquisition is usually expensed and, for a new business, small next to capex; leaving it in opex is accounting-faithful. The real risk is that under `s5_plan` a one-off certification cost disappears from the NPV because the opex ratio ignores it. Recommendation (OD-1): keep the parent as opex (do not reclassify to capex to force it into NPV), and add a visible S8 provenance line `s5_plan 기준에서 제외된 S5 일회성 운영비 합계` listing one-off opex sub-categories that the basis ignores, so the reviewer chooses `s5_plan_full` knowingly. No calculation change.
- Patent maintenance fees are recurring and economically opex-like; placing them under capex makes `s5_plan` treat them as investment each year. Recommendation (OD-2): move `patent_maintenance` to opex (as `특허 유지·연차료` under opex) and keep filing, FTO and trademark registration under capex. Alternative: keep the decider draft as is and accept the overstatement. Flagged for the decider since it changes the draft list.
- `초기 운전자본` under opex is not accounting-correct (working capital is neither expense nor capex) and under `s5_plan_full` it would be read as an operating cost in its year. Recommendation (OD-3): accept for now as a lump-sum opex line with a fixed chip `운전자본 — S8에서 비용 처리됨, 회수 미반영`, and defer a proper working-capital treatment (outflow plus terminal recovery) to an S8 ADR. Do not route it to capex.

## 3. Quantity x unit-price helper (b)

Applies to any line, offered by default on helper-eligible sub-categories. Stored on the line as an optional object; the line `amount` becomes derived while the helper is active.

```ts
interface QuantityBasis {
  count: number;              // 건수, integer >= 1
  unitPriceKrwM: number;      // 건당 단가 (백만원), > 0, analyst-entered
  countries?: number;         // 해외 국가 수, integer >= 1; default 1 (domestic only)
  everyYears?: number;        // 갱신 주기 (년), integer 1..15; unset = one-off
  source: string;             // 단가 근거, required non-empty
  verifiedOn?: string;        // YYYY-MM-DD
}
```

Math: `occurrenceAmountKrwM = round2(count x countries x unitPriceKrwM)`; `round2` = 0.01 백만원 rounding, same as `amountKrwM`. Unit is fixed to `krw_m`, currency KRW; the helper is disabled for foreign-currency lines (FX excluded; a foreign quote is converted by the analyst, who records the rate in `source`).

Timing:

- `everyYears` unset: one-off; line `period = lumpsum`, spent in `startYear`.
- `everyYears = 1`: annual; `period = yearly`, amount = occurrence amount, from `startYear` to `endYear`/horizon.
- `everyYears = k > 1`: occurs in `startYear, startYear + k, ...` up to `endYear`/horizon. Current `period` values cannot express this, so a new optional line field `everyYears` is honoured by the S5 summary and simulation (spend in occurrence years only). Promotion expands such a line into one lump-sum `business_case_line` per occurrence year (same name with `(n회차)`), so S8 needs no schema change.

No default unit prices exist in code, seed or prompts. Any future embedded statutory fee table (for example patent office fees) requires a legal-verification step through the project's k-law practice before merge, its own source/verified_on fields, and an ADR amendment. This design states no fee amounts.

Validation (route, 400 with Korean messages): count and countries positive integers, unit price > 0, `source` non-empty, `everyYears` 1..15, helper only with KRW. If a person edits `amount` directly while the helper is active, the UI asks to detach the helper (the basis is kept as history in `note` text, not silently discarded).

## 4. UI in the investment tab (c)

- Unified item table: one new column `세부 과목` after `분류`, a select with optgroups for the current category plus `선택 안 함`. Picking a sub-category on a row with no category sets the parent automatically (`parent auto-derived`). Legacy rows show `—` and stay valid. Capability rows show the sub-category read-only with a `판정에서 수정` link (judgement owns it, like category). Staffing rows show the fixed default read-only.
- Row expander `수량 x 단가` on helper-eligible rows (and an opt-in action on any KRW row): fields 건수, 건당 단가 (백만원), 해외 국가 수, 갱신 주기 (년, blank = 일회), 단가 근거, 확인일; a live formula line `3건 x 2개국 x 1.5 = 9.00 백만원 / 회, 3년마다` and the occurrence years within the horizon. Chip `근거 없음` blocks save until `source` is filled.
- `투자비 요약`: the by-category table gains collapsible child rows per sub-category with subtotals, plus a `세부 과목 미지정` child row per category so totals reconcile exactly to the existing category row. A small note under capex states the S8 rule from 2.1. One-off opex sub-category totals are tagged `s5_plan 기준 NPV 제외`.
- Chips: `제안: <label>` (default not yet confirmed by a person), `AI 제안` (section 6), `운전자본 — 회수 미반영` (OD-3).
- Accessibility: the select has a visible label; the expander is a disclosure button with `aria-expanded`; chips carry text, never color only (Onyx 3.0 / design:lint).

## 5. Integration (d)

- Capability judgements: a judgement gains optional `subCategory` next to `category` (judgement-owned, preserved like category). Default suggestion by resolution and capability type: `build` -> `machinery` (or `rnd_development` when the capability type is technology/know-how), `hire` -> `direct_labor`, `partner` -> `outsourcing`, `invest` -> `machinery`, certification acquisition (capability type certification or note mentions a certification name from the project's certification table) -> `product_cert`, patent/licence -> `tech_license`. Suggestions are shown with `제안:` and never confirmed automatically. The cost basis hash moves to `c3` adding `subCategory`; c1/c2 keep matching for rows without one (same compatibility pattern as the 2026-10-15 amendment). Recommendation (OD-4): include it in the hash so a changed sub-category marks the reflection stale only if the decider wants sub-category to be audit-relevant; otherwise exclude it. Default proposal: exclude (sub-category does not change any amount or S8 path), keeping c2.
- Staffing plan: derived labor rows -> `direct_labor`; recruiting one-off -> `recruiting_training`. Shown as fixed; no new storage. The duplicate guard (manual labor line vs staffing plan) stays and now also compares sub-category: a manual `direct_labor` line triggers it, a manual `management_labor` line triggers it only when the staffing plan has a management role family.
- Simulation (ADR-0176): no new variable type. Helper lines use the manual-line range (±20%) by default; the range editor lets a person set a separate range per helper line on unit price and on count (triangular, mode = entered). Recommendation (OD-5): defer per-count ranges to after slice 2 ships; slice 2 only reuses the manual-line range.
- Promotion copy: `business_case_line` has no sub-category column. Recommendation (OD-6): carry it into the line `note` as a leading tag `[세부: 특허 출원·등록]` plus the helper formula and source (`3건 x 2개국 x 1.5 백만원, 근거: ...`), and expand `everyYears > 1` lines per occurrence. No schema change. A dedicated `sub_category` column is warranted only if S8/S10 must aggregate by sub-category; that is not requested and would need an ADR.
- S10: tranche reconciliation stays on the top-level capex total, unchanged. The S10 view may show capex sub-category tags parsed from the note for reading only; it never reconciles by them.
- Report composer: the investment section lists category subtotals as today and, when any line has a sub-category, a second table of sub-category subtotals with the 2.1 sentence about which ones the S8 basis counted. Text is generated from data, no new LLM call.

## 6. AI assist (e)

Proposal-only, same pattern as the judgement draft: an `AI 제안` action on manual lines without a sub-category suggests one from the line name and note (fill-empty-only, with a one-line basis), and the judgement draft may propose `subCategory` with its basis. AI never proposes or fills unit prices, counts, countries or amounts, and never changes the top-level category of a line a person set. Every proposal needs a person to accept it.

## 7. Compatibility and migration (f)

- S5: no migration. `subCategory`, `quantityBasis`, `everyYears` are optional JSON fields in `business_case_lines_json`; legacy lines read unchanged; `normalizeLegacyLine` passes known keys through.
- S8: no migration (note tag + per-occurrence expansion). `buildS5InvestmentPlan` is unchanged.
- Audit: line saves already audit; the helper's `source` is audited, values follow the existing manual-line rules.
- Stage 2 (separate ADR, schema change): add nullable `estimated_cost_krw_m`, `cost_source`, `cost_verified_on` to `permit` and `certification`, and an optional `linkedPermitId` / `linkedCertificationId` on S5 lines with a duplicate guard between a linked line and the table cost. Not designed in detail here.

## 8. Tests

- Unit: vocabulary integrity (unique keys, valid parents, labels non-empty); parent mismatch rejected; unknown key read as legacy; helper math and rounding (0.01), countries default, `everyYears` occurrence years inside the horizon, KRW-only; summary sub-category subtotals reconcile to category rows including the unassigned row; staffing and capability defaults; duplicate guard with sub-category; promotion note tag and per-occurrence expansion; no default price anywhere (grep test on the vocabulary module for numeric price fields).
- Route: 400 messages for each validation rule; read-only role cannot edit the helper.
- Regression: existing `tests/unit/capability-cost-lines.test.ts` and S8 `s5_plan` tests pass unchanged (category paths untouched).

## 9. Risks

| Risk | Mitigation |
|---|---|
| Sub-category mistaken for an S8 driver | 2.1 note in UI, report and S8 provenance line |
| Analyst-entered unit prices look authoritative | required `source`, `근거 없음` blocking chip, no system defaults |
| `everyYears` lines differ between S5 summary and S8 | promotion expands per occurrence; shared helper function for occurrence years used by both |
| Working capital booked as opex | OD-3 chip and deferral |
| Vocabulary sprawl | changes to `SUB_CATEGORIES` require an ADR-0177 amendment |

## 10. Slices

1. Vocabulary module, `subCategory` field, route validation, table column, summary sub-category subtotals, defaults from staffing plan and judgement resolution, duplicate guard update.
2. Quantity x unit-price helper (`quantityBasis`, `everyYears`), expander UI, summary and simulation honouring occurrence years.
3. Promotion carry (note tag, per-occurrence expansion), S8 provenance line for basis-excluded one-off opex, report-composer text, S10 read-only tags, AI sub-category proposal.
4. Separate ADR: permit/certification cost columns and S5 links.

## 11. Open decisions

| ID | Question | Recommendation |
|---|---|---|
| OD-1 | Certification/permit costs under opex are excluded from NPV under `s5_plan` | Keep opex; add an S8 provenance line showing the excluded one-off opex total |
| OD-2 | `특허 유지·연차료` parent | Move to opex; keep filing/FTO/trademark under capex |
| OD-3 | `초기 운전자본` under opex | Accept for now with a chip; proper treatment in a later S8 ADR |
| OD-4 | Sub-category in the capability cost basis hash | Exclude (stay on c2) |
| OD-5 | Separate simulation ranges for count and unit price | Defer; reuse manual-line ±20% |
| OD-6 | Promotion carry | Note tag, no column |
| OD-7 | Sub-categories for `revenue` / `gov_rnd` | None now |

## 12. Could not verify

- Whether the judgement data carries a capability "type" usable for the certification/patent default (only resolution was confirmed in `suggestCategory`); the type-based defaults in section 5 may reduce to resolution plus keyword matching.
- No patent/IP skill exists under `skills/` (only `certification-roadmap` and `certification-transferability`); the ip-agent role definition and the permits page UI were not read in detail.
- Accounting treatment of each sub-category (capitalise vs expense) under the group's policy; the parent mapping follows common practice and the decider draft, not a checked policy.
- Any statutory fee amounts (deliberately not stated).
- Not exercised in a browser; no code exists yet.
