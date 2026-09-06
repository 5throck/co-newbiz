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
