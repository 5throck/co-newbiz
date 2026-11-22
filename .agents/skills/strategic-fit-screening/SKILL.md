---
name: strategic-fit-screening
scope: co-newbiz
description: >
  Runs the entity-level strategic-fit screen at the first gate — must-meet
  knock-out criteria plus a weighted should-meet scorecard — so no
  opportunity enters heavy analysis before passing a strategic filter.
  Produces per-item knock-out verdicts, the scored scorecard, a written
  rationale, and a deterministic go/hold/kill recommendation chip; the
  gate decision itself is recorded by a person.

  Use when: "strategic fit screen", "knock-out criteria", "hunt zone fit".
version: 1.2.0
last_reviewed: 2026-11-22
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
    - brownfield-target-screening
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
   terminates the opportunity's advance with no further analysis; treat
   a safety/regulatory showstopper (sf-03) as a completeness fact, never a
   judgment call
2. **Score the should-meet criteria (sf-06..sf-12)** on a visible
   scorecard — criteria and weights are shown to submitters, not hidden
3. **Classify the strategic intent category** (core-enhancement /
   adjacent-expansion / transformational) and judge the scorecard against
   the threshold band for that category, not a single global bar
4. **Apply options discipline** — the proposal must be one of at least two
   routes to its stated objective, compared against a do-minimum baseline
5. **Present a written rationale and a deterministic recommendation —
   never record the gate decision.** The screen derives a go/hold/kill
   recommendation chip from the adopted thresholds (DEC-20260909-03);
   the chip renders null rather than a fabricated verdict when the
   evidence cannot settle it. The Screening-gate decision itself is
   recorded by a person with gate rights (`go | hold | kill` in
   `gate_decision`, ADR-0053 boundary #2); a kill finding enters the
   recorded decision, not a skill-side verdict
6. **Thresholds are adopted policy**: scorecard weights and the
   advance/hold/kill bands were adopted per DEC-20260909-03 (ADR-0051 (b)
   resolved 2026-09-09); a recalibration review follows the first 5
   scorecard-bearing runs with confirmed outcomes
7. **The S3 fit judgement closes through human confirmation (ADR-0192)**:
   the S3 strategic-fit judgement is satisfied by a human-confirmed
   synergy assessment (`synergy_score_confirmed_at` + non-empty
   `synergy_rationale`); selection stays an explicit human action
   (`PATCH /api/opportunities/[id]` `{status: "selected"}`) — nothing is
   auto-selected. The removed `fit_verdict` surface stays removed
   (2026-09-15 decision)

## Output Format

- `strategic_fit_screening_result`: knock-out pass/fail per item, scorecard
  with per-criterion scores and total, declared intent category, written
  rationale, and the deterministic go/hold/kill recommendation chip (null
  when unsettled — never fabricated). The gate decision is not part of this
  output; it is recorded by a person at the Screening gate

## Related Skills

- `portfolio-fit-assessment` — the GROUP-level overlap/agenda screen at
  Group IC; distinct from this entity-level first-gate screen
- `stage-gate-governance` — where the gate record lands
- `checklist-authoring` — chk-strategic-fit's governing contract
