---
name: forward-industry-research
scope: co-newbiz
owner: market-intelligence-agent
lifecycle:
  phase: draft
status: experimental
version: "1.1.0"
description: >
  Implements step 3.5 of `greenfield-screening` and `brownfield-screening`: the forward and upstream industry research narrative (ADR-0066) covering where the industry is heading, drawn from industry profiles and external sources. Does not size the market (systematic-market-sizing).
  Use when: "industry research", "industry outlook", "sector research", "forward industry view".
metadata:
  procedure_keys:
    - greenfield-screening
    - brownfield-screening
  triggers:
    - industry research
    - industry outlook
    - sector research
    - forward industry view
---

# forward-industry-research

Owned by `market-intelligence-agent`. Referenced from: `greenfield-screening` and `brownfield-screening` (forward-industry-research step); ADR-0066.

The owning procedure is authoritative for what happens and when; this skill carries only how to do the work and never restates procedure steps.

## Artifact

`forward_industry_research` narrative with cited sources and unverified claims marked.

## Boundaries

- Output is a proposal; only a person records a decision, gate verdict or waiver.
- State explicitly what could not be verified; silence is never read as approval.
- Status stays `experimental` until the skill-existence bar (distinct trigger, owner, non-trivial artifact) is demonstrated.
