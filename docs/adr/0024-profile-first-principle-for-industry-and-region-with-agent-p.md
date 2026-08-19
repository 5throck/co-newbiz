# ADR-0024: Profile-first principle for industry and region, with agent-promotion threshold

**Status**: Accepted
**Date**: 2026-08-20
**Deciders**: industry-lead, region-lead

## Context

Adding a dedicated agent per industry or region (as safety_os does for `semicon-agent`, `battery-agent`, etc.) would make the roster grow unboundedly as coverage expands.

## Decision

Industry and region each get exactly one lead agent, with actual coverage expressed as profile YAML data (`industry-profiles/*.yaml`, `region-profiles/*.yaml`). A dedicated agent is warranted only once a specific industry or region accumulates more than 5 judgment-heavy procedures that resist profile representation (safety_os Tier-1/Tier-2 maturity bar, reused).

## Consequences

The roster scales with profile count, not agent count — this is the reason industry and region each have exactly 1 agent in the 34-agent roster (§1-6/1-7 of the design).
