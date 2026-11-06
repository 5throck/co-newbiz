# ADR-0192: S3 strategic-fit predicate reads the confirmed synergy assessment

**Status**: Accepted (owner decision — option A chosen, 2026-11-06)
**Date**: 2026-11-06
**Deciders**: Owner (decision); drafted by process-governance-manager; design by platform-lead (design `2026-11-06-ai-review-stage-scope-fit-i18n`, Fix 2)
**Related**: ADR-0053 (human decision steps), ADR-0074 (flow.spec SSOT), ADR-0180 (grandfathering precedent), ADR-0187 (S3 synergy ownership D6'), design `2026-11-06-ai-review-stage-scope-fit-i18n`

## Context

The S3 completion predicate in `app/web-next/lib/process-flow.ts` satisfies the "strategic fit judgement" blocker (`s3.strategic_fit_judgement`) with a non-empty `opportunity.rationale`. That field is the **S2 attractiveness rationale**, not a strategic-fit judgement — any opportunity with an S2 rationale passes the check without any S3 fit work having happened. Meanwhile the actual S3 fit signal — the synergy analysis confirmation (synergy score + rationale, recorded via the synergy-confirm surface) — satisfies the separate `s3.synergy_assessment` blocker but leaves nothing the fit blocker reads.

Reviving a dedicated fit verdict was considered and rejected: `opportunity.fit_verdict` / `fit_rationale` (migration 0052) were **removed by recorded user decision on 2026-09-15** as a duplicate layer over the attractiveness + synergy signals (see the header of `app/web-next/lib/opportunity-screening.ts` and flow.spec S3 completionCriteria history). Option B of the design (restore `fit_verdict` + a write path and an S3 form) would reverse that recorded decision; option A instead names the confirmed synergy assessment as the fit judgement the 2026-09-15 decision already kept.

Selection is deliberately left untouched: synergy confirmation never sets `status = selected`; moving to S4 still requires the explicit human selection action (design non-negotiable boundary #2, ADR-0053).

## Decision

1. **Predicate**: the S3 "strategic fit judgement" (`s3.strategic_fit_judgement`) is satisfied by a **human-confirmed synergy assessment**: `opportunity.synergy_score_confirmed_at` is set AND `synergy_rationale` is non-empty. `opportunity.rationale` (the S2 attractiveness rationale) no longer satisfies the fit blocker for opportunities created on or after the ADR date.
2. **Grandfathering**: opportunities with `created_at < 2026-11-06` (constant `ADR_0192_PREDICATE_DATE = "2026-11-06"` in `lib/process-flow.ts`) keep the legacy predicate (`opp.rationale`). No backfill (ADR-0151/ADR-0180 precedent — a tightening never retroactively un-completes in-flight work).
3. **fit_verdict stays removed**: the 2026-09-15 removal decision stands. No schema change, no new UI field, no migration.
4. **Selection stays human-only**: synergy confirmation does not set `selected`. The S3 screen guides the user — confirm synergy, fit judgement is then satisfied, then the primary action "Select this opportunity" calls the existing validated `PATCH /api/opportunities/[id]` `{status: "selected"}` transition, which records the audit row. Nothing is auto-selected.
5. **flow.spec**: S3 completionCriteria criterion 1 (the fit-judgement-rationale criterion) is reworded so the spec matches the engine; the criterion-to-blocker mapping (`s3.strategic_fit_judgement` → criteria [1]) is unchanged. flow.spec `meta.version` bumps to 2.18.0 per the file's changelog convention; `docs/process-flow.md` is regenerated from the spec (ADR-0074).

## Consequences

- No schema change and no migration; `fit_verdict` / `fit_rationale` columns remain removed/unused.
- In-flight opportunities created before 2026-11-06 are unaffected; new opportunities must have a confirmed synergy assessment (score confirmed + rationale) before S3 completes.
- `check-engine-spec-parity` continues to compare blocker keys, not criterion strings, so the rewording is non-breaking; the flow.spec drift test requires regenerating `docs/process-flow.md`.
- The deterministic synergy recommendation chips (`lib/opportunity-screening.ts`) remain the advisory surface; the final fit judgement is still the human Screening gate decision (boundary #2, ADR-0053) — this ADR changes only what evidence must exist before S3 can complete, not who decides.
- Implementation lands in PR2 of the design's PR split (ADR file, `lib/process-flow.ts`, flow.spec wording + version bump, S3 stage component); this ADR is the governance record preceding it.
