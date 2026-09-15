# Agent Governance Record — design-system-agent

## Overview

- **Agent Name**: design-system-agent
- **Formal Name**: Design System Agent
- **Role**: Onyx 3.0 design system governance — token, component, and accessibility consistency enforcement (design-lint)
- **Phase**: production
- **Domain**: technical / design
- **Tier**: medium

## Scope

Verifies compliance with `docs/design-system/design-guide.md` (Onyx 3.0) token, typography, and component specs; fixes design:lint violations (hardcoded colors, color-only states, accessibility issues); keeps new screens aligned with the guide.

## Phase History

- **2026-08-30**: Initial release. Registered in the technical domain (design subdomain) to enforce the Onyx 3.0 doctrine across the web UI.

## Acceptance Criteria

- [x] Defined in `agents/design-system-agent.md`
- [x] Carries `lifecycle` frontmatter with `phase` and `governance`
- [x] Validated by `scripts/validate-agents.ts`
- [x] Registered in `AGENTS.md` roster
- [ ] Exercised in a Stage 1 planning meeting

## References

- Design of record: [`docs/designs/2026-08-19-co-newbiz-design_ko.md`](https://github.com/5throck/ai-workspace-standards/blob/main/docs/designs/2026-08-19-co-newbiz-design_ko.md) section 5
