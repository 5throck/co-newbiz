# ADR-0071: Primary-key NOT NULL rebuild (migration 0033)

**Status**: Accepted — executed and verified 2026-08-25
**Date**: 2026-08-25
**Deciders**: user (approved the rebuild approach after the alternative-costs review), platform-lead (schema)
**Design of record**: `docs/designs/2026-08-25-web-stack-migration-nextjs-prisma_ko.md` §7

## Context

Phase 1 of the ADR-0069/0070 web-stack migration (Next.js/Prisma scaffolding, `app/web-next/`) found that `bunx prisma db pull` against the live `db/data/co-newbiz.sqlite` introspected 61 of 96 tables (63.5%) as `@@ignore`, and `prisma generate` failed outright with 24 validation errors. Root cause: every affected table declares its primary key as `<col> TEXT PRIMARY KEY` without `NOT NULL`. Unlike `INTEGER PRIMARY KEY` (which aliases SQLite's rowid and is implicitly `NOT NULL`), a `TEXT PRIMARY KEY` carries no such guarantee — SQLite will accept a `NULL` in that column. Prisma introspects this accurately as `id String?`, and its client generator refuses a nullable `@id` field.

Three remediation paths were identified (design doc §7): (1) a rebuild migration adding `NOT NULL` to every affected column, (2) hand-patching the generated `schema.prisma` after every `db pull` (defeats the purpose of introspection as a trustworthy source), or (3) hand-authoring `schema.prisma` from scratch (loses the introspection safety net entirely). The user selected (1).

## Decision

Migration `0033_pk_not_null_rebuild.sql`, generated (not hand-authored) by `scripts/co-newbiz/gen-pk-notnull-rebuild.ts` from the live schema, rebuilds 85 of 96 tables — every one whose single inline `TEXT PRIMARY KEY` column lacked `NOT NULL` — via the codebase's established create-`_new`/`INSERT..SELECT`/`DROP`/`RENAME` pattern (migrations 0019/0028). The 11 tables with composite primary keys were left untouched; their constituent columns were already individually `NOT NULL` by survey, not by assumption.

Three problems, found only through sandbox testing against a copy of the live DB (never against the production file directly), required generator/runner changes beyond a naive per-table rewrite:

1. **Quoted identifiers**: 11 of 96 tables' original DDL is `CREATE TABLE "name" (...)` (quoted) rather than bare — a `\b`-based rename regex silently failed to match past the closing quote. Fixed with a lookahead on the following whitespace instead of a word-boundary assertion.
2. **Dependent view**: `v_comp_anonymized` selects from `comp_benchmark`. SQLite's `ALTER TABLE ... RENAME` re-validates dependent views as part of the rename and errors `no such table` in the brief window between the table's `DROP` and `RENAME`. Fixed by having the generator `DROP VIEW` before and `CREATE VIEW` (verbatim) after any table's rebuild block when a view depends on it.
3. **Live FK-referencing rows**: by the time this migration ran, the session already held real data (an `app_user` account, a `session`, an `api_token` — created earlier in the same working session to restore MCP connectivity). `DROP TABLE app_user` failed `FOREIGN KEY constraint failed` under `foreign_keys=ON`, because `api_token`/`session`/`password_history` rows genuinely reference it. Topological (parent-before-child) rebuild ordering reduces exposure but does not eliminate it — the actual fix needed `PRAGMA foreign_keys=OFF` for the migration's duration. That pragma is a documented no-op inside an open transaction, and `db/migrate.ts` unconditionally wraps every migration file in one. **`db/migrate.ts` gained a narrow escape hatch**: a migration file whose first line is exactly `-- @notransaction` is applied via a direct multi-statement run instead of `db.transaction(...)`, trading the all-or-nothing guarantee for that one file in exchange for pragma toggles actually taking effect. Migration 0033 uses this; it re-enables `foreign_keys` and runs `PRAGMA foreign_key_check` at its own end as compensating verification.

## Consequences

- **Verified, not assumed, safe**: sandbox-tested against a checkpointed copy of the live DB before touching production — zero `PRAGMA foreign_key_check` violations, every table's row count identical before/after, `PRAGMA integrity_check` returns `ok`, both `audit_log` triggers and the `v_comp_anonymized` view survive intact.
- **Prisma unblocked**: post-migration introspection shows `@@ignore` count 61 → 0 (96/96 usable), and `prisma generate` succeeds with zero errors (previously 24). This directly resolves the design doc §7 open question and un-blocks Phase 2 (route porting).
- **`db/migrate.ts`'s `-- @notransaction` escape hatch is now permanent, general-purpose infrastructure** — available to any future migration that needs a pragma toggle mid-file, not scoped to this one. Its cost (no all-or-nothing guarantee for an opted-out file) is real and should be used sparingly; migration 0033's own trailing `PRAGMA foreign_key_check` is the compensating control this ADR expects future users of the escape hatch to replicate.
- **migrations 0019/0028's `PRAGMA foreign_keys=ON` rebuild pattern is not actually reliable at scale** — it worked for their 5-table (0019) and smaller (0028) rebuilds only because those tables had no live FK-referencing rows at the time (prototype/empty data, per 0028's own comment). This ADR's finding — that FK-referenced parent rebuilds fail once real child rows exist — should be treated as a correction to that earlier claim, not a contradiction specific to this migration.
- Executed against production (`db/data/co-newbiz.sqlite`) 2026-08-25 via `bun run db:migrate`; API server and MCP connectivity confirmed healthy immediately after (`list_projects` round-trip succeeded).

## Cross-references

Design doc §7 (above) · ADR-0014 (backup/rollback discipline — the recovery path if a future `-- @notransaction` migration fails partway) · ADR-0019/0028 (the rebuild pattern this migration reuses, and partially corrects) · ADR-0069/0070 (the migration this unblocks) · `scripts/co-newbiz/gen-pk-notnull-rebuild.ts` · `db/migrations/0033_pk_not_null_rebuild.sql`
