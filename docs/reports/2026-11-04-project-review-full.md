# Project Review — co-newbiz — 2026-11-04

**Date**: 2026-11-04
**Scope**: full (variant project; four paired review slots + machine battery)
**Method**: 4 parallel review agents (Architecture/Scaffolding, Standards/Lifecycle, Automation, Docs/Security) + the project's own validator battery

> This review **applied fixes in-session** and then verified them. Four findings were fixed
> (see Action Wiring), three were filed upstream as suspected template defects, and the
> remainder were deferred with the reasons recorded. Unlike an analysis-only report, the
> Verification section below reflects the post-fix state.

---

## Baseline (pre-fix, machine battery)

| Validator | Result |
|---|---|
| `bun scripts/audit.ts` | ALL PASS — with one recurring WARN: "No variant declares an audit-variant hook in `script_manifest.local`" (false positive; see M4) |
| `bun scripts/validate-templates.ts` | N/A — variant context, no `templates/common` |
| `bun scripts/verify-scripts.ts --verify` | 277 registered scripts verified, 0 warnings |
| `bun run agent-lifecycle-audit` | 41 agents scanned, **34 warnings** — all "frontmatter `last_updated` older than the last git commit", all dated to the one bulk sync commit (see M5) |
| `bun run skill-lifecycle-audit` | 108 skills scanned, **83 warnings** — all "no lifecycle record for an active skill" (see C1) |
| `bun scripts/validate-docs-links.ts` | exit 0 |
| Secrets scan (source, docs, workflows) | Clean — no hardcoded credentials |
| Tracked `.env` files | Only `.env.sample` ×2; `.gitignore` covers `.env` / `.env.*` |
| `eval()` in source | None (only `node_modules` type definitions) |
| Commit language policy | Compliant — last 20 subjects English, conventional-commit style |

No ≥3 ERROR condition, so the review proceeded to the full four-slot dispatch.

---

## Findings

Class values drive the wiring: `one-time` (instance drift), `systemic` (recurring, needs
judgement), `script-gap` (a machine could and should have caught it).

### 🔴 Critical

| # | Issue | Agent | File:Line | Class | Fix |
|---|---|---|---|---|---|
| C1 | 75 of 108 active skills have no lifecycle record — including actively maintained ones. `docs/lifecycle/skills/` holds 8 records against 108 skills. `skills/regional-incentive-sourcing/SKILL.md` is `status: active`, stale since `last_reviewed: 2026-08-23`, and is wired as `required_skills` in `agents/greenfield-agent.md:27` plus load-bearing in `agents/incentive-agent.md`, `agents/site-facility-agent.md`. `skills/growth-projection-modeling/SKILL.md` was reviewed 2026-10-28 and still has no record — so the gap is not confined to stale skills. The project already ruled these mandatory: `docs/lifecycle/skills/handbook.md` cites backfill "per 2026-09-21 project review H-9", then stopped at 8. | Standards | `docs/lifecycle/skills/`, `skills/*/SKILL.md` | systemic | Batched backfill using the handbook record's template (Created / Phase History / Acceptance Criteria / Metadata, approver pm), tiered by `required_skills` wiring first; plus a creation-flow gate so a new active skill cannot ship record-less. Deferred D1. |

### 🟡 High

| # | Issue | Agent | File:Line | Class | Fix |
|---|---|---|---|---|---|
| H1 | `bun run test:scripts` is a silent no-op. The suite scanned top-level `scripts/` for `test-*.ts`, whose only match was the self-excluded runner; the three real tests under `scripts/tests/` matched no suite, and an empty suite returned PASS — so CI's "Run script tests" step passed vacuously. Regression: the 2026-09-20 review fixed exactly this, and `SCRIPTS.md` still documented the fixed behaviour. | Automation | `scripts/test-runner.ts:152`, `:190-204` | script-gap | **FIXED** — suite scans `scripts/tests/*.test.ts`; uniform extension matching; empty suite now hard-fails unless `--allow-empty` |
| H2 | The project's own extends validator rejects the project's canonical `extends:` pattern. `agents/pm.md:2` / `agents/docs-writer.md:2` extend `../../../agents/pm.md`, whose targets exist at the workspace root and are documented as the upgrade contract — but `safeValidateExtends()` derives its boundary from `process.cwd()`, so from the project root it exits 1 with `security_violation: Path traversal attempt detected`. | Architecture | `scripts/helpers/security-validator.ts:119`, `scripts/helpers/extends-validator.ts:121,317` | script-gap | Upstream **U-20261104-002** — detect the workspace root by walking up for the marker, or thread it through |
| H3 | Deferred review findings have no trackable carrier. `docs/reports/2026-10-26-project-review-s1-s12.md:122` records that "ticket.ts is L0-only, so deferred items live in this report and the memory log"; the 2026-10-27 shadow review's four owner preconditions exist only as report prose. | Standards | `docs/reports/*.md`, `scripts/ticket.ts` | systemic | A `docs/reports/open-findings.md` ledger with stable IDs, or raise `ticket.ts` to L1. Deferred D2. |
| H4 | The skill-usage evidence channel is empty, blinding skill triage. `memory/skill-review/2026-11-03.md` reports `observation_count: 0` — "`## Skills Used` absent or empty". | Standards | `memory/skill-review/*.md` | script-gap | Enforce a `## Skills Used` section in daily memory logs (template or script check) so `scripts/skill-session-review.ts` gets input. Deferred D3. |
| H5 | CI `test` job drifted from every other job: `bun-version: latest` against `1.4.x` elsewhere, no `timeout-minutes` (others use 15), and a duplicated `bun run test:unit` although the `unit-tests` job already ran it — while its script-test step was the H1 no-op. | Automation | `.github/workflows/ci.yml:164-182` | one-time | **FIXED** — bun pinned `1.4.x`, `timeout-minutes: 15`, duplicated unit step removed |

### 🟢 Moderate

| # | Issue | Agent | File:Line | Class | Fix |
|---|---|---|---|---|---|
| M1 | `docs/co-newbiz.context.md` was stale against the SSOT: cited `flow.spec.yaml` v2.10.1 against an actual 2.17.0; claimed "105 skill directories / 91 registered" against an actual 108 live dirs and a 157-row registry. | Architecture | `docs/co-newbiz.context.md:36,60` | one-time | **FIXED** — v2.17.0; 108 live / 157 rows with sources named |
| M2 | `scripts/typecheck.ts` was a permanently self-skipping gate. It reads `scripts/helpers/typecheck-baseline.json`, which did not exist on disk and never existed in HEAD, so it printed `[SKIP] … no baseline file` and exited 0 on every run while `scripts/dev-sync.ts:935` invoked it and its docstring claimed any type error fails. | Architecture | `scripts/typecheck.ts:47`, `scripts/dev-sync.ts:935` | script-gap | **FIXED** — baseline file created; gate made real. **Honest finding: 84 pre-existing type errors** surfaced (bulk in `tests/unit/*`), recorded at the true count so the gate is regression-only. Triage-to-zero deferred D4. |
| M3 | The uncommitted working tree is coherent in-progress work, not debris: the cron-picker follow-on to merged PR #800 (an `aria-labelledby` checkbox chip group replacing `<select multiple>`, `whitespace-nowrap` fixes) with its test updated in lockstep (26/26 pass, `tsc` clean), plus 3 untracked `gui-test-screenshots/*.png`. | Architecture | `tests/unit/schedule-cron-picker.test.ts:337-352` | one-time | Resolved by the owning session (landed as PR #801). The screenshot residue was lost with the tree. |
| M4 | `audit.ts` §28 emits a permanent false-positive WARN in variant layouts: the variant hook IS declared in the root `variant.json` and IS executed by §27, but §28 sweeps only `templates/co-*/variant.json`, so `hookCount === 0` here. Recurring noise desensitizes the team to real warnings. | Automation | `scripts/audit.ts:3296-3338` | script-gap | Upstream **U-20261104-001** — skip when the root manifest already declares and §27 ran the hook, or sweep the root manifest |
| M5 | Bulk workspace sync does not bump frontmatter `last_updated`, so a mechanical rewrite leaves 34 agent-lifecycle warnings. Traced to one commit (`0b1a406c`, 2026-10-28) that rewrote `tier:` in ~34 agent files without touching the date. | Standards | `agents/*.md` frontmatter | script-gap | Upstream **U-20261104-003** — bump on rewrite, or teach the audit to ignore pure formatting rewrites |
| M6 | `scripts/SCRIPTS.md`'s test-runner entry documented v1.5.0 behaviour the code no longer had (the `scripts/tests` scan). `verify-scripts` validates the registry, not behavioural claims, so the drift went unnoticed. | Automation | `scripts/SCRIPTS.md:219` | one-time | **FIXED** — entry realigned to the restored code |

### ℹ️ Low

| # | Issue | Agent | File:Loc | Class | Fix |
|---|---|---|---|---|---|
| L1 | Partial `stack-form` migration in the admin console: the schedule dialogs moved to `flex flex-col gap-4` while `stack-form`/`stack-form-row` remain in `ScheduleCronField.tsx`, `WatchesSection.tsx`, `OpsSections.tsx`, `WatchRuleForm.tsx`, `TestSendDialog.tsx` and `styles.css`. Two layout idioms now coexist on one surface. | Architecture | `app/web-next/components/admin/console/*` | systemic | Pick one direction before the next UI pass. Deferred D6. |

### ✅ Strengths

- **Agent roster is exact and referentially sound**: 41 agents (43 files − 2 READMEs) matching `AGENTS.md` and the context table (1 core + 25 functional + 11 technical + 1 industry + 1 region + 2 shared); every path cited in `AGENTS.md` exists.
- **Skills tree is complete and mirrored**: 108/108 dirs carry a `SKILL.md`; `diff -rq skills .agents/skills` is byte-identical except manifests — zero mirror drift across 161 tracked files.
- **Process authority layering holds**: `process/flow.spec.yaml` (v2.17.0, S1–S12, seven human gates), `stages.yaml`, `cross-validation-matrix.yaml`, `_committees.yaml`, `_human-roles.yaml` all present; all 24 `agent:` keys and 30 distinct `agent_key:` values resolve to the roster or to named human/committee roles; `tests/unit/process-flow.test.ts` 25/25.
- **Unit suite is green and fast**: 422 files, ~65 s, with strong coverage of the risky scripts (`backup-restore`, `db-export`, `db-integrity`, `scheduler-p1/p2`, `route-audit-scan`, `process-ssot-check`).
- **CI posture is strong**: six workflows; actions pinned by commit SHA; `permissions: contents: read`; `persist-credentials: false`; gitleaks with a digest-pinned image; fail-closed dependency audit with an explicit waiver channel.
- **Agent-side governance is complete**: 41/41 lifecycle records, with a genuine phase history.
- **The decision trail closes**: all 55 DEC files present, every `DEC-YYYYMMDD-NN` reference in memory logs resolves; deviations are logged with equivalence justification rather than smoothed over.
- **Language policy is enforced and self-consistent**, including the documented source-material exception.
- **TODO debt is disciplined**: ~20 `TODO`/`FIXME` hits in `scripts/`, nearly all dated `TODO(promotion):` markers tied to ADRs/tickets.

---

## Action Wiring

### Fixed this session

Design: `docs/designs/2026-11-04-review-hardening-design.md` · Decision: `DEC-20261104-01`.

| Finding | Fix |
|---|---|
| H1 | `scripts/test-runner.ts` v1.11.0 — `scripts` suite scans `scripts/tests/*.test.ts`; scripts-only name special-case deleted; dead `bun-script` exec mode removed (suite members now run under `bun test --timeout` like every other suite); empty suite hard-fails unless `--allow-empty` |
| M6 | `scripts/SCRIPTS.md` test-runner row → 1.11.0 with the restore note, `--allow-empty` flag, `test:scripts` alias |
| M2 | `scripts/helpers/typecheck-baseline.json` created — gate made real. Revealed 84 pre-existing type errors; recorded at the measured count (regression-only) |
| H5 | `.github/workflows/ci.yml` `test` job — bun pinned `1.4.x` with the sibling comment convention, `timeout-minutes: 15`, duplicated unit step removed |
| M1 | `docs/co-newbiz.context.md` — flow.spec v2.17.0; 108 live skills / 157 registry rows, sources named; Refreshed line dated |

Projections regenerated: `docs/VERSION_MANIFEST.md`.

### Filed upstream (suspected L1 template defects — no local patch applied)

| ID | Symptom |
|---|---|
| U-20261104-001 | `audit.ts` §28 variant-hook WARN is a permanent false positive in variant layouts |
| U-20261104-002 | `extends-validator` derives the workspace boundary from `process.cwd()` and rejects legitimate workspace-root `extends:` |
| U-20261104-003 | Workspace sync rewrites frontmatter without bumping `last_updated` |

### Deferred (variant project — `ticket.ts` is L0-only; tracked here and in the session memory log)

| ID | Item | Priority |
|---|---|---|
| D1 | Backfill the 75 missing skill lifecycle records; add a creation-flow gate | **high** |
| D2 | Deferred-findings ledger (`docs/reports/open-findings.md`, or raise `ticket.ts` to L1) | normal |
| D3 | Enforce `## Skills Used` in daily memory logs so skill triage has input | normal |
| D4 | Triage the 84 type errors to 0 (bulk in `tests/unit/*`), then tighten the baseline | normal |
| D6 | Decide the `stack-form` migration direction in the admin console | low |
| D7 | `bun scripts/validate-doc-folder.ts` fails standalone on a missing `docs/constitution/` and is not wired into the audit battery (standalone-failing validator, possible script-gap) | low |

---

## Verification (post-fix)

| Check | Result |
|---|---|
| `bun run test:scripts` | 3 test files found and passed, exit 0 |
| Empty-suite guard | `integration` without the flag → exit 1 with the naming error; with `--allow-empty` → exit 0 |
| `bun run test:unit` | full suite green |
| `bun scripts/typecheck.ts --summary` | real run (no `[SKIP]`), 84 / 84, delta 0 |
| `bun scripts/verify-scripts.ts --verify` | 277 scripts, 0 warnings |
| `bun scripts/audit.ts` | ALL PASS |
| `bun scripts/validate-decisions.ts` | new DEC valid (4 unrelated pre-existing errors remain in 2026-10-13 records) |
| `bun run lint:i18n` | PASS — Korean-line, dotted-key, and the new dynamic-key coverage check |

---

## Ratchet Note

Three `script-gap` classes landed as standing checks this session: the empty-suite guard
(closes the silent-suite-pass class), the real typecheck baseline (closes the
gate-that-skips class), and the registry text realignment (keeps the documented behaviour
of a gate tied to its code).

Four `script-gap` findings did **not** land and must reappear as machine baseline items in
the next review, or the hardening failed: H2 (extends boundary), H4 (skills evidence),
M4 (audit §28 WARN), M5 (sync `last_updated`). H2/M4/M5 await the upstream fixes; H4 is
D3.

---

## Recovery Note

The working tree was destroyed three times during this session by a concurrent session's
bulk working-tree restores, escalating from revert to total directory loss including
`.git`. This report was rebuilt after the third destruction from the GitHub HEAD
(`46bc9a00`) plus the authoring session's context. Two figures necessarily differ from
the pre-loss measurements: the typecheck baseline records **84** measured errors at
`46bc9a00` rather than the 83 measured on the pre-loss tree, and the three
`gui-test-screenshots/*.png` files referenced by M3 were untracked and are unrecoverable.
Every other finding, evidence path, and verification result above was verified against
the committed tree after recovery.
