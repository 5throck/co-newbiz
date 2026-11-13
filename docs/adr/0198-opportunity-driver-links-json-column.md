---
lang: en
lang_reason: implementation-batch ruling dispatched in English; docs/context.md English-only zone
---

# ADR-0198: S2 driver-links payload column (`opportunity.driver_links_json`)

**Status**: Accepted (implementation of spec `2026-11-13-s2-driver-linkage`, ruling DEC-20261113-05)
**Date**: 2026-11-14
**Deciders**: PM dispatch (Row 0 non-exempt; design + DEC recorded 2026-11-13); schema landed by backend-engineer
**Related**: ADR-0001 (SQLite), ADR-0042 (opportunity primitives), ADR-0012 (audit log append-only), ADR-0069 (Next.js web stack), ADR-0127 (S2 list-light/detail-heavy layout), ADR-0129 (curated proxy_link demand edges), ADR-0179 slice B (the `entry_market_derivation_json` payload-column precedent, migration 0150), ADR-0187 D1 (data-confidence grades), design `2026-11-13-s2-driver-linkage-design`

## Context

The house baseline (`docs/context.md:240`) requires an ADR for **any** database schema change — tables, columns, constraints, indexes, or migrations — before merge. Spec `2026-11-13-s2-driver-linkage` (design D-B) decides that analyst-promoted S1 calibration drivers are captured-provenance evidence records stored on the opportunity carrier, and its schema-governance note delegates the ADR to this implementation dispatch. The alternative carriers were considered in the design: reusing `factors_json` (rejected — factors are bare strings with no per-item provenance slot, migration 0051) and a separate link table (rejected for v1 — a payload document mirrors the 0150 lineage pattern and one opportunity links a handful of drivers, cap 10).

## Decision

1. **One additive nullable column `opportunity.driver_links_json` (migration `0193_opportunity_driver_links.sql`)** — a JSON payload document with a `json_valid` CHECK, byte-identical in shape to the migration-0150 pattern (`entry_market_derivation_json`):

   ```sql
   ALTER TABLE opportunity ADD COLUMN driver_links_json TEXT CHECK (driver_links_json IS NULL OR json_valid(driver_links_json) = 1);
   ```

   NULL = no links; every existing behavior is byte-identical. NEVER backfilled.

2. **Payload document (capture-at-attach evidence record)** — `{links: [...], set_by, set_at}` where each link captures the driver's provenance at attach time (`driver_row_id`, `industry_id`, `industry_name`, `driver`, `direction`, `impact_pct`, `rationale`, `decided_by`, `decided_at`, `version_no`), carries a SERVER-STAMPED `confidence: "C"` that clients cannot raise (strict key whitelist on write), and the analyst's `attached_by`/`attached_at` plus an optional note. Removal deletes the link record from the payload and is audited (content edit, not audit-log deletion — the `audit_log` row persists, ADR-0012).

3. **Write path is human, analyst-only, audited** — `PUT/DELETE/GET /api/opportunities/[id]/driver-links` (`opportunity.driver_links.update`, target `{id}:add:|remove:{driver_row_id}`). The `driver_row_id` must resolve to a `status='accepted'` row of `industry_driver_calibration` whose `industry_id` equals the opportunity's linked industry (cross-industry attach is a 400). Duplicate link → 409 `already_linked`; cap 10 → 400; unknown opportunity → 404 (404-not-403); viewer → 403 with the role message. Validation is strict on write (400 with a reason, never a silent drop) and tolerant on read (invalid stored JSON → `links: []`, never a throw). No MCP tool wraps the route; no `HUMAN_ONLY_ROUTES` entry is added because the design scopes the route as analyst+ (the factors-route precedent), not human-only.

4. **Boundaries (design D-E, test-asserted)** — the write path never touches `attractiveness_score`, `synergy_score`, `status`, `factors_json`, or any gate/verdict value (row-equality test before/after attach); no grade uplift anywhere (human acceptance of an LLM-estimated driver stays C — data confidence caps the RAG grade); no auto-created opportunities; no cross-industry or cross-deal driver reuse; S1 calibration semantics untouched.

## Consequences

- **Additive migration only** — no existing column changes, no backfill; `migrate.ts` picks up `0193` by filename order. The column participates in its own CHECK, so rollback follows the migration-0150 house path (pre-migration backup per ADR-0014 + a table rebuild without the column); the migration header documents this.
- **Audit vocabulary grows by one action** (`opportunity.driver_links.update`) — compatible with the append-only triggers and the FK-free TEXT `target` column.
- **Accepted driver rows are assumed resolvable for the life of a link** (they are never hard-deleted today; `decideCalibrationDriver` only UPDATEs status). A future hard-delete path would need a tombstone story; the GET already exposes `row_status` (`accepted|changed|missing`) so staleness surfacing needs no schema change.
- **No downstream consumer in v1** — scoring, gates, and stage prompts deliberately never read `driver_links_json`; each future consumer re-enters the Design Gate.
