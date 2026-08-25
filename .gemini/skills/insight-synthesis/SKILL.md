---
name: insight-synthesis
scope: co-newbiz
description: >
  Integrates outputs from multiple domain analyses (market intelligence, financial
  analysis, legal/regulatory review, M&A special-topic checks) into a single
  unified strategic view for a stage-gate decision. Includes a mandatory
  cross-domain conflict-resolution step so tensions between analyses are
  recorded, never silently averaged away.

  Use when: "synthesize insights", "insight synthesis", "integrate analysis",
  "strategic synthesis", "combine findings", "cross-analysis integration".
version: 1.0.0
last_reviewed: 2026-08-20
status: active
owner: process-governance-manager
prerequisites: none
metadata:
  procedure_keys:
    - entity-ic-review
  type: process
  triggers:
    - synthesize insights
    - insight synthesis
    - integrate analysis
    - strategic synthesis
    - combine findings
    - cross-analysis integration
---

## Context

Reused from `Projects/co-consult/skills/insight-synthesis`, adapted to co-newbiz's
stage-gate model (design v1.0 §10.2): use at the end of a stage (Screening/Pre-FS/
FS/DD) when multiple domain analyses are complete and need to be synthesized into
a coherent narrative for the Entity IC / Group IC approval gate.

## When to Use

- Multiple domain analyses for the same project are complete and need integration
  before a gate decision
- Preparing an IC memo section that must reconcile findings across domains
- Conflicting findings from different domain agents need explicit reconciliation

## Execution Steps

1. **Collect Analysis Outputs**: gather completed outputs for the project (market
   intelligence, financial-statement-analysis, legal/regulatory review, applicable
   M&A special-topic checks, RAG dimension assessments)
2. **Identify Themes**: extract 3-5 cross-cutting findings that appear across
   multiple domain outputs
3. **Cross-Domain Reconciliation** (mandatory): where analyses disagree, document
   the tension explicitly rather than forcing consensus. Classify as:
   (a) resolvable with more data, (b) context-dependent, (c) genuine trade-off
4. **Data-Confidence Check**: confirm the RAG data-confidence cap (docs/rag-framework.md
   §2) is reflected in the synthesis — a two-hop proxy estimate does not get
   treated as equivalent to a live, high-confidence figure just because the
   narrative reads confidently
5. **Synthesize the Narrative**:
   - One overarching "so what" statement (max 2 sentences)
   - 3-5 supporting findings with evidence anchors (`anchor_ref`)
   - Key risks and dependencies, including any Kill Criteria candidates surfaced
   - Recommended direction for the gate decision
6. **Prepare for the Gate**: structure the output as the decision-ready section
   of the IC memo (`templates/deliverables/ic-memo-template.md`)

## Output Format

- Strategic Synthesis section: Situation Summary, Key Findings (cross-referenced
  to source domain outputs), Cross-Domain Tensions, Recommended Direction with
  Rationale, Key Risks — feeds directly into the IC memo, never a separate
  freestanding document

## Related Skills

- `company-intelligence`, `competitive-intelligence` — upstream research inputs
- `historical-financial-analysis` — upstream financial input
- `rag-scoring-framework` — the data-confidence cap this synthesis must respect
