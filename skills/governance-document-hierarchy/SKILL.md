---
name: governance-document-hierarchy
scope: co-newbiz
description: >
  Determines which governance layer (Policy/Procedure/Guideline/Checklist/
  Template) a proposed document belongs to, and which enforceability rule
  applies as a result. Prevents the layer-conflation failure where a
  recommendation gets written with mandatory-clause phrasing, or a hard
  requirement gets buried in a guideline nobody has to follow.

  Use when: "which governance layer", "policy vs procedure vs guideline",
  "governance document hierarchy", "is this mandatory or recommended",
  "new governance document".
version: 1.0.0
last_reviewed: 2026-08-20
status: active
owner: process-governance-manager
prerequisites: none
metadata:
  type: process
  triggers:
    - governance document hierarchy
    - policy vs procedure
    - governance layer
    - is this mandatory
    - new governance document
---

## Context

ADR-0035 fixes five governance layers, each with a distinct enforceability
rule (`docs/governance-operations.md` §7):

| Layer | Enforceability | Example |
|---|---|---|
| Policy | Mandatory | `policies/group/neb-policy.md` |
| Procedure | Mandatory | `procedures/_shared/brownfield-screening/` |
| Guideline | Recommended | `guidelines/*` |
| Checklist | Item-by-item (`mandatory: true\|false`) | `checklists/*` |
| Template | Recommended | `templates/deliverables/*` |

A document with the wrong layer either over-constrains (a genuinely
situational judgment call written as a Policy clause, blocking every future
deal that doesn't fit it exactly) or under-constrains (a hard requirement
written as a Guideline, silently skippable). Both failure modes are worse
than picking correctly up front.

## When to Use

- Before authoring any new governance artifact
- When reviewing a draft that mixes mandatory and recommended language
- When a checklist item is proposed and its `mandatory` flag needs deciding

## Execution Steps

1. **Ask what happens on violation**: is a deal blocked at gate (→ Policy or
   Procedure), or is it a best-practice deviation a reviewer should flag but
   can override with judgment (→ Guideline)?
2. **Ask whether it's a single binary fact or a multi-step process**: a
   single yes/no gating fact belongs in a checklist item; a sequence of
   agent/skill/output steps belongs in a procedure (`procedure-reference-override`
   territory, not this skill).
3. **Ask whether it needs per-entity/per-region variation**: if yes, the
   Policy/Procedure lives at `scope: shared` with entity/region-layer
   overrides (see `procedure-reference-override`), never duplicated in full
   per entity.
4. **Set frontmatter accordingly**: `layer`, `enforceability`
   (`mandatory`/`recommended`/`mixed`), `owner_agent`, `approver_role` —
   matching the fields already present in every governance doc in this repo
   (e.g. `policies/entities/ent-a/addendum.md`'s frontmatter block).
5. **Route for approval per the correct approver**: Policy/Procedure changes
   require the ADR trigger list check (`adr-governance`) before proceeding.

## Output Format

- A layer classification decision (Policy / Procedure / Guideline /
  Checklist / Template) with the enforceability rule and owner, recorded in
  the draft document's frontmatter — not a separate report

## Related Skills

- `policy-and-procedure-governance` — authoring within the Policy/Procedure layers
- `checklist-authoring` — the checklist layer specifically
- `adr-governance` — whether the change also needs an ADR
