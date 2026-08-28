---
name: agent-output-provenance
scope: co-newbiz
description: >
  Stamps every agent-produced deliverable with its producing agent, a
  confidence grade, and a human-review record before it counts as complete
  — `docs/process-map.md`'s `analysis_task.reviewed_by` field is the
  concrete mechanism referenced (a NULL value blocks Entity IC). As of
  2026-08-28 the write/UI path is implemented: `GET/POST
  /api/projects/:id/analysis-tasks` (lazy-creates the required deliverables
  at Entity IC/Group IC) and `POST
  /api/projects/:id/analysis-tasks/:taskId/review` (the only write path
  for `reviewed_by`, human-final sign-off) plus the "Review Status" tab
  (`ReviewStatusTab.tsx`). The kill-criteria check
  (`db/lib/snapshot-filler.ts`) now reflects real review state instead of
  the previous permanently-empty table.

  Use when: "agent output provenance", "confidence grade on a deliverable",
  "reviewed_by tracking", "AI-produced vs human-confirmed distinction".
version: 1.2.0
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
deliverable` as a blocking condition. The `analysis_task` table exists
(`db/migrations/0011_dd_finding_and_remaining_tables.sql`) and the
kill-criteria engine reads it (`db/lib/snapshot-filler.ts`). **The write
path is now implemented**: `app/web-next/app/api/projects/[id]/analysis-tasks/route.ts`
(GET lazy-creates the required deliverable rows — `ic_memo`,
`rag_assessment` — the first time a project reaches `entity_ic`/`group_ic`)
and `app/web-next/app/api/projects/[id]/analysis-tasks/[taskId]/review/route.ts`
(the sole write path for `reviewed_by` — sets it to the calling user,
refuses a second sign-off). `ReviewStatusTab.tsx` (the "Review Status" tab) renders
pending vs. reviewed deliverables and lets an analyst+ record sign-off.
The kill-criteria check now reflects real review state.

## Design Intent

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

- When a project reaches Entity IC / Group IC: the required deliverables
  (`ic_memo`, `rag_assessment`) are lazy-created as `analysis_task` rows on
  the first `GET /api/projects/:id/analysis-tasks` call; a human reviewer
  signs off each one via the "Review Status" tab (or `POST
  .../analysis-tasks/:taskId/review` directly) before the gate can pass
- When recording the 3-stage review (`review_stage`): apply this
  discipline explicitly at each stage — note the producing agent/domain,
  the unverified-items list (even if empty, never omitted), and the result
  — via `POST /api/projects/:id/review-stages`
- Sampling AI-review reliability for the governance KPI (design §6.6):
  `POST /api/projects/:id/review-audit-samples` against an `ai_2nd` stage

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
