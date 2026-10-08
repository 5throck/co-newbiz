# Design: Wave A quality gates (typecheck, lint, coverage, CI, hygiene)

- **Spec ID**: 2026-10-08-wave-a-quality-gates
- **Date**: 2026-10-08
- **Status**: implemented
- **Owner**: platform-lead (technical domain)
- **Scope**: root `tsconfig.json`, `biome.json`, coverage baseline, `.github/workflows/quality.yml`, `.gitignore` / repo hygiene, one upstream report

## Context

Measured on 2026-10-08:

- No root `tsconfig.json`. `db/`, `mcp/`, `scripts/`, `tests/` are never typechecked. A strict check of `db/**` + `mcp/**` (bundler resolution, `allowImportingTsExtensions`, `types: ["bun"]`) yields 4 errors: TS2393 x2 (duplicate function implementation), TS2459 (symbol not exported), TS2345 (argument type mismatch). `scripts/` and `tests/` are unmeasured.
- `app/web-next` passes `tsc --noEmit` with 0 errors (own tsconfig; out of scope for config changes, only wired into CI).
- No linter or formatter (no ESLint, Biome, Prettier).
- No coverage measurement. 134 unit test files, ~1,348 cases, all green in ~15 s (`bun run test:unit`).
- `.github/workflows/ci.yml` is template-managed (L1) and must not be edited.
- Hygiene: `s4-decision-tab.png`, `s4-eval-tab.png`, `s4-fact-grid.png` and 8 files under `gui-review-screenshots/` are tracked. `detail-dart.png` / `detail-standard.png` and `backups/` are **already ignored** by `.gitignore` (lines 102-106) and not tracked — no action needed beyond verification.
- `scripts/dev-sync.ts` (core standardized script) emits low-information `chore: update` commit subjects.

## Goals

1. Every TypeScript tree in the repo is typechecked in CI; new type errors are blocked.
2. Consistent format and lint with a no-new-violations rule, without a big-bang reformat.
3. Coverage is measured, recorded, and ratcheted upward toward 70%.
4. A single project-owned workflow runs all of the above on every PR.
5. Repo root is free of stray binary evidence files.

## Non-goals

- Editing `ci.yml`, `scripts/dev-sync.ts`, or any other L1/template-managed file.
- Fixing existing `scripts/` / `tests/` type errors or existing lint violations (baselined, burned down later).
- Changing `app/web-next/tsconfig.json` or its lint setup (design-lint stays as is).
- E2E/Playwright coverage; branch-protection settings (owner action, see Rollout).

## Design per item

### 1. Root tsconfig

- New `tsconfig.json` at repo root: `strict: true`, `noEmit: true`, `module: "esnext"`, `moduleResolution: "bundler"`, `allowImportingTsExtensions: true`, `types: ["bun"]`, `skipLibCheck: true`.
- `include`: `db/**/*.ts`, `mcp/**/*.ts`, `scripts/**/*.ts`, `tests/**/*.ts`. `exclude`: `node_modules`, `app/**` (web-next has its own project), `graft/`, `.venv`, `backups/`, generated outputs.
- Two configs so the strict trees and the baselined trees are distinguishable:
  - `tsconfig.json` — everything (developer IDE view).
  - `tsconfig.core.json` (extends root) — `db/**` + `mcp/**` only; must be **0 errors**, gate is hard.
- Fix the 4 db/mcp errors in the implementation PR (TS2393: remove/rename the duplicate implementation; TS2459: export or re-point the import; TS2345: correct the argument type, no `as any`).
- **Baseline mechanism for `scripts/` + `tests/`**: new `scripts/typecheck-baseline.ts` runs `tsc -p tsconfig.json --noEmit --pretty false`, parses diagnostics to `{file, code}` and compares against `quality/typecheck-baseline.json` (a map `"file|TSxxxx" -> count`). CI fails if any key's count increases or a new key appears. A decrease prints a reminder to run `--update`, which rewrites the file (must be committed). Line numbers are intentionally excluded so unrelated edits do not churn the baseline.

### 2. Biome (format + lint)

- Add `@biomejs/biome` as a pinned exact devDependency; `biome.json` at root with recommended rules, formatter matching current dominant style (2-space, double quotes — verify by sampling before commit).
- `files.includes`: `db/**`, `mcp/**`, `scripts/**`, `tests/**`, `app/web-next/**` (`.ts`, `.tsx`, `.js`, `.json`).
- Excludes: `node_modules`, `graft/`, `.venv`, `backups/`, `.next/`, `render_out/`, `next-env.d.ts`, generated files (prompts-registry output, `*.generated.*`, generated READMEs), lockfiles, `.claude/`, `.gemini/`.
- **Baseline**: no reformat of existing code. CI runs `biome ci` with `--changed --since=origin/main` so only files touched by the PR are checked; touched files must be clean (format + lint). This is a "boy-scout" ratchet: the violation set can only shrink. A full-repo `biome check` report is uploaded as an artifact (non-blocking) to track the burn-down count.
- Rules that conflict with existing intentional patterns are disabled in `biome.json` with a comment, not suppressed inline.

### 3. Coverage

- `bun test --coverage --coverage-reporter=lcov --coverage-reporter=text` on the unit suite; script `test:coverage` in `package.json`.
- `quality/coverage-baseline.json` stores line and function percentages (one decimal) for the whole unit run.
- **Ratchet rule**: CI fails if line or function coverage drops more than 0.5 pp below baseline (tolerance absorbs Bun's measurement noise). When measured coverage exceeds baseline by >= 1 pp, the job asks for `--update`; the baseline only moves up. Target 70% lines, approached in steps: baseline -> next multiple of 5 per wave, each step an explicit baseline bump in a PR.
- Bun has no built-in threshold-by-baseline, so comparison is done by `scripts/coverage-baseline.ts` parsing `lcov.info`.

### 4. `.github/workflows/quality.yml`

- Triggers: `pull_request` and `push` to `main`. `permissions: contents: read`. `concurrency` cancels superseded PR runs.
- Jobs (parallel): `typecheck-core` (`tsc -p tsconfig.core.json`), `typecheck-baseline` (`bun scripts/typecheck-baseline.ts`), `typecheck-web` (`cd app/web-next && tsc --noEmit`), `lint` (`biome ci --changed`, `fetch-depth: 0`), `coverage` (`test:coverage` + `scripts/coverage-baseline.ts`, upload lcov artifact).
- Actions pinned by full commit SHA with a version comment, same convention as `ci.yml` (reuse the exact SHAs `ci.yml` already pins for `actions/checkout` and `oven-sh/setup-bun`).
- Bun pinned via `bun-version: 1.4.x`; `bun install --frozen-lockfile`.

### 5. Hygiene

- References checked: no Markdown link or code import targets the root PNGs. `gui-review-screenshots/` is cited as **text** (not links) in `CHANGELOG.md` (2026-09-18 entry) and `docs/designs/2026-09-18-s8-business-case-evaluation-design.md` (lines 14, 155).
- Action: `git mv` the 3 root `s4-*.png` and `gui-review-screenshots/` to `docs/evidence/gui-review/` (evidence, kept tracked), update the two path mentions in the S8 design doc; CHANGELOG history is left untouched (historical record). Add `/*.png` to `.gitignore` to stop future root screenshots.
- `backups/`, `detail-*.png`: already ignored — verify with `git check-ignore`, no change.

### 6. Upstream report (dev-sync commit noise)

- PM files via `upstream_request_create`: symptom (`chore: update` subjects carry no scope/summary), path `scripts/dev-sync.ts`, repro (run `/sync` without message args), and suggestion to derive subject from staged-file scopes or require a message. No local patch.

## Risks / Trade-offs

- **`--changed` lint** lets old violations survive in untouched files indefinitely; accepted to avoid a mass-reformat PR that pollutes blame and conflicts with in-flight branches. Artifact count makes the debt visible.
- **Baseline key without line numbers** can hide a new error of the same code in the same file if another is fixed simultaneously; accepted for stability.
- **Coverage noise**: Bun coverage can fluctuate; 0.5 pp tolerance may let small regressions through.
- **Strict root tsconfig** may surface Bun-type gaps in `scripts/` that are unfixable without upstream edits; those stay baselined.
- CI runtime grows (~1-2 min); jobs run in parallel.

## Rollout

1. PR A (this wave, single PR): tsconfigs + 4 fixes, Biome config, baseline scripts + JSON baselines, `quality.yml`, hygiene moves.
2. Run `quality.yml` in the PR itself; all jobs must be green on the baseline.
3. Owner action (human): mark `quality / *` checks as required in branch protection.
4. Later waves: burn down `typecheck-baseline.json` and lint artifact count; bump coverage baseline in 5 pp steps toward 70%.

## Verification

- `bunx tsc -p tsconfig.core.json --noEmit` -> 0 errors.
- `bun scripts/typecheck-baseline.ts` -> pass; injecting a deliberate type error in `scripts/` -> fail.
- `cd app/web-next && bunx tsc --noEmit` -> 0 errors.
- `bunx biome ci --changed --since=origin/main` -> pass; a misformatted touched file -> fail.
- `bun run test:coverage` + `bun scripts/coverage-baseline.ts` -> pass; baseline file recorded.
- `bun run test:unit` -> all ~1,348 cases still pass.
- `git ls-files '*.png' | grep -v '/'` -> empty; `grep -rn gui-review-screenshots docs/` -> only updated paths.
- `bun scripts/audit.ts` -> pass.

## Accessibility

Not applicable — no user-facing UI.

## Preview Verification

Not applicable — no UI.

## Open questions

1. Keep GUI evidence screenshots tracked under `docs/evidence/` (proposed) or untrack them entirely?
2. Should `scripts/` adopt the same hard 0-error gate as `db/`/`mcp/` once measured, if the count turns out small?
