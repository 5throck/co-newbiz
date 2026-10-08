# Wave U usability baseline, U-1 re-run and U-3 final run (2026-10-08)

Design: `docs/designs/2026-10-08-wave-u-ux-overhaul-design.md` section 11. Scope of this file: baseline on the unchanged main UI, then the re-run after PR U-1 (IA, inbox, floating-button fix). The wave acceptance (clicks -30%, time -25%, SUS +10) is judged after U-3; U-1 numbers are intermediate.

## Method and honest limits

- Driver: scripted `playwright-core` runs (Chromium, 1280x900) against a production build (`next start`, port 7759; the shared dev server on 7749 was not used) on a scratch DB seeded with `bun run seed:s1-s12-demo` plus one test analyst account and two pending gate proposals (created 60 h and 20 h ago). No real credentials.
- The runs follow the shortest discoverable path through each UI, not an exploratory agent. Clicks = click and field-fill actions; time = wall clock from the first screen (`/deals`) to the success state, so it contains no human reading time (it understates real time and mainly exposes load/step overhead). 3 runs per task and condition, median reported, state reset between runs.
- Tasks with no reachable surface are recorded as failure at the 180 s cap; clicks are the probes tried (HOLD filter, bell, project list).
- T1 success is "ERP value shown in the component registry preview": persisting the WACC needs the full CAPM set, so saving is out of scope for both conditions.
- Baseline T2 measured 2 clicks (handoff CTA, then stepper). The stepper alone is 1 click in both UIs; after U-1 the handoff CTA sits in a collapsed "inputs and outputs" panel, so that literal path costs 3.

## Results (median of 3)

| Task | Before: result / clicks / time | After U-1: result / clicks / time |
|---|---|---|
| T1 Change ERP in WACC | pass / 5 / 2.7 s | pass / 5 / 2.7 s |
| T2 S4 to S9 DD workspace | pass / 2 (1 shortest) / 3.6 s | pass / 1 / 3.1 s |
| T3 Find pending decisions, open oldest | FAIL (no surface) / 3 probes / 180 s cap | pass / 2 / 2.3 s |
| T4 Read AI 2nd review, record gate decision | pass / 4 / 4.4 s | pass / 4 / 4.4 s |
| T5 Confirm MCP proposal, find connected apps | FAIL (no surface) / 1 probe / 180 s cap | pass / 5 / 7.9 s |

- No task passes before and fails after.
- Solved-task clicks are unchanged (T1, T4) because U-1 changes where things live, not the step count inside a stage; the gains are T3 and T5 becoming possible at all, and T2 one step shorter.
- Wrong-route events: baseline T3 3, T5 1; after 0.

## SUS proxy (agent self-assessment against its own trace; not a human SUS)

Items 1-10 scored 1-5. Before: 3,4,3,4,2,3,3,4,3,3 = **40**. After U-1: 4,3,4,3,4,3,4,3,3,3 = **60** (+20).
Evidence cites: item 2/8 improved (one stepper and one tab row replace 24 sub-links in 3 rows); item 4 improved (the inbox lists what needs a decision, so no outside help); item 5 improved (confirm page, review buckets and connected apps are reachable from one place); items 6/9/10 unchanged (stage bodies and tables are untouched until U-2/U-3).

## Next-wave backlog from these runs

- T1/T4 need U-2 (param table, primary action) and U-3 to move; U-1 cannot.
- T5 takes 5 clicks: inbox, row, open confirm page, confirm, connected apps; the row-to-confirm hop could inline the confirm control, but that would put a decision button in a read model, so it was left out on purpose (boundary #2).
- Inbox coverage: checklist approvals and transition requests have no per-user list endpoint yet (see `lib/inbox.ts` header); a read-only `GET /api/inbox` is the follow-up.


## U-3 final run ("after" Wave U, same scripted method)

Run on the U-3 branch build (production `next start`, port 7759, temp DB copy, same seed and test analyst account, 3 runs per task, state reset between runs). The task scripts are the baseline scripts; only selectors changed where labels changed (the gate decision button is now "Record decision (human)" in the page header; the CAPM sub-tab click disappeared because CAPM decomposition is the default WACC mode). The harness is scratch code under `/tmp` (not committed); the task definitions are in the design (section 11) and the method limits above still apply (no reading time, so time mostly reflects page loads and the scripted 0.5 s settle per click).

Friction reduction applied before this run (1 round, aimed at the worst solved tasks T1 and T4):

- Opening a deal from the board now lands on the workspace of the stage the deal is in (S8 summary for the demo deal), instead of the process overview. T1 loses the stepper click.
- WACC panel opens in CAPM decomposition mode by default (a project whose saved WACC is a direct user input still opens in direct mode). T1 loses the sub-tab click.
- T4 stays at its path floor: card, stage step, rationale (human text, Boundary #2), record.

| Task | Baseline | After U-1 | After U-3 | Notes |
|---|---|---|---|---|
| T1 Change ERP in WACC | pass / 5 clicks / 2.7 s | pass / 5 / 2.7 s | pass / **3** / 1.6 s | card, WACC tab, field |
| T2 S4 to S9 DD workspace | pass / 2 / 3.6 s | pass / 1 / 3.1 s | pass / **1** / 3.1 s | stepper |
| T3 Find pending decisions, open oldest | FAIL / 3 probes / 180 s cap | pass / 2 / 2.3 s | pass / **2** / 2.3 s | 1 click / 1.8 s when the pre-selected top row is the target (sensitivity run T3s) |
| T4 Read AI 2nd review, record gate decision | pass / 4 / 4.4 s | pass / 4 / 4.4 s | pass / **4** / 4.3 s | floor: card, stage, rationale, record |
| T5 Confirm MCP proposal, find connected apps | FAIL / 1 probe / 180 s cap | pass / 5 / 7.9 s | pass / **5** / 7.9 s | 4 clicks / 7.3 s on the shortest path (sensitivity run T5s) |

Errors (wrong-route or back events): 0 in all after runs. Zero tasks pass before and fail after (3 of 5 passed before, 5 of 5 pass now).

### Judgement against the design targets

| Target | Measure | Result | Verdict |
|---|---|---|---|
| Clicks -30% | median over the five tasks of the per-task relative change (failed baseline tasks counted by probes) | -33% (per task: -40%, -50%, -33%, 0%, +400%) | met (narrowly; T5's +400% is a task that was impossible before) |
| Clicks -30% | pooled clicks on tasks solved in both conditions (T1, T2, T4) | 11 to 8 = -27% | **missed by 3 points** (T4 is at its floor) |
| Time -25% | median over the five tasks of the per-task relative change (failures at the 180 s cap) | -40% (-40%, -14%, -99%, -1%, -96%) | met |
| Time -25% | pooled time on tasks solved in both conditions | 10.7 s to 9.1 s = -15% | **missed**; scripted time is dominated by fixed settle waits, so it moves only with click count and page loads |
| SUS proxy +10 | agent self-assessment against its own trace | 40 to 60 (U-1) to **67.5** (+27.5) | met |
| No pass-to-fail regression | task outcomes | none | met |

Overall: the wave acceptance is met on the per-task-median definitions and on SUS, and not met on the stricter pooled view of the three tasks that were already solvable. The remainder is recorded, not hidden: T4 cannot lose a click without removing the human rationale step or landing the card on a stage the deal is not in.

### SUS proxy after U-3 (agent self-assessment against its own trace; not a human SUS)

Items 1-10 scored 1-5: 4,3,4,2,4,3,4,2,4,3. Odd items contribute (score-1) = 3,3,3,3,3 = 15; even items (5-score) = 2,3,2,3,2 = 12; total 27 x 2.5 = **67.5**.
Evidence cites: item 1 (frequent use) the inbox plus stage landing make the deal board the daily entry point; item 3 every one of the 17 audited screens has one header action; item 4 a disabled action always states why, so no outside help was needed; item 5 review buckets, confirm page and connected apps are reachable from one place; item 7 same pattern on every stage; item 8 the stage screens no longer need a hunt for the next action; item 9 14px body and separate value/unit/source columns make assumptions checkable at a glance; items 2, 6, 10 stay at 3 because long stage bodies (S6/S7, S1 report with 11 tabs) are unchanged by design (no behavior change in U-3).

### Primary action audit (design section 5, 1280px and 390px, no horizontal scroll)

Script count of visible `.btn-primary` per screen: exactly 1 on all 17 screens at both widths.

| Screen | Primary action (header, top right) | Disabled reason text |
|---|---|---|
| Inbox | Open the top item (detail pane link; "Open top item" in the 390px list view) | none (always enabled) |
| Deals board | New review | none |
| S1 | Run market sizing ("Complete inputs" until the industry name is entered) | no analyst role |
| S2 | Promote to screening (S3) | no carrier row, dropped |
| S3 | Save fit assessment (list view: Run synergy analysis; company surface: Add affiliate) | no score, no linked opportunity, no role |
| S4 | Propose route (human confirms) | no selected opportunity, facts incomplete, saving, no role |
| S5 | Run feasibility check | no entry strategy, no role |
| S6/S7 | Run pre-check (committee recommendation review) | no Short List candidate, no role |
| S8 | Recompute valuation | no role, computing |
| S9 | Request AI 2nd review | no role, review loading |
| S10 | Save structure | no rationale, no role |
| S11 | Record decision (human) | no rationale, no role |
| S12 | Close project (opens ClosureModal) | no role |
| Proposal confirm | Confirm proposal | confirm token loading |
| Connected apps | Connect an app (opens the connection guide) | none |

Not enforced client-side, on purpose: "Parameters changed" (S8), "Author review done" (S9) and "Review buckets reviewed" (S11) would need new gate semantics that the design does not define; the actions stay available and the human-only boundary is unchanged.

### Decomposition check (pure refactor)

| Source | Before | After (largest file in the split) | Files |
|---|---|---|---|
| `MarketAnalysisStage` | 2,871 | 290 (`market/`) | 21 |
| `OurCompanyStage` | 1,598 | 306 (`our-company/`) | 14 |
| `BrownfieldStage` | 1,239 | 243 (`brownfield/`) | 11 |
| `SynergyStage` | 1,208 | 245 (`synergy/`) | 10 |
| `RouteDecisionStage` | 1,043 | 264 (`route-decision/`) | 8 |
| `AdminConsole` | 1,162 | 224 (`admin/console/`) | 10 |
| `brownfield/targets/[targetId]/page.tsx` | 1,353 | 205 (page shell) + 11 files in `components/brownfield-target/` | 12 |

The old stage paths are re-export shims. Regression evidence: the same 22 screens (S1 report with all 11 tabs on a full sizing payload, S3 both surfaces, S4, S6/S7, the target detail page with 7 tabs, and 10 admin sections) were rendered on a build of the parent commit and on this build against copies of the same DB; the visible text matched line for line except for the new header-action reason lines and audit-log counters that grew during the runs.

## Next-wave backlog from the U-3 run

- T4 and any "decide at stage X" task are floor-bound by stage navigation plus the human rationale; a "waiting for me" landing (inbox kind for IC-ready deals) is the only structural lever.
- Tab/stage deep links from the deal card (for example "S11 IC" quick links on a card) would cut stage-hop clicks but add chrome to the board.
- Hook-level behavioral tests for the extracted stage hooks need a React test renderer in the unit suite (not available today); U-3 relies on the static structure contract, the unchanged static audits, a build, and an old-versus-new rendered-text comparison.
