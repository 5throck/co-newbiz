---
lang: ko
lang_reason: proper-noun
---

# ADR-0178 - S8 valuation method: S5 plan lines as P&L items, per-item volatility, separate pre-launch investment, pinned S5 reference

- Status: Accepted (2026-10-15)
- Date: 2026-10-15
- Decider: Human decider (chat 2026-10-15, three rounds: round 1 chose the recommended option on all three questions; round 2 decided per-line pre-launch marking, ramp-inclusive cost lines with utilization on revenue only, and cost uncertainty sourced from the confirmed S5 investment simulation run; round 3 decided Green Field S5-S8 linkage option B — S5 single source, S8 pinned reference). Drafted by platform-lead.
- Accepted by: the human decider in chat 2026-10-15: "승인 + OPEN-1~3 추천안" (see Acceptance record; DEC-20261015-06).
- Design-of-record: [docs/designs/2026-10-15-s8-valuation-method-pnl-volatility-prelaunch-design.md](../designs/2026-10-15-s8-valuation-method-pnl-volatility-prelaunch-design.md)
- Related: ADR-0174, ADR-0175, ADR-0176, ADR-0170, ADR-0052 §D.4
- Slices: 0 pinned reference + stale + re-pin (migration), 1 pre-launch flag, 2 `s5_pnl` basis, 3 split volatility from the pinned S5 run + revenue sigma confirmation, 4 labelling in comparison/IC/gate brief/reports, 5 optional Brown Field. None implemented by this ADR.

## Context (verified in code)

`runSeededSimulation` draws only revenue growth with one sigma (clamped 2%-25%). Cost is a ratio of revenue; S5 plan lines only partially substitute under `s5_plan` / `s5_plan_full`. S8 consumes only the S5 run's capability/manual factors; staffing factors are not consumed because the staffing plan is not promoted. Year 0 conflates pre-launch outlay with launch-year capex; S5 line timing (`startYear >= 1`) cannot express "before launch" (the `business_case_line.start_year` column itself has no CHECK). The S5 plan reaches S8 only as a row copy (`greenfield_cost` model written by `writeS5CostModel` at promotion and by the PR #590 re-import), read by `resolveS5InvestmentPlan`, `resolveBusinessCaseParams`, `buildS8JobSpec` and `defaultExecutor`; the copy can drift from S5 silently.

## Decision

1. **Linkage (option B).** For Green Field, S5 is the single source. On the new path S8 stores only a pin in a new append-only table `s5_plan_pin` (`plan_hash` = hash of `loadInvestmentVectorsInput`, `input_snapshot_json` = that input as pinned, pinned S5 run id and input hash, actor, time, supersede chain) and computes against the pinned snapshot through the shared modules; the live S5 source is read only for the stale hash and for the next re-pin. No live read. A changed S5 source or a newer confirmed run raises `재평가 필요`; a person (analyst or above, human only, audited) presses `최신 S5로 갱신` to re-pin, which absorbs the PR #590 re-import button. Re-pinning never alters existing cases, simulations or adopted results. Projects without a pin keep the copy path bit-identically; the promotion copy is kept. Migration in Slice 0, carried by this ADR.
2. **Opt-in, bit-identical by default.** `bc.s5_source = 1` (pinned), `bc.investment_basis = 3` (`s5_pnl`), `bc.vol_mode = 1` (`split`); the latter two require the pinned path. Golden tests and a copy-vs-pin parity test come first (Slice 0).
3. **Pre-launch** = `startYear: 0` on S5 line JSON, capex and manual lump-sum lines only; included in `plan_hash`.
4. **`s5_pnl` P&L**: utilization scales revenue only; flow_t = revenue_t x util_t - plan opex_t - plan capex_t; year 0 = undiscounted sum of pre-launch lines (0 with a warning if none); ramped-revenue ratio fallback for uncovered years. Refused without a plan and for Brown Field. Pre-tax cash proxy; terminal-value vs plan-margin mismatch flagged.
5. **Volatility (`split`)**: revenue keeps today's draw; person-confirmed revenue sigma 0-50% with source note, truncation at 0 recorded. All plan cost lines (labor/staffing, opex, gov_rnd where perturbed, capex incl. year 0) take uncertainty from the pinned confirmed S5 run, recomputed per draw from seed at the pinned source. No S8 cost sigma; fallback years carry none and say so.
6. **Independence** of revenue and S5-run draws is an explicit simplification; correlation out of scope.
7. **Deterministic path** uses noise-free pinned plan flows; no payback call when pre-launch = 0. Python engine bypassed on new paths.
8. **Human ownership**: no default prices, salaries, lines or sigmas; decision support only — no gate block, no RAG grade effect, adoption stays human; data confidence caps the RAG grade.
9. **Brown Field** out of Slices 0-4 (S7 per-target structure unchanged; no pin rows).

## Consequences

- S8 can no longer drift silently from S5 on the pinned path; staleness is explicit and re-pinning is a recorded human act.
- Two paths (copy and pin) coexist until a later decision; consumers move to the pinned read in Slice 0 (generator) and Slice 4 (IC package, gate brief, report composer text only). The S10 carry reads the adopted case and is unaffected.
- The pin stores a snapshot of the S5 input so the pinned version stays re-readable after S5 is edited (OPEN-1); new Green Field projects stay on the copy path by default until Slices 0-1 have run on real projects (OPEN-2).
- Cost dispersion is understated in fallback years and for categories the S5 run does not perturb.

## Open decisions

None. OPEN-1..3 resolved at acceptance as recommended (design §14).

## Acceptance record

- Approver: the human decider (user, account techcross), chat 2026-10-15, answering "approve ADR-0178 (S5 single source + pinned reference, P&L, volatility, pre-launch investment) as summarised, and confirm OPEN-1..3 as recommended?" with "승인 + OPEN-1~3 추천안". Recorded in [DEC-20261015-06](../decisions/DEC-20261015-06.md).
- Basis: chat approval of the decision as summarised in the final amendment, including OPEN-1..3 as recommended — OPEN-1 store the pinned S5 input snapshot JSON in `s5_plan_pin` in the Slice 0 migration; OPEN-2 keep the copy path as the default for Green Field projects promoted after Slice 0 until Slices 0-1 have run on real projects; OPEN-3 re-pin by a human with analyst role or above only — plus the earlier round answers: per-line pre-launch marking (`startYear: 0`); S5 cost lines entered with utilization already reflected, so utilization scales revenue only; cost uncertainty from the confirmed S5 simulation run; S5 as single source with a pinned S8 reference. Acceptance is by chat instruction; the approver did not review a per-item checklist, and this record does not claim the approver read specific items.
- Schema change: acceptance covers the new `s5_plan_pin` table (incl. the snapshot column); the migration is part of Slice 0.
- Implementation status (2026-10-16): Slice 0 implemented (migration 0147 `s5_plan_pin`, pinned read path behind `bc.s5_source = 1`, stale rules, `최신 S5로 갱신` re-pin, promotion initial pin, golden and parity tests); not browser-verified. Slice 1 implemented (`startYear: 0` for capex lump-sum lines only, `preLaunchAmountOf`, S5 totals/schedule/bands/simulation and `plan_hash` carry the year-0 amount only when a line is marked, copy/re-import/pin carry 0 faithfully, S8 copy and pinned paths exclude year-0 lines from the per-year vectors and report `prelaunch_krw_m` with a visible flag until `s5_pnl`; no migration); not browser-verified. Slices 2-5 are not implemented. The copy path is unchanged and golden-tested; new Green Field projects stay on it until a person opts in (OPEN-2).
- Not verified by the AI: the Slice 0 UI is not browser-verified, the dev DB was not queried, and Slices 1-5 are not implemented. Slice 0 implementation-time verifications (code and tests, 2026-10-15): editing a `bc.*` assumption does not mark any case stale (no invalidation exists besides `s5_sim`); the S5 simulation does not perturb `gov_rnd` (excluded from the S5 vectors and from the S5 input hash); the adopt API checks only project membership and archive state, so a person can adopt the promotion copy model and the S10 carry would then read it, although the UI offers adoption on generated scenario cases only; the PR #590 re-import route and button behave as described and are absorbed by the re-pin for pinned projects.

## Honest limits

Approved in chat as summarised, not item by item. Only Slice 0 is implemented (not browser-verified). The design's valuation simplifications stand: independence of revenue and S5-run draws, pre-tax cash proxy, undiscounted year 0, terminal multiple vs plan margin flagged only, no cost uncertainty in ratio-fallback years, python engine parity unaddressed. Copy and pin paths coexist until a later decision. Brown Field is out of scope.
