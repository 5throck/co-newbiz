---
name: executive-presentation
scope: co-newbiz
description: >
  Designs and builds Entity IC / Group IC decision decks. Uses Pyramid Principle
  structure, "so what" message extraction, and one-page summary design. The
  business case section requires inputs from financial and RAG analyses.

  Use when: "executive presentation", "executive deck", "IC presentation",
  "decision deck", "strategy deck", "board presentation".
version: 1.0.0
last_reviewed: 2026-08-20
status: active
owner: docs-writer
prerequisites:
  - financial-statement-analysis
  - rag-scoring-framework
metadata:
  procedure_keys:
    - entity-ic-review
    - group-investment-review
  type: process
  triggers:
    - executive presentation
    - executive deck
    - IC presentation
    - decision deck
    - strategy deck
    - board presentation
relates_to:
  - skill: stage-gate-governance
    type: follows
  - skill: rag-scoring-framework
    type: composes_with
  - skill: financing-plan-review
    type: composes_with
  - skill: two-tier-approval-chain
    type: composes_with
  - skill: portfolio-fit-assessment
    type: composes_with
  - skill: intra-group-transaction-compliance
    type: composes_with

---

## Context

Reused from `Projects/co-consult/skills/executive-presentation`, retargeted from
generic "C-level presentation" to co-newbiz's actual gate artifact: the Entity IC
/ Group IC deck that accompanies `templates/deliverables/ic-memo-template.md`.

## When to Use

Invoke when producing the presentation-form companion to an IC memo for an
Entity IC or Group IC gate. The financial analysis and RAG assessment for the
project must already exist.

## Execution Steps

1. **Confirm Prerequisites**: financial-statement-analysis output and the
   project's current RAG assessment are available
2. **Define the Decision**: what single approval/ranking decision must the IC
   make after this presentation? (Entity IC: approve/reject/conditional. Group
   IC: often a ranking among competing agenda items, per ADR-0029 — say so
   explicitly if that is the actual ask.)
3. **Pyramid Principle Structure** (SCQA):
   - Situation: context the IC already knows
   - Complication: what has changed or is at stake
   - Question: what this forces the IC to decide
   - Answer: the recommendation, stated upfront
4. **Slide Architecture**:
   - Title + Agenda
   - Executive Summary / Recommendation — written last
   - Context and Problem
   - Analysis and Findings (from `insight-synthesis`)
   - RAG Signal (overall + six dimensions, with rationale — never color-only,
     matching `docs/ui-spec.md` §3's display contract even in a static deck)
   - Business Case (financial-statement-analysis + applicable M&A special-topic
     findings: investment summary, IRR/NPV, key risks, integration cost impact)
   - Recommended Path Forward
   - Next Steps and Decision Request
5. **One-Page Summary**: Situation (2 sentences), Recommendation (1 sentence),
   Business Case (3 bullets), Next Step (1 action)
6. **Executive Language Check**: no jargon, every number has a source tooltip
   equivalent (cite `assumption_key`/`as_of`), one message per slide, no slide
   exceeds 5 bullet points

## Output Format

- Slide deck outline (slide title, key message, supporting evidence, visual
  recommendation per slide)
- One-Page Executive Summary (standalone)
- Speaker notes for the RAG and Business Case slides

Save to `deliverables/reports/` alongside the IC memo — see the project's
Output Destination convention; do not hard-code paths.

## Related Skills

- `insight-synthesis` — cross-domain narrative input
- `rag-scoring-framework` — the RAG slide's source of truth
- `financial-statement-analysis` — business-case figures
