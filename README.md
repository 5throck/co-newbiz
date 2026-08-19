---
sync_version: 1
content_hash: PLACEHOLDER
---

# co-newbiz

> **Language**: **English** · [한국어](README_ko.md)
> **Status**: ⚠️ Beta — v0.1.0
> New-business-review AI team and system. Owns the regulations, procedures, guidelines and checklists for new business development and their ongoing operation (axis A), implements and maintains them as a system (axis B), and performs the actual deal reviews on top of that (axis C). Covers Green Field (new establishment) and Brown Field (M&A), with proxy-chain demand estimation for industries that have no direct market data.

## Overview

New-business-review AI team and system. Owns the regulations, procedures, guidelines and checklists for new business development and their ongoing operation (axis A), implements and maintains them as a system (axis B), and performs the actual deal reviews on top of that (axis C). Covers Green Field (new establishment) and Brown Field (M&A), with proxy-chain demand estimation for industries that have no direct market data.. See docs/context.md for full architecture and standards.

## Quick Start

This is a beta variant of the workspace template. It inherits from `templates/common` and includes variant-specific customizations.

### For Claude Code users:

See `CLAUDE.md` for detailed instructions.

### For Gemini CLI users:

See `GEMINI.md` for detailed instructions.

## Team Mission

**Mission:** New-business-review AI team and system. Owns the regulations, procedures, guidelines and checklists for new business development and their ongoing operation (axis A), implements and maintains them as a system (axis B), and performs the actual deal reviews on top of that (axis C). Covers Green Field (new establishment) and Brown Field (M&A), with proxy-chain demand estimation for industries that have no direct market data.

## Meet the AI Team

Your partners consist of specialized agents, each with a distinct role. The **Project Manager (PM)** is your single point of entry—they orchestrate the rest of the team.

| Agent | Role | Tier | Model |
|-------|------|------|-------|
| **antitrust-agent** | Antitrust and merger-control review: market definition, HHI calculation, multi-j | high | inherit |
| **backend-engineer** | Hono REST API, authentication, MCP server, the analysis-engine CLI, and the moni | medium | inherit |
| **brownfield-agent** | M&A review lead: target screening, deal structuring, and carve-out assessment | high | inherit |
| **certification-agent** | Certification and regulatory response, kept structurally distinct from permits | high | inherit |
| **commercial-dd-agent** | Commercial due diligence: customer concentration, pricing power, channel checks, | medium | inherit |
| **compliance-officer** | Owns governance operation: the standing work of running the rules the team write | high | inherit |
| **customer-retention-agent** | Post-acquisition customer attrition risk: change-of-control clause scanning, cus | medium | inherit |
| **data-architect** | ERD, master data governance, normalization, indexing, migration, and portability | high | inherit |
| **dba** | Database operations: backup/restore, monthly recovery drills, performance tuning | medium | inherit |
| **docs-writer** | Document formatting and language-policy enforcement across all four domains | medium | inherit |
| **financial-analyst** | Historical financial analysis, peer benchmarking, quality-of-earnings, and growt | high | inherit |
| **frontend-engineer** | React/Vite UI, ECharts visualizations, the RAG dashboard, the admin console, and | medium | inherit |
| **glossary-curator** | Owns the glossary: registration, review, duplicate merging, and the four tooling | medium | inherit |
| **greenfield-agent** | New-establishment review lead: site selection, infrastructure assessment, talent | high | inherit |
| **group-review-agent** | Group-level review distinct from entity-level review: portfolio fit, intra-group | high | inherit |
| **hr-integration-agent** | Executive compensation review, employee pay-and-benefits parity analysis, and la | high | inherit |
| **incentive-agent** | Bidirectional policy-benefit management: sourcing regional tax and infrastructur | medium | inherit |
| **industry-lead** | Domain lead for industry, owning the industry profile system used across the ros | high | inherit |
| **infra-automation-engineer** | OS configuration, service registration, the scheduled-collection scheduler, and  | medium | inherit |
| **legal-counsel** | Domestic and overseas statute, contract, and regulatory advisory | high | inherit |
| **market-intelligence-agent** | TAM/SAM/SOM sizing, demand forecasting, competitor capacity-expansion tracking,  | high | inherit |
| **partnership-agent** | Partner sourcing strategy, partner due diligence including compliance screening, | medium | inherit |
| **platform-lead** | Domain lead for technical | high | inherit |
| **pmi-agent** | Post-merger integration planning: synergy realization tracking and integration r | medium | inherit |
| **process-governance-manager** | Domain lead for functional | high | inherit |
| **quant-methodologist** | Owns the proxy industry chain methodology: unit conversion, regression calibrati | high | inherit |
| **region-lead** | Domain lead for region, owning the region profile system covering domestic and o | high | inherit |
| **release-engineer** | Build and deployment pipeline, migration execution ordering, and rollback proced | medium | inherit |
| **risk-officer** | Red-team function | high | inherit |
| **security-engineer** | Threat modeling, security baseline, vulnerability and secrets management, and im | high | inherit |
| **sre** | Monitoring and alerting, log pipeline, and incident response with post-incident  | medium | inherit |
| **technical-dd-agent** | Technical due diligence: site visits, remaining equipment life, TRL assessment,  | medium | inherit |
| **valuation-agent** | DCF/NPV/IRR/Payback/DSCR modeling, WACC assembly from live and user-supplied inp | high | inherit |

## Skills

- **accessibility-audit**: 
- **agent-lifecycle-manager**: 
- **explain-me**: 
- **gateguard**: 
- **k-dart**: 
- **k-law**: 
- **mece-logic-auditor**: 
- **meeting-facilitation**: 
- **presenter-mode**: 
- **project-review**: 
- **sarif-exporter**: 
- **script-lifecycle-manager**: 
- **security-scan**: 
- **skill-lifecycle-manager**: 
- **sound-synth**: 
- **standup-synthesizer**: 
- **stride-threat-matrix**: 
- **swe-solve**: 
- **sync**: 
- **team-builder**: 
- **translate**: 
- **update-bun-packages**: 
- **validate-docs-links**: 
- **zod-contract-gate**: 

## How to Collaborate

Working with us is structured to maximize quality and prevent collisions. Here is our standard workflow:

### A. The PM Gateway

Always start your requests by talking to the **PM**. Do not invoke specialist agents directly. The PM will analyze your request and bring in the right experts.

### B. Standard Workflow Phases

1. **Team Assembly:** The PM creates specialized agents/skills if required.
2. **Triage:** The PM classifies the request; dispatches read-only agents in parallel.
3. **Analysis:** The PM synthesizes findings into requirements + acceptance criteria.
4. **Design:** An architect produces an implementation plan + ADR.
5. **Implementation:** Specialists implement; the PM loops up to 3× on failures.
6. **Finalization:** The PM logs decisions; runs `/sync`; opens a PR.

### C. Available Commands

Our daily operations are driven by slash commands (registered as Skills by Claude Code and Gemini CLI):

- `/sync "feat: ..."` — Full pipeline: memlog → changelog → audit → commit → PR.
- `/changelog "..."` — Add an entry to `CHANGELOG.md`.
- `/memlog "summary"` — Append a summary to today's session log.
- `/meeting` — Run a structured, inline multi-agent discussion.

## Variant Type

**Type**: consulting

This variant focuses on Strategy consulting for AI-assisted business consulting engagements.

> **⚠️ Beta variant** — not for production use.

- **Client Engagements**: 0/2 (see variant governance rules)
- **Beta Duration**: 0/2 months
- **Additional Checks**: Pending

See `scripts/helpers/variant-governance-rules.ts` for promotion criteria.

---

*Last Updated: 2026-08-19*
