# Project Documentation

Index of `docs/` — the governance documents, engineering specifications, and
operational records of the co-newbiz system. Files are organized into topic
subfolders; four files with code dependencies stay at the `docs/` top level
(`context.md`, `phase-definitions.md`, `process-flow.md`,
`skill-graph.{md,json,overrides.json}` — see the note at the bottom).
For project identity and standards start at
[`context.md`](../context.md); variant-specific configuration lives in
[`co-newbiz.context.md`](co-newbiz.context.md).

## Topic Folders

| Folder | Contents |
|--------|----------|
| [`meta/`](../meta/) | This index, version manifest, variant context |
| [`architecture/`](../architecture/) | Engineering contracts — SRS, API spec, OpenAPI, DB schema, UI spec, MCP integration |
| [`governance/`](../governance/) | Process and governance operations — process map, RACI, RAG framework, ops cadence, traceability |
| [`security/`](../security/) | Security model, baseline, and policy |
| [`design/`](../design-system/) | Design guide and the design philosophy/tokens/components/screens/accessibility pages |
| [`dd/`](../dd/) | Due-diligence methodology — overview, domain guides, findings rules, waivers, valuation bridge, best practices |
| [`planning/`](../planning/) | Dev plan, transition plan, web implementation plan, pilot research |
| [`guidelines/`](../guidelines/) | Recommended-tier practice guides — expert interviews, proxy-chain hop classification |
| [`adr/`](../adr/) | Architecture Decision Records — index in `adr/README.md`, mirrored into [memory/MEMORY.md](../../memory/MEMORY.md) |
| [`audits/`](../audits/) | Readiness and compliance audit reports |
| [`decisions/`](../decisions/) | Dated decision records (threshold approvals, vocabularies, agenda packs) |
| [`designs/`](../designs/) | Design documents of record for major work rounds |
| [`lifecycle/`](../lifecycle/) | Agent/skill/script governance records (one per agent under `agents/`) |
| [`manuals/`](../manuals/) | Three-audience user guides — business / admin / operations — each with a Korean counterpart (`*_ko.md`) |
| [`pilots/`](../pilots/) | Real-case manual pilot records that validated the procedures |
| [`research/`](../research/) | Sourced external research inputs |
| [`runbooks/`](../runbooks/) | Operational runbooks (deployment, backup/restore) |

## Highlights by Topic

- **Identity & standards** — [`context.md`](../context.md),
  [`co-newbiz.context.md`](co-newbiz.context.md),
  [`VERSION_MANIFEST.md`](VERSION_MANIFEST.md)
- **Contracts** — [`architecture/srs.md`](../architecture/srs.md),
  [`architecture/api-spec.md`](../architecture/api-spec.md),
  [`architecture/openapi.yaml`](../architecture/openapi.yaml),
  [`architecture/db-schema.md`](../architecture/db-schema.md),
  [`architecture/ui-spec.md`](../architecture/ui-spec.md),
  [`architecture/mcp-integration.md`](../architecture/mcp-integration.md)
- **Governance** — [`governance/process-map.md`](../governance/process-map.md),
  [`governance/raci.md`](../governance/raci.md),
  [`governance/rag-framework.md`](../governance/rag-framework.md),
  [`governance/governance-operations.md`](../governance/governance-operations.md),
  [`governance/ops-cadence.md`](../governance/ops-cadence.md),
  [`governance/traceability-matrix.md`](../governance/traceability-matrix.md)
- **Security** — [`security/security-model.md`](../security/security-model.md),
  [`security/security-baseline.md`](../security/security-baseline.md),
  [`security/security.md`](../security/security.md)
- **Design** — [`design/design-guide.md`](../design-system/design-guide.md) plus the
  philosophy/tokens/components/screens/accessibility pages in the same folder
- **Due diligence** — the seven pages under [`dd/`](../dd/), starting from
  [`dd/dd-overview.md`](../dd/dd-overview.md)

## Top-Level Files (code dependencies — do not move)

| File | Why it stays at `docs/` top level |
|------|-----------------------------------|
| [`context.md`](../context.md) | `scripts/verify-scripts.ts` `findWorkspaceRoot()` uses its existence as a root marker |
| [`phase-definitions.md`](../phase-definitions.md) | `scripts/team-builder.ts` `updateWorkflowDocs()` writes to this exact path |
| [`process-flow.md`](../process-flow.md) | Read/written by `scripts/co-newbiz/generate-process-flow.ts` and `app/web-next/lib/process-flow.ts` |
| [`skill-graph.md`](../skill-graph.md) / [`.json`](../skill-graph.json) / [`.overrides.json`](../skill-graph.overrides.json) | Read/written by `scripts/generate-skill-graph.ts`, `scripts/verify-skill-graph.ts`, and the `/sync` pipeline |

## Architecture Decision Records (ADRs)

ADRs document significant decisions with Context / Decision / Consequences.
The authoritative index is [`adr/README.md`](../adr/README.md).

### Lifecycle

| Status | Meaning |
|--------|---------|
| Proposed | Under consideration |
| Accepted | Current approach |
| Deprecated | No longer recommended |
| Superseded | Replaced by a newer ADR |

New ADRs follow `scripts/co-newbiz/adr-new.ts` (numbering sequence and
trigger list per design §7); see the `adr-governance` skill.
