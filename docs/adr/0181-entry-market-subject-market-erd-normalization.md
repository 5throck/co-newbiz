---
lang: ko
lang_reason: proper-noun
---

# ADR-0181 - Entry market as the subject market: integrated S2 derivation, multi-currency FX, ERD normalization principle, S3–S12 standardization

- Status: Accepted (2026-10-17)
- Date: 2026-10-17
- Decider: human decider (chat 2026-10-17, four directives across the session: (1) the S2-derived entry market (target segment) is the basis for EVERY analysis and evaluation from S3 onward; (2) ERD normalization is an S1–S12-wide principle — this execution covers S2 plus a registered roadmap; (3) S2's region classification is S2-local analysis on S1 data and the S1 structure is frozen, no reverse reflection; (4) reference FX rates are multi-currency (USD, EUR, …), not USD-only; plus "환율은 개산되어야 하고 기준 환율을 설정하는 기능이 있어야 하며 변동폭은 몬테카를로에서 환 리스크로 다뤄져야 한다" and "재무·수치 데이터는 DB 저장 + ERD/FK 정합성"). The execution plan was audited by a three-perspective review board (data architecture, quant methodology/valuation, process governance/red-team) whose P0 findings are folded into the decision. Drafted by platform-lead.
- Design-of-record: [docs/designs/2026-10-17-entry-market-subject-market-design.md](../designs/2026-10-17-entry-market-subject-market-design.md)
- Related: ADR-0179 (+ amendment — see Supersedes), ADR-0180 (supersedes its slice-7 `bc.fx_rate`), ADR-0074 (flow.spec SSOT), non-negotiables #2 (human decisions), #4 (data confidence caps the RAG grade)

## Supersedes (explicit, review-board P0)

1. **ADR-0179 amendment §B.5** (per-step exact/partial/none scope grading from step reach-tags): replaced by a record-level verdict comparing the person's region/segment selection against the anchor's declared scope (`compareAnchorScope`). The person-facing step-tag inputs are removed; §B.3 (ratio factors, mandatory per-step source) and §B.9 (human-only writes, AI proposes in text only) are unchanged; the §B.6 region-source caveat remains rendered beside the chain; per-step confidence lowering stays (count = steps).
2. **ADR-0179 slice B / migration 0150 storage decision** ("lineage in a payload, no separate table; the derived value is always COMPUTED, never stored"): the DERIVED VALUE is still always computed and never stored, but the person-set inputs (chain steps, scope, FX, growth) now live in FK-based tables per the ERD principle. Legacy JSON columns are backfilled and frozen read-only fallbacks.
3. **ADR-0180 slice 7** (`bc.fx_rate` project-level assumption): removed. Reference rates move to the opportunity-level multi-currency `entry_market_fx` table. Stored `bc.fx_rate` rows migrate via the 0151 backfill where an entry-market record exists; unresolvable rows are inert (no longer read). This is a NON-ADDITIVE change: the next generation of an FX-relevant project can change numbers (ADR-0180 precedent wording applies).

## Decision

1. **Subject-market principle.** The S2-confirmed entry market (regions, segments, derived size, growth, FX) is the basis for all analysis and evaluation from S3 through S12. Unset states fall back to legacy behavior with an honest `진입시장 미확정` display; nothing new blocks a gate (boundary #2/#4 unchanged).
2. **ERD normalization principle (S1–S12).** Numeric/financial data is stored in FK-based tables. This execution normalizes the S2 entry-market data (migration 0151: `opportunity_target_scope` + `entry_market` + `entry_market_fx` + `entry_market_step` + `entry_market_competitive`, backfilled from the JSON columns and frozen `bc.fx_rate` rows); the S3–S12 numeric-JSON inventory (12 columns) and prioritized migration roadmap are registered in the design §8 for follow-up executions. S1 is FROZEN by decider directive — read-only via `lib/sizing-payload.ts`, no reverse reflection, no S1 structure changes.
3. **Integrated S2 flow.** The person picks regions/segments from the LINKED S1 MATRIX (weights shown; enum fallback), enters market_brief, requests the AI draft (two ratio factors + a growth proposal sourced from the matrix `cagrBase[region][segment]`), and confirms through the existing human-only PUT. Per-step annotation inputs are removed; step note/origin columns survive server-side for hash provenance.
4. **Multi-currency FX.** Per-currency reference rate + volatility on `entry_market_fx`; the anchor currency derives from the S1 unit declaration and is person-confirmable. Only USD carries a documented default (1400, `검증 전`); unset non-USD currencies mean NO conversion with a visible warning — never a silent pass-through.
5. **Monte Carlo FX as an index.** The S8 simulation gains a per-iteration constant FX index driver `triangular(1−vol, 1.0, 1+vol)` multiplying revenue (`revenue_t = revenue_y1 × Π(1+g) × fx_index`), only when the case is FX-relevant (anchor currency with a known rate). TS-fallback streams stay bit-identical when the driver is absent. Growth remains anchor-currency-observed (`fx_basis=index-no-drift`).
6. **S3–S12 standardization.** S4 route-advisory growth signal and both S8 growth interpretation points switch to the entry-market growth (ratio storage; threshold seam converts units; legacy fallback when unset); AI prompts across S3/S5/S6-S7/S8 receive guarded context blocks (`참고 데이터 (FACT)` label, no-fabrication rule, evidence-not-instruction); stage surfaces show subject-market headers; flow.spec v2.9.1 records the principle (declarative inputs only; S2 completion criterion stays minimal; S1 definition untouched).

## Consequences

- The entry-market record becomes the single market reference downstream; S1 stays untouched and versioned as before.
- Stored `bc.fx_rate` assumptions stop being read; FX now lives per opportunity — the next generation of FX-relevant projects may change numbers (documented, non-additive).
- The per-step scope grading surface disappears; the record-level verdict and the anchor-scope flag converge (deduplicated display).
- A registered roadmap (12 JSON columns) now governs follow-up normalizations; this ADR is their precedence anchor.

## Acceptance record

- Approver: the human decider (user, account techcross), chat 2026-10-17: approved the review-revised execution plan (the fourth draft, folded with the review board's P0/P1 findings) after directing the four clarifications quoted above and requesting the review meeting itself. Basis: chat approval of the plan as presented; this record does not claim an item-by-item reading of the written ADR.
- Implementation status (2026-10-17): IMPLEMENTED in code — slices 1–5 as specified; see CHANGELOG for the per-slice summary and the test ledger. Not browser-verified.

## Honest limits

Unset non-USD currencies intentionally disable 개산 and the FX risk variable until a person sets the rate. The growth-rate swap changes downstream numbers only for opportunities with a confirmed entry market (unset = legacy bit-identity, run-note provenance). The FX ±10 % default volatility is precedent-consistent, not a validated market band. The conditional JSON freeze (NULL-link chains readable via fallback) remains until those rows are resolved.
