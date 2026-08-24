# ADR-0064: Kill-criteria extension round 2 — finance-source, certification-trio, completeness-count, and asserted-fact vars

**Status**: Accepted (2026-08-24)
**Deciders**: data-architect (design), process-governance-manager (governance); thresholds per ADR-0060 rows 5–10/17/19 wording plus `gd-0024-class-c-decisions` governance discipline

## Context

After ADR-0063 armed #4/#14/#28/#29, eight registry entries remained var-blocked while their thresholds were already decided by their own wording: #5/#6 (WACC/hurdle still assumed), #7/#8 (load-bearing certification transferability unconfirmed), #9 (transferability computed by inference), #10 (any applicable six-validator missing at DD exit), #17 (employment-transfer consent regime undetermined), #19 (origin classification missing at entity-IC exit). Unlike the PMI round, every one of these reads a source that ALREADY exists — no DDL.

## Decision

Migration 0027 seeds six vars (no tables); snapshot-filler families fill them; the eight entries arm under `gd-0024-class-c-decisions`. Baseline executable count rises 8→16.

| Entry | Var | Source | Semantics |
|---|---|---|---|
| #5/#6 halt | `fin.wacc_source_status` ('sourced'/'assumed') | run-scoped `assumption` rows, keys 'wacc'+'hurdle_irr' | any 'assumed' ⇒ assumed; both keys absent ⇒ missing (not sessioned) |
| #7/#8 escalate | `cert.load_bearing_unconfirmed` count | `certification` (load_bearing=1 AND basis IS NULL) | present-always count |
| #9 escalate | `cert.transferability_inferred_count` count | same table, basis='inferred' | nonzero PROVES a raw-SQL bypass of the repository write-block — the tripwire's whole point |
| #10 halt | `validators.applicable_missing` count | validator-completeness engine's own halt set | live not_applicable rows never count |
| #17 escalate | `legal.employment_transfer_consent_regime_determined` ('determined'/'not_determined') | ASSERTED via dimension_input (reviewed-only) | a human jurisdictional fact — assertion with review, never derived |
| #19 escalate | `classification.origin_live_missing` count | live `project_case_classification` rows (superseded excluded) | COMPUTED count deliberately avoids the is_null-over-routing-var trap ADR-0060 flagged for row 19 |

## Consequences

- Baseline 8→16 lands with the predicates it counts; registry coverage is now 16 of 29 — every entry whose evidence plane exists is armed. The remaining 13 need genuinely new evidence sources (QoE module, longlist storage, breach-event schema, growth-decile anchoring) or stay meta/procedural by design.
- **Behavioral change, in the intended direction**: any brownfield-dd evaluation on an uncovered project now triggers the six-validator halt (#10) alongside whatever else fires — that IS policy bf-01/policy §2.3 expressed at the gate-flow layer. Tests updated accordingly.
- **#19 resolved its recorded engine-domain gap** without touching routing-var snapshotting: the trap (is_null over a never-snapshotted var = always TRUE) is structurally avoided because the var is a computed count over the classification table itself.
- The asserted legal var requires the reviewed dimension-input path — an unreviewed assertion fills nothing (Family C contract), so the tripwire stays UNASSESSED until a second pair of eyes signs the fact.
- No procedure YAML changed; prospective policy-pin semantics as with every activation.

## Cross-references

ADR-0060 §3 rows 5–10/17/19 · ADR-0063 (round mechanics precedent) · migration 0027 · `docs/decisions/2026-08-24-class-c-decisions.md`
