---
name: company-intelligence
scope: co-newbiz
description: >
  Comprehensive company and corporate group intelligence gathering and analysis.
  Dispatches parallel research agents to cover overview, financials, products/
  markets, analyst coverage, and leadership/governance, then consolidates into
  a structured company profile.

  Use when: "company research", "company analysis", "corporate investigation",
  "company intelligence", "company profile", "corporate intelligence",
  "research this company", "analyze this company".
version: 1.0.0
last_reviewed: 2026-08-20
status: active
owner: market-intelligence-agent
prerequisites: none
metadata:
  procedure_keys:
    - brownfield-dd
    - brownfield-target-identification
  source: workspace
  type: research
  triggers:
    - company research
    - company analysis
    - corporate investigation
    - company intelligence
    - company profile
    - corporate intelligence
    - research this company
    - analyze this company
---

## Context

Reused from `Projects/co-consult/skills/company-intelligence`. In co-newbiz this
is the standard depth of research for a Brown Field target, a Green Field site
partner, or a competitor named in `competitive-intelligence`'s output.

## When to Use

- Brown Field target company/corporate-group research
- Deep-dive company profiles feeding `md_company` master data
- DD support requiring subsidiary/ownership-structure detail
- Leadership/governance profiling for `management_package` context (identity is
  never stored there — see `docs/security-model.md` §7 item 6; this skill's
  output stays outside the DB, in `deliverables/`)

## Execution Steps

### Workflow Overview

```
Request (company name + scope)
  |
  +-- Identify: listed vs private, group vs standalone, Korean vs foreign
  |
  +-- Dispatch parallel research agents (general-purpose, sonnet tier)
  |   +-- Overview & Subsidiaries
  |   +-- Financial Statements (5-year) — hand off to financial-statement-analysis for DART-sourced figures
  |   +-- Products, Markets & Competition
  |   +-- Analyst Reports & Credit Research
  |   +-- Leadership Profiles & Governance
  |
  +-- Wait for all agents to complete
  |
  +-- Consolidate into a structured profile -> deliverables/reports/
```

### Step 1: Classify the Target

| Question | Why it matters |
|----------|---------------|
| Corporate **group** or **single company**? | Determines whether to research subsidiaries |
| **Korean** or foreign? | Determines search language and which region profile applies |
| **Listed** or private? | Determines availability of financial data and analyst reports |
| What **industry**? | Sets the `md_industry`/KSIC anchor for downstream proxy-chain work |

### Step 2: Dispatch Parallel Research Agents

Each research thread is a `general-purpose` subagent, `sonnet` tier, dispatched
in parallel (`run_in_background: true`). PII discipline applies from the start:
identify individuals by role/title in the consolidated output, not by name, where
the finding will feed `management_package` or `comp_benchmark` (design §4-9-1(b)).

### Step 3: Consolidate

Merge the five research threads into one structured profile. Flag any figure
that should be independently verified through `financial-statement-analysis`
(DART) rather than trusted from a secondary source.

## Output Format

- Company Profile: Overview & Structure, Financial Summary (cross-referenced to
  `financial-statement-analysis` output where available), Products & Markets,
  Analyst/Credit View, Leadership & Governance (role-based, not named where the
  output may feed a PII-constrained table)

## Related Skills

- `financial-statement-analysis` — authoritative DART-sourced financial figures
- `competitive-intelligence` — market/competitor framing
- `insight-synthesis` — cross-domain integration
