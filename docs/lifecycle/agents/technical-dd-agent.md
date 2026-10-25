# Agent Governance Record — technical-dd-agent

## Overview

- **Agent Name**: technical-dd-agent
- **Formal Name**: Technical DD Agent
- **Role**: Technical due diligence lead — site-visit evidence, remaining equipment life, TRL/MRL assessment, EHS liability identification, and independent capex verification
- **Phase**: production
- **Domain**: functional / dd
- **Tier**: medium

## Scope

Technical due diligence: site visits, remaining equipment life, TRL assessment, EHS liability, and capex verification.

## Phase History

- **2026-08-19**: Initial release. Created during Stage 0.2 (agent roster build-out) per design v1.0 section 5.
- **2026-10-25**: Definition rewritten from stub to the canonical 9-section standard (design 2026-10-25-agent-and-context-ssot-upgrade, v1.0.0 → v1.1.0): Legal Basis / Role / Responsibilities / Protocols / Constraints / Meeting Participation / Engagement Context / Deliverable Standards / Special Instructions; frontmatter gains role, color, examples, phases, handoff wiring, required_skills; tier realigned to the AGENTS.md roster (high → medium).

## Acceptance Criteria

- [x] Defined in `agents/technical-dd-agent.md`
- [x] Carries `lifecycle` frontmatter with `phase` and `governance`
- [x] Validated by `scripts/validate-agents.ts`
- [x] Registered in `AGENTS.md` roster
- [ ] Exercised in a Stage 1 planning meeting

## References

- Design of record: [`docs/designs/2026-08-19-co-newbiz-design_ko.md`](https://github.com/5throck/ai-workspace-standards/blob/main/docs/designs/2026-08-19-co-newbiz-design_ko.md) section 5
