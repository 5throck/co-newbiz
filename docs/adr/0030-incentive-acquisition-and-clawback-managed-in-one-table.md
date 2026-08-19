# ADR-0030: Incentive acquisition and clawback managed in one table

**Status**: Accepted
**Date**: 2026-08-20
**Deciders**: incentive-agent

## Context

Treating incentive sourcing (acquisition) and clawback risk (loss on relocation/non-compliance) as separate concerns loses the fact that receiving an incentive creates the very obligation that becomes the clawback risk.

## Decision

Extend the `incentive` table to cover both `direction: prospective | granted`, storing the obligation (`obligation_json`) and clawback rule (`clawback_rule`) on the same record that captures the benefit amount and NPV.

## Consequences

A single record lets `compare_sites` weigh incentive NPV net of clawback exposure in one comparison, rather than requiring the analyst to manually cross-reference two tables.
