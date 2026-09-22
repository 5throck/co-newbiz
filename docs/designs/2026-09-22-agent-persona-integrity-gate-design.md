# Agent Persona Integrity Gate (validate-agents)

- Spec ID: `2026-09-22-agent-persona-integrity-gate`
- Date: 2026-09-22
- Status: **Implemented**
- Related: ADR-0033 (pm.md extends chains), ADR-0080 (agent lifecycle authority), design `2026-09-22-agent-roster-generation-artifact-repair` (the repair this gate guards)

## Problem

The 2026-09-19 roster-generation wave corrupted 39 agent definitions in three
ways (dangling `extends`, frontmatter fragments spilled into the body, lost
`description`). Nothing in the toolchain rejected the artifacts — they landed,
silently degraded every harness dispatch, and froze persona regeneration. A
one-off bulk commit produced the corruption; no upstream generator script
exists to fix, so the durable control is a validation gate at the roster
validator, deployed at both copies (L0 workspace root + this project, kept
byte-identical per the script-drift check).

## Requirements

- REQ-G1: `validate-agents.ts` fails when an `extends:` chain does not resolve to an existing base file, resolved from the defining file's own directory.
- REQ-G2: `validate-agents.ts` fails when the known spilled-frontmatter shapes appear in the markdown body (indented `governance: docs/lifecycle/…` lines and bare `examples: []` lines).
- REQ-G3: `validate-agents.ts` fails when a self-contained definition (no `extends`, or dangling `extends`) lacks a frontmatter `description:`; a resolving extends-stub (ADR-0033) yields a warning instead — the stub inherits the description from its base.
- REQ-G4: The gate runs in every validator invocation (both L0 root and L1 project contexts) and reports through the existing fail/warn channel.

## Design

New `validatePersonaIntegrity()` in `scripts/validate-agents.ts` (v1.3.0),
called from `main()` after the schema sweep. Raw-content checks only — no
dependency on the L0-only schema-validator import, so the gate also runs in
L1/L3 copies. Version bumped 1.2.1 → 1.3.0; `scripts/SCRIPTS.md` row updated;
L0 copy kept byte-identical.

## Verification

- [x] Clean roster: `bun scripts/validate-agents.ts` → 0 errors, 0 warnings (co-newbiz 41 agents; L0 root 8 agents)
- [x] Negative fixture (dangling extends + body spill + no description) → `extends-dangling`, `body-frontmatter-spill`, `description-missing` all fire
- [x] Resolving-stub fixture class: description-missing downgrades to warning (ADR-0033 stubs)
- [x] Full unit suite + audit green in co-newbiz; L0 validator green at the workspace root
