---
lang: ko
lang_reason: proper-noun
---

# ADR-0178 - S8 valuation method: S5 plan lines as P&L items, per-item volatility, separate pre-launch investment

- Status: Proposed
- Date: 2026-10-15
- Decider: Human decider (chat 2026-10-15: recommended option chosen on all three questions — split volatility by item, S5 plan lines as P&L items, separate pre-launch year-0 investment). Drafted by platform-lead. Acceptance pending.
- Design-of-record: [docs/designs/2026-10-15-s8-valuation-method-pnl-volatility-prelaunch-design.md](../designs/2026-10-15-s8-valuation-method-pnl-volatility-prelaunch-design.md)
- Related: ADR-0174 (`bc.investment_basis`, promotion copy, `s5_line_hash`), ADR-0175 (staffing plan, human-sourced salary), ADR-0176 (S5 investment simulation, per-draw pairing, `s5_sim`, `재평가 필요`), ADR-0170 (staleness), ADR-0052 §D.4 (seeded reproducibility)
- Slices: 5 (1 golden tests + pre-launch flag, 2 `s5_pnl` basis, 3 split volatility, 4 comparison/brief labelling, 5 optional Brown Field). None implemented by this ADR.

## Context (verified in code)

`runSeededSimulation` draws only revenue growth with one sigma (clamped 2%-25%, from DART historical vol and/or WACC asset vol). Cost is a ratio of revenue (`opex_ratio` default 0.6, `capex_ratio`), and S5 plan lines only partially substitute under `s5_plan` / `s5_plan_full`. Year 0 is a ratio of year-1 revenue, the Brown Field acquisition EV, or (under `s5_plan`) the plan's Year-1 capex, which conflates pre-launch outlay with launch-year capex. S5 line timing (`startYear >= 1`) cannot express "before launch".

## Decision

1. **Opt-in, bit-identical by default.** New behavior is reachable only through a new basis `bc.investment_basis = 3` (`s5_pnl`) and a new `bc.vol_mode = 1` (`split`). Golden tests freeze today's ratio, `s5_plan`, `s5_plan_full`, S5-sim-paired and Brown Field outputs before any engine change.
2. **Pre-launch flag** is `startYear: 0` on S5 line JSON (capex and manual lump-sum lines only). No new field, no `plan_meta` list, no column; legacy lines cannot carry 0, so their hashes and results are unchanged. A migration is added in Slice 1 only if the post-promotion line table constrains start year (to be verified).
3. **`s5_pnl` P&L**: per year, revenue (drawn, utilization-ramped) minus plan opex (labor/staffing + opex + gov_rnd) minus plan capex active that year; year 0 = sum of pre-launch lines; per-year ratio fallback only for years the plan does not cover, each labelled. Refused for projects without an S5 plan and for Brown Field.
4. **Split volatility**: revenue keeps the existing draw; cost uses the already-generated second Box-Muller normal (rng stream unchanged); investment is not re-drawn at S8 but taken from the confirmed S5 run via per-draw pairing, now including year 0. Shocks are treated as independent — an explicit, flagged simplifying assumption. Python engine stays bypassed on these paths; the deterministic BEP/payback path uses noise-free plan flows with year 0 = pre-launch.
5. **Provenance**: run notes add `vol_mode`, per-item sigma, and `prelaunch_krw_m`; `s5_line_hash` already covers the flag, so flag changes raise `재평가 필요`.
6. **Human ownership**: sigma values are proposals with sources until a person confirms them; the pre-launch flag is set per line by a person; no default prices, salaries or lines. Outputs are decision support — no gate block, no RAG grade effect, adoption stays human; data confidence still caps the RAG grade.
7. **Brown Field** is out of Slices 1-4.

## Consequences

- Plan-based projects can show operating leverage and a real pre-launch outlay; cross-basis comparisons need labels (Slice 4).
- The independence assumption and utilization-on-revenue-only rule need valuation-agent / quant-methodologist review before Slice 3 ships.
- Cost sigma will often be unconfirmed for Green Field projects; split mode then runs with cost sigma 0, shown.
- Pre-launch flags reach S8 only through promotion or the in-flight S5 re-import action.

## Open decisions

OD-1..OD-8 in design §14 (pre-launch capture, eligible categories, empty pre-launch, correlation, Brown Field scope, no-plan handling, utilization rule, sigma bounds).
