---
lang: ko
lang_reason: proper-noun
---

# ADR-0176 - S5 investment simulation (투자 시뮬레이션) and S8 business-paper evaluation consumption

- Status: Accepted (2026-10-15)
- Date: 2026-10-15
- Decider: Human decider (chat 2026-10-15, option B′: the investment simulation lives at S5 — the investment plan's owner; S8 does NOT re-simulate investment but consumes the S5 simulation output and combines it with revenue/WACC uncertainty; one shared computation module prevents divergence, the S8 run references the S5 simulation hash, and a changed S5 simulation flags the S8 evaluation `재평가 필요`). Drafted by platform-lead.
- Design-of-record: [docs/designs/2026-10-15-investment-simulation-and-s8-evaluation-design.md](../designs/2026-10-15-investment-simulation-and-s8-evaluation-design.md)
- Related: ADR-0174 (Accepted — total investment, horizon, per-line timing, `bc.investment_basis`, `s5_line_hash` provenance), ADR-0175 (Accepted 2026-10-15 — staffing plan, salary human-sourced only), ADR-0170 (staleness flag pattern), ADR-0052 §D.4 (seeded reproducible simulation), ADR-0005 (run-based versioning)
- Accepted by: the human decider in chat 2026-10-15: "ADR-0175 / ADR-0176 승인" (see Acceptance record).
- Slices: 4 (1 shared vectors module + S5 deterministic bands, 2 draws + sensitivity + envelope probability + run storage, 3 S8 consumption + provenance + `재평가 필요`, 4 S8 evaluation block + gate brief + AI support). None implemented by this ADR.

## Context (verified in code)

The S5 `투자비 요약` (ADR-0174 slice 1, shipped) and the S8 `s5_plan` capex vector (slice 2, shipped; `buildS5InvestmentPlan` with its `s5_line_hash` provenance) both consume line amounts as exact single-point values. S8's seeded Monte Carlo (`scenarioSeed`/`mulberry32`, `valuation_simulation` p05/p50/p95 persistence) currently carries zero investment uncertainty even under `s5_plan`: every input to the vector (capability cost, staffing salary, manual lines) is an estimate, yet the NPV distribution does not move with it. The staffing plan (ADR-0175) adds explicitly uncertain parameters (salary, increase, on-cost, headcount ramp) whose uncertainty nothing today shows or carries forward.

## Decision

1. **Layering (decided, option B′)**: the investment simulation belongs to S5. S8 never re-simulates investment; it consumes the S5 simulation's year-by-year investment distributions and combines them with its own revenue/WACC uncertainty.
2. **One shared computation module.** `lib/investment-vectors.ts` owns the deterministic year-vector computation (`buildInvestmentVectors`) and the per-draw perturbation (`drawInvestmentVectors`) over a shared rng stream, so a draw index means the same investment vectors at S5 and S8. The private `buildS5InvestmentPlan` refactors onto it (behavior-preserving, golden-tested on existing hashes); the S5 summary reads the same vectors.
3. **S5 simulation.** A seeded, deterministic Monte Carlo (`lib/investment-simulation.ts`) over the investment plan only. Variables with editable, human-confirmed ranges: salary ±10%, salary increase ±2%p, on-cost ±2%p only after a person enters a rate, headcount ramp ±half-year shift, capability costs ±30%, manual lines ±20%, FX ±10% (defined but inactive while foreign lines are excluded from KRW totals). Bounded variables draw triangular (min, mode = entered value, max); salary variables only range-shift an analyst-provided base — no salary value is ever fabricated (ADR-0175 rule). Default 500 draws (100..5,000) — amended, see Amendment 2026-10-16 (default draw count now 2,000). Outputs: per-year and per-category p05/p50/p95 bands, total-over-horizon distribution, an analytic tornado sensitivity ranking, and `예산 상한 초과 확률` when the person sets an envelope.
4. **Run storage.** New table `investment_simulation_run` (opportunity-keyed: id, `input_hash`, seed, draw count, assumptions JSON, results JSON, status/supersede chain, audit columns). Per-draw vectors are not stored — recomputed deterministically from (seed, lines, ranges). This migration is the ADR trigger. Rejected: a lines-json meta entry (a plan is not a run log) and the project-scoped `run` table (S5 is pre-promotion).
5. **S8 consumption.** Under `s5_plan(_full)`, the generator takes the latest confirmed S5 run's drawn investment vectors per draw (per-draw pairing) instead of the single-point plan; without a run, today's behavior holds with an `s5_sim=none` note. Run provenance records `s5_sim=<input_hash>`; a hash mismatch against the latest confirmed S5 run (or changed S5 lines) shows `재평가 필요` (ADR-0170 pattern) until S8 re-runs. The python engine stays bypassed on this path.
6. **S8 surface.** An `투자 불확실성` block in the evaluation summary (총 투자비 p50/p95, exceed probability, top sensitivities, an NPV-distribution-includes-investment-uncertainty chip) feeds the fs gate brief and the AI judgement support as labeled simulation output.
7. **Boundaries.** Assumption ranges are edited and confirmed by a person (audited `investment_simulation.confirmed` / `.run`); no gate block, no grade effect, no adoption trigger — outputs are proposals. A missing S5 simulation is surfaced, never blocking (recommended resolution of design OD-4).

## Consequences

- The decider sees how wrong the investment plan can be, per year and in total, before promotion; S8's NPV/IRR distributions finally reflect investment uncertainty without any second source of truth for it.
- Investment figures cannot diverge between S5 and S8: one module, per-draw pairing, hash provenance and the staleness flag.
- One additive migration; existing projects and both `ratio`/`s5_plan` paths are bit-identical until a first S5 run is confirmed.

## Acceptance record

- Approver: the human decider (user, account techcross), chat 2026-10-15: "ADR-0175 / ADR-0176 승인". Recorded in DEC-20261015-04.
- Basis: chat approval of the decision as written, including the design's recommended resolutions of OD-1..OD-7 (500 draws default, clamp 100-5000; p05/p50/p95; dedicated `investment_simulation_run` table; no simulation required before gate confirm, absence surfaced only; triangular FX inactive until foreign lines enter KRW totals; on-cost uncertainty only after a human-entered rate; half-year ramp as a discrete shift with triangular weights). Acceptance is by chat instruction; the decider did not review a per-item checklist, and this record does not claim the approver read specific items.
- Schema change: acceptance covers the new `investment_simulation_run` table; the migration is part of its slice implementation later.
- Implementation status: slice 1 shipped (PRs #580/#581). Slice 2 (seeded draws, tornado sensitivity, exceed probability, `investment_simulation_run` migration 0144, run/fetch route, S5 simulation-tab surface) implemented 2026-10-15 and covered by unit tests, not browser-verified. Slice 3 (S8 consumption of the latest confirmed run with per-draw pairing, `s5_sim=<hash>`/`none` provenance, `재평가 필요` staleness chip, human-only `investment_simulation.confirmed` route and additive migration 0146 with `confirmed_by`/`confirmed_at`/`confirm_audit_id`) implemented 2026-10-15 and covered by unit tests, not browser-verified; 0146 adds columns to the accepted table because Decision 5 consumes only a CONFIRMED run, and its acceptance rests on that decision text rather than a separate decider approval. Slice 4 (S8 `투자 불확실성` evaluation block in the summary strip, labeled line in the fs gate brief and the S8 adoption-recommendation AI support, additive `invest_uncertainty` field on `s8-lens-summary`, no migration) implemented 2026-10-15 and covered by unit tests, not browser-verified. All four slices are now implemented.
- Not verified by the AI: nothing of this ADR is implemented or browser-verified.

## Honest limits

Proposed 2026-10-15; the decider approved the layering (option B′) in chat, not a per-item checklist. Nothing implemented; the draw-count, percentile (p05/p95 vs p10/p90), storage, FX-shape and on-cost-scope open decisions carry recommendations in design §12 pending confirmation. Not exercised in a browser; the exact `MC_ITERATIONS` default was located but not re-derived; glossary coverage of `재평가 필요` not checked term-by-term.

## Amendment 2026-10-16: default draw count

Decided by the human decider in chat 2026-10-16: the S5 investment simulation default draw count changes from 500 to 2,000. The clamp (100..5,000) is unchanged, and existing stored runs keep their recorded draw count — this is a default only, never a rewrite of stored runs. Implementation status: **implemented** (2026-10-16: `DEFAULT_DRAWS = 2,000` in `lib/investment-simulation.ts`; clamp 100..5,000 unchanged; stored runs keep their recorded draw count). Decision 3 and the acceptance record above retain the historical "Default 500 draws" text; this amendment is the current position.
