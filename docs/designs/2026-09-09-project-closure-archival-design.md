# Wave B1 — Project closure / archival

Date: 2026-09-09
Status: implemented in Wave B branch

## Problem
Projects can be killed by a gate decision, but there is no operator-controlled lifecycle state for routine closure or archival. As a result, completed/retired projects can still appear in deal pipeline and portfolio rollup views.

## Decision
Add lifecycle columns to `md_project`:

- `status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','archived'))`
- `closed_at TEXT NULL`
- `closure_reason TEXT NULL`

`KILL` remains a derived gate verdict from `gate_decision`; `closed` / `archived` are explicit administrative lifecycle states. A project can therefore be killed-but-open while decision follow-up is pending, then closed once learnings and documents are captured.

## API and mutation
`closeProject()` is the single repository mutation. `PATCH /api/projects/{id}/close` calls it after deny-by-default visibility and lead-role checks.

Body:

```json
{ "status": "closed", "closure_reason": "IC rejected; learnings captured" }
```

`status` may be `closed` or `archived`. The mutation is idempotent for already-closed/archived projects and records an audit event.

## Read behavior
Default project list and single-project visibility return open projects only. Callers can opt into closed rows with `includeClosed`. Pipeline and portfolio aggregate helpers join `md_project` and filter `status='open'`.

## Out of scope
Re-opening projects, legal-record retention workflows, and archive cold-storage moves are deferred.
