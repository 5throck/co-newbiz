# ADR-0006: Proxy chain unit-conversion methodology

**Status**: Accepted
**Date**: 2026-08-20
**Deciders**: quant-methodologist, market-intelligence-agent

## Context

Several target industries have no direct market data and must be estimated through upstream proxies (e.g. crankshaft -> marine engine -> ship), which mixes fixed engineering conversions with statistically estimated ones.

## Decision

Distinguish engineering hops (fixed physical coefficients, no confidence penalty) from statistical hops (regression-estimated, confidence-penalized) explicitly at each hop. Chain reliability grade (A/B/C) is driven by the count of statistical hops only — corrected at meeting M4 from an earlier draft that penalized total hop count.

## Consequences

A 2-hop chain with one engineering and one statistical hop can reach Grade B, which would have been impossible under the pre-M4 rule. See `guidelines/proxy-chain-hop-classification.md`.
