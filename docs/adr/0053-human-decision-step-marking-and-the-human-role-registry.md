# ADR-0053: Human decision-step marking (`decision_authority: human`) and the human-role registry

**Status**: Accepted
**Date**: 2026-08-23
**Deciders**: process-governance-manager, compliance-officer, risk-officer

> Accepted in the same PR-8 (skill graph hardening) change that implements it. This ADR formalizes, as a procedure-schema contract, what design v1.0's non-negotiable boundary #2 already required ("gate approval and the investment decision belong to humans") but the schema could not express: some steps' outputs bind on human authority, and one agent_key in the graph names a person-role that deliberately has no agent definition file.

## Context

Two long-standing graph findings trace to the same root:

1. **`entity-ic-reviewer` has no `agents/<key>.md`.** The Entity IC decision step (entity-ic-review step 5) carries `agent_key: entity-ic-reviewer` because the Entity Investment Committee reviewer — the human who confirms or corrects the AI-proposed RAG grade and records the gate decision — *is* the executor of that step. Every referential-integrity check (graph-map `--check`, `_validate.ts` walkAllSteps) flagged the missing file on every run, and the flag could never be "fixed" without fabricating an AI agent for a human role.
2. **The recorder pattern was invisible.** Group IC's decision step (group-investment-review step 5) is executed by `process-governance-manager`, an AI agent — but the *authority* is the human Group IC; the agent records the committee's decision, it does not make it. The schema had no way to say so, so the step read as an AI-executed decision, which boundary #2 forbids.

Both are consequences of one modeling gap: `agent_key` answers *who operates the step*, and nothing answers *whose authority the output carries*.

## Decision

### 1. `decision_authority: human` — an optional step field with one legal value

Any step whose output binds on human authority carries `decision_authority: human`. The field has exactly one legal value (enforced by `_validate.ts`; a typo is an error, not a silent no-op). Absence means the ordinary case: the executing agent's output is analysis or a proposal.

Two sanctioned shapes, and only these:

| Shape | agent_key | agents/<key>.md | Example |
|---|---|---|---|
| **Human-role key** | names a human role | must NOT exist | entity-ic-review step 5 — `entity-ic-reviewer` |
| **Recorder key** | names the AI agent that records the decision | exists normally | group-investment-review step 5 — `process-governance-manager` records `group_ic_decision` |

### 2. `procedures/_human-roles.yaml` — the closed registry of human-role keys

A human-role key is one listed in the registry; nothing else earns the name. The registry is the **anti-gaming surface** for the whole mechanism:

- A registry key is **exempt** from the agents-file existence checks (graph-map `--check` and `_validate.ts`) — the missing file is the point.
- A registry key used on a step *without* `decision_authority: human` is a graph-map **error**: a human role appearing as an unmarked executor is a modeling defect.
- A registry key that also has an `agents/<key>.md` is a graph-map **error**: the role would silently become an agent again, and the missing file the exemption relies on would stop being missing.
- Adding a human role = a registry entry in the same change (the same discipline as the kill-criteria baseline and the output_type vocabulary: never extended by accident).

Because the exemption is only reachable through the registry, a step cannot dodge the missing-agent-file check by marking itself `decision_authority: human` with an arbitrary key — unregistered keys get no skip, and the warn stands. Marking with a *registered AI agent* key (the recorder shape) earns nothing either; it documents where authority lies.

### 3. Which checks live where

| Check | Where | Severity |
|---|---|---|
| `decision_authority` value is the literal `human` | `_validate.ts` validateSchema (per-file, incl. layer files' nested add/replace steps) | error |
| Registry key used without the marking | graph-map `--check` (over merged steps) | error |
| Registry key with an `agents/<key>.md` | graph-map `--check` | error |
| Registry unreadable | graph-map: fail-closed (no exemptions → missing-agent failure); `_validate.ts`: error + empty set (exemption check runs blind, loudly) | error |
| Human-role exemption from missing-agent warns | `_validate.ts` checkStepReferences / graph-map missing.agents | — |

Recorder-shape marking (an AI agent key carrying the marker) is deliberately **not** mechanically restricted to specific output_types; which output families may lawfully carry human authority is governed by the output_type registry descriptions (`entity_ic_decision`, `group_ic_decision` — both annotated "human authority, ADR-0053") and by review, not by a validator rule that would have to hardcode semantics.

### 4. Companion: the closed `output_type` vocabulary

`procedures/_output-types.yaml` registers every legal `steps[].output_type`. An unregistered output_type is an `_validate.ts` error (a deliverable contract nobody recognizes); an unused registry entry is a warn (dead vocabulary, visible every run). The registry also carries the proposal/decision distinction in prose — `rag_assessment_proposed` is "a proposal, never a decision" — which is the boundary this ADR exists to keep machine-checkable where possible and reviewable everywhere else.

## Consequences

- The standing entity-ic-reviewer graph finding is resolved as designed, not suppressed: `graph-map --check` passes with `missing.agents` empty because the one file-less key is registered as a human role.
- Both IC decision steps are now machine-distinguishable from analysis steps: `graph-map --check` reports the count of human-authority steps (2 as of this ADR).
- Procedure authors adding a gate decision step must choose one of the two shapes and, for a new human-role key, extend the registry in the same change.
- `procedures/_template/README.md` documents the field and both registries as part of the procedure contract; `skills/README.md` documents the four optional skill-graph metadata fields PR-8 adds alongside (`procedure_keys` / `requires_skills` / `related_skills` / `requires_tools`), of which `procedure_keys` is the bidirectional-contract side enforced by graph-map.
- Related: ADR-0047 (the classification model whose retirement of `case_subtype` PR-8 sweeps from all four skill mirrors), design v1.0 boundary #2 and the three-stage review model (§ "Review Model").
