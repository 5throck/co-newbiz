---
name: query-performance-tuning
scope: co-newbiz
description: >
  Diagnoses and fixes slow queries against the co-newbiz schema — index
  coverage review, `EXPLAIN QUERY PLAN` analysis, and repository-layer
  query review — with particular attention to the membership-filtering
  queries every project-scoped read runs through (design's access-control
  layer must stay fast, not just correct).

  Use when: "slow query", "query performance", "EXPLAIN QUERY PLAN",
  "index coverage review".
version: 1.0.0
last_reviewed: 2026-08-20
status: active
owner: dba
prerequisites: none
relates_to:
  - skill: database-operations
    type: composes_with
  - skill: db-migration-governance
    type: composes_with
metadata:
  type: implementation
  triggers:
    - slow query
    - query performance
    - EXPLAIN QUERY PLAN
    - index coverage review
---

## Context

`project.repository.ts`'s membership-filtering join runs on every
project-scoped read across the whole API surface (`listVisibleProjects`,
`getProjectIfVisible`) — this is the single highest-traffic query pattern
in the system, and a missing index on `project_member(project_id, user_id)`
or `project_classification(project_id)` would degrade every API call, not
just one feature.

## When to Use

- A specific query or API endpoint is measurably slow
- Periodic index-coverage review as the schema grows
- Before adding a new query pattern that will run on every request (like
  the membership-filtering join)

## Execution Steps

1. **Reproduce the slow query** with realistic data volume — a query that
   looks fine against a 10-row test DB can be pathological against
   production-scale data
2. **Run `EXPLAIN QUERY PLAN`** and look for a full table scan where an
   index should apply, or a query using an index inefficiently (wrong
   column order in a composite index)
3. **Review high-traffic query patterns specifically**: the membership-
   filtering join every project-scoped read runs through, `rag_assessment`
   lookups by `project_id`+`assessed_at`, `audit_log` reads by actor/date
4. **Add or reorder indexes** where the query plan shows a gap — confirm
   the fix via a fresh `EXPLAIN QUERY PLAN`, not just "it feels faster"
5. **Confirm the fix doesn't regress write performance** — an index
   speeds reads but costs writes; a table with heavy write traffic
   (`audit_log`, `data_change_log`) needs the tradeoff considered explicitly

## Output Format

- Slow-query diagnosis (EXPLAIN QUERY PLAN before/after), index change with rationale

## Related Skills

- `db-migration-governance` — where an index addition is implemented
- `observability-and-alerting` — where a recurring slow-query pattern should trigger monitoring
