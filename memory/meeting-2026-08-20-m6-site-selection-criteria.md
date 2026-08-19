# Meeting M6: Greenfield Site Selection Criteria

**Date**: 2026-08-20
**Facilitator**: greenfield-agent
**Participants**: greenfield-agent, incentive-agent, technical-dd-agent, legal-counsel, partnership-agent
**Objective**: Fix the multi-criteria site comparison weighting, the incentive-NPV conversion method, and how permit timeline factors in.

---

## Agenda
1. Site comparison scoring weights
2. Incentive NPV conversion method
3. Permit-timeline integration into site scoring

## Discussion

**greenfield-agent**: I want a concrete `site_candidate.total_score` formula, not just a list of factors. Proposal: infrastructure readiness (lead-time + capex, inverted so lower is better) 30%, incentive NPV 25%, logistics cost 15%, labor availability 15%, permit lead time (inverted) 15%.

**technical-dd-agent**: Infrastructure readiness needs wastewater treated as a gating factor before it enters the weighted score, per the design's explicit rule (verify wastewater before power — insufficient capacity blocks expansion outright, not just scores it lower). Propose: any site failing minimum wastewater capacity is excluded from scoring entirely, not merely penalized in the 30% weight.

**greenfield-agent**: Agreed — that becomes a pre-filter, not a scoring input. Revised: sites are first filtered on hard infrastructure minimums (wastewater capacity being the headline case), then scored on the weighted formula among survivors.

**incentive-agent**: NPV conversion method: discount each incentive's cash value (or cash-equivalent for tax abatement) at the same WACC used in the deal model, over the incentive's stated obligation period, net of the expected value of clawback risk if the obligation is later broken. That last part matters — an incentive with a harsh clawback and short retention window is worth less NPV than the headline amount suggests.

**legal-counsel**: On permit lead time — I want the DAG critical path (not just a single permit's lead time) driving the score, since parallel permits don't sum, and greenfield-agent's current formula description ("permit lead time 15%") needs to specifically mean critical-path days, not average or max of individual permits.

**partnership-agent**: Flagging a dependency the current formula doesn't capture: if the site plan depends on a partner (e.g., a JV for a shared utility corridor or a co-located supplier), partner-sourcing status should gate site readiness the same way infrastructure does — a technically ideal site is not real until the partner is actually contracted.

**greenfield-agent**: Fair, but I don't want to conflate two different Kill-Criteria-adjacent concerns into one score. Proposal: partner dependency becomes a second pre-filter flag (site marked "conditional" until partner confirmed) rather than a weight, mirroring how partnership-agent's own design entry treats partner-sourcing failure as Kill Criteria, not a soft score.

## Decisions

| # | Decision |
|---|---|
| D-M6-1 | Site scoring is two-stage: (1) hard pre-filter on infrastructure minimums (wastewater capacity headline case) and partner-dependency confirmation, (2) weighted score among survivors: infra readiness 30%, incentive NPV 25%, logistics cost 15%, labor availability 15%, permit critical-path (inverted) 15% |
| D-M6-2 | Incentive NPV = discounted cash-equivalent value at deal WACC over the obligation period, net of expected clawback risk (not headline amount) |
| D-M6-3 | Permit-lead-time score input is the DAG critical path, not any single permit's lead time |
| D-M6-4 | A site is marked "conditional" (excluded from final ranking) until any required partner dependency is confirmed by partnership-agent |

## Action Items

| # | Action | Owner | Landing | Status |
|---|---|---|---|---|
| A-1 | Implement the two-stage filter+score formula in `site_candidate` comparison logic | greenfield-agent, backend-engineer | Stage 2 procedures, Stage 5 implementation | Pending |
| A-2 | Confirm incentive NPV formula against WACC input session's discount rate source | incentive-agent, valuation-agent | Stage 2 cross-check | Pending |

## Open Issues
None new.
