---
lang: ko
lang_reason: source-material
---

# ADR-0084: S4 structured route-decision scoring (two-stage framework)

**Status**: Accepted — implemented in the same change (migration 0058, API + route-decision UI)
**Date**: 2026-09-01
**Deciders**: user (standing directive), brownfield-agent (framework owner), frontend-engineer (implementation)
**Design of record**: `db/migrations/0058_route_decision_score.sql`, `app/web-next/app/api/opportunities/[id]/route-decision/route.ts`, `app/web-next/app/route-decision/page.tsx`
**Framework of record**: `docs/decisions/2026-08-24-class-c-decisions.md` (d) resolving ADR-0052 open question (d)

## Context

flow.spec v2.0.0 S4 requires "5criteria 채점 결과(통제 필요도·역량 결정성·시장 불확실성·통합
역량·역량확보 속도 각 20%)" as a required artifact and "Brownfield인 경우 5criteria 채점 결과와
사전배제 점검이 기록되었다" as a completion criterion — but the route-decision surface accepted
only free-text rationale. The documented two-stage framework (Stage 1 intent split
integration vs capability-access; Stage 2 five criteria, equal 20% weights, 1–3 scale,
lexicographic override BEFORE the sum: control-need=high AND capability-access ⇒
license/co-development-shaped routes disallowed; default staging: high uncertainty +
moderate control ⇒ minority/co-dev WITH pre-negotiated step-up) existed only in prose, so
decisions were recorded without the scoring evidence the spec demands.

External practice consulted: McKinsey Build-Borrow-Buy (an intent/branch decision precedes any
scoring), Wang & Zajac SMJ 2007 (typology → scored checklist conversion), Cooper Stage-Gate
(scorecards structure decisions but never replace them; thresholds must be pre-registered).

## Decision

1. **Schema (migration 0058, additive)** — `route_decision_score` (one row per criterion with
   mandatory `evidence_note`) plus `route_decision` columns `intent`, `override_flagged`,
   `staging_recommended`, and server-computed `total_score` (Σ 20% × score, max 3.0).
2. **Server-side enforcement of the spec's completion criteria** — a Brownfield POST without
   intent + all five scored criteria (each with evidence) is rejected 400. The lexicographic
   override is enforced as a hard block: capability-access intent + control-need=3 +
   partnership/rbd/corporate_venture route ⇒ 400, regardless of the total score. The
   default-staging recommendation (uncertainty=3 AND control ≤2) is auto-computed and stored.
3. **Two-stage UI** — Stage 1 intent cards (통합 vs 역량접근) with per-branch route hints;
   Stage 2 a 5×(1–3 + evidence) scorecard with live total and override/staging banners. The
   rationale/alternatives free text remains alongside — narrative complements, never replaces,
   the scorecard. Decision history shows intent, total score (hover reveals per-criterion
   evidence), and the step-up recommendation flag.
4. **Weights and thresholds remain ILLUSTRATIVE** — the 20% weights and the 1–3 anchors follow
   the dated Class-C decision; any future change goes through a new dated decision (the
   ADR-0081 anti-tamper pattern). The score does not auto-decide the track; the human
   decision record (decided_by) remains the gate output.

## Consequences

- S4 completion criteria are now mechanically checkable (a Brownfield decision without a
  scorecard cannot exist), aligning flow.spec, the API, and the UI in one contract.
- Scoring is versioned per decision row but decisions remain append-only — a re-decision is a
  new decision record with a fresh scorecard, never an in-place edit.
- Greenfield decisions may optionally record intent but are not scored (the five criteria are
  Brownfield-shaped; S5 capability assessment covers the Greenfield evidence needs).
