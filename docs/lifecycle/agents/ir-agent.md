# Agent Governance Record — ir-agent

## Overview

- **Agent Name**: ir-agent
- **Formal Name**: IR Agent
- **Role**: Investor-relations advisory — equity story, disclosure discipline, investor communications, and market-perception risk
- **Phase**: production
- **Domain**: functional / governance
- **Tier**: medium

## Scope

Investor relations advisory: equity story, disclosure discipline, investor communications, and market perception risk. Standing functional-expert seat on both steering committees (ADR-0097 Amendment 2026-09-04).

## Phase History

- **2026-09-04**: Initial release. Added as a standing functional-expert seat on the ADR-0097 committees (route-steering-committee, target-longlist-shortlist-committee).
- **2026-10-25**: Definition rewritten from stub to the canonical 9-section standard (design 2026-10-25-agent-and-context-ssot-upgrade, v1.0.0 → v1.1.0): Legal Basis / Role / Responsibilities / Protocols / Constraints / Meeting Participation / Engagement Context / Deliverable Standards / Special Instructions; frontmatter gains role, color, examples, phases, handoff wiring, required_skills.

## Acceptance Criteria

- [x] Defined in `agents/ir-agent.md`
- [x] Carries `lifecycle` frontmatter with `phase` and `governance`
- [x] Validated by `scripts/validate-agents.ts`
- [x] Registered in `AGENTS.md` roster
- [x] Registered as a member of both ADR-0097 committees in `procedures/_committees.yaml`
- [ ] Exercised in a Stage 1 planning meeting

## References

- Design of record: [`docs/designs/2026-08-19-co-newbiz-design_ko.md`](https://github.com/5throck/ai-workspace-standards/blob/main/docs/designs/2026-08-19-co-newbiz-design_ko.md) section 5
- ADR-0097: [`docs/adr/0097-steering-committee-deliberation.md`](../../adr/0097-steering-committee-deliberation.md)
