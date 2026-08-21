# co-newbiz Context

> Variant-specific configuration. Immutable cross-tool identity lives in `docs/context.md`.
> Design of record: [`docs/designs/2026-08-19-co-newbiz-design_ko.md`](https://github.com/5throck/ai-workspace-standards/blob/main/docs/designs/2026-08-19-co-newbiz-design_ko.md) (v1.0 Final) — this file is a summary for quick orientation, not a substitute for it.

## Overview

co-newbiz is an AI-agent team and system that owns and operates the policies, procedures, guidelines, and checklists for new-business review — **Green Field** (new establishment) and **Brown Field** (M&A, including R&BD as a Brown Field subtype) — and implements that governance as a working review system, rather than a static document set.

Two axes are co-equal, per the design's own framing: **(A) governance ownership and operation** (authoring/amending policies, procedures, guidelines, checklists, and running their standing operation — compliance monitoring, waivers, interpretation registry, KPIs) and **(B) system build and maintenance** (implementing A as a system and keeping it running). A third axis, **(C) deal review**, runs real reviews on top of A and B and is the quality check on both.

Distinctive to the domain: many target industries have no direct market data, so demand is estimated through a proxy chain across upstream industries (e.g. crankshaft → marine engine → ship, with CGT/BHP/ton unit conversion). Chain reliability caps the confidence of every downstream conclusion — this is the RAG framework's data-confidence cap rule (see `docs/rag-framework.md`).

**Tech stack**: SQLite (`bun:sqlite`, WAL, vendor-neutral schema for eventual Postgres portability) · Hono API + React/Vite + ECharts · Python (python-docx / reportlab / python-hwpx) for document rendering · MCP server over stdio, REST-proxied · TypeScript CLI (`bun scripts/co-newbiz/newbiz.ts`).

## Agents

**34 agents** across four co-equal domains plus `_core` and `_shared`, coordinated by PM acting as New Business Review Lead. Domain leads are design/review owners, not dispatchers — the workspace flat PM Gateway is preserved in full (PM is the only agent users invoke directly; all 33 specialists require PM dispatch).

| Domain | Count | Lead | Concern |
|---|---|---|---|
| `_core` | 1 | `pm` | Coordinates the four domain leads, enforces stage gates, approves ADRs |
| functional | 21 | `process-governance-manager` | Regulations, procedures, operation; review methodology; deal review (governance, analysis, greenfield, brownfield, dd, certification, partnership, group subdomains) |
| technical | 9 | `platform-lead` | System build and run — DB, API, UI, deploy, ops, security |
| industry | 1 | `industry-lead` | Industry-specific characteristics, owned via `industry-profiles/*.yaml` |
| region | 1 | `region-lead` | Regional characteristics incl. domestic, owned via `region-profiles/*.yaml` |
| `_shared` | 1 | — (`docs-writer`) | Document formatting / language policy, spans all four domains |

Full roster with per-agent tier and role: `AGENTS.md`. Full definitions: `agents/*.md`.

**Three-stage review** applies to every deliverable: AI 1st (formal/completeness) → AI 2nd (cross-domain — must come from a different domain than the author) → human final (judgement and approval). Regulations, gate approvals, investment decisions, the security/privacy model, and ADRs cannot pass on AI review alone.

## Skills

119 skills under `skills/`, spanning:

- **Reused from co-consult / workspace** (financial-statement-analysis, insight-synthesis, competitive-intelligence, company-intelligence, executive-presentation, sample-driven-report-writing, hwp-document-processing, org-readiness-assessment, k-dart, k-law, mece-logic-auditor, security-scan, stride-threat-matrix, sarif-exporter, accessibility-audit, zod-contract-gate) — adapted to co-newbiz's own `newbiz.ts` CLI rather than restated.
- **Governance authoring & operation** — `governance-document-hierarchy`, `policy-and-procedure-governance`, `procedure-reference-override`, `two-tier-approval-chain`, `policy-change-impact-analysis`, `regulation-monitoring`, `adr-governance`, `compliance-monitoring`, `waiver-management`, `interpretation-registry`, `governance-training-and-notice`, `governance-kpi-reporting`, `checklist-authoring`.
- **Group review** — `group-level-review`, `portfolio-fit-assessment`, `intra-group-transaction-compliance`.
- **Glossary** — `glossary-management`, `glossary-lint`.
- **Green Field / Brown Field & gates** — `greenfield-feasibility`, `brownfield-feasibility`, `stage-gate-governance`, `site-infrastructure-assessment`, `regional-incentive-sourcing`, `site-comparison`, `talent-pipeline-planning`, `community-partnership-planning`.
- **Partnership** — `partner-sourcing-strategy`, `partner-due-diligence`, `jv-structuring`.
- **M&A special topics** — `antitrust-screening`, `customer-attrition-risk`, `incentive-clawback-assessment`, `management-incentive-review`, `compensation-harmonization-analysis`, `debt-and-contingent-liability-simulation`, `pmi-planning`, plus `investment-vehicle-structuring` (ADR-0045, added post-Wave-5.10).
- **Region / industry** — `region-profile-application`, `industry-profile-application`.
- **Market & proxy chain** — `value-chain-linkage-analysis`, `proxy-industry-chain`, `unit-conversion-calibration`, `market-data-pipeline`.
- **Financial & simulation** — `historical-financial-analysis`, `peer-benchmarking`, `growth-projection-modeling`, `quality-of-earnings`, `investment-feasibility-modeling`, `wacc-input-session`, `scenario-planning`, `monte-carlo-simulation`.
- **Legal & DD** — `regulatory-screening`, `permit-pathway-mapping`, `statute-change-monitoring`, `legal-risk-register`, `commercial-due-diligence`, `technical-due-diligence`, `site-visit-protocol`, `expert-interview`, `dd-to-valuation-bridge`.
- **Judgment & quality** — `rag-scoring-framework`, `run-versioning-and-attribution`, `assumption-audit`.
- **Platform** — `master-data-governance`, `data-normalization`, `data-freshness-and-revision-control`, `db-migration-governance`, `query-performance-tuning`, `rest-api-design`, `mcp-server-integration`, `ui-information-architecture`, `auth-and-account-management`, `continuous-monitoring-and-alerting`, `notification-channel-management`.
- **Operations & security** — `deployment-and-release`, `database-operations`, `backup-and-dr`, `observability-and-alerting`, `incident-response`, `infrastructure-automation`, `batch-scheduling-operations`, `security-baseline-review`, `vulnerability-management`, `access-control-review`, `admin-console-operations`.

Full registry with per-skill status/owner/version: `skills/SKILLS.md`.

## Domain Configuration

- **RAG signal system** (`docs/rag-framework.md`): six dimensions (financial, market, data confidence, regulatory/permit, technical/execution, risk) plus overall, rule-based (not weighted-average) — a Kill Criteria trigger or any assessed Red dimension forces overall Red immediately; an incomplete assessment (fewer than six dimensions genuinely assessed, none Red) yields no overall grade rather than defaulting to a color (Wave 5.10 defect fix, see `docs/pilots/pilot-001-system-rerun.md`).
- **Stage gates**: Screening → Pre-FS → FS → DD → Entity IC → Group IC, with Entity IC approval required before Group-level procedure entry (`approval_chain`, ADR-0028).
- **Governance layers** (`docs/governance-operations.md`): Policy / Procedure / Guideline / Checklist / Template, each with distinct enforceability and revision authority — see the document-layer table in the design.
- **Procedure inheritance**: `procedures/{_shared,entities/<company>,regions/<ISO2>,group}/<proc>/schema.yaml` — entity/region procedures reference shared procedures via `references:` + `overrides:`, never copy them (ADR-0020); copies are audit-detected and blocked.
- **Information protection** (`docs/information-protection.md`, `docs/security-model.md`): project-membership access control (deny-by-default), minimal-collection/aggregate-only handling of personal data (executive compensation, comp benchmarks), and MNPI insider-list/access-log handling for listed-company deals — none of this is deferrable to a later phase (ADR-0038/0039/0040).
- **Investment vehicle structuring** (ADR-0045, `skills/investment-vehicle-structuring/`): tax structure, liability isolation, financing leverage, and exit structure are mandatory Pre-FS deal-structure-hypothesis axes for both Brown Field and Green Field, enforced via `checklists/brownfield-feasibility-checklist.yaml` bf-12 / `checklists/greenfield-feasibility-checklist.yaml` gf-11.
- **Remaining known gaps** (as of 2026-08-21): the 24 documented-but-unmigrated DB tables gap was closed via `db/migrations/0011_dd_finding_and_remaining_tables.sql` (all 68 documented tables now migrate cleanly); Wave 5.7B then wired the plain membership-filtered read/write surface over them — REST `app/server/analysis.ts` + `deal-review.ts`, MCP `tools/analysis.ts` + `tools/deal-review.ts`, plus `docs/openapi.yaml` with its executable drift gate (`tests/unit/openapi.test.ts`), closing the api-spec/mcp-integration Status gaps. The engine-1 run-versioning wave then landed ADR-0005's engine half: `db/lib/versioning.ts` (createRun snapshot + input_hash + diffRuns bridge), the `model`/`diff` CLI cases (`scripts/co-newbiz/model.ts`), the runs REST surface in `app/server/analysis.ts`, and the `compare_runs` MCP tool. The engine-2 simulations wave then exposed ADR-0026's Monte Carlo engine over REST: `db/lib/simulation.ts` composes the scenario from a run's `sim.*` inputs plus the project's `contingent_liability` rows, spawns `python/monte_carlo.py` with an args array (never shell), persists `simulation` + `simulation_result` (quantiles only — `simulation_draw` stays empty because the engine emits no per-iteration draws), and `POST /api/simulations` / `GET /api/simulations/:id/results` + the `run_simulation`✱ MCP tool sit on top (29 catalog tools live). NPV-level diff decomposition and `run_model` stay deferred until a valuation engine exists — v1 versions inputs, it does not value them. The remaining engine-dependent surface (financial analysis, projections, proxy chains, reports) stays deferred to the CLI-backed job surface. `industry-profiles/` gained its schema contract (`_schema.yaml`/`_validate.ts`, mirroring `region-profiles/`) but has zero populated profiles — populating one requires genuine cited industry research per KSIC code, which cannot be fabricated (`admin-console-operations` was checked and found to already accurately self-document its 3/10-built state — no fix needed there). Still open, larger scope: `newbiz.ts`'s 12 undeveloped CLI commands (`fetch`, `md:sync`, `law:sync`, `policy:sync`, `policy:impact`, `glossary:lint`, `fin:project`, `assume`, `calibrate`, `convert`, `export`, `adr:new` — deliberately not stubbed per the CLI's own module comment; `model` and `diff` landed with engine-1), `market-data-pipeline` fetch, `deal-workspace-operations`'s closure/archival logic, and `hwp-document-processing`'s extraction path (generation only is ported so far). The 2026-08-21 badge/provenance wave enriched `GET /api/projects` list rows with `rag_overall`/`rag_assessed_at` (latest overall-grade `rag_assessment` per project, one aggregate query) and gave the envelope first-class FR-SYS-03 provenance meta (`app/server/envelope.ts` `provenance()`), populated on observations (`meta.source` when all returned rows share one source) and dd-finding POST (run linkage to the latest registry row for the key); two client-gated gaps remain open by design: a list-row `stale` signal (not derivable today — `fact_market_observation` carries no project binding and `ttl_days` is per (run, assumption_key); needs either project-bound freshness data or a design-defined staleness rule) and notification read/unread (`notification` has no `read_at` and no cleanly-fitting column exists in `session`/`app_user` — `watch.last_checked_at` is a change-detection watermark, not a read state — so it requires a migration).

For the full team-structure rationale, cross-validation matrix, and ADR index, see the design of record and `docs/team-structure.md`.
