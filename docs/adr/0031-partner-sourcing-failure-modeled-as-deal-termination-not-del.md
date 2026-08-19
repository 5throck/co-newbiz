# ADR-0031: Partner-sourcing failure modeled as deal termination, not delay

**Status**: Accepted
**Date**: 2026-08-20
**Deciders**: partnership-agent, risk-officer

## Context

A business that structurally cannot proceed without a partner (e.g. requires local JV participation by regulation, or requires a technology license) treats partner-sourcing failure as if it only pushes the timeline back, understating its severity.

## Decision

Where the business model has a hard partner dependency, model partner-sourcing failure as a Kill Criteria candidate — deal termination — not a schedule slip. This is decided per-project based on whether the dependency is structural.

## Consequences

Prevents a valuation from silently assuming a partner materializes on schedule when the underlying business case cannot function without one at all.
