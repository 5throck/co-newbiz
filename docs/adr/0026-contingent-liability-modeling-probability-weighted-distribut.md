# ADR-0026: Contingent liability modeling: probability-weighted distribution, Monte Carlo integration

**Status**: Accepted
**Date**: 2026-08-20
**Deciders**: valuation-agent, legal-counsel

## Context

Contingent liabilities (litigation, environmental remediation, unfunded pensions, warranty/recall exposure) are usually disclosed as prose, which gives the valuation model nothing to compute against.

## Decision

Each contingent liability carries a probability, an amount distribution (low/expected/high), and an expected timing, integrated directly into the Monte Carlo simulation (`python/monte_carlo.py`) rather than treated as a qualitative footnote.

## Consequences

The output is a P50/P95 NPV impact, not a sentence — verification requires the downside tail to visibly thicken when contingent liabilities are added (design §12).
