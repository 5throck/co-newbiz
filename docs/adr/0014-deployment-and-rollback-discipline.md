# ADR-0014: Deployment and rollback discipline

**Status**: Accepted
**Date**: 2026-08-20
**Deciders**: release-engineer, dba

## Context

Migrations against a live system carry real risk of data loss or downtime if rollback isn't planned before the migration runs, not after it fails.

## Decision

Every migration is tagged reversible-or-not at write time. Backup runs immediately before any migration; health check immediately after. Irreversible migrations require joint release-engineer + dba sign-off, a higher bar than the default review.

## Consequences

Rollback is rehearsed at least once per release cycle on reversible-tagged migrations — a scheduled drill, not a hope.
