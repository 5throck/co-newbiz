---
name: assumption-audit
scope: co-newbiz
description: >
  Audits every `assumption` row's `kind` tag (`user`/`assumed`/`derived`)
  for correctness — a `kind='assumed'` entry requires a non-empty
  `rationale`, rejected server-side otherwise; an untriangulated claim is
  never silently upgraded to `derived`; a load-bearing figure (WACC, hurdle
  IRR) must be `user`, never `assumed`, before its gate opens.

  Use when: "assumption audit", "kind=assumed rationale", "assumption
  registry review", "is this assumption load-bearing".
version: 1.0.0
last_reviewed: 2026-08-20
status: active
owner: process-governance-manager
prerequisites: none
metadata:
  type: process
  triggers:
    - assumption audit
    - kind=assumed rationale
    - assumption registry review
    - is this assumption load-bearing
---

## Context

Three `kind` values, three distinct evidentiary standards: `user` (a human
explicitly confirmed this figure — `wacc-input-session`'s WACC/hurdle IRR),
`derived` (computed from other data via a stated method —
`unit-conversion-calibration`'s calibrated beta), `assumed` (a judgment
call standing in for missing data, requiring a non-empty `rationale` —
rejected server-side otherwise). `expert-interview`'s rule is the sharpest
illustration of getting this wrong in practice: an untriangulated claim
(fewer than 2-3 independent sources) feeding a valuation assumption must be
tagged `assumed` with the limitation stated in `rationale`, never `derived`
— confidence in an assumption's tag should never exceed the actual
evidentiary strength behind it.

## When to Use

- Reviewing an assumption registry for a project before a gate decision
- Any figure feeding the financial model that hasn't had its `kind` explicitly checked

## Execution Steps

1. **Pull the project's full assumption registry** — every figure feeding
   `investment-feasibility-modeling`, `growth-projection-modeling`, or the
   RAG dimensions
2. **Check `kind='assumed'` rows have a non-empty, substantive `rationale`**
   — not a placeholder string; the rationale should explain what's missing
   and why this particular assumption is reasonable in its absence
3. **Check `kind='derived'` rows cite their method** — a derived figure
   without a stated calculation method is functionally indistinguishable
   from an unjustified assumption
4. **Check for a load-bearing figure incorrectly tagged**: WACC/hurdle IRR
   must be `user` before FS gate (checklist bf-02); an untriangulated
   expert-interview claim must be `assumed`, not `derived`
5. **Flag any assumption whose `ttl` (time-to-live) has expired** — a
   stale assumption still marked current is a silent staleness risk
6. **Escalate any load-bearing `assumed` figure** to the relevant domain
   owner for confirmation before the gate proceeds, rather than letting an
   assumption quietly carry more weight than its tag implies

## Output Format

- Assumption audit report: per-assumption `kind` correctness check, missing/
  weak rationale flags, load-bearing-figure mistagging flags, stale-TTL flags

## Related Skills

- `wacc-input-session` — the canonical `kind='user'` confirmation pattern
- `expert-interview` — the `assumed`-vs-`derived` triangulation rule
- `run-versioning-and-attribution` — the companion provenance discipline for runs, not assumptions
