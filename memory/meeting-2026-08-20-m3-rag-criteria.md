# Meeting M3: RAG Scoring Criteria

**Date**: 2026-08-20
**Facilitator**: process-governance-manager
**Participants**: process-governance-manager, financial-analyst, quant-methodologist, risk-officer
**Objective**: Define the six dimensions concretely, per-gate thresholds, and confirm the data-confidence cap and hysteresis bands with real numbers.

---

## Agenda
1. Define pass/fail conditions per dimension per gate
2. Confirm the data-confidence cap table with concrete grade→cap mapping
3. Set hysteresis bands with numbers, not just the principle

## Discussion

**process-governance-manager**: Six dimensions: financial, market, data confidence, regulatory/permit, technical/execution, risk. I want concrete per-gate thresholds, not just "Green/Amber/Red."

**financial-analyst**: Financial dimension: Green requires IRR ≥ hurdle+2.0pp AND DSCR ≥ 1.3x downside; Amber is IRR ≥ hurdle but below the Green band; Red is IRR < hurdle in the base case. This only makes sense once WACC/hurdle are `kind=user` — which M1 already made a Pre-FS precondition, so the sequencing works.

**quant-methodologist**: Data confidence dimension — this is the one that caps everything else, so I want the mapping explicit: chain reliability A → confidence Green; B → confidence Amber; C or staleness-gate violation → confidence Red ("판단 보류"). No dimension below data confidence's cap can push the overall grade above it, full stop.

**risk-officer**: Confirming the cap logic in rule form: `overall = RED if any dimension is RED OR kill_criteria_triggered; overall = GREEN only if all dimensions GREEN AND data_confidence GREEN; else AMBER`. That's a strict min-like rule, not an average — worth stating in the actual rag_rule schema as a priority-ordered rule list, not a weighted score, so nobody accidentally reimplements it as an average later.

**process-governance-manager**: Hysteresis bands with numbers: promotion Amber→Green requires IRR ≥ hurdle+2.0pp (matching financial-analyst's Green band) sustained for the equivalent of one full run cycle (i.e., not just a single day's fetch); demotion Green→Amber triggers at IRR < hurdle+0.5pp. Minimum grade hold period: 7 days before a re-promotion is allowed, to stop day-to-day flapping.

**financial-analyst**: That 7-day minimum needs to be measured against `run` timestamps, not wall-clock alone, since two runs on the same day from a manual re-trigger shouldn't count as satisfying the hold period.

## Decisions

| # | Decision |
|---|---|
| D-M3-1 | Financial dimension bands: Green = IRR≥hurdle+2.0pp AND DSCR≥1.3x; Amber = IRR≥hurdle below Green band; Red = IRR<hurdle |
| D-M3-2 | Data confidence cap: chain grade A→confidence Green, B→confidence Amber, C or staleness violation→confidence Red |
| D-M3-3 | Overall RAG rule is priority-ordered (Red if any Red or Kill Criteria; Green only if all Green including confidence; else Amber) — explicitly NOT a weighted average |
| D-M3-4 | Hysteresis: promote at IRR≥hurdle+2.0pp, demote at IRR<hurdle+0.5pp, minimum 7-day hold measured against `run` timestamps not wall-clock |

## Action Items

| # | Action | Owner | Landing | Status |
|---|---|---|---|---|
| A-1 | Encode D-M3-1 through D-M3-4 as literal `rag_rule` seed rows | process-governance-manager, risk-officer | Stage 2 rag_rule seed | Pending |
| A-2 | Confirm 7-day hold-period run-timestamp logic is implementable against the `run` schema | data-architect | Stage 4 cross-check | Pending |
| A-3 | Calibration dry-run (Stage 3, per risk-officer's original proposal) tests these exact numbers against 5-10 historical decisions | risk-officer | Stage 3 | Pending |

## Open Issues
None new — this meeting made prior principles (design S8.2) concrete with numbers, which is what was missing.
