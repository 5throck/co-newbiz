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
version: 1.1.0
last_reviewed: 2026-08-23
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

  procedure_keys:
    - brownfield-pre-fs
    - greenfield-pre-fs
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

## Snapshot Integration (ADR-0064 — how the session feeds kill criteria #5/#6)

The session's output must land in the run's assumption registry under the
EXACT keys `wacc` and `hurdle_irr` — these two key names are the contract
`db/lib/snapshot-filler.ts`'s `fin.wacc_source_status` var reads:

- Record via `bun scripts/co-newbiz/newbiz.ts assume --run <run_id> --key wacc
  --kind user --value <rate> ...` (and again with `--key hurdle_irr`), or via
  the `set_assumption`✱ MCP tool — both write the same FR-DATA-07 path.
- The var's semantics: ANY `kind='assumed'` row among the two keys ⇒ status
  `'assumed'`; both keys present and none assumed ⇒ `'sourced'`; neither key
  recorded for the run ⇒ `missing` (the criterion evaluates UNASSESSED, never
  a silent pass).
- Armed consequence: kill-criteria #5/#6 (`wacc_hurdle_still_assumed`,
  ADR-0064) HALT when the status is `'assumed'` at FS. Running this skill to
  completion — both figures `kind='user'` — is what disarms them.
- Key-name discipline: do not invent variants (`WACC`, `discount_rate`);
  the filler matches exactly `wacc` and `hurdle_irr`.

## Output Format

- Confirmed WACC (with mode and component provenance) and hurdle IRR, both `kind='user'`

## Related Skills

- `investment-feasibility-modeling` — the model this discount rate feeds
- `compliance-monitoring` — the gate check enforcing this confirmation
