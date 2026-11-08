---
lang: ko
lang_reason: source-material
---

---
title: Committee minutes that read like a meeting
date: 2026-11-08
status: proposed
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

## 6. Decisions for the owner

1. Agenda: A1 (LLM with deterministic fallback, recommended), A2 deterministic only, or A3 none.
2. Storage: S2 meta_json (recommended, no migration) or S3 a new `committee_minutes` table (migration, ADR, data-architect).
3. Whether humans in hybrid mode may edit the chair agenda before round 2 (recommended yes).
4. Whether regenerating unconfirmed minutes is allowed (recommended yes, analyst+, audited, never after confirmation).
5. Whether to accept a new ADR-0196 plus amendment notes on ADR-0096 §4 and ADR-0104 (recommended), or fold everything into ADR-0104 amendments only.
6. Language of the AI-drafted minutes: follow the topic language, as `committee.position` does (recommended).
