# ADR-0005: Run-based versioning and attribution

**Status**: Accepted
**Date**: 2026-08-20
**Deciders**: data-architect, valuation-agent

## Context

Every model output must be traceable to the exact inputs, assumptions, and code path that produced it, including simulations.

## Decision

Every analysis produces a `run` row with an immutable `run_input` snapshot and `input_hash`; every simulation additionally records its `seed`. Documents record `superseded_by` chains. Report covers print run id / as_of / input_hash / version / policy_version automatically.

## Consequences

Re-running with the same seed and inputs must reproduce identical output — this is a verification gate (design §12), not just a nice-to-have.
