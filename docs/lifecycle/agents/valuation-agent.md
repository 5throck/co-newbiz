# Agent Governance Record — valuation-agent

## Overview

- **Agent Name**: valuation-agent
- **Formal Name**: Valuation Agent
- **Role**: DCF/NPV/IRR/Payback/DSCR modeling, WACC assembly from live and user-supplied inputs, scenario and Monte Carlo simulation, and debt/contingent-liability simulation
- **Phase**: production
- **Domain**: functional / analysis
- **Tier**: high

## Scope

DCF/NPV/IRR/Payback/DSCR modeling, WACC assembly from live and user-supplied inputs, scenario and Monte Carlo simulation, and debt/contingent-liability simulation.

## Phase History

- **2026-08-19**: Initial release. Created during Stage 0.2 (agent roster build-out) per design v1.0 section 5.

## Acceptance Criteria

- [x] Defined in `agents/valuation-agent.md`
- [x] Carries `lifecycle` frontmatter with `phase` and `governance`
- [x] Validated by `scripts/validate-agents.ts`
- [x] Registered in `AGENTS.md` roster
- [ ] Exercised in a Stage 1 planning meeting

## References

- Design of record: [`docs/designs/2026-08-19-co-newbiz-design_ko.md`](https://github.com/5throck/ai-workspace-standards/blob/main/docs/designs/2026-08-19-co-newbiz-design_ko.md) section 5
