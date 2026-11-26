---
lang: ko
lang_reason: source-material
---

# ADR-0098: S8 feasibility analysis — automatic multi-business-case generation from the FS scenario contract

- Status: Accepted
- Date: 2026-09-03
- Deciders: New Business Review Lead (PM), per approved S8–S11 implementation plan (Phase 3)
- Design of record: `process/flow.spec.yaml` (S8, spec v2.0.0), `db/migrations/0068_fs_valuation_outputs.sql` (new), `procedures/_shared/greenfield-fs/schema.yaml` steps 1–5, `procedures/_shared/brownfield-fs/schema.yaml`, `app/web-next/lib/agent-orchestrator.ts` (`runActivityChain`), `app/web-next/lib/process-flow.ts` (project-branch S8 check), `scripts/co-newbiz/simulate.ts`
- Related: ADR-0096 (orchestration engine generalization; `runActivityChain`, `process_run`/`activity_run` as the generation engine), ADR-0097 (steering-committee deliberation; the 5-seat skeleton and `CommitteePanel` infra), ADR-0095 (project promotion foundation; `md_project`, process-flow S8–S11 skeleton with the S8 REFINEMENT marker), ADR-0078 (v2 web stack replacement — the old S8 business-case surface was removed with it), ADR-0044 (business_case_model / business_case_line), ADR-0052 §D.4 (distributional valuation — seeded Monte Carlo, never a point estimate with a narrative footnote)
- Related non-ADR artifacts: project CLAUDE.md boundary #2 (gate approval and the investment decision belong to humans), `skills/monte-carlo-simulation`, `skills/scenario-planning`

## Context

S8 (사업성 분석, "돈이 되는가?") carries the completion criterion, verbatim from
`flow.spec.yaml` v2.0.0:

> 민감도가 포함된 정량 평가가 존재한다 (시뮬레이션 또는 밸류에이션 범위)

— a quantitative evaluation including sensitivity exists — gated at `fs`.

This phase does not invent a new analysis contract; it **automates an existing
one**. The FS procedures already require scenario analysis:

- `procedures/_shared/greenfield-fs/schema.yaml` step 4
  (`distributional_valuation`, quant-methodologist / monte-carlo-simulation):
  seeded Monte Carlo over the value drivers — P50/P95 NPV and value-at-risk,
  never a point estimate with a narrative footnote (ADR-0052 §D.4); and step 5
  (`scenario_risk_assessment`, quant-methodologist / scenario-planning):
  discrete **downside / base / upside** scenarios, including the rate-shock
  covenant test.
- `procedures/_shared/brownfield-fs/schema.yaml` carries the same
  `scenario_risk_assessment` step-5 contract for the brownfield track.

Three prior phases put the machinery in place:

- **Phase 0 (ADR-0095)**: projects are real — `md_project` (0063),
  `promoteOpportunity`, and `process-flow.ts` grew the
  `entity.type === "project"` branch evaluating S8–S11. Its S8 check is
  deliberately a simple placeholder, marked `REFINEMENT (Phase 3)`: it checks
  only for the latest `business_case_model` and its `business_case_line`
  count, with no sensitivity at all.
- **Phase 1 (ADR-0096)**: `runActivityChain(entity, activities, opts)` —
  sequential generation where each activity writes one `activity_run` and one
  `agent_run` row under a single `process_run`, with a pluggable
  `callAgent`/`execute` seam and `continueOnError`.
- **Phase 2 (ADR-0097)**: the committee pattern — a registered 5-seat
  skeleton (including the mandatory risk-officer red team) that can
  *propose*, with humans confirming the record; `CommitteePanel.tsx` ships
  the UI infrastructure.

The data model already allows multiple business cases per project:
`business_case_model` (0044) is keyed by `project_id` with a `kind` CHECK that
includes `valuation`, and `business_case_line` hangs off `model_id`. What is
missing is exactly two things:

1. **Scenario-driven automatic generation** — nothing turns the procedure's
   downside/base/upside contract into per-scenario persisted models.
2. **An S8 surface on the v2 stack** — ADR-0078 removed the old business-case
   API/page with the rest of the legacy app; nothing has replaced it.

## Decision

### 1. Migration `0068_fs_valuation_outputs.sql` (additive, ADR-0014)

New table persisting the output of `scripts/co-newbiz/simulate.ts` (the seeded
Monte Carlo runner over `python/monte_carlo.py`, whose `SimulationResult`
already carries p05/p50/p95 NPV percentiles):

```sql
CREATE TABLE valuation_simulation (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  model_id TEXT NOT NULL REFERENCES business_case_model(id),
  scenario TEXT NOT NULL CHECK (scenario IN ('base','upside','downside')),
  percentile TEXT NOT NULL,          -- e.g. 'p50', 'p95'
  npv_krw_m REAL NOT NULL,
  irr REAL,
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_val_sim_project ON valuation_simulation(project_id, model_id, scenario);
```

One row per (scenario, percentile) pair; `note` carries the seed and driver
assumptions so any persisted figure is reproducible per ADR-0052 §D.4
seeded-determinism.

### 2. Automatic 3-case generation via `runActivityChain()`

For **each** scenario (base / upside / downside), a sequential generation
chain — not a debate — reuses the ADR-0096 engine:

| Order | Agent | Activity (procedure step) |
|---|---|---|
| 1 | `financial-analyst` | `growth_projection` (greenfield-fs step 1 — anchored growth, base-rate check) |
| 2 | `valuation-agent` | `valuation_model` (step 3 — NPV/IRR/Payback/DSCR on confirmed WACC/hurdle) |
| 3 | `quant-methodologist` | `distributional_valuation` (step 4) + `scenario_risk_assessment` (step 5) |

The chain writes per-scenario `business_case_model` (+ `business_case_line`)
and `valuation_simulation` rows — three complete, independently auditable
cases per project, exactly instantiating the procedure's scenario contract.

Execution follows the Phase 2 pluggability pattern: the default executor is
deterministic (structural computation from project inputs via
`scripts/co-newbiz/simulate.ts`), and the `callAgent`/`execute` seam of
`runActivityChain` is the insertion point for real model-backed
implementations. The ADR-0096 contract is unchanged: one `process_run`, one
`activity_run`/`agent_run` per activity, run status visible end to end.

**Recommendation ≠ adoption.** `quant-methodologist` compares the three
cases and flags a **RECOMMENDED** case (which scenario best survives the
covenant/risk tests). Which case feeds the `fs` gate is a human confirmation
(boundary #2) — case selection is investment judgment, and a machine-flagged
favorite must not silently become the gate input.

### 3. API

- `POST /api/projects/[id]/business-case/generate` — analyst+; async trigger
  returning the `runId` of a `process_run` (ADR-0096 entity model,
  `entity = { type: "project", id }`).
- `GET /api/projects/[id]/business-case/generate/[runId]` — progress and
  results assembled from `activity_run`/`agent_run` plus the generated
  `business_case_model`/`valuation_simulation` rows.
- Manual CRUD `.../business-case/route.ts` — coexists with automatic
  generation; an analyst may hand-edit or add a case the chain did not
  produce. Both write paths land in the same tables, so the S8 check (§5)
  cannot tell the difference and does not need to.

### 4. Web page

`app/web-next/app/projects/[id]/business-case/page.tsx`:

- 3-case comparison cards (NPV / IRR / sensitivity percentiles per scenario);
- a RECOMMENDED badge on the quant-methodologist-flagged case;
- manual editing of models and lines;
- `GateDecisionPanel` (gate = `fs`) — the human confirmation surface for the
  gate, per the ADR-0094/0095 gate-decision ledger;
- optionally, a **case-adoption committee** reusing the Phase 2
  `CommitteePanel` infrastructure and the ADR-0097 5-seat skeleton
  (`_committees.yaml` already anticipates an S8 case-adoption committee) —
  where the committee proposes and a human adopts.

### 5. Completion criterion — mechanically checkable

`flow.spec.yaml` S8, verbatim and unchanged; the check becomes:

> case ≥ 1 **and** `valuation_simulation` rows ≥ 1 (sensitivity included).

`evaluateProcess`'s project branch (S8) is rewired from the ADR-0095 simple
probe to these tables, replacing the placeholder explicitly marked
`REFINEMENT (Phase 3)`: a `business_case_model` for the project with at least
one persisted sensitivity row satisfies "민감도가 포함된 정량 평가가
존재한다"; absent either, the stage reports the corresponding blocker. Gate
`fs` evaluation reads `latestGateDecisions("project", …)` as before — the
completion check produces the missing-artifact list, the human gate decision
remains the record.

### 6. Project visibility

All project routes follow the deny-by-default pattern
(`getProjectIfVisible` via `lib/project-visibility.ts` — admins excluded by
role separation, non-members get 404). The promote API (ADR-0095) already
seeded the `project_member` base that makes these checks meaningful.

## Consequences

- **S8's required artifact becomes mechanically checkable.** The spec
  sentence "a quantitative evaluation including sensitivity exists" now has a
  table-level predicate; `REFINEMENT (Phase 3)` is paid off and removed.
- **Sensitivity outputs persist and are auditable.** Every Monte Carlo
  percentile is a row with seed and assumptions, not markdown in an
  `activity_run` — reproducible per ADR-0052 §D.4 and visible to the human
  reviewer without reading prose.
- **The generation chain is reusable by Phase 7.** The end-to-end pipeline
  can invoke the same per-scenario chain as one step; nothing in the chain is
  page- or route-bound.
- **Boundary #2 preserved by construction.** The engine recommends; only a
  human adopts the case and only a human records the `fs` gate decision. The
  RECOMMENDED flag is input to judgement, never the judgement.
- Three business cases per project is the expected steady state, so any
  consumer that assumed "latest model = the model" (e.g. the old
  `ORDER BY created_at DESC LIMIT 1` probe) must become scenario-aware.

## As-built amendment (2026-11-26): the generation run is detached from the page

Section 3 named the trigger "async"; the first implementation held the HTTP request open for the whole dual-view (actual and scenario) chain, so a page refresh, a closed tab or a tunnel timeout lost the result and the progress. The run model now matches the section 3 intent. No schema change, no permission change (analyst role as before), no new MCP tool (the two existing tools keep their scope): no new ADR is required; this amendment is the record. Code: `app/web-next/lib/business-case-run.ts`, `business-case-generation-view.ts`, `use-generation-run.ts`; run engine unchanged (`runActivityChain`, ADR-0096).

- **Run slot.** `POST .../business-case/generate` inserts the `process_run` row (stage `s8_business_case_generation`) and answers `202 {runId, status: "running", started_at}`; the chain then runs detached in the long-lived server process and nothing in it honours `request.signal`. The running-check and the insert are synchronous, so two requests cannot both claim the slot.
- **Idempotency.** One run in progress per project: a second start answers `409 already_running` with `details.runId` (also with `regenerate: true`). A non-failed earlier run is returned with `200 {runId, alreadyRun: true}` instead of duplicating the chain; `regenerate: true` starts a new run (per-target regeneration, ADR-0143); a failed run never blocks a retry.
- **Progress and resume.** `GET .../generate` returns the project's latest run with per-activity state (`{run: null}` when none); `GET .../generate/[runId]` returns a given run. Each planned activity is `waiting`, `running`, `done`, `failed`, or `skipped` (not reached after the chain stopped at its first failure), with start and finish times, plus an overall `done/total`. The page restores an in-flight run after a reload and polls; the progress panel shows the elapsed time, "n of m steps done", and a step list that is collapsed by default. The `generate_business_case` MCP tool answers with the run id and `get_business_case_run` follows it.
- **Crash and stale runs.** A `running` run that started before the current server process booted, or more than 30 minutes ago (`GENERATION_STALE_MS`), is marked `failed` with the error `timeout_or_crash` (its open activity rows fail with it, `meta.failed_activity` names the step); the sweep runs at every start, so a restart never leaves a ghost `running` row that blocks the project.
- **Unchanged.** Generation writes proposals only (never an adoption marker or a `gate_decision`, boundary #2); a failure inside the run lands on the run (`status: failed` plus `error`), not on an HTTP error. The display of the WACC on the BEP tab and in the draft rationale moved to two decimals in the same change (display only).
