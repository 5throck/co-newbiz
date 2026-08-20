---
name: data-freshness-and-revision-control
scope: co-newbiz
description: >
  Operates ADR-0004's cache-first, revision-preserving fetch policy day to
  day: monitors cache-staleness across active series, confirms
  `data_change_log` entries are being written on genuine revisions, and
  audits that no code path overwrites a `revision_no` row instead of
  inserting a new one. The platform-operations counterpart to
  `market-data-pipeline`'s implementation-level policy.

  Use when: "data staleness check", "revision_no audit", "data change log
  review", "series freshness monitoring".
version: 1.0.0
last_reviewed: 2026-08-20
status: active
owner: dba
prerequisites:
  - market-data-pipeline
metadata:
  type: implementation
  triggers:
    - data staleness check
    - revision_no audit
    - data change log review
    - series freshness monitoring
---

## Context

Where `market-data-pipeline` documents the fetch-time policy (ADR-0004) —
currently not-yet-implemented as its own skill honestly notes — this skill
is the standing operational discipline for once that pipeline (or any
other revision-preserving data path already in the system, such as
`observation.repository.ts`'s existing change-detection logic) is live:
confirming the discipline actually holds over time, not just at
implementation.

## When to Use

- Periodic operational check on data freshness across active series
- Auditing that `data_change_log` entries are complete and no revision was silently overwritten

## Execution Steps

1. **Monitor cache-staleness** across series actively used by open
   projects — a series past its validity window that hasn't been
   refreshed is a data-quality risk to flag proactively, not wait for a
   consumer to notice
2. **Audit `data_change_log` completeness**: for any series with more than
   one observed value over time, confirm a corresponding change-log entry
   exists — a gap suggests a code path overwrote instead of appending
3. **Spot-check for overwrite violations**: query for any table storing
   revisable data and confirm no UPDATE-in-place pattern exists where an
   INSERT-new-revision pattern should — this is the concrete, checkable
   form of ADR-0004's policy
4. **Report staleness and revision-integrity findings** to `platform-lead`
   — a systemic staleness pattern across many series may indicate the
   fetch pipeline itself needs attention, distinct from any single series'
   individual staleness

## Output Format

- Staleness report (series past validity window), revision-integrity audit
  result (any overwrite violations found)

## Related Skills

- `market-data-pipeline` — the fetch-time policy this operates
- `db-migration-governance` — where a revision-integrity violation might require a schema fix
