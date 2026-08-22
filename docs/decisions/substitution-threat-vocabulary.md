# Decision Record — `substitution_threat` Vocabulary Ratification

**Date**: 2026-08-23
**Status**: APPROVED (process-governance-manager as chair and vocabulary owner; PM-authored on the main loop during a subagent quota window — same quota note as risk-thresholds.md's PR-9 session)
**Ratifies**: the migration 0020 implementation proposal — `value_chain_link_constrained.substitution_threat` CHECK enum `('negligible','low','moderate','high','very_high')`.

## Context

Migration 0020 (D-M-MKT-2 rider) landed the `substitution_threat` CHECK as an **implementation proposal pending ratification**: a repo-wide scan (recorded in the migration header) found no established substitution-threat vocabulary anywhere in the workspace — no policy, procedure, checklist, or profile field defines one. The D-M-MKT-2 meeting had specified only "a five-member ordinal mirroring `switching_cost_grade`'s members," so the migration chose the mirror and flagged that the choice needed an explicit owner sign-off. Ratification owner: process-governance-manager (per rag-framework.md §5-1, as of this record's landing). No rule reads the column yet, so nothing downstream activates on the unratified vocabulary — the CHECK's only live effect to date is typo-rejection on writes.

## Decision

The five-member ordinal is **ratified as policy**:

`substitution_threat ∈ {negligible, low, moderate, high, very_high}` — NULL allowed.

Basis:

1. **The mirror is the defensible default.** Substitution threat and switching cost are two directions of the same lock-in economics (how easily a buyer leaves / how easily a substitute replaces the product). One ordinal for both keeps predicate conventions (`in`-clauses, grade comparisons) uniform and makes the two columns comparable in one scan.
2. **No competing internal vocabulary exists** (the 0020 scan), and no external standard prescribes a substitution-threat ordinal at this granularity — Porter-adjacent treatments describe the force qualitatively; operationalizing it borrows the adjacent column's scale.
3. **The load-bearing property is typo-safety, not member count.** The enum's job is that an `in`-predicate can never silently mismatch a free-text value (the exact failure mode the corrected market mapping warned about — rag-framework.md §5-1). Any five-member monotone ordinal delivers that; the mirror adds comparability for free.

**Dissent-space note**: a three-member scale (low/medium/high) was considered and rejected — it would diverge from `switching_cost_grade` for no operational gain, and "very_high" is exactly the grade a dominant-position target's substitution threat wants to express.

## Consequences

- The migration 0020 CHECK is no longer a proposal; it is the policy of record. Retiring the "pending ratification" riders in `docs/rag-framework.md` §5-1 and `docs/db-schema.md` (0020 note) lands in the same change.
- First consumer: a future `market` rule reading `substitution_threat` may cite this record as its vocabulary source.
- Recalibration: member-set changes are threshold decisions (market-thresholds.md owns the axis) and require the same record-update path as D-M-MKT-2 — not a migration-side edit.
