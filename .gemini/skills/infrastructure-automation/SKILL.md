---
name: infrastructure-automation
scope: co-newbiz
description: >
  Automates deployment, environment provisioning, and operational
  scripting for the co-newbiz stack (Bun/Hono API, SQLite, React SPA,
  Python computational layer) — the broader automation practice
  `batch-scheduling-operations` and `deployment-and-release`'s specific
  disciplines sit within.

  Use when: "infrastructure automation", "environment provisioning",
  "deployment scripting", "operational tooling".
version: 1.0.0
last_reviewed: 2026-08-20
status: active
owner: infra-automation-engineer
prerequisites: none
metadata:
  type: implementation
  triggers:
    - infrastructure automation
    - environment provisioning
    - deployment scripting
    - operational tooling
---

## Context

Every automation script this skill produces should compose with the
system's existing operational disciplines, not bypass them:
`deployment-and-release`'s backup-before-migration requirement,
`batch-scheduling-operations`'s OS-level scheduler rule,
`database-operations`'s recovery-drill cadence. An automation script that
technically "gets the job done" but skips one of these disciplines
(e.g. a deploy script that migrates without a preceding backup) introduces
exactly the risk those disciplines exist to prevent.

## When to Use

- Automating a repeated manual operational task
- Environment setup/provisioning for a new deployment target
- Reviewing an existing automation script for compliance with operational disciplines

## Execution Steps

1. **Identify the manual process being automated** and its existing
   discipline requirements (backup timing, sign-off gates, scheduling
   convention) — automate the discipline, not just the mechanical steps
2. **Write the automation as a TypeScript script** (`scripts/co-newbiz/*.ts`
   or workspace convention equivalent) — matching the project's existing
   tooling language, not introducing a new scripting language for convenience
3. **Confirm the automated version still enforces every manual-process
   gate**: a backup step that was manual and enforced by human discipline
   must still run automatically, not silently disappear because "the
   script is fast enough now"
4. **Test in a non-production environment first** — infrastructure
   automation errors tend to be higher-blast-radius than application code errors
5. **Document the automation's operational role** so it's discoverable by
   the relevant domain skill (e.g. a new backup script should be
   referenced from `database-operations`, not exist as an undocumented tool)

## Output Format

- Automation script with documented operational role, non-production test confirmation

## Related Skills

- `deployment-and-release`, `database-operations`, `batch-scheduling-operations` — the specific disciplines this automation must preserve
