# ADR-0164 — venture_scorecard's unique key gains review_cycle (repeat quarters share one run)

- Status: Proposed
- Decider: Human reviewer (pending)
- Date: 2026-10-12
- Design-of-record: none (fixes a known S12 operational limitation of ADR-0059 §2's storage, not a change to the design)
- Related: ADR-0059 (venture_scorecard storage, migration 0024), ADR-0071 / migration 0033 (PK NOT NULL rebuild of the same table), ADR-0061 (money units — unchanged; scorecard values remain TEXT measures, no currency columns touched), ADR-0163 (per-statement migration execution makes this rebuild's row-count assert load-bearing), ADR-0005 (run lineage)

## Context

`venture_scorecard` (migration 0024) keyed rows `UNIQUE (run_id, source_procedure, section, measure_key)` — `review_cycle` was not part of the key, so one run could hold exactly one quarter of each measure. The greenfield S12 cycle route (`recordGreenfieldScorecardFromRequest`) compensated by hunting for a run whose measures were all still free and refusing with `run_required` otherwise: recording the next quarter of the same measures forced a new analysis run first. That is the documented S12 limitation "repeat quarters need a new analysis run". A run is a reproducible lineage snapshot (ADR-0005), not a one-cycle bucket; the portfolio-venture-monitoring cadence is per `review_cycle`, and the repository already treats the cycle as the immutable unit (`one record per project+procedure+cycle`).

## Decision

1. Migration 0139 rebuilds `venture_scorecard` (0033/0132/0137 pattern: create `_new`, copy verbatim, row-count assert, drop, rename, recreate indexes) widening the key to `UNIQUE (run_id, source_procedure, review_cycle, section, measure_key)`. Every column, CHECK, FK and index matches the live schema (0024's body as rebuilt by 0033 — `id TEXT PRIMARY KEY NOT NULL`); only the UNIQUE line changes. Header carries `@reversible: true` with tested rollback SQL that rebuilds the 0024 key and refuses (CHECK-guarded assert, aborting under ADR-0163 stop-on-error semantics) while any `(run_id, source_procedure, section, measure_key)` group holds rows from more than one `review_cycle` — such rows are human-recorded monitoring history and are never deleted to make a rollback pass.
2. Dedup semantics: none required and none defined — collisions under the new key are IMPOSSIBLE, not merely absent, because 0024's key is a strict subset of the new key (any colliding pair would already have violated the old UNIQUE). If a hand-corrupted source ever carried one, the rebuild's own new UNIQUE aborts the migration's `INSERT ... SELECT` inside its transaction (fail-closed); recovery is human review against the pre-migration backup (ADR-0014).
3. `cycle_exists` semantics (documented choice): stays scoped to `(project_id, source_procedure, review_cycle)` — as in the repository guard since ADR-0059 — with the run chosen as the project's latest active run (`superseded_by IS NULL`, newest `created_at`). The next quarter now lands on that SAME run instead of requiring a new one. Brownfield/JV writers keep byte-identical behavior: `recordVentureScorecardCycle`'s guards, audit and data_access writes are unchanged (the widened key only relaxes what the schema admits, and the repository's own prior-cycle guard still runs first).
4. `run_required` shrinks to its genuinely-impossible case only — the project has no analysis run at all (rows are run-scoped by FK). The "same measures already on the latest run" refusal is removed, and the route docs (openapi 409 description, api-spec.md) plus the Korean UI error text are updated to match.

## Consequences

- A greenfield venture's full quarterly history can accumulate on one run; `greenfieldRampUpView` and `effectiveVentureClass` already resolve the latest cycle by `MAX(review_cycle)` / `ORDER BY review_cycle DESC`, so latest-value reads stay correct with multi-cycle runs — now proven by test.
- The per-project row count grows ~4x over a year of quarterly cycles; both existing indexes lead with `project_id` / `review_cycle` so the rollup and latest-cycle reads stay index-covered patterns.
- 0024 is not edited (applied migrations are immutable); the migration chain applies 0139 after it on every fresh database.

## Verification

- `bun test tests/unit/migration-0139.test.ts` — rebuild preserves rows/columns/FKs/indexes verbatim; same-run next-quarter inserts, same-cycle duplicates still rejected; header rollback reverses and re-applies; rollback guard aborts on multi-cycle groups.
- `tests/unit/venture-scorecard.test.ts` — two consecutive quarters on one run both store; the cycle guard stays per (project, procedure, cycle); ramp-up and effective-class reads resolve the latest cycle.
- `tests/unit/greenfield-scorecard-route.test.ts` — the former `run_required` path (next quarter, same run) is now a 201 success; `run_required` remains only for the no-run case. Brownfield/JV suites (`venture-scorecard`, `portfolio`, `scorecard-rollup`) pass unchanged.
