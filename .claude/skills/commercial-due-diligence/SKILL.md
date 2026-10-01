---
name: commercial-due-diligence
scope: co-newbiz
description: >
  Runs the commercial DD checklist — customer concentration, churn history,
  pricing power, win/loss analysis, channel checks, and the four-axis
  revenue-quality assessment (concentration, margin, collection period,
  recurrence) — with every material
  finding tied to an `assumption_key` or `dd_finding.value_impact`, never
  left as narrative-only (`checklists/commercial-dd-checklist.yaml` cdd-06,
  the checklist's own explicit no-narrative-only rule).

  Use when: "commercial due diligence", "customer concentration analysis",
  "pricing power assessment", "win loss analysis", "revenue quality".
version: 1.2.0
last_reviewed: 2026-10-01
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
    - revenue quality

  procedure_keys:
    - brownfield-dd
relates_to:
  - skill: technical-due-diligence
    type: follows
  - skill: competitive-intelligence
    type: composes_with
  - skill: legal-due-diligence
    type: composes_with
  - skill: management-incentive-review
    type: composes_with
  - skill: customer-attrition-risk
    type: composes_with
  - skill: incentive-clawback-assessment
    type: composes_with
  - skill: debt-and-contingent-liability-simulation
    type: composes_with
  - skill: financing-plan-review
    type: composes_with
  - skill: org-readiness-assessment
    type: composes_with
  - skill: compliance-monitoring
    type: composes_with
  - skill: stage-gate-governance
    type: composes_with

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
- Judging revenue quality (cdd-08) — the four axes read together, not one at a time

## Execution Steps

1. **Customer concentration** (cdd-01, mandatory): top-N revenue share —
   quantified, not "concentrated" as a qualitative label. This step is the
   single place the figure is computed; market DD (`mdd-06`) takes it as given
   and adds a market-side test rather than recomputing it (unless this step was
   waived or not completed, in which case `mdd-06` computes and records it)
2. **Customer churn history** (cdd-02, mandatory): historical churn rate by
   segment, trend direction. Same rule: the single computation owner;
   `mdd-07` consumes the rates and adds leading indicators from customer evidence
   (same fallback if this step was waived or not completed)
3. **Pricing power** (cdd-03, mandatory): ability to pass through cost
   increases — evidenced by historical instances, not assumed from market position alone
4. **Win/loss analysis** (cdd-04, recommended): against named competitors
   where data is available
5. **Channel checks** (cdd-05, recommended): with distributors/resellers
   where applicable
6. **Revenue quality** (cdd-08, recommended — do it wherever customer-level
   data exists; if skipped, record the reason and which axes could not be
   verified, since silence is not a pass): for each top customer and
   segment, lay four axes side by side on the same unit of analysis — a
   floor, not a closed list (industry-specific axes such as contracted
   backlog may be added):
   - **Concentration** — revenue share, taken from step 1 (do not recompute)
   - **Margin** — contribution/gross margin by customer or segment, from
     management accounts bridged by the financial DD (`fdd-05`, `fdd-07`)
   - **Collection period** — DSO and receivable aging by customer, not only
     the company-wide average; note payment-term concessions to large accounts
   - **Recurrence** — recurring vs. one-off/spot/project revenue, contracted
     vs. uncontracted, repeat-purchase rate; churn trend comes from step 2

   Benchmark each axis where a benchmark exists: the industry profile's
   `revenue_quality_norms` and the region profile's `payment_practice`
   (both optional sections — present only when sourced), otherwise
   `peer-benchmarking`. A norm informs the verdict; it never replaces
   target-level evidence.

   Record a verdict and its evidence per axis. Do not collapse the four into
   one score, and do not restate steps 1-3 — cdd-08 adds the cross-reading
   (e.g. the largest customer is also the slowest payer and the lowest margin).
   Where customer-level data is unavailable, say which axis could not be
   verified; silence is not a pass.
7. **Tie every material finding to `assumption_key` or `dd_finding.value_impact`**
   (cdd-06, mandatory) — before considering commercial DD complete, review
   the finding list and confirm none are narrative-only. Typical mapping:
   concentration → `customer_concentration_post_close`, margin →
   `ebitda_margin_sustainable`, collection period → working-capital/DSO
   assumption, recurrence → the revenue base the projection grows from
8. **Hand findings to `dd-to-valuation-bridge`** for the explicit connection
   into the valuation model

## Output Format

- Commercial DD findings, each tied to `assumption_key` or
  `dd_finding.value_impact` — zero narrative-only findings at completion
- When cdd-08 is performed — revenue-quality grid: top customers/segments ×
  four axes, one verdict and evidence per cell, with the cells that could not
  be verified named; when skipped, the reason and the axes left unverified
- Axis verdicts feed the Financial RAG dimension's evidence and the Data
  Confidence ceiling; they are never averaged (priority-ordered RAG, ADR-0016)

## Related Skills

- `customer-attrition-risk` — the CoC-clause counterpart to churn/concentration risk; measures concentration and recurrence after close
- `quality-of-earnings` — supplies customer-level margin and the normalized EBITDA baseline
- `peer-benchmarking` — the fallback benchmark when no profile norm exists
- `dd-to-valuation-bridge` — where these findings connect to valuation
- `expert-interview` — a common evidence source for win/loss and channel-check findings
