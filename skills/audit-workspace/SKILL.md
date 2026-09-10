---
name: audit-workspace
status: active
scope: common
description: >
  Runs the workspace machine battery and interprets the results: the audit
  gate, script self-verification, template validation, and the language and
  skill-graph drift gates. The deterministic Phase-6 QA step PM runs before
  escalation or /sync.
  Use when: Phase-6 quality assurance before opening a PR; after multi-file
  changes to prove nothing regressed; when project-review Step 0 asks for the
  machine view; when a merge gate reports drift.
owner: pm
version: 0.1.0
last_reviewed: 2026-09-10
prerequisites: []
metadata:
  type: process
  triggers:
    - run the audit
    - qa gate
    - machine battery
    - pre-pr check
    - drift check
  related_skills:
    - project-review
    - ci-triage
---

# audit-workspace

Thin wrapper around the deterministic machine battery: run the validators,
read the report, and route what failed. It owns **running** the checks —
not designing fixes. `project-review` Step 0 is its superset (human review
context on top of the same battery); `ci-triage` is the single-failure
counterpart for one known cause.

## The Battery

Run from the workspace root, in this order:

```bash
bun scripts/audit.ts                    # master gate — aggregates most checks below
bun scripts/verify-scripts.ts --verify  # scripts' declared contracts still hold
bun run validate:language               # English-only documentation policy
bun run validate-skills                 # skill frontmatter + relationship integrity
bun run agent:verify                    # only after changes to agents/ or the roster
```

Template/scaffold contexts add `bun scripts/validate-templates.ts`. Variant-specific
checks live in the pluggable hook `scripts/audit-variant.ts` (present in this
workspace) and are hard failures like core ones — never advisory.

## Reading Results

- **ERROR** blocks landing. Fix before PR; a one-command fix is fixed inline,
  anything else routes to `ci-triage`.
- **WARN** is judgement, not failure — record the disposition (fixed, waived
  via the normal waiver path, or accepted with rationale) so silence is never
  read as approval.
- **Drift** between the committed `docs/skill-graph.json` and the live graph
  means the graph must be regenerated (`bun scripts/generate-skill-graph.ts`)
  in the same change that moved skills/procedures — never hand-edited.

## Escalation

- One failing check, one cause → `ci-triage`.
- ≥3 unrelated domains failing at once → `project-review` (scoped mode first).
- Security-flavored findings (gitleaks, vulnerable dependencies) → involve
  `security-engineer` before any fix lands.
