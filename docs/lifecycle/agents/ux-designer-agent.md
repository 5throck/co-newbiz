# Agent Governance Record — ux-designer-agent

## Overview

- **Agent Name**: ux-designer-agent
- **Formal Name**: UX Designer Agent
- **Role**: Screen design ownership — JTBD-driven mockups, flows, and interaction patterns within the Onyx 3.0 doctrine
- **Phase**: production
- **Domain**: technical / design
- **Tier**: medium

## Scope

Designs the co-newbiz web UI as proposals for human approval: JTBD-driven
discovery over the three standard personas (deal analyst, IC reviewer,
operator), flow mapping (entry = upstream stage artifacts, exit = next-stage
interface), screen design within the Onyx 3.0 doctrine, interaction-state
documentation, embedded accessibility (WCAG AA, both themes, ≤880px), and
handoff specs with reasoning and measurable success criteria. Never edits
styles.css or the token registry directly; new tokens/patterns escalate to
design-system-agent and the ADR procedure.

## Phase History

- **2026-09-12**: Initial release. Created after the 2026-09-12 usability review found the web surface presented results without search/registration (CRUD) surfaces and missing stage-to-stage linkage. Definition informed by external conventions (awesome-copilot UX agent workflow, Figma design-agent's design-system-constrained generation, handoff accessibility checklists) and reviewed in a five-perspective session (PM, design-system-agent, frontend-engineer, process governance, deal-practitioner).
- **2026-10-25**: Definition rewritten from stub to the canonical 9-section standard (design 2026-10-25-agent-and-context-ssot-upgrade, v1.0.0 → v1.1.0): Legal Basis / Role / Responsibilities / Protocols / Constraints / Meeting Participation / Engagement Context / Deliverable Standards / Special Instructions; frontmatter gains role, color, examples, phases, handoff wiring, required_skills.

## Acceptance Criteria

- [x] Defined in `agents/ux-designer-agent.md`
- [x] Carries `lifecycle` frontmatter with `phase` and `governance`
- [x] Registered in `AGENTS.md` roster
- [ ] Exercised in a Stage 1 planning meeting

## References

- Design of record: `docs/designs/2026-09-12-ux-designer-agent-design.md`
- Design doctrine: `docs/design-system/design-guide.md` (gov-des-00) and sibling doctrine docs
- External conventions adopted: awesome-copilot `se-ux-ui-designer.agent.md`, Figma design agent (design-system-constrained generation), design-handoff accessibility checklists
