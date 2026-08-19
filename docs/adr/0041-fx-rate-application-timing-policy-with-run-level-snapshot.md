# ADR-0041: FX rate application timing policy with run-level snapshot

**Status**: Accepted
**Date**: 2026-08-20
**Deciders**: financial-analyst

## Context

Overseas M&A valuations are materially sensitive to whether transaction-date, period-average, or period-end FX rates are used for a given line item, and this choice was previously unspecified (meeting G4).

## Decision

`fx_policy(scope, rate_type, source_series_id)` fixes the rate type by item category — period-average for P&L items, period-end for balance-sheet items, contract-date for transaction consideration. Every run snapshots the rate actually applied and its source series for later reproduction.

## Consequences

Closes a design gap identified by financial-analyst at the pre-review meeting (G4) — see design §9 and CHANGELOG history.
