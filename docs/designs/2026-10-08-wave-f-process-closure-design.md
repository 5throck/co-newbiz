---
title: Wave F — Process Closure (typed closure, 3-stage review runtime, RAG on web, predicate gaps, brownfield audit)
status: approved
date: 2026-10-08
owner: platform-lead
contributors: process-governance-manager (closure vocabulary input requested)
related_adrs: [ADR-0150, ADR-0151, ADR-0152 (accepted), ADR-0153 (accepted)]
---

# Wave F — Process Closure Design

## 1. Context

The 2026-10-08 analysis found five gaps where the S1–S12 pipeline (`process/flow.spec.yaml`) is specified but not closed in the runtime.

- **F3 (closure).** Three unlinked fields mean "closed": `pipeline_run.status`, `md_project.status` (`open|closed|archived`), and the S12 `venture_transition_decision`. `closeProject` (`db/repositories/project.repository.ts:566`) needs only a reason text. It also flips every active `pipeline_run` to `completed`, even when a deal is abandoned mid-process. There is no closure type and no precondition. Learning capture is required only for the S12 `kill_with_learning_captured` transition, not for gate KILLs at S1–S11 (`gate_decision.decision = 'kill'`). Opportunities can be `dropped` (migration 0042) with no reason or learning.
- **F1 (3-stage review).** `review_stage` (0011/0033) and `review_audit_sample` (0038) exist, but no runtime code writes them. Only a type exists in `lib/api.ts`. There is no 3-bucket UI.
- **F2 (RAG).** `assessRun` is called only from the CLI (`scripts/co-newbiz/rag.ts`, `watch-run.ts`). The web never writes `rag_assessment`, so the IC package (`app/api/projects/[id]/ic-package/route.ts`) reads an empty table. S1 market sizing records no data-confidence grade. The production container has no scheduler.
- **F4 (spec vs predicate).** S1 does not check the data-confidence criterion, and the opp→industry join uses a name string (`market_scope = md_industry.name_ko`). S3 does not check the capability list. S6 does not check per-candidate source and attributes. S7 does not explicitly check per-candidate screening evidence. S11 lacks the brownfield PMI kickoff and a `reviewed_by` record. The S12 completion predicate flips back to incomplete when the review cycle goes stale, but `pipeline_run` stays `completed`.
- **F5.** The coverage of the seven brownfield sub-tracks (M&A, JV, strategic, minority, partnership, R&BD, CVC) across S8–S11 is unaudited.

The binding constraints come from CLAUDE.md. Under boundary #1, agents inherit the calling user's permissions and have no accounts. Under boundary #2, gate approval and the investment decision belong to humans. Under the Review Model, the stages run AI 1st (deterministic) → AI 2nd (cross-domain) → human final, and there is no PASS stamp.

## 2. Goals and Non-goals

**Goals**
1. Closure is typed and precondition-enforced for both projects and opportunities. Every KILL at any stage requires learning capture.
2. A single authoritative closure record links `md_project.status`, `pipeline_run.status`, and the deciding record (a gate decision or a transition decision).
3. The 3-stage review runtime covers every `requiredArtifacts` entry for S1–S12. AI 2nd output is structured and cross-domain, and there is no PASS stamp.
4. The web writes `rag_assessment` on the relevant events, so the IC package is never empty when its inputs exist.
5. Predicates match the spec for the F4 items.
6. A read-only audit plan for the brownfield sub-tracks.

**Non-goals**
- Any automatic gate decision, approval, or closure. AI never closes and never decides.
- Rewriting existing procedures. Procedure and policy edits stay with process-governance-manager under their own ADR.
- A general-purpose job scheduler. F2 uses event-driven recompute, plus one optional cron entry owned by infra-automation-engineer.
- Implementing F5 fixes. This wave only plans the audit.

## 3. F3 — Typed, precondition-enforced closure (ADR-0152)

### 3.1 Vocabulary

The type set below is proposed and must be finalized with process-governance-manager. It is aligned with `procedures/_shared/portfolio-venture-monitoring` and with the `venture_transition_decision` enum.

| closure_type | Applies to | Hard precondition (blocking) | `pipeline_run` terminal status |
|---|---|---|---|
| `killed_at_gate` | project, opportunity | A latest `gate_decision` with `decision='kill'` for this entity. Recorded by a human (`decided_by` ≠ agent id). It must carry non-empty `learning_capture`. | `killed` |
| `withdrawn` | project, opportunity | A `closure_reason` of at least 20 chars, `withdrawn_by` = a human user, and a non-empty `learning_capture`. No pending gate decision may be in `hold` awaiting a committee session. | `withdrawn` |
| `graduated_to_core` | project | A `venture_transition_decision` with `decision='graduate_to_core'` and non-null `core_handoff` (ADR-0151). | `completed` |
| `divested` | project | A `venture_transition_decision` with `decision='reduce_or_divest'` and non-null `divest_plan`. | `completed` |
| `killed_with_learning` | project (S12) | A `venture_transition_decision` with `decision='kill_with_learning_captured'` and non-null `learning_capture`. | `killed` |
| `dropped` (opportunity only) | opportunity | The opportunity is at S1–S3 with no gate decision yet. It needs `closure_reason` and `learning_capture`. This replaces the bare `status='dropped'`. | `withdrawn` |

`archived` stays as a separate, post-closure retention state. It is not a closure type. An entity can only be archived when `closure_type IS NOT NULL`.

Rule: **every closure that ends in a kill or withdrawal (`killed_at_gate`, `withdrawn`, `killed_with_learning`, `dropped`) needs learning capture.** For `killed_at_gate`, the learning sits on the gate decision. Migration 0123 adds `gate_decision.learning_capture`, and the gate route requires it when `decision='kill'`.

### 3.2 Data model (migrations, additive and reversible per ADR-0014)

- `0122_closure_record.sql`: new table `closure_record`.
  - Columns: `id`, `entity_type CHECK IN ('project','opportunity')`, `entity_id`, `closure_type` (CHECK against the vocabulary above), `basis_table CHECK IN ('gate_decision','venture_transition_decision','none')`, `basis_id`, `closure_reason`, `learning_capture`, `closed_by`, `closed_at`, `policy_pin`.
  - A unique index on `(entity_type, entity_id)` enforces one closure per entity. Reopening deletes nothing. It writes `reopened_at` plus `reopened_by` and a new row is allowed only after reopen (partial unique index `WHERE reopened_at IS NULL`).
- `md_project` gets a nullable `closure_type`. This denormalizes the closure for list filtering and is written in the same transaction.
- `pipeline_run.status`: extend the CHECK with `killed` and `withdrawn`. SQLite needs a table rebuild, so follow the 0033/0062 rebuild pattern. The data copy is 1:1.
- `0123_gate_decision_learning_capture.sql`: nullable `learning_capture TEXT` on `gate_decision`.
- `opportunity.status`: no change to the enum. `dropped` now requires a `closure_record` row through the repository and route. The CHECK stays in place to avoid a rebuild.

### 3.3 Repository and API

- Add `closeEntity({entityType, entityId, closureType, basisId?, closureReason, learningCapture?, closedBy})`. It validates preconditions in one transaction and returns a typed `ClosureError` code: `precondition_failed:<missing_record>`, `invalid_type_for_entity`, or `already_closed`. `closeProject` becomes a thin wrapper. Its signature now requires `closureType`, and the old call path fails closed.
- `pipeline_run` is moved to the type-mapped terminal status, never blindly to `completed`.
- `POST /api/projects/[id]/close`: the body is `{closureType, basisId?, closureReason, learningCapture?}`. The route returns 409 with the missing precondition on failure. `GET /api/projects/[id]/close/preconditions` returns `{closureType → {satisfied, missing[]}}` for the modal.
- `POST /api/opportunities/[id]/close`: same contract, limited to the types for opportunities.
- Gate route: `decision='kill'` without `learning_capture` returns 422.
- **S12 stale flip.** When the S12 predicate goes incomplete because the cycle is stale and the project is not closed, the next `pipeline-sync` sets `pipeline_run.status='running'` with `current_stage='S12'`. A closed project is never reopened by staleness, because closure is terminal.

### 3.4 Boundary analysis

- **#1.** `closed_by` is the session user id from the auth context and is never client-supplied. Agents (via MCP) can call `GET .../preconditions` but not `POST .../close`. The MCP tool scope stays unchanged, and no close tool is added.
- **#2.** Closing is a human decision. The basis records (gate decision, transition decision) are already human-only. The closure route checks `closed_by` against the agent-id denylist used by the gate route.

### 3.5 UI — closure modal

The modal is opened from the project or opportunity header ("Close…" secondary action). The flow is:
1. Choose a type. A radio group shows only the types valid for the entity. Each option lists its preconditions with a status icon plus a text label (satisfied or missing).
2. Missing preconditions show a link to the place where the record is created (gate panel or S12 transition form). Submit stays disabled, and the reason is given in text.
3. Fill in the reason and learning capture. Learning capture is required for kill or withdrawal types.
4. Confirm. The summary repeats the type and basis. The primary button reads "Close project" or "Close opportunity", never "Approve".

All UI uses Onyx 3.0 tokens and shared Dialog, RadioGroup, and Textarea components. `design:lint` must pass.

## 4. F1 — 3-stage review runtime (ADR-0153)

### 4.1 Scope and rollout

The runtime covers every `requiredArtifacts` entry for S1–S12 in `process/flow.spec.yaml`. It ships as separate PRs in this order:
1. The 7 gate proposals (screening, pre_fs, fs, dd, entity_ic, group_ic, and the S12 transition proposal).
2. The S8–S11 artifacts.
3. The S1–S7 artifacts.

### 4.2 Data model

`review_stage` is keyed by `run_id` today. Artifacts need finer keys. Migration `0124_review_stage_artifact.sql` (additive) adds:
- `artifact_key TEXT`, which is the spec key from `requiredArtifacts`.
- `entity_type`, `entity_id`, and `stage_id` (S1–S12).
- `content_hash TEXT`, the sha256 of the canonicalized artifact JSON.
- `buckets_json TEXT`, shaped as `{verified[], could_not_verify[], needs_judgement[]}`. Each item has `{claim, evidence_ref?, reason}`.
- `author_domain TEXT`, `model_id TEXT`, `cost_tokens INTEGER`.
- An index on `(entity_type, entity_id, artifact_key, content_hash, stage)`.

Existing columns are kept. `unverified_items_json` mirrors `could_not_verify` (it stays NOT NULL, so there is no silent pass). `result` is constrained by repository code to `NULL` for AI stages. Writing `pass`, `approved`, or `ok` is rejected: **no PASS stamp.**

### 4.3 Stages

- **AI 1st (deterministic, no LLM).** The existing predicate checks (`lib/process-flow.ts` stage completion, Zod contracts, checklist presence) run per artifact. Output goes into the same three buckets: missing fields go to `could_not_verify`, and failed thresholds go to `needs_judgement`. The run is cheap, so it is triggered on every artifact write.
- **AI 2nd (LLM, cross-domain).**
  - Reviewer selection: take the authoring activity's agent from the flow spec, then its domain from `agents/<name>.md`. Pick a reviewer from the cross-validation matrix in the design of record, choosing a **different** domain. If no matrix entry exists, apply the default mapping: functional→technical, technical→functional, industry→region, region→industry.
  - If the domain cannot be resolved, the stage is not run. It is recorded as `could_not_verify: ["reviewer domain unresolved"]`, never as a same-domain review.
  - Calls go through `lib/llm.ts` `complete()` with a JSON schema (Zod) for the three buckets. Invalid JSON gets one retry, then the row is written with everything in `could_not_verify`.
  - The prompt instructs the model to declare what it could not check. An empty `could_not_verify` is rejected by Zod (min 1), because a reviewer that claims to have checked everything is not credible.
- **Human final.** This is written only as a side effect of an existing human action. That means a `gate_decision` POST, an approval POST, or a `venture_transition_decision` POST. Those routes write a `review_stage(stage='human_final', reviewer_agent_or_user=<session user>, result=<go|hold|kill|approved|rejected>)` referencing the reviewed artifacts. This is the only stage where `result` holds a decision word, and it is the human's.

### 4.4 Boundary #2 guard

The reviewer module (`lib/review/`) has no import path to the gate or approval repositories. A unit test asserts this through the import graph. A second test asserts that the AI-stage write function throws if `stage='human_final'`. The repository rejects `human_final` rows whose writer is an agent id. Nothing in AI output can change `gate_decision`, `approval`, or `venture_transition_decision`.

### 4.5 LLM cost control

- **Cache by content hash.** If an `ai_2nd` row exists for `(artifact_key, entity, content_hash)`, it is reused with no call.
- AI 2nd runs only after AI 1st has no structural `could_not_verify` items. Missing data means there is nothing worth reviewing.
- **Trigger.** On demand from the gate panel ("Request AI 2nd review"), plus automatically when an artifact enters a gate package. It never runs on every keystroke-level save.
- **Budget.** A per-project monthly token cap (env `REVIEW_MONTHLY_TOKEN_CAP`). When the cap is exceeded, the row is written with `could_not_verify: ["budget exhausted"]`. The default model is Medium tier, and the context is limited to the artifact plus cited evidence excerpts.
- `completeOrFallback` must not be used. A missing LLM means the review was not performed, and that is recorded as such.

### 4.6 KPI (review_audit_sample)

A human reviewer can sample an `ai_2nd` row in the gate panel ("Audit this review": agree or disagree plus a note). The KPI is the agreement rate = agreed / sampled per quarter per domain pair. It appears on the governance KPI page (compliance-officer owned). A suggested sample rate of 10% of `ai_2nd` rows is shown as a prompt. It is not enforced.

### 4.7 API

- `GET /api/projects/[id]/reviews?stage=S9&artifact=...` returns the latest rows per stage.
- `POST /api/projects/[id]/reviews/ai-2nd` with `{artifactKey}` returns 202. The write is performed as the calling user's request (boundary #1: no service account). `reviewer_agent_or_user` stores the agent persona name, and `requested_by` stores the user.
- `POST /api/reviews/[id]/audit-sample`, human only.

### 4.8 UI — gate panel 3-bucket view

There is one tab per artifact with three labelled columns or sections: **Verified**, **Could not verify**, and **Needs judgement**. The order is fixed, and needs judgement is visually prominent. Each section shows its count and its stage origin (AI 1st or AI 2nd plus reviewer domain). There is no green check summary, no "PASS" badge, and no aggregate score. The human decision controls stay in their existing place and are labelled as the human's decision.

## 5. F2 — RAG assessment on web

- Add the server function `recomputeRag(projectId, trigger)` in `db/lib/rag-service.ts`. It wraps the existing `assessRun` and writes `rag_assessment` with `trigger` and `inputs_hash`. If the inputs hash is unchanged, no new row is written.
- Triggers (event-driven): valuation run saved, proxy chain grade change, regulatory/permit finding saved, gate-package assembly, and IC package GET when the latest row is older than the latest input (lazy). The CLI keeps working on the same function.
- **The RAG grade is a proposal.** It is shown as "proposed RAG". Boundary #4 (data confidence caps the grade) is already in `computeOverall` and is kept.
- **S1 data confidence.** Market sizing persists `data_confidence_grade (A|B|C)` and `chain_hops`, computed with `dataConfidenceFromChain`. Migration `0125_market_sizing_confidence.sql` is additive.
- **Scheduler.** No in-container cron is added in this wave. Staleness recompute is lazy (on read). A follow-up ticket goes to infra-automation-engineer for a host-level scheduled `bun scripts/co-newbiz/rag.ts --stale`.

## 6. F4 — Predicate corrections (`lib/process-flow.ts`)

| Stage | Change |
|---|---|
| S1 | Require `data_confidence_grade` on the sizing artifact. Replace the name join with an FK: add `opportunity.industry_id` (migration 0126, backfilled by exact name match, with unmatched rows listed in a report rather than guessed). |
| S3 | Require a non-empty capability list (≥1 item with `source`). |
| S6 | Require each candidate to have `source` plus the spec's required attributes. |
| S7 | Require screening evidence per candidate (each candidate has ≥1 evidence ref or an explicit `excluded_reason`). |
| S11 | For brownfield, require a PMI kickoff record and a `reviewed_by` (human) on the handoff. |
| S12 | Stale-cycle flip syncs `pipeline_run` (see §3.3). |

All predicate tightenings are grandfathered (§9).

## 7. F5 — Brownfield sub-track audit plan (read-only)

- **Matrix.** Seven sub-tracks × S8–S11 × (procedure step, required artifact, predicate check, UI surface, test). The source is `process/flow.spec.yaml`, `procedures/_shared/brownfield-*`, and `lib/process-flow.ts`.
- **Output.** A gap table in `docs/reports/`, with each gap classified as spec-missing, predicate-missing, or UI-missing.
- **Owners.** brownfield-agent (functional content), platform-lead (system mapping), partnership-agent (JV and partnership), and financing-agent (minority and CVC).
- No code or procedure change is made in this wave. Fixes are ticketed separately.

## 8. Pipeline changes summary

- `pipeline_run.status` gains `killed` and `withdrawn`. The `pipeline.ts` readers treat both as terminal.
- `pipeline-sync` (see §3.3) handles the S12 stale reopen only for non-closed projects.
- The gate-package assembly step triggers AI 1st, the cached AI 2nd, and the RAG recompute.

## 9. Grandfathering (ADR-0151 precedent)

- Projects with a `project_policy_pin` earlier than the Wave F migration date keep the old predicates for F4 tightenings.
- Already-closed projects keep `closure_type = NULL`, labelled "legacy (untyped)" in the UI. There is no backfill.
- Gate kills recorded before migration 0123 are not required to carry learning capture.
- 3-stage review is not retroactively required for artifacts already accepted at a gate before the rollout PR date. Rows are written only going forward.
- Exception: new closures of in-flight projects use the typed contract. Closure is a new action, not a re-evaluation of past work.

## 10. PR split plan

| PR | Content | Depends on |
|---|---|---|
| F-1 | ADR-0152 accepted. Migrations 0122/0123 plus the `pipeline_run` rebuild, `closeEntity`, the routes, the closure modal, and tests. | — |
| F-2 | ADR-0153 accepted. Migration 0124, `lib/review/` (AI 1st and AI 2nd), the human_final hooks, and the gate panel 3-bucket view for the 7 gate proposals. | F-1 merged |
| F-3 | Review rollout to the S8–S11 artifacts. | F-2 |
| F-4 | Review rollout to the S1–S7 artifacts, plus the audit-sample KPI page. | F-3 |
| F-5 | F2: rag-service, the S1 confidence migration 0125, and the IC package fix. | F-1 |
| F-6 | F4 predicate fixes plus migration 0126 (`industry_id`). | F-5 |
| F-7 | F5 audit report (docs only). | — |

PRs are sequenced per the Sequential Branch Dependency Rule, and each ends with `/sync`.

## 11. Risks

| Risk | Mitigation |
|---|---|
| `pipeline_run` table rebuild on a live DB | Use the proven 0033 rebuild pattern, rehearse on a backup (dba), and write a reversible down-migration. |
| LLM reviewer correlated blind spots | Enforce the cross-domain rule, require a non-empty `could_not_verify`, and run the human audit-sample KPI. |
| LLM cost spikes during rollout | Hash cache, an AI 1st precondition, a monthly cap, and on-demand triggering. |
| Users read the 3 buckets as approval | No PASS badge, fixed order with needs-judgement prominent, and copy reviewed by ux-designer-agent. |
| Closure deadlock (no basis record possible) | Use `withdrawn` as the escape type. It needs only a human, a reason, and learning. |
| Name-based industry backfill mismatches | Use exact match only and list unmatched rows for human mapping. |

## 12. Verification

- **Unit.**
  - `closeEntity` preconditions: one passing and one failing case per type.
  - `already_closed`, and reopen then close again.
  - Terminal status mapping.
  - The gate kill route without learning returns 422.
- **Boundary #2 regression** (like `tests/unit/pipeline.test.ts`):
  - (a) The review module writes no `gate_decision`, `approval`, or `venture_transition_decision` rows, checked by spying on the repositories and by an import-graph assertion.
  - (b) An AI-stage write with `result='pass'` throws.
  - (c) A `human_final` write by an agent id throws.
  - (d) The close route rejects agent-id `closed_by`.
- **AI 2nd.**
  - A same-domain reviewer is never selected (table-driven over all activities).
  - A cache hit makes no LLM call.
  - Invalid JSON falls back to everything in `could_not_verify`.
  - A missing LLM records "not performed".
- **RAG.** An IC package GET writes `rag_assessment` when it is stale. The data-confidence cap still holds when the S1 grade is B or C.
- **Predicates.** Old-pin fixtures pass under legacy rules, and new-pin fixtures fail on each missing F4 item.
- **Gates.** `bun scripts/audit.ts`, typecheck, lint, coverage (Wave A gates), and `design:lint`.

## 13. Accessibility (WCAG 2.1 AA)

- **Gate panel 3-bucket view.**
  - Each bucket is a `section` with a heading (`h3`) and a count in the accessible name ("Needs judgement, 4 items").
  - Status is never conveyed by color alone. The text label and icon both carry `aria-hidden` only on the icon.
  - Contrast is ≥4.5:1 from Onyx tokens.
  - Artifact tabs use the WAI-ARIA tabs pattern (arrow keys, `aria-selected`).
  - The AI 2nd request button announces progress through an `aria-live="polite"` region.
  - The reviewer domain and the AI or human origin are in visible text.
- **Closure modal.**
  - The dialog uses `role="dialog"` and `aria-modal`, with focus trapped and returned to the trigger on close. Esc cancels.
  - Radio group: unmet preconditions are listed and linked by `aria-describedby`. The disabled submit has a visible text explanation, not only a disabled state.
  - Required fields are marked in text, and errors are tied to their fields by `aria-describedby` and announced.
  - Touch targets are ≥44px at the mobile breakpoint.

## 14. Preview Verification

At two breakpoints, desktop 1440×900 and mobile 375×812:
1. **Gate panel.** Open a project at an S9 gate. The three buckets show in fixed order. There is no PASS badge. Request AI 2nd review and check the live region update. Then repeat for a cached artifact and check that no new network call to the LLM endpoint is made. Keyboard-only tab switching works.
2. **Closure modal.** Try `killed_at_gate` with no kill decision: submit is disabled and the missing record is linked. Record a kill with learning in the gate panel, return, then submit. The project header shows the closure type, and the pipeline shows `killed`.
3. **Withdrawn path.** Submit without learning capture and check the inline error. Then submit successfully.
4. **IC package.** The proposed RAG renders with a non-empty assessment.
5. **Mobile.** The bucket sections stack vertically, the modal is full-screen, and there is no horizontal scroll.

Capture console errors (none expected) and screenshots for the PR.

## 15. Open questions

See the platform-lead hand-off report. In summary: who finalizes the vocabulary, how the `pipeline_run` terminal status is modeled, the source of agent-domain resolution, and the review token cap default.
