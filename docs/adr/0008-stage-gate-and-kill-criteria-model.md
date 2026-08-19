# ADR-0008: Stage Gate and Kill Criteria model

**Status**: Accepted
**Date**: 2026-08-20
**Deciders**: process-governance-manager, risk-officer

## Context

New-business review needs a small number of hard stop conditions distinct from the softer RAG grading, so a genuinely non-viable deal is not carried forward by inertia.

## Decision

Define an explicit, binding Kill Criteria list at the group-policy level (`policies/group/neb-policy.md` §4), separate from the six-dimension RAG framework. A Kill Criteria hit halts the project; only Group IC can override, and only with an explicit decision.

## Consequences

Kill Criteria are policy content, not code — an amendment goes through the standard policy-change pipeline (`docs/governance-operations.md` §5), not an ad hoc edit.
