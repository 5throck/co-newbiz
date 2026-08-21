---
name: admin-console-operations
scope: co-newbiz
description: >
  Operates the admin console's built sections (users, audit log, data
  sources — Wave 5.6A/5.6B; batch-schedule and retention — 2026-08-21
  batch 4) and documents the remaining 5 of `docs/ui-spec.md`
  §5's 10 designed sections not yet implemented. Admin role never grants
  project data visibility (FR-SEC-02); audit log renders no delete control
  anywhere (FR-SEC-07); a notification-threshold edit without a linked ADR
  reference is a client-side hard block, not a warning.

  Use when: "admin console operation", "user approval workflow", "audit
  log review via admin UI", "threshold edit ADR requirement", "schedule
  job enable/disable", "retention policy management".
version: 1.1.0
last_reviewed: 2026-08-20
status: active
owner: process-governance-manager
prerequisites:
  - auth-and-account-management
metadata:
  type: process
  triggers:
    - admin console operation
    - user approval workflow
    - audit log review via admin UI
    - threshold edit ADR requirement
---

## Context

**Adaptation note**: `docs/ui-spec.md` §5 designs 10 admin console sections
(User Management, Database, Batch-Schedule, Notifications, Governance,
Glossary, Data Sources, Master Data, ADR/Stage-Gate, Logs). 5 of them are
built: Users, Audit Log, Data Sources (Wave 5.6B) plus Batch-Schedule
(enable/disable per `PUT /api/admin/schedule-jobs/:jobKey`, latest-run
status) and the retention-policy part of Database (`GET`/`POST /api/admin/retention`)
— the migration-status/backup-history parts of the Database row and the
notification/governance/glossary/master-data/ADR sections remain backend
follow-ups, not yet built — this
skill operates what exists and names what doesn't, following the pattern
established by other Wave 5.8 skills' honest gap-flagging.

## When to Use

- Approving a pending user account
- Reviewing the audit log via the admin UI
- Confirming data-source key presence (never the value)
- Once built: editing a notification threshold, reviewing governance/glossary/master-data queues

## Execution Steps (for the built sections)

1. **User management**: approve pending accounts, set roles, disable/
   enable — confirm this never implies project visibility; an admin sees
   identity columns only, never project data (FR-SEC-02, enforced at the
   route layer, not just a UI convention)
2. **Audit log**: read-only review — confirm no delete control is ever
   rendered, matching the backend's own no-DELETE-route-at-any-privilege
   enforcement (FR-SEC-07)
3. **Data sources**: confirm key *presence* and reliability grade only —
   never a key value, not even masked; if a UI element ever shows a key
   value, that is a defect to report immediately, not a convenience feature

## Execution Steps (for sections not yet built)

4. **Notification/threshold editing** (design intent): a threshold edit
   without a linked ADR reference must be a client-side hard block, not
   just a warning a user can dismiss — RAG rule/threshold changes are on
   the ADR trigger list (`adr-governance`)
5. **Governance/glossary/master-data admin queues** (design intent):
   surface `staging_unmapped` resolution, undefined-term queue from
   `glossary:lint`, and governance-document version status — these map
   directly to `master-data-governance` and `glossary-management`'s own
   backend work once the admin UI catches up

## Output Format

- Admin action log (approvals, role changes, disables), audit-log review
  notes, data-source presence confirmation

## Related Skills

- `auth-and-account-management` — the underlying account mechanics this console operates
- `master-data-governance`, `glossary-management` — the backend queues future admin sections will surface
- `notification-channel-management` — the threshold-editing target once that section is built
