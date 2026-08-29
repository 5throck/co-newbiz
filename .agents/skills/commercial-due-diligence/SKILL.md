---
name: commercial-due-diligence
scope: co-newbiz
description: >
  Runs the commercial DD checklist — customer concentration, churn history,
  pricing power, win/loss analysis, channel checks — with every material
  finding tied to an `assumption_key` or `dd_finding.value_impact`, never
  left as narrative-only (`checklists/commercial-dd-checklist.yaml` cdd-06,
  the checklist's own explicit no-narrative-only rule).

  Use when: "commercial due diligence", "customer concentration analysis",
  "pricing power assessment", "win loss analysis".
version: 1.1.0
last_reviewed: 2026-08-23
status: active
owner: commercial-dd-agent
prerequisites: none
metadata:
  type: domain
  triggers:
    - commercial due diligence
    - customer concentration analysis
    - pricing power assessment
    - win loss analysis

  procedure_keys:
    - brownfield-dd
relates_to:
  - skill: technical-due-diligence
    type: follows

---

## Context

cdd-06 is the checklist's own quality bar, and it's stricter than it first
reads: a finding is not "on file" until it's tied to a concrete
`assumption_key` (for something that feeds the financial model) or a
`dd_finding.value_impact` (for something that adjusts valuation directly)
— a well-written narrative paragraph describing a risk is not sufficient on
its own if nothing downstream can actually compute against it.

## When to Use

- Brown Field DD, always
- Assessing a target's revenue durability before finalizing the investment thesis

## Execution Steps

1. **Customer concentration** (cdd-01, mandatory): top-N revenue share —
   quantified, not "concentrated" as a qualitative label
2. **Customer churn history** (cdd-02, mandatory): historical churn rate by
   segment, trend direction
3. **Pricing power** (cdd-03, mandatory): ability to pass through cost
   increases — evidenced by historical instances, not assumed from market position alone
4. **Win/loss analysis** (cdd-04, recommended): against named competitors
   where data is available
5. **Channel checks** (cdd-05, recommended): with distributors/resellers
   where applicable
6. **Tie every material finding to `assumption_key` or `dd_finding.value_impact`**
   (cdd-06, mandatory) — before considering commercial DD complete, review
   the finding list and confirm none are narrative-only
7. **Hand findings to `dd-to-valuation-bridge`** for the explicit connection
   into the valuation model

## Output Format

- Commercial DD findings, each tied to `assumption_key` or
  `dd_finding.value_impact` — zero narrative-only findings at completion

## Related Skills

- `customer-attrition-risk` — the CoC-clause counterpart to churn/concentration risk
- `dd-to-valuation-bridge` — where these findings connect to valuation
- `expert-interview` — a common evidence source for win/loss and channel-check findings
