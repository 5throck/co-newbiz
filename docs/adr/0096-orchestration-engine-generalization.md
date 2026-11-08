# ADR-0096: Orchestration engine generalization — entity-agnostic execution and the deliberation/activity split

- Status: Accepted
- Date: 2026-09-03
- Deciders: New Business Review Lead (PM), per approved S8–S11 implementation plan (Phase 1)
- Design of record: `db/migrations/0045_process_execution.sql` (execution tables), `app/web-next/lib/agent-orchestrator.ts`, `procedures/_human-roles.yaml`
- Related: ADR-0074 (flow.spec v2.0.0, 11-stage model; 0045 origin), ADR-0094 (gate_decision as the sole human-confirmation ledger; 0062 rebuild), ADR-0095 (project promotion foundation), ADR-0014 (migration rules), ADR-0033 (PK NOT NULL row-preserving rebuild), ADR-0053 (gate authority), ADR-0085 (entity establishment execution layer)

## Context

Migration 0045 (ADR-0074 Phase 2) built a deliberation-grade execution layer:
`process_run`, `activity_run`, `agent_run`, `agent_position` (with
`round`/`confidence`), `gate_evaluation` and `decision`. The tables were shaped
for multi-agent review — rounds, per-position confidence, gate evaluations —
but the only code that writes them, `runStageAgents()` in
`app/web-next/lib/agent-orchestrator.ts`, never exercises that shape: it
hardcodes `round = 1`, each agent runs blind to the others' positions, and it
has no callers (the MCP `run_stage_agents` registration was already removed in
ADR-0094 §6). It is dead code sitting on infrastructure built for something
that has not been wired up yet.

Three approved consumers need it:

1. **Phase 2** — steering-committee deliberation for S4/S6–S7 gate
   recommendations (multi-round rebuttal debate);
2. **Phase 3** — S8 auto multi-business-case generation;
3. **Phase 4** — S9 external-search DD checklist tailoring.

Two structural mismatches block all three:

- **Addressing.** `process_run.project_id` is `NOT NULL` and references
  `md_project`, but the consumers span both entities: steering committee runs
  happen on the *opportunity* (pre-promotion S4/S6–S7, per ADR-0094), while
  S8/S9 runs happen on the *project* (post-promotion, per ADR-0095). An
  opportunity-scoped run today cannot be recorded at all.
- **Ledger duplication.** The `decision` table (0045) records human gate
  confirmations — but ADR-0094 established `gate_decision` (rebuilt in 0062
  with `entity_type IN ('opportunity','project')`) as the sole
  human-confirmation ledger. `decision` has never been written to and overlaps
  it one-for-one.

## Decision

### 1. Migration `0064_process_execution_entity_generalize.sql` — row-preserving rebuild

SQLite cannot ALTER a CHECK or a NOT NULL, so `process_run` is rebuilt in place
(0033/0062 precedent, `PRAGMA foreign_keys = OFF` + `@notransaction`): the
addressing generalizes from `project_id TEXT NOT NULL REFERENCES md_project(id)`
to `entity_type TEXT NOT NULL CHECK (entity_type IN ('opportunity','project'))`
plus `entity_id TEXT NOT NULL`. `project_id` is kept as a **nullable
compatibility column** — S8+ runs keep it populated so existing project-keyed
queries and the 0045-era index semantics survive unchanged. All existing rows
are preserved verbatim with `entity_type='project'`,
`entity_id = project_id`. `@reversible: false` in the general case (hand-reverse
by rebuilding with the 0045 body; ADR-0014 discipline).

### 2. Migration `0065_agent_position_human_members.sql` — rebuild

`agent_position` gains `member_type TEXT NOT NULL DEFAULT 'agent' CHECK
(member_type IN ('human','agent'))` and `human_user_id TEXT REFERENCES
app_user(user_id)`; `agent_key` relaxes to nullable. A committee seat may now
be held by a human role (the `procedures/_human-roles.yaml` registry keys) as
well as an agent. The **exactly-one-of** invariant — precisely one of
`agent_key` | `human_user_id` non-null — is enforced at the application layer,
not by a CHECK: a cross-column CHECK would force yet another table rebuild per
tweak, and the invariant is one line of insert-path validation. This is a
deliberate trade recorded here so it is not re-litigated.

### 3. Migration `0066_orchestration_linkage_and_dissent.sql` — purely additive (ADR-0014)

- `gate_evaluation.dissent_json` — dissent positions preserved verbatim (§5);
- linkage columns so recorded proposals reference the deliberation that
  produced them: `gate_decision.gate_evaluation_id`,
  `route_decision.gate_evaluation_id`, `brownfield_target.gate_evaluation_id`
  (nullable FKs to `gate_evaluation(id)`; `gate_decision`'s current columns are
  exactly the 0062 body, so the additions are additive with no rebuild).

### 4. `agent-orchestrator.ts` rewrite: two layers, one engine

`runStageAgents()` is removed (no callers; nothing to migrate) and replaced by
two explicitly different execution modes over the same run/activity/position
tables:

- **`runActivityChain(entity, activities[])`** — sequential/parallel
  *generation*, not debate. Each activity produces an artifact; every run is
  written to `activity_run`/`agent_run` and the artifact returned. Consumers:
  S8 case generation (Phase 3), S9 checklist benchmarking (Phase 4).
- **`runDeliberationRounds(entity, committeeKey, rounds)`** — multi-round
  *rebuttal* debate. Round 1: independent positions. Round 2+: each member
  receives the **full prior-round positions of all other members** as context —
  the core logic that does not exist today and the reason `round`/`confidence`
  columns have been empty. Positions are recorded in `agent_position` per
  round. Consumers: steering committee (Phase 2), the `/meeting` skill.

**Chair synthesis.** The committee chair (process-governance-manager, or the
committee's configured chair) synthesizes positions into a single
`gate_evaluation` carrying a **PROPOSED** recommendation. The human decision is
still recorded via `gate_decision` exactly as today — design boundary #2 is
untouched: the orchestrator's output is always a proposal, never a decision.

### 5. `decision` table (0045) explicitly not used

`decision` overlaps `gate_decision` column-for-column, and ADR-0094 fixed
`gate_decision` as the sole human-confirmation ledger. Two ledgers for the same
act would diverge under override handling and audit. `decision` stays unused;
this ADR records the rationale so the table is not silently revived later. A
future cleanup may drop it; no destructive action is taken here.

### 6. Dissent preservation rule

When a member issues `veto_dissent` (the risk officer holds a seat on every
committee per the Phase 2 design), their dissent position is copied **verbatim**
into `gate_evaluation.dissent_json`. Summarizing, averaging, or otherwise
compressing a veto dissent is a defect, not a style choice — the point of the
committee transcript is that the human reviewer can read the objection in the
objector's own words. Enforced in the synthesis code path, not left to the
chair model's discretion.

## Consequences

- **Positive**: three upcoming consumers (steering committee, S8 generation,
  S9 tailoring) share one orchestration layer instead of each building its own;
  committee sessions become fully auditable transcripts (`agent_position` per
  round, per member); gate proposals carry provenance via `gate_evaluation_id`
  — a human can click from a recorded decision back to the deliberation that
  produced it.
- **Boundary intact**: human authority is unchanged. The orchestrator writes
  evaluations and proposals; `gate_decision` remains the only place a
  go/hold/kill becomes real, and it is written by a person.
- **Compatibility**: existing `process_run` readers keep working through the
  nullable `project_id` column; all pre-0064 rows read as project runs. New
  opportunity-scoped runs leave `project_id` NULL by design.
- **Risk accepted**: the exactly-one-of member invariant lives in app code — a
  hand-written INSERT outside the repository layer could violate it. Accepted
  because the write surface is one module and a CHECK would cost a rebuild
  every time the member model evolves.
- **Migration**: three (0064, 0065, 0066) — two row-preserving rebuilds, one
  purely additive. No flow.spec change; `docs/process-flow.md` untouched.

## Amendment (2026-11-08): responsive rounds (ADR-0196)

§4 is amended: round 2+ prompts also carry the member's own prior position, the chair agenda, and a response contract, with a ~6k-token peer paste cap that always keeps the latest round verbatim. Verbatim peer delivery is unchanged. §6 binds the new minutes pass: it has no write path to dissent or the recommendation.
