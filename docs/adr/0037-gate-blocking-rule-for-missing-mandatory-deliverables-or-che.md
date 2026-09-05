# ADR-0037: Gate-blocking rule for missing mandatory deliverables or checklist items

**Status**: Accepted
**Date**: 2026-08-20
**Deciders**: compliance-officer, process-governance-manager

## Context

A regulation that lives only in a document, with no system-level consequence for skipping a required step, is not actually enforced — it is a norm the system happens to be consistent with by accident.

## Decision

A gate is blocked automatically if a required deliverable is missing or a mandatory checklist item is incomplete, unless an active (non-expired) waiver covers the specific gap. This is the mechanism, not a policy statement — see `docs/governance/governance-operations.md` §1.

## Consequences

Verification requires the reverse case to also hold: a gate must NOT block on a missing recommended (non-mandatory) item — it should instead require a stated reason (design §12 governance-operations verification).
