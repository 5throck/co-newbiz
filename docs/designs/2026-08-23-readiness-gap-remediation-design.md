---
lang: ko
lang_reason: source-material
---

# Design: Readiness-Gap Remediation (audit R1–R6 dispositions)

> Design of record for the remediation slice approved 2026-08-23 (user-approved scope: docs + deliverable-template implementation; E.4 full chain and the procedure-execution orchestrator excluded — audit residuals R8/R9, class D).
>
> Inputs: [`docs/audits/2026-08-23-readiness-audit.md`](../audits/2026-08-23-readiness-audit.md) (residual register R1–R10) and [`docs/research/readiness-gap-best-practice.md`](../research/readiness-gap-best-practice.md) (7 fetched sources + prior committed research). This document turns those findings into decisions; ADR-0059 carries the schema decision.

## 1. Deliverable templates — selection criteria and list (R1)

`templates/deliverables/` currently covers 1 of 59 output types (`ic-memo`). Templating all 59 is explicitly rejected — most output types are intermediate analytical artifacts whose format the owning skill already defines (boundary #3); a template layer over them would duplicate skill content and drift.

**Selection criteria** (from research Area 2 — GAO evidence discipline, stage-gate decision vocabulary, IC-memo house conventions):

| # | Criterion | Why |
|---|---|---|
| T1 | Produced at a **human-authority step**, or consumed by one in the same sitting | The template's job is to make the signature surface auditable (GAO: credibility, objectivity, reliability, usefulness) |
| T2 | **Audit-evidence character** — completeness facts, kill-criteria results, decision vocabularies | These are the records a later review reconstructs the deal from |
| T3 | **Recurring production** — every gate, every review cycle, or every deal of its shape | One-off analytical outputs don't amortize a template |
| T4 | Skill does **not** already own the format | No double-ownership (boundary #3) |

**Selected set (7 templates, PR-3)** — one per output type, header naming the key:

| Template | output_type | Criteria | Producing step |
|---|---|---|---|
| `gate-pass-record-template.md` | `gate_pass_record` | T1/T2/T3 | every gate (13 procedures reference stage-gate-governance) |
| `jv-health-scorecard-template.md` | `jv_health_scorecard` | T2/T3 | jv-lifecycle-governance#2 |
| `portfolio-scorecard-rollup-template.md` | `portfolio_scorecard_rollup` | T1/T2/T3 | portfolio-venture-monitoring#1 |
| `venture-transition-evidence-template.md` | `venture_transition_evidence` | T2 | portfolio-venture-monitoring#2 |
| `venture-transition-decision-template.md` | `venture_transition_decision` | T1/T2 | portfolio-venture-monitoring#3 (HUMAN) |
| `bau-exit-evidence-pack-template.md` | `bau_exit_evidence_pack` | T2 | pmi-integration-execution#4 |
| `partner-dd-report-template.md` | `partner_dd_report` | T3/T4 | deal-shape-chain#2 |

Shared conventions (all templates): GAO four-characteristics evidence block (source named / verifiable / reviewer independence where applicable / usefulness statement); closed decision vocabulary as enum fields, never free text where a vocabulary exists (Go/Kill/Hold/Recycle; the 5-value venture vocabulary; the 3-value BAU vocabulary); kill-criteria results as the 3-number record (declared/applicable/completed) with `never_evaluated` explicit; ILLUSTRATIVE markers where a threshold is pending an open question. Deliberately NOT templated this round: `entity_ic_decision`/`group_ic_decision` (the IC memo + two-tier-approval-chain tooling already own those surfaces), `jv_restructuring_decision`/`jv_exit_execution` (rare, legal-counsel-owned — revisit on demand).

## 2. Venture/JV scorecard storage (R3) — ADR-0059

ADR-0052 open question (e) asked whether portfolio-monitoring scorecards need a schema addition. **Answer: yes** — decided in [ADR-0059](../adr/0059-venture-scorecard-storage-schema.md) (design-stage; the migration, monitoring script, and portfolio view remain the deferred E.4 chain). Research-derived shape requirements folded into the ADR:

- `venture_class` discriminator (driving / enabling / emergent / passive / jv — the CVC four-type taxonomy mapped onto our cells) so rollups report by class instead of flattening.
- Per-measure `target_value` **required** (balanced-scorecard discipline: a measure without a target is invalid, not merely discouraged — enforced by CHECK with the single `insufficient_evidence` escape).
- Run-scoped, review-cycle time-series (trend-and-trigger governance use, ADR-0005 reproducibility) — never latest-value-only.
- Measure-set size discipline (~20 per scorecard) enforced by validator/procedure, not SQL.
- Weights are **policy, not storage** — excluded until open question (b) resolves; when it does, weights enter via the governance-doc reference pattern, not a column.
- Transition/tranche decisions are approval-chain records, not scorecard rows — `venture_transition_decision` stays in the existing decision-tooling lineage.

## 3. §F residuals verdict (R4) — keep the routing, upgrade the protocols

Research Area 3 (reference-class forecasting; SHELF/Stanford-SRI elicitation protocols) re-evaluated the two prose-wired skills. **The PR-12d routing decision stands in both cases** — no shipped step's skill is displaced; displacing the market-sizing step or brownfield-dd step 4 would change shipped behavior for zero coverage gain. What the research adds is protocol content, landed as skill upgrades (PR-3):

- **`proxy-industry-chain` 1.0.0 → 1.1.0**: the proxy chain is a reference class in disguise — the protocol section gains the reference-class discipline: record the reference class used, its base rate/outcome distribution, the dispersion, and the adjustment rationale, as named inputs feeding `distributional_valuation` (which already consumes chain confidence). No new step, no procedure change.
- **`expert-interview` 1.0.0 → 1.1.0**: the gap is structure, not routing. Protocol upgraded to structured elicitation: question framing before the interview; probability vocabulary pinned (no unpinned "likely"); calibration check; multi-expert aggregation with uncertainty recorded; R&BD validation-evidence rows (rbd checklist) gain the protocol reference. No procedure change.

## 4. Kill-criteria executability roadmap (R5)

29 declared / 2 executable is a registry-discipline success (ADR-0057/0058) but a coverage gap. Research Area 4 (DMN decision tables; GAO evidence sufficiency) confirms the architecture — machine-checkable rules over evidenced inputs — so the roadmap is classification, not re-architecture:

1. **Classify all 29** by expression readiness: (i) evidence var already in the migration-0014 registry **and** threshold decided → expressible now; (ii) var exists, threshold pending open questions (a)–(d) → stays inert with its open-question pointer; (iii) needs a new routing/evidence var → requires a registry extension decision (design change, not silent).
2. **Express class (i) in the predicate AST** in a follow-up implementation PR (this round is design-only; the 2-executable baseline is the floor and `_validate --strict` already fails on regression below it).
3. **Borrow DMN's decision-table hit-policy vocabulary** for multi-condition criteria in the registry's prose fields (documentation aid only — adopting a DMN runtime is not proposed).
4. Thresholds themselves remain class C (blocked on the thresholds meeting + calibration corpus) — executability without decided thresholds is exactly the `enabled=0` anti-pattern the design already forbids.

## 5. D.5 Korea co-funding flag (R6)

TIPS program mechanics and KONEX/KOSDAQ technology-special listing content remain **verification-pending** (arrived without primary-source verification; ADR-0052 carries the same flag). Re-verification paths: Z.ai search quota returns 2026-09-01 (supplement pass), or user-provided primary sources (TIPS 운영기관 공고, KRX listing rules). Nothing in any procedure, checklist, or this design depends on the flagged content; no action is gated on it.

## 6. What this design does NOT do

- No procedure, step, checklist, or DB change (ADR-0059 is decision + DDL sketch only; the migration lands with the E.4 round it unblocks).
- No template for output types outside the §1 selection.
- No threshold decisions (class C stays with the user).
- No E.4 script/view, no procedure-execution orchestrator (class D).

## 7. Landing sequence

| Slice | Contents | Status |
|---|---|---|
| PR-1 | Audit report, research addendum, ADR-0052 sync, agents README | Landed (#99) |
| PR-2 (this change) | This design + ADR-0059 + ADR README/CHANGELOG | — |
| PR-3 | 7 templates (§1) + 2 skill protocol upgrades (§3) | next |
