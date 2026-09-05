# ADR-0074: Process Meta Model Platform — declarative flow spec, agentic runtime, multi-channel interfaces

**Status**: Accepted — implementation started in the same change (precedent: ADR-0069/0070)
**Date**: 2026-08-30
**Deciders**: user (standing directive), pm (orchestration owner), process-governance-manager + frontend-engineer (workstream)
**Design of record**: `docs/process-flow.md` (generated from `process/flow.spec.yaml`), this ADR

## Context

The web app was originally built as a feature-centric surface: a flat tab list per deal plus
read-only views. Through successive redesign rounds the following requirements converged:

- The deal flow must follow the business reality: Market analysis → Opportunity discovery →
  Strategic fit/synergy → Route decision (Greenfield vs Brownfield; R&BD vs intra-venture) →
  Business case/valuation → DD → IC → Execute.
- **Stage ≠ Gate**: stages are what agents/people do; gates are continue/hold/kill decisions.
  Gate Definition ≠ Gate Evaluation ≠ Decision (a recommendation is never a decision).
- **Opportunity ≠ Project**: one market study yields many opportunities; only selected ones are
  promoted to deals. `opportunity.project_id` and `route_decision.project_id` are NULLABLE.
- **Human intervention must be minimized**: specialist agents execute stages, deliberate
  (positions → synthesis), and decide intermediate gates; humans approve only where governance
  requires it (Entity IC / Group IC) and may override any agent decision.
- The same process runtime must be consumable from the web UI, MCP (Claude Desktop), and CLI.
- Process definition must be declarative — the website structure is generated from it, never
  hardcoded. Definition and Execution are separated in time (past runs survive spec changes).

Alternatives considered: (a) keep hand-coded tabs and add AI features ad hoc — rejected, it
leaves process logic scattered across components; (b) hardcode the S1–S7 structure in the UI —
rejected, every process change would need code; (c) adopt an external workflow engine —
rejected, the flow must stay data-driven inside our SQLite/REST stack and reference the existing
procedure/skill graphs.

## Decision

1. **flow.spec.yaml is the Process SSOT** (`process/flow.spec.yaml`): stages (id, name,
   objective, inputs, outputs, entryCriteria, activities[{id, agent, skills[], procedure}],
   requiredArtifacts, completionCriteria, applicableTracks, stateTransitions{onComplete, onHold,
   onKill}, gates[]) and gates (id, decisionCriteria, killCriteria, fundingDecision).
   - **Gate 3-stage separation**: Gate Definition (spec) → Gate Evaluation (criteria, score,
     evidence, recommendation) → Decision (GO/HOLD/KILL, decidedBy, overrideAllowed).
     recommendation ≠ decision: an agent's GO recommendation can still be human-HOLDed.
2. **Definition/Execution split**: execution records — `process_run` (with `spec_version` so past
   runs preserve the definition they ran under), `activity_run`, `agent_run`, `agent_position`,
   `gate_evaluation`, `decision`. Every execution event carries a common `source`
   (web | claude-desktop | cli | system | agent | human).
3. **Gate policy**: screening/pre_fs/fs/dd are agent-decided (decided_by = agent, override
   allowed, human notified); entity_ic/group_ic remain human decisions via `approval_chain`
   (FR-GOV-04 unchanged). Kill-criteria gain human-readable reason strings.
4. **Agent orchestration** (lib/agent-orchestrator.ts): loads the spec, executes a stage's
   activities through the mapped agents (LLM-backed, multi-provider via lib/llm.ts:
   openai-compatible / anthropic / gemini / custom; deterministic synthesis fallback when no
   provider is configured — responses are tagged `source: llm|synthesis`), collects agent
   positions, synthesizes a stage conclusion, evaluates the gate, records the decision.
5. **Definition-driven UI**: the sidebar stage groups, stepper, stage cards, required-artifact
   checklists, and gate badges are generated from the spec at runtime. No S1–S7 hardcoding in
   components. Acceptance test: adding S8 to flow.spec.yaml surfaces S8 in the UI with zero code
   changes.
6. **Multi-channel**: Web UI, MCP (Claude Desktop), and CLI call the same process runtime. MCP
   tools expose the new process surfaces (opportunities, route decisions, gate evaluations,
   agent runs, business case, checklist progress) so Claude Desktop sessions and the web show the
   same records, tagged by `source`.
7. **Agent does not own Process**: agents execute the activities the definition assigns; process
   logic never lives inside an agent. Activities reference existing procedures
   (`procedures/_shared/*`) and skills — no parallel execution system.

## Consequences

- Process changes are spec edits plus (optionally) doc regeneration — no UI code changes for
  structural moves; the drift gate (tests/unit/process-flow.test.ts) keeps the spec, the
  generated markdown, and the evaluator aligned.
- Human involvement concentrates in the IC approval queue and HOLD-supplement flows; every
  intermediate gate decision is auditable and overridable.
- The design system (docs/design/design-guide.md) adopts "Agentic-first, Human-final" and
  "Definition-driven UI" as its first principles; the UI is a workbench for verifying agent
  output, not the process itself.
- `process_run.spec_version` preserves the time-axis split between Definition and Execution.
