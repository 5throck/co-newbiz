# Agent Governance Record — backend-engineer

## Overview

- **Agent Name**: backend-engineer
- **Formal Name**: Backend Engineer
- **Role**: Next.js Route Handler API, authentication, the MCP server (REST-client-only), the analysis-engine CLI, and the monitoring/alerting pipeline
- **Phase**: production
- **Domain**: technical / app
- **Tier**: medium

## Scope

Next.js Route Handler REST API, authentication, MCP server, the analysis-engine CLI, and the monitoring/alerting pipeline.

## Phase History

- **2026-08-19**: Initial release. Created during Stage 0.2 (agent roster build-out) per design v1.0 section 5.
- **2026-08-28**: Role/scope text updated from Hono REST API to Next.js Route Handler REST API, reflecting the ADR-0069/0070 web-stack migration (accepted 2026-08-26) that this agent record had not yet caught up with.
- **2026-10-25**: Definition rewritten from stub to the canonical 9-section standard (design 2026-10-25-agent-and-context-ssot-upgrade, v1.0.0 → v1.1.0): Legal Basis / Role / Responsibilities / Protocols / Constraints / Meeting Participation / Engagement Context / Deliverable Standards / Special Instructions; frontmatter gains role, color, examples, phases, handoff wiring, required_skills.

## Acceptance Criteria

- [x] Defined in `agents/backend-engineer.md`
- [x] Carries `lifecycle` frontmatter with `phase` and `governance`
- [x] Validated by `scripts/validate-agents.ts`
- [x] Registered in `AGENTS.md` roster
- [ ] Exercised in a Stage 1 planning meeting

## References

- Design of record: [`docs/designs/2026-08-19-co-newbiz-design_ko.md`](https://github.com/5throck/ai-workspace-standards/blob/main/docs/designs/2026-08-19-co-newbiz-design_ko.md) section 5
