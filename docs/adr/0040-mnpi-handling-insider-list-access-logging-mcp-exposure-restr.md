# ADR-0040: MNPI handling: insider list, access logging, MCP exposure restriction

**Status**: Accepted
**Date**: 2026-08-20
**Deciders**: legal-counsel, security-engineer

## Context

Deals involving publicly listed counterparties are subject to insider-trading regulation, which the base project-membership model does not by itself satisfy — regulators expect a maintained access list, not just an access control list.

## Decision

`mnpi_flag=true` projects auto-generate and maintain an `insider_list`, log every access to `data_access_log`, and are excluded from MCP tool responses by default (a scoped token is required to override, and that access is itself audited).

## Consequences

The insider list must be regulator-ready at any time — this is treated as a standing operational output, not a report generated on demand.
