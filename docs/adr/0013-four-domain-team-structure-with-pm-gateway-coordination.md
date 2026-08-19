# ADR-0013: Four-domain team structure with PM Gateway coordination

**Status**: Accepted
**Date**: 2026-08-20
**Deciders**: pm, process-governance-manager, platform-lead, industry-lead, region-lead

## Context

The team spans governance authorship, system engineering, and profile-driven industry/region expertise — three different kinds of work that don't share reviewers well if flattened into one roster.

## Decision

Split into four domains (functional, technical, industry, region) plus `_core`/`_shared`, each with a domain lead who is a design/review owner, not a dispatcher. The workspace's flat PM Gateway is preserved in full — PM asks leads for domain plans, then dispatches specialists itself.

## Consequences

Domain leads give PM a compressed, expert first pass on each area without weakening the single-point-of-dispatch guarantee the PM Gateway exists to protect. See meeting M0 for the boundary/interface ratification.
