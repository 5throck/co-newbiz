# ADR-0122: Round-2 review outcomes — process intelligence, data trust, and portfolio oversight surfaces

- Status: Accepted
- Date: 2026-09-12
- Deciders: New Business Review Lead (PM)
- Deciders note: the second all-agent design review (53-screen v4) shifted the redesign from "complete the surfaces" (round 1 → v3) to "make the process manageable and the data trustworthy". Every item below was flagged by a named agent and accepted for the v5 development baseline.
- Related: ADR-0119 (action hierarchy), ADR-0120 (deal-centric IA), ADR-0121 (primitives), ADR-0074 (process SSOT), ADR-0104 (SLA input), docs/designs/2026-09-12-implementation-matrix.md (v5 baseline tracking)

## Decision

1. **Stage SLA timeline** (process-governance-manager): every deal gets a plan-vs-actual timeline per stage with an admin-managed `stage_sla` policy (target days per stage). Elapsed/overdue is computed, never stored; SLA breach raises a warning and the breaching stage is highlighted as a bottleneck.
2. **Deal risk heatmap** (risk-officer): DD findings, covenant headroom, incentive clawback, and customer concentration aggregate into one likelihood × impact grid per deal, with a risk ledger; snapshots auto-attach to the IC package and quarterly briefings.
3. **Data trust overlay** (market-intelligence, quant-methodologist, valuation-agent): all figures may carry standardized overlays — staleness badges (data as-of age), confidence intervals (e.g., proxy elasticity 90% CI), and simulation convergence warnings. Overlays are presentation standards (design-system gallery of record), not stored duplicates.
4. **Portfolio view + resource calendar** (group-review-agent): cross-deal detection of duplicate exposure (same KSIC), resource contention (same lead, overlapping S8–S11), and an investment-concentration check; a lead/review resource calendar surfaces scheduling contention. Group IC judgment stays human.
5. **Onboarding standard** (ux-designer-agent): empty workspaces show a 4-step wizard (S1 market analysis → S2 opportunity → S3 synergy/selection → S4 route); all list screens implement the empty-state and zero-result guidance standard (one sentence + one next action).
6. **Collaboration annotations** (PM): screen elements accept reviewer↔author comment threads (`deal_comment`, append-only) so design and deliberation feedback lives on the surface it refers to.
7. **Audit immutability visibility + pagination** (compliance-officer, sre, dba): the audit log displays append-only/hash-verified status, CSV export, and standard pagination for large tables — a screen-wide standard.
8. **Scenario snapshot comparison** (financial-analyst): S8 assumption sets (growth, margin, WACC) can be stored as named snapshots and compared side by side; assumption-conflict detection (growth↑ with margin↓) warns.

## Consequences

- v5 baseline (frozen 2026-09-12) includes these surfaces; development targets them (construction plan Waves 2–3).
- New persistence per data contract: `deal_comment`, `stage_sla`; everything else is computed from existing tables.

## Alternatives rejected

- Storing SLA overdue state: violates the derived-state principle (ADR-0074) — always computed from policy + timestamps.
- Free-form-only gate rationales: rejected in favor of structured minimal-evidence chips (tracked separately with the round-3 layer) after compliance review.
