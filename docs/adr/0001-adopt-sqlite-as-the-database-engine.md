# ADR-0001: Adopt SQLite as the database engine

**Status**: Accepted
**Date**: 2026-08-20
**Deciders**: data-architect, platform-lead

## Context

The system needs a single-file, zero-admin-overhead database for a 5-20 concurrent-user internal tool, with a credible path to Postgres if usage grows past what SQLite comfortably handles.

## Decision

Use SQLite (`bun:sqlite`, WAL mode) as the primary engine for Stage 5. All schema and access code is written to the portability constraint of ADR-0002, so a future migration to Postgres is a data-export/import exercise, not a rewrite.

## Consequences

Zero operational overhead for the current scale. Full-text search (FTS5) and any future concurrent-write-heavy workload are the two known limits that would force reconsideration.
