---
governance_doc_id: tpl-bau-exit-evidence-pack
layer: template
title: "PMI BAU-Exit Evidence Pack Template"
scope: shared
enforceability: recommended
owner_agent: docs-writer
version: "1.0.0"
effective_from: "2026-08-23"
output_type: bau_exit_evidence_pack
lang: en
counterpart: bau-exit-evidence-pack-template_ko.md
---

<!--
  output_type: bau_exit_evidence_pack — "PMI — the BAU-exit precondition
  evidence presented for Finance certification (ADR-0052 §B)". Produced by
  pmi-integration-execution step 4 (pmi-agent / pmi-planning), consumed by
  the HUMAN step-5 certification (bau-exit-certifier — decision vocabulary
  demobilization_approved | held_pending_certification |
  conditional_with_named_gaps; that decision is a separate output_type).
   An uncertified synergy run-rate HALTS the handover (kill-criteria
   registry: synergy_run_rate_uncertified_at_bau_handover — halt).
   Certification criteria are DECIDED: docs/decisions/2026-08-24-class-c-decisions.md
   (c) — certified = >=90% of committed COST-synergy run-rate in annualized
   P&L actuals vs the baseline locked at close, sustained 2 consecutive
   quarters (or 3 monthly closes), CFO-signed with owner countersignatures;
   revenue synergies annexed; baseline changes post-close need CFO approval +
   disclosure. The 90-day attrition bands from the same record: >=10%
   escalation / >=15% steering intervention / >=20% failure classification.
-->

# [Project Name] — BAU-Exit Evidence Pack

**Run ID**: [run_id] · **Project**: [project_id] · **Review point**: [as_of] · **IMO**: [integration management office] · **Policy version**: [project_policy_pin]

## 1. Synergy run-rate evidence (the completeness fact Finance certifies)

| Synergy item (from the staged targets) | Promised | Actual run-rate | Months sustained (need 2 consecutive quarters) | Certification status | Evidence (ADR-0058 ref) |
|---|---|---|---|---|---|
| [synergy item] | [target] | [actual] | [months] | certified / NOT certified vs the >=90% + 2Q rule | [ref] |

**Any row uncertified** → the handover is halted; state it plainly here rather than softening: [statement]

## 2. First-100-days carry-over (from the hundred_day_review)

- Promised-vs-actual synergy at 30/60/90: [refs to the hundred-day record]
- Key-talent attrition vs. threshold: [measured regretted attrition % at 90d] against the decided bands (>=10% escalation / >=15% steering / >=20% failure) — escalation-to-risk-officer status: [status]
- Pivotal decisions outstanding: [list or "none"]

## 3. Demobilization readiness

| Precondition | Status | Evidence |
|---|---|---|
| Integration thesis complete-or-closed | [status] | [ref] |
| IMO charter obligations closed | [status] | [ref] |
| Clean-team protocols terminated (gun-jumping exposure closed) | [status] | [ref] |
| Control handover (finance/HR/IT/legal) accepted by BAU owners | [status] | [ref] |
| Day-1 continuity items all resolved or owned | [status] | [ref] |

## 4. Named gaps (what this pack could NOT establish)

[gaps stated explicitly — the certifier's conditional_with_named_gaps option exists precisely for this list; an empty gap section must be earned, not assumed]

## Sign-off

| Role | Key | Surface |
|---|---|---|
| Recorder — pmi-agent | [key] | [checked scope] |
| Presented to | bau-exit-certifier (human registry) — decision recorded separately as bau_exit_decision | — |
