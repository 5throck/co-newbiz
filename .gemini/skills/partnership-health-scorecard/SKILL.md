---
name: partnership-health-scorecard
scope: co-newbiz
description: >
  Implements step 6 of `deal-shape-chain` (alliance_post_launch_review) and
  step 2 of `jv-lifecycle-governance` (jv_health_scorecard): the per-partnership
  health scorecard across the seven JV dimensions, and the dated post-launch
  review of an alliance against its selection rationale. Does not cover
  partner sourcing (partner-sourcing-strategy), partner screening
  (partner-due-diligence) or JV structuring (jv-structuring).

  Use when: "partnership health scorecard", "alliance post-launch review",
  "JV health review", "partnership monitoring".
version: 1.0.0
status: experimental
owner: partnership-agent
prerequisites: none
lifecycle:
  phase: draft
metadata:
  type: domain
  procedure_keys:
    - deal-shape-chain
    - jv-lifecycle-governance
  triggers:
    - partnership health scorecard
    - alliance post-launch review
    - JV health review
    - partnership monitoring
---

# partnership-health-scorecard

## Context

Owned by `partnership-agent`. The procedures `deal-shape-chain` (step 6) and `jv-lifecycle-governance` (step 2) are authoritative for what is produced and when; this skill carries only how. It never restates their steps.

## Inputs

- Selection rationale recorded in the P3 partner scorecard
- JV agreement terms and the current operating data for the partnership

## Method

1. Score the partnership on the seven dimensions named in `jv-lifecycle-governance` step 2 (performance, people, partner alignment, decision health, milestones and funding, governance health, value-distribution symmetry). The dimensions are referenced from the procedure, not redefined here.
2. For an alliance, compare outcomes to date against the selection rationale and record what has diverged and why.
3. Flag dimensions with missing or stale data as UNKNOWN rather than scoring them.

Weights and review cadence are a thresholds-meeting item (ADR-0052 question b) and are not decided by this skill.

## Artifacts

- `jv_health_scorecard`
- `alliance_post_launch_review`

## Boundaries

- Output is a proposal; only a person records a decision on the partnership.
- Not partner sourcing (`partner-sourcing-strategy`), screening (`partner-due-diligence`) or structuring (`jv-structuring`).

## Could not verify

Every scorecard ends with a section listing what the reviewer could not check (unavailable partner data, unaudited figures, dimensions scored UNKNOWN). Silence is never read as approval.
