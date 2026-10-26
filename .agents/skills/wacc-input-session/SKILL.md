---
name: wacc-input-session
scope: co-newbiz
description: >
  Confirms WACC and hurdle IRR as `kind='user'` (explicitly confirmed, not
  `kind='assumed'`) before any FS gate opens — `checklists/brownfield-feasibility-checklist.yaml`
  bf-02's mandatory item. Supports direct-input and CAPM-component modes
  (ADR-0115): market rates and beta are cited from an authoritative external
  source (AlphaSpread, ValueInvesting.io, Bank of Korea ECOS, Damodaran) with
  source name / URL / as-of date; when no accepted market figure exists, the
  CAPM build-up (cost of equity) plus credit-rating-based cost of debt
  produces the WACC, and beta carries a volatility estimate relative to the
  market. Every session persists the full derivation — formulas and
  substituted numbers — under `wacc.*` assumption keys.

  Use when: "WACC input", "hurdle IRR confirmation", "CAPM components",
  "discount rate session", "beta estimation".
version: 1.3.2
last_reviewed: 2026-10-27
status: active
owner: valuation-agent
prerequisites: none
metadata:
  type: process
  triggers:
    - WACC input
    - hurdle IRR confirmation
    - CAPM components
    - discount rate session
    - beta estimation

  procedure_keys:
    - brownfield-pre-fs
    - greenfield-pre-fs
relates_to:
  - skill: brownfield-feasibility
    type: follows
  - skill: site-infrastructure-assessment
    type: follows
  - skill: debt-and-contingent-liability-simulation
    type: composes_with
  - skill: financing-plan-review
    type: composes_with
  - skill: investment-feasibility-modeling
    type: composes_with

---

## Context

A load-bearing financial input riding on an unconfirmed assumption into the
FS gate is exactly the failure `checklists/brownfield-feasibility-checklist.yaml`'s
bf-02 exists to catch — WACC and hurdle IRR must be `kind='user'`, not
`kind='assumed'`, before FS opens. Two input modes are supported:

- **Direct entry** of a final WACC figure, or
- **CAPM decomposition** (ADR-0115): the session records the CAPM components
  each with its own provenance — market rates cited from an authoritative
  external publication, beta either cited (peer group) or derived (time-series
  regression with R² and annualized volatility vs the market), cost of debt
  from the company's credit rating plus spread or from the actual loan rate —
  and the final WACC build-up (formulas and substituted numbers) is
  re-derivable from the stored rows. The glossary's `WACC` entry documents
  this convention so downstream output shows which value came from which tier.

## When to Use

- Before opening the FS gate on any Brown Field or Green Field project
- Re-confirming WACC when a material market-rate shift makes the existing figure stale

## Execution Steps

1. **Choose the input mode with the user explicitly** — direct WACC entry,
   or CAPM-component decomposition
2. **For CAPM mode, source each component at the highest tier available**:
   market rates (risk-free, ERP) and beta from a recognized external source
   (AlphaSpread, ValueInvesting.io, Bank of Korea ECOS, Damodaran) recorded as
   `kind='live'` with source name, URL (`https://…` anchor_ref), and as-of
   date; judgment values (size premium, target D/E, tax rate) as `kind='user'`
3. **Estimate beta by the best available path**: (a) peer group — cited
   levered betas plus each peer's D/E, Hamada-unlevered, median taken; or
   (b) time-series regression — paste `date, price, index` closes, OLS gives
   β, R², and annualized volatility of asset vs market (persisted as
   `wacc.beta_*` stats). Relever βU to the target capital structure (Hamada)
   before it enters CAPM
4. **Derive cost of debt**: the actual loan rate when known, otherwise
   risk-free plus the credit-rating spread — cite the rating agency source
5. **Record every component's `kind`** — `live` (cited), `derived` (computed),
   `user` (judgment); the final WACC is always `kind='user'` because a human
   explicitly confirmed it. The web page pre-fills the confirmed value with
   the CAPM-computed figure; a divergence from the computed value is flagged
   and its reason must go in the rationale
6. **Confirm the hurdle IRR** the same way — `kind='user'`, never carried
   forward from a prior project's figure without explicit reconfirmation
7. **Show the calculation process in the deliverable** — every S5/S8
   valuation output carries the derivation table (item | formula | substitution | result)
   and the component/source table. Generate it with
   `bun scripts/co-newbiz/newbiz.ts wacc:derivation --project <id>` so the
   markdown matches the persisted rows — never hand-retype the numbers
8. **Block the FS gate** if either figure is still `kind='assumed'` —
   `compliance-monitoring`'s gate check reads this directly

Brownfield multi-target note (ADR-0143): when a brownfield S8 compares
shortlisted targets, confirm the WACC inputs per analysis subject — a target
with a materially different capital structure needs its own `wacc` /
`wacc.target_de` session so the cross-target comparison ranks like against
like.

## Snapshot Integration (ADR-0064 + ADR-0115 — how the session feeds kill criteria #5/#6)

The session's output must land in the run's assumption registry under the
EXACT keys `wacc` and `hurdle_irr` — these two key names are the contract
`db/lib/snapshot-filler.ts`'s `fin.wacc_source_status` var reads:

- Preferred project session: `POST /api/projects/{id}/wacc` (or the WACC
  page) with `wacc`, optional `hurdle_irr`, `mode` (`direct` | `capm`),
  `rationale`, `as_of`, and — for CAPM mode — the `components` array.
  The API creates a new versioned run snapshot, writes `kind='user'`
  assumption rows for the exact keys, and persists each component as an
  assumption row under the `wacc.<name>` namespace on the same run
  (`wacc.risk_free`, `wacc.erp`, `wacc.beta_levered`/`wacc.beta_unlevered`,
  `wacc.observed_de`, `wacc.target_de`, `wacc.tax_rate`,
  `wacc.cost_of_debt`/`wacc.debt_spread`, `wacc.size_premium`, plus
  `wacc.beta_r2` / `wacc.beta_vol_asset` / `wacc.beta_vol_market` /
  `wacc.beta_alpha` regression stats). Components never write
  `kind='assumed'` — a CAPM session exists to replace assumptions.
- The `wacc.*` namespace never collides with the exact-key contract: the
  filler matches only `wacc` and `hurdle_irr`, verbatim.
- The var's semantics: ANY `kind='assumed'` row among the two keys ⇒ status
  `'assumed'`; both keys present and none assumed ⇒ `'sourced'`; neither key
  recorded for the run ⇒ `missing` (the criterion evaluates UNASSESSED, never
  a silent pass).
- Armed consequence: kill-criteria #5/#6 (`wacc_hurdle_still_assumed`,
  ADR-0064) HALT when the status is `'assumed'` at FS. Running this skill to
  completion — both figures `kind='user'` — is what disarms them.
- Key-name discipline: do not invent variants (`WACC`, `discount_rate`);
  the filler matches exactly `wacc` and `hurdle_irr`. Component keys follow
  the `wacc.<name>` namespace — do not invent third segments.
- CLI fallbacks: `bun scripts/co-newbiz/newbiz.ts assume --run <run_id>
  --key wacc --kind user --value <rate> ...` (and again with `--key
  hurdle_irr`); read the derivation back with `bun scripts/co-newbiz/newbiz.ts
  wacc:derivation --project <id>`.

## Gate-Integrity Link (ADR-0186, neb-policy 2.2)

A confirmed session is what completes S8 and lifts the FS GO block: the WACC subject (target for Brown Field unless a bf-13 waiver records the acquirer-based fallback; the investing entity for Green Field) plus `wacc` and `hurdle_irr` as `kind=user`. Until then outputs that use the discount rate are labelled provisional. The session is prepared by the quant-methodologist and confirmed by a person; the skill never confirms on a person's behalf.

## Output Format

- Confirmed WACC (with mode and component provenance) and hurdle IRR, both `kind='user'`
- For CAPM mode: the full `wacc.*` component rows plus the derivation table
  (formulas with substituted numbers) in the deliverable markdown — see
  `wacc:derivation`, the WACC page, or `GET /api/projects/{id}/wacc`
  (`derivation.steps`)

## Related Skills

- `investment-feasibility-modeling` — the model this discount rate feeds
- `compliance-monitoring` — the gate check enforcing this confirmation
