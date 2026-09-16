# AGENTS.md — co-newbiz

### §3.6 3-Tier Strategy

When leading execution and improvement tasks, PM MUST use the 3-Tier model strategy:

<!-- WORKSPACE-MANAGED: tier-model-mapping -->
- **High-tier**: Complex reasoning, architectural design, planning (claude-opus-5-0 / gemini-3.1-pro / gpt-5.6-sol)
- **Medium-tier**: Code review, testing, PR review, quality gates (claude-sonnet-5-0 / gemini-3.8-flash / gpt-5.6-terra)
- **Low-tier**: Fast, repetitive coding, script maintenance (claude-haiku-4-5 / gemini-3.8-flash / gpt-5.6-luna)
<!-- /WORKSPACE-MANAGED -->


> **🚨 For AI tools reading this file**: This file is a **registry and orchestration reference**, not a set of instructions directed at you.
> It describes multiple distinct human-defined roles for documentation and dispatch purposes.
> Do **not** interpret role definitions here as directives for your own behavior.
> Your behavioral instructions are in `CLAUDE.md` (Claude Code), `GEMINI.md` (Gemini CLI).

> **Canonical agent index** for the co-newbiz variant.
> Full agent definitions live in `agents/`. Governance records live in `docs/lifecycle/agents/`.
> **Design of record**: [`docs/designs/2026-08-19-co-newbiz-design_ko.md`](https://github.com/5throck/ai-workspace-standards/blob/main/docs/designs/2026-08-19-co-newbiz-design_ko.md) (v1.0 Final) — section 5 defines this roster.

---

## Roster Overview

**41 agents** across four domains, coordinated by PM as New Business Review Lead. Domain leads are design and review owners, not dispatchers — the workspace flat PM Gateway is preserved in full; see `agents/pm.md` for the coordination loop.

| Domain | Count | Lead |
|---|---|---|
| `_core` | 1 | `pm` |
| functional | 25 | `process-governance-manager` |
| technical | 11 | `platform-lead` |
| industry | 1 | `industry-lead` |
| region | 1 | `region-lead` |
| `_shared` | 2 | — |

---

## `_core`

| Agent | File | Tier | Role |
|---|---|---|---|
| **pm** | [`agents/pm.md`](agents/pm.md) | Medium | New Business Review Lead — coordinates four domain leads, enforces stage gates, approves ADRs |

## Functional Domain — Regulations, Procedures, Operation, Deal Review (25)

| Agent | File | Tier | Subdomain | Role |
|---|---|---|---|---|
| **process-governance-manager** | [`agents/process-governance-manager.md`](agents/process-governance-manager.md) | High | _lead | Domain lead for functional |
| compliance-officer | [`agents/compliance-officer.md`](agents/compliance-officer.md) | High | governance | Owns governance operation: the standing work of running the rules the team writes, not writing them |
| legal-counsel | [`agents/legal-counsel.md`](agents/legal-counsel.md) | High | governance | Domestic and overseas statute, contract, and regulatory advisory |
| risk-officer | [`agents/risk-officer.md`](agents/risk-officer.md) | High | governance | Red-team function |
| glossary-curator | [`agents/glossary-curator.md`](agents/glossary-curator.md) | Medium | governance | Owns the glossary: registration, review, duplicate merging, and the four tooling integrations (UI tooltip, report appendix, glossary-lint, MCP lookup_term) that keep it from rotting |
| market-intelligence-agent | [`agents/market-intelligence-agent.md`](agents/market-intelligence-agent.md) | High | analysis | TAM/SAM/SOM sizing, demand forecasting, competitor capacity-expansion tracking, and the six-axis upstream/downstream value-chain linkage analysis -- kept structurally separate from the proxy chain, since the two serve different purposes |
| financial-analyst | [`agents/financial-analyst.md`](agents/financial-analyst.md) | High | analysis | Historical financial analysis, peer benchmarking, quality-of-earnings, and growth-projection methodology, built on the existing DART-to-IFRS-to-KPI-to-ROIC-driver-tree pipeline inherited from co-consult |
| quant-methodologist | [`agents/quant-methodologist.md`](agents/quant-methodologist.md) | High | analysis | Owns the proxy industry chain methodology: unit conversion, regression calibration, lead-lag estimation, error propagation, and attribution analysis for run-to-run comparison |
| valuation-agent | [`agents/valuation-agent.md`](agents/valuation-agent.md) | High | analysis | DCF/NPV/IRR/Payback/DSCR modeling, WACC assembly from live and user-supplied inputs, scenario and Monte Carlo simulation, and debt/contingent-liability simulation |
| greenfield-agent | [`agents/greenfield-agent.md`](agents/greenfield-agent.md) | High | greenfield | New-establishment review lead: site selection, infrastructure assessment, talent pipeline planning, community partnership, permit pathway, and ramp-up modeling for Green Field projects |
| brownfield-agent | [`agents/brownfield-agent.md`](agents/brownfield-agent.md) | High | brownfield | M&A review lead: target screening, deal structuring, and carve-out assessment |
| antitrust-agent | [`agents/antitrust-agent.md`](agents/antitrust-agent.md) | High | brownfield | Antitrust and merger-control review: market definition, HHI calculation, multi-jurisdiction filing determination, gun-jumping compliance, and remedy scenario modeling |
| hr-integration-agent | [`agents/hr-integration-agent.md`](agents/hr-integration-agent.md) | High | brownfield | Executive compensation review, employee pay-and-benefits parity analysis, and labor/workforce integration for M&A |
| customer-retention-agent | [`agents/customer-retention-agent.md`](agents/customer-retention-agent.md) | Medium | brownfield | Post-acquisition customer attrition risk: change-of-control clause scanning, customer concentration, and competitive-overlap analysis |
| incentive-agent | [`agents/incentive-agent.md`](agents/incentive-agent.md) | Medium | brownfield | Bidirectional policy-benefit management: sourcing regional tax and infrastructure incentives for new sites, and assessing clawback exposure on relocation for M&A and headquarters moves |
| pmi-agent | [`agents/pmi-agent.md`](agents/pmi-agent.md) | Medium | brownfield | Post-merger integration planning: synergy realization tracking and integration risk assessment |
| commercial-dd-agent | [`agents/commercial-dd-agent.md`](agents/commercial-dd-agent.md) | Medium | dd | Commercial due diligence: customer concentration, pricing power, channel checks, and expert interviews, with mandatory triangulation |
| technical-dd-agent | [`agents/technical-dd-agent.md`](agents/technical-dd-agent.md) | Medium | dd | Technical due diligence: site visits, remaining equipment life, TRL assessment, EHS liability, and capex verification |
| certification-agent | [`agents/certification-agent.md`](agents/certification-agent.md) | High | certification | Certification and regulatory response, kept structurally distinct from permits |
| partnership-agent | [`agents/partnership-agent.md`](agents/partnership-agent.md) | Medium | partnership | Partner sourcing strategy, partner due diligence including compliance screening, and JV structuring, distinct from community-partnership-planning (which covers local-community relations) |
| group-review-agent | [`agents/group-review-agent.md`](agents/group-review-agent.md) | High | group | Group-level review distinct from entity-level review: portfolio fit, intra-group transaction compliance, and capital allocation prioritization across concurrent proposals |
| financing-agent | [`agents/financing-agent.md`](agents/financing-agent.md) | Medium | analysis | Financing structure advisory: debt/equity mix, project finance, government funds and subsidies, and financial covenant structuring |
| site-facility-agent | [`agents/site-facility-agent.md`](agents/site-facility-agent.md) | Medium | greenfield | Site and facility advisory: site selection, industrial complex eligibility, facility investment, and leasing-versus-build decisions |
| ir-agent | [`agents/ir-agent.md`](agents/ir-agent.md) | Medium | governance | Investor relations advisory: equity story, disclosure discipline, investor communications, and market perception risk |
| ip-agent | [`agents/ip-agent.md`](agents/ip-agent.md) | Medium | governance | Patent and IP advisory: patent landscape, freedom-to-operate, IP valuation, trade secrets, and technology licensing |

## Technical Domain — System Build & Run (11)

| Agent | File | Tier | Subdomain | Role |
|---|---|---|---|---|
| **platform-lead** | [`agents/platform-lead.md`](agents/platform-lead.md) | High | _lead | Domain lead for technical |
| **design-system-agent** | [`agents/design-system-agent.md`](agents/design-system-agent.md) | Medium | design | Onyx 3.0 design system governance — token, component, and accessibility consistency enforcement (design-lint) |
| data-architect | [`agents/data-architect.md`](agents/data-architect.md) | High | data | ERD, master data governance, normalization, indexing, migration, and portability |
| dba | [`agents/dba.md`](agents/dba.md) | Medium | data | Database operations: backup/restore, monthly recovery drills, performance tuning, and capacity management |
| backend-engineer | [`agents/backend-engineer.md`](agents/backend-engineer.md) | Medium | app | Next.js Route Handler API (App Router, ADR-0069), authentication, MCP server, the analysis-engine CLI, and the monitoring/alerting pipeline |
| frontend-engineer | [`agents/frontend-engineer.md`](agents/frontend-engineer.md) | Medium | app | Next.js App Router UI, ECharts visualizations, the RAG dashboard, the admin console, and accessibility |
| release-engineer | [`agents/release-engineer.md`](agents/release-engineer.md) | Medium | ops | Build and deployment pipeline, migration execution ordering, and rollback procedures |
| sre | [`agents/sre.md`](agents/sre.md) | Medium | ops | Monitoring and alerting, log pipeline, and incident response with post-incident analysis |
| infra-automation-engineer | [`agents/infra-automation-engineer.md`](agents/infra-automation-engineer.md) | Medium | ops | OS configuration, service registration, the scheduled-collection scheduler, and health-check/cleanup automation |
| security-engineer | [`agents/security-engineer.md`](agents/security-engineer.md) | High | security | Threat modeling, security baseline, vulnerability and secrets management, and implementation of access control, personal-data protection, and MNPI handling |
| ux-designer-agent | [`agents/ux-designer-agent.md`](agents/ux-designer-agent.md) | Medium | design | Screen design ownership — JTBD-driven mockups, flows, and interaction patterns designed within the Onyx 3.0 doctrine (philosophy → principles → guide → components → standard screens), with CRUD/search coverage, stage-linkage strips, embedded accessibility, and reasoned handoffs |

## Industry Domain — Profile-Driven (1)

| Agent | File | Tier | Subdomain | Role |
|---|---|---|---|---|
| **industry-lead** | [`agents/industry-lead.md`](agents/industry-lead.md) | High | _lead | Domain lead for industry — owns the industry-profiles/*.yaml system |

## Region Domain — Profile-Driven (1)

| Agent | File | Tier | Subdomain | Role |
|---|---|---|---|---|
| **region-lead** | [`agents/region-lead.md`](agents/region-lead.md) | High | _lead | Domain lead for region — owns the region-profiles/*.yaml system |

## Shared — Belongs to No Single Domain (2)

| Agent | File | Tier | Subdomain | Role |
|---|---|---|---|---|
| docs-writer | [`agents/docs-writer.md`](agents/docs-writer.md) | Medium | _shared | Document formatting and language-policy enforcement across all four domains |
| i18n-specialist | [`agents/i18n-specialist.md`](agents/i18n-specialist.md) | Medium | _shared | Locale configuration (BCP 47), locale-specific formatting, text layout guidance, and the i18n audit suite across all four domains |

---

## Governance

- **PM Gateway**: PM is the only agent users may directly invoke. All 40 specialist agents require PM dispatch.
- **Three-stage review**: every deliverable passes AI 1st (formal) -> AI 2nd (cross-domain, different domain than the author) -> human final (judgement and approval). See "Deal Pipeline Orchestration" below and the `deal-pipeline-orchestration` skill.
- **Process authority layering**: `process/flow.spec.yaml` (ADR-0074) is the SSOT for stages/gates and for **stage-level agent dispatch** (its `activities[].agent` is who PM dispatches for pipeline work); `procedures/_shared/*/schema.yaml` governs **within-procedure step assignments** (`agent_key`) and is authoritative over `skills/*.md`. Where a stage activity and a procedure step name different agents for the same work, the flow.spec activity governs pipeline dispatch and the procedure governs its internal steps — a divergence is a defect to reconcile, not a choice.
- **Non-negotiable boundaries**: agents inherit caller permissions and hold no accounts of their own; gate approval and investment decisions belong to humans — LLM-drafted information and recommendations are the sanctioned decision-support input (proposals only; a person records the verdict); `procedures/*.yaml` is authoritative over `skills/*.md`; data confidence caps the RAG grade; permits and certifications are tracked separately.
- Run `bun run agent:verify` after any change to this roster.

### Deal Pipeline Orchestration (S1–S12)

PM is the single orchestrator of the **new business review pipeline** (S1 market analysis → S12 post-investment management). `process/flow.spec.yaml` (ADR-0074) is the SSOT: read stage definitions from the spec at dispatch time — this file and dispatch prompts never restate them. The operational runbook (per-stage mechanics, human checkpoints, environment discipline) is the `deal-pipeline-orchestration` skill.

- **Stage dispatch loop**: read the stage (objective, entry criteria, `activities`, `requiredArtifacts`, gates) → dispatch each activity's agent with its persona from `agents/<agent>.md`, embedding the activity's `skills` and `procedure` keys (read-only analyses in parallel, write tasks serially) → verify `requiredArtifacts` before treating the stage as complete → stop at every gate whose blocking decision is unrecorded.
- **Track branching & promotion**: after S4, greenfield skips S6–S7 and brownfield skips S5 (spec `applicableTracks`); an opportunity that clears its FS-path prerequisites is promoted to a project at S7→S8 (ADR-0094/0095) — the carrier changes, the loop continues at S8.
- **Human gates (ADR-0053 / ADR-0094)**: every gate verdict — `screening`, `pre_fs`, `target_screening`, `fs`, `dd`, `entity_ic`, `group_ic` — is a **human decision** (GO / HOLD / KILL). Agent and committee outputs are proposals, never gate decisions; a Kill-Criteria hit halts mid-stage, and only Group IC can override with an explicit recorded decision. Committees (S4 route, S6/S7 longlist/shortlist; `procedures/_committees.yaml`) are PROPOSED-only and go to the human gate.
- Every stage deliverable passes the **three-stage review** (bullet above) before the gate proposal is assembled.

<!-- COMMON-AGENTS:START -->
## Language Policy

**English-Only Documentation Rule**: All workspace documentation files (.md) must be written in English, with explicit exceptions for recognized locale translation zones and declared Korean legal/regulatory content (see Exceptions below).

### English Documentation Requirement
- All `.md` files outside `ko/` and `locales/ko/` directories MUST be in English
- Applies to: README.md, CLAUDE.md, GEMINI.md, AGENTS.md, context.md, CHANGELOG.md, all documentation in docs/, agents/, skills/
- Rationale: English documentation ensures global accessibility and cross-team collaboration

### Translation Zones (Locale Exceptions)
- `<lang-code>/` directories — language-specific documentation (e.g. `ko/`, `ja/`)
- `locales/<lang-code>/` — locale translation files for internationalization (e.g. `locales/ko/`, `locales/zh-CN/`)
- These are the ONLY locations where non-English `.md` files are permitted (except declared exceptions)
- Recognized locale codes (from `docs/workspace-schema.json` `i18n.locale_codes`):
  `ko`, `ja`, `zh-CN`, `zh-TW`, `de`, `es`, `fr`, `pt`, `vi`, `ms`, `id`, `th`, `ru`, `it`, `ar`

### Language Policy Exception — Korean Legal/Regulatory Content
The English-only policy admits a narrow exception for files where Korean is legally or academically mandatory. To declare an exception, add to the file's frontmatter:
```yaml
lang: ko
lang_reason: legal   # legal | source-material | proper-noun
```
- `legal`: Statutory texts, ordinances, regulations, contracts where Korean original has legal force.
- `source-material`: Primary source quotations where English translation would compromise academic accuracy or meaning.
- `proper-noun`: Files dominated by Korean proper nouns (institution/place/person names).

*Note: Exception is NOT available for: context.md, CLAUDE.md, GEMINI.md, AGENTS.md, or any variant context.md file. It IS available for `agents/*.md` and `skills/*.md` (with `lang_reason` declared).*

### Korean Plain-Language Preference (`순우리말`-First)
When writing Korean documentation or Korean translation output, prefer native Korean words (`순우리말`) over loanwords (`외래어`) whenever a natural, widely-understood native equivalent exists — e.g. prefer `만들기` over `크리에이션`, `알림` over `노티피케이션`, `모음` over `컬렉션` in general prose.
- Loanwords effectively settled in Korean (`컴퓨터`, `데이터`, `소프트웨어`, `파일`) and established international technical terms remain permitted — clarity and standard terminology take precedence over forced nativization.
- Applies immediately to new Korean-language content (including `ko/`, `locales/ko/`, `*_ko.md`, and `lang: ko` exception files).
- Existing Korean documents are nativized incrementally: apply the preference to touched sections whenever a document is edited for other reasons; no bulk rewrites.

### Enforcement
- Pre-commit audit checks for Korean content outside ko/ and locales/ko/
- PR reviews reject non-English documentation outside translation zones
- Auditor validates compliance during Phase 6 QA gate

### Git/PR Artifacts Language Rule
- All commit messages: English
- All PR titles: English
- All PR descriptions: English
- All branch names: English
- Code comments: English (unless documenting locale-specific logic)

### Pluggable Variant Audit Hooks and Integrity Protection
- **Core Script Standardization**: The core synchronization and validation scripts (`scripts/dev-sync.ts` and `scripts/audit.ts`) must remain standardized and identical across all templates and variants. Direct modification of these core scripts in L2 projects is strictly forbidden.
- **Variant-Specific Audit Hook**: Variant projects requiring custom verification checks must implement them in a pluggable hook script at the path declared in the variant's `variant.json` → `script_manifest` (conventionally `scripts/audit-variant.ts` or `scripts/<variant>/audit-variant.ts`).
- **Integrity Enforcement**: During template reconciliation (`l3-to-variant-pipeline.ts`), any modified core scripts will be automatically detected and will fail the reconciliation.

### Universal Design Gate (ADR-0074)

Every code change at any tier (L0–L3) must carry spec activity: create/update a design doc at `docs/designs/<spec-id>-design.md` and register it (`bun scripts/spec-register.ts --file <design-doc> --source manual --status implemented`) before `/sync`. The sync-time spec-check (`audit.ts --spec-check`, dev-sync step 3.9) blocks commits without it; trivial changes use `--spec-exempt=E1..E5` (AGENTS.md §5.1.1). Project registries (`docs/specs/registry.json`) are add-if-missing seeds — upgrades never overwrite or prune project entries.

### LLM Work Routing Policy (ADR-0078)

Substantive LLM-assisted development work — generation or modification of code, documents, designs, tests, or scripts — MUST be routed through this project's agent team: `user → PM triage → Design Gate (unless exempt) → specialist dispatch → QA gate → /sync PR`. Querying an external LLM directly (e.g. a web chat) and landing its output in this repository is a policy violation. IDE inline completions and one-off Q&A that never land in the repository are exempt; repository-landing work uses the E1–E5 exemption codes only. An application calling LLM APIs at runtime is an architecture concern covered by the Design Gate (ADR-0074). Enforcement is structural via the existing hard gates — see ADR-0078 (workspace root, `docs/adr/0078-agent-mediated-llm-work-routing.md`) for the full decision.

### Instruction Writing Standard (ASD-STE100, ADR-0079)

Development-facing instruction text — requirement statements, task briefs, execution-plan task descriptions, agent dispatch prompts, design-doc requirement sections, API endpoint documentation, and how-to steps — follows ASD-STE100 (Simplified Technical English) structural rules, in every development domain (web, app, API, scripts, documents). Rules: one instruction per sentence (≤ 20 words procedural / ≤ 25 descriptive); active voice with imperative steps; present tense; one term = one meaning (use glossary/registry terms exactly); no idioms; positive phrasing preferred; minimal pronouns; lists for parallel items and tables for structured data. The STE dictionary is not adopted. Enforcement is advisory: PM conforms task briefs at triage; architect checks requirement sections at Design Gate review. Full policy: §3.10 (workspace root AGENTS.md) and ADR-0079 (`docs/adr/0079-simplified-english-development-instructions.md`).
<!-- COMMON-AGENTS:END -->


<!-- WORKSPACE-MANAGED: graft repo context graph -->
<!-- graft:start -->
## Graft — repo context graph

This repo is indexed in `graft/`: small linked markdown nodes that explain each
system and carry exact file:line spans, kept in sync with the code through git.

For ANY task here — understanding how something works, finding where code lives,
or scoping a change — get context from the graph before grepping or opening
source files. Re-ask freely (it's cheap) and reuse literal identifiers you
already have (symbol, error string, file name) as the query. New to this repo?
Run `graft map` first — a token-budgeted orientation (dir clusters, hubs,
hotspots), no LLM, no key.

- Run `graft ask "<your question>" --source` → ranked nodes with the relevant
  code spans inlined (each hit's ≤8-line crux by default; `--full` for whole
  definitions when the crux isn't enough). Match the tool to the task shape:
  for understanding or editing, the top node IS the answer — cite its
  `covers:` file:line spans and edit straight from `--source`. For
  exhaustive tasks ("every occurrence / every caller of this pattern"), ranked
  results are top-N, not complete — run `graft grep "<literal>"` instead
  (exhaustive over indexed files, grouped by enclosing symbol), falling back
  to raw `grep -rn` only for unindexed files.
- `graft skeleton <file>` → every definition's signature + span, ~10× cheaper
  than reading the file; use it to skim an API surface.
- `graft callers <symbol>` gives precomputed, exact edges — who calls this.
  Add `--direction out` for what it calls, or `--depth N` to walk
  transitively for the full blast radius. For structural questions, skip
  ranking and use this directly.
- Or browse: `graft/INDEX.md` lists every node; follow the links.
- Monorepos and folders of multiple repos rank fairly across sub-projects —
  hits carry `[scope/]` labels naming which one they're from. Narrow with
  `graft ask "<task>" --in <scope>/` once you know where you're working.

If a returned span is truncated ("+N more lines"), open the file at that exact
range before finalizing. Only open source files when a node genuinely lacks a
needed detail, and then at the exact file:line the node points to — never
re-read whole files.

After big code changes, refresh the graph with `graft build` (deterministic,
no API key, $0).
<!-- graft:end -->
<!-- /WORKSPACE-MANAGED -->
