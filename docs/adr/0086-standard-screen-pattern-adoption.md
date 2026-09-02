# ADR-0086: Adopt the standard screen pattern system (StageFrame/StageRail + P1–P5)

**Status**: Accepted — P0/StageFrame implemented and applied to S1–S7 surfaces; full pattern rollout per roadmap
**Date**: 2026-09-01
**Deciders**: user (standing directive), frontend-engineer (implementation), design-system-agent (review)
**Design of record**: `docs/designs/2026-09-01-standard-screen-patterns-design_ko.md`
**Data source of record**: `app/web-next/lib/stage-meta.ts` (client-safe excerpt of flow.spec v2.0.0)

## Context

S1–S11 surfaces were built page-by-page. ADR-0082/0083 fixed interaction and visual
standards, but page structure was still re-invented per stage, and stage headers/progress
rails were hand-coded (or missing). The screen-pattern design distills the eleven stages
into five recurring archetypes (Registry, Report, Decision, Execution, Monitoring) over one
shared skeleton (StageFrame), with extension via documented slots only.

## Decision

1. **P0 StageFrame/StageRail is the single shell for every stage surface** —
   `components/StageFrame.tsx` renders the stage header (S{n} + name + objective) and the
   S1–S11 progress rail with track applicability (non-applicable stages struck through) and
   current-stage gate chips. Its only data source is `lib/stage-meta.ts`; per-page
   hardcoding of stage titles/progress is retired.
2. **stage-meta is spec-governed** — a new test in `tests/unit/process-flow.test.ts`
   compares stage-meta against flow.spec (ids, names, gates, transitions). Spec changes now
   propagate to the screen skeleton or break the build's test gate.
3. **Pattern adoption**:
   - P3 Decision: S4 route-decision is the reference implementation (two-stage intent +
     5criteria scorecard, ADR-0084); S7 screening conforms (knock-out + scorecard with
     mandatory reason, right-aligned action cell).
   - P4 Execution: the S10 establishment record layer (ADR-0085, status vocabulary
     pending/in_progress/done/halted/escalated) is the standard; S5 now shows the same
     execution progress header (component status n/m + done/in_progress).
   - P1/P2: existing Registry/Report surfaces already conform to ADR-0082/0083; only
     StageFrame adoption was needed.
   - P5 Monitoring: adopted when the S11 surface is rebuilt (ADR-0078 deferral still stands).
4. **Extension discipline**: new widgets enter through documented slots; new patterns
   require a design-doc revision plus an ADR. The five-pattern inventory is closed by default.

## Consequences

- Stage headers and progress rails can no longer drift per page; flow.spec is now the
  visual skeleton's source of truth in both direction (spec change ⇒ rail change, enforced
  by test).
- S9/S10-execution/S11 surfaces remain absent (deferred); their eventual pages must use
  StageFrame + P4/P5 rather than new layouts — conformance is review-checkable.
- stage-meta must be regenerated whenever flow.spec adds/renames stages — the conformance
  test makes this an explicit, mechanical step.
