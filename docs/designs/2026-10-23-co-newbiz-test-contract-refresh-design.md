# Design: co-newbiz test-contract refresh (bun ≥ 1.4 driver behavior + 0013 schema extension)

- **Spec ID**: `2026-10-23-co-newbiz-test-contract-refresh`
- **Date**: 2026-10-23
- **Status**: implemented
- **Tier**: L3 (Projects/co-newbiz)

## 1. Problem

`bun run test` failed with 4 test files broken. Root causes, none product defects:

1. **`library.generated.ts` stale projection** — the co-design commission batch
   (2026-10-22) updated `des-design-guide` / `des-design-screens` sources after
   the last generation; the projection-sync test flagged both as drifted.
2. **bun ≥ 1.4 removed the multi-statement silent no-op quirk** — three test
   files pinned the bun 1.3.14 behavior where `db.run()` over a whole migration
   SQL file silently skipped violating statements (`changes: 0`):
   - `migration-0014.test.ts`: raw whole-file re-exec was asserted to no-op; it
     now raises `UNIQUE constraint failed` on the fixed `var_key` PK.
   - `migration-runner.test.ts` (3 sites): "OLD runner" characterization tests
     asserted the legacy multi-statement run does NOT throw (documenting the
     silent-skip defect that motivated the statement-split runner). The driver
     now raises loudly at the violating statement, so the legacy shape is no
     longer silent.
3. **`migration-0013.test.ts` survival contract outdated** — migration 0013
   legitimately extends every `compliance_check` row with two nullable
   invalidation columns (`invalidated_at`, `invalidated_by_classification`);
   the "seeded pre-0013 row survives byte-identical" test compared the full
   post-migration row against the pre-migration shape. The three later failures
   in that file were a cascade (the first failure closed the shared DB).

## 2. Decision

1. **Regenerate the projection** via `scripts/co-newbiz/sync-library-projection.ts`
   (the test's own prescribed remedy) and commit the refreshed
   `library.generated.ts`.
2. **Driver-behavior-agnostic contracts**:
   - `migration-0014`: the raw whole-file re-exec must throw `UNIQUE constraint
     failed` (the PK guard bites loudly); the invariant "seed set unchanged
     after re-exec" is asserted after the throw.
   - `migration-runner`: the three legacy-characterization sites now pin current
     reality — both the raw multi-statement run AND the statement-split runner
     raise at the violating statement, with nothing applied after it. Comments
     keep the 1.3.14 historical context.
3. **0013 survival test**: compare the pre-0013 column set byte-identically
     (destructure the two new columns away) and separately assert both new
     columns are NULL on the seeded legacy row.

## 3. Alternatives rejected

- **Pinning bun to 1.3.x** to restore the quirk the tests relied on: hides a
  driver improvement and fights the toolchain.
- **Deleting the legacy-runner characterization tests**: their historical
  context (why splitSqlStatements exists) stays valuable; they now document
  that the driver and the runner converge on the same loud-failure guarantee.
- **Relaxing the 0013 survival assertion to a partial match**: the pre-0013
  column set still gets a byte-identical check; only the two new nullable
  columns are compared separately (NULL).

## 4. Validation

- `bun test tests/unit/migration-0013.test.ts tests/unit/migration-0014.test.ts`
  — 42 pass / 0 fail.
- `bun test tests/unit/migration-runner.test.ts` — 11 pass / 0 fail.
- `bun test tests/unit/library-projection-sync.test.ts` — 2 pass / 0 fail.
- `bun run test` — full unit suite green (326 files).
