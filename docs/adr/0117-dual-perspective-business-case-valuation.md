# ADR-0117: Dual-perspective business-case valuation (market_forward vs historical)

- Status: Accepted
- Date: 2026-09-11
- Deciders: PM (dispatch), quant-methodologist (methodology), valuation-agent (model), financial-analyst (growth basis), frontend-engineer (comparison UI)
- Related: ADR-0098 (S8 generation), ADR-0052 §D.4 (seeded determinism), ADR-0106 (initial investment), ADR-0116 (company financial facts), approved mockup `docs/designs/mockups/2026-09-11-dual-view-valuation-ui-mockup_ko.html`

## Context

The S8 generator grew each scenario case from a single growth anchor — the
S2 opportunity's `growth_rate` (fallback 5%) — with a hardcoded 2% annual
dispersion. User direction after the Phase-1 review: the business case must
consider **market growth rate and future variability**, not just past
financials, and the two valuation perspectives must be **shown side by side
for comparison**, because how much the conclusion depends on the growth
assumption is itself decision-relevant information for the fs gate.

## Decision

1. **Two variants per scenario case, same seeded engine.**
   `business_case_model.variant` (migration 0085) is `market_forward`
   (default) or `historical`:
   - **market_forward (1차)** — anchor: `opportunity.growth_rate` (fallback
     5%, preserved as the labeled last resort). Dispersion: a forward
     profile — historical revenue volatility blended with the WACC session's
     `wacc.beta_vol_asset` when both exist, else whichever exists, else the
     legacy 2% floor.
   - **historical (비교)** — anchor: the bound company's DART revenue CAGR;
     dispersion: the historical YoY stdev. Requires ≥2 revenue years;
     otherwise the variant is **not generated** — the UI shows N/A with a
     connect+sync CTA. Missing data is never fabricated.
   - Dispersion is clamped to [2%, 25%] and every value's source is
     persisted in `business_case_line.note` / `valuation_simulation.note`
     (`variant=`, `growth_source=`, `sigma=`, `sigma_source=`).
2. **The gate judges market_forward only.** S8 completion, kill criteria,
   and the RECOMMENDED flag (`recommendedFromDb`) read market_forward rows
   exclusively — the historical variant is comparison evidence and can never
   become the recommendation. Legacy rows (pre-0085) default to
   market_forward, so existing projects keep their semantics.
3. **Generation is additive per variant.** One generate click runs
   scenario × variant × 4-step chains (activity ids
   `scenario:variant:step`); a scenario without historical data runs only
   its market_forward chain. Boundary #2 is unchanged — nothing writes an
   adoption marker or gate decision.
4. **UI shows the comparison, not a blended number.** The S8 page groups
   cases by scenario into a comparison table (perspective | growth (source)
   | σ (source) | NPV p05/p50/p95 | IRR | Δp50 vs the primary variant). The
   IC package (`/api/projects/[id]/ic-package`) carries the adopted case's
   sibling-variant rows (`comparison`) so the committee sees the assumption
   sensitivity. The blended-growth option considered earlier was rejected:
   a single blended number hides exactly the information the user asked to
   see.

## Consequences

- A project without a bound company (or without ≥2 revenue years) loses
  nothing: it generates 3 market_forward cases exactly as before; the
  historical column appears once ADR-0116's connect+sync flow has run.
- `runSeededSimulation(inputs, scenario, variant = "market_forward")` keeps
  its seed contract per (project, scenario) — both variants share the seed,
  so differences come only from the growth/dispersion parameters, which are
  all persisted for reproduction.
- Volatility inputs improve automatically as their sources land: today the
  profile uses DART historical vol + `wacc.beta_vol_asset`; the KRX adapter
  (Phase 8) will add subject betas, and ECOS (Phase 3) grounds Rf-adjacent
  series.
- Legacy assertions pinned to the old activity-id format
  (`scenario:step`) were updated to `scenario:variant:step`.
