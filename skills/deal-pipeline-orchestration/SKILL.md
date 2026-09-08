---
name: deal-pipeline-orchestration
scope: co-newbiz
description: >
  Harness execution runbook for the new business review pipeline S1-S12:
  how PM dispatches the multi-agent team stage by stage from
  process/flow.spec.yaml (the SSOT), stops at the seven human gates, branches
  on the greenfield/brownfield track after S4, runs steering committees, and
  applies the three-stage deliverable review (AI 1st -> AI 2nd cross-domain ->
  human final). Complements agents/pm.md "Deal Pipeline Orchestration".
  Use when: "run the pipeline", "execute stage S#", "orchestrate the deal
  review", "advance the opportunity/project", "which agent works this stage".
owner: pm
version: 1.0.0
last_reviewed: 2026-09-08
status: active
prerequisites: none
relates_to:
  - skill: stage-gate-governance
    type: composes_with
  - skill: two-tier-approval-chain
    type: composes_with
  - skill: deal-execution-playbook
    type: composes_with
  - skill: meeting-facilitation
    type: composes_with
  - skill: evidence-ledger
    type: composes_with
metadata:
  type: process
  procedure_keys:
    - greenfield-screening
    - brownfield-screening
    - deal-structuring
    - entity-ic-review
    - group-investment-review
    - portfolio-venture-monitoring
  triggers:
    - run the pipeline
    - execute stage
    - orchestrate deal review
    - advance the opportunity
    - which agent works this stage
---

# deal-pipeline-orchestration

End-to-end harness runbook for executing the S1–S12 new business review
pipeline with the multi-agent team. The pipeline definition — stages,
activities (agent/skills/procedure), artifacts, gates — lives in
**`process/flow.spec.yaml`** (SSOT, ADR-0074). This skill never restates
stage definitions; it defines *how a harness session executes them*.

## When to Use

- Executing or resuming a deal review run (any stage S1–S12)
- Deciding which agents to dispatch for a stage and with what skills/procedures
- Recording or servicing a human gate decision during a run
- Onboarding a session to the pipeline's dispatch mechanics

## Principles

1. **Read the spec, don't recall it.** Before every stage, read the stage's
   entry from `process/flow.spec.yaml` (`stages[]`). Stage tables in other
   docs (including the generated `docs/process-flow.md`) are reference copies.
2. **Proposals are not decisions.** Agent and committee outputs are PROPOSALS.
   Only a human gate decision (`gate_decision` row, ADR-0053/0094) advances,
   holds, or kills. Never stamp PASS on AI output.
3. **Fail-closed evidence.** Missing data access is recorded as a limitation,
   never silently skipped. Data confidence caps the RAG grade (ADR-0016/0049).
4. **PM-only dispatch.** Specialists are dispatched by PM only (PM Gateway);
   embed the persona (`agents/<agent>.md`) in each Agent-tool prompt.

## Execution Loop (per stage)

1. **Locate the carrier.** S1–S7 run on the *opportunity*; S8–S12 on the
   *project* (promotion at S7→S8, ADR-0094/0095). Load its current derived
   state via `GET /api/opportunities/:id/process` or
   `GET /api/projects/:id/process` (stage state is derived, never stored).
2. **Check entry criteria.** The stage's `entryCriteria` and the prior stage's
   completion predicate must hold. If a blocking gate decision is missing,
   service the gate (below) before dispatching.
3. **Read the stage's `activities[]`** from the spec: each activity names one
   `agent`, its `skills[]`, and its `procedure[]` keys.
4. **Dispatch.** For each activity, dispatch via the Agent tool with:
   - the persona: full text of `agents/<agent>.md`
   - the assignment: stage objective + activity id + the activity's skills
     and procedure keys (the agent reads the procedure YAML itself)
   - the context: opportunity/project id, prior-stage artifacts, and the
     environment discipline block below when the activity calls external APIs
   - research/analysis activities may run in parallel; write tasks serially
5. **Verify artifacts** against the stage's `requiredArtifacts`. Unmet
   artifacts block the gate, not the work — record them explicitly.
6. **Service the gate** (if the stage has one), then advance.

## Track Branching (after S4)

- The S4 route decision records the track. **Greenfield skips S6–S7**;
  **brownfield skips S5** (spec `applicableTracks` — the UI renders them
  `skipped`).
- S4/S6/S7 are committee stages: convene the steering committee
  (`procedures/_committees.yaml`) via the web committee-session APIs
  (`/api/opportunities/:id/committee-sessions/**`) or `/meeting`. For
  persona-driven dialogue, dispatch participant agents through the Agent tool
  rather than trusting the deterministic engine (see `agents/pm.md` Meeting
  Facilitation).

## Human Checkpoints

Seven gates: `screening`, `pre_fs`, `target_screening`, `fs`, `dd`,
`entity_ic`, `group_ic`. Every verdict is human (ADR-0053/0094).

- **Assemble the proposal**: deliverables + the gate's decision criteria +
  a kill-criteria check (`stage-gate-governance` skill;
  `never_evaluated` is NOT clearance). Kill Criteria hit mid-stage halts
  immediately — only Group IC can override, only explicitly.
- **Record the verdict**: `POST /api/opportunities/:id/gate-decisions` (S1–S7)
  or `POST /api/projects/:id/gate-decisions` (S8–S12); analyst+ role
  required. **HOLD must list the missing artifacts.** Decisions are
  append-only.
- **Then**: GO → next stage · HOLD → pause for supplementation (HOLD blocks
  gate re-evaluation, not the work) · KILL → terminate the entity.
- Gate-moment rulings emit a decision record (`docs/decisions/DEC-*.md`,
  ADR-0061) before dispatch continues.

## Three-Stage Deliverable Review

Every stage deliverable passes: **AI 1st** — formal review within the
author's domain · **AI 2nd** — cross-domain review (dispatch a reviewer agent
from a *different* domain than the author) · **human final** — the gate
decision. Report verified / could-not-verify / needs-judgement.

## Web Automation Surfaces (use, don't reimplement)

| Surface | API | Notes |
|---|---|---|
| Derived stage state | `GET /api/{opportunities\|projects}/:id/process` | full S1–S12 chain incl. blockers |
| Gate decisions | `GET/POST /api/{opportunities\|projects}/:id/gate-decisions` | 7-gate enum validated server-side |
| Pipeline automation | `POST /api/opportunities/:id/pipeline/start` · `GET .../pipeline/status` | S8 business cases, S9 checklist tailoring auto-run; S1–S3 manual input, S4 route confirmation |
| Committees | `/api/opportunities/:id/committee-sessions/**` | rounds, positions, advance, minutes |
| Charter baseline | `GET/POST /api/projects/:id/charter` | S11 KPI pre-commit |
| DD checklist | `/api/projects/:id/dd-checklist/*` | tailoring + checklist approval hold |
| Waivers (S9) | `GET/POST /api/projects/:id/waivers` · `PATCH .../waivers/:waiverId` | request/approve/reject/revoke; expiry date authoritative (ADR-0036) |

## Environment Discipline (ADR-0075 — before any API-dependent activity)

1. **Every bash call starts a fresh shell.** No persistent environment. Each
   command needing secrets sources `.env` itself; dispatch prompts must state
   this explicitly.
2. **This project's `.env` uses CRLF.** Load with
   `set -a; source <(tr -d '\r' < .env); set +a` — naive sourcing appends
   `\r` to every value and breaks APIs silently.
3. **Pre-flight**: `bun scripts/co-newbiz/env-check.ts` (before S1;
   `--exports` emits CRLF-safe export lines). The app itself must run under
   Bun (`bun:sqlite`) on port 8787.
4. **Never trust a subagent's "API key missing" report** without a
   reproducible curl + HTTP status. (A 2026-08-31 run misdiagnosed valid
   keys as missing.)
