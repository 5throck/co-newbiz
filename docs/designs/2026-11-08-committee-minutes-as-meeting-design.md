---
lang: ko
lang_reason: source-material
---

---
title: Committee minutes that read like a meeting
date: 2026-11-08
status: accepted
owner: process-governance-manager
reviewers: [platform-lead, data-architect, risk-officer]
related: [ADR-0096, ADR-0097, ADR-0104, ADR-0053]
---

# Committee minutes that read like a meeting

## 1. Problem

User feedback from 2026-11-08: the committee minutes read as if each agent lists
its own opinion. They do not read like a meeting. Root causes in the current code:

| # | Where | Cause |
|---|---|---|
| R1 | `app/web-next/lib/deliberation.ts` `deliberationPrompt` | Round 2+ pastes the other members' prior positions verbatim under "타 위원 이전 라운드 입장 (전문)". There is no instruction to respond to them, name a peer, or say whether the member's stance changed. The `committee.position` system prompt (`app/web-next/prompts/prompts.json`) asks for a standalone 150–300 word position. Each round is therefore N parallel monologues. |
| R2 | same | There is no agenda. Members restate the whole topic each round instead of converging on contested issues. |
| R3 | `app/web-next/lib/committee-scorecard.ts` `buildCommitteeMinutes` | The minutes are a scorecard table followed by "입장 원문", meaning every position dumped per round. Nothing is organized by issue, nobody is attributed as raising or answering a point, and there is no list of agreements, open questions, or action items. |
| R4 | `committee-session.ts` synthesis / `defaultSynthesis` | The chair synthesis is a vote tally (`buildSynthesis`) plus a one-line rationale. The chair (`process-governance-manager`, recorder pattern per ADR-0053) does not facilitate. |

Fixed boundaries that apply to every option below:

- Agents produce analysis and proposed recommendations only. The gate decision is human (`gate_decision`, ADR-0094/0053).
- Dissent is preserved verbatim by code (`buildSynthesis`, ADR-0096 §6). No LLM pass may summarize, replace, or reword `dissent_json`.
- Raw `agent_position` rows stay the record of what each member said. The structured minutes are a derived, labelled view and never replace them.
- All LLM output is a proposal.

## 2. Design

### 2.1 Responsive rounds (fixes R1)

Change `deliberationPrompt` for round 2 and later. It keeps pasting peers' prior positions verbatim (ADR-0096 §4 requirement unchanged) and adds:

1. **The member's own previous position.** Without it, a member cannot state whether they changed their mind. The original omission rationale ("the member already knows") does not hold for stateless LLM calls.
2. **A response contract:**
   - Address at least two named peers by seat key. For each, say *agree*, *rebut* (with the reason), or *ask* (a direct question).
   - Answer every question that was addressed to you in the previous round.
   - Add a `Stance change:` line: `unchanged | changed (from X to Y) because <peer/evidence>`.
   - Stay within the agenda issues when an agenda exists (§2.2). Off-agenda points go under `New issue:` and may not take more than one paragraph.
3. **A structured tail** that extends `position-meta` (backward compatible, all fields optional):
   `"responds_to":[{"seat":"risk-officer","act":"rebut|agree|ask","issue":"I2"}],"stance_changed":true|false,"issues":["I1","I2"]`.
   `parsePositionMeta` whitelists these fields the same way it whitelists `criteria_scores`. Unknown seats or acts are dropped, never trusted.

Deterministic template seats (`lib/committee-agents.ts`) emit the same tail with an empty `responds_to`, so LLM-less deployments and the boundary tests keep working.

The `committee.position` system prompt gets a round-aware section ("In round 2+, you are in a live meeting: respond to colleagues by name…"). The 150–300 word budget stays. This is a prompt-registry change (`prompts.json` → `prompts.generated.ts`).

**Human members (hybrid/human_only):** the positions form shows the same contract as optional fields: an "In response to" seat picker and a stance-change toggle. Humans are never forced to fill them.

### 2.2 Chair-set agenda after round 1 (fixes R2, optional)

After round 1, and only when `rounds >= 2`, the chair runs one **agenda pass**. It reads the round 1 positions and outputs 2–5 issues as `{id:"I1", title, raised_by:[seats], contested:boolean}`.

- Option A1 (recommended): an LLM agenda pass (`committee.agenda` prompt). If no LLM is configured, or the pass fails, use a deterministic fallback with one issue per criterion where the spread of `criteria_scores` is 2 or more, plus "Overall recommendation" when the recommendations are split.
- Option A2: deterministic only.
- Option A3: no agenda.

The agenda is a proposal that frames discussion. It is shown in the minutes as "Agenda (chair proposal)". In hybrid mode a human may edit it before advancing to round 2. This uses the existing `advance` route, which gets an optional `agenda` body.

### 2.3 Chair minutes pass (fixes R3/R4)

After synthesis, the chair runs a **minutes pass** (`committee.minutes` prompt). Its input is all rounds, the agenda, the structured `responds_to` tails, and the `buildSynthesis` result. Its output is JSON validated by a zod schema:

```
{ agenda:[{id,title}],
  discussion:[{issue_id, exchanges:[{seat, act:"raised|agree|rebut|ask|answer", summary, position_ref}],
               resolution:"agreed|narrowed|unresolved", resolution_note}],
  agreements:[{text, seats:[…]}],
  open_questions:[{text, owner_seat|owner_role, due_hint?}],
  action_items:[{text, owner_seat|owner_role}] }
```

Hard rules, enforced in code after parsing:

- Every `position_ref` must resolve to an `agent_position.id` in this session. Exchanges with unresolved refs are dropped, which makes fabricated quotes impossible to cite.
- `seat` must be a seat in the session.
- The pass is **not** given authority over recommendation or dissent. The minutes renderer takes "Proposed recommendation" from `gate_evaluation.recommendation` and "Preserved dissent" from `dissent_json` verbatim. The LLM's JSON has no field for either.
- Action-item owners are seats or human roles. Nothing is assigned to a named person unless a human edits it in.
- On failure or without an LLM, a deterministic fallback builds the discussion from the `responds_to` tails alone, grouped by `issue`. This is thinner but true.

### 2.4 Rendered minutes (fixes R3)

`buildCommitteeMinutes` produces these sections in order:

1. Header: committee, gate, mode, track, date, status, and the disclaimer "Decision support. The gate decision is recorded only by a human in gate_decision."
2. **Attendees and seats**: seat, member type (agent/human), chair and recorder marked.
3. **Agenda** (chair proposal).
4. **Discussion by issue**: for each issue, attributed exchanges such as "risk-officer raised… → financial-analyst rebutted… → risk-officer: stance unchanged", followed by the resolution. Each exchange links to `#pos-<id>`.
5. **Points of agreement.**
6. **Preserved dissent**: the `dissent_json` entries rendered verbatim, with an anchor to the raw position.
7. **Stance changes across rounds**: a deterministic table from `stance_changed` and the per-round `recommendation`.
8. **Open questions and action items** with owners.
9. **Proposed recommendation**: the `gate_evaluation` recommendation, labelled "proposal, not a decision", with the scorecard aggregate.
10. **Appendix**: the seat scorecard (existing) and the full verbatim positions by round, each with an `id="pos-<id>"` anchor. Nothing in the existing record is removed.
11. Footer: AI-produced sections are labelled "AI-drafted (chair minutes pass), verify against appendix", plus the minutes confirmation line.

Route: `GET …/minutes` keeps `text/markdown` as the default for compatibility, and gains `?format=json` for the UI.

UI: today `DecisionTab.tsx` (~L288) and `CommitteePanel.tsx` (~L416) link to the raw markdown in a new tab. Replace that with a shared `CommitteeMinutesView` component that follows Onyx 3.0 and the design-system lint. It renders the JSON by issue, has collapsible appendix positions, and shows dissent in its own region that cannot be collapsed. Keep a "Download Markdown" link. All committee panels on the stage screens reuse it. The ux-designer-agent provides the handoff and the frontend-engineer implements it.

### 2.5 Storage

| Option | Description | Schema change | Assessment |
|---|---|---|---|
| S1 | Derive on read: run the LLM minutes pass on every GET | none | Non-deterministic, costly, and the minutes shift between reads, which conflicts with the append-only chair confirmation (ADR-0104). Rejected. |
| S2 (recommended) | Persist the agenda and minutes JSON in `process_run.meta_json` (`agenda`, `minutes_draft{json,model,prompt_version,input_hash,created_at}`). Render the markdown on read from the stored JSON plus raw tables. | none (meta_json is free-form) | No migration. Confirmation freezes the stored draft: once `minutes_confirmed_by` is set, regeneration is refused. Weak point: meta_json is not queryable and holds blobs of a few KB. Acceptable at committee volume. |
| S3 | New table `committee_minutes(id, process_run_id, version, json, model, prompt_version, input_hash, created_at, confirmed_by, confirmed_at)` plus `agent_position.meta_json` for `responds_to` | migration 0190 + ADR + data-architect review | Cleanest versioning and audit trail. Needed if minutes later feed the IC package or search. |

Per-position `responds_to`/`stance_changed`: under S2, keep them inside the position text's `position-meta` tail, which is already stored verbatim in `position_md` and re-parsed on read. This needs no column.

Recommendation: **S2 now, with S3 deferred** behind an explicit trigger (minutes become an IC-package input or need cross-session queries). Any move to S3 requires an ADR and data-architect review per the workspace schema baseline.

### 2.6 Cost, determinism, caching

- Responsive rounds: input grows to roughly N × 300 words of peers' text plus the agenda, which is already the case today. The extra cost is about 150 words for the member's own previous position, and output stays at `maxTokens: 900`. Cap the peer text pasted per round at about 6k tokens. Beyond that, paste only the latest round in full and earlier rounds as their `position-meta` lines. Verbatim delivery of the latest round, which is the ADR-0096 §4 requirement, is preserved.
- Agenda pass: 1 call, ~600 output tokens. Minutes pass: 1 call, `maxTokens` ~2500, `temperature` 0.2.
- Determinism: the minutes pass runs once, at synthesis time (agent_team), or when the last round completes (hybrid/human_only). Its result is stored with `input_hash`, a sha256 over the ordered position ids and texts, the agenda, `prompt_version`, and the model. A GET never calls the LLM. Explicit regeneration (`POST …/minutes {regenerate:true}`, analyst+, audited) runs only when the run is unconfirmed and `input_hash` changed or the pass is in fallback state.
- Budget guard: when the LLM client reports a budget or rate-limit error, fall back to the deterministic minutes and mark them `fallback: true`. The run never fails because of the minutes.

### 2.7 ADR impact

- **ADR-0096**: amend §4 (round 2+ prompt content now includes the member's own prior position and a response contract; verbatim peer delivery unchanged; long-session paste cap). §6 is unchanged and restated as binding on the minutes pass, which has no write path to dissent.
- **ADR-0104**: amend the minutes decision. Minutes are now "deterministic record + stored AI-drafted structured minutes". Confirmation freezes the draft.
- **ADR-0097**: no change to seats. Add a note that the chair's facilitation (agenda and minutes passes) stays recorder-pattern and votes nothing.
- One new ADR (proposed number 0196, "Committee deliberation as a meeting: responsive rounds, chair agenda, structured minutes") records all three and the S2 storage choice. Per the project lifecycle rules this cannot pass on AI review alone. It needs human approval.

## 3. Files to change

| File | Change |
|---|---|
| `app/web-next/lib/deliberation.ts` | `deliberationPrompt` gets the own prior position, response contract, agenda block, and paste cap. Add a `runAgendaPass` hook to `runDeliberationRounds`. Export a pure `buildPromptContext` for tests. |
| `app/web-next/lib/committee-llm.ts` | Extend `parsePositionMeta` whitelist (`responds_to`, `stance_changed`, `issues`). Add `makeLlmChairAgenda` and `makeLlmChairMinutes`. |
| `app/web-next/lib/committee-agents.ts` | Deterministic seats emit the extended tail. Add deterministic agenda and minutes fallbacks. |
| `app/web-next/lib/committee-session.ts` | Run the agenda pass at round advance and the minutes pass at synthesis. Store both in meta. Accept an `agenda` override on advance (hybrid). Extend `CommitteeTranscript` with `agenda` and `minutesDraft`. |
| `app/web-next/lib/committee-scorecard.ts` | Restructure `buildCommitteeMinutes` per §2.4. Add `buildCommitteeMinutesJson`. Refuse regeneration after confirmation. |
| `app/web-next/lib/committee-minutes-schema.ts` (new) | zod schema plus a ref/seat resolver that drops invalid exchanges. |
| `app/web-next/prompts/prompts.json` (+ regenerated `prompts.generated.ts`) | Round-aware `committee.position`. New `committee.agenda` and `committee.minutes`. |
| `app/api/opportunities/[id]/committee-sessions/[sessionId]/minutes/route.ts` | `?format=json`. POST `{regenerate:true}` (audited) alongside `{confirm:true}`. |
| `…/[sessionId]/advance/route.ts` | Optional `agenda` body for hybrid/human modes. |
| `app/web-next/components/committee/CommitteeMinutesView.tsx` (new), `CommitteePanel.tsx`, `stages/route-decision/DecisionTab.tsx` | Shared minutes view replaces raw-markdown links. Positions form gets the optional response fields. |
| next-intl messages ko/en | New labels. |
| MCP `get_committee_session` | Include `agenda` and `minutesDraft` (read-only). |
| `skills/meeting-facilitation/SKILL.md` | Reference only (how-to); no procedure steps restated. |
| `docs/adr/0196-*.md`, ADR-0096/0104 amendment notes | §2.7 |

## 4. Tests

- `tests/unit/deliberation-prompt.test.ts`: round 1 unchanged. Round 2 contains every peer's position verbatim, the own prior position, the response contract, and the agenda. The paste cap keeps the latest round verbatim.
- `tests/unit/committee-llm.test.ts`: extended meta parse, whitelist drops unknown seats/acts, and old tails still parse.
- `tests/unit/committee-minutes-schema.test.ts`: fabricated `position_ref` dropped, and a non-session seat dropped.
- `tests/unit/committee-boundary.test.ts` (extend): the minutes JSON cannot alter recommendation or dissent. Rendered dissent is byte-equal to `dissent_json`. No "approved"/"decision" wording in the AI sections. The disclaimer is present.
- `tests/unit/committee-scorecard.test.ts`: section order, appendix anchors, deterministic fallback with no LLM. Regenerate is refused after confirm. A GET makes zero LLM calls (spy on `complete`).
- Route tests: `?format=json` envelope, regenerate auth/audit, and the 409 after confirm.
- E2E (agent_team, fake LLM): 3 seats, 2 rounds. The minutes show at least one cross-seat exchange per issue.
- Design-lint on `CommitteeMinutesView`.

## 5. Rollout

1. Phase A (prompt only, low risk): responsive rounds plus extended meta and tests. This alone changes how the raw positions read. Ship behind `CO_NEWBIZ_COMMITTEE_RESPONSIVE=1` and default it on after one pilot session.
2. Phase B: agenda pass plus minutes pass, stored in meta (S2), the new markdown layout, and the JSON route. ADR-0196 must be accepted before merge.
3. Phase C: `CommitteeMinutesView` UI on DecisionTab and the other committee panels.
4. Existing sessions are not backfilled. Their minutes render in the new layout with "Discussion by issue: not available (session predates structured minutes)" and the full appendix. An explicit regenerate is allowed for unconfirmed sessions only.

## 6. Owner decisions (2026-11-08, Accepted)

All nine decisions were made by the owner in chat on 2026-11-08. Quoted verbatim:

- Decisions 1–6: "결정힐 6가지 사안에 대해 권장안에 동의해."
- Decisions 7–8: the owner selected "confirm all as recommended".
- Decision 9: "9번도 변경해주는 것으로 확정할께" (overrides the "not in this change" recommendation).
- Scope: "다른 회의방식도 같은 형태로 바꿀 필요가 있어."

| # | Question | Owner decision |
|---|---|---|
| 1 | Agenda | A1: LLM chair agenda with deterministic fallback |
| 2 | Storage | S2: `process_run.meta_json`; S3 table deferred behind an explicit trigger (ADR + data-architect) |
| 3 | Hybrid humans may edit the chair agenda before round 2 | Yes |
| 4 | Regenerating unconfirmed minutes | Yes: analyst+, audited, refused after confirmation |
| 5 | ADR form | New ADR-0196 plus amendment notes on ADR-0096 §4, ADR-0097, ADR-0104 (and ADR-0186 for M7) |
| 6 | Language of AI-drafted minutes | Follows the topic language, as `committee.position` does |
| 7 | `skills/meeting-facilitation` adopts the same minutes structure as a markdown template | Yes; `scope: common`, so via `upstream_request_create` (filed by PM) with a project-local override until it lands |
| 8 | CLI `committee-deliberation.ts` persists agenda and minutes in `process_run` meta and renders the new layout | Yes |
| 9 | Entity-IC and Group-IC reviews become committee sessions with meeting-form minutes | **Yes**, in scope of this change as the last phase (Phase E, §7.2) |

Status: **Accepted**. ADR-0196 records the decisions.

## 7. Surface inventory (extension, 2026-11-08)

Every meeting-type surface moves to the same meeting form. The inventory comes from a repo sweep for `deliberationPrompt`, `runDeliberationRounds`, `agent_position`, `committee-session*`, `CommitteePanel`, "meeting", and `procedures/_committees.yaml`. That file defines exactly two committees.

| # | Surface | Where | Current format | Shares `deliberation.ts` + `committee-session.ts`? | Minimal change |
|---|---|---|---|---|---|
| M1 | S4 route steering committee (`route-steering-committee`, gate pre_fs) | `components/stages/route-decision/{DecisionTab,useRouteDecision,RouteDecisionStage}.tsx`, shared `components/CommitteePanel.tsx` | Session; rounds of independent positions; minutes are a scorecard plus raw positions | Yes, fully | Gets §2.1–2.3 for free. DecisionTab (~L288) uses `CommitteeMinutesView` |
| M2 | S6/S7 long list → short list committee (`target-longlist-shortlist-committee`) | `components/stages/brownfield/ShortlistSection.tsx` (~L345) → `components/CommitteePanel.tsx`; `useBrownfieldTargets.ts` | Same as M1, with a `target_ref` per target | Yes, fully | Free engine change. CommitteePanel (~L416) uses `CommitteeMinutesView`. The agenda pass names the target from `target_ref` |
| M3 | Pipeline auto-convene (`committee_proposal:pre_fs`, ADR-0102 §2a) | `lib/pipeline.ts` (~L244) | agent_team session, proposal only | Yes (`conveneCommitteeSession`) | Free. The budget guard matters most here because nobody watches the run |
| M4 | Committee deliberation CLI / `/meeting` engine path (ADR-0097 §7) | `scripts/co-newbiz/committee-deliberation.ts` | `runDeliberationRounds` with a `process_run`, no session meta; prints its own markdown | Partly: gets responsive rounds through `deliberation.ts`; has no agenda or minutes pass | Call the agenda and minutes hooks exported from `deliberation.ts`, write the same meta keys, render with `buildCommitteeMinutes` (decision 8) |
| M5 | MCP `list_committee_sessions` / `get_committee_session` | `mcp/co-newbiz/tools/committee.ts` | Read-only REST wrappers | Reads the session | Pass through `agenda` and `minutesDraft`. Stays read-only |
| M6 | IC package committee refs | `app/api/projects/[id]/ic-package/route.ts` (~L59) | Lists session ids | Reads the session | Link to `…/minutes?format=json` and the confirmation state. No content is copied, so dissent is never duplicated |
| M7 | Entity-IC and Group-IC reviews | `procedures/_shared/{entity-ic-review,group-investment-review}/schema.yaml` | Procedure step chains; no `agent_position` rows | No | Become committee sessions (decision 9); plan in §7.2 |
| M8 | Agent meetings (`skills/meeting-facilitation` v1.4.3, `.claude/commands/meeting.md`, `--agents/--rounds/--dialogue`) | Skill text; transcript in `memory/meeting-YYYY-MM-DD-<slug>.md` | Round-robin contributions, then PM synthesis. Already requires a dissent seat, proposal-only output and verbatim dissent | No (role-played, no app code) | Add the round 2+ response contract, a facilitator agenda after round 1, and the §2.4 section order as the transcript template (decision 7) |
| M9 | Dry-run and pilot runs | No dedicated meeting dry-run script; pilots run M1–M4 with deterministic seats (`lib/committee-agents.ts`) | Deterministic templates | Yes, through M1–M4 | Deterministic seats emit the extended tail; the deterministic agenda and minutes fallbacks cover LLM-less runs |

`deliberationPrompt` has no other consumer. Only `runDeliberationRounds` and the hybrid `advanceCommitteeSession` path call it.

### 7.1 Rollout across surfaces

| Phase | Surfaces | Content | Gate |
|---|---|---|---|
| A | M1–M4, M9 (engine) | Responsive rounds; extended meta tail; deterministic seats | Unit tests; `CO_NEWBIZ_COMMITTEE_RESPONSIVE` pilot on one M1 session |
| B | M1–M3 (session), M4 (CLI) | Agenda pass, minutes pass, meta storage, new markdown and JSON route, regenerate/confirm rules | ADR-0196 accepted; boundary tests |
| C | M1/M2 UI, M5, M6 | `CommitteeMinutesView`; MCP passthrough; IC package link | Design-lint; e2e |
| D | M8 | meeting-facilitation template and response contract | Upstream request; local override reviewed by PM |
| E | M7 | Entity-IC and Group-IC review committees (§7.2) | Procedure version bumps; policy impact analysis; `project_policy_pin` check; human approval |

### 7.2 M7 change plan: Entity-IC and Group-IC as committee sessions (decision 9)

**What it means.** The IC review stays a procedure step chain; the chain gains one deliberation step whose output is a committee session with meeting-form minutes. The session is decision support placed in front of the human verdict step. It does not replace any existing step, and it does not decide.

**Procedures (`procedures/**` change).**

- `procedures/_shared/entity-ic-review/schema.yaml` (v1.4.0 → v1.5.0): add a step between IC-package assembly (the second `process-governance-manager` step) and the `docs-writer` record step: "IC committee deliberation", `agent_key: process-governance-manager` (convene and close; chair is recorder-pattern), output `committee_session_ref` + confirmed-or-draft minutes ref. Seats are carried by the procedure as a contract (the schema supports a single `agent_key` per step): `risk-officer` (RAG proposal and kill criteria), `valuation-agent`, `financing-agent` (existing step 3.1 co-review), the track lead (`brownfield-agent` or `greenfield-agent`), `legal-counsel`, and the ADR-0097 standing functional seats as relevant. The final step (`entity-ic-reviewer`, human, ADR-0053) is unchanged.
- `procedures/_shared/group-investment-review/schema.yaml` (v1.3.0 → v1.4.0): same insertion before the `docs-writer` step; seats `group-review-agent` (portfolio fit, intra-group, capital allocation), `risk-officer`, `financing-agent`, `ir-agent` where disclosure applies. Final step (`group-ic-reviewer`, human, ADR-0186 D6) unchanged.
- `procedures/_committees.yaml`: register two committees, `entity-ic-committee` (gate `entity_ic`) and `group-ic-committee` (gate `group_ic`), with seat lists, `rounds`, and modes (`agent_team` default for the AI positions; `hybrid` lets human IC members add positions). Today the file defines two committees; this makes four.

**flow.spec (`process/flow.spec.yaml`, ADR-0074).** S11 `investment-structuring` / `risk-review` keep hosting `entity-ic-review`, and `group-review` keeps hosting `group-investment-review` (spec comment ~L115). No new stage activity is needed, because the deliberation is a within-procedure step (AGENTS.md §7: the procedure governs its internal steps). The gate exit criteria (~L410, ~L426) gain one line: "the IC committee session exists and its minutes are referenced in the IC package". This is a recorded spec change; flow.spec version bump.

**ADR-0097 seats.** The IC committees reuse the ADR-0097 seat model and the chair rule from ADR-0196: the chair facilitates (agenda and minutes passes) and votes nothing. Seat additions for IC go in `_committees.yaml`, not at runtime.

**ADR-0186 interplay (gate integrity).**

- The committee recommendation and scorecard are a new DISPLAY item in the `gate_decision_snapshot` at `entity_ic` / `group_ic`, alongside the existing AI recommendation. They are never an input to any HARD BLOCK or ACK rule.
- Unconfirmed minutes at GO: ACK with reason (silence is never read as pass). Missing session: ACK with reason in the first release; hardening to HARD BLOCK needs a separate owner decision.
- Recorded dissent appears verbatim in the snapshot reference; a GO over dissent needs no extra ACK beyond the existing items unless the owner later decides so.
- Maker-checker and countersign (D6) are untouched: the committee session is neither maker nor checker. The minutes confirmation (ADR-0104) must be by a person, and the same person may not both confirm the minutes and countersign the GO (maker-checker extended to the minutes confirmation). The `snapshot_hash` covers the minutes `input_hash` and confirmation state, so changed minutes return 409 `snapshot_stale`.
- Kill-criteria override (`group-ic-reviewer`) is unaffected.

**IC package (M6).** `app/api/projects/[id]/ic-package/route.ts` links the IC committee sessions next to the M1/M2 refs, with confirmation state. No content copied; dissent is never duplicated.

**Engine.** Sessions today are opportunity-scoped (`/opportunities/[id]/committee-sessions`). IC gates are project-scoped, so Phase E needs project-scoped convene/advance/minutes routes or a scope column. If that requires a schema change (rather than `process_run.meta_json`), it needs its own ADR and data-architect review per the workspace schema baseline.

**Policy impact analysis and `project_policy_pin` (required, procedures/** change).** Before merge: run the policy impact analysis over every policy/checklist referring to the two procedures and gates `entity_ic` / `group_ic`; list in-flight projects whose `project_policy_pin` pins entity-ic-review v1.4.0 or group-investment-review v1.3.0. Pinned projects keep their pinned versions; the new step applies to new pins only, or to a pinned project only through an explicit re-pin by a human (no silent migration).

**ADR.** The decision to run IC reviews as committees fits in ADR-0196 (owner decision 9; same meeting form, same boundaries). The procedure version bumps, the snapshot DISPLAY/ACK items, and the minutes maker-checker rule are recorded as an ADR-0186 amendment note. A separate ADR is warranted only if Phase E needs a schema change for project-scoped sessions; that ADR is drafted at Phase E start.

**Phasing.** Phase E runs last, after A–D, because it depends on the engine (A/B), the minutes view (C), and the IC package link (C). Gate: procedure and flow.spec version bumps, policy impact analysis, `project_policy_pin` check, and human approval (procedures and gate integrity cannot pass on AI review alone).

## 8. Amendment (2026-11-10): S4 committee brief, minutes topic, resolution decision rule (supplements A–G)

> **Status of this section.** Approved change set, revision v2 of the rejected fix plan, agreed in the supplement review meeting `memory/meeting-2026-11-10-committee-minutes-supplement.md` (2026-11-10) and approved by the user the same day. Row 0 only: this section is design + decision record + spec registration. Code, prompts, tests, and UI land in later rows per the landing order in §8.13. Gate-moment ruling: `docs/decisions/DEC-20261110-01.md`. No `process/flow.spec.yaml` change is in scope — committee session mechanics are ADR-0196 product code, not procedure `agent_key` steps.

### 8.1 Confirmed defects this amendment fixes

| # | Defect | Where |
|---|---|---|
| D1 | S4 route-steering committee convenes with no brief — the topic is the one-liner `route_decision 심의 (진행 pre_fs)` | `app/web-next/lib/committee-session.ts:423-427` (`sessionTopic`); both web (`RouteDecisionStage.tsx:178-187`) and pipeline (`pipeline.ts:280-293`) paths omit `briefMd` |
| D2 | The minutes pass discards the topic entirely (`_topic` parameter unused) | `committee-session.ts:308` (`runMinutesPassForRun`) |
| D3 | Per-issue resolutions default to `unresolved` through three stacked causes: (a) bare enum in the prompt with no decision rule (`prompts.json` key `committee.minutes`), (b) silent `"unresolved"` fill in `normalizeMinutesDraft` (`committee-minutes-schema.ts:106`), (c) the deterministic fallback's "one rebut ⇒ unresolved" rule keyed off `responds_to` tails that are OFF by default (`committee-chair.ts:245-286`; `committee-flags.ts:14-17` — `CO_NEWBIZ_COMMITTEE_RESPONSIVE` unset) | `prompts.json`, `committee-minutes-schema.ts`, `committee-chair.ts` |
| D4 | The view and markdown renderer print the raw English enum (`agreed`/`narrowed`/`unresolved`) | `app/web-next/components/CommitteeMinutesView.tsx:161`; `app/web-next/lib/committee-scorecard.ts:229` |
| D5 | The committee roster includes a red-team seat that structurally rebuts, so any "one rebut ⇒ unresolved" rule guarantees permanent `unresolved` even for successful LLM minutes | `committee-agents.ts:145-158`; `committee-chair.ts:273-274` |

### 8.2 `buildPreFsCommitteeBrief` (supplements A + C)

New export in `app/web-next/lib/gate-brief.ts`:

```
buildPreFsCommitteeBrief(db: Database, opportunityId: string): string | undefined
```

Composition, in order:

1. **Leading scope line (supplement C).** One line stating that quantitative financial evidence is produced at S5/S8 and this brief grounds route/scope judgment only. Design-doc wording: *"quantitative financial evidence is produced at S5/S8 — this brief grounds route/scope judgment only"*; the rendered brief line is Korean product content, e.g. `정량 재무 근거는 S5(투자계획)/S8(Business Case)에서 산출된다 — 본 브리프는 라우트·범위 판단의 근거만을 제공한다`. Purpose: stop `resolution_note`s at pre_fs from imitating viability conclusions without basis (same logic as the no-backfill rule for missing S5 data).
2. **Manifest context.** `buildGateContext(db, "opportunity", opportunityId, "pre_fs")` — the existing ADR-0118 `MANIFESTS.pre_fs` blocks (`gate-brief.ts:49-56`, builder at `gate-brief.ts:352`): S1 시장 규모·성장 추정, S1 경쟁 구조, S3 적합성·시너지 초안, S3 필요 역량 수준 요약, S4 트랙 결정·라우트, S5 역량 격차·진출전략 또는 BF 쇼트리스트. The existing honest-unset labels (`없음`, `미작성`, `미기록`) stay.
3. **Track advisory section.** `computeTrackAdvisory(db, opportunityId)` signals (`track-advisory.ts:28`) rendered as judgment evidence: one row per signal (`label · leans · weight · note`) with **both directions visible** (counter-evidence included) so the brief frames evidence, never judgment direction (anchoring-bias guard, risk-officer). Base rates and re-review triggers are included. The advisory's own `recommendedTrack` appears only as one labeled proposal line — "결정론 트랙 권고 (proposal, not a decision)" — matching the flow.spec `route-advisory` comment ("산출물은 권고일 뿐이며 결정은 사람의 route_decision") and boundary #2.

Content discipline (supplement A):

- **Every figure row carries its source version id and data-confidence grade.** S1 sizing figures carry the `market_sizing_version` identity they were read from; the S2-confirmed entry-market growth carries the ADR-0181 confirmed-entry-market reference; S3 score rows carry "proposal (AI draft)" plus the data-confidence grade per ADR-0090 (gate proposals, not verdicts). Data confidence caps any grade shown (workspace boundary: data confidence caps the RAG grade).
- **Unset states render honestly.** No completed S1 analysis → `시장 근거 미산출`; no S2-confirmed entry market → `진입시장 미확정` (ADR-0181). Silent defaults are forbidden in this domain.
- **Returns `undefined` when no artifacts exist** — i.e. every manifest block is an absent/unset marker and the advisory has no computable signals. Then the session convenes with the plain one-liner topic exactly as today: brief omitted, convening proceeds, **no fabrication**. The brief is a declared-input grounding, not a gate condition (§8.11).

The brief follows the existing storage seam: `ConveneOpts.briefMd` → `SessionMeta.brief_md` (`committee-session.ts:504`) — a key that already exists, so the stored session shape is unchanged.

### 8.3 Default brief injection at the single choke point

`createCommitteeSession` (`committee-session.ts:468-505`) gains one default: when `entity.entityType === "opportunity"` AND the resolved `gate === "pre_fs"` AND `opts.briefMd === undefined`, set `opts.briefMd = buildPreFsCommitteeBrief(db, entity.entityId)` (which may itself be `undefined` — then no brief). Rules:

- **Client-supplied `briefMd` wins** — the S6/S7 committees keep their caller-built `buildEvalBriefMd` briefs untouched; injection never overwrites an explicit brief.
- **Web and pipeline paths are both covered** because both funnel through `createCommitteeSession` (web: `RouteDecisionStage` → committee-sessions route; pipeline: `conveneCommitteeSession` at `pipeline.ts:280-293`). There is no second convening path to patch.
- Project-scoped sessions (future `entity_ic`/`group_ic`, §7.2 Phase E) are excluded by the entity-type guard — they never receive an opportunity brief.

### 8.4 The minutes pass receives the topic (D2) — and the hash blast radius

`runMinutesPassForRun` stops discarding its `topic` parameter (`committee-session.ts:308`): the topic flows into `runChairMinutes` material as a leading `## 심의 안건` section (before `## 안건 쟁점 (의장 제안)`, `committee-chair.ts:307-323`), so the chair minutes pass knows what meeting it is minuting.

**Input-hash change.** The minutes `input_hash` parts become `[rows, agenda, topic, MINUTES_PROMPT_VERSION, model]` — the topic is added — consistently in both `runChairMinutes` (`committee-chair.ts:364-369`) and `minutesInputHashFor` (`committee-chair.ts:380-382`).

**Blast radius (documented as intended).** The hash formula change means `minutesInputHashFor` never matches a hash computed under the old formula, so the `regenerate_not_needed` guard (`committee-session.ts:1135`) no longer trips for any stored session:

- Every **unconfirmed** stored session becomes regeneration-eligible (the analyst can regenerate; audited, per ADR-0196 decision 4).
- Every **confirmed** session stays frozen — the `minutes_already_confirmed` refusal (`committee-session.ts:1129-1131`) precedes the hash comparison, so confirmation still freezes the draft (ADR-0104).

**No bulk regeneration will be run** (supplement-meeting action item 4): fix-forward plus one reconvene validation on the target deal `01M6JN4YGJXD0BYT7DFH9MWKQ0`. Bulk regeneration of stored minutes would be a form-only improvement and violates the honesty rule.

### 8.5 Prompt decision rule (supplement B)

The decision-rule text goes **inside the existing 5-section skeleton** of the `prompts.json` key `committee.minutes` (`# Evidence boundary` / `# Task` / `# Output contract` / `# Language` / `# Proposal-only disclaimer`) — no new headings (the prompt-registry machine bar in `scripts/co-newbiz/generate-prompt-registry.ts` fails on undeclared sections). Draft text (English, prompt language rules apply; JSON vocab stays English):

> Apply this decision rule for `resolution`: **agreed** = the seats' positions converged and no rebuttal remains outstanding; **narrowed** = partial convergence, or the issue's scope was reduced to what is settled; **unresolved** only when the rounds were exhausted without convergence. A recorded dissent never makes an issue unresolved — dissent is preserved verbatim elsewhere and does not affect convergence. Every `unresolved` issue must be paired with an open question that names an owner (`owner_seat` or `owner_role`). Each `resolution_note` must cite the deal evidence it rests on from the material (figures, scores, or stated positions), never a generic restatement.

Placed in `# Task` (after the resolution sentence) with the contract line in `# Output contract` updated to match. Consequences:

- Recorded dissent and issue convergence stay orthogonal: dissent lives verbatim in `dissent_json` (ADR-0096 §6, unchanged); the minutes resolution records convergence.
- **Codegen rerun is mandatory**: `bun scripts/co-newbiz/generate-prompt-registry.ts` after the `prompts.json` edit.
- `MINUTES_PROMPT_VERSION` bumps `committee.minutes@1` → `committee.minutes@2` (`committee-chair.ts:27`) so stored drafts are distinguishable by prompt version.

### 8.6 Degraded-resolution visibility (supplement F)

`resolveMinutesDraft` (`committee-minutes-schema.ts:136-150`) changes its return from `CommitteeMinutesJson | null` to a pair `{ draft: CommitteeMinutesJson | null; degraded: number }`, where `degraded` counts the discussion items whose `resolution` was **silently filled** by `normalizeMinutesDraft` (missing per-item resolution AND no top-level `resolutions` entry — the branch at `committee-minutes-schema.ts:106`). Tolerant repair is kept (§8.12); the repair becomes **visible**.

Storage: the count is stored as **`minutes_draft.degraded_resolutions`** — a sibling key of the `MinutesDraft` meta object (`committee-chair.ts:67-74`), NOT inside the zod-validated JSON, so the stored shape stays stable and the schema is untouched.

- Stored on every LLM-pass draft as an integer ≥ 0 (0 included), so **absence** of the key means "fallback draft or pre-amendment session".
- Fallback drafts (`computeMinutesFallback`) keep only their existing `fallback: true` signal; the fallback's `unresolved` fill is its own declared output, not a silent repair, and is not double-counted.
- **Agenda-filter interaction (QA reconciliation, 2026-11-10)**: the degraded count includes only discussion items that survive the agenda filter — a silently-filled item dropped as off-agenda is not counted — so the chip count always matches the stored draft the reader sees.

UI (supplement G): when `degraded_resolutions > 0`, render an amber chip reusing the existing `status-chip` component pattern with text **`일부 결론 자동 대체(N건)`** — text carried, never color-only (§8.10).

### 8.7 UI labels and badges (supplement G)

- **Locale-keyed labels** in `app/web-next/locales/ko.json` and `en.json`: `agreed → 합의`, `narrowed → 일부 합의`, `unresolved → 미합의(보류)`. The **payload enum stays English** (prompt language rules; display labels are product content per the language policy, docs/context.md / ADR-0090 W1b). `CommitteeMinutesView.tsx:161` and `committee-scorecard.ts:229` stop printing the raw enum.
- **Open-questions count badge**: each `unresolved` issue's conclusion line gains a badge showing the session-level open-questions count (`미해결 질문 N건`), anchored to the Open questions section — an unresolved issue is never a dead end (risk-officer requirement, closed at the UI layer). Per-issue linkage would need an `issue_id` on `open_questions` (a schema change) and is explicitly out of scope; the session-level count is the honest zero-schema-change form.
- **Existing status-chip patterns only** — no new components, no new design tokens (ux-designer-agent handoff constraint; design-system lint stays green). UI lands after the currently staged `CommitteeMinutesView` field-names commit to avoid churn.

### 8.8 `computeMinutesFallback` is KEPT unchanged (explicit decision)

The deterministic minutes fallback (`committee-chair.ts:245-286`), including its "any rebut ⇒ unresolved" rule, is **kept byte-identical**. Rationale: it serves only LLM-less or budget-degraded runs, where it is already flagged `fallback: true` and rendered with the regeneration chip; changing its semantics would widen the row scope and touch the boundary tests for no measured gain. The fix for D3/D5 relies on (a) LLM pass quality — the `maxTokens: 6000` fix has already landed (`committee-llm.ts:154`; 2500 truncated mid-JSON and silently degraded to the empty skeleton) — plus (b) the brief and topic injection (§8.2–8.4) and (c) the prompt decision rule (§8.5). The rule D5 still holds inside the fallback; that is accepted because the fallback surface is explicitly labeled degraded.

### 8.9 Agenda fallback titles get Korean labels

`computeAgendaFallback` (`committee-chair.ts:124-158`) titles its issues from the raw English criterion keys (`기준 쟁점: control_need (의견 산포 2)`). The five `CRITERIA_KEYS` gain a Korean label map matching the flow.spec 5criteria names:

| Key | Title label |
|---|---|
| `control_need` | 통제 필요도 |
| `capability_criticality` | 역량 결정성 |
| `market_uncertainty` | 시장 불확실성 |
| `integration_capacity` | 통합 역량 |
| `speed_to_capability` | 역량확보 속도 |

Title becomes `기준 쟁점: 통제 필요도 (의견 산포 2)` — titles are display content (Korean); the machine key stays in code/tests via the constant. The prompt `committee.agenda` is NOT changed in this amendment, so `AGENDA_PROMPT_VERSION` stays `@1`.

### 8.10 Accessibility

Mandatory per docs/context.md (Accessibility Standards) for this user-facing feature:

- **Target level**: WCAG 2.1 AA.
- **Labels/badges carry text**: the resolution label is always a text string (`합의` / `일부 합의` / `미합의(보류)`); the degraded chip and open-questions badge carry their full text (`일부 결론 자동 대체(N건)`, `미해결 질문 N건`) — the amber color and badge presence are never the only signal (SC 1.4.1 use of color).
- **Existing components only**: the chip/badge reuse the existing status-chip pattern, inheriting its focus, contrast, and screen-reader behavior; no new interaction is introduced.
- **Keyboard order unchanged**: additions are inline text on existing conclusion lines; tab order and reading order of the minutes view are unchanged.
- **Badge anchor behavior (QA reconciliation; PM ruling 2026-11-10)**: the open-questions badge ships as an in-page anchor link to the Open questions heading (`id="committee-minutes-open-questions"`), which adds one tab stop per unresolved issue that has open questions; this resolves the §8.7 "anchored" wording against this section's "keyboard order unchanged" in favor of §8.7, judged accessibility-sound in the AI-2nd review (text-carried accessible name, inherited focus ring, existing reading order unchanged). Ruling recorded by PM — DEC-20261110-01 remains the vehicle; this note documents the shipped behavior.
- **Verification**: design-lint on the touched components plus the `accessibility-audit` skill (axe-core, WCAG 2.1 AA) in the QA row.

### 8.11 flow.spec S4 verification result (was UNVERIFIED in the meeting)

Verified against `process/flow.spec.yaml` (ADR-0074) v2.20.0 line, stage `S4` (lines 666-754). Verbatim:

```yaml
inputs:
  - 시너지·적합성 평가
  - 역량 갭 분석 (S3 — 시장 요구사항 대비 그룹/계열사 보유 역량)
  - 진입시장 성장률 (S2 확정 — ADR-0181; 라우트 어드바이저 성장 신호의 기준)
  - 시장 규모·성장 추정 (S1)
  - 경쟁 구조 (S1)
  - 가치사슬 구조 (S1)
outputs:
  - 라우트 결정 기록
entryCriteria:
  - S3 완료
```

Findings:

1. **`entryCriteria` enforces only `S3 완료`** — no artifact-presence gate on S1/S2 outputs. The S1/S2 items are **declared inputs** (per the flow.spec v2.4.0 input-chain note, "S4 결정이 시장·경쟁·역량 근거 위에서 이루어지도록 입력 사슬을"), not enforced entry conditions.
2. **No committee activity exists in S4** — its activities are `route-strategy`, `route-advisory`, `wacc-hurdle-confirmation`, `certification-screen`, `regulatory-screening`. The route-steering committee session is ADR-0196 product code hosted outside flow.spec activities (`gates: [screening, pre_fs]` on S4), confirming process-governance-manager's position: no flow.spec change is in scope.
3. **Consequence for this design**: the brief surfaces exactly the artifacts S4's `inputs` declare, and because entry criteria do not gate on them, "artifacts absent → brief omitted, convening proceeds, no fabrication" (§8.2) is **aligned with the spec, not an exception to it**. No spec-vs-implementation divergence is introduced.

### 8.12 Alternatives considered

1. **Reject drafts with missing resolutions instead of tolerant repair.** Ruled out: strict rejection pushes systematic LLM-shape failure into the invisible deterministic fallback — the exact failure mode recorded in `.trail/learnings/2026-11-10-silent-zod-fallbacks-turned-an-llm-sunghyuk.md`. Chosen path: keep tolerant repair, make the repair count visible (`degraded_resolutions`, §8.6).
2. **Gate-block convening when the brief cannot be built.** Ruled out: minutes are an AI draft on a proposal-only surface whose outputs are already confirmed by humans (ADR-0104; AGENTS.md boundary "gate approval and investment decisions belong to humans"). Blocking would also contradict flow.spec, whose S4 entry criteria do not gate on S1/S2 artifact presence (§8.11).
3. **Change `computeMinutesFallback` semantics.** Rejected — explicit keep decision (§8.8).
4. **Put `degraded_resolutions` inside the zod JSON.** Rejected — it would change the validated stored shape and make pre/post-amendment drafts schema-incompatible; the sibling-meta-key form keeps the shape stable (backend-engineer, supplement F).
5. **New spec file for the amendment.** Rejected — Row 0 determination: update the registered design `2026-11-08-committee-minutes-as-meeting-design` in place with a dated amendment section (this section); the spec id stays stable.

### 8.13 Files to change (amendment delta; Row 0 only — implementation in later rows)

| File | Change | Row |
|---|---|---|
| `app/web-next/lib/gate-brief.ts` | New `buildPreFsCommitteeBrief` (§8.2) | Row 2 |
| `app/web-next/lib/committee-session.ts` | Default brief injection in `createCommitteeSession`; `runMinutesPassForRun` passes topic; store `minutes_draft.degraded_resolutions` (§8.3, §8.4, §8.6) | Row 2 |
| `app/web-next/lib/committee-minutes-schema.ts` | `resolveMinutesDraft` returns `{ draft, degraded }` (§8.6) | Row 2 |
| `app/web-next/lib/committee-chair.ts` | Minutes material gains `## 심의 안건`; input hash parts gain topic; `MINUTES_PROMPT_VERSION` → `@2`; agenda fallback Korean labels (§8.4, §8.5, §8.9) | Row 2 |
| `app/web-next/prompts/prompts.json` → `prompts.generated.ts` | Decision rule inside the existing 5-section skeleton; rerun `bun scripts/co-newbiz/generate-prompt-registry.ts` (§8.5) | Row 2 |
| `app/web-next/components/CommitteeMinutesView.tsx` | Locale label use, degraded chip, open-questions badge (§8.6, §8.7) | Row 3 |
| `app/web-next/lib/committee-scorecard.ts` | Markdown renderer uses locale labels (§8.7) | Row 3 |
| `app/web-next/locales/ko.json`, `en.json` | Label keys (§8.7) | Row 3 |
| `tests/unit/committee-{minutes,minutes-schema,agenda,boundary}-*.test.ts` | Extensions per §8.14 | Row 4 |

Landing order (platform-lead): design doc (Row 0, this section) → schema + prompt codegen → lib → UI + locales → tests → QA. QA reviewer from a different domain than the author (three-stage review).

### 8.14 Test plan

- **Default-brief injection**: convene (`entity = opportunity`, `gate = pre_fs`) with no `briefMd` on a deal that has S1/S3 artifacts → `meta.brief_md` present, contains the scope line, version ids, and grade tags; convene with an explicit `briefMd` → `meta.brief_md` equals the client's (injection did not override).
- **Absent artifacts**: deal with no S1 analysis, no S3 scores, no advisory signals → `buildPreFsCommitteeBrief` returns `undefined`; `meta.brief_md` absent; convening proceeds (no fabrication).
- **Degraded count**: a fixture draft with 2 discussion items missing `resolution` and no top-level `resolutions` → `resolveMinutesDraft` returns `degraded: 2`; stored `minutes_draft.degraded_resolutions === 2`; a clean fixture → `degraded: 0` stored; a fallback draft → key absent.
- **Dissent ≠ unresolved**: prompt-fixture draft where a seat recorded dissent (`veto_dissent`) and one rebut occurred but positions converged → resolution is `agreed`/`narrowed`, never force-rewritten to `unresolved` by the normalizer; the `# Task` decision-rule text is present in the generated prompt (codegen snapshot).
- **Topic**: `runMinutesPassForRun` material starts with `## 심의 안건` + topic; `minutesInputHashFor` differs when the topic differs; confirmed-session regeneration still refused (`minutes_already_confirmed`).
- **Locale labels**: ko/en maps resolve all three enum values; view and markdown renderer print Korean labels, never the raw enum; degraded chip renders `일부 결론 자동 대체(N건)` only when count > 0; badge text present on unresolved conclusion lines.
- **Agenda fallback labels**: spread-2 criterion issue titles carry the Korean labels (§8.9 table).
- **Suites extended**: `tests/unit/committee-minutes.test.ts`, `tests/unit/committee-minutes-schema.test.ts`, `tests/unit/committee-agenda.test.ts`, `tests/unit/committee-boundary.test.ts` (boundary: the JSON still has no recommendation/dissent field; rendered dissent byte-equal to `dissent_json`), plus `tests/unit/committee-minutes-view.test.ts` for the label/chip/badge rendering.
- **QA (audit per supplement E, read-only)**: resolution distribution before/after deploy as reference classes; target-deal artifact presence (S1/S2/S3) check — ad-hoc read-only queries at validation time, no new permanent script.

### 8.15 Minutes-pass LLM timeout fix (2026-11-10, validation finding)

> Status: implemented in the working tree, unit-tested, and validated; this subsection is the documentation reconciliation the QA review required. The §8 preamble's "Row 0 only" scoping applies to §8.1–§8.14; this fix landed in the same amendment wave after end-to-end validation surfaced it.

**Finding.** The end-to-end validation session `01M72WQKQJ44YWARRKK6ZXBTFV` (deal `01M6JN4YGJXD0BYT7DFH9MWKQ0`) showed the amendment working — brief injection and the deal-specific agenda both landed — but the minutes LLM pass aborted at exactly 120.02 s ("The operation timed out.", dev log line 1855) and degraded to the deterministic fallback (5 issues, all `unresolved`, no notes or exchanges). That is the exact D3/D5 defect surface §8 exists to close, reproduced by an infrastructure timeout rather than prompt quality.

**Corrected root cause.** `makeLlmChairMinutes` goes through the NON-streaming path (`complete` → `completeDetailed` → `runProvider` in `app/web-next/lib/llm.ts`), whose fetch had a hardcoded `AbortSignal.timeout(60_000)` applied **per attempt** across the 2-attempt retry loop — 2 × 60 s = 120 s, matching the observed abort to the second. (The streaming 120 s default at the `stream()` fetch was NOT the culprit for this call path — the minutes pass never streams.)

**Fix.** An optional `signal?: AbortSignal` is plumbed through `complete()` / `completeDetailed()` / `CallSpec` in `llm.ts`; the option defaults preserve the old behavior, so all other callers are unaffected. `makeLlmChairMinutes` passes `AbortSignal.timeout(CHAIR_MINUTES_TIMEOUT_MS)` with the exported `CHAIR_MINUTES_TIMEOUT_MS = 300_000` (`committee-llm.ts`); the shared signal instance bounds the whole `complete()` call across both retry attempts (worst case ~300 s). Unchanged: the agenda pass (~600 output tokens), the per-member position calls, `stream()`'s 120 s default, and the 60 s transport default. Rationale: the pass legitimately generates up to 6000 output tokens of structured Korean JSON (the `maxTokens: 6000` fix, §8.8) and runs on the async background convene path (the POST route already returns 202), so a longer timeout has no request-latency impact; the fallback it used to degrade into is the all-`unresolved` empty skeleton (§8.8).

**Tests.** `tests/unit/committee-llm.test.ts`: the `CHAIR_MINUTES_TIMEOUT_MS` export is asserted to equal 300_000; a transport-level fetch capture asserts a defined, non-aborted `AbortSignal` reaches the fetch and that the 60 s default was bypassed.

**Incidental typed improvement (no behavior change for current callers).** `stream()`'s non-streamed fallback (its `completeDetailed` delegation) now honors a passed `signal`; no module currently imports `stream()`.

### 8.16 Known follow-ups (non-blocking, out of §8 scope)

Recorded from the QA review and the 2026-11-10 validation so they do not rot; each needs its own row or ticket.

- **position-meta tails absent from LLM-member seats** since the 2026-11-09 executor registration fix (0/20 in the last 6 sessions vs 20/20 in the three earliest) — degrades the deterministic minutes fallback and the agenda fallback's criterion-spread path. Owner: backend, separate row.
- **`buildGateContext` s4Summary `rationale.slice(0, 300)`** hard cut without ellipsis (`gate-brief.ts:235`, pre-existing) — cosmetic.
- **Seam/type drift without guards**: the resolution-label map is duplicated between the `committee-scorecard.ts` inline map and `ko.json` with no drift guard; `MinutesPassResult` is type-duplicated between `committee-chair.ts` and `deliberation.ts`; `s1Summary`'s `market_scope` name-join diverges from `track-advisory`'s industry_id-first join — align in a future row.
- **Two pre-existing `locale-jargon-lint` findings on HEAD** (en.json killCriteria agent-key title; ko.json `review.dev.summary` "개발자") — separate ticket.
