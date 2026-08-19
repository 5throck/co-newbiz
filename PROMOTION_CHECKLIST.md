# PROMOTION_CHECKLIST.md — Phase B Promotion Conditions

| # | Condition | Verification | Status |
|---|-----------|--------------|--------|
| 1 | All agents defined with 3-Section structure | bun run agent:verify | Pending |
| 2 | All domain SKILL.md files completed | bun scripts/validate-skills.ts | Pending |
| 3 | Domain workflows completed with legal_basis field (if applicable) | bun scripts/audit.ts | Pending |
| 4 | Audit script passes with 0 errors | bun scripts/audit.ts | Pending |
| 5 | AGENTS.md updated with variant agent roster | bun run agent:verify | Pending |
| 6 | Platform parity validated (CLAUDE.md ↔ GEMINI.md) | From workspace root: run template parity check (L0-only script) | Pending |
| 7 | _ORIGIN.md Phase B manual steps reviewed | Human review | Pending |
