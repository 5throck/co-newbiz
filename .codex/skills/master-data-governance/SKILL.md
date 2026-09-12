---
name: master-data-governance
scope: co-newbiz
description: >
  Resolves the `staging_unmapped` queue — raw values that failed to match
  an existing master-data code (industry, company, unit, currency, country,
  period, source, statute, account, entity) — into a proper master-data
  row or an explicit rejection, rather than letting unmapped data
  accumulate silently.

  Use when: "staging unmapped queue", "master data resolution", "unmapped
  raw value", "master data code assignment".
version: 1.0.0
last_reviewed: 2026-08-20
status: active
owner: dba
prerequisites: none
relates_to:
  - skill: data-normalization
    type: composes_with
  - skill: db-migration-governance
    type: composes_with
metadata:
  type: implementation
  triggers:
    - staging unmapped queue
    - master data resolution
    - unmapped raw value
    - master data code assignment
---

## Context

`staging_unmapped` (`raw_value`, `attempted_master_table`, `first_seen_at`)
is the safety net for ADR-0003's fixed master-data code systems: rather
than silently rejecting a raw value that doesn't match an existing
`md_industry`/`md_company`/`md_unit`/`md_currency`/`md_country`/`md_period`/
`md_source`/`md_statute`/`md_account`/`md_entity` code, or worse, silently
inventing a new code without review, the pipeline stages it for human
resolution. A growing unresolved queue is itself a signal something in the
ingestion pipeline needs attention, not just individual data-quality noise.

## When to Use

- Periodically, resolving the accumulated `staging_unmapped` queue (admin console section)
- Any time an ingestion pipeline stage reports a value it couldn't map

## Execution Steps

1. **Review the queue** grouped by `attempted_master_table` — resolving
   similar unmapped values together surfaces patterns (a whole batch
   failing against `md_company` might indicate a naming-convention
   mismatch, not N independent data-quality issues)
2. **For each entry, decide**: (a) maps to an existing master-data row
   under a known alias — add the alias mapping; (b) genuinely new entity —
   create a new master-data row with proper code assignment; (c) invalid/
   garbage data — reject explicitly, don't leave it pending indefinitely
3. **Apply the appropriate code system** per the master table's convention
   (ADR-0003) — never invent an ad hoc code scheme for convenience
4. **Clear resolved entries from the queue** — resolution should reduce
   the queue, not just annotate it
5. **Flag a recurring unmapped pattern** to `platform-lead` if the same
   raw-value shape keeps appearing — likely an upstream pipeline defect,
   not a one-off data issue

## Output Format

- Resolved master-data rows (new or aliased) or explicit rejections, queue reduction

## Related Skills

- `data-normalization` — the broader normalization pipeline this queue is part of
- `db-migration-governance` — where a new code-system category itself would need a migration
