---
lang: en
lang_reason: design-batch ruling dispatched in English; docs/context.md English-only zone
---

# ADR-0197: Client-request intake record as a first-class `deal_intake` table

**Status**: Accepted (PM best-judgment default, owner input pending — DEC-20261111-03, revisit-on-owner-input recorded)
**Date**: 2026-11-11
**Deciders**: PM best-judgment default (no owner answer by dispatch time); drafted by platform-lead
**Related**: ADR-0001 (SQLite), ADR-0042 (opportunity/gate primitives), ADR-0074 (Design Gate, flow.spec stage SSOT), ADR-0120 (deal funnel), ADR-0146 (personal API tokens), design `2026-11-11-owner-decisions-intake-batch-design` §3–§4

## Context

Deal reviews can be started from the deal board through exactly two CTAs (`app/web-next/app/deals/page.tsx:313-314`: `/market?new=1`, `/opportunities?known_target=1`), but the system records nothing about *who asked for the deal* or *through which entry*. The opportunity row (`db/migrations/0042_opportunity_and_gate_decision.sql:8-24`) captures the analyst's assessment (`rationale`) and creator (`created_by`), not the client request. On the market path an opportunity does not even exist when S1 starts — the new-analysis flow creates an `md_industry` + market analysis only (`components/stages/market/useMarketLinking.ts:121,135`), and the carrier is created later in S2 (`POST /api/opportunities`, `app/api/opportunities/route.ts:51`). The audit log records `opportunity_create` but is an append-only evidence store, not an origin record a reviewer can read on the deal. A formal S0 stage was considered and rejected: `flow.spec.yaml` (ADR-0074) stage machinery — predicates, gates, coverage tests — is disproportionate for a record with no artifacts and no dispatch.

Separately in the same batch: admin API-token issuance is withdrawn (both seams — self-service `POST /api/tokens`, which today allows admin read-scope self-issue, and admin-on-behalf `POST /api/admin/users/[userId]/tokens`, which today mints tokens for any user with raw scopes and no scope validation), with `validateApiToken`'s role re-check (viewer/admin lose `write` at validation, `db/lib/api-tokens.ts:103,159-161`) deliberately unchanged so existing tokens stay valid until expiry; and the first-boot bootstrap admin password moves from the container log (`instrumentation.ts:171-180` prints it in plaintext) to a 0600 file, with `must_change_password` (hardcoded 1, `db/lib/accounts.ts:100-107`) untouched. Those two rulings need no schema change and are recorded in DEC-20261111-03 and the batch design; this ADR covers the one schema change of the batch.

## Decision

1. **New table `deal_intake` (migration `0190_deal_intake.sql`)** — the client-request intake record:

   ```sql
   CREATE TABLE deal_intake (
     id TEXT PRIMARY KEY NOT NULL,
     opportunity_id TEXT REFERENCES opportunity(id),
     source TEXT NOT NULL CHECK (source IN ('board_new_deal', 'board_known_target')),
     requested_by TEXT,
     note TEXT,
     created_by TEXT NOT NULL,
     created_at TEXT NOT NULL
   );
   CREATE INDEX idx_deal_intake_opportunity ON deal_intake(opportunity_id);
   CREATE INDEX idx_deal_intake_created ON deal_intake(created_at);
   ```

   `opportunity_id` is NULLABLE on purpose (same pattern as `opportunity.project_id`, 0042 :5-7): an intake is created at board-CTA time, before the opportunity exists; an intake whose deal never materializes stays unlinked as the honest record that a request was made. `requested_by` is free text — the external requester is not an `app_user` account. `created_by` is the session user (NOT NULL, mirroring `opportunity.created_by`). CHECK-enum on `source` follows the migration-0042 house style; new channels extend the CHECK by migration.
2. **Intake is not a stage.** No S0, no gate change, no `flow.spec.yaml` edit. The intake is created from a small board modal (source derived from the CTA clicked; requester + note optional), rides the existing query-carrier exemptions as `&intake=<id>`, and links to the opportunity at the single creation seam `POST /api/opportunities` via an optional `intake_id` body field (idempotent `UPDATE … WHERE opportunity_id IS NULL`; stale >30 days or already-linked intakes refuse with an audited `intake_link_refused` while the opportunity creation proceeds). Audit actions: `intake_created`, `intake_linked`, `intake_link_refused` — through the existing append-only writer (`db/lib/access-control.ts:37`).
3. **Rendering.** The linked intake renders as an origin line on the deal overview (`/opportunities/[id]`, ADR-0127) via the existing detail GET (one LEFT JOIN, no new route). Unlinked intakes render nowhere in this batch (follow-up recorded).
4. **Same-batch no-schema rulings (recorded here for provenance, designed in the batch design §4–§5):** admin API-token issuance is forbidden at both seams (`role_forbidden` + audited; admin-on-behalf POST removed, GET/DELETE kept; `validateApiToken` unchanged — existing read tokens stay valid until expiry); the bootstrap admin password is written once to a 0600 file (`CO_NEWBIZ_BOOTSTRAP_PASSWORD_FILE` override, default next to the resolved DB file), the plaintext log line is removed not masked, bootstrap aborts before `createUser` if the file cannot be written, and `deployment.md` :65/:96 tell the operator the file path. Admin MFA is deferred as an accepted-risk record, no code.

## Consequences

- **Additive migration only** — no column changes to `opportunity`, `gate_decision`, or `audit_log`; existing queries and repositories are untouched. `migrate.ts` picks up `0190` by filename order.
- **Multiple unlinked intakes are legal** (a user may click the CTA twice); no uniqueness constraint — the link predicate (`IS NULL`) keeps one intake → at most one opportunity, and one opportunity → at most one rendered origin line. Reviewers reading an intake list must expect dupes until the owner rules on a queue surface.
- **Audit vocabulary grows by three actions** (`intake_created`, `intake_linked`, `intake_link_refused`) — all compatible with the append-only triggers and the FK-free TEXT `target` column.
- **The stale-intake window (30 days) and the optional `requested_by` are PM defaults** recorded for owner revisit; changing them is a constant/code tweak, not a migration.
- **Token surfaces shrink for admins**: the connected-apps issue form hides behind a catalog note; `tests/unit/token-issue-access.test.ts:10` flips admin to the false-list and `api-tokens.test.ts` gains the first-ever coverage of the admin-on-behalf route. The raw-scopes hole on that route disappears by route removal, not by added validation.
- **The bootstrap password leaves the container log permanently**; operators get the path from the runbook. A write failure aborts first-boot admin creation (fail-closed, self-heals next boot). A static tripwire test prevents the plaintext log line from returning.
- **MFA remains an open risk** for admin accounts, now recorded as accepted-risk instead of unrecorded.
