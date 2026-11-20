---
lang: ko
lang_reason: source-material
---

# ADR-0204: Committee pre-review as a turn-based meeting with live progress

**Status**: Accepted (owner decision in chat, 2026-11-20)
**Date**: 2026-11-20
**Deciders**: Owner (chat, 2026-11-20); drafted by platform-lead under PM dispatch; AI-2nd review by process-governance-manager
**Related**: ADR-0196 (amended), ADR-0096 §4 (amended), ADR-0097, ADR-0104, ADR-0053, ADR-0065, ADR-0070, ADR-0011, design `2026-11-20-committee-turn-based-meeting-design`

Owner input, verbatim (chat, 2026-11-20):

- "사전 검토 실행을 진행하게 되면 회의를 진행하도록 되어있는데, 회의록이 실제 회의가 아닌 에이전트가 평가한 내용으로 구성이 되어있어. 실제 사람들이 회의를 통해 의사교환을 하고 합의에 이른 것처럼 회의를 진행하고 회의록을 기록할 필요가 있어."
- "또한, 회의를 진행하는 시간이 꽤 긴데 반해 진행현황을 알 수 없어서 어디까지 진행되고 있는지 파악하기 어려워"
- On the direction below: "네, 함께 작성"
- Scope: "회의와 관련 기능은 모두 대화형 회의를 기본으로 하고 해당 방식으로 회의록을 저장해주면 좋을 듯 해."

## Context

ADR-0196 made rounds responsive and added a chair agenda and structured minutes. Each round, every seat still writes a full position paper on its own (`lib/committee-session.ts` `runCommitteeSession` L579-694 → `lib/deliberation.ts` `runDeliberationRounds`). The chair labels the papers with acts afterwards (`lib/committee-chair.ts` `runChairMinutes` L305-400). So the minutes read as an evaluation, not an exchange. The UI (`components/CommitteePanel.tsx` ~L217) polls only the `convening` boolean, and the server writes nothing until the end, so a long run shows no progress.

## Decision

1. **Progress state (phase 1, ships first, on today's round engine).** The engine writes `process_run.meta_json.progress` on every phase, issue, round, and speaker change: phase, current issue (i/N), current speaker seat, turn count, elapsed time, and on failure the stop location. The existing session poll returns it. The S6 panel shows a phase stepper, a status line ("재무 위원 발언 중…"), and finished turns live. No migration.
2. **Turn-based meeting engine (phase 2; amends ADR-0096 §4 and ADR-0196 decision 1 for every committee).** For each agenda issue the chair opens the issue and calls seats. Each turn sees the full transcript so far and makes one short move: propose, ask, answer, rebut, concede, or amend. Turn order follows deterministic code rules. The chair puts a consensus proposal and seats accept or reserve. Each issue closes as agreed, narrowed, or unresolved. Turns are bounded per issue and per meeting, with a wall-clock limit. In hybrid mode humans can take a turn. Each turn is stored as its own row. Turns are stored in `agent_position` with an extended `position-meta` tail, which needs no migration (resolved Q1). A dedicated `committee_turn` table is not adopted; moving to one later needs its own migration, data-architect review, and a DB-schema ADR. The turn engine is the default for every committee in `procedures/_committees.yaml` (route-steering, target-longlist-shortlist, entity-IC, group-IC), in agent_team and hybrid, including pipeline auto-convene, the CLI, and the MCP read path (inventory: design §14.1). The round engine stays only as an explicit, never-silent fallback (resolved Q8).
3. **Minutes in meeting-record form (phase 3; amends ADR-0196 decision 3).** Minutes schema v2: overview (date and time, chair, attending seats), a per-issue transcript in dialogue form ("seat: utterance"), how consensus formed, then proposed decisions, minority opinions, and action items. The transcript holds turn ids only, and code renders the dialogue from stored rows. All references must resolve, so the no-fabrication guarantee holds. Every new meeting stores v2. Existing v1 minutes are rendered in their legacy shape with no backfill, since converting position papers into dialogue would invent an exchange.

## Boundaries (binding, unchanged)

- The recommendation comes from `gate_evaluation`. Dissent is copied verbatim from `dissent_json` (ADR-0096 §6). The engine and the minutes pass have no write path to either.
- The record states that it is an AI committee meeting and names seats by role. It never implies that people met or decided. Gate approval belongs to humans (boundary 2, ADR-0053). Outcome labels (agreed/narrowed/unresolved) describe the AI exchange only.
- The chair facilitates and votes nothing (ADR-0097). Convening still requires an LLM (ADR-0196 decision 10). ADR-0196 §5 regeneration and ADR-0104 confirmation rules apply unchanged.
- The MCP reads progress and turns through the API only (ADR-0011).

## Consequences

- Phase 1 and phase 3 need no schema change. Phase 2 needs none under the default storage. Choosing the `committee_turn` table triggers the DB-schema ADR rule.
- Cost rises to about 1.5-3× tokens per meeting (estimate). Wall clock rises because turns run in sequence; budgets keep a run under the UI's 10-minute poll deadline. These numbers must be measured before default-on.
- Per-committee budgets in `procedures/_committees.yaml` would be a `procedures/**` change (policy impact analysis + ADR). Phase 2 starts with code defaults.
- The CLI `committee-deliberation.ts` and `skills/meeting-facilitation` (common scope, goes upstream) follow in phase 3 for parity with ADR-0196 M4/M8.
- Accessibility: progress uses a polite live region, failures use an alert, and the stepper is not color-only (ADR-0065). Each UI phase gets a preview check (ADR-0070).

## Resolved (owner decision, chat, 2026-11-20)

Owner answer to the open questions, verbatim: "권장안대로 확정". Each question had been put to the owner with the recommended option below, so each recommendation is now the decision.

| Q | Topic | Resolved option |
|---|---|---|
| Q1 | Turn storage | Reuse `agent_position` with the extended `position-meta` tail. No migration. |
| Q2 | Budgets | Keep the code defaults: 3 × seats turns per issue (max 12), 40 per meeting, 8 minutes. Per-committee overrides in `procedures/_committees.yaml` may come later as a separate `procedures/**` change with its own policy impact analysis and ADR. |
| Q3 | Scope | All meetings (settled earlier; folded into Q8). |
| Q4 | Turn order | Deterministic code order: an addressed answer goes first, then round-robin. |
| Q5 | Hybrid | Humans may take a turn mid-meeting, with a bounded wait per turn. |
| Q6 | On failure | Resume from the issue where the run stopped. |
| Q7 | Minutes | A short per-issue transcript in the body, with every turn in an appendix. |
| Q8 | Round engine | Stays as an explicit, never-silent fallback. |

Details then left to the implementation (not owner decisions): the length of the human-turn wait (Q5), and how a resumed run marks the restart point in progress and minutes (Q6). Both were settled on 2026-11-20 below.

## Phase 2 decisions (2026-11-20)

Owner answer, chat, verbatim: "권장안대로 진행". Both recommendations in design §15.2 are adopted.

- **Hybrid human turns.** When a human seat has the floor, the engine pauses at phase `awaiting_human` (with `awaiting = { seat, seq, deadline_at }`) and returns; the human's submission, or the first poll/advance after the deadline, resumes it via `advanceCommitteeSession`. Wait is 3 minutes per human turn and 20 minutes total per meeting. Human wait is excluded from the 8-minute engine cap (only agent compute counts). On timeout the chair records a `pass_on_behalf` row (reason `human_timeout`) and never writes content for the human. The panel's poll deadline pauses while the session is awaiting a human.
- **Resume marking.** `meta.attempts` lists every attempt; every turn tail carries `attempt`; `seq` continues across attempts and is never reused; each restart writes exactly one chair `resume` turn. Minutes v2 add the header line "this meeting was held in N sittings" (when N > 1) and an appendix listing the turns of interrupted attempts.


## Phase 2.1 decisions (2026-11-20, owner)

Trigger: a dev measurement of the S6 `target-longlist-shortlist` committee (3 issues, 8m06s, 36/40 seat turns, 78 total rows). Every seat spoke in fixed order, mostly "amend: add my domain's condition", and each issue closed 11/11 accept. The meeting was long and shallow. Owner answer, chat, verbatim: "그렇게 해줘". Detail in design §16.

1. **Per-issue participants.** At agenda time the chair selects 3–5 relevant seats per issue, each with a one-line reason. Seats holding veto or mandatory-review authority for the gate (e.g. `risk-officer`) are always included. A non-participant may raise one `request_floor` per issue when its domain has a material issue; the chair accepts or declines, and the decision is recorded. Only participants vote; non-participants are recorded as "not participating in this issue" and never counted as accept (silence is not approval). Expected per-issue rows drop from ~23 to ~8–10.
2. **Display names in utterances.** Speakers are addressed by seat display name (e.g. "법률 위원"), never by agent key.
3. **Discussion quality.** Speaker selection gives turns to challenge/ask moves. Repeated "add my condition" amendments are limited: at most one amend per seat per issue unless responding to a question.
4. **Live UI.** An optional meeting window (modal) opened by the user via "회의 보기", never auto-opened. The page keeps a one-line status. Inside the window, auto-follow to the latest turn pauses when the user scrolls up and shows a "jump to latest" button. When a human has the floor, the page status becomes a prominent "your turn" alert. Applies to all committee screens.
5. **Old session history.** Prior committee sessions (mostly test runs, inconsistent with the new format) will be cleaned up separately after the owner confirms the scope. No deletion is authorized by this ADR.

## Default switched (2026-11-21, owner)

Owner decision, chat, 2026-11-21: "기본값 전환". The turn-based (dialogue) meeting is now the production default for new committee sessions. This replaces the earlier rollout rule "ship with unset → `rounds` until the S6/S4 live check passes" (design §15.3).

- `CO_NEWBIZ_COMMITTEE_ENGINE` unset or empty resolves to `turns`. `rounds` is an explicit opt-out: set `CO_NEWBIZ_COMMITTEE_ENGINE=rounds`, or pass the CLI flag `--engine rounds`. Any other value is refused at convene time and is never coerced.
- Existing sessions keep the engine stored in their `meta.engine`. Nothing is rewritten or re-run.
- The round engine stays as the explicit, never-silent fallback (Q8). An LLM failure still stops convening; it never drops to `rounds`. `human_only` sessions keep the round path (`docs/process-flow.md`, steering committee section).
- Rollback: set `CO_NEWBIZ_COMMITTEE_ENGINE=rounds` in the environment. Turn rows stay readable as history.
- The "measure cost and latency before default-on" condition in Consequences is now an operator follow-up, not a gate on the default.
