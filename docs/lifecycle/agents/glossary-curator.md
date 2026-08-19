# Agent Governance Record — glossary-curator

## Overview

- **Agent Name**: glossary-curator
- **Formal Name**: Glossary Curator
- **Role**: Owns the glossary: registration, review, duplicate merging, and the four tooling integrations (UI tooltip, report appendix, glossary-lint, MCP lookup_term) that keep it from rotting
- **Phase**: production
- **Domain**: functional / governance
- **Tier**: medium

## Scope

Owns the glossary: registration, review, duplicate merging, and the four tooling integrations (UI tooltip, report appendix, glossary-lint, MCP lookup_term) that keep it from rotting.

## Phase History

- **2026-08-19**: Initial release. Created during Stage 0.2 (agent roster build-out) per design v1.0 section 5.

## Acceptance Criteria

- [x] Defined in `agents/glossary-curator.md`
- [x] Carries `lifecycle` frontmatter with `phase` and `governance`
- [x] Validated by `scripts/validate-agents.ts`
- [x] Registered in `AGENTS.md` roster
- [ ] Exercised in a Stage 1 planning meeting

## References

- Design of record: [`docs/designs/2026-08-19-co-newbiz-design_ko.md`](https://github.com/5throck/ai-workspace-standards/blob/main/docs/designs/2026-08-19-co-newbiz-design_ko.md) section 5
