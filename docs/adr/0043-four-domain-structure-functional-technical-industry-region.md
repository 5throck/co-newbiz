# ADR-0043: Four-domain structure (functional/technical/industry/region) with PM-lead coordination model

**Status**: Accepted
**Date**: 2026-08-20
**Deciders**: pm, process-governance-manager, platform-lead, industry-lead, region-lead

## Context

See ADR-0013 for the original decision; this entry documents the coordination *model* specifically — how PM interacts with domain leads without weakening the flat PM Gateway.

## Decision

PM's operating loop is: dispatch the four domain leads for domain plans -> fix an execution plan table -> dispatch specialists directly -> domain leads perform read-only review of results. Leads never dispatch specialists themselves.

## Consequences

Ratified at meeting M0 with the full roster present; no boundary disputes were left open.
