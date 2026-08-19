# ADR-0028: Orthogonal scope x level axes for procedures, with Entity IC gating Group IC

**Status**: Accepted
**Date**: 2026-08-20
**Deciders**: process-governance-manager, group-review-agent

## Context

Procedure organization needs two independent classifications: which organization owns the procedure content (shared/entity/region) and which review stage it belongs to (entity/group) — conflating them makes the two-tier approval chain impossible to express cleanly.

## Decision

Introduce `procedure.scope` (shared/entity/region) and `procedure.level` (entity/group) as orthogonal axes. The system enforces that Entity IC approval is a hard precondition for entering any Group-level procedure — `approval_chain.blocked_reason` records the block explicitly when this is violated.

## Consequences

A project that skips its entity-level gate cannot reach the group agenda by construction, not by convention.
