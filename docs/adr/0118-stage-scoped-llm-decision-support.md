# ADR-0118: Stage-scoped LLM decision support on human-judgment surfaces

- Status: Accepted
- Date: 2026-09-11
- Deciders: PM (dispatch), process-governance-manager (governance), backend-engineer (API contract), frontend-engineer (decision-surface UI), risk-officer (boundary review)
- Related: ADR-0052 (proposed-RAG / boundary #2), ADR-0053 (human-decision step marking), ADR-0094 (gate decisions), ADR-0097 (steering committees), ADR-0104 (deterministic track advisory), ADR-0116/0117 (S8 generation), `process/flow.spec.yaml` (stage inputs SSOT), design doc `docs/designs/2026-09-11-stage-llm-decision-support-design_ko.md`

## Context

The workspace principle was amended on 2026-09-11 (CLAUDE.md / GEMINI.md /
AGENTS.md, boundary #2): **gate approvals and investment decisions belong to
humans; LLM-drafted information provision and recommendations are the
sanctioned decision-support mode — decision surfaces should actively offer
them.** S4 already implements the reference pattern
(`POST /api/opportunities/{id}/route-recommendation`, ADR-0104 advisory as
grounding input, human records the route decision).

An audit of S1–S12 found the principle unevenly implemented:

- **S5 (역량 평가·진출전략)** and **S10 (투자구조 설계)** are fully LLM-blind —
  every judgment input (capability-gap rows, Build/Partner/Hire/Invest,
  vehicle/stake/instrument, 4-axis notes) is hand-entered with zero
  information support.
- **Six gate-recording surfaces** (screening, pre_fs, target_screening, fs,
  dd, entity_ic/group_ic) share `GateDecisionPanel`, whose rationale is a
  required freehand input — no advisory brief, no draft rationale anywhere.
- **S2** attractiveness scoring is a bare number box (the discover-time LLM
  score is written once and never re-offered), **S8** adoption lacks a
  recommendation summary (a deterministic RECOMMENDED chip exists with no
  "why"), and **S12** portfolio deliberately shows data with no recommendation.
- The strongest existing offerings (S2 discover/sketch, S3 synergy/fit, S8
  business-case prose, S9 DD tailoring) produce analysis but do not surface a
  proposal **at the moment of the human judgment**.
- One hazard was identified: LLM-suggested candidate companies for the S6 long
  list without live search evidence would be fabricated names.

## Decision

1. **Stage-scoped context manifests (the governing constraint).** Each stage's
   LLM feature reads **only** the artifacts `process/flow.spec.yaml` declares
   as that stage's `inputs` plus the stage's own current draft state — never a
   bulk or cross-stage dump. Every feature's context is an explicit manifest
   (a named list of artifact queries in code), and each UI section displays
   "이 제안이 본 산출물" (the manifest) so a reviewer can audit what the LLM
   saw. Example: S5's recommendation reads the S4 track decision, the S1
   market definition, and the S3 required-capability outputs — exactly
   flow.spec's S5 inputs — and nothing else.
2. **One standard contract for all stage LLM features.** On-demand `POST`
   (nothing persisted, no schema change), analyst+ role floor,
   `completeOrFallback` with LLM output whitelist-normalized (tracks, routes,
   enums, 1–3/0–100 clamps — LLM JSON is never trusted raw), a deterministic
   fallback that **never fabricates values** it cannot derive (missing scores
   come back as null with a reason), `appendAudit` on every generation with
   the source (`llm` | `synthesis`), and an explicit generate button (no
   auto-run). Proposals never write decisions, adoptions, or gate records —
   the recording click stays human (boundary #2 unchanged).
3. **Gates share transport, not context.** `lib/gate-brief.ts` + two routes
   (`/api/opportunities/{id}/gate-brief`, `/api/projects/{id}/gate-brief`)
   serve `GateDecisionPanel`, but each of the six gates has its own context
   builder enumerating only that gate's flow.spec inputs (screening →
   S1 sizing + S2 funnel + S3 drafts; pre_fs → + S4 decision + S5 assessment;
   target_screening → + S6/S7 target state; fs → adopted BC + WACC; dd →
   checklist/findings/waivers; entity_ic·group_ic → IC-package components +
   prior gate decisions).
4. **Six implementations ship now**: the shared gate brief (covers the six
   gate surfaces), S5 capability/strategy recommendation, S10 deal-structure
   recommendation, S12 monitoring brief (portfolio transition draft), S8
   adoption-recommendation summary, and S2 attractiveness draft. Each is
   applied to the human's form only through an explicit apply action and
   remains editable.
5. **Deferred with rationale**: S6 candidate-company suggestion requires
   live-search evidence (Tavily adapter) to avoid fabricated names — blocked
   until that lands; S7 per-checklist-item briefs (t-01~t-09) are covered
   first by the target_screening gate brief; S1's analyst-confirm/seed
   surfaces are a UX gap, not an LLM gap.

## Consequences

- After this lands, every human-judgment surface in S1–S12 either offers an
  LLM-drafted proposal/summary at the decision point or has a documented,
  principled deferral. The exceptions are computational confirmations (WACC
  arithmetic, sizing math) where LLM adds no information.
- No DB schema changes — everything is on-demand with audit provenance, so no
  ADR-triggered migration work and no retention burden.
- Token cost is bounded by explicit generation (one call per click), and the
  deterministic fallback keeps every surface fully functional without an LLM
  configured (the platform stays non-LLM-dependent per the design).
- Context scoping is enforced in code (per-feature manifest maps), not by
  convention — a reviewer can diff a manifest to see exactly which artifacts
  a feature reads, and the UI exposes the same list.
- S6 candidate suggestion becomes implementable once a search-evidence source
  is wired (Phase 8 adapter track); until then the long list stays
  hand-built with committee deliberation as its advisory surface.
- The amended boundary #2 text in CLAUDE.md/GEMINI.md/AGENTS.md is the
  governing principle; this ADR specifies its implementation contract.
