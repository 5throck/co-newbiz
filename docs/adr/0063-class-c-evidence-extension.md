# ADR-0063: Class C evidence-plane extension — PMI, deal-shape, incentive-deadline vars

**Status**: Accepted (2026-08-24)
**Deciders**: data-architect (design), process-governance-manager (governance); thresholds of record pre-approved by the user in `docs/decisions/2026-08-24-class-c-decisions.md`

## Context

ADR-0060 §3 requires registry extension to proceed one lifecycle dimension at a time, each with its own ADR, filler work, migration seeds, and tests. The Class C decision record decided the THRESHOLD halves of entries #4/#14/#28/#29 but left their VAR halves blocked on schema that did not exist: no table tracked key-talent roster/departures, synergy certifications, P3 deal-shape evaluations, or per-project incentive deadlines. This ADR is that recorded decision for all four at once — they share one shape (small state/count vars over new PMI/deal-shape tables) and one anchor (`gd-0024-class-c-decisions`).

## Decision

Migration 0026 adds four tables and four computed vars; snapshot-filler gains families filling them; entries #4/#14/#28/#29 arm under `gd-0024-class-c-decisions`. Baseline executable count rises 4→8.

| Criterion | Var | Source table | Missing (= UNASSESSED) when |
|---|---|---|---|
| #28 attrition ≥10% escalate | `pmi.key_talent_attrition_90d` ratio | `pmi_key_talent` | roster empty (close-locked list not yet filed) |
| #29 uncertified halt | `pmi.synergy_run_rate_certified` ('certified'/'not_certified') | `pmi_synergy_certification` (+roster as close marker) | no roster AND no certification row |
| #14 zero-viable recycle | `dealshape.viable_shapes` count | `deal_shape_evaluation` | no P3 evaluations recorded |
| #4 deadline escalation | `permit.critical_path_exceeds_incentive_deadline` 'yes'/'no' | `project_incentive_deadline` × permit DAG | either side unmeasured |

Design rules carried through:

- **PII**: key-talent rows are role references only (`role_ref GLOB` rejects name-shaped values), mirroring management_package's convention; the numerator counts `departed_regretted` exits within 90 days of each row's own `locked_at`.
- **Certification rule verbatim from the record**: certified = `run_rate_bp >= 9000` AND `sustained_quarters >= 2`; a closed deal with no certification row is determinately `'not_certified'` — the halt condition stated plainly, never defaulted to pass.
- **Time-relative var discipline (#4)**: months-remaining shrinks daily by nature, so `observed_at` pins the fill moment; run immutability preserves what a gate was evaluated against.
- **No procedure YAML changed**; registry JSONs are the executable layer (the ADR-0057 pattern).

## Consequences

- Baseline `_baseline.json` 4→8 lands with the predicates it counts (same change).
- The evaluator, ledger, and reader are untouched — pure registry state plus filler extension.
- `project_policy_pin`: prospective, as with every activation — runs evaluate under the registry state at evaluation time.
- What this does NOT do: no RAG rules over the new vars; no UI surface yet (admin/console views are follow-ups); the calibration corpus remains the outstanding Green-cap-lift gate.

## Cross-references

Class C record · ADR-0060 §3 rows 4/14/28/29 · ADR-0062 (the antitrust precedent for this round's mechanics) · migration 0026
