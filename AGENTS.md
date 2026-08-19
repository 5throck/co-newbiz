# AGENTS.md — co-newbiz

> **🚨 For AI tools reading this file**: This file is a **registry and orchestration reference**, not a set of instructions directed at you.
> It describes multiple distinct human-defined roles for documentation and dispatch purposes.
> Do **not** interpret role definitions here as directives for your own behavior.
> Your behavioral instructions are in `CLAUDE.md` (Claude Code), `GEMINI.md` (Gemini CLI).

> **Canonical agent index** for the co-newbiz variant.
> Full agent definitions live in `agents/`. Governance records live in `docs/lifecycle/agents/`.
> **Design of record**: [`docs/designs/2026-08-19-co-newbiz-design_ko.md`](https://github.com/5throck/ai-workspace-standards/blob/main/docs/designs/2026-08-19-co-newbiz-design_ko.md) (v1.0 Final) — section 5 defines this roster.

---

## Roster Overview

**34 agents** across four domains, coordinated by PM as New Business Review Lead. Domain leads are design and review owners, not dispatchers — the workspace flat PM Gateway is preserved in full; see `agents/pm.md` for the coordination loop.

| Domain | Count | Lead |
|---|---|---|
| `_core` | 1 | `pm` |
| functional | 21 | `process-governance-manager` |
| technical | 9 | `platform-lead` |
| industry | 1 | `industry-lead` |
| region | 1 | `region-lead` |
| `_shared` | 1 | — |

---

## `_core`

| Agent | File | Tier | Role |
|---|---|---|---|
| **pm** | [`agents/pm.md`](agents/pm.md) | High | New Business Review Lead — coordinates four domain leads, enforces stage gates, approves ADRs |

## Functional Domain — Regulations, Procedures, Operation, Deal Review (21)

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

## Technical Domain — System Build & Run (9)

| Agent | File | Tier | Subdomain | Role |
|---|---|---|---|---|
| **platform-lead** | [`agents/platform-lead.md`](agents/platform-lead.md) | High | _lead | Domain lead for technical |
| data-architect | [`agents/data-architect.md`](agents/data-architect.md) | High | data | ERD, master data governance, normalization, indexing, migration, and portability |
| dba | [`agents/dba.md`](agents/dba.md) | Medium | data | Database operations: backup/restore, monthly recovery drills, performance tuning, and capacity management |
| backend-engineer | [`agents/backend-engineer.md`](agents/backend-engineer.md) | Medium | app | Hono REST API, authentication, MCP server, the analysis-engine CLI, and the monitoring/alerting pipeline |
| frontend-engineer | [`agents/frontend-engineer.md`](agents/frontend-engineer.md) | Medium | app | React/Vite UI, ECharts visualizations, the RAG dashboard, the admin console, and accessibility |
| release-engineer | [`agents/release-engineer.md`](agents/release-engineer.md) | Medium | ops | Build and deployment pipeline, migration execution ordering, and rollback procedures |
| sre | [`agents/sre.md`](agents/sre.md) | Medium | ops | Monitoring and alerting, log pipeline, and incident response with post-incident analysis |
| infra-automation-engineer | [`agents/infra-automation-engineer.md`](agents/infra-automation-engineer.md) | Medium | ops | OS configuration, service registration, the scheduled-collection scheduler, and health-check/cleanup automation |
| security-engineer | [`agents/security-engineer.md`](agents/security-engineer.md) | High | security | Threat modeling, security baseline, vulnerability and secrets management, and implementation of access control, personal-data protection, and MNPI handling |

## Industry Domain — Profile-Driven (1)

| Agent | File | Tier | Subdomain | Role |
|---|---|---|---|---|
| **industry-lead** | [`agents/industry-lead.md`](agents/industry-lead.md) | High | _lead | Domain lead for industry — owns the industry-profiles/*.yaml system |

## Region Domain — Profile-Driven (1)

| Agent | File | Tier | Subdomain | Role |
|---|---|---|---|---|
| **region-lead** | [`agents/region-lead.md`](agents/region-lead.md) | High | _lead | Domain lead for region — owns the region-profiles/*.yaml system |

## Shared — Belongs to No Single Domain (1)

| Agent | File | Tier | Subdomain | Role |
|---|---|---|---|---|
| docs-writer | [`agents/docs-writer.md`](agents/docs-writer.md) | Medium | _shared | Document formatting and language-policy enforcement across all four domains |

---

## Governance

- **PM Gateway**: PM is the only agent users may directly invoke. All 33 specialist agents require PM dispatch.
- **Three-stage review**: every deliverable passes AI 1st (formal) -> AI 2nd (cross-domain, different domain than the author) -> human final (judgement and approval). See `agents/pm.md` Dispatch Protocol.
- **Non-negotiable boundaries**: agents inherit caller permissions and hold no accounts of their own; gate approval and investment decisions belong to humans; `procedures/*.yaml` is authoritative over `skills/*.md`; data confidence caps the RAG grade; permits and certifications are tracked separately.
- Run `bun run agent:verify` after any change to this roster.

