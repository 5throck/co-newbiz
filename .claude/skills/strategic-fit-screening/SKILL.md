---
name: strategic-fit-screening
scope: co-newbiz
description: >
  Runs the entity-level strategic-fit screen at the first gate — must-meet
  knock-out criteria plus a weighted should-meet scorecard — so no
  opportunity enters heavy analysis before passing a strategic filter.
  Produces the Go/Kill/Hold/Recycle decision record with written feedback
  on every rejection.

  Use when: "strategic fit screen", "knock-out criteria", "hunt zone fit".
version: 1.1.0
last_reviewed: 2026-08-23
status: active
owner: process-governance-manager
prerequisites: none
metadata:
  type: domain
  triggers:
    - strategic fit screen
    - knock-out criteria
    - hunt zone fit

  procedure_keys:
    - brownfield-screening
    - greenfield-screening
relates_to:
  - skill: antitrust-screening
    type: follows
  - skill: value-chain-linkage-analysis
    type: follows
  - skill: stage-gate-governance
    type: composes_with
  - skill: insight-synthesis
    type: composes_with
  - skill: project-review
    type: composes_with
  - skill: rag-scoring-framework
    type: composes_with
  - skill: stage-gate-governance
    type: composes_with
  - skill: two-tier-approval-chain
    type: composes_with

---

## Context

Published practice puts strategic fit at the FIRST gate, not final approval:
Cooper's Stage-Gate Gate 1 screens on must-meet knock-outs (strategic
alignment, feasibility, no regulatory showstoppers) plus rated should-meet
criteria on a visible scorecard, and HM Treasury's Green Book runs the
Strategic Outline Case before full economic appraisal. This repo previously
tested portfolio fit only at Group IC — far too late (ADR-0051 gap 2). This
skill supplies the how for the screen; the procedure steps that dispatch it
(`procedures/_shared/brownfield-screening/schema.yaml` step 2,
`procedures/_shared/greenfield-screening/schema.yaml` step 1) own the what
and when.

## When to Use

- At the Screening gate, before any market-sizing, HHI, or site work
- Desk research and the sponsor's own knowledge ONLY — no commissioned
  analysis at this gate

## Execution Steps

1. **Run the knock-out pass first (sf-01..sf-05)** — any single Fail
   terminates or recycles the opportunity with no further analysis; treat
   a safety/regulatory showstopper (sf-03) as a completeness fact, never a
   judgment call
2. **Score the should-meet criteria (sf-06..sf-12)** on a visible
   scorecard — criteria and weights are shown to submitters, not hidden
3. **Classify the strategic intent category** (core-enhancement /
   adjacent-expansion / transformational) and judge the scorecard against
   the threshold band for that category, not a single global bar
4. **Apply options discipline** — the proposal must be one of at least two
   routes to its stated objective, compared against a do-minimum baseline
5. **Record the decision in the Go/Kill/Hold/Recycle vocabulary with
   written feedback on every rejection** — rejected opportunities enter the
   idea vault, not the void
6. **Do not activate thresholds**: scorecard weights and advance/hold/kill
   bands are ILLUSTRATIVE from published practice until the thresholds
   meeting records them under docs/decisions/open/ — apply the same
   discipline that keeps rag_rule rows at enabled=0

## Output Format

- `strategic_fit_screening_result`: knock-out pass/fail per item, scorecard
  with per-criterion scores and total, declared intent category, decision
  (Go/Kill/Hold/Recycle), written feedback for any non-Go

## Related Skills

- `portfolio-fit-assessment` — the GROUP-level overlap/agenda screen at
  Group IC; distinct from this entity-level first-gate screen
- `stage-gate-governance` — where the gate record lands
- `checklist-authoring` — chk-strategic-fit's governing contract
