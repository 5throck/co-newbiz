---
name: db-migration-governance
scope: co-newbiz
description: >
  Authors and reviews `db/migrations/*.sql` under ADR-0001/0002's
  conventions — SQLite as the engine, ULID PKs, ISO-8601 TEXT dates,
  CHECK-constrained enums, integer minor units for money, no AUTOINCREMENT/
  INSERT OR REPLACE, PRAGMA foreign_keys=ON — and confirms every schema
  change matching design §7's ADR trigger list has one before merging.

  Use when: "new migration", "db schema change", "migration review",
  "portability regime compliance".
version: 1.0.0
last_reviewed: 2026-08-20
status: active
owner: dba
prerequisites:
  - adr-governance
metadata:
  type: implementation
  triggers:
    - new migration
    - db schema change
    - migration review
    - portability regime compliance
---

## Context

ADR-0002's portability regime is a design decision, not a style
preference: SQLite conventions are chosen to keep a future migration to
Postgres or another engine tractable (`db:export --dialect postgres`
diffed clean against these constraints is Wave 5.1's own acceptance
criterion). A migration that uses AUTOINCREMENT, stores money as a float,
or skips a CHECK constraint on an enum column isn't just inconsistent
style — it's a portability regression the design explicitly guards against.

## When to Use

- Any new `db/migrations/*.sql` file
- Reviewing an existing migration for convention compliance
- A DB schema change — always requires the ADR trigger-list check first (`adr-governance`)

## Execution Steps

1. **Confirm ADR requirement first**: DB schema breaking changes are on
   the design §7 trigger list — `adr-governance` before the migration lands
2. **Follow the conventions**: ULID primary keys, ISO-8601 TEXT for all
   dates/timestamps, CHECK constraints on every enum-like column, integer
   minor units (not float) for any money column, no AUTOINCREMENT, no
   INSERT OR REPLACE (explicit UPSERT via ON CONFLICT instead)
3. **Enable `PRAGMA foreign_keys=ON`** — confirmed via `getDb()`, not
   assumed default
4. **Never mutate a shipped migration** — a fix to an already-applied
   migration is a new migration, not an edit to the old file (the same
   append-only discipline as `run-versioning-and-attribution`, applied to schema)
5. **Register the migration in `db/migrations/`'s sequence** and confirm
   `bun scripts/co-newbiz/newbiz.ts db:migrate` applies cleanly on a fresh DB
6. **Spot-check portability**: does the new schema still export cleanly
   under the project's Postgres-portability check, or does it introduce a
   SQLite-specific construct that would need a documented exception (ADR
   required for a DB-engine/portability exception, per the trigger list)?

## Output Format

- New migration file, convention-compliance confirmation, ADR reference
  where required

## Related Skills

- `adr-governance` — the required check before a schema change lands
- `master-data-governance`, `data-normalization` — common consumers of new master-data schema
