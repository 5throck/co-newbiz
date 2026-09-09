---
id: BRIEF-20260909-02
date: 2026-09-09
title: "Decision Brief — Open-questions triage: ADR-0051 (a)/(c) and ADR-0052 (a)–(e)"
status: proposed — decision requested from the project owner
owner: pm
context_refs: ["docs/adr/0051-brownfield-dd-kill-criteria-and-coverage-extension.md", "docs/adr/0052-track-coverage-extension.md"]
---

# Decision Brief — Open-Questions Triage (ADR-0051 a/c, ADR-0052 a–e)

All items below are blocked-on-user (the thresholds meeting never happened).
Each row carries a recommendation so the owner can decide in one pass; items
marked "adopt-recommended" can be approved in bulk.

## Triage table

| Ref | Question | Recommendation | Why now / what unblocks |
|---|---|---|---|
| 0051 (a) | Does legal DD join the six-validator no-waiver core? | **Keep the core at six — do NOT widen.** Legal DD gaps already halt via kill criteria and the DD gate; widening the core is a design-fixed-invariant change (needs a design revision, not an ADR patch) with no observed case in 4 pilots | The core is a completeness invariant; widening it raises DD-exit cost for every deal without a demonstrated failure case. Revisit only after a real legal-structural halt miss. |
| 0051 (c) | RTF 4–7% of EV, stay-bonus 12–24 months — policy or illustration? | **Adopt as DEFAULT POLICY ranges** (negotiable within, deviations recorded in the DD finding) | These are screening-grade heuristics for RTM cost estimation; hard ranges would over-specify. Defaults keep estimates consistent while preserving deal-specific judgment. |
| 0052 (a)–(d) | Deal-shape-chain kill-criteria predicates (currently null/inert ×3) | **Resolve (a)–(d) together with 0051(b) at the thresholds meeting** — the predicates are threshold-shaped (funnel conversion minimums, partnership screen cutoffs). Until then they stay declared-but-inert, which is honest and enforced (never_evaluated ≠ clearance) | The inert predicates are visible every run (WARN) but do not block; the chain's P1–P4 gates work regardless. Decision needed only when the deal-shape chain sees actual use. |
| 0052 (b) | JV scorecard weights/cadence | **Adopt the seven-dimension equal-weight default + annual cadence**, quarterly during the first post-close year | Matches the ADR-0052 §C.3 structure; equal weights are the honest pre-data default; cadence follows M&A integration practice (100-day density, then annual). |
| 0052 (e) | JV/portfolio scorecard STORAGE (blocks Section E's script) | **Approve the schema ADR implementation** — ADR-0059 already defined `venture_scorecard`; the deferred migration/script/view chain is the longest-lead item for portfolio monitoring | This is the only triage item that is engineering work, not a meeting. It unblocks cells 5/6/9 of the portfolio view. |
| rbd cutoffs | R&BD TRL/MRL per-gate cutoffs (ILLUSTRATIVE) | **Defer to the first R&BD-track deal** — cutoffs need technology-class specificity; a blanket decision now would be fiction | No R&BD-track deal has entered the pipeline; the checklist's ILLUSTRATIVE banner is honest. |

## Requested decision

1. **Bulk-approve** the "adopt-recommended" rows: 0051(c) defaults, 0052(b) equal-weight/annual, and the deferral of rbd cutoffs.
2. **Decide** 0051(a): keep the six-validator core (recommended) or commission the design revision to widen it.
3. **Schedule** the thresholds meeting for 0051(b) (see BRIEF-20260909-01) and 0052(a)–(d) — they resolve together.
4. **Go/no-go** on the 0052(e) implementation chain (schema migration → portfolio-monitoring script → portfolio view) — recommend GO; sized as one Wave-scale PR series.

Each approval converts into a `docs/decisions/DEC-YYYYMMDD-NN.md` record and the
corresponding checklist/procedure banner updates in the same change.
