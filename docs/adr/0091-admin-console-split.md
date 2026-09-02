# ADR-0091: Admin console split — role-separated navigation, per-section routes, system dashboard

**Status**: Accepted — implemented in the same change (layout, route split, system-stats API, dashboard)
**Date**: 2026-09-03
**Deciders**: user (standing directive), platform-lead (review), security-engineer (role separation review)
**Design of record**: `app/web-next/app/admin/**` (layout + section routes), `app/api/admin/system-stats/route.ts`, `components/admin/AdminConsole.tsx`
**Related**: ADR-0083 (visual standard), ADR-0086 (screen patterns), docs/api-spec.md §8 (admin endpoints never MCP-exposed)

## Context

The admin console was a single 979-line page with ten tabs. Three structural defects:
(1) an admin saw all business navigation (the hide-logic `label.startsWith("S")` was dead
code — no section label starts with Latin "S"), violating the intent that admins manage
users and systems only; (2) management items had no sidebar menus or individual screens;
(3) several sections lacked CRUD (users had no role-change/disable UI, schedule jobs had
toggle only with no run history, master data had no delete), and the console had no charts
at all despite chartable data (audit-log volume, job_run outcomes, user/token/funnel
distributions) already resident in the database.

## Decision

1. **Role-screen separation (AppShell)**: an `admin` account sees only the 관리 group
   (system screens); business navigation is hidden. Non-admins never see 관리자. The dead
   hide-logic is removed. The gate is defense-in-depth: each admin route already enforces
   `requireAdmin`, and the new `app/admin/layout.tsx` additionally blocks non-admins
   client-side.
2. **Route split**: `app/admin/layout.tsx` + one route per section
   (`/admin/users`, `/admin/audit`, `/admin/data-sources`, `/admin/schedule`,
   `/admin/database`, `/admin/notifications`, `/admin/glossary`, `/admin/governance`,
   `/admin/master-data`, `/admin/adr`), each rendering the shared
   `components/admin/AdminConsole.tsx` with a `section` prop. Section state lives in the
   URL, not component state.
3. **System dashboard (`/admin`)**: `GET /api/admin/system-stats` aggregates audit-log
   daily volume (30 days), user role/status distributions, active/revoked API-token counts,
   job_run success/failure per job, and the opportunity funnel. The dashboard renders KPI
   cards plus line/pie/bar charts on the shared chart theme.
4. **CRUD completion**: users gain role-change (select, self-demotion blocked server-side
   already) and disable/enable actions; master data gains DELETE on allow-listed tables
   (referential-integrity violations return a 400 with guidance); the notifications tab
   now reads the admin all-notifications endpoint instead of the user's own inbox.
   Glossary term edit/delete remains deferred — terms are YAML-file-backed and a write
   API needs its own design (documented in ui-spec).

## Consequences

- An admin's working context is exactly the management surface; business roles keep their
  existing navigation unchanged. Any future admin feature becomes a new route in the 관리
  group, not another tab.
- `system-stats` exposes aggregates only — no project content, honoring api-spec §8's
  admin-visibility rule.
- Known deferrals recorded: glossary write API, schedule retry/run trigger, database
  backup-history endpoints (rendered notes only, per ui-spec).
