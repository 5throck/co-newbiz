---
name: data-normalization
scope: co-newbiz
description: >
  Normalizes raw ingested data (Korean DART account names, industry codes,
  entity identifiers) against `db/mappings`/`python/mappings` tables into
  the canonical schema, routing values that don't match to
  `master-data-governance`'s `staging_unmapped` queue rather than
  discarding or guessing.

  Use when: "data normalization", "account name mapping", "canonical
  schema conversion", "normalization coverage".
version: 1.0.0
last_reviewed: 2026-08-20
status: active
owner: dba
prerequisites: none
relates_to:
  - skill: master-data-governance
    type: composes_with
  - skill: db-migration-governance
    type: composes_with
metadata:
  type: implementation
  triggers:
    - data normalization
    - account name mapping
    - canonical schema conversion
    - normalization coverage
---

## Context

`financial-statement-analysis`'s pipeline already implements this pattern
for financial statements specifically (`python/normalize.py`,
`python/mappings/ifrs_general.json`) — this skill generalizes the same
discipline to any raw-to-canonical mapping in the system: a mapping table
converts known raw forms, and anything that doesn't match routes to
`staging_unmapped` for human resolution rather than being silently dropped
or force-mapped to the nearest-looking code.

## When to Use

- Any ingestion pipeline stage that converts raw source data into
  co-newbiz's canonical schema
- Reviewing normalization coverage (what fraction of raw values mapped successfully)

## Execution Steps

1. **Identify the mapping table** for the data type being normalized
   (financial account names, industry codes, entity identifiers) —
   `financial-statement-analysis`'s `ifrs_general.json` is the reference
   pattern for how a mapping table is structured
2. **Apply the mapping**, tracking coverage rate — a normalization stage's
   own quality signal is its coverage percentage, not just "it ran"
3. **Route unmatched values to `staging_unmapped`** with the attempted
   master table recorded — never silently discard or force-map to a
   plausible-looking nearest code
4. **Report low coverage explicitly**: `financial-statement-analysis`'s
   own error-handling table treats <60% coverage as a mapping-gap signal
   requiring investigation, not an acceptable pass rate to note in passing
5. **Update the mapping table** (not a one-off workaround) when a
   recurring unmatched pattern is resolved via `master-data-governance` —
   the fix should prevent the same value from re-appearing in the queue

## Output Format

- Normalized data with coverage rate reported, unmatched values routed to
  `staging_unmapped`

## Related Skills

- `master-data-governance` — the resolution path for unmatched values
- `financial-statement-analysis` — the reference implementation pattern this generalizes
