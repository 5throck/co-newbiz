# ADR-0073: Adopt the skill relationship graph and the 0–7 lifecycle phase system

**Status**: Accepted — implementation landed in the same change (precedent: ADR-0069/0070 landed Proposed, accepted after verification). Partly superseded on 2026-08-29: the three generator adaptations in Decision (b) were upstreamed into the canonical L0 generator (workspace ADR-0060 Amendment 7, v1.8.3); this project now tracks the canonical copy — see the reconciliation note at the end of this ADR.
**Date**: 2026-08-29
**Deciders**: user (standing directive), process-governance-manager (workstream), docs-writer (phase definitions)
**Design of record**: `docs/phase-definitions.md` (phase system); workspace ADR-0060 + Amendments 1–3 and `templates/common/scripts/generate-skill-graph.ts` (graph machinery, canonical layer)

> Naming note: this project's local ADR-0060 (kill-criteria executability classification) is unrelated to the workspace-level ADR-0060 (skill relationship graph, `ai_workspace` root) referenced here. The two numbering sequences are independent by `docs/adr/README.md`'s convention.

## Context

co-newbiz was the only active project missing the ai_workspace skill-graph feature (workspace ADR-0060): every sibling (co-consult, co-deck, co-price, co-abap, co-safety) generated and committed a `docs/skill-graph.json` projection with a sync-time drift gate. Separately, the variant's six stage gates existed only inside procedure schemas and prose — no document mapped skills to lifecycle stages, and nothing answered "which skills run at which gate" without reading every `procedures/**/schema.yaml`. The workspace convention for the latter is a `docs/phase-definitions.md` following the standard 0–6 table (`templates/common/docs/phase-definitions.md`), with `variant.json` `skill_manifest.variant_specific[].phases` producing `phase` edges in the graph.

Porting exposed two structural facts about the canonical machinery when it runs inside a scaffolded project rather than at the workspace root:

1. **Run-context detection**: the generator tags local assets L0 if a `templates/` directory exists. co-newbiz legitimately ships in-project content templates (`templates/deliverables/`), which mis-tagged all 224 nodes L0 — every other scaffolded project (no `templates/` at all) tags L3.
2. **Manifest source never fires in-project**: Source 3 (`variant.json` → `used_by`/`phase` edges) iterates workspace-root `templates/co-*` directories only. A scaffolded project's own `variant.json` — present here and load-bearing (context marker for `audit.ts`, Tier-3 detection) — was never read. Result: every existing project graph, including co-consult's, had zero `phase` edges. A third, smaller instance of the same class: the L0 agent discovery counts `agents/README.md`/`README_ko.md` as agent nodes (the canonical root has no such files; this project does).

Phase semantics also required a decision: the standard table fixes phases 5–6 as PM-owned finalization/QA and leaves 1–4 for variant-defined work. co-newbiz's deal flow has **six** business stations (Screening, Pre-FS, FS, DD, Entity/Group IC, post-close) — they do not fit four variant-defined phases without merging the human IC approval boundary into an execution phase.

## Decision

**(a) Adopt the skill relationship graph** (workspace ADR-0060 machinery). `scripts/generate-skill-graph.ts` (project copy, 1.7.1 → 1.8.2) and `scripts/verify-skill-graph.ts` (1.5.0) from `templates/common/scripts/`; artifacts `docs/skill-graph.{json,md}` + `docs/skill-graph.overrides.json` seed committed; `/sync` Step 4.65 gate added to `dev-sync.ts` (1.5.5 → 1.6.0) before VERSION_MANIFEST generation.

**(b) Three recorded local adaptations of the generator copy** (each documented inline; re-apply when re-copying upstream):

- L0/L3 run-context detection keys on `templates/common` (platform template layer) instead of `templates/` — `templates/deliverables/` is content, not platform.
- Source 3b: in a project context, also read the project-local `variant.json` skill_manifest, emitting the same `used_by`/`phase` edges the workspace-root loop emits for template variants.
- L0 agent discovery excludes `README*` (and `_`-prefixed) files.

**(c) Lifecycle phase system 0–7** (`docs/phase-definitions.md`), a deliberate, recorded deviation from the standard 0–6 table: phases 1–6 map one-to-one onto the six gates (Screening → Pre-FS → FS → DD → Entity/Group IC → post-close), phase 0 is intake, and standard phases 5–6 (lifecycle finalization, QA) merge into phase 7. Rationale: compressing six gates into standard phases 1–4 would blur the human IC approval boundary — the three-stage review's human-final gate — into an execution step. Follows the co-consult precedent of variant-customized phase tables; `phases:` integers are opaque labels resolved only through `docs/phase-definitions.md`.

**(d) Phase and relation data is derived, not hand-assigned**: all 51 manifest entries (42 original + 9 procedure-backfill skills: certification-roadmap, compensation-harmonization-analysis, executive-presentation, financial-statement-analysis, historical-financial-analysis, insight-synthesis, peer-benchmarking, proxy-industry-chain, unit-conversion-calibration) carry `phases:` arrays generated from each procedure step's `gate:` + `skill_key`. Agents' `required_skills:` frontmatter (all 34) derives from procedure `agent_key → skill_key` pairs, manifest `used_by_agents`, and role-curated assignments for build/run agents; skills' typed `relates_to:` (`follows`) derives from consecutive-step adjacency within each procedure. The graph remains advisory (ADR-0060): `procedures/*.yaml` stays authoritative for dispatch order.

**(e) YAML hygiene prerequisite**: agent frontmatter carrying unquoted colons in prose values (`role: Database operations: backup/restore, ...`) falls out of strict YAML parsing into the generator's legacy single-line fallback, which silently cannot read `required_skills` arrays — this stranded `dba` and `glossary-curator` as isolated nodes. Offending values are now quoted. Agent files that are not strict-YAML-parseable are treated as drift going forward.

## Consequences

- Graph grew 403 → 661 edges (references 365, phase 71, used_by 117, follows 70, requires 38); nodes 224 → 222 (README over-count removed); zero isolated agents. Skills remain 116.
- `/sync` now halts on graph drift — a procedure, manifest, or agent-frontmatter change without regeneration blocks the pipeline at Step 4.65.
- Phase numbering is co-newbiz-specific: cross-variant phase comparison requires each project's `docs/phase-definitions.md`. This is accepted (the integers were always variant-defined labels); the cost is borne by humans reading two phase docs, not by the machinery.
- The nine backfill manifest entries close the procedure-vs-manifest divergence left by the 2026-08-25 graph-pilot dispatch wiring (CHANGELOG 2026-08-25) — every `skill_key` dispatched by a procedure now has a manifest entry, so every dispatched skill carries phase edges.
- The three local adaptations mean this project's generator copy intentionally diverges from `templates/common`; upstream updates must be re-ported, not blind-copied (same maintenance rule as any project-local script fork).

## Cross-references

`docs/phase-definitions.md` · `docs/skill-graph.md` · `variant.json` skill_manifest · `procedures/**/schema.yaml` (`gate:` fields — the phase SSOT) · `scripts/generate-skill-graph.ts` (1.8.2) · `scripts/dev-sync.ts` Step 4.65 · workspace ADR-0060 + Amendments 1–3 (`ai_workspace` root) · local ADR-0060 (unrelated, kill-criteria) · ADR-0028 (Entity IC approval chain — the phase-5 human gate)

## Reconciliation note (2026-08-29)

The three generator adaptations in Decision (b) were upstreamed into the
canonical workspace generator as v1.8.3 (workspace ADR-0060 Amendment 7;
`ai_workspace` PR #766): `templates/common`-keyed L0/L3 detection, project-local
`variant.json` Source 3b, and `README*`/`_` exclusion in agent discovery. This
project's `scripts/generate-skill-graph.ts` was replaced with the L0 copy
(logic diff 0) and `docs/skill-graph.{json,md}` regenerated and verified
(223 nodes / 661 edges; manifest edges preserved). The fork-maintenance rule in
Consequences ("upstream updates must be re-ported, not blind-copied") is retired
for the generator — it is once again a canonical-layer copy.
