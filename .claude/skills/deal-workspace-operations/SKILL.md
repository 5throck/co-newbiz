---
name: deal-workspace-operations
scope: co-newbiz
description: >
  Operates a project's workspace lifecycle: opening (creation + lead
  membership), membership changes, closure, and archiving. Opening and
  membership are real, already-built operations (`POST /api/projects`,
  `project_member`); closure and archiving are not yet implemented — a
  real gap flagged explicitly rather than assumed.

  Use when: "open a new project workspace", "close a project", "archive a
  project", "project membership lifecycle".
version: 1.0.0
last_reviewed: 2026-08-20
status: active
owner: process-governance-manager
prerequisites: none
metadata:
  type: process
  triggers:
    - open a new project workspace
    - close a project
    - archive a project
    - project membership lifecycle
---

## Context

Opening and membership are live, verified capabilities (Wave 5.6A):
`POST /api/projects` creates the project and automatically grants the
creator `lead` membership (deny-by-default applies to everyone, including
the creator — the grant is explicit, not implicit); `POST/DELETE
/api/projects/:id/members` manages membership with a mandatory
need-to-know basis on every grant. **Closure and archiving are not yet
implemented** — no `closed_at`/archival status exists on `md_project` as of
this skill's authoring; only `simulation_draw`'s unrelated
`retention_policy`-driven archival exists in the DB today. This is a real
scope gap, not a described-but-unbuilt convenience.

## When to Use

- Opening a new project: today, fully supported
- Managing membership through the project's active life: today, fully
  supported (`grantProjectMembership`/`revokeProjectMembership`)
- Closing or archiving a completed/abandoned project: not yet supported —
  flag as a scope gap if genuinely needed, rather than working around it
  with an ad hoc status field

## Execution Steps

1. **Open a workspace**: `POST /api/projects` with `project_no` — the
   creator becomes lead automatically, matching the deny-by-default rule
   (design §4-9-1(a))
2. **Manage membership through the project's life**: grant with an
   explicit `project_role` and mandatory `need_to_know_basis` (never
   blank); revoke when a member's need-to-know ends — both audited
3. **On project completion or abandonment (today, without built-in
   support)**: do not invent an ad hoc closure mechanism (e.g. silently
   revoking all members) — flag the closure/archival requirement to
   `platform-lead` as a genuine scope gap rather than working around it
4. **Once closure/archival lands**: this skill's Execution Steps should be
   updated to describe the real mechanism, following the same pattern as
   other Wave 5.8 skills' Adaptation Notes being resolved once their
   underlying gap closes

## Output Format

- Project workspace creation record, membership grant/revoke audit trail
- Closure/archival: not currently producible — flagged, not fabricated

## Related Skills

- `two-tier-approval-chain` — the project-role-gated approval mechanics this membership feeds
- `access-control-review` — the platform-side periodic audit of membership grants
