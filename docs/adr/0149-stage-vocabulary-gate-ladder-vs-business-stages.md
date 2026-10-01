# ADR-0149 — Separate the gate-ladder stage ids from the S1-S12 business stage ids

- Status: Proposed
- Date: 2026-10-01
- Deciders: Human reviewer (pending). Drafted by process-governance-manager (Row 2). AI review alone cannot accept this ADR.
- Design of record: `docs/designs/2026-10-01-s1-s12-process-alignment-design.md` (finding F2)
- Related: ADR-0074 (process meta-model), ADR-0083 (DEG stage export)

> **Needs human approval. No rename happens in this PR.** This record only proposes the change.

## Context

Two files use the same ids for different things:

- `process/stages.yaml` defines S1-S8 as a gate ladder: Screening, Target Screening, Pre-FS, FS, DD, Entity IC, Group IC, Post-Close.
- `process/flow.spec.yaml` defines S1-S12 as business stages.

So one id has two meanings. For example, S3 is "Pre-FS" in the gate ladder and a different business stage in the flow spec. S3 in `stages.yaml` also has `owner_agent: TODO`.

Consumers that depend on the gate ids: `process/stage-aliases.yaml` (maps `gate:` values onto the DEG Stage axis, ADR-0083), `procedures/_validate.ts` (closed-registry check in both directions), `tests/unit/stage-aliases-registry.test.ts`, and the DEG stage export.

## Options

| Option | Change | Pros | Cons |
|---|---|---|---|
| A. Rename gate ladder to G1-G8 | `stages.yaml` ids become G1-G8. Alias targets, validator and test use the G prefix. | One meaning per id. Small diff. | May break the DEG export if it expects `S` ids. Needs an ADR-0083 amendment or mapping. |
| B. Add `axis: gate`, keep S1-S8 | Docs say "gate-stage S3". | No id migration. | Collision stays in data, URLs and logs. |
| C. Rename business stages to B1-B12 | Flow spec ids change. | DEG export unchanged. | Large blast radius: `/deals/[id]/[stage]` routes, `lib/process-flow.ts`, DB rows, docs. |
| D. Use gate slugs as ids (`screening`, `pre_fs`, ...) | `stages.yaml` ids become slugs. | Self-describing; match `gate:` values and `gateIds`. | Loses ordinal sort; needs a `sequence` field and an ADR-0083 amendment. |

## Decision (proposed)

Option A: rename the gate ladder ids to G1-G8. It removes the collision with the smallest blast radius. Before the rename, confirm that the DEG export contract under ADR-0083 accepts the G prefix, or add an explicit G-to-DEG mapping.

## Consequences

- `process/stage-aliases.yaml`: every alias target changes from S1-S8 to G1-G8. Alias keys (`gate:` values) stay the same.
- `procedures/_validate.ts`: the closed-registry check must expect G-prefixed ids in both directions. Any hard-coded `S` prefix pattern for the gate axis changes.
- `tests/unit/stage-aliases-registry.test.ts`: expected ids change to G1-G8. Add a test that no id appears in both `stages.yaml` and `flow.spec.yaml`.
- DEG export (ADR-0083): needs an amendment or a mapping so external consumers keep working. This is the main risk.
- S3 (G3 after rename) must get a real `owner_agent` instead of `TODO`.
- Acceptance: no id string resolves to two stage meanings across `process/**`, `lib/process-flow.ts` and generated docs; validator and test pass.
- Follow-up PR owner: process-governance-manager with backend-engineer for validator and test changes. That PR lands only after a person accepts this ADR.
