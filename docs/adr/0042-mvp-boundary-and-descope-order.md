# ADR-0042: MVP boundary and descope order

**Status**: Accepted
**Date**: 2026-08-20
**Deciders**: risk-officer, pm

## Context

A design this large risks the failure mode of attempting everything simultaneously and completing nothing; a descope path decided under schedule pressure, rather than in advance, tends to cut the wrong things.

## Decision

Fix three tiers in advance: MVP (non-negotiable — five-layer docs, one shared + one entity procedure, stage gates + two-tier approval, glossary, information protection, DB core, CLI, financial/proxy-chain analysis, RAG, report output), Tier 2 (deferrable — web UI, auth, auto-monitoring, MCP, 3 region profiles), Tier 3 (follow-on release). Information protection is explicitly the one MVP item that cannot be descoped, since it constrains schema and API from day one (see ADR-0038/0039/0040).

## Consequences

If schedule pressure forces a cut, it is made from Tier 3 first, Tier 2 second — the order is decided now, not under pressure later.
