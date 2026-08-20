---
name: checklist-authoring
scope: co-newbiz
description: >
  Authors and maintains `checklists/*.yaml` — the item-by-item enforceability
  layer where each item independently declares `mandatory` and
  `waiver_eligible`. A checklist item is the right layer for a single
  binary gating fact; a multi-step process belongs in a procedure instead
  (`governance-document-hierarchy`).

  Use when: "add a checklist item", "checklist authoring", "mandatory vs
  optional checklist item", "waiver_eligible".
version: 1.0.0
last_reviewed: 2026-08-20
status: active
owner: process-governance-manager
prerequisites: governance-document-hierarchy
metadata:
  type: process
  triggers:
    - add a checklist item
    - checklist authoring
    - mandatory vs optional checklist item
    - waiver_eligible
---

## Context

Every checklist file (`checklists/*.yaml`) carries frontmatter
(`governance_doc_id`, `layer: checklist`, `title`, `scope`, `enforceability:
mixed`, `owner_agent`, `version`, `effective_from`, `gate`) plus an
`items[]` list where each item is `{ id, text, mandatory, waiver_eligible? }`.
`enforceability: mixed` at the file level is normal — the real enforceability
lives per-item, not per-file. `waiver_eligible: false` marks an item as a
completeness check with no exception path at all (e.g. the Brown Field
six-validator cross-check, `checklists/brownfield-feasibility-checklist.yaml`
item `bf-01`) — distinct from a mandatory item that *can* be waived through
`waiver-management`.

## When to Use

- A new gate needs a checklist, or an existing one needs a new item
- Deciding whether a proposed requirement belongs as a checklist item, a
  procedure step, or a guideline (→ `governance-document-hierarchy` first)
- Reviewing whether an item's `mandatory`/`waiver_eligible` combination is correct

## Execution Steps

1. **Confirm it's a single binary gating fact**, not a multi-step process
   (→ `procedure-reference-override`) and not a situational judgment call
   (→ a Guideline instead)
2. **Set the file frontmatter**: `governance_doc_id` (convention:
   `chk-<topic>`), `title`, `scope` (`shared`/entity/region), `gate` (which
   stage gate this checklist applies at), `owner_agent`
3. **Write each item**:
   - `id`: short stable slug (`bf-01`, `bf-02`, ...) — never renumber an
     existing id, since `compliance_check` rows and past waivers reference it
   - `text`: the actual gating fact, stated so pass/fail is unambiguous
   - `mandatory: true|false` — false means "recommended, not gate-blocking"
   - `waiver_eligible: false` **only** for genuine completeness checks with
     no judgment-call dimension (state explicitly why, as a YAML comment,
     per the existing convention — see `bf-01`'s comment)
4. **Validate**: `bun procedures/_validate.ts` (or the checklist-specific
   validator if separate) confirms schema completeness
5. **Route for approval** matching the item's layer per
   `docs/governance-operations.md` §2's approval-authority table — a new
   mandatory item is itself effectively a procedure amendment and should go
   through `policy-change-impact-analysis` if it affects in-flight projects

## Output Format

- New or amended `checklists/<name>.yaml`, validated
- Amendment note if items changed on an existing, in-use checklist

## Related Skills

- `governance-document-hierarchy` — layer classification (prerequisite)
- `compliance-monitoring` — the engine that reads `mandatory` items at gate time
- `waiver-management` — the exception path for `waiver_eligible: true` items
