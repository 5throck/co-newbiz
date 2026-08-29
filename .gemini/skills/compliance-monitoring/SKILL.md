---
name: compliance-monitoring
scope: co-newbiz
description: >
  Runs the system-enforced gate-blocking check (every mandatory deliverable
  and checklist item present, or an active waiver covers the gap) and owns
  the governance KPI set that drives amendment priority. Absorbs the
  training/notice follow-up step and KPI reporting — neither has a
  standalone product distinct from a compliance-check result
  (`docs/governance-operations.md` §1/§4, design §9.2's merge decision).

  Use when: "compliance check", "is this gate blocked", "governance KPI",
  "gate cycle time", "checklist completion rate", "waiver concentration".
version: 1.1.0
last_reviewed: 2026-08-23
status: active
owner: compliance-officer
prerequisites: none
metadata:
  type: process
  triggers:
    - compliance check
    - is this gate blocked
    - governance KPI
    - gate cycle time
    - checklist completion rate
    - waiver concentration

  procedure_keys:
    - brownfield-dd
relates_to:
  - skill: stage-gate-governance
    type: follows
  - skill: technical-due-diligence
    type: composes_with
  - skill: legal-due-diligence
    type: composes_with
  - skill: management-incentive-review
    type: composes_with
  - skill: customer-attrition-risk
    type: composes_with
  - skill: incentive-clawback-assessment
    type: composes_with
  - skill: debt-and-contingent-liability-simulation
    type: composes_with
  - skill: financing-plan-review
    type: composes_with

---

## Context

At every stage gate this is a system-enforced check, not a discretionary
review (`db/lib/compliance.ts`'s `checkGate()`, `compliance_check` table,
`GET /api/projects/:id/compliance-checks`): every required deliverable per
`procedures/*/schema.yaml`'s `steps[].output_type` is present, and every
`mandatory: true` checklist item is complete. A gate blocks if either check
fails **and there is no active waiver** covering the specific gap
(`findActiveWaiver()`).

## When to Use

- At every stage gate, before the gate is considered passable
- Monthly governance-KPI review (`docs/ops-cadence.md`)
- Deciding whether a repeated gap pattern is a training/notice issue (log
  and address directly — no separate skill needed for this) or a signal the
  underlying regulation doesn't match reality (→ amendment priority)

## Execution Steps

1. **Run the gate check**: `checkGate()` against the project's current gate
   — missing deliverable or incomplete mandatory checklist item, each
   individually checked against `findActiveWaiver()` before counting as a block
2. **If blocked and no waiver applies**: the gap is either addressed
   directly (produce the missing deliverable, complete the checklist item)
   or routed to `waiver-management` if a genuine exception is warranted —
   never silently overridden
3. **If a gap recurs across multiple projects/gates on the same clause**:
   log it, and note that this is the signal the regulation itself doesn't
   match reality — not evidence of repeated non-compliance by project teams.
   This becomes an input to the KPI review below, not a punitive finding
   against any one project
4. **Governance KPI review** (monthly): pull gate cycle time (median, per
   gate), gate rejection rate, checklist completion rate, waiver volume and
   concentration by clause, rework rate, and interpretation query volume/topic
5. **Feed amendment priority**: waiver concentration and interpretation-query
   topics are the *primary* inputs to the next regulation amendment cycle
   (design §6.6) — not intuition. Route a concentration finding to
   `policy-change-impact-analysis`

## Output Format

- Per-gate compliance-check result: pass/blocked, blocking gaps, applicable waivers
- Monthly governance-KPI report: the six metrics above, with a waiver-
  concentration and interpretation-topic section flagged for the next
  amendment cycle

## Related Skills

- `waiver-management` — the exception path this check defers to
- `interpretation-registry` — the query-volume source for one KPI
- `policy-change-impact-analysis` — where a concentration/topic finding routes
- `stage-gate-governance` — the gate sequence this check runs at
