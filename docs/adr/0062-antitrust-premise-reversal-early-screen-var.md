# ADR-0062: Reverse migration-0018 Decision 4 — antitrust enters the evidence plane as an early-screen var

**Status**: Accepted (2026-08-24 — user approval of the Class C pack, recorded in `docs/decisions/2026-08-24-class-c-decisions.md`)
**Date**: 2026-08-24
**Deciders**: user (decision authority), data-architect (design), process-governance-manager (governance)

## Context

Migration 0018 (Decision 4 / F19) excluded `antitrust_finding` from the evidence-var registry by premise: the table already feeds the `regulatory_permit` dimension, so a risk-dimension rule over it would double-count one finding across two dimensions. ADR-0060 row 13 therefore left `brownfield-screening__preliminary_hhi_flags_certain_block` premise-locked — reversal requires its own ADR, never a threshold decision riding another change.

Two things have since changed:

1. **The premise itself was reviewed against external practice** (`docs/research/residual-decisions-best-practice.md` §6): mature merger-control practice treats antitrust as an EARLY feasibility/risk-allocation screen at bid/LOI stage whose output is a risk grade + conditionality design — automatic kill is reserved for structural-presumption territory with no remedy path. The 2023 DOJ/FTC Merger Guidelines define the presumption zone numerically (post-merger HHI > 1,800 with delta > 100).
2. **The user reversed the premise on 2026-08-24** ("antitrust YES" in the Class C decisions), explicitly choosing early risk-layer screening over workstream-only treatment.

## Decision

Reverse migration-0018 Decision 4 for ONE narrow computed variable:

- **`antitrust.presumption_screens_triggered`** (number/count, computed, requires_evidence_ref=0): the count of `antitrust_finding` rows for the project where `hhi_after > 1800 AND (hhi_after − hhi_before) > 100` — the 2023-guidelines structural-presumption zone. Seeded by migration 0025; filled by a new snapshot-filler family (present only when the project has at least one antitrust_finding row — no rows means NOT YET SCREENED, honestly `missing` under ADR-0049, never a silent pass).
- **Kill-criteria entry #13 activates**: `brownfield-screening__preliminary_hhi_flags_certain_block` expressed as `count(antitrust.presumption_screens_triggered) gte 1`, action stays `escalate_to_risk_officer`, enabled under anchor `gd-0024-class-c-decisions`. A trigger routes to the human gate — it does not auto-kill.
- **Scope guard (the reversal is NARROW)**: exactly one var. The >30%-share screen is NOT seedable today (`antitrust_finding` has no market-share column); filing-timeline thresholds ($133.9M HSR-2026 / KFTC 300bn-30bn / EUR 5bn-250M) stay profile fields, never constants. Deep filing analysis remains in `regulatory_permit` — this var arms the SCREENING-stage tripwire only, and no RAG rule consumes it in this change.

## Consequences

- Baseline executable count rises 3→4 with the predicate it counts (same-change bump, strict gate).
- The double-counting concern is answered by scope: the var feeds NO rag_rule and NO risk-dimension grading — it exists solely for the kill-criteria tripwire, so `regulatory_permit` keeps exclusive claim on the finding for grading purposes. Any future attempt to grade over this var reopens this ADR.
- Threshold values (1,800 / 100) are index-adjusted by regulators over time: they live in THIS record and ADR-0060's row-13 notes, flagged for recalibration review when the guidelines update — never hardcoded outside the registry predicate.
- Registry entries #14/#28/#29 gain their THRESHOLD half from the same decision record but remain var-blocked (their extension rounds are separate changes per ADR-0060 §3 discipline).

## Cross-references

`docs/decisions/2026-08-24-class-c-decisions.md` (the approving record) · ADR-0060 §3 row 13 · migration 0018 header comment (premise of record being reversed) · migration 0025 (seeds) · `docs/research/residual-decisions-best-practice.md` §6 (external anchors)
