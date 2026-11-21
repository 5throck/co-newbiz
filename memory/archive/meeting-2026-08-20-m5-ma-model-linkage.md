# Meeting M5: M&A Special-Topic Model Linkage

**Date**: 2026-08-20
**Facilitator**: brownfield-agent
**Participants**: brownfield-agent, antitrust-agent, customer-retention-agent, incentive-agent, hr-integration-agent, valuation-agent
**Objective**: Fix exactly which `assumption` keys each M&A special topic feeds, and the valuation-bridge line items.

---

## Agenda
1. One assumption_key (or dd_finding path) per special topic, concretely named
2. Confirm the valuation bridge line items
3. Sequencing — which of the six validators can run in parallel vs. must be sequential

## Discussion

**brownfield-agent**: I want each of you to name the actual key your finding lands under, not just "feeds the model" in the abstract — that abstraction is exactly what let findings stay narrative in past reviews.

**antitrust-agent**: Two paths. (1) Filing delay → `assumption_key = closing_delay_months`, feeds the DCF's start-of-cashflow timing. (2) Remedy scenario (divestiture) → `dd_finding.value_impact` as a direct revenue/EBITDA haircut, scenario-tagged so it shows up in scenario comparison, not silently baked into the base case.

**customer-retention-agent**: `dd_finding.value_impact` per at-risk customer, tagged with `churn_probability`, rolled up into a `customer_attrition_revenue_at_risk` assumption feeding the base-case revenue build — not a footnote, an actual haircut applied before valuation-agent's DCF runs.

**incentive-agent**: Two directions, same table (design already fixed this — obligation and clawback are one record). Acquisition case: `assumption_key = incentive_npv` feeds site/deal comparison. Relocation case: `estimated_clawback` feeds `dd_finding.value_impact` as a cash outflow at the relocation date.

**hr-integration-agent**: Golden parachute → `dd_finding.value_impact` as a day-one cash outflow (not amortized — it's paid at closing). Compensation harmonization → `assumption_key = comp_harmonization_annual_cost`, and per the design's upward-bias default, this is *always* positive, never a savings line, regardless of which side's pay was higher pre-deal.

**valuation-agent**: Receiving all of this — I want a fixed evaluation order so the six don't step on each other: antitrust and hr-integration findings affect the DCF cashflow schedule directly (closing delay, day-one outflows), so they resolve first; customer-retention and incentive affect the revenue/cost build, second; certification (transferability) can either preserve or strip the valuation premium entirely, so it resolves last since it can invalidate everything upstream if the answer is "not transferable."

**brownfield-agent**: Agreed on valuation-agent's ordering. Noting region-lead wasn't in this room but is the sixth mandatory validator (TUPE/works-council labor findings feed hr-integration-agent's inputs) — recorded as a dependency, not a gap, since region-lead's output is an input to hr-integration-agent rather than a separate model path.

## Decisions

| # | Decision |
|---|---|
| D-M5-1 | Named linkage confirmed: antitrust→`closing_delay_months` + scenario-tagged remedy haircut; customer-retention→`customer_attrition_revenue_at_risk`; incentive→`incentive_npv` (acquire) / `estimated_clawback` (relocate); hr-integration→day-one golden-parachute outflow + `comp_harmonization_annual_cost` (always positive) |
| D-M5-2 | Certification transferability resolves LAST in the valuation sequence — it can strip the entire acquisition premium and must not be computed against a valuation that already assumed transferability |
| D-M5-3 | Evaluation order: (1) antitrust + hr-integration cashflow-schedule effects, (2) customer-retention + incentive revenue/cost build, (3) certification transferability gate |
| D-M5-4 | region-lead's labor findings (TUPE, works council) are an input to hr-integration-agent, not a separate model path |

## Action Items

| # | Action | Owner | Landing | Status |
|---|---|---|---|---|
| A-1 | Encode D-M5-1/D-M5-3 ordering into the brownfield procedure's DD-to-valuation step sequence | brownfield-agent, process-governance-manager | Stage 2 procedures | Pending |
| A-2 | Confirm `comp_harmonization_annual_cost` is schema-constrained to non-negative (structural enforcement of the upward-bias default) | data-architect | Stage 4 db-schema.md | Pending |

## Open Issues
None new.
