---
lang: en
counterpart: raci_ko.md
---

# RACI — Stage Gate Review Process

**Owner**: process-governance-manager
**Design of record**: design v1.0 §2-3 / `docs/governance/process-map.md`
**Legend**: R = Responsible (does the work) · A = Accountable (owns the decision, one per row) · C = Consulted · I = Informed

## Gate-Level RACI

| Gate | Analyst | Entity IC | Group IC | process-governance-manager | compliance-officer | legal-counsel | risk-officer |
|---|---|---|---|---|---|---|---|
| Screening | R | I | — | C | I | C (permit path) | C (Kill Criteria pre-check) |
| Pre-FS | R | I | — | C | I | C | C |
| FS | R | I | — | C | C (checklist completeness) | C | C |
| DD | R | I | — | I | C | R (legal-risk register) | C |
| Entity IC | R (memo prep) | A | I | I | C | C | C (Kill Criteria check) |
| Group IC | C (support) | R (ranking input) | A | I | I | I | C |

## Domain-Lead RACI (Cross-Cutting)

| Activity | process-governance-manager | platform-lead | industry-lead | region-lead | PM |
|---|---|---|---|---|---|
| Procedure amendment | R | C | C | C | A |
| RAG rule/threshold change | R | C | — | — | A |
| System schema change | C | R | — | — | A |
| Region profile update | C | I | — | R | A |
| Industry profile update | C | I | R | — | A |
| ADR authorship | C | C | C | C | A |

## Governance-Operations RACI

| Activity | compliance-officer | process-governance-manager | Domain lead (as applicable) |
|---|---|---|---|
| Compliance monitoring | R | I | I |
| Waiver approval — regulation layer | C | C | A = Group IC (not shown, external to this table) |
| Waiver approval — procedure layer | C | A | I |
| Waiver approval — checklist item | I | C | A |
| Interpretation response | C | C | A (the `owner_agent` of the document in question) |
| Governance KPI reporting | R | A | I |

## Notes

- **Entity IC is Accountable for its own gate, not merely Consulted** — this is the operational meaning of "each entity has structurally different questions from the group" (design §2-3). Entity IC cannot be bypassed even when the group is eager to review.
- **Group IC's Accountable role is a ranking decision more often than a yes/no** (ADR-0029) — its "R" for `group_agenda` ranking input actually sits with each competing entity, since the entities produce the comparable inputs the ranking is computed from.
- A gate with no Entity/Group IC row entry (Screening through DD) has no Accountable party outside the analyst/domain structure by design — these are working-level gates, not decision gates; the first decision gate is Entity IC.
- This table is referenced, not duplicated, from `docs/governance/process-map.md` and `docs/manuals/business-manual.md` — a second copy would drift.
