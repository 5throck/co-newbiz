---
name: regulatory-screening
scope: co-newbiz
owner: legal-counsel
lifecycle:
  phase: draft
status: experimental
version: "1.1.1"
description: >
  Implements step 6.5 of `brownfield-dd` and the regulatory screens of S7 and S9: regional labor law review, works council and employment transfer regimes, plus foreign-investment and sanctions screens, read from the region profile and confirmed against source texts. Does not cover merger control filings (antitrust-screening) or certification (certification-roadmap).
  Use when: "regional labor law review", "works council", "employment transfer regime", "regulatory screening".
metadata:
  procedure_keys:
    - brownfield-screening
    - brownfield-dd
    - greenfield-dd
    - greenfield-screening
  triggers:
    - regional labor law review
    - works council
    - employment transfer regime
    - regulatory screening
---

# regulatory-screening

Owned by `legal-counsel`. Referenced from: `brownfield-dd` step 6.5; activity region-labor-review; `antitrust-screening, regulatory-screening` activity in S7 and S9.

The owning procedure is authoritative for what happens and when; this skill carries only how to do the work and never restates procedure steps.

## Artifact

`dd_finding` drawn from the region profile labor axis (and the other screen axes), each with source text reference and value impact where it moves the valuation.

## Boundaries

- Output is a proposal; only a person records a decision, gate verdict or waiver.
- State explicitly what could not be verified; silence is never read as approval.
- Status stays `experimental` until the skill-existence bar (distinct trigger, owner, non-trivial artifact) is demonstrated.
