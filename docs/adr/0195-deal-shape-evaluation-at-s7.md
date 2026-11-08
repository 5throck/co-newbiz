# ADR-0195: Deal-shape evaluation moves to the end of S7 (brownfield-only kill criterion #9)

**Status**: Accepted (owner decision in chat, 2026-11-08; risk-officer ruling §R-1..R-5 and process-governance ruling in docs/designs/2026-11-08-deal-shape-to-s7-design.md)
**Date**: 2026-11-08
**Deciders**: Owner (decision); risk-officer (kill-criteria authority); drafted by process-governance-manager
**Related**: ADR-0020, ADR-0053, ADR-0074 (flow.spec SSOT), ADR-0187 P2 (M2), ADR-0193 (amended), ADR-0194 (amended), design `2026-11-08-deal-shape-to-s7-design`

## Context

The `deal-shape-evaluation` activity sits at S4 and hosts `brownfield-pre-fs` step 2, and kill criterion #9
(`deal-shape-chain:no_viable_deal_shape`) is evaluated at the opportunity `pre_fs` gate. That placement is wrong:
whether any deal shape (acquisition, JV, minority stake, partnership, ...) is viable depends on who the targets
are. Before S6/S7 there is no long list, let alone a short list, so an S4 verdict is a judgement about shapes in
the abstract. The short list must come first; the deal-shape judgement follows it.

## Decision

1. **Activity placement.** `deal-shape-evaluation` moves from S4 to the end of S7, after the short list is ranked,
   as a new **`brownfield-target-screening` step 3.5** (procedure v1.1.0).
2. **Pre-FS trim.** `brownfield-pre-fs` step 2 is reduced to a deal-structure intent note (procedure v1.6.0). The
   binding structure is owned by S10 deal-structuring; S4 records intent only.
3. **S4 listing kept.** `deal-shape-chain` stays listed on the S4 `route-strategy` / `route-advisory` activities
   as context for the route decision; it carries no kill evaluation there.
4. **Kill criterion #9.** `evaluable_from: S7`, `reevaluate_at: target_screening`. The kill-criteria registry gains
   a per-criterion `track` field (`track: brownfield` on #9), read through `criterionTrack()`. Track scoping is per
   criterion, never per procedure (risk-officer R-1).
5. **#10 / #11 unchanged in track.** They stay track-neutral with `evaluable_from: S8`, `reevaluate_at: fs`.
6. **Gate snapshot.** `OPPORTUNITY_PROCEDURES.target_screening` gains `deal-shape-chain`.
7. **flow.spec.** The gate registry drift found during the review is fixed in the same change (recorded spec change
   per ADR-0074).
8. **Write guard.** Deal-shape writes are rejected before S7 and for non-brownfield opportunities.
9. **UI.** The deal-shape panel moves to the S7 screen; S4 keeps a read-only pointer to it.

The verdict on #9 remains the human gate's; its action stays `mark_conditional` (ADR-0053).

## Consequences

- **One-time listing.** Brownfield opportunities already past `target_screening` that hold only a `pre_fs` #9
  acknowledgement are listed once, read-only, for human review. Recorded gate decisions are not rewritten.
- **Greenfield.** Carries of #9 on greenfield opportunities close `out_of_track` (with the route decision id) via
  the `track` field.
- **Enforce guard.** `carriedWithoutDataSource()` stays empty after the move; `kill_binding=enforce` still needs the
  separate owner confirmation recorded in ADR-0194.
- Implementation (code, flow.spec, procedures, registry JSON, tests, generators) is a separate dispatch per design §3-§7.

## Alternatives considered

- **S6 (long list).** Rejected: the long list is unranked and too wide; a shape verdict there repeats the S4 problem
  at smaller scale.
- **S8 (feasibility).** Rejected: S8 is project-scoped while the ADR-0194 item A source
  (`opportunity_deal_shape_evaluation`) is opportunity-scoped; it would need a lineage read and an enforce-guard
  extension (R-5), and it lets non-viable shapes consume FS effort.
- **S9 (DD).** Rejected: same scope mismatch as S8, and the latest point; DD cost is spent before a shape-level kill
  signal can surface.
