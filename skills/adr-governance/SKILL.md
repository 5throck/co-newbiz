---
name: adr-governance
scope: co-newbiz
description: >
  Checks a proposed change against the design v1.0 §7 ADR trigger list and,
  if it matches, drafts the ADR before the change proceeds — not after the
  fact. Maintains `docs/adr/README.md`'s index and the local numbering
  sequence (co-newbiz's own, distinct from the workspace's ADR numbering).

  Use when: "does this need an ADR", "ADR trigger list", "draft an ADR",
  "architecture decision record".
version: 1.0.0
last_reviewed: 2026-08-20
status: active
owner: process-governance-manager
prerequisites: none
metadata:
  type: process
  triggers:
    - does this need an ADR
    - ADR trigger list
    - draft an ADR
    - architecture decision record
---

## Context

`docs/adr/README.md`'s trigger list (design §7) names 14 categories of
change that require an ADR **before proceeding, not as optional
documentation after the fact**: DB schema breaking changes, master-data
code-system changes, unit-conversion methodology changes, RAG rule/threshold
changes, Stage Gate/Kill Criteria changes, policy/procedure amendments,
region-profile required-axis changes, notification policy changes, external
data source changes, DB engine/portability exceptions, auth/permission model
changes, MCP tool scope expansion, team structure/agent promotion,
deployment/rollback strategy changes. 44 ADRs already exist (0001-0044,
all Accepted) — a new decision in any of these categories either amends one
of them (referencing the ADR it supersedes) or adds a new numbered entry.

## When to Use

- Before any change matching one of the 14 trigger categories proceeds
- Deciding whether a change supersedes an existing ADR or needs a new one
- Reviewing a PR that touches DB schema, RAG rules, auth, or MCP tool scope
  without an accompanying ADR

## Execution Steps

1. **Check the change against the 14-category trigger list** — if it
   matches any category, an ADR is required, full stop
2. **Search existing ADRs** (`docs/adr/README.md`'s index) for one the new
   decision supersedes — an amendment references the ADR it replaces rather
   than silently contradicting it
3. **Draft using the workspace format**: `# ADR-NNNN` / Status / Date /
   Deciders / Context / Decision / Consequences — local sequence starting
   at 0001 (co-newbiz's own numbering, separate from the workspace root's)
4. **Set Status**: `Proposed` until the relevant approver signs off
   (Group IC for policy/Kill-Criteria changes, `process-governance-manager`
   +PM for most others per the trigger category), then `Accepted`
5. **Update `docs/adr/README.md`'s index table** with the new/amended entry
6. **Cross-link**: the ADR should reference the `policy-change-impact-analysis`
   record (if applicable) and vice versa — an ADR and an impact analysis for
   the same change are companion artifacts, not duplicates

## Output Format

- New or amended ADR file in `docs/adr/`
- Updated `docs/adr/README.md` index

## Related Skills

- `policy-change-impact-analysis` — the analysis this ADR often documents the decision from
- `governance-document-hierarchy` — a different (document-layer, not decision-record) classification concern
