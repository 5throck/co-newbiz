# ADR-0010: Web stack: Hono + React/Vite + ECharts

**Status**: Accepted
**Date**: 2026-08-20
**Deciders**: platform-lead, frontend-engineer

## Context

The web tier needs a lightweight API framework and a chart library capable of the RAG dashboards, tornado charts, and CDF/histogram views the design specifies.

## Decision

Hono for the REST API, React/Vite for the SPA, ECharts for visualization — matching the pattern already used elsewhere in the workspace (`Projects/co-architect`).

## Consequences

Consistency with existing workspace tooling reduces onboarding cost for engineers already familiar with the pattern.
