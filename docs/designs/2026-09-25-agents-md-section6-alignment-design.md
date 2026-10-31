# Add §6 Skills pointer section + transitional §7 numbering (pre-promotion alignment)

- **Date**: 2026-09-25
- **Status**: implemented (one-design-doc convention, ADR-0074; workspace-mandated remediation; header aligned to registry per T-20261029-002)
- **Spec**: 2026-09-25-agents-md-section6-alignment

Background: co-newbiz is a standalone-track project slated for variant promotion (project-to-variant). Its AGENTS.md had no §6, so audit #29 skipped. Evidence: docs/analysis/2026-09-25-agents-md-duplication-audit.md F7; user ruling: promote-ready, not a permanent exception.
Change: add `## §6: Skills` as a pointer to the project registry (skills/SKILLS.md, 105+ skills — no table duplication) and align `## Governance` → `## §7: Governance` as the checker's terminator. Full §1–§7 skeleton alignment happens at promotion; the transitional numbering is noted in-section.

## Verification

- Rescan: every project AGENTS.md carries `^## §6: Skills` with a following `^## §7:` heading (checker span).
- Workspace gates: `bun scripts/audit.ts`, `bun scripts/validate-templates.ts` green after the batch lands.
