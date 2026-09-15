---
lang: ko
lang_reason: source-material
---

# ADR-0092: S1 market-sizing schema extension, `failed` status, seed route, screening-gate fix, and S3→S4 handoff

**Status**: Accepted — implemented concurrently with this record (per ADR-0032, documents before code but same PR)
**Date**: 2026-09-03
**Deciders**: user (standing directive), process-governance-manager (S1/S3/S4 gate ownership), platform-lead (schema + API)
**Design of record**: `app/web-next/lib/market-sizing.ts` (`SizingMatrix`), `db/migrations/` (new migration adding `failed` to `market_sizing_analysis.status`), `app/api/market-overview/analyses/[id]/seed/route.ts`, `app/web-next/lib/opportunity-screening.ts` (`gateRecommendation`), `app/web-next/app/synergy/page.tsx` (Short List tab)
**Related**: ADR-0046 (`market_sizing_analysis` original design), ADR-0077 (dynamic final-demand segments — same class of optional-field extension), ADR-0084 (S4 structured route-decision scoring), ADR-0090 (synergy alignment refactor)

## Context

Five related gaps surfaced while running a deep S1 market-analysis research exercise
(소형모듈원자로/SMR) end to end and trying to wire its output into the existing S1→S4 pipeline.
They are grouped in one ADR because they were discovered and decided together, but each is
independently scoped and separately implementable.

1. **`SizingMatrix` has no home for deep-research content.** The SMR exercise produced
   multi-source demand estimates with a 47x variance across sources, a project-level demand
   pipeline with per-project confidence tiers, named-competitor capacity/status/tech-type
   detail, a 4-country regulatory comparison, per-section confidence grading, proposed Kill
   Criteria, and an explicit "확인 불가" (could-not-verify) declaration list. None of this had
   a field to persist into; the existing `SizingMatrix` schema (region×segment cells, CAGR,
   bands) was shaped for the pipeline's own LLM-driven 8-step run, not for externally-supplied
   research.
2. **Pipeline failures were invisible and unrecoverable.** `market_sizing_analysis.status` only
   ever had `in_progress`/`completed` (migration `0046_market_sizing_analysis.sql`). A pipeline
   step throwing left the row permanently `in_progress` — no error captured, no retry path, and
   no way for the UI or an operator to distinguish "still running" from "died."
3. **No ingestion path for agent-produced research.** The pipeline is LLM-driven and
   self-generating; there was no route to persist a `SizingMatrix` that an agent had produced
   outside the pipeline (as the SMR exercise did) as a new version of record.
4. **The Screening-gate formula was incomplete.** `docs/process-flow.md`'s Screening gate is
   defined over three criteria — `fit_verdict`, `synergy_score`, `attractiveness_score` — but
   `opportunity-screening.ts`'s `gateRecommendation` computed Go/Hold/Kill from only
   `fit_verdict` + `synergy_score`, silently ignoring `attractiveness_score`. An opportunity
   with a strong fit/synergy read but a weak market-attractiveness read could reach a "Go"
   recommendation the documented gate rule never intended.
5. **No code path closed the S3→S4 handoff.** S4's route-decision screen (ADR-0084) is fully
   built and reachable directly, but nothing transitioned `opportunity.status` when a Short List
   candidate was actually selected — an analyst finishing S3 had no button that said "this one
   moves to route decision," so the S3→S4 boundary existed only as a shared understanding, not
   as a system state transition.

## Decision

### 1. `SizingMatrix` optional-field extension (no migration)

Add optional fields to `SizingMatrix` and its nested types in `market-sizing.ts`, following the
ADR-0077 precedent exactly (optional TS fields on the JSON payload stored in
`market_sizing_version.payload`; zero DB migration):

- `demandPipeline` — named projects/programs with per-item demand estimate and confidence tier,
  for industries whose near-term demand is driven by a small number of identifiable projects
  rather than a continuous market.
- `regulatoryComparison` — per-jurisdiction regulatory posture entries (this analysis used 4
  countries; the field is an array, not fixed-arity).
- `sectionConfidence` — per-report-section confidence grade + rationale, so a matrix can carry
  "이 섹션은 신뢰도 낮음" at the granularity the analyst actually has evidence for, rather than
  one grade for the whole matrix.
- `killCriteriaProposals` — Kill Criteria the research proposes for registry consideration
  (proposal only; activation still goes through the existing kill-criteria registry process,
  ADR-0057/0060 — this field does not itself arm anything).
- `verificationLedger` — the explicit "확인함 / 확인 못함" list; an AI reviewer's declaration of
  what it could and could not verify is a first-class, queryable field, not prose buried in a
  summary (co-newbiz design: AI review "must explicitly declare what it could not check").
- `ragCapRecommendation` — a proposed RAG-grade cap driven by the weakest linked evidence (e.g.
  the 47x source variance), analogous to the existing proxy-chain confidence cap (ADR-0006) but
  expressed at the matrix level for sizing work that isn't proxy-chain-derived.
- `AnchorSource` extended with `methodology`, `sourceUrl`, `asOf` — an anchor number is only as
  good as knowing how it was derived and how current it is; these were previously implicit.
- `CompetitiveStructure.players[]` extended with `techType`, `capacityMWe`, `projectStatus`,
  `evidenceRef` — the existing player entry (name + share) had no room for the technology/
  capacity/status/evidence detail a competitor deep-dive actually produces.

All fields are optional. Matrices without them (every analysis to date) render exactly as
before; `segmentsOf()`-style accessor helpers are unaffected since none of these fields gate
existing rendering logic.

### 2. New `failed` status on `market_sizing_analysis` (DB schema change)

Unlike decision 1, this changes the `status` CHECK constraint added in migration
`0046_market_sizing_analysis.sql` (`CHECK (status IN ('in_progress', 'completed'))`) and
therefore needs a migration, not just a TS type change:

- A new migration widens the constraint to `CHECK (status IN ('in_progress', 'completed',
  'failed'))`.
- The pipeline captures the failure (error message/step) on transition to `failed` rather than
  leaving the row silently stuck.
- The analysis detail UI gains a retry affordance for `failed` rows, distinct from **재분석**
  (which creates a new version of a `completed` analysis) — retry re-attempts the failed run.

This is additive to ADR-0046's design, not a supersession: the table's shape and the
`completed`/`in_progress` semantics are unchanged, a third terminal state is added.

### 3. New seed route: `POST /api/market-overview/analyses/{id}/seed`

Add `seedMarketAnalysis`, mirroring the company-profile-pipeline's existing "agent output →
payload JSON → INSERT" pattern rather than inventing a new ingestion shape:

- Accepts a `SizingMatrix`-shaped payload (extended per decision 1) in the request body.
- Persists it as a new `market_sizing_version` row for the given analysis id, exactly as the
  pipeline's own step-8 write does, so seeded and pipeline-generated versions are
  indistinguishable in storage and render through the same report UI.
- Does not touch `market_sizing_analysis.status` beyond what a normal version write already
  implies — seeding an analysis is a version-append, not a pipeline run, so it does not need
  `in_progress`/`completed`/`failed` transitions of its own.
- Scoped to analyst+ (same authorization tier as `createMarketAnalysis`/`rerunMarketAnalysis`).

This is the ingestion path decision 1's fields were added to serve: without it, deep research
content produced outside the LLM pipeline (as the SMR exercise was) had nowhere to land except
manual DB writes.

### 4. Screening-gate formula correction

`gateRecommendation` in `opportunity-screening.ts` is corrected to weigh all three documented
Screening-gate criteria — `fit_verdict`, `synergy_score`, `attractiveness_score` — matching
`docs/process-flow.md`'s Screening gate definition. This is a rule/threshold correction, not a
new rule: the intended gate was always three-criteria; the implementation had silently dropped
one. Per the design's ADR trigger list ("RAG rule/threshold changes"), the correction is
recorded here rather than shipped as an unremarked bug fix — any opportunity whose recommended
gate value changes as a result should be treated as a recomputation, not a regression.

### 5. S3→S4 opportunity-status handoff wiring

Add a UI action in the Short List tab of `/synergy` (ADR-0090's synergy alignment surface) that,
for a selected Short List candidate:

- Transitions `opportunity.status` to `selected`.
- Navigates to `/route-decision` with a pre-filled rationale (drawn from the candidate's
  recorded synergy/fit/attractiveness evidence, per decision 4's gate output).

This closes the gap between a completed S3 Short List and S4's already-built route-decision
screen (ADR-0084): before this change no code path connected the two, even though both
surfaces existed independently. Per boundary #2 (gate approval and the investment decision
belong to humans), this action records a proposed selection and pre-fills S4's input — it does
not itself constitute a gate decision; the human still completes the S4 scorecard.

### 6. Pipeline adoption of the extension fields (skill v1.5.0 alignment)

Decisions 1's extension fields existed only as an ingestion schema — the 8-step LLM pipeline
never generated them, so every pipeline-run analysis (vs. seeded ones like SMR) rendered the
new tabs empty no matter how many times it was re-run. This ADR records that the pipeline
itself now produces them, and `systematic-market-sizing` v1.5.0 standardizes the same
discipline as the S1 method (steps 2-A/2-B/7-A):

- **Deterministic outlier rule (step 2)** — outlier exclusion no longer rests on the LLM's
  own marking: sources deviating beyond 3× / below ⅓ of the median estimate are mechanically
  excluded, and the anchor total is recomputed as the mean of the remaining consensus
  sources. A total quoted by the estimating party is never trusted.
- **Demand pipeline, regulatory comparison (steps 2-A/2-B)** — generated from web research
  plus LLM extraction, with source URLs; `confirmedDirectly` stays false unless a primary
  legal source is behind the item.
- **Top-down consensus retrieval (step 5)** — the consistency check now retrieves a public
  consensus CAGR instead of hard-coding `topDownCagr` to 0; when none is obtainable the
  comparison is recorded as unavailable rather than zero-filled.
- **Verification ledger, kill-criteria proposals, per-section confidence, RAG cap
  (step 7-A)** — the ledger is derived deterministically from step 6's cross-validation
  verdicts; section grades are assigned from the section's evidence class (LLM estimate /
  web research / primary source); the RAG cap is Amber for any `llm-estimate` matrix,
  enforcing boundary 4 (data confidence caps the grade) mechanically.
- **Per-industry driver counts** — the overview's "connected drivers" figure is read from
  each industry's latest matrix cell count (regions × segments) instead of a hardcoded 18,
  which predated dynamic segments (ADR-0077).

Consequence: pipeline-generated and seeded matrices now have parity of shape — a re-run
fills every tab the seed path fills — while provenance stays honest (all generated values
remain `llm-estimate`/web-research sourced, flagged for analyst confirmation before freeze).

## Consequences

- **Positive**: deep, externally-researched market analyses (SMR and future exercises of the
  same shape) now have a schema home and an ingestion path, without a DB migration for the
  common case (decision 1+3). Stuck-`in_progress` pipeline runs become visible and retryable
  (decision 2). The Screening gate now matches its own written definition (decision 4). The
  S3→S4 boundary is a system state transition, not tribal knowledge (decision 5).
- **Risk accepted**: decision 4 changes the computed gate recommendation for any opportunity
  currently at `attractiveness_score < 60` with an otherwise-passing fit/synergy read — such
  opportunities will newly recommend Hold/Kill instead of Go. This is the intended correction,
  but it is a visible behavior change for in-flight opportunities and should be called out to
  reviewers watching the Screening list.
- **Risk accepted**: `killCriteriaProposals` and `ragCapRecommendation` are proposals only; they
  do not auto-arm registry entries or auto-cap a matrix's RAG grade. An analyst must still act
  on them through the existing kill-criteria registry (ADR-0057/0060) and RAG-grading process
  (ADR-0016/0049) respectively — the schema gives them a place to be recorded, not authority.
- **Migration**: one new migration (decision 2's `failed` status). Decisions 1, 3, 4, 5 require
  no DB migration — payload JSON extension, a new route, a formula correction, and a UI action
  respectively.
