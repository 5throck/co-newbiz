---
name: market-data-pipeline
scope: co-newbiz
owner: market-intelligence-agent
lifecycle:
  phase: draft
status: experimental
version: "1.1.0"
description: >
  Implements the market-research activity (S1): sourcing, freshness checking and provenance recording of the market series that feed proxy-chain and market-sizing work. Does not estimate demand (systematic-market-sizing) or calibrate chains (proxy-industry-chain).
  Use when: "market data", "data pipeline", "data freshness", "series provenance".
metadata:
  triggers:
    - market data
    - data pipeline
    - data freshness
    - series provenance
---

# market-data-pipeline

Owned by `market-intelligence-agent`. Referenced from: market-research activity in `process/flow.spec.yaml` (S1).

The owning procedure is authoritative for what happens and when; this skill carries only how to do the work and never restates procedure steps.

## Artifact

market data pull log: series, source, as-of date, freshness status and gaps flagged UNKNOWN.

## Boundaries

- Output is a proposal; only a person records a decision, gate verdict or waiver.
- State explicitly what could not be verified; silence is never read as approval.
- Status stays `experimental` until the skill-existence bar (distinct trigger, owner, non-trivial artifact) is demonstrated.
