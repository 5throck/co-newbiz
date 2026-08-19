# ADR-0039: Personal data minimization and aggregate-first principle

**Status**: Accepted
**Date**: 2026-08-20
**Deciders**: legal-counsel, hr-integration-agent, security-engineer

## Context

Executive compensation (`management_package`) and pay benchmarking (`comp_benchmark`) are personal data by nature; storing individual-level compensation figures creates a retention and access-control burden the analysis doesn't actually need.

## Decision

Store no personal identifiers — `executive_ref` uses a role-based substitute key (e.g. `TARGET-CEO-01`), never a real name. `comp_benchmark` stores only job-family/grade-level aggregates, never an individual salary row. Retention is time-bound and enforced by a `retention_policy` table.

## Consequences

Verification requires zero individual-level salary rows in `comp_benchmark` and zero real names in `management_package.executive_ref` (design §12) — a structural, not procedural, guarantee.
