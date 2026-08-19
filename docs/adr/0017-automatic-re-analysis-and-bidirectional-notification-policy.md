# ADR-0017: Automatic re-analysis and bidirectional notification policy

**Status**: Accepted
**Date**: 2026-08-20
**Deciders**: backend-engineer, sre

## Context

External data changes (rates, FX, commodity prices) should trigger re-evaluation without a human having to remember to check, but naive re-triggering risks alert fatigue and one-directional (improvement-only) notification hides deterioration.

## Decision

OS-level scheduler (not an in-process timer, which dies with the app) drives fetch -> impact detection -> auto-rerun -> RAG re-evaluation -> notification. Notifications fire on both improvement and deterioration, with per-(project, trigger_type) cooldown and hysteresis to prevent fatigue.

## Consequences

Deterioration alerts are non-optional — an in-flight deal quietly getting worse is a larger loss than a missed opportunity, per the design's explicit rationale.
