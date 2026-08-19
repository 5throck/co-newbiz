# ADR-0021: Policy-change-to-system pipeline and project_policy_pin

**Status**: Accepted
**Date**: 2026-08-20
**Deciders**: process-governance-manager, compliance-officer

## Context

Without a pinning mechanism, a regulation amendment would retroactively change the grading of every in-flight project the moment it takes effect, with no record of why a project changed from Green to Red overnight.

## Decision

Every project pins the policy version in effect at its start (`project_policy_pin`). Regulation changes flow through impact analysis -> change plan -> system reflection -> an explicit retroactivity decision (`policy_change`) -> notification. Silent application to in-flight projects is never allowed.

## Consequences

This is the single mechanism protecting against the design's problem #9 (regulation changes without system reflection) recurring in the other direction — a system reflection without controlled rollout.
