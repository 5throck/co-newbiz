# ADR-0149 — Separate the gate-ladder stage ids from the S1-S12 business stage ids

- Status: Accepted (2026-10-02)
- Date: 2026-10-01
- Deciders: Accepted by the human reviewer in chat on 2026-10-02 (Option A). Drafted by process-governance-manager (Row 2). AI review alone cannot accept this ADR.
- Design of record: `docs/designs/2026-10-01-s1-s12-process-alignment-design.md` (finding F2)
- Related: ADR-0074 (process meta-model), ADR-0083 (DEG stage export)

> **Accepted by the human reviewer on 2026-10-02 (Option A).** The recorded decisions additionally assign G3's `owner_agent` as `pm` (consistent with flow.spec Pre-FS ownership: route-strategy/deal-shape activities) and adopt an explicit G-to-DEG mapping at the export surface so external DEG consumers keep reading the legacy `stage.co-newbiz.S<n>` ids (see Consequences).

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

## Decision (accepted, 2026-10-02)

Option A: rename the gate ladder ids to G1-G8. It removes the collision with the smallest blast radius. Recorded alongside the acceptance: the DEG export keeps external ids unchanged via an explicit G-to-DEG mapping at the export surface (below), and G3's `owner_agent` is `pm`.

## Consequences

- `process/stage-aliases.yaml`: every alias target changes from S1-S8 to G1-G8. Alias keys (`gate:` values) stay the same.
- `procedures/_validate.ts`: the closed-registry check must expect G-prefixed ids in both directions. Any hard-coded `S` prefix pattern for the gate axis changes.
- `tests/unit/stage-aliases-registry.test.ts`: expected ids change to G1-G8. Add a test that no id appears in both `stages.yaml` and `flow.spec.yaml`.
- DEG export (ADR-0083): resolved by an explicit G-to-DEG mapping at the export surface — the graph generator maps internal gate ids G1-G8 to the legacy DEG stage ids (`stage.co-newbiz.S1`...`stage.co-newbiz.S8`) when emitting stage nodes and edges, so external DEG consumers keep reading the legacy S-prefixed ids and nothing downstream breaks. The map is removed only if ADR-0083 is later amended to accept G ids on the wire.
- S3 (G3 after rename) gets `owner_agent: pm` (recorded decision, 2026-10-02), replacing `TODO`.
- Acceptance: no id string resolves to two stage meanings across `process/**`, `lib/process-flow.ts` and generated docs; validator and test pass.
- Follow-up PR owner: process-governance-manager with backend-engineer for validator and test changes. That PR lands only after a person accepts this ADR.
