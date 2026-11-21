# Meeting M1: New-Business Review Process Skeleton

**Date**: 2026-08-20
**Facilitator**: process-governance-manager
**Participants**: process-governance-manager, greenfield-agent, brownfield-agent, group-review-agent, valuation-agent, risk-officer
**Objective**: Define stage gates, per-gate deliverables/pass conditions, and a first-draft Kill Criteria list.

---

## Agenda
1. Confirm the gate sequence and what "done" means at each gate
2. Draft Kill Criteria per gate
3. Resolve Open Issue O-2 (first target industry/region) enough to seed procedures

## Discussion

**process-governance-manager**: Gate sequence per design: Screening → Pre-FS → FS → DD → Entity IC → Group IC. I need each of you to state the one deliverable your domain owns at each gate you touch, and the one condition that blocks you from moving forward.

**greenfield-agent**: Screening — market size + rough site shortlist. Pre-FS — infrastructure lead-time/cost estimate + regional incentive NPV comparison across candidates. FS — full capex schedule with permit critical path. Blocking condition: if wastewater capacity is insufficient at every candidate site, that's Kill Criteria at Screening, not something we discover at FS after sunk analysis cost.

**brownfield-agent**: Screening — target longlist + preliminary antitrust screen (rough HHI). Pre-FS — deal structure hypothesis. FS — full valuation with the six-way M&A cross-check started. DD — cross-check complete, all six dd_findings landed. Blocking condition: any of the six validators (antitrust, customer-retention, incentive, hr-integration, certification, region-lead) not run by end of DD blocks Entity IC entry — no exceptions, no waiver path for this one since it's a completeness check, not a judgment call.

**risk-officer**: I want that last point as an explicit Kill Criteria, not a soft gate. Also flagging: growth projections outside the top-decile base rate should trigger a mandatory risk-officer review before FS, not just a warning that sits in a report nobody reads.

**valuation-agent**: Agreed. I'd add: WACC and hurdle IRR must be confirmed (kind=user, not assumed) before FS starts — otherwise every downstream NPV is provisional and gets recomputed anyway.

**group-review-agent**: For Group IC — this only fires after Entity IC. My blocking condition is upstream of my own gate: if Entity IC approval isn't recorded in approval_chain, Group IC-level procedures must be unreachable, full stop (already decided at design level, restating here so it's in the procedure draft).

**process-governance-manager**: On O-2 (first target industry/region) — the design's worked example throughout is crankshaft/shipbuilding, Korea + EU. I'm ready to default to that per the design's stated default (O-2 in section 15.2) unless someone objects.

**greenfield-agent** / **brownfield-agent**: No objection — shipbuilding-adjacent gives us a genuinely two-hop proxy chain case (crankshaft→engine→ship) to build procedures against, which is the hardest case, not the easiest. Better to design against the hard case.

## Decisions

| # | Decision |
|---|---|
| D-M1-1 | Gate deliverables confirmed per domain as stated above; feeds procedures/_shared/*.yaml in Stage 2 |
| D-M1-2 | Kill Criteria draft v0: (1) all mandatory infra capacity absent at every GF site candidate, (2) any of the 6 M&A validators missing at DD exit for BF, (3) growth projection outside top-decile base rate without risk-officer sign-off, (4) covenant breach under downside scenario, (5) non-transferable mandatory certification |
| D-M1-3 | WACC/hurdle IRR must be `kind=user` (not `assumed`) before FS gate opens |
| D-M1-4 | **O-2 resolved**: first target industry = shipbuilding-adjacent (crankshaft/marine-engine chain), first regions = KR + EU |

## Action Items

| # | Action | Owner | Landing | Status |
|---|---|---|---|---|
| A-1 | Draft `procedures/_shared/greenfield-screening`, `procedures/_shared/brownfield-screening` skeletons using this gate/deliverable map | process-governance-manager | Stage 2 | Pending |
| A-2 | Seed `rag_rule` Kill Criteria conditions from D-M1-2 | risk-officer | Stage 2 `rag_rule` seed data | Pending |
| A-3 | Prioritize `industry-profiles/shipbuilding-adjacent.yaml` and `region-profiles/{KR,EU}.yaml` as first profiles | industry-lead, region-lead | Stage 2 (M6 timing) | Pending |

## Open Issues
None new. O-2 resolved and removed from the open-issues list.
