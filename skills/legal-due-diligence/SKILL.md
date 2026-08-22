---
name: legal-due-diligence
scope: co-newbiz
description: >
  Runs buy-side legal due diligence across the standard workstreams —
  corporate standing/cap table, change-of-control and anti-assignment
  contracts, litigation, IP title chain, employment/legal exposure,
  environmental, real estate, data protection, anti-bribery, tax — and
  converts findings into a RAG-rated register mapped to SPA protections
  and valuation adjustments.

  Use when: "legal DD", "change-of-control clause scan", "IP title chain".
version: 1.0.0
last_reviewed: 2026-08-22
status: active
owner: legal-counsel
prerequisites: none
metadata:
  type: process
  triggers:
    - legal DD
    - change-of-control clause scan
    - IP title chain
---

## Context

Legal DD was previously absent from the entity chain — legal-counsel's only
brownfield step was certification transferability (ADR-0051 gap 7). This
skill is the HOW for the DD-grade legal workstream; the procedure steps
that dispatch it (`procedures/_shared/brownfield-dd/schema.yaml` step 5,
`procedures/_shared/entity-establishment-execution/schema.yaml` step 1 for
formation readiness) own the what and when. It is distinct from
screening-level regulatory checks (chk-legal-regulatory) — do not
duplicate those items here.

## When to Use

- At the DD gate on every Brown Field deal, in parallel with the other DD
  workstreams
- At establishment execution, scoped down to formation-readiness items
  (pre-incorporation only — same method, shorter checklist)

## Execution Steps

1. **Work the checklist workstream by workstream** (chk-legal-dd,
   ldd-01..) rather than document-by-document, so each workstream's
   evidence expectation is met explicitly
2. **Rank material contracts by revenue/cost and scan the top set for
   CoC/anti-assignment** — for each hit record the notice period, consent
   requirement, and termination/payment consequence; distinguish
   consent-to-assign (asset deal) from automatic-pass (share deal)
3. **Trace IP title as a chain, not a list** — inventor-to-company
   assignments, inbound/outbound license CoC and sublicensability,
   encumbrances, PIIA coverage; a gap in the chain is a red finding even
   when every individual document looks clean
4. **Rate every finding RAG**: red = deal-structural/remediation required,
   amber = warranty/indemnity protection, green = acceptable
5. **Map red/amber findings to SPA protections** — specific indemnities,
   escrow sizing, conditions precedent — and to valuation via the
   dd-to-valuation-bridge; do not let a legal finding die as prose
6. **Cite Korea-specific doctrine with its caveat**: employment succession
   on business transfer (`영업양도`) is judicial doctrine (Supreme Court
   `2000다8448` line), not statute — individual consent is the safe path;
   KFTC merger-threshold KRW figures — verify against current statute
   before enforcement use
7. **Hand off to the legal-risk-register** for post-discovery tracking;
   this skill discovers, the register maintains

## Output Format

- `dd_finding` records per workstream + a consolidated findings register:
  finding, workstream, RAG severity, SPA-protection mapping, valuation
  impact where quantified

## Related Skills

- `legal-risk-register` — post-discovery tracking across gates; this skill
  feeds it, the register is the standing view
- `certification-transferability` — the permit/certification axis stays
  there; this skill supplies its legal-basis evidence
- `k-law` — Korean statute text lookup for doctrine verification
- `compliance-monitoring` — where red findings needing ongoing watch route
- `dd-to-valuation-bridge` — the valuation side of the SPA-protection map
