## Why

Template upgrade 0.23.0 -> 0.25.0 for co-newbiz (wave batch C, following the co-news canary PR #18). This run also lands the changelog-gate heal path: dev-sync upgraded to v1.37.0 (>= v1.36.0) carries the fail-then-heal changelog gate that blocked co-newbiz's earlier 0.23.0 attempt (3 hits, superseded PR #778 — that PR is unrelated workspace sync and is ignored here).

## What Changed

- Template version stamp: `template-version.txt` 0.23.0 -> 0.25.0 (variant=co-newbiz, platform=all, country=KR)
- Delivered files: 7 locked + 8 merge + 21 sync + 2 tree-sync; decision log 268 entries (INFO 166 / WARN 102 / ERROR 0), security checks PASSED
- New scripts delivered by 0.25.0: `scripts/changelog-normalize.ts`, `scripts/helpers/changelog-duplicates.ts`, `scripts/helpers/spec-header-consistency.ts`, `scripts/lib/generator-manifest.ts`, `scripts/route-audit-scan.ts`
- dev-sync upgraded to v1.37.0 (brings the changelog-gate fail-then-heal loop and the spec-header-consistency helper)
- `docs/workspace-schema.json` adopted from template (routeAudit block added — generalized from co-newbiz PR #742 FR-SEC-07; designLint description extended with U-20261028-014 variant.json override note)
- `.github/workflows/ci.yml` template `on`/`permissions` accepted (adds `workflow_dispatch` manual trigger; trigger branches unchanged; project PROJECT-JOBS region preserved)
- Regenerated derived artifacts: `docs/VERSION_MANIFEST.md`, `scripts-snapshot.json`, skill mirrors

## Test Plan

- Pre-upgrade baseline: audit PASS on clean main; dry-run 0.23.0 -> 0.25.0 with 0 ERRORs
- Upgrade run 1 blocked at ci.yml MIGRATION_UNSAFE (fail-closed, nothing written); diff reviewed — only `on:` block differs; re-run with `--accept-ci-perm-diff` (project jobs live inside PROJECT-JOBS markers and were preserved)
- `docs/workspace-schema.json` CONFLICT (project-evolved vs template-changed): diff reviewed — template side is a strict superset of the project side (only difference is the older designLint description, superseded verbatim-plus-extension); no project-authored content lost; adopted via `--disposition adopt-template=docs/workspace-schema.json`
- CHANGELOG: single `## [Unreleased]` heading confirmed pre- and post-dev-sync
- Pre-existing unit-test time-bomb fixed: `tests/unit/flows-api.test.ts` fixture dates were fixed constants (2026-10-01/15/20) while the `window=30d` summary rolls with the current date — OLDER aged out of the window on 2026-10-31 (summary.calls 3->2). Failure reproduces identically on pristine main (verified via stash); fixtures converted to now-relative offsets (now-20d/10d/5d, ordering preserved) and the cursor expectation now references the MID constant. 16/16 tests pass.
- Spec header/registry drift fixed (surfaced by the new 0.25.0 spec-header-consistency gate): `2026-09-25-agents-md-section6-alignment-design` and `2026-10-11-companies-list-exclude-group-affiliates-design` doc Status headers moved to `implemented` (both shipped — §6 landed; PR #509), stale registry `draft` flipped via `spec-register.ts --update`
- CHANGELOG.md Korean-exception frontmatter added (`lang: ko` + `lang_reason: source-material`): the changelog is historically Korean (167 Korean lines; co-newbiz operates in Korean) and the language gate requires a declaration for Korean content in official documents. Uses the validator's documented README_ko precedent; changelog-normalize `--check` stays green with frontmatter present.
- All dev-sync gates pass (audit, spec-check, language-guard, gitleaks, pre-commit hook); no `--no-verify`

## Security Checklist

- [x] No secrets or credentials added (security checks PASSED during upgrade; gitleaks gate passed at dev-sync)
- [x] No CI/CD pipeline permission changes (ci.yml trigger addition only; `permissions: contents: read` retained)
- [x] UTF-8 encoding preserved throughout (no encoding corruption introduced)
- [x] `--no-verify` not used; all hooks ran

## Notes

- 102 WARN entries in the decision log are informational: 92 MERGE_MANAGED census rows (EVOLVED_REGION / TEMPLATE_AHEAD_REGION port-candidates in CLAUDE.md / GEMINI.md / CODEX.md / HERMES.md — project-authored spans preserved) and 10 SYNC_IF_NEWER skill rows.
- 1 LOCAL-PATCH marker reported (pre-existing project content, untouched).
- W2 harvest candidates: 0. Country skills pruned: 0.
- Out-of-template fixes carried in this delivery (disclosed): the fixture time-bomb fix and the two spec-status alignments above — both pre-existing project issues that blocked dev-sync gates and are prerequisites for landing the template delivery.
