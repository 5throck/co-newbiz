# Process Map — co-newbiz New Business Review

**Owner**: process-governance-manager
**Design of record**: [`docs/designs/2026-08-19-co-newbiz-design_ko.md`](https://github.com/5throck/ai-workspace-standards/blob/main/docs/designs/2026-08-19-co-newbiz-design_ko.md) section 6, refined by [Stage 1 meetings](../memory/meeting-2026-08-20-m1-process-skeleton.md) M1/M2/M6.

> **Do not confuse this with the product build Phase 0–6** (design section 4/10). This document maps the *business review process* the team's system implements. The product-build phases are how the team builds and ships that system; this map is what the system, once built, actually runs.

## Stage Gate Sequence

```
Screening → Pre-FS → FS → DD → Entity IC → Group IC
```

## Per-Gate Deliverables, Approvers, and RACI

| Gate | Deliverable | Blocking Condition (Kill Criteria candidate) | Approver | R | A | C | I |
|---|---|---|---|---|---|---|---|
| **Screening** | GF: market size + site shortlist. BF: target longlist + preliminary HHI screen. | GF: zero site candidate clears mandatory infrastructure minimums (wastewater capacity is the headline case — checked before power). | process-governance-manager | greenfield-agent / brownfield-agent | pm | industry-lead, region-lead | risk-officer |
| **Pre-FS** | GF: infra lead-time/cost estimate + incentive-NPV site comparison. BF: deal structure hypothesis. WACC/hurdle IRR confirmed `kind=user`. | WACC/hurdle IRR still `assumed` — FS cannot open with provisional discount rates. Certification transferability unconfirmed where load-bearing to a BF thesis. | process-governance-manager | valuation-agent, quant-methodologist | pm | certification-agent, legal-counsel | risk-officer |
| **FS** | GF: full capex schedule with permit critical path. BF: full valuation, six-way M&A cross-check *started*. | Growth projection outside top-decile base rate without risk-officer sign-off. | process-governance-manager | financial-analyst, market-intelligence-agent | pm | quant-methodologist | risk-officer |
| **DD** | Commercial + technical DD complete. BF: all six M&A validators' `dd_finding` records landed. | Any of the six BF validators (antitrust, customer-retention, incentive, hr-integration, certification, region-lead) missing at DD exit — **no waiver path**, this is a completeness check. | process-governance-manager | commercial-dd-agent, technical-dd-agent | pm | brownfield-agent | risk-officer |
| **Entity IC** | IC memo, RAG assessment (proposed by agents, confirmed by human reviewer). | `analysis_task.reviewed_by` NULL on any required deliverable. | Entity IC (human) | process-governance-manager | Entity IC | valuation-agent, risk-officer | group-review-agent |
| **Group IC** | `group_agenda` ranking entry. Requires completed Entity IC approval recorded in `approval_chain`. | Entity IC approval not yet recorded — Group-level procedures are unreachable, system-enforced. | Group IC (human) | group-review-agent | Group IC | process-governance-manager | pm |

## Green Field vs. Brown Field Divergence

| | Green Field | Brown Field |
|---|---|---|
| Primary risk axis | Infrastructure, permits, talent, community | Deal structure, contingent liabilities, six-way M&A cross-check |
| Screening-stage hard filter | Infrastructure minimums (wastewater before power) | Preliminary antitrust screen (rough HHI) |
| Unique mandatory validators | site-infrastructure-assessment, talent-pipeline-planning, community-partnership-planning | antitrust, customer-retention, incentive, hr-integration, certification-transferability, region-lead (labor) |
| Site/target comparison | Two-stage: hard pre-filter → weighted score (infra 30 / incentive-NPV 25 / logistics 15 / labor 15 / permit-critical-path 15%) | Deal structure hypothesis → valuation with sequenced special-topic linkage |

## Certification & Permit Tracks (Parallel, Not Merged)

Permits (`permit`/`permit_edge`) and certifications (`certification`/`certification_edge`) run as **separate DAGs with separate critical paths** — a permit lets you operate, a certification lets you sell. See [glossary: 선급](../glossary/industry.yaml) and design section 8.8-1.

## RACI Legend
R = Responsible (does the work), A = Accountable (owns the outcome, single name), C = Consulted (two-way input before decision), I = Informed (told after decision).

## Gate Procedures

Every gate in the sequence above now has a formal `procedures/_shared/*/schema.yaml` (closed 2026-08-20, informed by pilots 001-004's findings — see `docs/pilots/`):

| Gate | Green Field | Brown Field |
|---|---|---|
| Screening | `procedures/_shared/greenfield-screening/` | `procedures/_shared/brownfield-screening/` |
| Pre-FS | `procedures/_shared/greenfield-pre-fs/` | `procedures/_shared/brownfield-pre-fs/` |
| FS | `procedures/_shared/greenfield-fs/` | `procedures/_shared/brownfield-fs/` |
| DD | `procedures/_shared/greenfield-dd/` | `procedures/_shared/brownfield-dd/` (six-validator no-waiver completeness check, step 14; validators at steps 6-11 per ADR-0051) |
| Entity IC | `procedures/_shared/entity-ic-review/` (shared — same shape for both) | |
| Group IC | `procedures/_shared/group-investment-review/` (shared — same shape for both) | |

The Entity IC and Group IC decision models both carry a fourth state, `withdrawn_pending_resubmission`, added per `docs/pilots/pilot-003-doosan-bobcat-robotics.md` finding F-2 — a real case's withdraw-and-re-propose pattern that the original three-state (approved/rejected/conditional) model couldn't represent.

## Related
- `skills/stage-gate-governance/SKILL.md` *(not yet created — Stage 2.4)*
- `docs/stage-gates.md` *(this doc's companion — not yet created — Stage 2.4)*
- `docs/pilots/` — four real-case manual pilots that informed the gate procedures above
- [Meeting M1](../memory/meeting-2026-08-20-m1-process-skeleton.md), [M2](../memory/meeting-2026-08-20-m2-entity-group-boundary.md), [M6](../memory/meeting-2026-08-20-m6-site-selection-criteria.md)
