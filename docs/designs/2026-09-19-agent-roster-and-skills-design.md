---
lang: ko
lang_reason: source-material
---

# Agent Roster and Skills Materialization

- Spec ID: `2026-09-19-agent-roster-and-skills`
- Date: 2026-09-19
- Status: **Proposed**
- Spec Exemption: E5 (sync-only — repository hygiene, no behavioral code changes)

## Summary

15 agent definition files and 10+1 skill directories referenced by
`process/flow.spec.yaml` are materialized. These files are organizational
roster entries — no behavioral code is changed. The existing test suite drops
from 4-5 failing files to 2 (both pre-existing environmental: buildGraphMap
graft indexing, price evidence search provider).

## Changes

- `agents/*.md`: 15 files with role descriptions from AGENTS.md roster table
- `skills/*/SKILL.md`: 10 skill directories with SKILL.md stubs
- `skills/forward-industry-research/SKILL.md`: 1 additional (procedures reference)
- `skills/value-chain-driver-identification/SKILL.md`: 1 additional
- `skills/target-costing-analysis/SKILL.md`: 1 additional

## Registration

Spec registered via `bun scripts/spec-register.ts`.
