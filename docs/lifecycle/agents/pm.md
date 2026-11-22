# Agent Governance Record — pm

## Overview

- **Agent Name**: pm
- **Formal Name**: Project Manager (PM) Agent
- **Role**: New Business Review Lead — variant override extending the workspace PM template; orchestrates multi-agent workflows and enforces the PM Gateway quality gates
- **Phase**: production
- **Domain**: `_core`
- **Tier**: Medium (session-hosted tier is a capability floor — a higher session model is allowed)

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
- **2026-08-29**: v1.1.0 — variant/country identity declared (`template-version.txt`,
  `ACTIVE.md`); KR-scoped skills preserved through the upgrade wave (commit 4d6793e6).
- **2026-09-08**: v1.2.0 — harness entry-point alignment: PM learned the deal pipeline
  (S1–S12 orchestration) and the agent-roster counts were corrected (commit c506408b).
- **2026-09-15**: Post-upgrade project-review remediation; tier floor wording settled at
  Medium (commit 949106e6).
- **2026-09-30**: Frontmatter `role` standardized to the workspace PM orchestrator role; the
  New Business Review Lead designation remains the project roster description in AGENTS.md
  (commit a66f2446).
- **2026-11-18**: Frontmatter `last_updated` bumped in the template 0.30.0 wave preparation
  (version stays 1.2.0).
- **2026-11-19**: Template 0.30.0 wave delivery (T-20261119-002 adjudication applied,
  commit fab615c9): the Finalization clause now dispatches `/sync` to `automation-engineer`
  (PM never runs `/sync` itself and never merges; landing is verified with read-only checks),
  the Bash read-only allowlist gains `git show` / `gh pr view` / `gh pr checks`, and the
  retired `/meeting` slash command is renamed to the `meeting-facilitation` skill. The change
  fired the agent-mirror parity gate until the `.claude/agents/pm.md` mirror was re-synced.

## Acceptance Criteria

- [x] Defined in `agents/pm.md`
- [x] Uses the `extends` pattern (ADR-0033) rather than duplicating the workspace PM
- [x] Carries `lifecycle` frontmatter with `phase` and `governance`
- [x] Validated by `scripts/validate-agents.ts`
- [x] Roster table matches the design's 34-agent contract
- [x] Remaining 33 agents created (Stage 0.2) and roster table verified against actual files
  (roster has since grown to 45 agents; `bun run agent:verify` green)

## References

- Design of record: [`docs/designs/2026-08-19-co-newbiz-design_ko.md`](https://github.com/5throck/ai-workspace-standards/blob/main/docs/designs/2026-08-19-co-newbiz-design_ko.md) (v1.0 Final)
- Spec ID: `2026-08-19-co-newbiz-design-ko`
- Workspace PM: `../../../../../agents/pm.md` (extended, not duplicated)
