---
lang: ko
lang_reason: source-material
---

# ADR-0102: Industry × company end-to-end auto pipeline — the state machine that drives S1–S11 and stops only at human gates

- Status: Accepted
- Date: 2026-09-04
- Deciders: New Business Review Lead (PM), per approved S8–S11 implementation plan (Phase 7 — final phase)
- Design of record: `process/flow.spec.yaml` (spec v2.0.0; stage and gate vocabulary), `app/web-next/lib/process-flow.ts` (`evaluateProcess` — the existing per-stage blocker/artifact computation this ADR wires together), `db/migrations/0072_pipeline_run.sql` (new), `app/web-next/lib/pipeline.ts` (new), `app/web-next/app/api/opportunities/[id]/pipeline/start/route.ts` and `.../pipeline/status/route.ts` (new), `scripts/co-newbiz/watch-run.ts` (existing batch scheduler, extended with a pipeline-resume pass)
- Related: ADR-0095 (project promotion — the S8–S11 stage carrier), ADR-0096 (orchestration engine generalization — entity-general `process_run` and human seats), ADR-0097 (committee deliberation in `agent_team` mode), ADR-0098 (S8 multi-business-case generation), ADR-0099 (S9 tailored DD checklists), ADR-0100 (S10 IC and establishment surfaces), ADR-0101 (S11 scorecard and transition-decision ledger), ADR-0014 (additive-only migration rules), ADR-0053 (`decision_authority: human` role keys), ADR-0019 (watch/monitoring batch cycle — `watch:run` and `schedule_job`)
- Related non-ADR artifacts: project CLAUDE.md boundary #2 (gate approval and the investment decision belong to humans — structural, re-asserted below as a regression-tested invariant), the product vision in the design doc ("산업 선정 + 계열사 결정 → end-to-end progress with humans at the decision points")

## Context

Phases 0–6 of the S8–S11 plan built every individual stage's automation:

| Phase | ADR | Automation landed |
|---|---|---|
| 0 | 0095 | Project promotion (`promoteOpportunity`) — the opportunity→project carrier handoff |
| 1 | 0096 | Orchestration engine — entity-general `process_run`, human seats, dissent linkage |
| 2 | 0097 | Committee deliberation (`conveneCommitteeSession`) |
| 3 | 0098 | S8 multi-business-case generation (`generateBusinessCases`) |
| 4 | 0099 | S9 tailored DD checklists (`tailorDdChecklist`) |
| 5 | 0100 | S10 IC and establishment surfaces (human gates by design) |
| 6 | 0101 | S11 portfolio scorecard and transition-decision ledger (human gates) |

What is missing is the connective tissue: a state machine that, given the two
inputs the product vision names — a selected industry (`md_industry`) and an
initiating group/affiliate company (`md_company`) — progresses the process
end-to-end and **pauses only where a human decision is required**: gate
go/hold/kill, business-case adoption, checklist final approval, and track/route
confirmation.

`evaluateProcess(entity: ProcessEntity)` in `app/web-next/lib/process-flow.ts`
already computes, per entity, `currentStage`, `completedStages`,
`blockedStages`, `nextStage`, `blockers`, `requiredArtifacts`, `gateStatus`,
`track`/`subTrack`, and `terminated` (a `ProcessEvaluation`). Every stage's UI
already renders from it. Nothing consumes it *in a loop* to drive work forward.

## Decision

### 1. Migration `0072_pipeline_run.sql` (additive, ADR-0014)

`0072` is the next free number (0071 is the highest existing migration, used by
ADR-0101). Verified: `md_industry` and `md_company` both exist in
`db/migrations/0001_master_data.sql` with exactly those names. A small
additive table:

```sql
CREATE TABLE pipeline_run (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('opportunity','project')),
  entity_id TEXT NOT NULL,
  industry_id TEXT NOT NULL REFERENCES md_industry(id),
  initiating_company_id TEXT NOT NULL REFERENCES md_company(id),
  status TEXT NOT NULL CHECK (status IN
    ('running','paused_for_human','completed','failed','killed')),
  current_stage TEXT,
  paused_reason TEXT,
  started_by TEXT NOT NULL,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_pipeline_run_entity ON pipeline_run(entity_type, entity_id);
CREATE INDEX idx_pipeline_run_status ON pipeline_run(status);
```

Notes:

- `entity_type` mirrors the `ProcessEntity` discriminated union — a pipeline
  run spans the opportunity branch (S1–S7) *and*, after promotion (ADR-0095),
  the project branch (S8–S11). The `entity_id` is re-pointed by inserting a new
  run segment on promotion rather than mutating the opportunity-keyed row
  (append-only lineage, per ADR-0005 attribution rules).
- One **active** run per entity is enforced in the repository layer
  (`running`/`paused_for_human` exclusivity checked on start), not by a partial
  index — the ADR-0098 route-layer-validation pattern.
- **Fact-driven addition to the notification plan.** The existing `notification`
  table (`db/migrations/0007_watch_and_notification.sql`) carries
  `project_id TEXT NOT NULL REFERENCES md_project(id)` and a `trigger_type`
  CHECK with seven fixed values — neither an opportunity-scoped pause nor a
  `pipeline_paused` trigger fits it today. `0072_pipeline_run.sql` therefore
  also (a) adds `'pipeline_paused'` to the `trigger_type` CHECK and (b) makes
  `project_id` nullable, both via the SQLite table-rebuild pattern already
  used by `0033_pk_not_null_rebuild.sql` (additive in spirit: no existing
  trigger type or row is altered; consumers — `db/lib/watch-engine.ts` and the
  MCP `list_notifications` wrapper in `mcp/co-newbiz/index.ts` — are
  SELECT-only and unaffected). This is the only non-purely-additive element of
  the migration and it is called out here so reviewers see it.

### 2. `advancePipeline(pipelineRunId)` — `app/web-next/lib/pipeline.ts`

A new orchestrator module exposing a single loop:

```
loop:
  evaluation = evaluateProcess({ type: run.entity_type, id: run.entity_id })
  for each blocker in evaluation.blockers:
    if blocker is fillable by existing automation  → run it, continue loop
    if blocker is a human-confirmation blocker     → pause; stop loop
  if evaluation.nextStage is null and evaluation.terminated:
    status = completed (KILL recorded → 'killed')
```

Blocker classification:

- **(a) Automatable** — mapped to the entry points that already exist:
  - S8 business-case modeling → `generateBusinessCases`
    (`app/web-next/lib/business-case-generator.ts`)
  - S9 DD checklist tailoring → `tailorDdChecklist`
    (`app/web-next/lib/dd-checklist-tailor.ts`)
  - Committee deliberation steps → `conveneCommitteeSession`
    (`app/web-next/lib/committee-session.ts`), convening in `agent_team`
    mode where the stage's committee composition permits (ADR-0096/0097);
    human seats always remain human
  - Opportunity→project promotion preconditions → `promoteOpportunity`
    (`db/repositories/project.repository.ts`) once S5/S7 track-specific
    preconditions are satisfied
  - Market-analysis artifacts → the existing market-sizing chain
    (`scripts/co-newbiz/*`) invoked through the same server-lib entry points
    the discover flow already uses
- **(b) Human-confirmation** — the pipeline transitions the run to
  `paused_for_human`, records `paused_reason` (a stable machine key plus a
  human-readable detail, e.g. `gate_decision:pre_fs`,
  `case_adoption:S8`, `checklist_approval:S9`, `route_confirmation:S4`),
  writes a `notification` row (`trigger_type = 'pipeline_paused'`) addressed
  to the responsible person resolved from the ADR-0053/0096 human-role
  registry, and **stops**. Human actions happen through the EXISTING UI
  surfaces — gate decision routes, case adoption, checklist approval, route
  confirmation. The pipeline creates no new confirmation paths and never
  writes those records itself (see §5).

**Scope limit (explicit and accepted):** stages whose automation does not
exist yet simply remain `paused_for_human` with a
`no_automation:<stage>` reason. The pipeline is immediately usable and
automation lands incrementally — the state machine does not block on future
phases.

**S10/S11 are human gates by design.** The IC approval (ADR-0100) and the
portfolio transition decision (ADR-0101) are recorded by humans through their
own routes; `advancePipeline` always stops at them and never proposes to
short-circuit them, regardless of what automation exists downstream.

### 3. API

- `POST /api/opportunities/[id]/pipeline/start` — analyst+ permission floor.
  Body `{ industry_id, initiating_company_id }` — the "산업 선정 + 계열사
  결정" trigger. **The opportunity must already exist**: the route is
  opportunity-keyed by its path parameter, and opportunity creation remains
  the job of the existing discover flow (`app/web-next/app/api/opportunities/
  discover/route.ts`); the pipeline starts *on* an opportunity, it does not
  create one. The route validates both ids against `md_industry`/`md_company`,
  rejects a second active run for the entity, and kicks the first
  `advancePipeline` pass synchronously (subsequent passes come from the
  scheduler).
- `GET /api/opportunities/[id]/pipeline/status` — returns the active run's
  status, `current_stage`, `paused_reason`, timestamps, and **deep links** to
  the pending human action's screen (resolved from the paused_reason key).
  Read-only.

Route conventions follow ADR-0098/0100: server-side validation against the
CHECK vocabularies, TypeScript mirror types kept in lockstep with the migration.

### 4. Web — pipeline status widget

A pipeline status widget on the opportunity dashboard, driven by
`GET .../pipeline/status`: a badge showing "자동 진행 중" (auto-progressing)
or "OO 확인 대기" (awaiting confirmation of X) with a deep link to the paused
action's screen. Built to the Onyx 3.0 design-guide component vocabulary and
tokens, `design:lint` clean (ADR-0086/0088 standards).

### 5. Boundary #2, made structural

The pipeline can never write a confirmation record itself. It only invokes the
same proposal-generation surfaces Phases 0–6 built — it cannot insert
`gate_decision` rows, cannot adopt a business case, cannot approve a checklist,
cannot confirm a track/route, cannot record a transition decision. This is not
a convention; it is enforced by construction (the orchestrator's allowed-action
map contains only generation functions) and proven by a **regression test**
that runs an end-to-end pipeline against a seeded database and asserts:

1. zero rows in the human-confirmation tables (`gate_decision`, case-adoption,
   checklist-approval, route-decision, transition-decision) were produced
   without human action, and
2. a `notification` row exists for every `paused_for_human` transition.

This is boundary #2 ("gate approval and the investment decision belong to
humans") promoted from policy text to a test-enforced invariant.

### 6. MCP — read-only status wrapper

A read-only MCP wrapper exposing pipeline status (current stage, running or
paused, paused reason, deep-link target) alongside the existing
`list_notifications` surface in `mcp/co-newbiz/index.ts`. No write capability
is exposed over MCP — consistent with the project's read-mostly MCP posture.

### 7. Resume without a new scheduler

`scripts/co-newbiz/watch-run.ts` is verified to exist and its shape is
authoritative: it is the OS-scheduler-driven monitoring cycle (ADR-0019,
`schedule_job`), explicitly designed so that nothing runs on an in-process
app-lifetime timer. A pipeline-resume pass is added to this cycle — the same
`schedule_job` invocation, the same `job_run` bookkeeping — that:

- selects `pipeline_run` rows in `paused_for_human`,
- re-runs `evaluateProcess` for each,
- auto-resumes (`status = 'running'`, first `advancePipeline` pass) when every
  blocker that caused the pause has cleared, and
- leaves the run paused otherwise (no change = no action, the design's own
  rule, per the watch cycle's precedent).

Human-in-the-loop is preserved with zero new scheduling infrastructure.

## Consequences

- The original product vision becomes operational: industry + company in →
  decision-ready package out, with humans at exactly the gates the design
  reserves for them.
- Every existing automation gains a driver. Phases 0–6's outputs stop being
  isolated surfaces and become steps of one process; `evaluateProcess` becomes
  the single source of truth for "what can run now" rather than only "what the
  UI should show".
- The pause/resume model keeps the human-in-the-loop property without a new
  scheduler: `watch:run`'s existing OS-timer pattern is reused, so no in-process
  timers are introduced (ADR-0019 preserved).
- Immediately usable despite incomplete automation: un-automated stages degrade
  to explicit human pauses with machine-readable reasons, so progress is never
  blocked on future phases and each new automation shrinks the paused surface
  with no state-machine change.
- Boundary #2 is now regression-tested, not just documented — any future change
  that lets the orchestrator write a confirmation record fails CI, not review.
- The `notification` table change in `0072` (nullable `project_id`, new
  trigger type) is the one cross-cutting migration element; it is table-rebuild
  based per the 0033 precedent and its consumers are read-only, but it should
  be reviewed with more care than the purely additive `pipeline_run` table.
- A pause is observable everywhere the human already works: web widget, deep
  link, notification, MCP status — so "waiting on you" can never again be
  silent.
