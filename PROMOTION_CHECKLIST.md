# PROMOTION_CHECKLIST.md — Phase B Promotion Conditions

> ## ⛔ PROMOTION HOLD — explicit user approval required
>
> **This project MUST NOT be promoted to a variant template
> (`templates/co-newbiz/`) without the user's explicit permission**, even if
> every condition below shows Done. The readiness gate
> (`bun scripts/validate-variant-readiness.ts`) verifies technical readiness
> only — it is not a permission grant. Any promotion request must be presented
> to the user and approved in plain language before
> `l3-to-variant-pipeline.ts` is run.
>
> — Recorded 2026-08-29 by standing directive.

| # | Condition | Verification | Status |
|---|-----------|--------------|--------|
| 1 | All agents defined with 3-Section structure | bun run agent:verify | Pending |
| 2 | All domain SKILL.md files completed | bun scripts/validate-skills.ts | Pending |
| 3 | Domain workflows completed with legal_basis field (if applicable) | bun scripts/audit.ts | Pending |
| 4 | Audit script passes with 0 errors | bun scripts/audit.ts | Pending |
| 5 | AGENTS.md updated with variant agent roster | bun run agent:verify | Pending |
| 6 | Platform parity validated (CLAUDE.md ↔ GEMINI.md) | From workspace root: run template parity check (L0-only script) | Pending |
| 7 | _ORIGIN.md Phase B manual steps reviewed | Human review | Pending |
