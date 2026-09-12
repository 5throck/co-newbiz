---
name: deal-workspace-operations
scope: co-newbiz
description: >
  Operates a project's workspace lifecycle: opening (creation + lead
  membership), membership changes, closure, and archiving. Opening and
  membership are real, already-built operations (`POST /api/projects`,
  `project_member`); closure and archiving are real Wave B1 operations backed by
  `PATCH /api/projects/:id/close` and `md_project.status`.

  Use when: "open a new project workspace", "close a project", "archive a
  project", "project membership lifecycle".
version: 1.1.0
last_reviewed: 2026-09-09
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

Opening and membership are live, verified capabilities. `POST /api/projects`
creates the project and grants the creator `lead` membership; membership grants
and revocations stay in the access-control layer with mandatory need-to-know
basis. Wave B1 adds explicit lifecycle closure/archival: `md_project.status` is
`open|closed|archived`, with `closed_at` and `closure_reason`. This state is
operator-controlled and distinct from a derived KILL gate verdict.

## When to Use

- Opening a new project workspace
- Managing project membership through the active lifecycle
- Closing a completed/abandoned project after decisions, learnings, and reports
  are captured
- Archiving a project that should stay queryable only through explicit
  include-closed/archive views

## Execution Steps

1. **Open a workspace**: create/promote the project and ensure the lead
   membership is present.
2. **Manage membership through the project's life**: grant with explicit
   `project_role` and non-empty `need_to_know_basis`; revoke when need-to-know
   ends.
3. **Distinguish KILL from closure**: a KILL gate is a decision outcome in
   `gate_decision`; closure/archival is a workspace lifecycle state recorded
   only after closeout work is complete.
4. **Close/archive**: call `PATCH /api/projects/:id/close` as project lead with
   `closure_reason` and optional `status` (`closed` default, `archived` for
   archival). The repository mutation writes audit and completes active project
   pipeline runs.
5. **Check aggregates**: closed/archived projects are excluded from default
   project lists, pipeline funnel/aging, and portfolio scorecard rollups.

## Output Format

- Project workspace creation record, membership grant/revoke audit trail
- Closure/archival audit record (`project_closed` or `project_archived`) plus `md_project.closed_at`/`closure_reason`

## Related Skills

- `two-tier-approval-chain` — the project-role-gated approval mechanics this membership feeds
- `access-control-review` — the platform-side periodic audit of membership grants
