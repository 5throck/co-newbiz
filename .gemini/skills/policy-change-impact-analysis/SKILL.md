---
name: policy-change-impact-analysis
scope: co-newbiz
description: >
  Runs the mandatory impact-analysis step of the Policy Change -> System
  Reflection Pipeline (`docs/governance-operations.md` §5, ADR-0021) before
  any Policy/Procedure amendment ships: identifies every `procedure`,
  `rag_rule`, `assumption`, checklist, and glossary term reference the
  change touches, and decides retroactivity for in-flight projects via
  `project_policy_pin` rather than applying the change silently.

  Use when: "policy impact analysis", "procedure amendment impact",
  "does this affect in-flight projects", "project_policy_pin",
  "retroactivity decision".
version: 1.0.0
last_reviewed: 2026-08-20
status: active
owner: process-governance-manager
prerequisites: policy-and-procedure-governance
metadata:
  type: process
  triggers:
    - policy impact analysis
    - procedure amendment impact
    - does this affect in-flight projects
    - project_policy_pin
    - retroactivity decision
---

## Context

CLAUDE.md's lifecycle table is explicit: any change under `policies/**` or
`procedures/**` requires "policy impact analysis; check `project_policy_pin`
for in-flight projects; ADR required." This skill is that analysis step —
skipping it is exactly how a regulation and the system that's supposed to
enforce it drift apart (design's stated Problem #9, the reason Stage 2
precedes Stage 5 at all, ADR-0032).

## When to Use

- Before any `policies/**` or `procedures/**` change is merged
- Before a `rag_rule` threshold or `glossary/**` term definition changes in
  a way that could shift a project's grade or interpretation retroactively

## Execution Steps

1. **Identify every reference surface the change touches**:
   - `procedures/*/schema.yaml` — does a step's `agent_key`/`skill_key`/
     `output_type` need to change, or a new step added?
   - `rag_rule` rows — does a threshold or `condition_expr` need updating?
   - `assumption` registry — does a `kind`/`ttl` convention change?
   - `checklists/*.yaml` — does an item's `mandatory`/`waiver_eligible` flag change?
   - `glossary/*.yaml` — does a term's `definition_ko` need revision?
2. **Enumerate in-flight projects** currently pinned to the prior version
   (`project_policy_pin`) — never assume none exist
3. **Draft the change plan** — `process-governance-manager` drafts, PM approves
4. **Make the retroactivity decision explicitly**, recorded as a
   `policy_change` decision (never applied silently):
   - Non-material change → in-flight projects stay pinned to their current version
   - Material change → force an explicit re-evaluation, with the project
     lead notified before it happens, not after
5. **System reflection**: apply the update to every surface identified in
   step 1 — a change that touches `rag_rule` but not the matching
   `glossary` term (or vice versa) is an incomplete reflection, not a
   partial success
6. **Notify affected project owners** — the pipeline's last step, never skipped

## Output Format

- Impact-analysis record: touched surfaces (procedure/rag_rule/assumption/
  checklist/glossary), in-flight project list, retroactivity decision with
  rationale
- Feeds the `adr-governance` ADR this change almost certainly requires

## Related Skills

- `adr-governance` — the ADR this analysis typically triggers
- `regulation-monitoring` — the external trigger that often starts this analysis
- `policy-and-procedure-governance` — where the actual amendment gets authored
