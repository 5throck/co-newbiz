---
id: BRIEF-20260909-01
date: 2026-09-09
title: "Decision Brief — ADR-0051 open question (b): strategic-fit scorecard weights and advance/hold/kill thresholds"
status: proposed — decision requested from the project owner
owner: pm
context_refs: ["docs/adr/0051-brownfield-dd-kill-criteria-and-coverage-extension.md", "checklists/strategic-fit-screening-checklist.yaml"]
---

# Decision Brief — ADR-0051 (b): Strategic-Fit Scorecard Thresholds

## The question

The strategic-fit screening scorecard (S3, `checklists/strategic-fit-screening-checklist.yaml`,
items sf-06..sf-12) weights and the advance/hold/kill bands — **advance ≥60/100,
hold 45–59, kill <45** — are Cooper/Green Book stage-gate practice carried over
as ILLUSTRATIVE. ADR-0051 open question (b) asks whether they become OUR policy.

## Why it matters

- The Screening gate's decision criteria (flow.spec `gates[screening]`) reference
  the scorecard; until the bands are policy, every Screening pass rests on
  illustrative numbers.
- `procedures/_shared/greenfield-screening` step 1 explicitly says thresholds are
  ILLUSTRATIVE pending the thresholds meeting (ADR-0051 open question (b)).
- Kill Criteria are NOT affected: the six binding kill criteria are independent
  of this scorecard (a low score routes to hold/kill via the gate, but the six
  criteria can halt regardless of score).

## Options

| Option | Description | For | Against |
|---|---|---|---|
| **A. Adopt the Cooper/Green Book bands as policy** (≥60 advance / 45–59 hold / <45 kill) | The bands are the published industry-standard practice; adopting them makes the gate decisive today | Zero new analysis needed; consistent with the methodology's own lineage; reversible via a superseding decision | The bands were never calibrated on OUR deal flow |
| B. Recalibrate from pilot data first | Use the pilot runs' scorecards to fit bands | Empirically ours | Only 4 pilots exist — far too few to fit thresholds; delays the decision indefinitely |
| C. Lower-confidence bands (e.g., ≥70 advance) | Raise the bar to compensate for uncertainty | Conservative | Arbitrary in the other direction; no evidence the current bar is too low |

## Recommendation

**Option A — adopt as policy, with a scheduled recalibration review.** Rationale:
the Cooper/Green Book bands are the reference practice the methodology was built
on; option B's pilot sample is too small to fit anything better; and the bands
are gate-level judgment aids, not kill criteria (wrongness costs one hold, not a
wrong acquisition). Commit to a review after the first 5 scorecard-bearing runs
with confirmed outcomes, at which point option B becomes viable.

## Decision requested

Reply with "Option A approved" (or the chosen option + any band edits). The decision is then
recorded as `docs/decisions/DEC-YYYYMMDD-NN.md`, the checklist's ILLUSTRATIVE
banner becomes the adopted-policy citation, and the greenfield/brownfield
screening procedure step notes are updated in the same change.
