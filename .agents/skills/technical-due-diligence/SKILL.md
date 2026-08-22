---
name: technical-due-diligence
scope: co-newbiz
description: >
  Runs the technical DD checklist — site visit with evidence capture, TRL
  assessment, bottleneck identification, remaining useful life, EHS
  liability, and an independently-verified capex plan (never accepted from
  management as-is). `checklists/technical-dd-checklist.yaml` tdd-01
  through tdd-08.

  Use when: "technical due diligence", "capex plan verification",
  "bottleneck process identification", "remaining useful life assessment".
version: 1.1.0
last_reviewed: 2026-08-23
status: active
owner: technical-dd-agent
prerequisites:
  - site-visit-protocol
metadata:
  type: domain
  triggers:
    - technical due diligence
    - capex plan verification
    - bottleneck process identification
    - remaining useful life assessment

  procedure_keys:
    - brownfield-dd
---

## Context

tdd-07's rule is specific and easy to skip under time pressure: the
target's capex plan must be independently verified against the physical/
technical findings from the site visit, not accepted from management as-is
— a plausible-looking capex schedule that doesn't reconcile against the
actual equipment condition and remaining useful life observed on-site is a
red flag, not a formality to wave through. tdd-08 (certification status) is
recommended, deliberately not duplicating `certification-agent`'s own
tracking — this checklist item is a cross-reference, not a parallel record.

## When to Use

- Brown Field DD, always
- Green Field, for technology/process feasibility assessment of a planned facility

## Execution Steps

1. **Site visit with evidence capture** (`site-visit-protocol`) — tdd-01/02
2. **Technology readiness level (TRL)** for core production processes —
   tdd-03
3. **Bottleneck processes** — identify constraints on throughput, not just
   list every process step — tdd-04
4. **Remaining useful life of key equipment** — tdd-05, based on
   site-visit observation, not the target's stated equipment age alone
5. **EHS liability exposure** — tdd-06, feeds
   `debt-and-contingent-liability-simulation`'s environmental contingent-liability entry
6. **Independently verify the capex plan** against the physical/technical
   findings — tdd-07, mandatory, this is the step most likely to surface a
   material gap between the target's plan and reality
7. **Confirm certification status of key production lines** (recommended,
   tdd-08) by cross-reference to `certification-agent`'s tracking, not a
   duplicate assessment

## Output Format

- Technical DD findings: TRL, bottlenecks, remaining useful life, EHS
  exposure, independently-verified capex plan (with reconciliation notes
  against site findings)

## Related Skills

- `site-visit-protocol` — the evidence-capture prerequisite
- `debt-and-contingent-liability-simulation` — the EHS-exposure consumer
- `dd-to-valuation-bridge` — where these findings connect to valuation
