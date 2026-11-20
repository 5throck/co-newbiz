---
title: Committee pre-review as a turn-based meeting, with live progress
date: 2026-11-20
status: accepted
owner: platform-lead
reviewers: [process-governance-manager, data-architect, backend-engineer, frontend-engineer, design-system-agent, risk-officer]
related: [ADR-0196, ADR-0096, ADR-0097, ADR-0104, ADR-0053, ADR-0065, ADR-0070, ADR-0074, ADR-0204]
lang: ko
lang_reason: source-material
---

# Committee pre-review as a turn-based meeting, with live progress

## 1. Problem

Owner report, 2026-11-20 (chat, verbatim):

> "사전 검토 실행을 진행하게 되면 회의를 진행하도록 되어있는데, 회의록이 실제 회의가 아닌 에이전트가 평가한 내용으로 구성이 되어있어. 실제 사람들이 회의를 통해 의사교환을 하고 합의에 이른 것처럼 회의를 진행하고 회의록을 기록할 필요가 있어."

> "또한, 회의를 진행하는 시간이 꽤 긴데 반해 진행현황을 알 수 없어서 어디까지 진행되고 있는지 파악하기 어려워"

Direction approved by the owner: "네, 함께 작성".

Scope change, same day (verbatim): "회의와 관련 기능은 모두 대화형 회의를 기본으로 하고 해당 방식으로 회의록을 저장해주면 좋을 듯 해." The turn-based meeting is therefore the default for **every** meeting surface, not only S6 (§14).

The surface is the S6 committee pre-review at `/deals/<id>/s6`. ADR-0196 made rounds responsive and added an agenda and structured minutes. The record still reads as an evaluation, because:

| # | Where | Cause |
|---|---|---|
| P1 | `app/web-next/lib/committee-session.ts` `runCommitteeSession` (L579-694) → `runDeliberationRounds` (`lib/deliberation.ts`) | Each round, every seat writes a full position paper on its own. Round 2+ sees peers' text, but nobody gets a turn, and nobody answers a question asked one turn earlier. |
| P2 | `app/web-next/lib/committee-chair.ts` `runChairMinutes` (L305-400), schema `lib/committee-minutes-schema.ts` | The chair builds the minutes after the fact and labels position papers with acts (raised/agree/rebut/ask/answer). The exchange is inferred, not recorded. |
| P3 | `app/web-next/components/CommitteePanel.tsx` (~L217-240) | The UI polls the session list every 5 s and reads only `convening` / `conveningError`. The server writes results only at the end, so there is no in-progress state to show. A run can take several minutes with no feedback. |

## 2. Fixed boundaries (unchanged)

- Gate approval and the investment decision belong to humans (non-negotiable boundary 2, ADR-0053). The meeting record says plainly that it is an **AI committee meeting**. Seats are named by role (e.g. "재무 위원"). The record never implies that people met or decided.
- The recommendation comes from `gate_evaluation`. Dissent is copied verbatim from `dissent_json` (ADR-0096 §6). The minutes pass and the turn engine have no write path to either.
- The chair facilitates and votes nothing (ADR-0097).
- No-fabrication: every minutes reference must resolve to a stored row (zod + ref resolution, ADR-0196 §3). Rejected refs are logged, not dropped silently (see trail learning 2026-11-10, silent zod fallbacks).
- Convening requires an LLM (ADR-0196 decision 10). No silent deterministic fallback for the engine.
- ADR-0196 §5 regeneration rules and ADR-0104 confirmation freeze still apply.

## 3. Current architecture (as is)

- Session = `process_run` row with `meta_json` (`SessionMeta`, `committee-session.ts` L70-100+; migration 0067). Async convene sets `meta.convening = true` and runs the deliberation in the background.
- Positions = `agent_position` rows (migrations 0045, 0065): `id, process_run_id, member_type, agent_key, human_user_id, position_md, confidence, round, created_at`. A `<!--position-meta:{...}-->` tail (parsed by `parsePositionMeta`, `committee-session.ts` L357-400) carries `responds_to`, `stance_changed`, `issues`.
- `meta.agenda` / `meta.minutes_draft` from ADR-0196.
- Writes: `writeMeta` (L231-236) rewrites the whole `meta_json` with one UPDATE.

## 4. Target design

### 4.1 Meeting flow

```
opening      chair reads the brief and the agenda (agenda pass, ADR-0196 §2)
for each issue i in agenda (bounded):
  chair opens issue i, calls first speaker
  loop turns (bounded):
    speaker sees: brief, agenda, full transcript of this meeting so far
    speaker makes ONE move: propose | ask | answer | rebut | concede | amend | pass
    chair picks next speaker (deterministic rule, 4.3)
    stop rule check (4.4)
  chair puts a consensus proposal (text + which positions it rests on)
  each seat: accept | reserve (with one-line reason)
  issue closes: agreed | narrowed | unresolved
closing      gate_evaluation recommendation + dissent_json (unchanged code path)
minutes      chair minutes pass over stored turns (4.6)
```

### 4.2 Data model

**Turns.** Each turn is one row. Two options:

- **Option A (chosen, Q1; no migration).** Store turns in `agent_position`. `round` = issue ordinal (1..N; consensus votes use the same issue ordinal). `position_md` = the utterance (short, 40-120 words). The `position-meta` tail is extended with `{ kind: "turn", issue_id, seq, move, addressed_to?, responds_to_turn?, vote? }`. The chair's own turns (open, call, consensus proposal) are rows with `agent_key = <chair key>` and `move` in `open | call | propose_consensus | close`. Existing rounds rows have no `kind` and keep their meaning. Weakness: `round` is overloaded, and ordering relies on `seq` inside text. The index `idx_agent_position_run (process_run_id, round)` still serves reads.
- **Option B (cleaner, needs migration + ADR + data-architect/dba review).** New table `committee_turn(id, process_run_id, issue_id, seq, member_type, agent_key, human_user_id, move, addressed_to, responds_to_turn_id, utterance_md, vote, created_at)` with `UNIQUE(process_run_id, seq)`, no DELETE path. Choose B if turns become queried (IC package, cross-session search), which is the ADR-0196 §4 S3 trigger.

Recommendation: ship A in phase 2 and keep B as the documented trigger. Open question Q1.

**Progress (`meta.progress`)**, written by the engine on every phase, issue, and speaker change:

```ts
interface MeetingProgress {
  engine: "rounds" | "turns";         // phase 1 = rounds, phase 2 = turns
  phase: "agenda" | "discussion" | "consensus" | "minutes" | "done" | "failed";
  issue_index?: number;               // 1-based
  issue_count?: number;
  issue_title?: string;
  round?: number; round_count?: number;   // rounds engine only
  speaker_seat?: string;              // committee seat key (role), never a person
  turn_count: number;                 // turns (or positions) persisted so far
  turn_budget?: number;
  started_at: string; updated_at: string;
  failed_at?: { phase: string; issue_index?: number; seq?: number; error_code: string };
}
```

No migration: it rides `process_run.meta_json` like `agenda` and `minutes_draft`.

Write race: `writeMeta` rewrites the whole JSON. The background engine is the only writer while `convening` is true. Progress updates must re-read and merge (read-modify-write in one transaction), so an analyst's concurrent agenda edit (hybrid) is not lost. Phase 1 adds a `patchMeta(runId, partial)` helper for this.

### 4.3 Speaker selection (deterministic)

The chair is code, not an LLM, for turn order. This makes runs cheap, testable, and repeatable:

1. If the last move was `ask` with `addressed_to = X`, X speaks next (`answer`).
2. Otherwise, the seat named in the most recent `rebut` against someone gets the floor.
3. Otherwise, round-robin over seats that have not spoken on this issue, then over seats with the fewest turns, in registry order.
4. A seat that returned `pass` twice on this issue is skipped.

An LLM chair for speaker choice is out of scope (see Q4).

### 4.4 Stop rules and budgets

Per issue, stop discussion and go to consensus when the first of these holds:

- `turns_per_issue_max` reached (default **3 × seats**, capped at 12);
- every seat has spoken at least once and the last full cycle of seats produced only `concede` / `pass` / `amend` that agrees with the standing proposal (no new `rebut` or `ask`);
- two full cycles in a row with only `pass`.

Per meeting: `turns_total_max` (default 40) and `wall_clock_max` (default 8 min, under the UI's 10-minute poll deadline). When either is hit, open issues close as `unresolved` with reason `budget`, and the engine goes to minutes. Hitting a budget is recorded in the minutes; it is not a failure.

Consensus: one vote per seat. `agreed` = all accept. `narrowed` = most accept and reservations name a narrower point (the reservations are recorded verbatim). `unresolved` = otherwise. These labels describe the AI exchange only. They are not decisions.

Budgets live in `procedures/_committees.yaml` per committee (optional keys, with code defaults). Changing that file is a `procedures/**` change (policy impact analysis + ADR), so phase 2 ships code defaults first and leaves the YAML keys for a later step. Open question Q2.

### 4.5 LLM prompt contract (per turn)

New prompt id `committee.turn` (versioned in `app/web-next/prompts/prompts.json`). Input:

- the role card of the seat, the brief (`brief_md`), the agenda, the current issue;
- the **full transcript of the meeting so far**, compacted: the current issue verbatim, earlier issues as their closing line plus consensus text; cap ~8k tokens, with the current issue always verbatim;
- which moves are allowed now (e.g. only `answer` when addressed).

Output: one JSON object, validated by zod:

```json
{ "move": "rebut", "addressed_to": "finance", "responds_to_turn": "<turn id>",
  "utterance": "40-120 words, topic language", "stance": "for|against|conditional|unsure" }
```

Rules in the system prompt: speak as the role, one point per turn, refer to the earlier speaker by role, no "approved"/"decided" wording, no claim of human attendance. Output token headroom is at least 2× the expected size, and parsing is tolerant (repair then validate). A turn that fails validation twice is stored as `pass` with `error` in the meta, logged, and the meeting continues. Three failed turns in a row stop the run (`failed_at`).

Consensus prompt `committee.consensus` (chair): input = issue transcript; output = `{ proposal, rests_on_turns: [ids] }`; refs are resolved like the minutes refs. Vote prompt reuses `committee.turn` with only `accept | reserve` allowed.

### 4.6 Minutes (schema changes)

`lib/committee-minutes-schema.ts` gains a `version: 2` shape (v1 stays readable):

- `overview`: `{ kind: "ai_committee_meeting", held_at, chair_seat, seats[], human_participants[] (hybrid only, by user id), engine: "turns" }`. The header line, rendered by code (not the LLM): "AI 위원회 회의 기록 — 사람이 모인 회의가 아니며, 결정은 사람이 합니다."
- `issues[]`: `{ issue_id, title, outcome: agreed|narrowed|unresolved, transcript: [{ turn_id }], consensus: { proposal, rests_on_turns[], votes[{seat, vote, reason?}] }, how_consensus_formed (≤3 sentences, must cite turn ids) }`.
  - `transcript` holds **only turn ids**. The dialogue lines ("재무 위원: …") are rendered from the stored rows at read time, so the LLM cannot invent an utterance.
- `decisions_proposed[]` (labelled "제안", each citing turn ids), `minority_opinions` (copied from `dissent_json` by code), `action_items[]`, `open_questions[]`.
- `recommendation`: still read from `gate_evaluation` by code.

The chair minutes pass only writes the `how_consensus_formed`, `decisions_proposed`, `action_items`, and `open_questions` text. Everything else is assembled by code. That shrinks the LLM output (less zod failure risk) and keeps the no-fabrication guarantee.

### 4.7 API / poll

- `GET /api/opportunities/{id}/committee-sessions` (the list the panel already polls) adds `progress` (the `MeetingProgress` above) and `turnsSince?: number` support: `?sessionId=…&afterSeq=N` returns turns with `seq > N` (max 50), so finished turns stream into the UI without a new endpoint type. Same permission check as the list (inherits the calling user's rights; no new MCP DB path, ADR-0011).
- MCP `get_committee_session` passes `progress` and turns through, read-only (ADR-0196 M5).
- No SSE/WebSocket in this design: polling fits the Cloudflare tunnel limits that caused the async split. Poll interval drops from 5 s to 3 s while `convening`.

### 4.8 UI (`CommitteePanel.tsx`, S6)

Pattern P4 Execution (while running) then P2 Report (minutes). Existing components only: StageFrame, SectionToolbar, a stepper built from existing tokens; no new tokens (DESIGN-CHECKLIST items 1-2). New icons, if any, are added to the icon vocabulary first.

- **Phase stepper**: 안건 정하기 → 안건별 논의 → 뜻 모으기 → 회의록 쓰기. Each step shows a text state ("끝남 / 진행 중 / 남음") and an icon, not color alone.
- **Status line**: "재무 위원 발언 중… (안건 2/4, 발언 7회, 3분 12초 지남)". Rounds engine (phase 1): "2/3차 의견 받는 중 — 재무 위원 작성 중…".
- **Live transcript**: finished turns appended under the current issue as "역할: 발언" lines.
- **Failure**: "안건 2/4, 발언 7번째에서 멈췄습니다: <message>" plus the turns kept so far. Retry resumes from the issue where the run stopped (resolved Q6); turns already stored for finished issues are kept.
- Strings go into the ko/en catalog (next-intl, ADR-0184); Korean strings prefer plain native words.

## 5. Phasing

| Phase | Scope | Migration | Ships |
|---|---|---|---|
| 1 Progress | `meta.progress` written by today's round engine (`runCommitteeSession`, `runDeliberationRounds` per seat/round, agenda and minutes passes); `patchMeta`; list API returns `progress` and per-round positions; stepper, status line, live list of finished positions; failure location | No | First, on its own |
| 2 Turn engine | `runTurnMeeting` beside `runDeliberationRounds`; turns in `agent_position` (Option A); speaker rules, budgets, `committee.turn` / `committee.consensus` prompts; default `engine: turns` for every committee in agent_team and hybrid (§14); S6 is the first surface verified live | No (A) / Yes (B) | After phase 1 |
| 3 Minutes form | minutes schema v2 for every meeting, code-assembled dialogue rendering, overview header, UI report view, CLI `committee-deliberation.ts` and `skills/meeting-facilitation` template parity (ADR-0196 M4/M8; the skill goes upstream) | No | After phase 2 |

Phase 1 is useful without phase 2: the owner's second complaint is fixed independently.

## 6. Migration and back-compat

- Existing sessions: no `meta.progress` → the UI shows today's "소집 중" text. No `kind: "turn"` rows → minutes v1 renders as today. Nothing is rewritten.
- `engine` per session is stored at convene time (`meta.engine`), so a session never changes engine mid-run.
- All ADR-0196 surfaces M1-M8 move to the turn engine together (owner scope change, §14). Only sessions convened before the switch keep `engine: rounds`.
- Rollback: set the default back to `engine: rounds` (only while the fallback exists, §14.2); turn rows stay readable as history.

## 7. Cost and latency

Assume 5 seats, 4 issues. Today: ~3 rounds × 5 positions (≈ 600-900 output tokens each, ~5-8k input) + agenda + minutes ≈ 17 calls; seats in a round can run in parallel.

Turn engine: per issue up to 12 turns + 1 consensus + 5 votes ≈ 18 calls; 4 issues ≈ 72 calls at the cap, typically ~40 with the early-stop rule. Output per turn is small (≈150-250 tokens) but input grows with the transcript (capped ~8k). Rough total: 1.5-3× today's tokens. **Turns are sequential by nature**, so wall clock rises: at ~4-6 s per call, 40 calls ≈ 3-4 min, the cap ≈ 6-7 min. Mitigations: votes run in parallel; the 8-minute wall-clock budget; prompt caching of the stable prefix (role card + brief + agenda). Numbers are estimates; phase 2 must measure on a real S6 session before turning it on by default (Q3).

## 8. Accessibility (ADR-0065, WCAG 2.1 AA)

- The status line sits in a `role="status"` / `aria-live="polite"` region. It announces phase, issue, and speaker changes, throttled to at most one announcement per 10 s, so screen readers are not flooded per turn. Failure uses `role="alert"`.
- The stepper is an ordered list with `aria-current="step"`; each step has a text state and an icon (1.4.1 Use of Color). Contrast via existing tokens (1.4.3).
- The live transcript is a plain list; new items do not move focus. Elapsed time is text, not only a progress bar; if a bar is used it has `role="progressbar"` with `aria-valuetext`.
- Keyboard: no new interactive controls besides existing retry/view-minutes buttons.

## 9. Preview verification (ADR-0070)

Each UI phase is checked in the running app (dev on 7748, never touching 7749) on a real S6 deal: convene, watch the stepper and status line change, read the accessibility tree for the live region, force a failure (bad model id) and confirm the stop location is shown. Screenshots/accessibility snapshots go in the PR.

## 10. Test strategy

- Unit: speaker selection rules; stop rules and budgets; consensus outcome classification; `patchMeta` merge under a concurrent agenda edit; turn zod parse/repair; minutes v2 ref resolution (fabricated turn id is rejected and logged).
- Engine with the injected deterministic `callAgent` (allowed seam per ADR-0196 decision 10): a 3-seat, 2-issue meeting produces the expected turn rows, progress sequence, and minutes; budget exhaustion yields `unresolved/budget`; three failed turns yield `failed_at`.
- Boundary tests: no write to `dissent_json` / recommendation from the engine or minutes pass; rendered minutes contain the AI-meeting header and no "승인/결정" wording in AI sections.
- API: `progress` and `afterSeq` respect the same permission check as the list (non-member gets 404/403).
- Back-compat: a v1 session fixture renders unchanged.
- A real-LLM smoke run on a full-size session (a toy 2-seat run is not enough evidence, per the 2026-11-10 learning).

## 11. Risks

| Risk | Mitigation |
|---|---|
| Turns read as staged theatre, or seats agree too fast | Role cards keep stances; stop rule needs every seat to speak; red-team seat keeps `rebut`; outcome labels can be `unresolved` |
| Record reads as if people met | Code-rendered header, role names only, no-decision wording check in tests |
| Latency over the poll deadline | 8-min budget below the 10-min deadline; progress makes waiting visible |
| Meta write races | `patchMeta` read-merge-write in one transaction |
| `round` overloading in Option A confuses existing readers | `kind: "turn"` tail; readers that count rounds filter turn rows; move to Option B on trigger |
| Cost growth | budgets, early stop, prefix caching, measured before default-on |

## 12. DB-schema ADR trigger check

- Phase 1: no schema change (meta_json only).
- Phase 2 Option A: no schema change (new tail keys in an existing text column). Option B: new table → migration, ADR, data-architect + dba review.
- Phase 3: no schema change.
- ADR-0204 is still needed: it changes the committee deliberation semantics set by ADR-0196 / ADR-0096 §4.

## 13. Owner decisions (resolved 2026-11-20)

Owner answer in chat, 2026-11-20, verbatim: "권장안대로 확정". Each question was put with a recommended option; each is resolved to it. ADR-0204 "Resolved" is the record.

- Q1. Turn storage — **Resolved**: Option A, reuse `agent_position` with the extended `position-meta` tail. No migration.
- Q2. Default budgets — **Resolved**: keep the code defaults (3 × seats turns per issue, max 12; 40 per meeting; 8 minutes). Per-committee overrides in `procedures/_committees.yaml` come later, as a separate `procedures/**` change with its own impact analysis and ADR.
- Q3. Scope — **Resolved**: all meetings (settled earlier; the fallback question is folded into Q8).
- Q4. Turn order — **Resolved**: deterministic code order (an addressed answer goes first, then round-robin).
- Q5. Hybrid — **Resolved**: humans may take a turn mid-meeting, with a bounded wait per turn (wait length is an implementation detail).
- Q6. On failure — **Resolved**: resume from the issue where the run stopped. (This replaces the earlier draft proposal to re-run the whole meeting.)
- Q7. Minutes — **Resolved**: a short per-issue transcript in the body, with every turn in an appendix.
- Q8. Round engine — **Resolved**: §14.2 Option A, an explicit, never-silent fallback.

## 14. Scope: turn-based meeting is the default for all meetings

### 14.1 Inventory of meeting entry points

Committee registry `procedures/_committees.yaml` (`committees:` L68):

| committee_key | Line | Scope | Entry points |
|---|---|---|---|
| `route-steering-committee` | L69 | opportunity (S4 route; S5 pre_fs proposal) | UI `components/stages/route-decision/RouteDecisionStage.tsx` L17/L180 (`CommitteePanel`), `useRouteDecision.ts`, `DecisionHistory.tsx`; pipeline auto-convene `lib/pipeline.ts` L266-282 (`committee_proposal:pre_fs`, `conveneCommitteeSession`) |
| `target-longlist-shortlist-committee` | L118 | opportunity (S6/S7, the reported surface) | UI `components/stages/brownfield/ShortlistSection.tsx` L12/L342 (`CommitteePanel`), `useBrownfieldTargets.ts` L126 (`beforeConvene` hook) |
| `entity-ic-committee` | L162 | project (ADR-0196 M7) | project API below |
| `group-ic-committee` | L208 | project (ADR-0196 M7) | project API below |

Engine and shared code: `lib/committee-session.ts` `createCommitteeSession` L481, `runCommitteeSession` L579, `conveneCommitteeSession` L724; `lib/deliberation.ts` `runDeliberationRounds`; `lib/committee-chair.ts` `runChairMinutes` L305; minutes view `components/CommitteeMinutesView.tsx`; panel `components/CommitteePanel.tsx`.

API (Route Handlers): opportunity scope `app/api/opportunities/[id]/committee-sessions/route.ts` (create at L78), `.../[sessionId]/route.ts`, `.../advance/route.ts`, `.../positions/route.ts`, `.../minutes/route.ts`; project scope `app/api/projects/[id]/committee-sessions/route.ts` (create at L78) and the same four sub-routes. Consumers: `app/api/projects/[id]/ic-package/route.ts` (M6 links to minutes).

MCP (read-only passthrough, ADR-0011): `mcp/co-newbiz/registry.ts` `list_committee_sessions` L238 (routes L343), `get_committee_session` L248 (routes L344). Both map to opportunity routes only; project-scope sessions have no MCP read path today (noted, not changed here).

CLI and skill: `scripts/co-newbiz/committee-deliberation.ts` (M4); `skills/meeting-facilitation/SKILL.md` (M8, common scope, upstream).

I did not verify line numbers inside the four registry entries beyond their start lines, nor whether any other stage convenes a committee through a path other than the two create routes and the pipeline.

### 14.2 Default engine and the round mode

The turn engine is the default for every committee above, in both `agent_team` and `hybrid`. `human_only` sessions make no agent calls; humans' entries are stored as turns in the same shape so their minutes use the same form.

Options for the round engine:

- **A. Keep it as an explicit, non-default fallback (chosen, Q8).** Selectable only by an admin setting or the CLI flag `--engine rounds`, never chosen silently. It is the rollback path while the turn engine is new, and it keeps old sessions reproducible. Removal is revisited after two months without use.
- B. Remove it after phase 3. Less code, but no rollback, and legacy sessions can no longer be re-run in their own engine.

Resolved as Q8 (Option A). In both options there is no silent fallback: an LLM failure stops convening as ADR-0196 decision 10 says, it does not drop to rounds.

### 14.3 Minutes storage for all meetings

Every new session stores minutes as schema v2 (§4.6, dialogue form, turn-id refs). Existing sessions keep `minutes_draft` v1 and are **rendered in the legacy shape**, with a note "이전 방식으로 기록된 회의록입니다". **No backfill**: converting position papers into dialogue would make up an exchange that never happened, which breaks the no-fabrication rule; confirmed minutes (ADR-0104) are frozen anyway. The reader picks the renderer by `minutes_draft.json.version` (absent = 1).

### 14.4 Phasing, cost, migration (all meetings)

- Phase 1 (progress) covers every surface at once, because all go through `runCommitteeSession` and `CommitteePanel`; project-scope surfaces without a panel get `progress` in the API and MCP payloads.
- Phase 2 switches the default for all four committees in one release, after a live check on S6 and S4. The pipeline auto-convene (M3) inherits the 8-minute budget; it runs in the background so latency does not block a user, but it multiplies cost per pipeline run.
- Phase 3 ships minutes v2, the CLI, and the meeting-facilitation template together.
- Cost: per meeting as §7 (≈1.5-3× tokens, 3-7 min). Fleet-wide, the increase scales with the number of convened sessions across S4, S5 auto-convene, S6/S7, entity-IC and group-IC; I could not count historical session volume, so the total monthly impact is unmeasured (Q3/Q8 input).
- Migration: still none for phases 1-3 under storage Option A. Project-scope sessions share `process_run.meta_json`, so no new columns.

- Q8. Keep the round engine as an explicit fallback (A, recommended) or remove it (B)?
