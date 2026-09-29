# Project Review — co-newbiz — 2026-09-30
**Date**: 2026-09-30
**Scope**: variant project (co-newbiz), health pulse
**Method**: baseline-only (machine battery + PM lightweight check); follow-up remediation dispatched via PM Gateway (infra-automation-engineer, docs-writer)
> Fixes for H1 and M1–M3 were applied in the same session (see Verification). Analysis section below is the pre-fix state.

## Baseline

| Check | Result |
|---|---|
| `bun scripts/audit.ts` | PASS (1 WARN: no variant declares an audit-variant hook — informational) |
| `bun run skill-lifecycle-audit` | PASS — 105/105 skills healthy |
| `bun run agent-lifecycle-audit` | 0 errors, 3 WARN (see M1, M2) |
| `bun scripts/verify-scripts.ts --verify` | PASS — 191 registered scripts, 1 WARN (see M3) |
| `bun scripts/validate-templates.ts` | CRASH — ENOENT in `checkCommonAgentsBlockParity` (see H1) |
| `bun run design:lint` | PASS — no violations |
| `bun run test:unit` | PASS |
| `tsc --noEmit` (app/web-next) | PASS — no output |
| git tree | clean, `main` at 72bee948 (template sync v0.8.1) |

`review-baseline.ts` (the consolidated runner named in the skill) does not exist in this project, so validators were run individually. `propagate-to-templates.ts --check-drift` was not run (workspace-root script, not present here).

## Findings

### 🟡 High
| # | Issue | File:Line | Class | Fix |
|---|---|---|---|---|
| H1 | `validate-templates.ts` crashes in a variant project: it expects `templates/VERSION`, `docs/templates/lifecycle-governance.json`, and a common agents block that only exist at L0. Carried over unfixed from the 2026-09-22 review (D1). | scripts/validate-templates.ts:4662 | script-gap | Make the script detect L1/L3 context and skip L0-only checks; fix at the L0 source and resync. Until then, drop it from the project-review baseline list for variants. |

### 🟢 Moderate
| # | Issue | File:Line | Class | Fix |
|---|---|---|---|---|
| M1 | `agents/pm.md` has no `role` frontmatter, and its `last_updated` (2026-09-18) is older than its last commit (2026-09-20). | agents/pm.md | one-time | Add `role:`; bump `last_updated`. |
| M2 | `agents/i18n-specialist.md` `last_updated` (2026-09-25) is older than its last commit (2026-09-29). | agents/i18n-specialist.md | one-time | Bump `last_updated`. |
| M3 | `regenerate-agents-md.ts` declares pair `L0` but is not in the script registry. | scripts/SCRIPTS.md | one-time | Register it or drop the pair declaration. |

### ℹ️ Low / Improvements
- `agent-lifecycle-audit` reports "Agents scanned: 2" although `agents/` holds 43 files. Either the scan filter is narrower than intended or the count is misleading; the audit may not be covering the roster. Worth confirming (candidate `script-gap`).
- Still open from 2026-09-22: D2 (engine/fallback provenance in the comparison view), D3–D6 (efficiency, error taxonomy, activity ids), D4 (admin read/write product decision), D7 (dangling `extends` in sibling `agents/pm.md`), D8 (CI unit-test job recurrence). Not re-evaluated here.

### ✅ Strengths
- Everything functional is green: audit, skills, design-lint, full unit suite, and web typecheck.
- Skill registry, VERSION_MANIFEST, skill graph, and model registry gates all match their sources.
- No language-policy violations across 418 official files; no banned `> nul` redirects; workflow permissions clean.

## Action wiring
`scripts/ticket.ts` is L0-only, so no tickets were created. Deferred items are recorded here:
- H1 → validator-hardening: make `validate-templates.ts` degrade gracefully in variant context (same as D1).
- Low item on `agent-lifecycle-audit` scan count → validator-hardening candidate pending confirmation.
- M1–M3 → one-time fixes, batchable into a single small PR.

## Verification
All results below were re-run by the PM after the fixes.

- `bun scripts/audit.ts`: PASS (all checks passed). Only non-blocking WARNs remain: no audit-variant hook; `docs/context.md` and `docs/project.md` still contain scaffold placeholders; two research files lack `## References`. These WARNs are pre-existing and out of scope.
- `bun run agent-lifecycle-audit`: all 41 agents healthy (was: scanned 2).
- `bun scripts/verify-scripts.ts --verify`: 191 scripts, 0 warnings.
- `bun scripts/validate-templates.ts`: exit 0, prints "not applicable: no templates/common (variant/project context)".
- `bun run test:unit`: pass (new `tests/unit/script-registry-audit.test.ts`, 2 tests).

## Resolution

| # | Status | What changed |
|---|---|---|
| H1 | Fixed | Early return in `scripts/validate-templates.ts` for variant/project context (v1.50.2). |
| M1 | Fixed | `agents/pm.md` role added; `last_updated` refreshed. Root cause also fixed: `scripts/agent-lifecycle-audit.ts` v1.4.0 now discovers every `agents/*.md`. This surfaced 39 agents lacking `tier.gemini-cli`/`antigravity` and with stale `last_updated`; both were backfilled in their frontmatter. |
| M2 | Fixed | `agents/i18n-specialist.md` `lifecycle.last_updated` refreshed. |
| M3 | Fixed | `regenerate-agents-md.ts` registry row had a stray column; layer set to L0+L1. Root cause also fixed: `scripts/verify-scripts.ts` v1.10.0 rejects registry rows whose column count is not 8. `docs/VERSION_MANIFEST.md` regenerated. |

## Fleet / upstream follow-ups

- `agent-lifecycle-audit.ts`, `verify-scripts.ts`, and `validate-templates.ts` are L0+L1 propagated. The local fixes will be overwritten by the next template sync until they are applied at the L0 source.
- The same three defect classes likely exist in every sibling project: role-less agents invisible to the audit, malformed registry rows going unchecked, and `validate-templates` crashing outside L0/L1.
- Systemic cause of stale `last_updated`: template-sync commits touch agent files without bumping `last_updated`.
