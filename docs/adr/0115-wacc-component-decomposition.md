# ADR-0115: WACC component decomposition — persist the CAPM build-up, not just the confirmed scalar

- Status: Accepted
- Date: 2026-09-10
- Deciders: New Business Review Lead (PM)
- Deciders note: the review lead judged that a bare WACC scalar cannot support the three-stage review — reviewers must see how the discount rate was derived, and cited market-accepted figures (AlphaSpread / ValueInvesting.io / Bank of Korea ECOS / Damodaran) should be usable where they exist. This ADR implements the CAPM-component scope the 2026-09-09 engine-seams design explicitly deferred.
- Related: ADR-0064 (WACC session → kill-criteria #5/#6 handoff contract), ADR-0058 §2 (evidence-ref vocabulary), ADR-0074 (flow spec — S8 activity unchanged), docs/designs/2026-09-09-engine-seams-wacc-hwp-design.md ("Out of scope: CAPM component UI, external market-rate fetching")

## Context

The WACC input session (ADR-0064) persisted exactly two numbers per session —
the confirmed `wacc` and optional `hurdle_irr` — and the CAPM "dual-mode"
convention (risk-free = live, ERP / target D/E = user, beta = derived) existed
only as prose in the skill and glossary. The actual CAPM math was done by hand
in deliverable markdown: the S5 valuation sample shows βu carried as
`assumed` because no price series was available for regression, and the risk-free
basis flagged "unverified". Reviewers could not see — and the registry could
not reproduce — how the confirmed 13.2% had been assembled. Two market gaps
drove the design: no stock-price or interest-rate pipeline exists (the DART
adapter is catalog + financial statements only), and no external market-data
API (AlphaSpread et al.) offers a programmatic feed we could integrate.

## Decision

1. **Components are data, derivations are computed.** Each CAPM component is
   persisted as its own assumption row under the `wacc.<name>` namespace
   (`wacc.risk_free`, `wacc.erp`, `wacc.size_premium`, `wacc.beta_levered`,
   `wacc.beta_unlevered`, `wacc.observed_de`, `wacc.target_de`,
   `wacc.tax_rate`, `wacc.cost_of_debt`, `wacc.debt_spread`, plus regression
   stats `wacc.beta_r2` / `wacc.beta_alpha` / `wacc.beta_vol_asset` /
   `wacc.beta_vol_market`) on the SAME run as the confirmed scalar. The
   build-up is never stored as prose: `db/lib/wacc-components.ts`
   `assembleDerivation()` re-derives the steps — formulas and substituted
   numbers — from the rows on read, so screen, deliverable markdown, and
   database cannot drift. The namespace never collides with the
   `snapshot-filler.ts` exact-key contract (`wacc`, `hurdle_irr`), which this
   ADR leaves byte-identical.
2. **Citation replaces fetching.** With no programmatic feed, market values
   are entered from an authoritative publication and recorded at the highest
   evidentiary tier available: `kind='live'` with `source_label`,
   `anchor_ref` (ADR-0058 `https://` shape), and `as_of`; judgment values
   (size premium, target D/E, tax) are `kind='user'`; computed values are
   `kind='derived'`. Components never write `kind='assumed'` — the session's
   purpose is to replace assumptions. The source-adapter seam stays the
   future path for live fetching; nothing in this design blocks it.
3. **Beta carries its volatility evidence.** Two paths, both persisted:
   peer-cited levered betas Hamada-unlevered to a median βU (peer values in
   the rationale), or an OLS regression over a pasted `date, price, index`
   series (`db/lib/beta-regression.ts`, pure TS, no new dependencies) that
   reports β, R², and annualized volatility of asset vs market (√252) — the
   "how volatile relative to the market" answer the review lead asked for —
   persisted as `wacc.beta_*` stats. βU is relevered to the target capital
   structure (Hamada) before entering CAPM; intermediates keep full precision
   (display rounds, math never does).
4. **Cost of debt follows the company's credit.** Either the actual loan rate
   (`wacc.cost_of_debt`) or risk-free plus a credit-rating spread
   (`wacc.debt_spread`, rating named in the citation) — WACC then blends
   We·Ke + Wd·Kd·(1−t) from target-structure weights.
5. **The human still confirms.** `mode='capm'` POSTs validate the component
   set (`capmComponentGaps`), server-recompute the WACC, and return it as
   `wacc_computed`; the confirmed scalar may diverge (IC guidance, rounding
   policy) but the divergence is flagged (`computed_mismatch`) and its reason
   belongs in the rationale. The WACC page renders the derivation table
   (item | formula | substitution | result), the CAPM build-up and WACC-blend waterfalls,
   per-figure provenance (SourceTooltip), and a components/sources ledger —
   per the approved mockup
   `docs/designs/mockups/2026-09-10-wacc-capm-ui-mockup_ko.html`.
   `wacc:derivation --project <id>` emits the same tables as markdown for
   S5/S8 deliverables.

## Consequences

- Every confirmed WACC now ships with a reproducible "how" — reviewers see
  the calculation process without leaving the registry, and the FS kill
  criteria contract is unchanged.
- Cited values are only as good as the human's citation: the design relies on
  the rationale/anchor_ref audit trail, not on programmatic source
  verification. Live fetching (BOK ECOS rates, KRX prices) remains deferred
  work behind the existing source-adapter seam.
- The regression consumes pasted series, so beta reproducibility covers the
  stats (β, R², vols) but not the raw series — a future migration could
  persist series snapshots if reviewers demand them.
- `db/lib/wacc-components.ts` and `db/lib/beta-regression.ts` are pure TS by
  design: the web page imports them client-side so the rendered derivation IS
  the persisted derivation.

## Verification

- `tests/unit/wacc-components.test.ts` — Hamada/CAPM/blend math, validation,
  gap listing; `tests/unit/beta-regression.test.ts` — OLS recovery, vol
  annualization, parser, peer median.
- `tests/unit/wacc-session.test.ts` — capm-mode POST persists `wacc.*` rows
  on the confirmed run, GET re-derives the build-up, mismatch flagging, and
  the direct-mode/namespace non-interference.
