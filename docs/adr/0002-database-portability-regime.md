# ADR-0002: Database portability regime

**Status**: Accepted
**Date**: 2026-08-20
**Deciders**: data-architect

## Context

SQLite has dialect-specific conveniences (AUTOINCREMENT, ROWID, dynamic typing, INSERT OR REPLACE) that would lock the schema to SQLite semantics if used freely.

## Decision

Forbid AUTOINCREMENT, implicit ROWID dependence, dynamic-type dependence, and INSERT OR REPLACE. Use ISO-8601 TEXT for dates, no floating-point for money, PRAGMA foreign_keys=ON, and access exclusively through `db/repositories/*.ts`. Verify portability with `db:export --dialect postgres`.

## Consequences

A slightly more verbose schema up front buys a real exit path. FTS5 full-text search is isolated to `db/engine/sqlite/` since it has no direct Postgres equivalent (would become `tsvector` on migration).
