---
name: company-intelligence
scope: co-newbiz
owner: market-intelligence-agent
lifecycle:
  phase: draft
status: experimental
version: "1.1.0"
description: >
  Implements step 2 of `company-profile-analysis` and step 2 of `brownfield-target-identification`: external research on a company or a candidate target population (analyst reports, industry trends, public sources) producing the research pack and the target longlist. Does not cover financial statement analysis (historical-financial-analysis).
  Use when: "company research", "company profile", "corporate intelligence", "target longlist".
metadata:
  procedure_keys:
    - brownfield-target-identification
    - company-profile-analysis
  triggers:
    - company research
    - company profile
    - corporate intelligence
    - target longlist
---

# company-intelligence

Owned by `market-intelligence-agent`. Referenced from: `company-profile-analysis` step 2; `brownfield-target-identification` step 2.

The owning procedure is authoritative for what happens and when; this skill carries only how to do the work and never restates procedure steps.

## Artifact

`company_profile_research_pack` and `target_longlist`, each with sources and evidence nature per item.

## Boundaries

- Output is a proposal; only a person records a decision, gate verdict or waiver.
- State explicitly what could not be verified; silence is never read as approval.
- Status stays `experimental` until the skill-existence bar (distinct trigger, owner, non-trivial artifact) is demonstrated.
