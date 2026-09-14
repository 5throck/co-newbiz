# ADR-0133 — System mode (production/development) gates deal-data deletion

- Date: 2026-09-15
- Status: accepted (implemented same day)

## Context

While cleaning up a test-only opportunity/project pair created during development, the user asked to physically remove the rows from the database. The app's existing `deal-deletion-playbook` (ADR-0012-adjacent audit design) deliberately never deletes rows — `DELETE /api/projects/[id]` and `DELETE /api/opportunities/[id]` only tombstone (`deleted_at`/`deleted_by`/`delete_reason`) and record a `deal_archive` manifest, so any deal ever reviewed stays auditable. Bypassing that with a raw SQL delete would have broken referential/audit integrity for no real benefit, since the tombstone mechanism already satisfies "get this out of active views."

Separately, the user asked for a durable safety mechanism: a global production/development mode so that, going forward, **no one can delete deal data at all while the system is in production**, while development environments (used for exactly this kind of test-data churn) keep the existing tombstone-delete capability. This is an auth/permission-model change and a DB schema change — both on the design v1.0 §7 ADR trigger list.

Two scope questions were resolved with the user directly:
1. Which entities are gated? — project and opportunity core-entity DELETE only (not every DELETE route in the app — tokens, share-links, PMI sub-items, etc. stay ungated, since those are routine record management, not deal teardown).
2. Does this replace the existing tombstone semantics, or add a new "hard delete" capability? — Neither. The existing tombstone-DELETE stays exactly as it is; production mode simply blocks calling it at all. No new hard-delete endpoint was built — test-data cleanup in development mode still goes through the same tombstone mechanism (a physically-deleted row was explicitly rejected as violating the deal-deletion-playbook's audit guarantee even for test data, since the mechanism doesn't distinguish "test" rows from real ones).

## Decision

1. New table `system_setting` (migration `0100_system_mode.sql`) — a generic `key`/`value` store, seeded with `system_mode = 'production'` (fail-closed default; a fresh or freshly-migrated database blocks deletion until an admin explicitly opts into development mode).
2. `db/lib/system-mode.ts` — `getSystemMode(db)` (defaults to `'production'` if the row is ever missing) and `setSystemMode(db, mode, actor, now)`.
3. `GET/POST /api/admin/system-mode` — admin-only (`requireAdmin`), mirrors the existing `/api/admin/retention` shape. POST validates `mode ∈ {production, development}` and writes an `audit_log` entry (`system_mode_set`).
4. `DELETE /api/projects/[id]` and `DELETE /api/opportunities/[id]` each call `getSystemMode(db)` immediately after the existing role check and return `403 production_mode_delete_blocked` before touching any row if the mode is `'production'`.
5. Admin UI: `components/admin/SystemModeSection.tsx` + `/admin/system-mode` page, registered in `ADMIN_NAV` (`lib/navigation.ts`, the navigation SSOT per ADR-0105) — visible only to the `admin` role (`app/admin/layout.tsx` already gates the whole `/admin/**` group). Switching to development mode requires an inline confirmation naming the risk (test-data-only, deletion re-enabled).

## Consequences

- A production deployment cannot lose deal data to a DELETE call, full stop, until an admin deliberately flips the switch — closing the actual risk (a wrong click or a mistaken automation tearing down a real deal) without touching the audit-trail guarantee the tombstone mechanism already provides.
- Development environments (this local DB included) start in `production` mode after migration and must be switched once via the new admin page before test-data cleanup DELETEs work again — a deliberate one-time friction, not a bug.
- No new deletion capability (hard delete) was introduced anywhere; the gate only wraps the pre-existing tombstone DELETE routes.
- Every other DELETE route in the app (tokens, share-links, partner/PMI sub-records, industries, business-case, jv-terms, etc.) is intentionally out of scope — those are routine record edits, not deal teardown, and gating all ~20 of them was explicitly declined by the user in favor of the narrower, reviewable scope.
- Migration `0100_system_mode.sql` is additive-only (one new table); reversible via `DROP TABLE system_setting`.

## Related

`deal-deletion-playbook` (`app/api/projects/[id]/route.ts` header comment) — the tombstone design this ADR gates rather than replaces. ADR-0091 (admin role/screen separation) — `/admin/system-mode` follows its nav-registration convention.
