---
lang: en
counterpart: governance-operations_ko.md
---

# Governance Operations

**Owner**: compliance-officer
**Design of record**: [design v1.0 §6.6](https://github.com/5throck/ai-workspace-standards/blob/main/docs/designs/2026-08-19-co-newbiz-design_ko.md)

> Authoring a policy is half of governance. This document is the other half: the standing operation of running the rules the team writes — compliance monitoring, waivers, the interpretation registry, and governance KPIs. Without this, the regulation book is a document nobody enforces.

## 1. Compliance Monitoring

At every stage gate, `compliance-officer` checks:

- All required deliverables for the gate are present (per `procedures/*/schema.yaml` `steps[].output_type`).
- All mandatory checklist items are complete (checklists are Stage 2.4 — see `checklists/`).
- A gate is **blocked** if either check fails **and there is no active waiver** covering the specific gap.

This is a system-enforced check, not a discretionary review — see `procedures/_validate.ts` and the future `compliance_check` schema (design §6.6, Stage 4).

## 2. Waivers

A waiver is the explicit, logged exception path — its absence is what pushes non-compliance underground.

| Rule | Detail |
|---|---|
| **Mandatory expiry** | Every waiver has an expiry date. An indefinite waiver is a de facto policy repeal and is not permitted. |
| **Approval authority** | Regulation-layer waiver → Group IC. Procedure-layer waiver → `process-governance-manager`. Checklist-item waiver → the relevant domain lead. |
| **No waiver for completeness checks** | The six-validator Brown Field cross-check (design §8.9-1(f)) has no waiver path — it is a completeness check, not a judgment call. |
| **Concentration monitoring** | If the same clause accumulates repeated waivers, that is the signal the regulation itself doesn't match reality — not evidence of repeated non-compliance. This is the primary input to amendment priority (§4 below), not a punitive metric. |

## 3. Interpretation Registry

When a question arises — "does this clause apply to our case?" — the answer is recorded, not re-derived from scratch next time and never contradicted by a later answer without an explicit supersession note.

- Requester: any agent or human reviewer.
- Responder: the `owner_agent` of the governance document in question (e.g., `legal-counsel` for a policy legal question, `process-governance-manager` for a procedure question).
- Published interpretations are discoverable via the glossary's MCP `lookup_term` integration where the question concerns a defined term.

## 4. Governance KPIs

| Metric | What it reveals |
|---|---|
| Gate cycle time (median, per gate) | Whether a procedure is a bottleneck |
| Gate rejection rate | Whether upstream quality is low, or the bar is miscalibrated |
| Checklist completion rate | Whether gates are passing on formality rather than substance |
| **Waiver volume and concentration by clause** | Which regulation clauses don't match reality — drives amendment priority |
| Rework rate | Which stage sends work backward most often |
| Interpretation query volume and topic | Which clauses are ambiguous |

**Waiver concentration and interpretation-query topics are the primary inputs to the next regulation amendment cycle** — amendment priority is set from this data, not from intuition (design §6.6).

### 4.1 Gate-integrity KPIs (ADR-0186)

Operated by `compliance-officer`; definitions owned by `process-governance-manager`. Period is calendar week for operation and rolling 4 weeks for trend; review cadence is weekly during shadow and the first four weeks after any family flips to enforce, monthly afterwards. "LI" marks a **leading indicator for flipping a family to enforce**. Table and column names follow design `2026-10-26-gate-integrity-design.md` section 6 and the audit event names in section 11; where the shipped column differs, the shipped schema wins and this table is corrected through a recorded decision. The Source column below was corrected on 2026-10-27 to the shipped schema read by `app/web-next/lib/gate-integrity-kpis.ts`; recorded in [DEC-20261027-02](../decisions/DEC-20261027-02.md), as this section requires. The KPIs are served by `GET /api/admin/gate-integrity/kpis` (admin only; `compliance-officer` reads them through an admin session).

| # | KPI | Exact definition | Source | Breach and action |
|---|---|---|---|---|
| G1 | GO/HOLD/KILL mix | Count and share of `gate_decision` rows by decision, per gate and period (latest effective decision per entity and gate; legacy rows reported separately). | `gate_decision.decision, gate, decided_at`; legacy = no `gate_decision_snapshot` row | A gate with GO share above 95 percent over 10 or more decisions, or a sudden mix shift of more than 30 points versus the prior 4 weeks: compliance-officer opens a calibration review with risk-officer. |
| G2 | AI-vs-human divergence rate | Decisions where `ai_recommended_decision` is set and differs from `decision`, divided by decisions with an AI recommendation. | `gate_decision.ai_recommended_decision, decision, ai_brief_id` | Rate above 40 percent or 0 percent over 10 or more decisions: review brief quality (risk-officer) or rubber-stamping (compliance-officer). Feeds the S1/S2 base-rate loop. |
| G3 | Divergence-reason presence (LI for `divergence`) | Divergent decisions with a non-empty `divergence_reason` passing the rationale profile, divided by divergent decisions. Target 100 percent in enforce; in shadow the shortfall equals `would_block:divergence_reason_required`. | `gate_decision.divergence_reason`; audit `gate_integrity.would_block:divergence_reason_required` | Any shortfall in shadow: fix UI/proposal flow before flipping `divergence`. |
| G4 | Acknowledgements per kind | Count of acknowledgement rows per `kind` (kill triggered, kill unassessed, RAG red, RAG absent, open non-waivable item, other) per gate and period. | `gate_decision_snapshot.acknowledgements_json` (kind per entry; there is no `gate_decision_acknowledgement` table) | Reason-substance rejections above 10 percent of acknowledgements, or one reason text reused across more than 5 decisions: acknowledgement fatigue; tune grouping, not the bar. |
| G5 | Unassessed kill-criteria share at GO (LI for `kill_binding`, `snapshot_ack`) | Unassessed criteria divided by applicable criteria in snapshots of GO decisions, per gate. | `gate_decision_snapshot` kill-criteria outcomes | Above 25 percent at any gate: route to risk-officer to supply evidence variables before enforcing `kill_binding`; a halt-class criterion that is unassessed everywhere is an activation defect. |
| G6 | would_block counts (shadow) (LI, all families) | Count of audit events `gate_integrity.would_block:<code>` per family and code, per week, reported as unreviewed. The explained/unexplained flag is a reviewer act recorded in the weekly review; it is not stored by the system. | `audit_log` (`appendAudit`) action prefix `gate_integrity.would_block:` | Any unexplained event blocks that family's flip; explained events must be tied to a fixture, a known legacy record, or a fixed defect. |
| G7 | Countersign latency and pending count | Median and p90 of `approval_chain.decided_at` (joined on `gate_decision_id`) minus `gate_decision.decided_at` for `entity_ic` and `group_ic`; plus count of decisions in `pending_countersign`. | `gate_decision.decided_at`, `approval_chain.decided_at` joined on `gate_decision_id`; audit `gate_decision.countersign` | Pending older than 5 business days, or p90 above 10 business days: escalate to the human role holders; a persistently single-holder role means O-1 is not met. |
| G8 | Open condition precedents and age | Open `condition_precedent` rows; age is now minus `created_at`; report count older than 30 days and any past its `clear_by` gate. | `condition_precedent.status, created_at, clear_by` | Any open over 30 days: owner role notified; any open at a `clear_by` gate that was reached: gate is blocked by design, raise to the IC reviewer. |
| G9 | Waiver count and age | Active, expired and expiring-within-14-days waivers; mean age of active waivers; concentration by clause (existing waiver KPI). | `waiver.approved_at, expires_at, clause_ref`; audit `waiver.approve` | Expired-but-relied-on waiver, or any active waiver above 90 days (should be impossible in enforce): defect to platform-lead; clause concentration feeds the amendment cycle. |
| G10 | `na` confirmation latency and backlog (LI for `waiver`) | Mandatory-item `na` rows without `na_confirmed_by`; median days from `na` entry to confirmation; legacy unconfirmed count. | `project_checklist_item_state.status='na', na_confirmed_by, na_confirmed_at` | Unconfirmed over 14 days: reminder to confirmers; legacy backlog must be reviewed (runbook precondition) before `waiver` flips. |
| G11 | WACC provisional share at S8+ (LI for `wacc`) | Projects at S8 or later whose WACC subject is unset or whose `wacc`/`hurdle_irr` assumptions are not `kind=user`, divided by all projects at S8 or later. | `md_project.wacc_subject`, assumptions `kind`, process stage | Any non-zero share at `fs` entry: quant-methodologist runs a WACC input session; the share must be zero or each exception explicitly accepted by the owner before `wacc` flips. |
| G12 | Would-block-free days (LI, all families) | Consecutive days with zero unexplained `would_block` events for the family, with at least N gate writes of that family's type observed (N set in the runbook). | derived from G6 plus gate-write volume | Counter resets on any unexplained event. |

Correction note (2026-10-27, shipped schema wins): G1 and G7 use `gate_decision.decided_at` (not `created_at`); G4 and G5 read `gate_decision_snapshot.acknowledgements_json`; G7 countersign effective time is `approval_chain.decided_at` joined on `gate_decision_id`; G6 returns every `would_block` event as unreviewed. Recorded in [DEC-20261027-02](../decisions/DEC-20261027-02.md).

## 5. Policy Change → System Reflection Pipeline

1. Amendment proposed (requires an ADR per the ADR trigger list — see `docs/adr/README.md`).
2. Impact analysis: identify affected `procedure`, `rag_rule`, `assumption`, checklist, and glossary term references.
3. Change plan drafted by `process-governance-manager`, approved by PM.
4. System reflection: procedure schema, `rag_rule`, checklists, glossary updated. No separate regeneration step is needed for the documentation surface — `/library` (ADR-0108) reads these originals live, so it reflects the change as soon as it's committed.
5. **Retroactivity decision**: in-flight projects stay on their `project_policy_pin` version unless the change is material enough to force an explicit re-evaluation, recorded as a `policy_change` decision — never applied silently.
6. Notification to affected project owners.

## 6. Cadence

See `docs/governance/ops-cadence.md` *(Stage 2 follow-up)* for the daily/weekly/monthly/quarterly rhythm this operation runs on. The monthly governance-KPI review and quarterly waiver/interpretation-driven amendment review are owned by `compliance-officer`.

## 7. Governance Document Layers (Reminder)

| Layer | Enforceability | Example |
|---|---|---|
| Policy | Mandatory | `policies/group/neb-policy.md` |
| Procedure | Mandatory | `procedures/_shared/brownfield-screening/` |
| Guideline | Recommended | `guidelines/*` |
| Checklist | Item-by-item (`mandatory: true\|false`) | `checklists/*` |
| Template | Recommended | `templates/deliverables/*` |

See design §6.1 for the layer table this document operationalizes.
