# Agent Definition Upgrade & Context SSOT Relocation — Design (2026-10-25)

- **Spec ID**: `2026-10-25-agent-and-context-ssot-upgrade`
- **Status**: Approved — user plan approval 2026-10-25 (PM session); scope extended by user mid-session directives (context SSOT relocation + log-based content refresh)
- **Author**: process-governance-manager (functional lead, acting design authority — co-newbiz has no architect agent; substitution rationale recorded here)
- **Date**: 2026-10-25
- **Prior art**: `docs/designs/2026-09-19-agent-roster-and-skills-design.md`
- **ADRs**: ADR-0074 (Design Gate), ADR-0080 (PM authority), ADR-0108 (documentation surface — placement superseded for `co-newbiz.context.md` by user decision 2026-10-25; historical text preserved)

---

## 1. Background and Problem Statement

Three defects, one initiative:

**(a) 39 of 41 agent definition files are 28–29-line stubs.** The body is only `## Role` (first sentence of the description) plus a `## Scope` section carrying an identical boilerplate line. The two complete files are `agents/pm.md` (361 lines) and `agents/i18n-specialist.md` (157 lines). Sibling co-* projects (co-export, co-consult, co-deck, …) run 151–200-line canonical agent files sharing a 9-section skeleton. `agents/README.md` declares a "Legal Basis → Role → Protocols" 3-section structure that the stubs do not honor, and its agent count (38) is stale — the actual roster is 41.

**(b) The variant context file is displaced.** The workspace template (`templates/common/docs/variant.context.template.md`) and all 15 sibling projects place the variant context at `docs/<variant>.context.md`. co-newbiz moved it to `docs/meta/co-newbiz.context.md` (folder created by commit `fe527873`, 2026-09-06, per ADR-0108; file moved by commit `48082d1c`, 2026-10-16). User decision 2026-10-25: the `docs/meta/` folder is unnecessary; the file belongs at `docs/co-newbiz.context.md`. The move also left stale references: `docs/context.md` lines 6, 9, 72, 92 still point to the old `docs/co-newbiz.context.md` path (which is about to become correct again), and three documents point to the interim `docs/meta/` path.

**(c) The context file's content has drifted.** Verified 2026-10-25: the skill count is stated as 116 (the registry is larger); the MCP live tool count is stated 29/37 (the latest `docs/architecture/mcp-integration.md` says 48); "Remaining known gaps (as of 2026-08-21)" is two months stale (the working backlog index is now `docs/planning/product-backlog-roadmap.md`); the Domain Configuration stage-gate description predates flow.spec v2.8.0 (missing S10 investment structuring (deal structuring), track-scoped S11/S12, ADR-0161/0180/0181).

## 2. Goals / Non-Goals

**Goals**

1. Rewrite the 39 stub agent files to the canonical standard (Part 1).
2. Relocate `docs/meta/co-newbiz.context.md` → `docs/co-newbiz.context.md` and dissolve `docs/meta/` (Part 2).
3. Refresh the context file's stale content from CHANGELOG, ADRs, and reports (Part 3).
4. Fix all broken references.

**Non-Goals**

- No agent renames, additions, or deletions.
- No changes to `agents/pm.md` or `agents/i18n-specialist.md` bodies.
- No `process/flow.spec.yaml` or `procedures/` changes.
- No tier value changes.
- No ADR historical-text rewrites — supersession notes go through the DEC record only.

## 3. Part 1 — Agent File Template (co-export canonical)

**Body skeleton (in order)**

1. `## Legal Basis` — lead files richer, ending with a **Boundary** paragraph naming sibling-agent ownership.
2. `## Role`.
3. `## Responsibilities` — 5–6 bold-labeled bullets tied to flow.spec activities / procedure steps.
4. `## Protocols` with four fixed H3 subsections:
   - `### ⚠️ PM-ONLY INVOCATION` — verbatim 3-step refusal script, identical in every file.
   - `### Dispatch Protocol` — Can Lead Stages / Can Support In / Auto-Dispatch To / Requires Prior Output From / Tier / Communication Style; stages sourced from `process/flow.spec.yaml`.
   - `### Output Format`.
   - `### Output Destination` — SSOT blockquote pointing to the stage outputs declared in `process/flow.spec.yaml` (ADR-0074) and the variant context `docs/co-newbiz.context.md`.
5. `## Constraints` — Do-NOT bullets with the correct redirect.
6. `## Meeting Participation` — Voice & Stance / In every turn you MUST / You do NOT.
7. `## Engagement Context` — stage entry/exit, re-engagement triggers; un-dispatched agents state their true engagement mode: procedure steps, committee seats per ADR-0097, profile ownership, or dormant build/run.
8. `## Deliverable Standards`.
9. `## Special Instructions`.

**Length bands**: 4 domain leads (process-governance-manager, platform-lead, industry-lead, region-lead) 170–200 lines; 35 specialists 140–170 lines. Reference exemplar: `/Users/techcross/git/ai_workspace/Projects/co-export/agents/fta-origin-analyst.md`.

**Frontmatter contract**

- KEEP: existing `name` / `formal_name` / `status` / `domain` / `tier` (4 platforms, values unchanged) / `model` / lifecycle block (`created` unchanged; `last_updated` → 2026-10-25; `governance` unchanged).
- BUMP: `version` → `"1.1.0"`; top-level `last_updated` → `"2026-10-25"`.
- ADD:
  - `role:` — one line.
  - `color:` — one of cyan|green|blue|red|purple|teal|yellow.
  - `description:` enriched with "Use when: …" dispatch triggers (feeds `sync-agent-personas` → `.claude/agents/`).
  - `examples:` — 1–2 `{user, assistant}` pairs.
  - `phases:` — stage ids from flow.spec, e.g. `[S1, S2, S6, S9]`.
  - `handoff_to:` / `handoff_from:` — existing non-deprecated agent names only. The four human roles (`entity-ic-reviewer`, `bau-exit-certifier`, `venture-portfolio-ic`, `execution-baseline-confirmer` per `procedures/_human-roles.yaml`) are FORBIDDEN as targets.
  - `required_skills:` — skills that exist under `skills/`, from the SKILLS.md owner mapping ∪ flow.spec activity skills. English only.

**`agents/docs-writer.md` special case**: it declares `extends: ../../../agents/docs-writer.md` (template-delivered copy). Its enriched body is wrapped in `<!-- WORKSPACE-MANAGED: ... -->` markers (pm.md pattern) so upgrades preserve it; if the stub body is found to originate in the L1/L2 template, mark `LOCAL-PATCH(upstream-request: pending)` and record the symptom for an upstream report.

**Content sources per agent**: AGENTS.md roster row; `process/flow.spec.yaml` `stages[].activities[].agent` (19 dispatched agents, S1–S12 mapping); `procedures/_shared/*/schema.yaml` `agent_key` steps; `skills/SKILLS.md` owner column; ADR-0097 committee seats (financing-agent, site-facility-agent, legal-counsel, hr-integration-agent, ir-agent, ip-agent); `docs/decisions/` DEC records.

## 4. Part 2 — Context SSOT Relocation and docs/meta/ Dissolution

1. `git mv docs/meta/co-newbiz.context.md docs/co-newbiz.context.md`.
2. Refresh its content (Part 3).
3. Dissolve the folder: relocate the docs index `docs/meta/README.md` / `README_ko.md` → `docs/README.md` / `docs/README_ko.md` (docs root has no README today; only `README.template.md` scaffolds), updating relative links and dropping the meta/ self-row; delete `docs/meta/VERSION_MANIFEST.md` (stale stub — the generator at `scripts/dev-sync.ts` step 4.7 writes `docs/VERSION_MANIFEST.md` at the root).
4. Reference fixes — retarget `docs/meta/co-newbiz.context.md` → `docs/co-newbiz.context.md` in:
   - `docs/context.md` (4 stale old-path refs at lines 6, 9, 72, 92 — these become correct once the file is back at docs root; verify each),
   - `docs/planning/product-backlog-roadmap.md:5`,
   - `docs/governance/traceability-matrix.md:5`,
   - `docs/architecture/mcp-integration.md:5`.

Historical records (`CHANGELOG.md`, `docs/reports/*`) are never edited. `library.generated.ts` is regenerated by dev-sync. ADR-0108 keeps its historical text; the placement supersession is recorded in the DEC record (finalization) and in this design.

## 5. Part 3 — Context File Content Refresh (Log-Based)

**Method**: reconcile every factual claim in `docs/co-newbiz.context.md` against, in priority order: `CHANGELOG.md` (all 801 entries — extract important unreflected changes since the file's sections were last substantively updated); the ADR index (`docs/adr/`) with emphasis on ADR-0143→0181 (flow.spec v2.5.0→v2.10.1); `docs/planning/product-backlog-roadmap.md` (working backlog index); `docs/architecture/mcp-integration.md` (live tool count); `skills/SKILLS.md` (skill count); AGENTS.md (roster counts).

**Known items to verify/fix**

- Skill count.
- MCP live tool count (37 → 48).
- "Remaining known gaps (as of 2026-08-21)" — rewrite against the current backlog index with per-item landed/open status.
- Domain Configuration stage-gates bullet — update to flow.spec v2.10.1 reality: S1–S12 with track branching (greenfield skips S6–S7, brownfield skips S5); S10 investment structuring; gates screening / pre_fs / target_screening / fs / dd / entity_ic / group_ic; four human roles.
- Investment & Valuation SSOT section — append implementation-status updates from CHANGELOG entries after 2026-10-16 (e.g. ADR-0179/0180/0181 status).

Preserve the file's existing voice and section order; add an "Updated" changelog line at the top noting the 2026-10-25 refresh.

## 6. Execution Plan (PM Gateway)

PM running on: glm-5.3-flash (session model; user-selected floor respected).

| # | Task | Agent | Tier | Model | Platform |
|---|------|-------|------|-------|----------|
| 0 | Design doc (this document) | process-governance-manager | High | glm-5.3 | zcode |
| 1 | Context relocation + meta dissolution + reference fixes + log-based content refresh | docs-writer | Medium | glm-5.3-flash | zcode |
| 2–8 | Agent batches A–G (39 files, serial) | docs-writer | Medium | glm-5.3-flash | zcode |
| 9 | Lifecycle record mirrors (39) + agents/README + README_ko refresh | docs-writer | Medium | glm-5.3-flash | zcode |
| 10 | AI 2nd cross-domain review (parallel, read-only) | process-governance-manager + platform-lead | High | glm-5.3 | zcode |
| 11 | Review fixes (max 3 iterations) | docs-writer | Medium | glm-5.3-flash | zcode |
| 12 | Finalize: DEC record, memory log, CHANGELOG, spec-register, audit suite, agents:personas + skill-graph regeneration, /sync PR | pm + docs-writer | Medium | glm-5.3-flash | zcode |

**Batch composition (39 files)**

| Batch | Files | Agents |
|---|---|---|
| A | 7 | process-governance-manager, compliance-officer, legal-counsel, risk-officer, glossary-curator, ir-agent, ip-agent |
| B | 5 | market-intelligence-agent, financial-analyst, quant-methodologist, valuation-agent, financing-agent |
| C | 4 | greenfield-agent, site-facility-agent, certification-agent, partnership-agent |
| D | 6 | brownfield-agent, antitrust-agent, hr-integration-agent, customer-retention-agent, incentive-agent, pmi-agent |
| E | 3 | commercial-dd-agent, technical-dd-agent, group-review-agent |
| F | 11 | platform-lead, design-system-agent, data-architect, dba, backend-engineer, frontend-engineer, release-engineer, sre, infra-automation-engineer, security-engineer, ux-designer-agent |
| G | 3 | industry-lead, region-lead, docs-writer |

## 7. QA Gates (Definition of Done)

1. `bun run agent:verify` · `bun run validate-agents` · `bun scripts/agent-lifecycle-audit.ts` · `bun scripts/lifecycle-sync-audit.ts` — all pass.
2. `bun run agents:personas` regeneration + `--check` drift zero; `bun scripts/generate-skill-graph.ts` regenerated.
3. `bun scripts/spec-register.ts --file docs/designs/2026-10-25-agent-and-context-ssot-upgrade-design.md --source manual --status implemented` before /sync.
4. `bun run validate:language` passes (agents/*.md English).
5. Three-stage review: AI 1st (audit scripts + docs-writer self-check) → AI 2nd (cross-domain, different domain than the author) → human final (diff review on the /sync PR).
6. Records: DEC-YYYYMMDD-NN gate decision record; `memory/2026-10-25.md` 4-section entry; CHANGELOG [Unreleased] entry with PR reference.

## 8. Risks and Mitigations

- **Identity freeze vs. procedural references.** flow.spec/procedures reference 22 agent keys by name — renames are forbidden. Human-role keys are excluded from handoff targets (closed registry `procedures/_human-roles.yaml`).
- **`docs-writer.md` extends/upgrade-overwrite risk.** WORKSPACE-MANAGED markers plus an upstream-origin check protect the template-delivered copy.
- **Reference-fix misses.** Final grep sweep for both `docs/meta/co-newbiz.context.md` and `docs/co-newbiz.context.md` path variants before /sync. Expected end state: zero `docs/meta/` references outside CHANGELOG/reports/generated snapshots.
- **Content-refresh fabrication.** Every refreshed fact must cite its source (CHANGELOG date entry, ADR id, or registry file); unverifiable items stay marked as open questions rather than asserted.
- **Language gate.** All agent/context edits are English; conversational summaries to the user remain in Korean.
