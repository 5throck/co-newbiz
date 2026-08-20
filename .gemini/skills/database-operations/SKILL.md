---
name: database-operations
scope: co-newbiz
description: >
  Runs backup and disaster-recovery operations for the SQLite database —
  absorbed backup-and-dr into this skill (design §9.2 merge — same
  trigger, same owner). Backup runs immediately before any migration
  (ADR-0014); a backup that has never been restored is not verified
  (ADR-0015's monthly recovery-drill requirement).

  Use when: "database backup", "disaster recovery", "recovery drill",
  "restore verification".
version: 1.0.0
last_reviewed: 2026-08-20
status: active
owner: dba
prerequisites: none
metadata:
  type: implementation
  triggers:
    - database backup
    - disaster recovery
    - recovery drill
    - restore verification
---

## Context

ADR-0015's own framing is exact: "a backup never restored is not
verified" — a backup job that runs successfully every night but has never
been the subject of an actual restore attempt provides false confidence,
not real DR coverage. This is why the monthly recovery drill is on the
fixed operating-rhythm calendar (`docs/ops-cadence.md`), not left as an
implicit "we should probably test this sometime" expectation.

## When to Use

- Immediately before any migration (`deployment-and-release`'s requirement)
- Monthly recovery drill (`docs/ops-cadence.md`)
- Quarterly DR drill (`docs/security-baseline.md` §1)

## Execution Steps

1. **Run backup immediately before any migration** — timing matters; a
   backup from yesterday doesn't protect against a migration run today
2. **Monthly recovery drill**: actually restore a backup to a
   non-production environment and confirm the restored database is
   queryable and matches expected state — not just "the backup file exists
   and has a plausible size"
3. **Record the drill result** — success confirms the backup process
   actually works; a failure is a finding to fix immediately, not to note
   and defer
4. **Quarterly DR drill**: a broader exercise than the monthly recovery
   drill — confirm the full recovery procedure (not just the database)
   works under simulated real conditions
5. **Retention**: apply `retention_policy` rows (archive/delete per table,
   per `retention_months`) — confirm the policy is actually executing, not
   just configured

## Output Format

- Backup log, monthly/quarterly drill result (restored successfully /
  failed with findings), retention-policy execution confirmation

## Related Skills

- `deployment-and-release` — the pre-migration backup requirement
- `infrastructure-automation` — the automation layer running these jobs on schedule
