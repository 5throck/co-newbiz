# Agent Governance Record — pm

## Overview

- **Agent Name**: pm
- **Formal Name**: New Business Review Lead
- **Role**: Project Manager (PM) Agent — variant override extending the workspace PM template
- **Phase**: production
- **Domain**: `_core`
- **Tier**: High

## Scope

PM coordinates four domain leads (functional / technical / industry / region) rather than
dispatching every specialist directly. The workspace flat PM Gateway is preserved in full —
domain leads are design and review owners, not dispatchers, and PM remains the only dispatcher.

PM enforces five non-negotiable boundaries defined in the design of record:

1. Agents inherit the calling user's permissions and hold no accounts of their own.
2. Gate approval and the investment decision belong to humans.
3. `procedures/*.yaml` is authoritative for what and when; `skills/*.md` for how.
4. Data confidence caps the overall RAG grade.
5. Permits and certifications are tracked separately.

## Phase History

- **2026-08-19**: Initial release. Created during Stage 0.1 scaffolding, replacing the
  generated stub. Governance workflow, agent roster, and dispatch protocol overrides written
  against design v1.0.

## Acceptance Criteria

- [x] Defined in `agents/pm.md`
- [x] Uses the `extends` pattern (ADR-0033) rather than duplicating the workspace PM
- [x] Carries `lifecycle` frontmatter with `phase` and `governance`
- [x] Validated by `scripts/validate-agents.ts`
- [x] Roster table matches the design's 34-agent contract
- [ ] Remaining 33 agents created (Stage 0.2) and roster table verified against actual files

## References

- Design of record: [`docs/designs/2026-08-19-co-newbiz-design_ko.md`](https://github.com/5throck/ai-workspace-standards/blob/main/docs/designs/2026-08-19-co-newbiz-design_ko.md) (v1.0 Final)
- Spec ID: `2026-08-19-co-newbiz-design-ko`
- Workspace PM: `../../../../../agents/pm.md` (extended, not duplicated)
