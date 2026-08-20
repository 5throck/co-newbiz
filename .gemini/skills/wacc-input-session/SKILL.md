---
name: wacc-input-session
scope: co-newbiz
description: >
  Confirms WACC and hurdle IRR as `kind='user'` (explicitly confirmed, not
  `kind='assumed'`) before any FS gate opens — `checklists/brownfield-feasibility-checklist.yaml`
  bf-02's mandatory item. Supports both direct-input and CAPM-component
  modes (risk-free rate=live, ERP/target D/E=user, beta=derived), per the
  glossary entry's own documented convention.

  Use when: "WACC input", "hurdle IRR confirmation", "CAPM components",
  "discount rate session".
version: 1.0.0
last_reviewed: 2026-08-20
status: active
owner: valuation-agent
prerequisites: none
metadata:
  type: process
  triggers:
    - WACC input
    - hurdle IRR confirmation
    - CAPM components
    - discount rate session
---

## Context

A load-bearing financial input riding on an unconfirmed assumption into the
FS gate is exactly the failure `checklists/brownfield-feasibility-checklist.yaml`'s
bf-02 exists to catch — WACC and hurdle IRR must be `kind='user'`, not
`kind='assumed'`, before FS opens. Two input modes are supported: direct
entry of a final WACC figure, or CAPM-component entry where the risk-free
rate is sourced live, ERP and target D/E are user-entered, and beta is
derived — the glossary's `WACC` entry documents this dual-mode convention
so downstream output can show which value came from which mode.

## When to Use

- Before opening the FS gate on any Brown Field or Green Field project
- Re-confirming WACC when a material market-rate shift makes the existing figure stale

## Execution Steps

1. **Choose the input mode with the user explicitly** — direct WACC entry,
   or CAPM-component entry (risk-free rate/ERP/target D/E/beta)
2. **For CAPM mode**: pull the risk-free rate live (current market data),
   collect ERP and target D/E as user inputs, derive beta (industry/peer-based)
3. **Record every component's `kind`**: `live` for the risk-free rate,
   `user` for ERP/target D/E, `derived` for beta — the final WACC is
   `kind='user'` regardless of mode, since a human explicitly confirmed it
4. **Confirm the hurdle IRR** the same way — `kind='user'`, never carried
   forward from a prior project's figure without explicit reconfirmation
5. **Block the FS gate** if either figure is still `kind='assumed'` —
   `compliance-monitoring`'s gate check reads this directly

## Output Format

- Confirmed WACC (with mode and component provenance) and hurdle IRR, both `kind='user'`

## Related Skills

- `investment-feasibility-modeling` — the model this discount rate feeds
- `compliance-monitoring` — the gate check enforcing this confirmation
