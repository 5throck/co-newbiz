# Runbook — Backup, Restore, and Rollback

**Owner**: dba, release-engineer
**Design of record**: ADR-0014 (deployment/rollback discipline), ADR-0015 (operating rhythm/SLOs), `docs/security-baseline.md`
**Status**: Stage 5 Wave 5.9 — executable today. Verified by a real rehearsal (§4).

## 1. Tools

| Script | Purpose |
|---|---|
| `bun scripts/co-newbiz/backup.ts [--db-path <path>] [--backup-dir <dir>]` | Checkpoints the WAL (TRUNCATE mode), copies the main DB file, and writes a row-count manifest alongside it. |
| `bun scripts/co-newbiz/restore.ts <backup-file> [--db-path <path>]` | Restores a backup over the live DB and verifies every table's row count against the backup's manifest — fails loudly (non-zero exit) on any mismatch. |

Every backup produces two files: `<name>.sqlite.<timestamp>.bak` and `<name>.sqlite.<timestamp>.bak.manifest.json`. The manifest is required for restore — a backup file with no manifest cannot be restored (ADR-0015: "a backup never restored is not verified" is enforced by refusing an unverifiable restore, not just by good practice).

## 2. Backup — When

- **Immediately before any migration** (ADR-0014) — not "recently," immediately.
- **Daily** (`docs/ops-cadence.md`'s cadence table, Stage 5 automation row).
- Before any operation with meaningful blast radius on the live data.

## 3. Rollback (Migration) Procedure

1. Confirm the migration about to run is tagged `@reversible: true` in its own file header — every migration in `db/migrations/` carries this tag (retroactively added in Wave 5.9 for migrations 0001-0009; required for every new one going forward, per `db-migration-governance`).
2. `bun scripts/co-newbiz/backup.ts` — this IS the rollback plan; there is no separate per-migration DOWN script in this codebase (SQLite + the project's forward-only migration runner).
3. Apply the migration (`bun scripts/co-newbiz/newbiz.ts db:migrate`).
4. Run a health check (confirm the API server starts and `/api/health` responds, confirm `bun test` passes against the migrated schema).
5. **If rollback is needed**: `bun scripts/co-newbiz/restore.ts <the-backup-from-step-2>`. This restores the pre-migration state and verifies it.
6. Irreversible migrations (`@reversible: false`) require joint release-engineer + dba sign-off before step 3 — a higher bar than the default review.

## 4. Rehearsal Log

**2026-08-20 — Wave 5.9, first real rehearsal** (`deployment-and-release`/`database-operations` skills' own discipline, executed for real rather than only described):

- **Recovery drill**: fresh migrated scratch DB seeded with 2 rows → backed up → live file deleted (simulated total data loss) → restored → verified row counts AND actual row content matched. **Pass.**
- **Rollback rehearsal**: scratch DB migrated through 0009 → backed up (pre-migration-0010 state) → migration 0010 (`idx_audit_log_created_at`, a real, useful index — see its own file) applied and confirmed present → restore run against the pre-0010 backup → confirmed the index was gone and `schema_migrations` back to 9 rows. **First attempt failed** (see §5); **second attempt, after the fix, passed.**

## 5. Defect Found During Rehearsal (and why the rehearsal discipline matters)

The first rollback rehearsal attempt reported "restore verified" but the migration's effect (the new index) was still present afterward — `restore.ts` had copied the backup's main `.sqlite` file over the live path, but left the live DB's own `-wal`/`-shm` sidecar files in place. SQLite replayed those leftover WAL frames (containing the post-backup migration-0010 write) on next open, silently re-applying exactly the write the restore was supposed to undo — the row-count verification even passed, because the check ran against the DB *after* the WAL replay had already re-added the data, not against the file that was actually copied.

Fixed by checkpoint-truncating the live connection's own WAL in place (`PRAGMA wal_checkpoint(TRUNCATE)`) before closing and copying the backup over it, rather than attempting to delete the sidecar files afterward (which also turned out to have its own Windows file-lock timing issue during testing). Re-rehearsed after the fix — passed. This is the concrete example `deployment-and-release`'s own skill file points to when it says a rollback plan that has never been executed is unverified, not proven: this defect would not have been caught by code review alone; it took an actual restore-and-check to surface.

## 6. Related

- `db/migrations/0010_audit_log_created_at_index.sql` — the migration used for the rehearsal (a genuine, useful index, not a throwaway)
- `tests/unit/backup-restore.test.ts` — the encoded regression tests for this behavior
- `skills/deployment-and-release/SKILL.md`, `skills/database-operations/SKILL.md` — the operational disciplines this runbook implements
