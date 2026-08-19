# ADR-0018: Growth projection anchoring

**Status**: Accepted
**Date**: 2026-08-20
**Deciders**: financial-analyst, quant-methodologist

## Context

Growth forecasts derived from proxy-chain industry growth and peer benchmarks can silently drift into hockey-stick territory without an explicit anchor back to historical or peer distributions.

## Decision

Every derived growth assumption carries an `anchor_ref` pointing to its source data. A forecast landing outside the top 10% of the historical/peer distribution triggers an automatic base-rate warning rather than passing silently.

## Consequences

This converts optimism bias from a qualitative risk into a mechanically checkable one (verification step 7, design §12).
