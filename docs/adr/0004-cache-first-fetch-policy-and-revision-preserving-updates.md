# ADR-0004: Cache-first fetch policy and revision-preserving updates

**Status**: Accepted
**Date**: 2026-08-20
**Deciders**: data-architect, backend-engineer

## Context

External statistical series get revised after first publication. Overwriting on refetch would make a three-month-old analysis unreproducible.

## Decision

`ensure_fresh(series_id)` reuses cache within its validity window, uses conditional requests (ETag / content-hash) otherwise, and on a genuine change inserts a new `revision_no` row rather than overwriting. All revisions are preserved in `data_change_log`.

## Consequences

Storage grows monotonically with revisions, offset by the archival policy in ADR-0042. Reproducibility of past runs is preserved even when a source agency restates history.
