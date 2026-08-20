---
name: agent-output-provenance
scope: co-newbiz
description: >
  Stamps every agent-produced deliverable with its producing agent, a
  confidence grade, and a human-review record before it counts as complete
  — `docs/process-map.md`'s `analysis_task.reviewed_by` field is the
  concrete mechanism referenced (a NULL value blocks Entity IC). As of this
  skill's authoring, the `analysis_task` table itself has not been migrated
  — this is a real, explicitly flagged gap in the current DB schema.

  Use when: "agent output provenance", "confidence grade on a deliverable",
  "reviewed_by tracking", "AI-produced vs human-confirmed distinction".
version: 1.0.0
last_reviewed: 2026-08-20
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

**Adaptation note**: `docs/process-map.md`'s Entity IC gate row names
`analysis_task.reviewed_by NULL on any required deliverable` as a blocking
condition — this is the concrete DB mechanism the design intends, but the
`analysis_task` table has not yet been created in any migration as of this
skill's authoring. This skill documents the discipline the eventual table
must implement, following the same "documents before code" principle as
`market-data-pipeline` and `industry-profile-application`'s own honest gaps
— it is not a claim that provenance tracking is currently enforced in the
running system.

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
  treating the deliverable as gate-ready
- Once implemented: automatically, via the `analysis_task` table

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
