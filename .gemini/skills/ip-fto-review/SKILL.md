---
name: ip-fto-review
scope: co-newbiz
description: >
  Implements step 3.5 of `brownfield-dd` (R&BD deals only): the patent
  landscape, freedom-to-operate position and target IP valuation finding
  that `rbd-technology-checklist.yaml` requires. Not a TRL, capex or EHS
  review (technical-due-diligence) and not a contract or statute review
  (legal-due-diligence).

  Use when: "freedom to operate", "FTO", "IP landscape", "patent landscape",
  "target IP valuation", "technology license-in IP position".
version: 1.0.1
status: experimental
owner: ip-agent
prerequisites: none
lifecycle:
  phase: draft
metadata:
  type: domain
  procedure_keys:
    - brownfield-dd
    - greenfield-dd
  triggers:
    - freedom to operate
    - FTO
    - IP landscape
    - patent landscape
    - target IP valuation
---

# ip-fto-review

## Context

Owned by `ip-agent`. `brownfield-dd` step 3.5 is authoritative for when this runs; this skill carries only how, and never restates the procedure.

## Inputs

- Technology description
- Claimed patents and the target's own IP portfolio
- License terms (license-in or license-out)

## Method

1. Declare the landscape search scope together with its limits (databases, date range, jurisdictions, languages).
2. Map claims to the product or process as described.
3. Grade the FTO conclusion by evidence nature, never as an unqualified clearance.
4. Value the target's own IP as an asset, with the basis stated.

## Artifact

`dd_finding`, carrying a `value_impact` or an `assumption_key` so it moves the valuation (`dd-to-valuation-bridge`).

## Boundaries

- Output is a proposal; an FTO conclusion without counsel review stays a proposal and statute questions route to `legal-counsel`.
- Not TRL, capex or EHS review (`technical-due-diligence`) and not contract or statute review (`legal-due-diligence`).

## Could not verify

Every finding ends with a mandatory section listing what could not be checked (unsearched jurisdictions, unpublished applications, claim construction not confirmed by counsel). Silence is never read as approval.
