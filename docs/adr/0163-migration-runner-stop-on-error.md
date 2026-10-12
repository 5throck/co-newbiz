# ADR-0163 — Migration runner executes statements one-by-one with stop-on-error semantics

- Status: Accepted
- Date: 2026-10-12
- Related: ADR-0002 (portability), ADR-0014 (pre-migration backup), ADR-0071 (`@notransaction`), ADR-0157 (0132 context)

## Context

`db/migrate.ts` executed each migration file as one multi-statement `db.run(sql)`. bun:sqlite's multi-statement `Database.run()` goes through `sqlite3_exec`, which does not surface an error raised by a non-final statement. A constraint failure in any statement except the last was silently ignored and later statements still applied. Consequence: the CHECK-guarded safety assertions embedded in migration 0132 (`_dd_rebuild_assert`) and 0137 (`_pcic_rebuild_assert`) — documented in those files' headers as aborting the migration on row-count/rollback-precondition mismatch — could never abort. They passed vacuously; a genuinely broken rebuild precondition would have applied anyway.

This is a defect in the migration RUNNER, not in any schema or migration file (ADR trigger baseline: no schema change here).

## Decision

1. `db/migrate.ts` gains `splitSqlStatements(sql)` (exported): a small tokenizer that splits a SQL script into individual statements, aware of `--` line and `/* */` block comments (copied verbatim so stored `sqlite_master.sql` DDL text stays byte-identical to what the old runner persisted), single-quoted strings with `''` escaping, double-quoted / `[bracket]` / backtick identifiers, and trigger bodies (after `CREATE [TEMP] TRIGGER ... BEGIN`, `;` does not end the statement until the matching `END`; nested `BEGIN` and paired `CASE ... END` are counted so they do not close the trigger early).
2. Both the transactional and `@notransaction` paths execute the migration statement-by-statement (`runScript`). The first failing statement throws, so a wrapped migration rolls back entirely via the existing `db.transaction`, and a `@notransaction` migration stops at the failure (its documented partial-failure recovery path, pre-migration backup restore per ADR-0014, is unchanged).
3. Everything else is preserved: `-- @notransaction` opt-out, `schema_migrations` bookkeeping and idempotence, the `runMigrations(dbPath)` / `getMigrationStatus(dbPath)` signatures and CLI interface.

## Consequences

- Safety assertions inside migration SQL are now load-bearing, as their headers always claimed. Tests in `tests/unit/migration-runner.test.ts` prove both directions: tampering the `ok = 1` guard to `ok = 2` makes the OLD runner "succeed" silently while the NEW runner aborts; 0132/0137/0138 apply cleanly through the runner; a full legacy run and a full per-statement run over all 138 migrations produce byte-identical `sqlite_master` dumps (530 objects, 6 triggers).
- Newly written migrations may rely on CHECK-guarded assertions aborting; they should keep documenting this in their headers as 0132/0137 do.
- The splitter is deliberately minimal (SQLite-dialect only, per ADR-0002 pure-SQL migrations); a migration using syntax it does not model (e.g. `END`-less constructs outside trigger bodies) would surface as a migration-time syntax error, which is the safe failure direction.

## Verification

- `bun test tests/unit/migration-runner.test.ts` — 11 pass.
- Full `bun test ./tests/unit` and `bun scripts/audit.ts --spec-check --lifecycle-only` run in the same change (see PR description for results).
