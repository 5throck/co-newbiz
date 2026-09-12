---
name: deployment-and-release
scope: co-newbiz
description: >
  Executes releases under ADR-0014's discipline: every migration tagged
  reversible-or-not at write time, backup immediately before any
  migration, health check immediately after, joint release-engineer+dba
  sign-off for irreversible migrations, and a rehearsed rollback drill at
  least once per release cycle on a reversible-tagged migration — a
  scheduled drill, not a hope.

  Use when: "release deployment", "migration rollback", "irreversible
  migration sign-off", "rollback drill".
version: 1.0.0
last_reviewed: 2026-08-20
status: active
owner: release-engineer
prerequisites:
  - db-migration-governance
metadata:
  type: implementation
  triggers:
    - release deployment
    - migration rollback
    - irreversible migration sign-off
    - rollback drill
---

## Context

ADR-0014's core insight: rollback risk must be planned before a migration
runs, not discovered after it fails. A migration with no rollback plan
that later needs one is a much worse position than one that was simply
tagged irreversible up front and given the higher sign-off bar that
implies.

## When to Use

- Every release, always
- Any migration reaches the point of being ready to ship

## Execution Steps

1. **Tag every migration reversible or not** at write time
   (`db-migration-governance`'s output), never left ambiguous
2. **Run a backup immediately before any migration** — not "recently," immediately
3. **Run a health check immediately after** the migration applies —
   confirm the system is actually healthy, not just that the migration
   command exited 0
4. **Irreversible migrations require joint release-engineer + dba
   sign-off** — a higher bar than the default review, and not
   substitutable by either role alone
5. **Rehearse a rollback drill at least once per release cycle** on a
   reversible-tagged migration — pick one, actually roll it back in a
   non-production environment, confirm it works. A rollback plan that has
   never been executed is unverified, not proven
6. **Record the drill result** — feeds `docs/security/security-baseline.md`'s
   quarterly DR-drill cadence and the general operating-rhythm discipline

## Output Format

- Release record: migrations shipped (reversibility tag, sign-off where
  irreversible), backup/health-check confirmation, rollback drill log for the cycle

## Related Skills

- `db-migration-governance` — the migration this release ships
- `database-operations` — the backup/DR mechanics this discipline relies on
