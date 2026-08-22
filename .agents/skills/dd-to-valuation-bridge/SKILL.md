---
name: dd-to-valuation-bridge
scope: co-newbiz
description: >
  Connects every material DD finding to a concrete `assumption_key` or
  `dd_finding.value_impact` so it actually moves the valuation model —
  the enforcement point behind `checklists/commercial-dd-checklist.yaml`
  cdd-06's "no narrative-only findings" rule, applied across commercial,
  technical, legal, and M&A-special-topics DD findings alike.

  Use when: "DD to valuation bridge", "value_impact", "does this finding
  move the valuation", "narrative-only finding check".
version: 1.1.0
last_reviewed: 2026-08-23
status: active
owner: valuation-agent
prerequisites:
  - commercial-due-diligence
  - technical-due-diligence
metadata:
  type: process
  triggers:
    - DD to valuation bridge
    - value_impact
    - does this finding move the valuation
    - narrative-only finding check

  procedure_keys:
    - entity-ic-review
    - greenfield-dd
---

## Context

This skill is the checkpoint every DD workstream's output passes through
before the valuation is considered final — not a separate analysis, a
consolidation-and-verification pass across commercial, technical, legal,
and M&A-special-topics findings, confirming each material one actually
connects to something the model can compute against.

## When to Use

- Before finalizing the valuation model at DD exit
- Reviewing whether a specific DD finding is properly connected or still narrative-only

## Execution Steps

1. **Collect material findings** from `commercial-due-diligence`,
   `technical-due-diligence`, `legal-risk-register`,
   `quality-of-earnings`, and the M&A special-topics skills
   (`customer-attrition-risk`, `incentive-clawback-assessment`,
   `compensation-harmonization-analysis`,
   `debt-and-contingent-liability-simulation`)
2. **For each finding, confirm the connection type**: does it set or
   modify an `assumption_key` feeding the projection/model, or does it
   register a `dd_finding.value_impact` (a direct valuation adjustment)?
3. **Flag any material finding with neither connection** — this is a
   narrative-only finding and the checklist's own rule (cdd-06) treats it
   as incomplete work, not an acceptable qualitative note
4. **Confirm no double-counting**: a finding that's both an `assumption_key`
   input to the projection AND a separate `value_impact` line would
   double-count its effect — verify each finding maps to exactly one path
5. **Produce the final valuation adjustment summary**: base valuation,
   itemized adjustments (from `value_impact` entries), and confirmation
   that every material finding is accounted for

## Output Format

- Finding-to-valuation-connection audit (every material finding mapped to
  `assumption_key` or `value_impact`, zero narrative-only gaps), final
  valuation adjustment summary

## Related Skills

- `commercial-due-diligence` — the checklist rule this enforces
- `investment-feasibility-modeling` — the model this bridge feeds
- `quality-of-earnings` — a common source of `value_impact` adjustments
