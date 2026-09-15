# Project Review — co-newbiz — 2026-09-15
**Date**: 2026-09-15
**Scope**: variant (full) — triggered post template v0.6.0 upgrade (PR #328)
**Method**: machine battery + 2 parallel Explore agents (Architecture+Standards, Docs+Automation) + PM remediation

## Baseline (pre-fix)

| Script | Result |
|---|---|
| `bun scripts/audit.ts` | PASS (all checks) |
| `bun scripts/validate-templates.ts` | 12 errors / 6 warnings — 4 applicable to the variant (MM-01 ×3, P-01 ×1), 8 L1-root-only noise |
| `bun scripts/verify-scripts.ts --verify` | PASS — 157 scripts, 0 warnings |
| `bun run agent-lifecycle-audit` | 41 warnings (stale `last_updated` ×40, missing `role` ×1) |
| `bun run skill-lifecycle-audit` | PASS — 147 skills healthy |
| `bun run agent:verify` | PASS — 41/41 in sync |

## Review Results — co-newbiz — 2026-09-15

### 🔴 Critical (fix immediately)
(none — both agents reported no Critical findings; no secrets, no conflict markers, no broken JSON registries)

### 🟡 High (fix within 1 week) — all fixed in-session
| # | Issue | Agent | File:Line | Class | Fix |
|---|---|---|---|---|---|
| H1 | Duplicate unmarkerized 3-tier model-mapping block in front of the COMMON-GEMINI marked copy (template-merge artifact) | PM/baseline | `GEMINI.md:145-151` | one-time | Removed the unmarked duplicate ✅ |
| H2 | GEMINI.md missing "Project Boundary Policy" section present in CLAUDE.md (P-01 parity FAIL) | PM/baseline | `GEMINI.md` | one-time | Added `### 7. Project Boundary Policy` inside a COMMON-GEMINI block ✅ |
| H3 | Dangling `governance:` references — lifecycle records missing for design-system-agent and i18n-specialist | Architecture | `agents/design-system-agent.md:25`, `agents/i18n-specialist.md:16` | systemic | Created both records in `docs/lifecycle/agents/` following the docs-writer pattern ✅ |
| H4 | Stale roster in variant context file (40/21/9/1 vs actual 41/25/11/2) | Architecture | `docs/meta/co-newbiz.context.md:18-27` | systemic | Synced counts to AGENTS.md ✅ |
| H5 | Dead anchors inherited from L0: AGENTS.md §3.6/§5.1/§5.1.1 sections don't exist in the variant | Docs+Automation | `CLAUDE.md:173,202,212`, `GEMINI.md:138,147,179` | one-time | Retargeted to workspace-root `../../AGENTS.md` anchors; roster link to `#roster-overview` ✅ |
| H6 | Broken ADR links in scripts/SCRIPTS.md (0036/0054 are different topics in this variant) | Docs+Automation | `scripts/SCRIPTS.md:14,18` | script-gap (upgrade tooling should rewrite unresolvable ADR links) | Retargeted to workspace-root `../../docs/adr/` ✅ + deferred item below |

### 🟢 Moderate (fix within 2 weeks) — fixed in-session
| # | Issue | Agent | File:Line | Class | Fix |
|---|---|---|---|---|---|
| M1 | agents/pm.md tier `medium` vs schema/roster `high` (validate-templates WARN) | PM/baseline | `agents/pm.md:8-12` | one-time | All four platform tiers set to `high` ✅ |
| M2 | Missing `role` frontmatter in agents/pm.md | PM/baseline | `agents/pm.md` | one-time | Added role line ✅ |
| M3 | 40 agent files with `last_updated` older than last git commit (upgrade didn't bump frontmatter) | PM/baseline | `agents/*.md` | script-gap (upgrade-project.ts should refresh lifecycle metadata on tree-synced agent files) | Bumped each to its last commit date ✅ + deferred item below |
| M4 | AGENTS.md says "All 39 specialist agents" (41−1=40) | Architecture | `AGENTS.md:104` | one-time | Corrected to 40 ✅ |
| M5 | i18n-specialist lacks `domain:` key (machine consumers count 40, not 41) | Architecture | `agents/i18n-specialist.md` | one-time | Added `domain: _shared` ✅ |
| M6 | Scaffold placeholders in docs/context.md header (`# [Project Name]`, `[One-sentence description...]`) | Architecture | `docs/context.md:1,15` | one-time | Filled with co-newbiz identity ✅ |
| M7 | Language-policy contradiction: unmarked local section denied the agents/skills `lang: ko` exception that the COMMON-CONSTITUTION block grants | Architecture | `docs/context.md:219-221` | one-time | Reconciled local wording with the constitution block ✅ |

### ℹ️ Low / Improvements (deferred — variant project, no L0 ticket tool)
- **validator-hardening: upgrade-project.ts should refresh `last_updated` frontmatter on tree-synced agent files** (M3 class) — would prevent the 40-warning regression on every template upgrade; file at workspace root.
- **validator-hardening: upgrade-project.ts should rewrite or strip unresolvable ADR links in variant SCRIPTS.md** (H6 class).
- SCRIPTS.md instructs `bun run propagate:apply` but the L3 variant defines no `propagate:*` scripts — mark those sections as L0-only content (Docs+Automation finding).
- `git config core.hooksPath` is empty in this clone; hooks only activate after a Claude session initializes them — add a bootstrap/README onboarding step (Docs+Automation finding).
- validate-templates.ts runs 8 L1-root-only checks that always FAIL in an L2 variant (templates/ scaffolding) — consider gating those on project level.

### ✅ Strengths
- Roster integrity: 41 `agents/*.md` exactly match the AGENTS.md roster; all governance references resolve after the fix.
- No PR #328 half-merge debris: zero conflict markers, marker blocks open/close correctly, CHANGELOG documents the upgrade thoroughly.
- Secret hygiene: `.env` untracked, gitleaks CI job, SHA-pinned actions, least-privilege workflow permissions.
- All 157 registered scripts and 34 package.json targets resolve; skill lifecycle 147/147 healthy.

## Verification (post-fix)

- `bun scripts/audit.ts` — ✅ all checks passed
- `bun scripts/validate-templates.ts` — project-relevant errors 12 → 0 (remaining 8 are L1-root-only scaffolding checks inapplicable to this L2 variant)
- `bun run agent-lifecycle-audit` — 41 → 0 warnings
- `bun run agent:verify` — 41/41 in sync, 0 orphaned
- `bun scripts/verify-scripts.ts --verify` — 157 scripts, 0 warnings

## Action wiring

- Fixed in-session: H1–H6, M1–M7 (all Critical/High with clear fixes).
- Deferred (variant has no `ticket.ts`): the two `validator-hardening:` items and the two Low items above — recorded here and in `memory/2026-09-15.md` for the workspace-root backlog triage.
