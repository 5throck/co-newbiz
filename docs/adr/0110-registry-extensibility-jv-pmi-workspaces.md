# ADR-0110: Registry-driven extensibility — stage-completion predicate maps, the scoring-weights data module, and the JV/PMI/partnership workspaces as the first consumer

- Status: Accepted
- Date: 2026-09-06
- Deciders: New Business Review Lead (PM)
- Deciders note: implements the profile-first principle of ADR-0024/ADR-0044 at the application layer; companions to ADR-0109 (route error wrapper, used by all new routes)
- Related: ADR-0094 (stage completion), ADR-0095 (project promotion, S8–S12 skeleton), ADR-0102 (hybrid synergy scoring), ADR-0106 (deal structuring stage), ADR-0024/0044 (profile-first), ADR-0052 §C/§D (JV lifecycle, PMI)

## Context

Three places in the application had the same structural smell: extension
required **editing engine code** rather than **registering data**.

1. **Stage completion predicates lived in if/else chains.**
   `lib/process-flow.ts` evaluated `S1`…`S12` through an
   `if (stage.id === "S1") … else if (stage.id === "S2") …` chain inside the
   evaluator function bodies. Adding a stage or a case type meant editing
   the engine body — the classic change-magnet that ADR-0096 removed for
   orchestration and ADR-0105 removed for navigation, but which persisted
   here.
2. **Scoring methodology numbers were scattered TypeScript literals.**
   `lib/synergy-score.ts` hard-coded the factor base weights (0.35/0.3/0.2/
   0.15), the market-attractiveness curve breakpoints (0.08/0.27/50), and
   the financial-capacity shape (base 45, debt floor 0.4, slope 180,
   ±40 penalty, ROE 350, margin 300) as inline literals. ADR-0024/0044's
   profile-first principle says tunable methodology parameters are data —
   and the planned industry-profile/region-profile override system needs a
   single well-defined place to merge overrides over.
3. **The JV/PMI/partnership models had no functional surface.**
   `partner_candidate`, `partner_dd_finding`, `jv_term`, `pmi_key_talent`,
   and `pmi_synergy_certification` existed in the schema (the ADR-0052
   §C/§D domains) but had zero API routes and zero screens — dead surfaces
   reachable only by direct SQL.

## Decision

1. **Stage completion becomes a predicate registry.** `process-flow.ts`
   now registers each stage's completion evaluation in two maps —
   `OPPORTUNITY_STAGE_COMPLETION` (S1–S7) and `PROJECT_STAGE_COMPLETION`
   (S8–S12) — keyed by stage id. The evaluators are one-line lookups:
   mapped stage → registered predicate; unmapped stage → documented
   default (opportunity stages default to *not complete*; project stages
   default to *complete*, matching the previous chain's fall-through
   behavior). A new stage or case type registers a predicate instead of
   editing the engine body. **Behavior is unchanged** — every predicate is
   the previous branch verbatim — and `current_stage` remains derived,
   never stored.
2. **Scoring methodology data is centralized in
   `lib/scoring-weights.ts`.** The module exports
   `SYNERGY_FACTOR_WEIGHTS`, `MARKET_ATTRACTIVENESS_CURVE`, and
   `FINANCIAL_CAPACITY_PARAMS` as workspace-wide defaults; `synergy-score.ts`
   imports them instead of inlining literals. The module is deliberately
   **data, not logic** (no computation allowed) and is the declared seam
   for the future industry-profile/region-profile override — profile data
   would merge over these defaults at load time, per ADR-0024/0044.
   Changing any value changes scores; `tests/unit/synergy-score.test.ts`
   must be kept in sync when re-tuning.
3. **JV/PMI/partnership get their first functional workspaces** — the
   first consumers exercising all of the above (each new route is born
   wrapped in the ADR-0109 `route()` envelope; the workspaces read the
   same derived process state, never a stored current stage):
   - **API**: 10 project-keyed route files under
     `app/api/projects/[id]/partners` (candidates + nested DD findings),
     `.../jv-terms`, and `.../pmi/key-talent` + `.../pmi/synergy-certifications`
     — 18 operations registered in `docs/architecture/openapi.yaml`.
     Every route is member-authenticated, role-gated (analyst+ for
     writes), audit-logged, and envelope-wrapped.
   - **UI**: two project-detail pages — `/projects/[id]/partnership`
     (partner candidates with DD findings, JV terms) and
     `/projects/[id]/pmi` (key talent, synergy certifications) —
     registered in `ProjectSubNav` and `lib/navigation.ts`
     `NON_MENU_ROUTES` per the ADR-0105 contract.

## Consequences

- Engine bodies stop accumulating stage branches; the diff for a new
  stage touches only the registry plus the stage list in flow.spec-derived
  metadata. The registry maps are intentionally
  `Partial<Record<StageId, …>>` so TypeScript forces an explicit,
  documented default for any stage that has no predicate yet.
- Tuning the synergy score is now a data-only diff against one file, and
  the profile-override system has a merge target that already exists —
  no scoring-code refactor will be needed when profiles arrive.
- Five previously dead schema surfaces become governed API/UI surfaces
  with the standard access-control and audit treatment; the openapi drift
  gate keeps their spec entries honest.
- The registry approach trades a little indirection (jump-to-definition
  goes through a map) for an open/closed extension path; if a future stage
  needs cross-stage context beyond `OpportunityStageArgs`/`ProjectStageArgs`,
  the argument interfaces — not the evaluator call sites — are what change.
