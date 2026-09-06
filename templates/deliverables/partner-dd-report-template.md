---
governance_doc_id: tpl-partner-dd-report
layer: template
title: "Partner Due Diligence Report Template"
scope: shared
enforceability: recommended
owner_agent: docs-writer
version: "1.0.0"
effective_from: "2026-08-23"
output_type: partner_dd_report
lang: en
counterpart: partner-dd-report-template_ko.md
---

<!--
  output_type: partner_dd_report — "Deal-shape chain P2 — seven-workstream
  partner DD report with deal-shape recommendation (ADR-0052 §A)".
  Produced by deal-shape-chain step 3 (partnership-agent /
  partner-due-diligence, gate P2). Findings feed the P3 shape decision
  (deal_shape_decision, its own output) and the chain's kill criteria.
  Required evidence item per the procedure: reference at least two of the
  partner's other alliance partners. Technical workstream evidence follows
  the rbd checklist (rbd-08..rbd-15): named tests/environments/artifacts,
  non-champion reviewer (GAO-20-48G discipline).
-->

# [Partner Name] — Partner Due Diligence Report

**Run ID**: [run_id] · **Chain step**: deal-shape-chain P2 · **Hypothesized shape (from P1/P0)**: [shape] · **As of**: [as_of]

## Workstream findings (the seven)

| # | Workstream | Finding | Severity | Evidence (ADR-0058 ref) |
|---|---|---|---|---|
| 1 | Legal / title | [finding incl. IP ownership, encumbrances, litigation] | green / amber / red | [ref] |
| 2 | Technical — TRL/MRL evidence against OUR next gate | [finding incl. named tests/environments/artifacts; non-champion reviewer] | [severity] | [ref] |
| 3 | Collaboration capability | [finding] | [severity] | [ref] |
| 4 | Financial | [finding] | [severity] | [ref] |
| 5 | Commercial-conflict (competition overlap) | [finding] | [severity] | [ref] |
| 6 | Cultural | [finding] | [severity] | [ref] |
| 7 | Exit / reversibility | [finding incl. shutdown/exit options if the alliance fails] | [severity] | [ref] |

## Alliance track record (required evidence item)

At least two of the partner's other alliance partners referenced:
| Referenced partner | Relationship | Outcome/lesson | Source |
|---|---|---|---|
| [partner 1] | [context] | [outcome] | [ref] |
| [partner 2] | [context] | [outcome] | [ref] |

## Red findings → kill-criteria screen

[Any red finding checked against the chain's kill criteria (partner-DD red findings feed them) — criterion, applicability, result, evidence. If none: state "no red findings".]

## Deal-shape recommendation (input to P3, not the decision)

**Recommended shape**: [license-in / co-development / minority investment / JV / full M&A / recycle] · **On the five criteria**: control need [reading] · IP position [reading] · capital at risk [reading] · exit optionality [reading] · time-to-market [reading] · **Rationale**: [2-3 sentences]

## Sign-off

| Role | Key | Surface |
|---|---|---|
| Recorder — partnership-agent | [key] | [checked scope — declare what could NOT be verified] |
