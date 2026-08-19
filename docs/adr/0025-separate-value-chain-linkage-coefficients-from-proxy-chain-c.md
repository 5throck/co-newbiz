# ADR-0025: Separate value-chain-linkage coefficients from proxy-chain coefficients

**Status**: Accepted
**Date**: 2026-08-20
**Deciders**: quant-methodologist, market-intelligence-agent

## Context

Proxy-chain beta (used to estimate a missing market size) and value-chain-linkage beta (used to assess upstream/downstream risk exposure) answer different questions and would corrupt each other if shared.

## Decision

Store `value_chain_link` and `proxy_link` in separate tables with no shared coefficient reference. A code-level check verifies neither reads the other's beta (verification step, design §12).

## Consequences

Keeping the two separate is what lets pass-through-rate-driven margin risk analysis coexist correctly with proxy-chain-driven demand estimation on the same industry pair.
