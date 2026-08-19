# Agent Governance Record — risk-officer

## Overview

- **Agent Name**: risk-officer
- **Formal Name**: Risk Officer
- **Role**: Red-team function
- **Phase**: production
- **Domain**: functional / governance
- **Tier**: high

## Scope

Red-team function. Audits for optimism bias, enforces base-rate checks against reference-class forecasts, and holds Kill Criteria authority across every stage gate.

## Phase History

- **2026-08-19**: Initial release. Created during Stage 0.2 (agent roster build-out) per design v1.0 section 5.

## Acceptance Criteria

- [x] Defined in `agents/risk-officer.md`
- [x] Carries `lifecycle` frontmatter with `phase` and `governance`
- [x] Validated by `scripts/validate-agents.ts`
- [x] Registered in `AGENTS.md` roster
- [ ] Exercised in a Stage 1 planning meeting

## References

- Design of record: [`docs/designs/2026-08-19-co-newbiz-design_ko.md`](https://github.com/5throck/ai-workspace-standards/blob/main/docs/designs/2026-08-19-co-newbiz-design_ko.md) section 5
