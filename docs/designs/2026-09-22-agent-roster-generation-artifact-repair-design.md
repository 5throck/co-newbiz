# Agent Roster Generation-Artifact Repair

- Spec ID: `2026-09-22-agent-roster-generation-artifact-repair`
- Date: 2026-09-22
- Status: **Implemented**
- Related: ADR-0033 (pm.md extends chains), ADR-0053/0080 (roster governance), ADR-0143 (recorded this defect class as a follow-up), `scripts/co-newbiz/sync-agent-personas.ts` (persona generator), `scripts/validate-agents.ts` (roster validator)

## Problem

The 2026-09-19 roster generation wave corrupted 39 of the 41 `agents/*.md`
definitions (all except `pm.md` and `i18n-specialist.md`). Three artifact
classes, all generation defects — no agent's semantics changed:

1. **Dangling `extends` (38 files)**: `extends: ../../../agents/<name>.md`
   resolves (from `agents/`) into the L0 workspace root's `agents/`, which
   carries only the 8 platform-base personas. The 38 co-newbiz-specific
   names have no base file anywhere, so the reference dangles. The field is
   also load-bearing in a harmful way: `validate-agents.ts` skips roster
   schema validation for any file carrying `extends`, so 38 definitions were
   never actually validated.
2. **Spilled YAML in the body (39 files)**: an indented
   `governance: docs/lifecycle/agents/<name>.md` line plus `examples: []`
   leaked out of the frontmatter into the markdown tail. The persona
   generator (`sync-agent-personas.ts`) inlines the body into the generated
   `.claude/agents/<name>.md`, so every harness dispatch embedded the
   mangled fragment.
3. **Lost `description` (39 files)**: the generator's parser requires a
   frontmatter `description:` and silently skips files without one — so the
   corrupted sources could no longer regenerate their personas at all (the
   generated copies were stale survivors of the pre-corruption generation).

## Requirements

- REQ-R1: Remove `extends:` from exactly the files whose base does not exist in the L0 root `agents/`. Keep the valid chains (`pm.md`, `docs-writer.md`) untouched.
- REQ-R2: Remove the spilled `governance:`/`examples: []` fragment lines from the body only; the frontmatter `lifecycle.governance` pointer stays.
- REQ-R3: Restore each lost `description:` from the corresponding generated `.claude/agents/<name>.md` (the last-good generation), so personas regenerate identically rather than being skipped.
- REQ-R4: Regenerate `.claude/agents/*.md`; the embedded bodies lose the garbage fragment and nothing else changes.
- REQ-R5: The roster gates pass with the extends-stub skip no longer masking the 38 files: `bun run agent:verify`, `bun scripts/validate-agents.ts` (now schema-validating all 41), `bun scripts/validate-pm-extends.ts`, and the audit's agent-sync gate.

## Design

Purely mechanical repair, one deterministic pass over `agents/*.md`
(README mirrors and `pm.md` excluded): drop the dangling `extends` line when
no L0 base exists; strip the two spilled body lines; re-insert the
`description:` line (recovered verbatim from the generated persona) after
`name:`. Then rerun the persona generator. `i18n-specialist.md` — which the
same wave left clean — is the schema exemplar the repaired files now match.
No frontmatter semantics, roster membership, dispatch routing, or
governance-record content changes; the AGENTS.md roster registry is
untouched.

## Verification

- [x] `bun run agent:verify` — 41/41 documented, 0 orphans
- [x] `bun scripts/validate-agents.ts` — 82 files checked, 0 errors (the 38 previously-skipped schemas now validate)
- [x] `bun scripts/validate-pm-extends.ts` — 3 valid chains, 0 errors
- [x] `bun scripts/co-newbiz/sync-agent-personas.ts` — 40 regenerated (body cleanup), generated tails clean
- [x] `bun scripts/audit.ts` — all gates pass (incl. agent state sync)
- [x] Full unit suite green

## Known limitations

The corruption originates in the upstream roster-generation wave; sibling
projects may carry the same artifact pattern. This repair fixes this
repository only — if a future fleet resync re-introduces the artifacts, the
upstream generator needs the same fix (recorded here for that follow-up).
