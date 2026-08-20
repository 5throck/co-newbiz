---
name: procedure-reference-override
scope: co-newbiz
description: >
  Implements the shared -> entity/region override model for procedures
  (ADR-0020): an entity or region procedure file references its shared
  baseline and declares only the steps it adds or replaces, never a full
  duplicate. Backs both the authoring side and the resolution side
  (`proc:resolve`, the procedure viewer's per-step source badges).

  Use when: "procedure override", "entity-specific procedure",
  "region-specific procedure", "add_steps", "replace_steps",
  "resolve a procedure".
version: 1.0.0
last_reviewed: 2026-08-20
status: active
owner: process-governance-manager
prerequisites: policy-and-procedure-governance
metadata:
  type: implementation
  triggers:
    - procedure override
    - entity-specific procedure
    - region-specific procedure
    - add_steps
    - replace_steps
    - resolve a procedure
---

## Context

A shared procedure (`procedures/_shared/<key>/schema.yaml`) is the baseline
every entity/region inherits by default. An override file
(`procedures/entities/<entity>/<key>/schema.yaml` or
`procedures/regions/<region>/<key>/schema.yaml`) never copies the shared
steps — it `references:` the shared directory and lists only its deviation
via `overrides.add_steps` / `overrides.replace_steps`. Precedence at
resolution time is shared → region → entity (`scripts/co-newbiz/proc-resolve.ts`,
wired through `GET /api/procedures/resolve` and the MCP `get_procedure` tool).

## When to Use

- An entity or region needs a procedure step this deal type doesn't apply
  generically (e.g. an entity-specific pre-approval step)
- Reviewing whether a proposed procedure change belongs in the shared
  baseline (affects everyone) or an override (affects one entity/region)
- Debugging why a resolved procedure shows an unexpected step order

## Execution Steps

1. **Default to the shared procedure** — an override is justified only when
   the deviation is genuinely entity/region-specific, not a preference that
   should just change the shared baseline for everyone
2. **Write the override file**:
   ```yaml
   references:
     - shared: ../../../_shared/<procedure-key>   # relative path to the shared dir
   overrides:
     add_steps:
       - after: <step-id>   # 0 = before the first shared step
         step: { id: ..., gate: ..., agent_key: ..., skill_key: ..., output_type: ..., description: ... }
     replace_steps:
       - id: <shared-step-id>
         step: { ... }       # the entity/region's replacement for that exact step
   ```
3. **Never restate an unchanged step** — anything not listed in `overrides`
   is inherited from the shared procedure unmodified
4. **Validate**: `bun procedures/_validate.ts` confirms the `references`
   target exists and every `overrides` entry resolves against a real shared
   step id
5. **Verify resolution**: `bun scripts/co-newbiz/newbiz.ts proc:resolve <key> --entity <e>` (or `GET /api/procedures/resolve?procedure=<key>&entity=<e>`)
   and confirm the merged result's step order and `_source` badges
   (shared/region/entity) match intent — this is exactly what the procedure
   viewer (`docs/ui-spec.md` §4) renders

## Output Format

- Override `schema.yaml` file, validated
- Resolved-procedure confirmation (step list with `_source` badges) attached
  to the change record

## Related Skills

- `policy-and-procedure-governance` — the broader authoring discipline this
  fits inside
- `deal-execution-playbook` — where the resolved procedure gets executed
