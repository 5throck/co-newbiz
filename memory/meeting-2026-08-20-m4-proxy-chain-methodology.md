# Meeting M4: Data Confidence & Proxy Chain Methodology

**Date**: 2026-08-20
**Facilitator**: quant-methodologist
**Participants**: quant-methodologist, market-intelligence-agent, financial-analyst, data-architect
**Objective**: Confirm chain-grade criteria, error propagation formula, and the separation principle between proxy-chain and value-chain-linkage coefficients.

---

## Agenda
1. Define A/B/C grade criteria concretely
2. Confirm the error propagation / attribution approach
3. Re-confirm the proxy-chain vs. value-chain-linkage separation with a concrete test

## Discussion

**quant-methodologist**: Grade criteria, concretely: A = engineering conversion (fixed physical coefficient, no regression) or direct market data. B = single-hop statistical conversion with R² ≥ 0.6 and a defensible lead-lag. C = multi-hop statistical conversion, or any hop with R² < 0.6, or a hop that mixes order-intake and order-backlog series (the exact failure mode flagged repeatedly in the design).

**market-intelligence-agent**: On the crankshaft case specifically — crankshaft→marine-engine is a hop we may be able to source engineering coefficients for (engines-per-ship, crankshaft-weight-per-engine are physical facts, not statistics). Marine-engine→ship demand is where the actual statistical hop lives. That's genuinely a 1-engineering-hop + 1-statistical-hop chain, which should land as B overall if the statistical hop clears R²≥0.6 — worth stating since "two-hop" doesn't automatically mean "worse than one-hop," it depends which hops are engineering vs. statistical.

**quant-methodologist**: Good catch — grade is about the statistical hops specifically, not hop count. I'll correct the mental model: grade the chain by its statistical hops only; engineering hops don't degrade the grade, they just don't upgrade it either.

**financial-analyst**: On error propagation — I'd like per-hop confidence intervals compounded multiplicatively (relative error terms add in quadrature for independent hops), not simple addition, since simple addition overstates combined uncertainty for genuinely independent regression errors.

**data-architect**: That maps cleanly onto `proxy_link.ci_low/ci_high` per hop; the compounded chain CI is a derived value at the `proxy_chain` level, computed at calibration time, not runtime — cheaper and matches how `reliability_grade` is already meant to be precomputed.

**quant-methodologist**: On the separation test (design S8.4/8.5) — concrete test for Stage 3/5 verification: take the shipbuilding case, force a `value_chain_link` coefficient to be reused as a `proxy_link` coefficient in a test harness, and confirm the system either rejects it at the schema level (different tables, no shared FK path) or at minimum the calibration script refuses to read from the wrong table. I want this as an actual verification step, not just a design-doc statement.

## Decisions

| # | Decision |
|---|---|
| D-M4-1 | Chain grade A/B/C criteria confirmed: A=engineering or direct data; B=single statistical hop R²≥0.6 defensible lag; C=multi statistical hop or R²<0.6 or intake/backlog conflation |
| D-M4-2 | **Correction to prior framing**: grade is driven by statistical hop count, not total hop count — engineering hops (physical coefficients) don't degrade the grade |
| D-M4-3 | Error propagation: per-hop CIs compound via quadrature (independent relative errors), computed at calibration time and stored on `proxy_chain`, not recomputed at runtime |
| D-M4-4 | Separation between `proxy_link` and `value_chain_link` verified structurally (no shared FK, calibration script scoped to its own table) as an explicit Stage 5 verification step |

## Action Items

| # | Action | Owner | Landing | Status |
|---|---|---|---|---|
| A-1 | Source engineering coefficients (engines/ship, crankshaft-weight/engine) for the shipbuilding pilot chain | quant-methodologist | Stage 3 pilot | Pending |
| A-2 | Implement quadrature-based CI compounding in `python/correlation.py` | quant-methodologist, backend-engineer | Stage 5.2 | Pending |
| A-3 | Add the structural-separation check to the Stage 5 verification checklist | data-architect | Stage 5 verification | Pending |

## Open Issues
None new.
