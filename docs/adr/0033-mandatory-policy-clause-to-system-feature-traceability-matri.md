# ADR-0033: Mandatory policy-clause-to-system-feature traceability matrix

**Status**: Accepted
**Date**: 2026-08-20
**Deciders**: process-governance-manager, data-architect

## Context

Without an explicit mapping from regulation clause to implementing system feature, `policy:impact` (the tool that identifies what a regulation change should update) has nothing concrete to compute against.

## Decision

Stage 4 must produce `docs/governance/traceability-matrix.md` mapping every mandatory-tier regulation clause through procedure step, system requirement, implementation, and test.

## Consequences

This is the mechanism that makes ADR-0021's policy-change pipeline actually executable rather than aspirational — closing the loop back to design problem #9.
