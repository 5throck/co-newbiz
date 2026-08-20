---
name: policy-and-procedure-governance
scope: co-newbiz
description: >
  Drafts and maintains Policy- and Procedure-layer governance documents —
  the two mandatory-enforceability layers (`governance-document-hierarchy`).
  Covers the group policy / entity addendum structure and the shared/
  entity/region procedure model, keeping every document's frontmatter,
  approval routing, and cross-references consistent.

  Use when: "draft a policy", "draft a procedure", "entity addendum",
  "amend the group policy", "new procedure".
version: 1.0.0
last_reviewed: 2026-08-20
status: active
owner: process-governance-manager
prerequisites: governance-document-hierarchy
metadata:
  type: process
  triggers:
    - draft a policy
    - draft a procedure
    - entity addendum
    - amend the group policy
    - new procedure
---

## Context

Every Policy document extends `policies/group/neb-policy.md` (mandatory
requirements, Group IC review axes, Kill Criteria) via an entity addendum
(`policies/entities/<entity>/addendum.md`) that declares only its
deviations — never a full re-statement. Every Procedure document is either
`scope: shared` (`procedures/_shared/<key>/schema.yaml`) or an entity/region
override (`procedures/entities/<entity>/<key>/schema.yaml`) that
`references:` the shared procedure and lists only its `overrides` (design
§6.3, ADR-0020).

## When to Use

- Drafting or amending the group policy or an entity addendum
- Drafting a new shared procedure or an entity/region override
- Reviewing a draft for frontmatter completeness and correct cross-referencing

## Execution Steps

1. **Confirm the layer** via `governance-document-hierarchy` first
2. **For a Policy document**:
   - Frontmatter: `governance_doc_id`, `layer: policy`, `scope`
     (`group`/`entity`), `entity_id` (if entity-scoped), `level`,
     `enforceability`, `owner_agent`, `approver_role`, `effective_from`,
     `review_cycle_months`
   - An entity addendum states only what differs from the group policy —
     `Extends: policies/group/neb-policy.md` at the top, deviations below
3. **For a Procedure document**:
   - Shared: `procedure_id`, `scope: shared`, `level`, `gate`, `steps[]`
     (`id`, `gate`, `agent_key`, `skill_key`, `output_type`, `description`) —
     structured, not prose (dispatch code reads this list directly)
   - Override: `references: [{shared: <relative-path-to-shared-dir>}]` plus
     an `overrides` block (`add_steps`/`replace_steps`) listing only the
     entity/region's actual deviations
4. **Validate**: run `bun procedures/_validate.ts` — catches a missing
   `references` target, a malformed override, or a `steps[]` entry
   referencing a nonexistent `agent_key`/`skill_key`
5. **Route for approval**: Policy amendments require Group IC approval
   (per `policies/group/neb-policy.md` §5); Procedure amendments require
   `process-governance-manager` sign-off, escalating to PM for cross-domain
   impact
6. **Check the ADR trigger list** (`adr-governance`) — most Policy/Procedure
   amendments qualify

## Output Format

- New or amended Policy/Procedure document, frontmatter-complete, passing
  `procedures/_validate.ts`
- A one-paragraph amendment rationale for the governance change log

## Related Skills

- `governance-document-hierarchy` — layer classification (prerequisite)
- `procedure-reference-override` — the shared/entity/region override
  mechanics in depth
- `policy-change-impact-analysis` — required before an amendment ships
- `adr-governance` — ADR requirement check
