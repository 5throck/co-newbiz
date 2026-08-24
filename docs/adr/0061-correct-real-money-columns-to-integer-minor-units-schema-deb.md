# ADR-0061: Correct REAL money columns to integer minor units (schema debt F-3)

**Status**: Accepted — EXECUTED 2026-08-24 (migration 0028; scale convention and two scope corrections recorded below)
**Date**: 2026-08-24
**Deciders**: user (scale convention: **KRW millions**, async 2026-08-24); data-architect (migration design); process-governance-manager (governance)

## Context

ADR-0002's portability regime mandates "no floating-point for money" — monetary
quantities are stored as integer minor units. The convention was applied
consistently from migration `0008_accounts_and_pii.sql` onward (comp_benchmark,
management_package), but migrations `0005_simulation_and_liabilities.sql` and
`0011_dd_finding_and_remaining_tables.sql` — written earlier in Stage 5 and
landed before the convention hardened — store ~25 monetary-quantity columns as
`REAL`. This was recorded as schema debt "F-3" in the 2026-08-22 RAG
formalization design review, with boundary mitigations noted in
`docs/decisions/risk-thresholds.md`, but no corrective migration exists. Newer
tables following the rule while legacy ones do not makes the schema internally
inconsistent on its own most load-bearing convention.

The debt is not hypothetical: these columns feed the Monte Carlo engine
(`python/monte_carlo.py` via `db/lib/simulation.ts`), the covenant-breach kill
criterion, and the incentive-NPV site comparison — exactly the Class A
financial calculations where IEEE-754 accumulation error is unacceptable.

Affected tables and their MONEY-quantity columns (rates, ratios, scores, and
statistical measures are deliberately excluded — floating point is correct for
them):

| Table | Money columns (REAL today) |
|---|---|
| `contingent_liability` | `amount_low`, `amount_expected`, `amount_high` |
| `simulation_result` | `p05`, `p50`, `p95`, `mean`, `std` (NPV quantiles — currency quantities) |
| `simulation_draw` | `value` |
| `dd_finding` | `value_impact` |
| `antitrust_finding` | (none — HHI is an index) |
| `benefit_item` | `value_impact` |
| `debt_instrument` | `principal` |
| `covenant_test` | `threshold`, `projected_value` |
| `incentive` | `amount`, `npv_value`, `estimated_clawback` |
| `site_candidate` | `infra_capex`, `incentive_npv`, `logistics_cost` |
| `partner_candidate` | (scores only — out of scope) |

Explicitly OUT of scope (stay REAL by design): `probability`, `discount_rate`,
`rate` (interest), `elasticity`, `correlation`, `r2`, `pass_through_rate`,
`concentration_hhi`, `hhi_before/after`, `per_capita_delta`,
`harmonization_cost`(ratio basis TBD at implementation), all `*_score`
columns, `fact_financial.value` / `fact_industry.value` (observation values are
unit-aware via `md_unit`, a separate normalization concern).

## Decision

Migrate every listed money column from REAL to INTEGER **in units of KRW millions** (user convention, 2026-08-24: "KRW 백만원 기준" — a stored 20,000 reads as 200억). FX-exposed amounts convert via fx_policy upstream before storage. Use the migration-0019 table-rebuild pattern (create-with-CHECKs → INSERT..SELECT with explicit scale conversion `CAST(ROUND(old * 1e6) AS INTEGER)`, legacy REAL interpreted as raw won → DROP → RENAME → indexes verbatim, inside the runner transaction with `PRAGMA foreign_keys=ON`), and update the unit boundaries (snapshot filler, simulation engine composition) in the same release window.

**Scale decision (recorded per this ADR's own requirement)**: single house unit — KRW millions — for every converted column regardless of deal currency; FX normalization happens at intake.

**Execution scope corrections (2026-08-24, recorded honestly vs the draft table above)**:

1. **covenant_test.threshold/projected_value EXCLUDED**: they are DSCR-style RATIOS (fixtures and pilot usage compare 1.25 vs 1.0), not money. The draft table had mislisted them.
2. **simulation_result/simulation_draw EXCLUDED**: engine outputs keep ENGINE-NATIVE units (REAL) — design §12's seeded-reproduction contract pins exact quantiles against the CLI path, and rounding to millions would break byte-parity for small-NPV scenarios. Only contingent INPUT amounts are unit-boundary-scaled.
3. **benefit_item correction**: its 0011 DDL has no value_impact column; nothing to convert (target/acquirer/per_capita/harmonization stay REAL per the exclusions below).
4. contingent_liability.value_impact ADDED to the converted set (it is money; the draft table had missed it).

## Execution record

- Migration `db/migrations/0028_money_columns_integer_krw_millions.sql`, tagged `@reversible: false` (ROUND loses sub-million precision; backup-restore is the only reverse).
- Converted: contingent_liability amount_low/expected/high + value_impact · dd_finding.value_impact · debt_instrument.principal · incentive amount/npv_value/estimated_clawback · site_candidate infra_capex/incentive_npv/logistics_cost. dd_finding rebuild carries 0019's trl_grade/ip_ownership_status enum CHECKs forward verbatim.
- Unit boundaries: snapshot-filler contingent family ×1e6 (storage M → raw-won vars; pinned gd-0022 rule constants untouched); db/lib/simulation.ts composes engine scenarios ×1e6 and persists quantiles verbatim.
- API writers (POST dd-findings value_impact) now take KRW-millions integers — documented at the route; UI formatting follows the same unit.

## Consequences

- **Easier**: financial aggregation becomes exact; the ADR-0002 portability
  claim holds schema-wide instead of partially; `db:export --dialect postgres`
  emits INTEGER→BIGINT money that Postgres arithmetic keeps exact; the Monte
  Carlo tail statistics stop accumulating binary-fraction error.
- **Harder**: one irreversible-in-effect data migration (backup-first per
  ADR-0014; tagged `@reversible: true` only if a down-scale restore path is
  rehearsed); every producer/consumer of these columns must convert at the
  boundary in the same release window (F-14's same-window rule).
- **Requires**: python/monte_carlo.py input contract update + seeded-output
  parity re-verification (identical seed may legitimately change once scales
  change — the run-versioning note must say so explicitly); simulation.ts
  composition; venture-scorecard rollup reads; UI number formatting via the
  currency-aware renderer; `docs/db-schema.md` rows corrected in the same PR;
  checklist items bf-08/bf-09 unaffected semantically but their evidence
  snapshots change shape — a `project_policy_pin` retroactivity check per
  ADR-0021 before shipping.
- **Kill-criteria interaction**: none of the six validators read these columns
  through predicates today except covenant breach counts (integer already);
  the evaluator's snapshot vars reading `contingent_expected_value` must be
  rescaled in the same change to avoid a silent threshold shift.
