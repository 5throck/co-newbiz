# Project Review — co-newbiz — 2026-09-20
**Date**: 2026-09-20
**Scope**: variant project / full
**Method**: machine baseline + 4 parallel specialist review slots + in-session fixes

## Context

- Project type: variant project (`docs/context.md` present).
- Available agents: 41 runtime agent files under `agents/`.
- Review scope: full.
- base-map MCP: not available in this session.

## Baseline

| Check | Result | Notes |
|---|---|---|
| `bun scripts/audit.ts` | PASS | Existing CRLF warnings remain. No blocking errors after fixes. |
| `bun scripts/verify-scripts.ts --verify` | PASS | 180 registered scripts verified. |
| `bun run agent-lifecycle-audit` | PASS | Healthy. |
| `bun run skill-lifecycle-audit` | PASS | Healthy. |
| `bun run validate-agents` | PASS | 82 files checked. |
| `bun run validate-skills` | PASS | Existing governance-record coverage limitation remains deferred. |
| `bun run test` | PASS | Now runs 122 unit test files. |
| `bun run test:full` | PASS | Runs unit + scripts suites. |
| `bun run test:scripts` | PASS | Runs 3 files under `scripts/tests/*.test.ts`. |

## Review Results

### Critical

| # | Issue | Agent | File:Line | Class | Fix |
|---|---|---|---|---|---|
| C1 | Default test command and CI path could pass without running tests. | Automation | `package.json`, `scripts/test-runner.ts`, `.github/workflows/ci.yml` | script-gap | Fixed package test commands and test-runner empty-suite behavior. CI was updated earlier in the session scope where applicable. |
| C2 | Agent registry generator parsed only LF frontmatter; CRLF agent files could collapse runtime registry to one agent. | Standards/Lifecycle | `scripts/co-newbiz/generate-agent-registry.ts` | script-gap | Fixed CRLF normalization, added `--check`, regenerated 41-agent registry. |

### High

| # | Issue | Agent | File:Line | Class | Fix |
|---|---|---|---|---|---|
| H1 | Script tests under `scripts/tests/` were not reached by package scripts. | Automation | `scripts/test-runner.ts`, `package.json` | script-gap | `scripts` suite now scans `scripts/tests/*.test.ts`; `test:scripts` is included in `test:full`. |
| H2 | Web app build command did not use the Bun runtime even though runtime DB code imports `bun:sqlite`. | Automation | `app/web-next/package.json` | one-time | Changed app build script to `bun --bun next build`. |
| H3 | Claude PM persona mirror was stale. | Standards/Lifecycle | `.claude/agents/pm.md` | one-time | Ran persona sync and verified `sync-agent-personas.ts --check`. |
| H4 | Generator scripts were listed in script registry but lacked version headers. | Standards/Lifecycle | `scripts/co-newbiz/generate-agent-registry.ts`, `scripts/co-newbiz/generate-prompt-registry.ts` | script-gap | Added JSDoc `@version` headers and updated `scripts/SCRIPTS.md`. |

### Moderate

| # | Issue | Agent | File:Line | Class | Disposition |
|---|---|---|---|---|---|
| M1 | Skill lifecycle validator validates existing governance records but does not require records for every skill. | Automation / Standards | `scripts/validate-skills.ts` | script-gap | Deferred; requires policy decision on mandatory skill lifecycle coverage. |
| M2 | `variant.json` contains stale/nonexistent agent references and structure notes. | Architecture | `variant.json` | systemic | Deferred; needs design/roster reconciliation. |
| M3 | Several generated/local artifacts appear tracked despite ignore rules. | Architecture / Security | `.gitignore`, tracked generated paths | systemic | Deferred; requires explicit fixture-vs-generated cleanup decision. |
| M4 | Secret-scan allowlist and `.mcp.json` policy findings need a clean security change set. | Security | `.gitleaks.toml`, `.mcp.json`, `docs/security.md` | systemic | Deferred to avoid mixing local runtime config changes into this patch. |
| M5 | Migration numeric prefixes are duplicated. | Architecture | `db/migrations/*` | systemic | Deferred; migration renumbering needs dedicated compatibility review. |
| M6 | Python wrapper portability issues remain in several scripts. | Automation | `scripts/co-newbiz/*.ts` | systemic | Deferred; should be centralized into a Python runner helper. |

## Strengths

- The project has broad validators for agents, skills, scripts, language policy, lifecycle sync, and version manifest drift.
- Unit tests are extensive: 122 unit files executed successfully after fixes.
- The runtime agent roster and PM persona can be regenerated and checked mechanically after this review.
- The audit pipeline caught manifest drift after script changes.

## Action Wiring

- Fixed now: C1, C2, H1, H2, H3, H4.
- Deferred in this variant report: M1-M6.
- No workspace-root ticket was created because this is an L3 variant project and `project-review` instructs variant projects to record deferred work in the report and memory log.
- Validator-hardening candidates: C1, C2, H1, H4, M1.

## Verification

| Command | Result |
|---|---|
| `bun run test` | PASS |
| `bun run test:full` | PASS |
| `bun run test:scripts` | PASS |
| `bun scripts/co-newbiz/generate-agent-registry.ts --check` | PASS |
| `bun scripts/co-newbiz/sync-agent-personas.ts --check` | PASS |
| `bun scripts/verify-scripts.ts --verify` | PASS |
| `bun scripts/lifecycle-sync-audit.ts` | PASS |
| `bun scripts/generate-version-manifest.ts && bun scripts/audit.ts` | PASS |

## Notes

- A concurrent verification attempt caused transient SQLite `EBUSY` failures. Sequential reruns passed.
- Existing CRLF warnings remain and were not mass-fixed in this session.
