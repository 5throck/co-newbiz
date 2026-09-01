---
name: brownfield-feasibility
scope: co-newbiz
description: >
  Runs the Brown Field (M&A) Screening through DD feasibility work per
  `procedures/_shared/brownfield-screening/schema.yaml`,
  `procedures/_shared/brownfield-pre-fs/schema.yaml`,
  `procedures/_shared/brownfield-fs/schema.yaml`, and
  `procedures/_shared/brownfield-dd/schema.yaml` — the six mandatory
  M&A validators (antitrust, customer-retention, incentive, hr-integration,
  certification transferability, region-lead labor review) must all run and
  be recorded before DD exit; missing any one is a binding Kill Criterion,
  with no waiver path (`checklists/brownfield-feasibility-checklist.yaml` bf-01).

  Use when: "brown field feasibility", "M&A feasibility", "acquisition
  screening", "brownfield DD".
version: 1.1.0
last_reviewed: 2026-08-23
status: active
owner: brownfield-agent
prerequisites: none
metadata:
  type: domain
  triggers:
    - brown field feasibility
    - M&A feasibility
    - acquisition screening
    - brownfield DD

  procedure_keys:
    - brownfield-pre-fs
    - brownfield-screening
    - brownfield-target-identification
    - brownfield-target-screening
  related_skills:
    - antitrust-screening
    - certification-transferability
    - commercial-due-diligence
    - customer-attrition-risk
    - incentive-clawback-assessment
    - org-readiness-assessment
    - stage-gate-governance
    - technical-due-diligence
relates_to:
  - skill: permit-pathway-mapping
    type: follows
  - skill: strategic-fit-screening
    type: follows
  - skill: certification-roadmap
    type: composes_with
  - skill: stage-gate-governance
    type: composes_with
  - skill: dd-to-valuation-bridge
    type: composes_with

---

## Context

R&BD (research & business development licensing/co-development
arrangements) runs under `technology_track=rbd` on the 3-axis
classification (`case_type` × `origin` × `technology_track`, ADR-0047) — when flagged,
`checklists/rbd-technology-checklist.yaml` runs alongside this checklist,
not instead of it. The six mandatory M&A validators are a completeness
check with **no waiver path** (`waiver_eligible: false` on
`checklists/brownfield-feasibility-checklist.yaml`'s `bf-01`) — distinct
from every other mandatory-but-waivable item on the same checklist.

## When to Use

- An acquisition/M&A target reaches Screening, Pre-FS, FS, or DD
- Confirming DD-exit readiness (all six validators run and recorded)

## Execution Steps

1. **Screening**: `procedures/_shared/brownfield-screening/schema.yaml`
   — target longlisting (`brownfield-feasibility` itself, step 1) plus the
   preliminary HHI pre-screen (`antitrust-screening`, step 2 — a rough
   filter only, the full six-way cross-check runs at DD)
2. **Pre-FS / FS**: run the matching shared procedures for the surviving
   shortlist
3. **DD**: run `procedures/_shared/brownfield-dd/schema.yaml` and confirm
   all six mandatory validators are recorded before considering DD
   complete: `antitrust-screening`, `customer-attrition-risk`,
   `incentive-clawback-assessment`, `org-readiness-assessment` (HR
   integration), certification transferability
   (`certification-transferability`), and region-lead labor review
4. **R&BD track check**: if `technology_track=rbd`, additionally run
   `checklists/rbd-technology-checklist.yaml` (TRL, IP/FTO status,
   commercialization-path, `rbd_source`)
5. **Confirm WACC/hurdle-IRR is `kind='user'`**, not `assumed`, before
   opening the FS gate (checklist item bf-02) — a load-bearing financial
   input cannot ride on an unconfirmed assumption into FS
6. **Confirm the six-validator completeness check** before DD exit — this
   cannot be waived; a missing validator means DD is not actually complete,
   regardless of schedule pressure

## Output Format

- Screening/Pre-FS/FS/DD deliverables per the shared procedures'
  `output_type` fields
- Completed feasibility checklist, with the six-validator completeness
  confirmation explicit

## Related Skills

- `antitrust-screening`, `customer-attrition-risk`,
  `incentive-clawback-assessment`, `org-readiness-assessment`,
  `certification-transferability` — the six mandatory validators
- `stage-gate-governance` — the Kill Criteria this feasibility work feeds
- `commercial-due-diligence`, `technical-due-diligence` — the parallel DD tracks
