---
title: Wave C — End-to-End Proof (Playwright golden paths, axe gate, demo, real-pilot UI run-through)
status: approved
date: 2026-10-08
owner: platform-lead
contributors: frontend-engineer (implementation), design-system-agent (token contrast), ux-designer-agent (demo script), process-governance-manager (closure vocabulary)
related_adrs: []
---

# Wave C — End-to-End Proof

> Pre-approved by the user in chat on 2026-10-08 (all wave designs). This document covers Wave C part 1 (C-1: Playwright golden paths and the axe gate). The internal demo and the real-pilot UI run-through report (C-2) are carried by a separate agent and appended to the PR split below when they land.

## 1. Context

Waves A, F, M, U and B shipped closure, the 3-stage review, MCP parity, the UX overhaul and the AI eval suite. Each wave is covered by unit tests, but nothing proves that a person can actually walk a deal through the browser from S1 to a typed closure, or that an agent proposal reaches the person's confirm screen. `scripts/test-runner.ts` already has a `scenarios` suite slot (`bun run test:e2e`) pointing at `tests/scenarios/`, and `playwright-core` is already a dependency of `app/web-next`. This wave fills the slot.

## 2. Goals and non-goals

**Goals**
1. Five golden-path scenarios driven through the UI (greenfield, brownfield M&A, KILL at a gate, mid-process withdrawal, MCP proposal).
2. An axe-core accessibility gate inside the same Playwright sessions on the key screens. Zero serious or critical violations.
3. Product gaps that block a person from completing a path are fixed in place; larger ones are listed.
4. A CI job (`e2e`) in the project-owned `.github/workflows/quality.yml`.

**Non-goals**
- No change to gate semantics, closure vocabulary, or the review model.
- No visual regression suite. Screenshots are an evidence aid for the demo, not an assertion.
- No live LLM, DART, or any external network call. Offline fallbacks only.

## 3. Harness (`tests/scenarios/_support/`)

| Piece | Behavior |
|---|---|
| `harness.ts` | Builds the app once per source state into `.next/e2e` (`CO_NEWBIZ_DIST_DIR`, so the operator's dev and production output are untouched), then starts `next start` per scenario on a free port (never 7749) against a temp SQLite DB. Teardown kills the server and removes the temp directory, including on SIGINT/SIGTERM. |
| Bootstrap | Before the server starts: migrations, an `admin` and an `analyst` account with runtime-generated passwords, and master data / evidence seeding. Nothing else is written to the DB outside the app. |
| Offline mode | `CO_NEWBIZ_LLM_*`, the three `CO_NEWBIZ_*_AGENTS` switches and the DART keys are blanked, so the committee, business-case and DD-tailor executors use their deterministic fallbacks. |
| `browser.ts` | Playwright launch (bundled Chromium, then the installed Chrome channel; otherwise `bunx playwright install chromium`), UI login with the forced password change, and the axe gate. |
| `ui.ts` | Drivers for the human acts: gate decision panel, S12 transition form, closure modal. |
| `deals.ts` | Seeds a brownfield M&A deal (reusing `scripts/co-newbiz/seed-s1-s12-demo.ts` with `humanDecisions:false`) and a greenfield deal. |

Scenarios run sequentially (`sequential: true` in the runner) and each is its own `bun test` file, so each owns its server and its DB singleton.

## 4. Scenarios

| # | File | Path | Ends in |
|---|---|---|---|
| a | `greenfield.test.ts` | Pre-FS, FS, DD gates; five establishment steps; Entity IC and Group IC; S12 `graduate_to_core` with its hand-off record | closure `graduated_to_core` |
| b | `brownfield-ma.test.ts` | Target screening gate; FS gate; all 25 items of the two M&A sub-track checklists judged in the DD workspace; DD gate; IC gates; S12 `reduce_or_divest` with its divest plan | closure `divested` |
| c | `kill-at-gate.test.ts` | KILL cannot be submitted without learning capture; DD KILL with learning; closure modal offers `killed_at_gate` with its basis | closure `killed_at_gate`, `pipeline_run` = `killed` |
| d | `withdrawal.test.ts` | Mid-process (S9) withdrawal; submit stays disabled until reason (20+ chars) and learning are present | closure `withdrawn`, `pipeline_run` = `withdrawn`, never `completed`, no S12 record |
| e | `mcp-proposal.test.ts` | A real MCP stdio client (token issued from the person's session) calls `propose_gate_decision`; nothing is decided; the proposal appears in the inbox; the person confirms it on `/proposals/{id}/confirm` | `gate_decision` recorded by the person, proposal `confirmed` |

Every decision is recorded by the logged-in analyst. The assertions read the DB read-only after the UI act.

## 5. Human-act boundary

The scenarios keep the Non-Negotiable Boundaries visible: gate decisions, the S12 transition and the closure are performed through the same human-only screens as in production; the MCP client can only create a pending proposal; the admin account is walled off from deal content (ADR-0091), so deal work runs as the analyst.

Evidence for S1–S10 (market sizing, opportunity scoring, route decision, business case and simulations, DD items, structure and financing, scorecard) is seeded as bootstrap fixtures. It is the same evidence set the process predicates inspect, so the process page shows S1–S10 complete. Producing that evidence screen by screen (S1 sizing through S10) is covered by the C-2 pilot run-through, not this suite.

## 6. Accessibility gate

`axeScan` injects the pinned `axe-core` (`app/web-next` devDependency, exact version, `bun.lock` updated) into the live page and runs the `wcag2a`, `wcag2aa`, `wcag21a` and `wcag21aa` tags. Serious and critical violations fail the scenario; lower impacts are printed. Screens: the shell (deal board), a stage page (S9 DD workspace), the gate panels (S5 Pre-FS, S11 IC review), the closure modal, the decision inbox, the proposal confirm page, connected apps, and the process rail.

## 7. Findings fixed in this wave

| Area | Finding | Fix |
|---|---|---|
| Gate panel | KILL could not be recorded from the UI: the route answers 422 without `learning_capture` (ADR-0152) but the panel had no such field. | Required learning field on KILL; submit disabled with a stated reason. |
| S12 form | `graduate_to_core`, `reduce_or_divest`, `next_tranche_released`, `held_evidence_incomplete` were unrecordable: the route requires the ADR-0151 record column and the form never collected it. | One required field per decision, labelled with the column. |
| Document title | No `<title>` on any page. | Root `metadata` with a title template. |
| Stage tabs | A menu button inside `role="tablist"` (critical `aria-required-children`). | Tablist holds tabs only; the More button is its sibling. |
| Names | Theme toggle, back link and notification button names did not contain their visible text. | Names now include the visible label. |
| Contrast | Accent, green and amber foregrounds, the sidebar group label, and skipped/locked step opacity fell below 4.5:1. | Tokens darkened in `design-tokens.json` and `styles.css`; opacity removed. |
| Closure modal | Links inside text distinguished by color only. | Underlined. |

## 8. CI

An `e2e` job in `quality.yml` installs root and `app/web-next` dependencies frozen, installs Chromium (`bunx playwright install --with-deps chromium`), and runs `bun run test:e2e`. Billing currently blocks hosted runs, so the job is verified locally first.

## 9. Running locally

```bash
bun install && (cd app/web-next && bun install)   # axe-core and playwright-core live in app/web-next
bunx playwright install chromium                  # only if no Chromium or Chrome is available
bun run test:e2e                                  # builds once into .next/e2e, then five scenarios, one server each
```

A single scenario: `bun test --timeout=120000 tests/scenarios/greenfield.test.ts`. Expected wall time is about 40 seconds for the five scenarios once the build is warm (the build itself adds about 15 seconds when sources changed). Set nothing else: the harness picks free ports and temp directories itself.

## 10. Risks

| Risk | Mitigation |
|---|---|
| Build staleness hides a regression | The harness compares `BUILD_ID` with the newest source mtime and rebuilds; a lock file serializes concurrent builders. |
| Orphan servers | Teardown in `afterAll`, plus exit and signal handlers in the harness. |
| Flaky contrast checks during transitions | The scan moves the pointer away and waits for transitions to settle. |
| Seeded evidence drifting from predicates | The first assertion of each scenario reads the process page, so a predicate change fails loudly. |

## 11. Verification

`bun run test:e2e` twice in a row; `bun run test:unit`; `bun run typecheck`; `app/web-next` `tsc --noEmit` with zero errors; `bun run design:lint`; `generate-skill-graph`; `verify-scripts`; `bun scripts/audit.ts`.

## 12. PR split

| PR | Content |
|---|---|
| C-1 (this) | Harness, five scenarios, axe gate, product fixes listed in section 7, `e2e` CI job, changelog. |
| C-2 | Internal demo script (reusing the seeded deals) and the real-pilot UI run-through report, appended here when it lands. |

## 13. Accessibility

- All new UI is limited to two form fields (learning capture, ADR-0151 record). Both are visible `<label>`s with `required`, the submit stays disabled with a visible reason, and they follow the existing Onyx 3.0 input classes.
- Status is never conveyed by color alone; the fixes remove opacity-based dimming in favor of token colors that meet 4.5:1 on both surfaces.
- Targets, focus order and the dialog pattern of the closure modal are unchanged; the modal is scanned with axe in the open state.
- The tab strip keeps roving tabindex and arrow-key navigation; only the DOM nesting changed.

## 14. Preview Verification

At 1440×900 and 375×812, as the analyst:
1. S9 DD workspace: the two M&A tabs list 13 and 12 items, each judgeable with the keyboard; the tab strip shows the More button beside the tablist.
2. Gate panel: choose KILL; the learning field appears and submit stays disabled until it is filled.
3. S12: choose each non-kill decision; the matching record field appears and is required by the route.
4. Closure modal: unmet preconditions show text, an icon and an underlined link; the primary button is "Close project".
5. Capture console errors (none expected) and the axe summary printed by the scenario run.
