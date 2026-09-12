---
name: regulation-monitoring
scope: co-newbiz
description: >
  Watches for statute/regulation changes relevant to active and prospective
  projects (industry-specific and region-specific), and routes a detected
  change into `policy-change-impact-analysis` when it affects a governance
  document, a permit pathway, or a certification requirement.

  Use when: "regulation monitoring", "statute change alert",
  "new regulation affecting our projects", "regulatory update".
version: 1.0.0
last_reviewed: 2026-08-20
status: active
owner: legal-counsel
prerequisites:
  - k-law
metadata:
  type: domain
  triggers:
    - regulation monitoring
    - statute change alert
    - new regulation affecting our projects
    - regulatory update
---

## Context

Distinct from `statute-change-monitoring` (a project-scoped DD check for a
specific target's applicable statutes) — this skill is the standing,
portfolio-wide watch that feeds the governance amendment pipeline before any
single deal is even in scope. Uses `k-law` (Korean Ministry of Government
Legislation statute/precedent lookup)
as its data source.

## When to Use

- Periodic scan of statutes/ordinances relevant to the industries and
  regions the team actively operates in
- A watched statute is amended or a new one is enacted
- Deciding whether a detected change is deal-scoped (→
  `statute-change-monitoring` on the affected project) or governance-scoped
  (→ `policy-change-impact-analysis` on the team's own policy/procedure)

## Execution Steps

1. **Maintain the watch list**: statutes/ordinances tied to
   `industry-profiles/*.yaml` and `region-profiles/*.yaml` currently in use,
   plus any statute a `legal_risk_register` entry references
2. **Scan via `k-law`**: query for amendments/new enactments on the watch
   list, on a cadence set by `docs/governance/ops-cadence.md`
3. **Classify the change**:
   - Affects a specific active/prospective project's DD or certification
     status → route to that project's `statute-change-monitoring`
   - Affects a governance document, permit-pathway definition, or
     certification-roadmap requirement across the team's own procedures →
     route to `policy-change-impact-analysis`
   - Neither → log and no further action
4. **Record the detection**: source statute, effective date, summary of the
   change, classification decision, and routing target
5. **Escalate a material or time-sensitive change** directly to
   `process-governance-manager` (governance-scoped) or the affected
   project's lead (deal-scoped) rather than waiting for the next scan cycle

## Output Format

- Regulation-change log entry: statute, effective date, summary,
  classification, routing decision
- Escalation note where time-sensitive

## Related Skills

- `k-law` — the statute/precedent data source
- `statute-change-monitoring` — the project-scoped DD counterpart
- `policy-change-impact-analysis` — the governance-scoped routing target
- `permit-pathway-mapping`, `certification-roadmap` — surfaces a detected change may affect
