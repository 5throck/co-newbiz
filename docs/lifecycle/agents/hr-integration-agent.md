# Agent Governance Record — hr-integration-agent

## Overview

- **Agent Name**: hr-integration-agent
- **Formal Name**: HR Integration Agent
- **Role**: HR & labor integration specialist — HR due diligence, executive CoC compensation review, upward-bias compensation harmonization, people-transfer execution, and the HR & labor committee seat
- **Phase**: production
- **Domain**: functional / brownfield
- **Tier**: high

## Scope

Executive compensation review, employee pay-and-benefits parity analysis, and labor/workforce integration for M&A. Enforces the upward-bias assumption in compensation harmonization.

## Phase History

- **2026-08-19**: Initial release. Created during Stage 0.2 (agent roster build-out) per design v1.0 section 5.
- **2026-10-25**: Definition rewritten from stub to the canonical 9-section standard (design 2026-10-25-agent-and-context-ssot-upgrade, v1.0.0 → v1.1.0): Legal Basis / Role / Responsibilities / Protocols / Constraints / Meeting Participation / Engagement Context / Deliverable Standards / Special Instructions; frontmatter gains role, color, examples, phases, handoff wiring, required_skills.

## Acceptance Criteria

- [x] Defined in `agents/hr-integration-agent.md`
- [x] Carries `lifecycle` frontmatter with `phase` and `governance`
- [x] Validated by `scripts/validate-agents.ts`
- [x] Registered in `AGENTS.md` roster
- [ ] Exercised in a Stage 1 planning meeting

## References

- Design of record: [`docs/designs/2026-08-19-co-newbiz-design_ko.md`](https://github.com/5throck/ai-workspace-standards/blob/main/docs/designs/2026-08-19-co-newbiz-design_ko.md) section 5
