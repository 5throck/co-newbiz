# ADR-0044: Industry and region scale via profile count, not agent count

**Status**: Accepted
**Date**: 2026-08-20
**Deciders**: industry-lead, region-lead

## Context

Restates and formalizes ADR-0024's decision as a standing constraint for future roster growth, since profile-driven scaling is easy to accidentally violate once a specific industry or region seems to warrant special attention.

## Decision

New industry or region coverage is added as a profile YAML entry by default. Promotion to a dedicated agent requires meeting the >5-judgment-procedure threshold from ADR-0024, decided explicitly, not by default.

## Consequences

Prevents roster growth from silently reverting to the safety_os per-industry-agent pattern the design deliberately departed from.
