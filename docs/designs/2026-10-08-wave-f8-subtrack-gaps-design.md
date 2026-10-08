---
title: Wave F-8 — Brownfield sub-track gaps (B1 checklist wiring, B4 origin derivation)
status: approved
date: 2026-10-08
owner: platform-lead
related_adrs: [ADR-0047, ADR-0099, ADR-0148]
---

# Wave F-8 — Brownfield sub-track gaps

Fixes findings B1 and B4 of `docs/audits/2026-10-08-brownfield-subtrack-coverage.md`.

## B1 — sub-track checklists in S9

`SUB_TRACK_DD_CHECKLISTS` (`lib/library.ts`) maps the current `route_decision.sub_track` to extra checklists on top of the seven shared DD domains:

| sub_track | extra S9 checklists |
|---|---|
| m_and_a | brownfield-feasibility (six validators), ma-special-topics |
| jv, partnership, minority_investment | partnership, deal-shape-presigning |
| rbd (legacy existing_business_rbd) | rbd-technology |
| strategic_investment, corporate_venture | none |

`ddCompletionSummary` (the single source for the S9 predicate) counts every unjudged item of these checklists as `unassessed`, fails on mandatory unmet items, and treats a mandatory non-waivable item (bf-01 six validators, bf-02, bf-03) as unmet when set to `na` or `waived`, because a missing validator is a binding Kill Criterion with no waiver path. The DD workspace view appends each extra checklist as a tab; judgments use the existing state route (no new API).

Grandfathering: projects whose earliest policy pin (else `created_at`) precedes `WAVE_F_PREDICATE_DATE` (2026-10-08) are unaffected. The date now lives in `lib/wave-f-date.ts` (re-exported by `process-flow.ts`) to avoid an import cycle. The demo seed judges the M&A extras so it still completes S12.

## B4 — origin derivation

`promoteOpportunity` defaults `md_project.origin` from the route sub_track when the caller supplies none: jv to joint; corporate_venture/intra_venture to internal; m_and_a/strategic_investment to external; minority_investment to hybrid; partnership, rbd and Greenfield stay null (no unambiguous mapping). An explicit origin always wins, so the human override is retained. The IC screen now treats a null origin as "establishment does not apply", matching the predicate.

No migration: `md_project.origin` is already nullable. No backfill: existing null-origin rows cannot be distinguished from deliberate choices, and backfilling would newly impose the establishment requirement on in-flight projects.

## Out of scope
B2, B3, B5-B8 remain open per the audit. The ADR for checklist applicability (policy) is still owed by process-governance-manager.
