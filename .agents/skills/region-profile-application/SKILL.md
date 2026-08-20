---
name: region-profile-application
scope: co-newbiz
description: >
  Applies `region-profiles/*.yaml`'s mandatory review axes (merger control,
  foreign investment screening, labor, tax, FX/repatriation, anti-corruption,
  sanctions screening, data transfer, environmental-liability succession,
  incentives) to a project's target region, and never fabricates a missing
  section — an unsourced or empty axis is a research gap to close, not a
  placeholder to fill with a plausible guess (ADR-0023, `_validate.ts`
  rejects unsourced sections).

  Use when: "apply the region profile", "region review axes", "region
  profile gap", "cross-border review checklist".
version: 1.0.0
last_reviewed: 2026-08-20
status: active
owner: region-lead
prerequisites: none
metadata:
  type: domain
  triggers:
    - apply the region profile
    - region review axes
    - region profile gap
    - cross-border review checklist
---

## Context

The schema (`region-profiles/_schema.yaml`) fixes 10 mandatory axes below
`code`/`name_ko`/`typical_closing_weeks`, each requiring `source`,
`verified_on`, and `maintainer` — not just at the file level, but per
section, because cross-border review is easy to under-specify per region
and easy to silently omit an axis that turns out decisive (the EU
works-council consultation example is the ADR's own illustration of a
missed-axis failure mode). Five profiles exist today: KR and EU (shipped
first per meeting M1/O-2, shipbuilding-adjacent industry with Korea+EU
targets), plus US/CN/SEA as an initial draft (design task 2.5) — one lead
agent covers all regions via profile data, not a dedicated agent per region
(ADR-0024's scale-via-profile-count principle).

## When to Use

- A project's target region needs its full review-axis checklist applied
- A region profile axis is missing, stale, or the project needs a region
  not yet covered by an existing profile

## Execution Steps

1. **Load the target region's profile** (`region-profiles/<CODE>.yaml`) —
   if none exists, this is itself a finding: flag the gap rather than
   improvising review content from general knowledge
2. **Walk all 10 mandatory axes** — merger control, foreign investment
   screening, labor, tax, FX/repatriation, anti-corruption, sanctions
   screening, data transfer, environmental-liability succession, incentives
   — do not skip an axis because it seems inapplicable at first glance;
   record "not applicable" with reasoning rather than silently omitting it
3. **Check provenance freshness**: each section's `verified_on` date — a
   stale verification on a regulatory axis (labor law, tax treaty terms) is
   a real risk, not a formality; flag for re-verification if materially old
4. **Never fabricate a missing or empty section** — `_validate.ts` rejects
   an unsourced section at the schema level, and this rule holds at the
   analysis level too: a genuinely unresearched axis is reported as a gap,
   never filled with a plausible-sounding but unverified guess
5. **Feed the applicable axes into the relevant domain skill**: labor →
   `talent-pipeline-planning`/`org-readiness-assessment`, tax/FX →
   `investment-feasibility-modeling`, sanctions → `partner-due-diligence`,
   incentives → `regional-incentive-sourcing`

## Output Format

- Region review-axis application: per-axis finding with source/verified_on,
  explicit gap flags for missing/stale axes

## Related Skills

- `industry-profile-application` — the parallel industry-side profile discipline
- `regulation-monitoring` — the ongoing statute-watch that keeps a profile axis current
