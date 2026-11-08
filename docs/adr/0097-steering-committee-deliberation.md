---
lang: ko
lang_reason: source-material
---

# ADR-0097: Steering-committee deliberation — registered committees, three decision modes, and the agent_team proposal surface

- Status: Accepted
- Date: 2026-09-03
- Deciders: New Business Review Lead (PM), per approved S8–S11 implementation plan (Phase 2)
- Design of record: `procedures/_committees.yaml` (new), `procedures/_validate.ts`, `app/web-next/lib/agent-orchestrator.ts` (`runDeliberationRounds`), `app/web-next/app/api/opportunities/[id]/committee-sessions/**`, `app/web-next/components/CommitteePanel.tsx` (new), `.claude/commands/meeting.md`
- Related: ADR-0096 (deliberation/activity orchestration engine; runDeliberationRounds, dissent rule, human-seat member_type), ADR-0094 (opportunity as S1–S7 carrier; gate_decision as the sole human-confirmation ledger), ADR-0095 (project promotion foundation, S8–S11), ADR-0053 (gate authority; human-role registry; recorder pattern), ADR-0085 (entity establishment execution layer), ADR-0094 §6 / ADR-0011 (MCP access is REST-only; no dead endpoints)
- Related non-ADR artifacts: project CLAUDE.md (four domain leads), design v1.0 (`2026-08-19-co-newbiz-design_ko.md` — cross-validation matrix, risk-officer kill-criteria authority), `skills/meeting-facilitation/SKILL.md`

## Context

S4 (route decision) and S6/S7 (Long List → Short List) are today single-record
surfaces: the route-decision API/UI, and the brownfield target
screening/shortlist routes, each record one outcome with no recorded
deliberation behind it. The user directive for this phase is that deliberation
should not have to be human-only — a systematic agent-team committee may
deliberate and *propose*, with three decision modes (`human_only`,
`agent_team`, `hybrid`), while design boundary #2 stands unchanged: **agents
propose, humans always confirm gate records** (ADR-0053, ADR-0094).

ADR-0096 (Phase 1) just delivered the machinery this phase consumes:

- `runDeliberationRounds(entity, {committeeKey, topic, rounds, agents, ...})`
  in `app/web-next/lib/agent-orchestrator.ts` — round 1 independent
  positions, round 2+ each member receives the full prior-round positions of
  all others; per-round positions land in `agent_position` with the
  `member_type IN ('human','agent')` seat model (0065);
- chair synthesis into a single `gate_evaluation` carrying a **PROPOSED**
  recommendation;
- `gate_evaluation.dissent_json`, with the ADR-0096 §6 rule that veto-dissent
  positions are copied verbatim, never summarized or averaged;
- nullable `gate_evaluation_id` linkage columns on `gate_decision`,
  `route_decision`, and `brownfield_target` (0066).

Separately, the `/meeting` skill is a registration stub:
`.claude/commands/meeting.md` delegates to itself (the actual facilitation
flow was never written) while promising a transcript to
`memory/meeting-YYYY-MM-DD-[slug].md`. `skills/meeting-facilitation/SKILL.md`
documents the same promise. It is a dead surface awaiting exactly the engine
0096 shipped.

## Decision

### 1. The 5-role committee skeleton is derived from repo principles, not ad-hoc

The committee composition is not a hand-picked roster; every seat is derived
from an existing structural rule:

| Principle (source) | Derived seat |
|---|---|
| Four domain leads: functional/technical/industry/region (project CLAUDE.md); second-stage review must come from a **different domain** than the author (design v1.0 cross-validation matrix) | **domain expert** — the track agent (`brownfield-agent` or `greenfield-agent`; the only seat that swaps by track), plus **industry expert** (`industry-lead`) and **region expert** (`region-lead`) |
| S4/S6–S7 conclusions ride on proxy-chain market estimates and valuation | **quantitative rigor** — `market-intelligence-agent` for S4 (route/market), `valuation-agent` for S6/S7 (target economics) |
| Design v1.0 already grants risk-officer kill-criteria authority across all gates | **red team** — `risk-officer`, **fixed on every committee and mandatory**; optimism-bias auditing is the role, not an option |
| ADR-0053 recorder pattern — a synthesizer that votes nothing, decides nothing | **chair/synthesis** — `process-governance-manager` |

The full skeleton is five seats; all eight referenced agent definitions exist
under `agents/`. The skeleton is **recommended** for future committees (S3
screening, S8 case-adoption, S9 checklist-approval) — it is encoded in the
`_committees.yaml` header comment, not hardcoded in the validator.

### 2. Structural asymmetry: risk-officer dissent is never averaged away

When the risk officer issues `veto_dissent`, the dissent position goes
**verbatim** into `gate_evaluation.dissent_json` regardless of how the rest of
the committee voted. ADR-0096 §6 already enforces this in the synthesis code
path; this ADR makes it a **committee contract term** rather than an
implementation detail: any future committee registered in `_committees.yaml`
inherits the rule by way of the mandatory red-team seat (§4 validator), and
removing it would require a new ADR, not a config edit.

### 3. `procedures/_committees.yaml` — the committee registry

New sibling of `_human-roles.yaml`, read statically by `_validate.ts` (no
database dependency). Schema:

- `committees.<key>.applies_to` — stage/gate scope (e.g. S4 gate `route`; S6/S7 targets);
- `members[]` — `type: agent | human_role`, `key` (agents/<key>.md name or
  `_human-roles.yaml` registry key), optional `applies_when` (seat
  conditional, e.g. the quantitative seat per stage), `veto_dissent: true`
  flag on the red-team seat;
- `chair` — the recorder-pattern synthesizer;
- `rounds` — minimum 1;
- `decision_modes_allowed` — closed enum `human_only | agent_team | hybrid`.

Two committees are registered initially:

1. `route-steering-committee` — applies to S4 (route decision);
2. `target-longlist-shortlist-committee` — applies to S6/S7 (Long List →
   Short List).

### 4. `procedures/_validate.ts` extension

A new committee-registry pass (mirroring the kill-criteria and
human-role passes in shape — static, loud, error-vs-warn discipline):

- `members[].key` existence check: `agent` keys must resolve to
  `agents/<key>.md`; `human_role` keys must be listed in
  `_human-roles.yaml`;
- a committee **without a risk-officer membership is an ERROR** — red-team
  omission is a defect, not a configuration choice (§2);
- `decision_modes_allowed` values must be within the closed enum;
- `rounds >= 1`.

### 5. API surface

- `POST /api/opportunities/[id]/committee-sessions` — convene a session
  (`committee_key`, `gate` or `target_ref`, `decision_mode`);
- `POST .../[sessionId]/positions` — human-member position submission
  (the 0065 `member_type='human'` seat in `hybrid` mode);
- `POST .../[sessionId]/advance` — trigger the next deliberation round or the
  chair synthesis;
- `GET .../[sessionId]` — full per-round transcript.

The existing `route_decision`, shortlist/exclude, and `gate_decision` routes
gain only one optional field: `gate_evaluation_id` (the 0066 nullable linkage
column). **Back-compat is explicit**: single-record mode without a committee
session remains fully functional; a committee session is provenance, not a
precondition.

### 6. Web surface

A `CommitteePanel` component is mounted alongside `GateDecisionPanel` on
`/route-decision` and `/brownfield`:

- convene button (create a session);
- per-round position timeline (each member's position and confidence, per round);
- synthesis proposal + verbatim dissent display;
- the **existing** confirmation form embedded — proposal pre-filled, override
  allowed. In `agent_team` mode the panel **stops at the PROPOSED state**: the
  confirm click is always human. The proposal pre-fill changes what the
  reviewer starts from, never who is accountable.

### 7. `/meeting` skill — real implementation, one engine

`.claude/commands/meeting.md` is replaced from the self-referencing stub to
call `runDeliberationRounds()` in **ad-hoc mode** (`topic`, `--agents`,
`--rounds`, `--dialogue`), writing the transcript to
`memory/meeting-YYYY-MM-DD-[slug].md` exactly as the stub always promised.
One deliberation engine, no duplicate logic: the meeting skill and the
steering committee share `runDeliberationRounds`; they differ only in
committee membership and output destination. The
`skills/meeting-facilitation/SKILL.md` registration remains and stops
delegating to a dead command.

### 8. Regression tests (top priority)

The boundary-#2 evidence for this phase: a test that drives an `agent_team`
session end-to-end and asserts that **no `gate_decision`, `route_decision`,
or `brownfield_target` row is written without an explicit human
confirmation step**. The PROPOSED evaluation may exist; the confirming
record may not. This is the test that fails if anyone later "conveniently"
auto-confirms a committee proposal.

## Consequences

- **Positive**: deliberation becomes systematic and fully auditable — every
  committee session yields per-round, per-member transcripts linked from the
  recorded decision via `gate_evaluation_id` (the 0096 provenance promise,
  realized). The committee composition itself becomes governance data
  (`_committees.yaml`) subject to the same validation discipline as
  procedures, rather than living in a prompt.
- **Boundary intact**: the three decision modes change **who proposes**,
  never **who confirms**. `human_only` is today's behavior; `agent_team`
  produces a PROPOSED evaluation that no code path can turn into a decision;
  `hybrid` adds human seats into the rounds themselves.
- **Extensibility**: future committees (S3, S8 case-adoption, S9
  checklist-approval) extend `_committees.yaml` using the same five-seat
  skeleton; the validator's mandatory red-team rule applies to them
  automatically.
- **Debt retired**: the `/meeting` dead stub is replaced by a working
  implementation over the same engine.
- **MCP**: a thin wrapper for committee-session read/transcript follows the
  no-dead-endpoint principle (ADR-0094 §6, ADR-0011) and lands with the API
  in the same change.
- **No schema change**: this phase is configuration + code over the 0064–0066
  tables. No new migration; no flow.spec change.

## Amendment (2026-09-04): standing functional-expert seats

A Steering Committee direction added **six standing functional-expert seats** to
both registered committees (`route-steering-committee`,
`target-longlist-shortlist-committee`) in `procedures/_committees.yaml`:

| Seat | Member key | Agent file |
|---|---|---|
| 자금 조달 (financing structure) | `financing-agent` | new (`agents/financing-agent.md`) |
| 대관 (site & facility) | `site-facility-agent` | new (`agents/site-facility-agent.md`) |
| 법률 (legal) | `legal-counsel` | existing |
| 인사/노무 (HR & labor) | `hr-integration-agent` | existing |
| IR (investor relations) | `ir-agent` | new (`agents/ir-agent.md`) |
| 특허 (patent/IP) | `ip-agent` | new (`agents/ip-agent.md`) |

Each committee now registers 12 members: the fixed core 5 of the skeleton
(domain expert by track, industry, region, quantitative rigor, red team) plus
these six standing functional seats, plus the chair (who still votes nothing).

- **No veto**: none of the six carries `veto_dissent` — that privilege remains
  risk-officer's alone, enforced by the validator's existing
  non-red-team-veto error (ADR-0097 §4 check b).
- **Deterministic executor**: all six member keys have role-templated position
  entries in `app/web-next/lib/committee-agents.ts`, so a deterministic
  deliberation run never falls through to the ad-hoc default template.
- **Round-1-only choice deferred**: with 12 members, round-based deliberation
  is heavy, and marking the functional seats as consulted in round 1 only (a
  per-member `rounds` override) was evaluated. It was **deferred, not
  implemented**: expressing it cleanly requires changing both the hybrid path
  in `committee-session.ts` and `runDeliberationRounds` in
  `agent-orchestrator.ts` (agent_team passes a flat agent list with a single
  committee-wide `rounds` value). Supporting it in one mode only would give
  the two modes divergent deliberation semantics. **Follow-up**: implement a
  per-member `rounds` override across both paths in one change, then set the
  six functional seats to round-1-only in `_committees.yaml`.

## Amendment (2026-11-08): chair facilitation (ADR-0196)

Seats are unchanged. The chair now runs the agenda pass and the minutes pass; this stays recorder-pattern and the chair votes nothing. The seat model also applies to the new `entity-ic-committee` and `group-ic-committee` (ADR-0196 M7), whose seats are set in `procedures/_committees.yaml`.
