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
  Certification criteria and the 90-day attrition threshold are ADR-0052
  open question (c): where a threshold is pending, record the measurement
  and mark the threshold PENDING (c) — never invent one.
-->

# [Project Name] — BAU-Exit Evidence Pack

**Run ID**: [run_id] · **Project**: [project_id] · **Review point**: [as_of] · **IMO**: [integration management office] · **Policy version**: [project_policy_pin]

## 1. Synergy run-rate evidence (the completeness fact Finance certifies)

| Synergy item (from the staged targets) | Promised | Actual run-rate | Certification status | Evidence (ADR-0058 ref) |
|---|---|---|---|---|
| [synergy item] | [target] | [actual] | certified / NOT certified / PENDING (c) criteria | [ref] |

**Any row uncertified** → the handover is halted; state it plainly here rather than softening: [statement]

## 2. First-100-days carry-over (from the hundred_day_review)

- Promised-vs-actual synergy at 30/60/90: [refs to the hundred-day record]
- Key-talent attrition vs. threshold: [measured attrition] against [PENDING (c) threshold] — escalation-to-risk-officer status: [status]
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
