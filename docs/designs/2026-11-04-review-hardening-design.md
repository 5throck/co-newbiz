# Review Hardening — 2026-11-04 Project Review Fixes

**Date**: 2026-11-04
**Spec**: `2026-11-04-review-hardening-design`
**Status**: implemented
**Source review**: `docs/reports/2026-11-04-project-review-full.md`

## Problem

The 2026-11-04 full project review found four machine-detectable defects where a
validator or CI job reported success while exercising nothing. Each one is a gate that
reads as green because it never ran, which is worse than a missing gate: the absence of
a check is visible in a review, a vacuous pass is not.

1. **`bun run test:scripts` resolved zero test files (H1).** The `scripts` suite in
   `scripts/test-runner.ts` pointed at the top-level `scripts/` dir with a `test-*.ts`
   name filter. The only match in the tree was `test-runner.ts` itself, which the scan
   explicitly excluded. The three real tests under `scripts/tests/` matched no suite —
   the `unit` suite scans `tests/unit/` only. `runTests()` returned PASS on an empty
   list, so the CI "Run script tests" step passed vacuously. This is a regression:
   `docs/reports/2026-09-20-project-review-full.md:40` records fixing exactly this, and
   `scripts/SCRIPTS.md` still documented v1.5.0 as scanning `scripts/tests/*.test.ts`.

2. **`scripts/typecheck.ts` skipped on every run (M2).** The script reads
   `scripts/helpers/typecheck-baseline.json`. That file did not exist on disk and never
   existed in `HEAD`, so the gate printed
   `[SKIP] TypeScript typecheck: no baseline file in this context` and exited 0 — while
   its own docstring claimed "the baseline is now 0, so ANY type error fails" and
   `scripts/dev-sync.ts:935` still invoked it. Real enforcement lived elsewhere
   (`quality/typecheck-baseline.json` via `scripts/typecheck-baseline.ts`, plus
   `typecheck:web` in CI), so the defect was a silent second gate, not an untyped tree.

3. **CI `test` job drifted from every other job (H5).** `.github/workflows/ci.yml`'s
   `test` job used `bun-version: latest` while the other four jobs pin `1.4.x`, had no
   `timeout-minutes` (the others use 15), and re-ran `bun run test:unit` although the
   dedicated `unit-tests` job had already run it — doubling every push's unit time while
   its second step was the no-op from (1).

4. **`docs/co-newbiz.context.md` carried stale figures (M1).** It cited
   `process/flow.spec.yaml` v2.10.1 against an actual `meta.version` of 2.17.0, and
   claimed "105 skill directories / 91 registered" against an actual 108 live
   `SKILL.md` directories and a 157-row registry (two tables).

## Decision

Fix all four in one change set, and make every one of them a standing check rather than
a one-off repair — the ratchet principle: a class of defect that a machine can catch
must be caught by the machine on the next occurrence.

- **Scan roots**: `scripts` suite → `{ dir: "scripts/tests", ext: ".test.ts" }`, and the
  scripts-only name special-case is deleted so extension matching is uniform across
  suites. The dead `bun-script` exec mode goes too: suite members are bun:test files and
  now run under `bun test --timeout` like every other suite, restoring the per-test
  budget.
- **Empty-suite guard**: a suite resolving to zero files is a HARD FAILURE naming the
  suite and its dir, unless `--allow-empty` is passed. `test:integration` carries the
  flag (an integration-less tree is legitimate); `test:scripts` does not.
- **Typecheck baseline**: create the missing file so the gate measures instead of
  skipping. Record the ACTUAL current error count rather than a convenient 0 — a
  regression-only gate at the true count is honest and blocks new debt; a fabricated 0
  would fail immediately and invite someone to delete the gate again.
- **CI**: pin `1.4.x` with the same comment convention as the other jobs, add
  `timeout-minutes: 15`, drop the duplicated unit step.
- **Context doc**: state the counts with their source of truth so the next reader can
  re-verify rather than re-guess.

## Changes

| File | Change |
|---|---|
| `scripts/test-runner.ts` | v1.11.0 — `scripts` suite scans `scripts/tests/*.test.ts`; uniform extension matching; `bun-script` exec mode removed; `RunOptions.allowEmpty` + `--allow-empty` + hard-fail empty branch |
| `scripts/SCRIPTS.md` | test-runner row → 1.11.0 with the restore note; `--allow-empty` in CLI flags; `test:scripts` alias |
| `scripts/helpers/typecheck-baseline.json` | created — `count: 84`, measured at HEAD 46bc9a00 |
| `.github/workflows/ci.yml` | `test` job — bun pinned `1.4.x`, `timeout-minutes: 15`, duplicated unit step removed |
| `docs/co-newbiz.context.md` | flow.spec v2.17.0; 108 live skills / 157 registry rows with sources; Refreshed line → 2026-11-04 |

## Verification

| Check | Result |
|---|---|
| `bun run test:scripts` | 3 test files found and passed, exit 0 |
| Empty-suite guard | `integration` without the flag → exit 1 with the naming error; with `--allow-empty` → exit 0 |
| `bun run test:unit` | full suite green |
| `bun scripts/typecheck.ts --summary` | real run, 84/84, delta 0 |
| `bun scripts/verify-scripts.ts --verify` | 277 scripts, 0 warnings |
| `bun scripts/audit.ts` | ALL PASS |

## Non-goals

- **Triaging the 84 type errors to 0 is not in this change.** It is deferred item D4 in
  the review report (the bulk sit in `tests/unit/*`). The gate now makes that debt
  visible and prevents growth; paying it down is separate work.
- No new CI step was added for the typecheck gate — it rides the existing dev-sync
  battery and CI invocation it already had.
