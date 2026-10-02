# ADR-0151 — Dedicated transition-record columns for venture_transition_decision (ADR-0150 criteria 3-5)

- Status: Accepted (2026-10-02, human reviewer in chat)
- Date: 2026-10-02
- Deciders: Human reviewer (accepted 2026-10-02). Drafted by process-governance-manager (Row 1 of the 2026-10-02 followup batch). AI review alone cannot accept this ADR.
- Design of record: `docs/designs/2026-10-02-followup-batch-design.md` (item 1)
- Related: ADR-0150 (S12 lifecycle completion criteria), ADR-0014 (migration rollback convention)

> Erratum (2026-10-02): the migration is 0121 (not 0080) — 0080..0120 were taken; semantics and the 2026-10-02 migration date are unchanged.

> **Accepted 2026-10-02 by the human reviewer in chat.** All previously open points are decided (recorded verbatim):
>
> 1. **Option A adopted**: three nullable columns `tranche_condition`, `core_handoff`, `divest_plan` on `venture_transition_decision`, added by migration 0080 following the reversible additive convention of 0071; Option B (single JSON `decision_record`) rejected — audit-ledger records must be queryable and DB-enforceable.
> 2. **No backfill**: historical rationale-only rows for criteria 3-5 transitions stay as-is; the strengthened S12 predicate requires the dedicated column only for decisions recorded from the migration date onward (predicate rule: decisions with `decided_at >=` migration date must carry the dedicated column for their transition; earlier rows grandfathered).
> 3. **Enforcement lives in the route + predicate layer** (per-decision CHECK-style enforcement, matching how `learning_capture` is route-required for kills today). Migration-level CHECK constraints on nullable columns with transition-conditional requirements are not expressible in SQLite, so this is stated as a Consequence below.
>
> These decisions are part of the Decision below, not open questions.

## Context

ADR-0150 (accepted 2026-10-02) defines six S12 completion criteria mapped to the five `venture_transition_decision` transitions. Criteria 3-5 require transition-specific records:

- Criterion 3 — a continue decision records the next tranche condition (`next_tranche_released`, `held_evidence_incomplete`).
- Criterion 4 — an expansion decision records the hand-off to core business (`graduate_to_core`).
- Criterion 5 — an exit decision records the divestment or wind-down plan (`reduce_or_divest`).

The ledger table (migration `0071_venture_transition_decision.sql:44-45`) has only `rationale TEXT NOT NULL CHECK (rationale <> '')` and `learning_capture TEXT` (criterion 6 only) — no dedicated columns for criteria 3-5. The S12 predicate (`PROJECT_STAGE_COMPLETION.S12` in `app/web-next/lib/process-flow.ts:597-601`) carries a recorded limitation comment: it accepts the criterion 3-5 records as "a non-empty rationale", weakening the accepted criteria.

## Decision (accepted 2026-10-02)

**Option A — three dedicated nullable columns** on `venture_transition_decision`, added by migration `0080_venture_transition_record_columns.sql` following the reversible additive convention of 0071 (`-- @reversible: true`, `ALTER TABLE ... ADD COLUMN`, no table rebuild, rollback via pre-migration backup restore per ADR-0014):

| Column | ADR-0150 criterion | Transition(s) |
|---|---|---|
| `tranche_condition` | 3 | `next_tranche_released`, `held_evidence_incomplete` |
| `core_handoff` | 4 | `graduate_to_core` |
| `divest_plan` | 5 | `reduce_or_divest` |

Each row uses at most one of the three columns; the kill path (`learning_capture`, criterion 6) is unchanged.

**Option B rejected** (single nullable `decision_record` JSON column): audit-ledger records must be queryable and DB-enforceable. A JSON blob hides incompleteness, is not queryable without JSON parsing, carries silent drift between code expectations and JSON shape, and fails the governance fail-closed-at-the-schema pattern already used by `rationale` / `learning_capture`.

**No backfill.** Historical rationale-only rows for criteria 3-5 transitions stay as-is. The strengthened S12 predicate requires the dedicated column only for decisions recorded from the migration date onward: decisions with `decided_at >=` the migration date must carry the dedicated column for their transition; earlier rows are grandfathered.

**Per-decision CHECK-style enforcement at the route/predicate layer**, matching how `learning_capture` is route-required for kills today. See Consequences for why this is not a migration-level constraint.

## Consequences

- **Predicate strengthening**: `PROJECT_STAGE_COMPLETION.S12` in `app/web-next/lib/process-flow.ts` replaces the limitation comment (lines 593-601). When the latest recorded decision is `next_tranche_released` or `held_evidence_incomplete`, require non-empty `tranche_condition` (only for `decided_at >=` migration date rows); `graduate_to_core` → `core_handoff`; `reduce_or_divest` → `divest_plan`; kill path unchanged (`learning_capture`). In-flight incomplete transitions surface as named blockers until recorded.
- **Route validation**: the decision-recording route validates the same per-decision requirement at write time, so the ledger receives complete rows going forward — the same pattern as the existing `rationale CHECK <> ''` plus route-level requirement.
- **No migration-level CHECK constraint**: transition-conditional requirements on nullable columns (`CHECK (decision NOT IN (...) OR tranche_condition IS NOT NULL)`) are not expressible in SQLite — SQLite CHECK expressions cannot reference other rows, and a plain per-column `CHECK` cannot be conditioned on the sibling `decision` value's transition vocabulary without encoding the vocabulary into DDL. Enforcement therefore lives in the route + predicate layer. Consequence: direct SQL inserts bypass the completeness requirement; the ledger's audit surface is the S12 predicate, not the schema.
- **No backfill**: queries must distinguish grandfathered rows. Per-column gap queries apply the date rule, e.g. `WHERE decision IN ('next_tranche_released','held_evidence_incomplete') AND decided_at >= :migration_date AND (tranche_condition IS NULL OR trim(tranche_condition) = '')` finds current criterion-3 gaps; the same shape applies to `core_handoff` / `graduate_to_core` and `divest_plan` / `reduce_or_divest`.

## Policy-impact note

- `project_policy_pin`: **0 live pins** as of 2026-10-02 (per ADR-0150's pin-scan record); re-verify at implementation before the switch. The immediate application of the strengthened predicate breaks no existing pin.
- `procedures/portfolio-venture-monitoring` (1.1.0): field references are updated **only if the column names change — they do not**; the procedure already names the three record fields in prose per ADR-0150. No procedure amendment required.

Implementation (migration 0080 + predicate + route validation) is owned by backend-engineer and follows in its own PR, only after this ADR's human acceptance (granted 2026-10-02).
