# Wave U usability baseline and U-1 re-run (2026-10-08)

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
