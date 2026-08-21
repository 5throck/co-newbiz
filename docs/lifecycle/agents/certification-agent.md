# Agent Governance Record — certification-agent

## Overview

- **Agent Name**: certification-agent
- **Formal Name**: Certification Agent
- **Role**: Certification and regulatory response, kept structurally distinct from permits
- **Phase**: production
- **Domain**: functional / certification
- **Tier**: high

## Scope

Certification and regulatory response, kept structurally distinct from permits. Requirement identification, gap analysis, acquisition-option comparison, roadmap sequencing, change-of-control transferability input (legal-counsel owns the judgment), and forward regulatory-change response.

## Phase History

- **2026-08-19**: Initial release. Created during Stage 0.2 (agent roster build-out) per design v1.0 section 5.
- **2026-08-22**: v1.1.0 — change-of-control transferability judgment ownership moved to legal-counsel (design of record 2026-08-22 §5 PR-3, meeting legal-review findings #1/#6); certification-agent is now the input provider for that check.

## Acceptance Criteria

- [x] Defined in `agents/certification-agent.md`
- [x] Carries `lifecycle` frontmatter with `phase` and `governance`
- [x] Validated by `scripts/validate-agents.ts`
- [x] Registered in `AGENTS.md` roster
- [ ] Exercised in a Stage 1 planning meeting

## References

- Design of record: [`docs/designs/2026-08-19-co-newbiz-design_ko.md`](https://github.com/5throck/ai-workspace-standards/blob/main/docs/designs/2026-08-19-co-newbiz-design_ko.md) section 5
