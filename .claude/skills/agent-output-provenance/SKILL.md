---
name: agent-output-provenance
scope: co-newbiz
description: >
  Stamps every agent-produced deliverable with its producing agent, a
  confidence grade, and a human-review record before it counts as complete
  — `docs/process-map.md`'s `analysis_task.reviewed_by` field is the
  concrete mechanism referenced (a NULL value blocks Entity IC). The
  `analysis_task` table exists (`db/migrations/0011_dd_finding_and_remaining_tables.sql`)
  and its `reviewed_by IS NULL` count is already read by the kill-criteria
  engine (`db/lib/snapshot-filler.ts`), but no code path writes rows into it
  — the table is permanently empty and the kill-criteria check is
  vacuously true (zero unreviewed rows because zero rows exist at all,
  not because review happened). This is the real, explicitly flagged gap:
  the write/UI path, not the schema.

  Use when: "agent output provenance", "confidence grade on a deliverable",
  "reviewed_by tracking", "AI-produced vs human-confirmed distinction".
version: 1.1.0
last_reviewed: 2026-08-28
status: active
owner: process-governance-manager
prerequisites:
  - deal-execution-playbook
metadata:
  type: process
  triggers:
    - agent output provenance
    - confidence grade on a deliverable
    - reviewed_by tracking
    - AI-produced vs human-confirmed distinction
---

## Context

**Adaptation note (updated 2026-08-28, see design doc §20.4)**: `docs/process-map.md`'s
Entity IC gate row names `analysis_task.reviewed_by NULL on any required
deliverable` as a blocking condition — this is the concrete DB mechanism the
design intends, and the `analysis_task` table itself DOES exist
(`db/migrations/0011_dd_finding_and_remaining_tables.sql`, columns `id,
project_id, deliverable_type, reviewed_by, reviewed_at`). The kill-criteria
engine already reads it (`db/lib/snapshot-filler.ts` computes `COUNT(*)
WHERE project_id=? AND reviewed_by IS NULL`). **What is genuinely missing is
the write path**: no repository, API route, or UI anywhere inserts a row
into `analysis_task` or sets `reviewed_by`. The table is permanently empty,
so the kill-criteria check currently passes vacuously (zero rows match, not
because deliverables were reviewed) — it is not a claim that provenance
tracking is currently enforced in the running system. This skill documents
the discipline the write/UI path must implement, following the same
"documents before code" principle as `market-data-pipeline` and
`industry-profile-application`'s own honest gaps.

## Design Intent (for the eventual implementation)

Every agent-produced deliverable carries: which agent produced it, a
confidence grade the agent itself assigns (reflecting how much of the work
was `derived`/`assumed` vs. `user`-confirmed per `assumption-audit`'s
tagging discipline), and a `reviewed_by` field that stays NULL until a
human reviewer confirms it — this is the DB-level enforcement of the
design's non-negotiable rule that gate approval and the investment decision
belong to humans, not agents (design's non-negotiable boundary #2). No
"PASS" stamp anywhere: output is split verified / could-not-verify /
needs-judgement, and an AI reviewer must explicitly declare what it could
not check.

## When to Use

- Today: when reviewing any agent-produced deliverable, apply this
  discipline manually — note the producing agent, note what could and
  could not be verified, and get explicit human confirmation before
  treating the deliverable as gate-ready. Do not rely on the
  `analysis_task.reviewed_by IS NULL` kill-criteria check alone — it is
  vacuously true until the write path exists (see Context above)
- Once the write/UI path is implemented: automatically, via the
  `analysis_task` table (schema already in place)

## Execution Steps

1. **Stamp every deliverable with its producing agent** — not anonymous output
2. **Split findings into verified / could-not-verify / needs-judgement**
   — never a blanket "complete" or "PASS" label
3. **Require explicit human confirmation** before a deliverable counts as
   gate-ready — `reviewed_by` (once the table exists) or an equivalent
   explicit sign-off recorded today
4. **Never let silence read as approval** — an unreviewed deliverable is
   incomplete, not implicitly accepted

## Output Format

- Deliverable with producing-agent stamp, verified/could-not-verify/
  needs-judgement split, human-review confirmation

## Related Skills

- `deal-execution-playbook` — the gate context this provenance gates entry into
- `assumption-audit` — the confidence-grade tagging this draws on
