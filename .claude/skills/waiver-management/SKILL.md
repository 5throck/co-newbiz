---
name: waiver-management
scope: co-newbiz
description: >
  Files, approves, and monitors governance waivers — the explicit, logged
  exception path whose absence would push non-compliance underground.
  Every waiver has a mandatory expiry (ADR-0036); the six-validator Brown
  Field cross-check has no waiver path at all (it is a completeness check,
  not a judgment call). Backed by `db/lib/compliance.ts` and
  `POST/GET /api/projects/:id/waivers`.

  Use when: "file a waiver", "waiver request", "approve a waiver",
  "waiver expiry", "waiver concentration".
version: 1.0.0
last_reviewed: 2026-08-20
status: active
owner: compliance-officer
prerequisites: none
metadata:
  procedure_keys:
    - brownfield-dd
  type: process
  triggers:
    - file a waiver
    - waiver request
    - approve a waiver
    - waiver expiry
    - waiver concentration
---

## Context

A waiver unblocks a `compliance-monitoring` gate check only when ALL of:
`status='active'`, `approved_at` is set, and `expires_at` is strictly in the
future — the expiry date is authoritative even if a status column goes
stale (ADR-0036). `issueWaiver()` refuses to create one without `expiresAt`
at the engine level, not just as a documented convention. **Approval
authority differs by layer**: regulation-layer waiver → Group IC;
procedure-layer waiver → `process-governance-manager`; checklist-item waiver
→ the relevant domain lead. The six-validator Brown Field cross-check
(design §8.9-1(f)) has **no** waiver path, full stop.

## When to Use

- A gate is blocked on a genuine, justified exception (not a shortcut)
- Reviewing a waiver request for approval
- Monitoring waiver concentration by clause (feeds `compliance-monitoring`'s KPI review)

## Execution Steps

1. **Confirm it's not a completeness check** — the six-validator Brown Field
   cross-check and any similarly-flagged `waiver_eligible: false` checklist
   item cannot be waived, only actually completed
2. **File the request**: `governance_doc_id`, `clause_ref`, `reason`,
   `requested_by`, `approver_role`, and a mandatory `expires_at` —
   `POST /api/projects/:id/waivers` (or `issueWaiver()` directly), status
   lands `pending` unless approved at filing time
3. **Route to the correct approver** by layer (regulation → Group IC;
   procedure → `process-governance-manager`; checklist item → domain lead)
4. **Approve or reject**: approval sets `approved_by`/`approved_at`,
   flipping status to `active`; a rejected request stays `pending` and
   expires unused (no separate rejection state needed — the gate stays
   blocked either way)
5. **Monitor concentration**: `waiverConcentration()` flags ≥3 (default
   threshold) waivers on the same `governance_doc_id`+`clause_ref` pair —
   report this to `compliance-monitoring`'s KPI review as an amendment
   signal, **never** as a compliance failure; each individual waiver was valid
6. **Let expiry do its job** — do not manually revoke an active waiver
   before its `expires_at` unless the underlying justification itself
   becomes invalid; the date is the enforcement mechanism

## Output Format

- Waiver record (governance doc, clause, reason, approver, expiry, status)
- Concentration report entry when a clause crosses the threshold

## Related Skills

- `compliance-monitoring` — the gate check a waiver unblocks
- `policy-change-impact-analysis` — where a concentration signal routes
- `checklist-authoring` — sets each checklist item's `waiver_eligible` flag
