---
name: community-partnership-planning
scope: co-newbiz
description: >
  Plans local-community engagement for a Green Field site — workforce-
  development partnerships (vocational schools, training programs),
  community-relations considerations that affect permit timelines and
  social-license-to-operate risk, distinct from the regulatory permit path
  itself.

  Use when: "community partnership", "local workforce development",
  "community relations", "social license to operate".
version: 1.1.0
last_reviewed: 2026-08-23
status: active
owner: hr-integration-agent
prerequisites: none
metadata:
  type: domain
  triggers:
    - community partnership
    - local workforce development
    - community relations
    - social license to operate

  procedure_keys:
    - greenfield-dd
---

## Context

A permit-pathway approval (`permit-pathway-mapping`) is necessary but not
sufficient — community opposition can delay or derail a project even where
every regulatory box is checked. This skill covers the relationship-
building side: workforce-development partnerships that also help solve
`talent-pipeline-planning`'s labor-supply question, and community-relations
risk that a purely regulatory DD checklist would miss.

## When to Use

- A Green Field site candidate has entered Pre-FS or FS and community
  engagement planning is due
- Assessing whether local opposition is a material risk to the timeline

## Execution Steps

1. **Identify local workforce-development partners**: vocational schools,
   community colleges, existing training programs whose graduates match
   the project's required skill categories — feeds `talent-pipeline-planning`
   directly rather than duplicating that labor-supply analysis
2. **Assess community-relations risk**: prior local reaction to similar
   industrial development, known opposition groups, environmental or
   land-use sensitivities specific to the candidate site
3. **Identify local-government relationship touchpoints**: which local
   officials/agencies matter for both the partnership plan and the permit
   timeline (coordinate with `permit-pathway-mapping`, do not duplicate its
   critical-path analysis)
4. **Draft an engagement plan**: informational sessions, partnership MOUs,
   community-benefit commitments where warranted — proportionate to the
   assessed risk level, not a boilerplate checklist regardless of context
5. **Flag material opposition risk explicitly** to the feasibility gate —
   this is a qualitative risk input to `greenfield-feasibility`'s decision,
   not something the RAG framework's quantitative dimensions capture on their own

## Output Format

- Community-engagement plan: workforce-partnership candidates,
  community-relations risk assessment, engagement plan, opposition-risk flag

## Related Skills

- `talent-pipeline-planning` — the labor-supply question this partly feeds
- `permit-pathway-mapping` — the regulatory counterpart to community risk
- `greenfield-feasibility` — the gate this risk assessment feeds
