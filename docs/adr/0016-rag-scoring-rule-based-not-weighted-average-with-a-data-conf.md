# ADR-0016: RAG scoring: rule-based, not weighted average, with a data-confidence cap

**Status**: Accepted
**Date**: 2026-08-20
**Deciders**: process-governance-manager, financial-analyst, quant-methodologist, risk-officer

## Context

A weighted average across six RAG dimensions can let a strong financial score offset a genuinely disqualifying data-confidence or regulatory gap, which is the opposite of what a stage-gate signal should do.

## Decision

Overall grade is rule-based: Red if any dimension is Red, Green only if all dimensions (including data confidence) are Green, else Amber. Data confidence caps the ceiling — a Grade-B proxy chain cannot support an overall Green regardless of financial strength.

## Consequences

This is the design's single most load-bearing rule (verification gate 14 in design §12) — a 2-hop proxy estimate with strong financials must show Amber, not Green, or the check fails.
