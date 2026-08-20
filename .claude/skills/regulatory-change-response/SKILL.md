---
name: regulatory-change-response
scope: co-newbiz
description: >
  Executes a response plan when a regulation is enacted or amended before
  it takes effect — proactive positioning ahead of a known effective date,
  distinct from `statute-change-monitoring`'s reactive per-project
  confirmation and `regulation-monitoring`'s detection function. Handles
  the "we know this is coming" case.

  Use when: "upcoming regulation change", "pre-effective-date response",
  "regulatory change response plan".
version: 1.0.0
last_reviewed: 2026-08-20
status: active
owner: legal-counsel
prerequisites:
  - regulation-monitoring
metadata:
  type: domain
  triggers:
    - upcoming regulation change
    - pre-effective-date response
    - regulatory change response plan
---

## Context

Three related skills, three distinct questions: `regulation-monitoring`
detects a change across the whole portfolio; `statute-change-monitoring`
confirms a specific project's earlier finding still holds;
`regulatory-change-response` is what happens once a change is detected
with a known future effective date and the team needs to actually prepare
for it — permit/certification requirements that will shift, projects whose
timelines cross the effective date, or a Green Field site decision that
should account for a regulation not yet in force.

## When to Use

- `regulation-monitoring` detects an enacted-but-not-yet-effective change
- Any active project's timeline crosses a known regulatory effective date

## Execution Steps

1. **Confirm the effective date and transition provisions** — some
   regulations grandfather existing operations, others don't; the
   distinction changes the response entirely
2. **Identify every active/prospective project the change touches** —
   cross-reference against `permit-pathway-mapping`/`certification-roadmap`
   findings that assumed the pre-change rule
3. **For a project closing/launching before the effective date**: confirm
   whether grandfathering applies, and if not, whether the post-change
   requirement is achievable in time
4. **For a project closing/launching after the effective date**: build the
   post-change requirement into the current feasibility work directly,
   rather than treating it as a future problem
5. **Update `industry-lead`/`region-lead` guidance** if the change is
   significant enough to affect how future deals in that industry/region
   should be screened by default

## Output Format

- Response plan: affected projects, grandfathering determination,
  timeline/feasibility impact per project

## Related Skills

- `regulation-monitoring` — the detection this responds to
- `statute-change-monitoring` — the reactive per-project confirmation counterpart
- `permit-pathway-mapping`, `certification-roadmap` — findings this may need to update
