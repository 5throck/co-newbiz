---
name: legal-risk-register
scope: co-newbiz
description: >
  Maintains the standing legal-risk register for a project — litigation
  exposure, regulatory non-compliance findings, contractual risk, and
  pending statute changes — as the single place these risks are tracked
  across gates, rather than scattered across each domain skill's own
  findings.

  Use when: "legal risk register", "litigation exposure tracking",
  "consolidated legal risk view".
version: 1.0.0
last_reviewed: 2026-08-20
status: active
owner: legal-counsel
prerequisites: none
metadata:
  type: process
  triggers:
    - legal risk register
    - litigation exposure tracking
    - consolidated legal risk view
---

## Context

Several skills produce legal-risk-relevant findings independently
(`regulatory-screening`, `certification-transferability`,
`customer-attrition-risk`'s contract scan, `debt-and-contingent-liability-simulation`'s
litigation entries) — this skill consolidates them into one register per
project rather than leaving a reviewer to reconstruct the full legal-risk
picture by reading every source skill's output separately.

## When to Use

- Maintained continuously from Screening through DD exit for every project
- Before any gate decision, as the consolidated legal-risk view

## Execution Steps

1. **Pull findings from every contributing skill**: regulatory screening
   results, certification-transferability determinations, customer/
   supplier contract CoC risks, litigation entries from the contingent-
   liability inventory, any open interpretation-registry question touching
   this project
2. **Classify each entry** by severity and whether it's resolved,
   monitored, or open
3. **Never duplicate the source finding's detail** — the register
   references each source skill's output, it doesn't restate the analysis
4. **Flag any entry that has escalated to Kill-Criteria territory**
   (non-transferable load-bearing certification, a covenant breach, a hard
   partner dependency) to `stage-gate-governance` explicitly
5. **Present the consolidated register at each gate review**, updated
   through the most recent finding, not a stale snapshot from an earlier stage

## Output Format

- Legal risk register: entry, source skill, severity, status
  (resolved/monitored/open), Kill-Criteria flag where applicable

## Related Skills

- `regulatory-screening`, `certification-transferability`,
  `customer-attrition-risk`, `debt-and-contingent-liability-simulation` —
  the contributing findings this register consolidates
- `stage-gate-governance` — where an escalated entry routes
