---
lang: ko
lang_reason: proper-noun
---

# ADR-0174 - Total investment definition, S5 investment summary and S8 hand-off (`투자비 요약`, `총 투자비`)

- Status: Proposed
- Date: 2026-10-15
- Decider: Human decider (chat 2026-10-15 feedback: annual vs total investment not visible in S5; total investment must be organised for S8). Drafted by platform-lead.
- Design-of-record: [docs/designs/2026-10-15-total-investment-and-s8-handoff-design.md](../designs/2026-10-15-total-investment-and-s8-handoff-design.md)
- Related: ADR-0173 (capability cost lines; its slice 2 re-import is absorbed here as slice 3), ADR-0137/0138 (S5 lines copied at promotion; `gov_rnd`), ADR-0106 (initial investment ratio), ADR-0114 (capex outside the margin), ADR-0101 (S11/S12 post-management)
- Slices: 4 (1 S5 summary panel + definitions + storage, 2 promotion copy + S8 consumption, 3 re-import, 4 S10/S12 alignment). None implemented by this ADR.

## Why a new ADR (not an ADR-0173 amendment)

ADR-0173 decides how capability closing costs enter the S5 lines. This decision redefines what the whole S5 line set means (time axis, horizon, totals) and changes how S8 computes NPV/IRR, which is a valuation-method change for every greenfield project, not only capability lines.

## Context (verified in code)

- S5 lines (`greenfield_assessment.business_case_lines_json`) carry `category`, `amount` (백만원 with `amountUnit: "krw_m"`), `period` (`monthly|quarterly|yearly|lumpsum`), `currency`; no year, no horizon. `investmentTotals` adds lump sums as entered and recurring lines annualised into one number.
- Promotion copies each line once into a `greenfield_cost` model (`horizon_years` hard-coded 5) with `annual_amount_krw_m = amount x period multiplier` (lump sum x1, flag in note), `start_year = 1`, `growth_rate = 0`, `unit` left NULL.
- S8's generator never reads the `greenfield_cost` model. Year-0 investment is `year-1 revenue x bc.initial_investment_ratio` (0.5 default) and yearly capex/opex are `revenue x bc.capex_ratio / bc.opex_ratio`; horizon is `bc.horizon_years` (5 default). S5 amounts therefore do not affect NPV, IRR, payback or the capability-adjusted scenario.
- Downstream readers of `business_case_line` (`business-targets.ts` final-year figures, S10 tranche reconciliation in `greenfield-execution.ts`) treat every line as recurring from `start_year` to the horizon, so a lump sum copied as a line would be multiplied by the remaining years if such a model were ever adopted.

## Decision (proposed)

1. **Definitions.** `연간 투자비` = annual run-rate of recurring KRW cost lines (labor, opex, capex). `일시 투자비` = sum of KRW lump sums. `총 투자비` = lump sums + each recurring line x its active years inside the `검토 기간`, by category and overall. Revenue and `정부 R&D` are shown but never part of 투자비. Non-KRW lines are listed and flagged, never converted.
2. **Horizon.** One horizon, `검토 기간` (years, default 5 = S8 default). Entered in S5 before promotion; at promotion it seeds the copied model's `horizon_years`; after promotion S8's `bc.horizon_years` is authoritative and a mismatch is shown, never silently reconciled.
3. **Per-line timing.** Optional `startYear` (default 1) on every line and optional `endYear` on recurring lines (default horizon end). Capability lines default their spend year from the milestone months (`ceil(months / 12)`, minimum 1), editable.
4. **S5 screen.** A read-only `투자비 요약` panel: annual, lump-sum and total figures by category, plus a Y1..YN schedule with a totals row, all in 백만원. The AI recommendation and judgement flows are unaffected.
5. **Storage.** No S5 schema change: new optional fields on line objects plus one `source: "plan_meta"` entry in the same JSON array for the horizon. One additive migration for S8: nullable `business_case_line.end_year` (NULL = through horizon) so a lump sum is a one-year line. This DB schema change is the ADR trigger.
6. **S8 hand-off.** Promotion writes one line per S5 line with `start_year`, `end_year` (= start for lump sums), `unit = 'KRW_M'`. S8 gains a human-chosen `투자비 기준` per project: `비율 추정` (today) or `S5 투자 계획` (explicit capex schedule replaces both the year-0 ratio investment and `capex_ratio x revenue`; opex stays ratio-driven unless a person opts in), so the two bases are never added together.
7. **Re-import** (absorbs ADR-0173 slice 2): a human `S5 투자비 다시 가져오기` action in S8 shows a diff and applies selected changes as a new model version; never background sync.
8. **Boundaries.** Agents propose; choosing the investment basis, the horizon and re-import are human actions with audit events. Outputs remain decision support.

## Consequences

- S8 NPV/IRR/payback for greenfield can, by human choice, reflect the actual S5 investment plan and its timing; the ratio path remains the default so existing cases do not move.
- S10 tranche reconciliation and S12 targets compare against a correct capex total once `end_year` is honoured.
- Legacy S5 lines read as Y1 start, recurring every year in horizon; legacy model lines have NULL `end_year` and behave as today.

## Honest limits

Not exercised in a browser; S12 investment tracking was only traced through `business-targets.ts`; whether a `greenfield_cost` model can be adopted in `s8_case_adopt` today was not confirmed. See design section 14.
