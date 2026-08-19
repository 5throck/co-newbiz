---
governance_doc_id: pol-ent-b-addendum
layer: policy
title: "Entity Addendum — ent-b"
scope: entity
entity_id: ent-b
level: entity
version: "1.0.0"
enforceability: mandatory
owner_agent: process-governance-manager
approver_role: entity-ic
effective_from: "2026-08-20"
review_cycle_months: 12
---

# Entity Addendum — ent-b

**Status**: Active (placeholder entity — see Open Issue O-1)
**Extends**: [`policies/group/neb-policy.md`](../../group/neb-policy.md)

> `ent-b` is a placeholder entity seeded per the design's O-1 default, alongside `ent-a`, so the schema and procedure-override mechanism can be exercised against two distinct entities rather than validated against a single case.

## Additions to Group Policy

1. **No minimum deal size override** — ent-b follows the group policy's default Screening entry without an internal pre-screen (contrast with ent-a, deliberately kept different to prove the override mechanism actually varies per entity).
2. **Green Field priority sector**: ent-b's Green Field reviews prioritize shipbuilding-adjacent manufacturing per the Stage 1 M1 default industry, consistent with `industry-profiles/shipbuilding-adjacent.yaml`.

## Procedure Overrides

ent-b does not currently override the shared `greenfield-screening` or `brownfield-screening` procedures — it consumes the shared procedure as-is (a minimal `references:` block with no `overrides:` key), which is the other valid case the reference-override mechanism must support (design §6.3 "minimal form").
