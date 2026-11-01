# Quality Gate: Web Typecheck Bun Types + E2E Expectation/Budget Repair (Implemented)

- **Date**: 2026-11-01
- **Status**: Implemented
- **Author**: frontend-engineer, under PM dispatch (release-engineer verified both failures as genuine)
- **Related**: CI run 41258720879 (main, 489a24d0); PR #786 (CI installs for the other three quality jobs — workflow file intentionally untouched here); ADR-0074 (Universal Design Gate); test-runner v1.8.0 budget-raise policy

## 1. Problem

Two quality-gate jobs fail on main and the failures are genuine (not CI-install residue):

1. **`typecheck:web` red (124 errors)**: `TS2307 Cannot find module 'bun:sqlite'` (111) and `TS2339 Property 'main' does not exist on type 'ImportMeta'` (13) across `app/web-next/lib/**`, `app/web-next/app/**`, and root `db/repositories/**` / `scripts/co-newbiz/**` files pulled into the web program via imports.
2. **`e2e` red**: (a) `reconfirm-ui.test.ts` asserts 12 `[data-testid^="kpi-G"]` cards on `/admin/gate-integrity` and receives 3; (b) `axe-sweep.test.ts` fails `/glossary (+6px)` at 390px and then dies at the 300s suite wall (`Test timed out after 300000ms`).

## 2. Root Causes

### 2.1 typecheck:web — root `tsc` (TS 7) shadowing web-next's own compiler

`typecheck:web` ran `cd app/web-next && tsc --noEmit`. Bun's `run` builds the child PATH **before** the script's `cd`, so bare `tsc` resolved from the ROOT `node_modules/.bin` — root pins `typescript@7.0.2` (the native compiler), not web-next's `typescript@5.9.3` devDependency. Reproduced on a fresh clone of main (frozen-lockfile installs, unpinned script): exit 1 with exactly the 124 CI errors (`TS2307 bun:sqlite`, `TS2339 ImportMeta.main`); with the pinned `./node_modules/.bin/tsc` (5.9.3): exit 0. TS 7 does not auto-include ambient `@types/*` packages the way 5.x does, so `@types/bun` (already a web-next devDependency, installed in both trees on CI) never entered the program and `bun:sqlite` / `import.meta.main` lose their declarations. A stale `tsconfig.tsbuildinfo` is ruled out (cleared; clean run reproduces on CI-shaped installs).

**Fix decision (owner, PM experiment matrix)**: pin the script to web-next's own compiler — `"typecheck:web": "cd app/web-next && ./node_modules/.bin/tsc --noEmit"` — keeping the web program on TS 5.9.3. The alternative evaluated here first, `"types": ["bun"]` in web-next's tsconfig (compiles clean under both 5.9.3 and 7.0.2), was **dropped**: setting `types` disables TS's auto-inclusion of every other `@types/*` package (a program-surface change beyond the decided fix), and the pin alone is sufficient.

**Tracked upgrade path**: the web program moves to TS 7.x when **TS 7.1 stable + bun-types native integration** land; bun-types already ships a `ts7.1/` declaration folder (verified in bun-types@1.4.3). At that time re-run the experiment matrix (TS 7.1 stable × bun-types 1.4.x under this program) before unpinning.

### 2.2 reconfirm-ui — stale count from the bdaf2657 screen redesign

Commit `bdaf2657` (feat(admin): admin console and screen improvements, 2026-10-29) redesigned the gate-integrity screen: a KPI that computes fine but has nothing to show for the period (`isEmptyKpi`) collapses into its group's "empty" summary (`kpi-empty-<group>`) instead of rendering a `kpi-G*` card. The test predates the redesign and expects the pre-redesign unconditional 12 cards. Reproduced locally (3 cards: G7 breached, G11, G12 — the latter never empty by contract; G1–G6, G8–G10 collapsed). The indicators are all still rendered — this is a stale expectation, not a missing-data regression.

### 2.3 axe-sweep — CI font metrics + a file over budget everywhere

- `/glossary (+6px)`: not reproducible locally (0px with the identical seed, route list, and probe). A card's widest unbreakable run (term key in `<code>`) sets the card's min-content; under CI linux's wider CJK fallback font metrics that pushes `scrollWidth` 6px past the 390px viewport. Environmental trigger, but the CSS can be made font-metric-proof.
- **Suite timeout**: the file declares per-test ceilings of 600s/900s but has no `FILE_TIME_BUDGETS` row, so it sits under the 300s scenarios default. Measured darwin solo run via plain `bun test` (no runner wall): **all 4 tests pass in 302.6s** — already over the 300s runner budget on a fast machine. The file was previously "verified locally" through plain `bun test`, which has no suite wall; hosted e2e only became runnable on CI when billing unblocked, surfacing both this and 2.2.

## 3. Changes

| # | Change | File |
|---|---|---|
| 1 | `typecheck:web` pinned to web-next's own compiler: `cd app/web-next && ./node_modules/.bin/tsc --noEmit` (owner decision; sibling `tsc` scripts audited — `typecheck`/`typecheck:core`/`typecheck:baseline` are root-lane TS 7 by design and untouched). The web program moves to TS 7.x when TS 7.1 stable + bun-types native integration land (bun-types@1.4.3 already ships a `ts7.1/` folder) — re-run the experiment matrix then | `package.json` |
| 2 | reconfirm-ui asserts the redesigned contract: every G1–G12 id appears either as a card (state text asserted on rendered cards) or inside its group's empty summary; G6's unreviewed-note caption (exact Korean string in the test file) asserted only when G6 renders as a card; comment cites `bdaf2657` | `tests/scenarios/reconfirm-ui.test.ts` |
| 3 | `overflow-wrap: anywhere` on `.glossary-card code`, `.glossary-detail code`, `.glossary-preview` — `anywhere` (not `break-word`) also shrinks min-content, so a long token wraps instead of widening its container under any font stack | `app/web-next/app/styles.css` |
| 4 | `axe-sweep.test.ts` joins FILE_TIME_BUDGETS at suite 900s (v1.10.0 header note cites CI run 41258720879: killed at 300092ms, contract tests alone 183.8s; darwin solo 302.6s; CI ~1.6–2x local → projected CI 480–610s, ~1.5–1.9x headroom). First raise for this file — the 2-per-quarter split/trim rule is not triggered. The budget row's `test: 60000` default is inert for this file: all 4 tests declare their own ceilings (600s/600s/900s/900s) | `scripts/test-runner.ts` |

## 4. Verification

- **Local** (drifted node_modules, for completeness): `typecheck:web` 0, `typecheck:core` 0, `typecheck:baseline` 0.
- **Clean clone of main (489a24d0)**, root + web-next `bun install --frozen-lockfile`, only the edited root `package.json` copied in: `typecheck:web` **0**, `typecheck:core` **0** (validates PR #786's fresh-install assumption), `typecheck:baseline` **0**. Clone deleted afterwards.
- **Controls on the same fresh clone**: unpinned script (main's `cd app/web-next && tsc --noEmit`) → exit **1** with the 124 TS2307/TS2339 errors — proving the pin, not the fresh install, is the fix; pinned script on PR #786's tip (4f8b5f23) → exit **0**.
- `tests/scenarios/reconfirm-ui.test.ts` solo: 3 pass / 0 fail. `tests/scenarios/axe-sweep.test.ts` solo: page-contract 45.0s and OVERFLOW-390 offenders=0 locally (the +6px glossary overflow does not reproduce on darwin font metrics; change 3 is the CI-metrics hardening), theme sweeps green — see the PR notes for the final numbers.
- `bun run test:unit` full green; `bun run design:lint` clean on the change-set.

## 5. Non-goals / Handoffs

- `.github/workflows/quality.yml` is frozen for this task (PR #786 owns it).
- Pinning CJK fonts on CI runners (a quality.yml change) would align CI font metrics with dev machines; if the glossary overflow still reproduces after change 3, that is the follow-up to route through PM.
- Root-lane typechecks stay on TS 7.0.2 intentionally; the root-vs-web-next `tsc` shadowing inside `bun run` remains a footgun for FUTURE scripts — any new script that must run a non-root compiler needs the same explicit `./node_modules/.bin/` pin (surfaced for platform-lead awareness).
