---
name: systematic-market-sizing
scope: co-newbiz
description: >
  Eight-step systematic market sizing and validation method, distilled from
  the hydraulic-breaker region×segment×scenario engagement (2026-08) and
  applied to every new market sizing task. Covers axis definition, anchor
  triangulation, region×segment allocation, scenario bands, bottom-up vs
  top-down consistency checking, first-party (company filing)
  cross-validation, a limitations register, and formal registration into the
  assumption registry.

  Use when: "market sizing", "TAM/SAM/SOM", "market matrix", "region×segment
  demand estimate", "market cross-validation against filings", "scenario
  bands for market size".
version: 1.2.0
last_reviewed: 2026-08-31
status: active
owner: market-intelligence-agent
prerequisites:
  - proxy-industry-chain
  - scenario-planning
metadata:
  procedure_keys:
    - brownfield-fs
    - greenfield-fs
  type: domain
  triggers:
    - market sizing
    - TAM SAM SOM
    - market matrix
    - region segment demand estimate
    - market cross-validation
    - scenario bands
relates_to:
  - skill: proxy-industry-chain
    type: follows
  - skill: scenario-planning
    type: composes_with
  - skill: evidence-ledger
    type: enables
  - skill: assumption-audit
    type: enables
---

## Context

This skill fixes the PROCEDURE that produced the co-newbiz hydraulic-breaker
market matrix so future sizings follow the same discipline instead of being
re-derived ad hoc. The deliverable of the procedure is always a frozen
research document (`docs/research/<topic>-<year>-<descriptor>.md`) whose
final tables are registered into the assumption registry — a sizing that
never reaches the registry is not finished.

## The Eight Steps (apply in order; document each in the research doc)

### Step 1 — Define the axes and the proxy structure
Fix the three axes up front: **region × end-use segment × scenario**. Choose
region groupings that match how data actually disaggregates (e.g. China
separated from APAC when China dominates unit volume). Identify the proxy
chain (per `proxy-industry-chain`) and note which hops are statistical vs
analytical — the statistical-hop count caps the chain grade (A/B/C) and that
grade caps every downstream conclusion.

### Step 2 — Anchor the total with triangulation, not a single source
Collect at least 2–3 independent vendor/analyst estimates of the baseline-year
total. Pick a rounded consensus anchor; **explicitly exclude outliers** and
record the exclusion. The anchor total is the one number all later
allocations must reconcile to.

### Step 3 — Allocate region weights and segment mix
Regional weights come from the nearest adjacent market with real disclosure
(e.g. construction-equipment regional splits for an attachments category).
Segment mix per region is a **qualitative allocation calibrated to the global
cross-check**, not a bottom-up sum — say so in the doc; do not present it as
sourced data. Every judgmental adjustment (e.g. a regulatory premium on one
region's segment) is recorded in the table's "key adjustment applied" column
with its source.

### Step 4 — Differentiate CAGRs by region×segment; set scenario bands
One CAGR per region×segment cell, not one global rate. Scenario bands
(down/base/up) follow one documented band shape around base unless specific
cells have **documented disagreement between source classes** — those get an
explicit wider override band, and the disagreement is the first item to
resolve if better data arrives.

Scenarios are applied REGION-RESOLVED, never as a single global CAGR: each
region's down/base/up 2030 projection compounds its own cell CAGRs (4-year
compound from the baseline), and the global roll-up per scenario is the sum
of those regional projections. A global-rate shortcut would erase the
regional character the matrix exists to capture.

### Step 4-A — Track year-by-year market share (separate report section)
Between growth rates (step 4) and verification (step 5), present the market
structure's evolution OVER TIME as its own report section: compound each
cell's base CAGR year by year and show region shares and sizes for every
year of the horizon (stacked area of shares, stacked bars of sizes, and a
per-year share table with the global total row). This makes structural
shifts (which region gains / loses share, and when) visible instead of
collapsing the horizon to a single end-year delta.

### Step 5 — Run the bottom-up vs top-down consistency check
Roll the matrix up to an implied global CAGR and compare against the top-down
consensus rate. Within tolerance → it is an **internal consistency check
only**; both sides ultimately trace to the same class of vendor reports, so
it must NOT be described as independent confirmation. Outside tolerance →
stop and reconcile the allocation before proceeding.

### Step 5-B — External forecast gap analysis (when a future estimate exists)
Our projections are CAGR extrapolations of historical drivers. When a PUBLIC
future estimate for the industry can be obtained (vendor forecast for a
target year), compare it against our extrapolation for the same year:
record the external source, target-year size, and implied CAGR; compute our
size and the gap %. If the two diverge, the historical drivers alone do not
explain the future — analyze WHICH factors close the gap (new or
strengthened drivers: demand triggers, regulation, technology shifts,
substitutes) and record them as `newDrivers` alongside the gap analysis.
If no external forecast is obtainable, keep the CAGR extrapolation as-is —
never invent one. The gap analysis feeds S2 (opportunity discovery) as market insight:
opportunity growth-rate and attractiveness scoring should use the
gap-aware driver view, not the naive extrapolation.

### Re-analysis and versioning
An analysis is a versioned artifact, never a one-shot. Re-run the pipeline
(a new append-only version) when: the previous run FAILED mid-pipeline, the
analysis date goes stale (default guidance: >90 days), or a better source
arrives. Every re-run lands `version N+1` with a changelog line; prior
versions are preserved so decisions can cite the exact version they relied
on. Freezing + registry registration (step 8) applies to the version an
analyst has confirmed — unconfirmed pipeline output stays flagged as
`llm-estimate` and must not be cited as verified.

### Step 6 — Cross-validate against first-party company sources
Go to the actual annual reports / interim reports / filings of listed players
in the category. Validate each matrix claim that CAN be validated
(direction of segment growth, regional market rankings, M&A signaling segment
importance) with quoted language. Then **explicitly list what could NOT be
validated** — when a category is bundled inside larger reporting units
(attachments within a tools division, a brand within a parent's equipment
revenue), region×segment revenue is structurally unavailable from public
filings; record this as a structural disclosure limit, not a search gap, and
name the paid sources (e.g. Off-Highway Research, KHL Yellow Table) that
would close it.

### Step 7 — Register the limitations
The research doc carries a numbered "Known Limitations" section. Each
judgmental calibration, source disagreement, and non-extrapolatable signal
(e.g. a low-base rebound) gets its own numbered entry. Re-state the chain
grade cap so no consumer of the matrix presents it above its confidence.

### Step 8 — Formally register into the assumption registry
Per the registry-backed evidence plane (`docs/evidence/README.md`) and the
research doc's "Next Steps for Formal Registration" section, once a project
run exists:
- one row per combination (`kind='assumed'`), key naming
  `<product>.<metric>.<scenario>.<region>.<segment>`
- every row carries `rationale` (including the adjustment basis) and
  `anchor_ref` pointing at the source doc's section
- rows get a `ttl_days` appropriate to the data's freshness horizon
- write through `recordAssumption` (the FR-DATA-07 enforcement path) —
  see `scripts/co-newbiz/register-hydraulic-breaker-assumptions.ts` as the
  reference implementation
- the registry is append-only: corrections land as new rows under the
  supersede discipline, never as edits

## Output Contract

A sizing is complete when ALL of the following exist:
1. `docs/research/<topic>-<year>-<descriptor>.md` with the eight steps
   documented, frozen tables, full source list, and limitations register.
2. A registration script (or direct `recordAssumption` calls) that lands the
   matrix rows in the assumption registry, committed alongside the doc.
3. A CHANGELOG entry recording the sizing and its registration.
4. A /market report page section set covering all steps — including the
   region-resolved scenario projections (step 4) and the year-by-year
   market-share section (step 4-A) — with a live step-8 registry status view.

## Terminology (use these labels consistently)

This skill file is English-only per the workspace language policy; the
approved Korean UI labels for each step live in the `STEPS` constant of
`app/web-next/lib/market-sizing.ts` — that constant is the single source of
truth for step labels in UI and Korean deliverables. When writing or
referring to steps, use the concepts below (not the deprecated jargon):

| Step | Concept | Deprecated jargon (do not use) |
|---|---|---|
| 1 | Axis and proxy-structure definition | — |
| 2 | Baseline market sizing via multi-source cross-estimation | "anchor triangulation" |
| 3 | Region and segment allocation | — |
| 4 | Per-cell CAGRs and scenario bands | — |
| 4-A | Year-by-year market-share trend | — |
| 5 | Growth-rate consistency check (bottom-up vs top-down) | bare "consistency check" |
| 6 | Cross-validation against company filings | "first-party source cross-validation" |
| 7 | Known-limitations list | "limitations register" |
| 8 | Assumption-registry registration | bare "registry registration" |

## Anti-patterns (refuse these)

- A single-source total presented as the market size.
- Region×segment tables presented as bottom-up sums when they are calibrated
  allocations.
- Scenarios applied as one global CAGR instead of region-resolved cell CAGRs
  (step 4) — this erases the regional differentiation the matrix exists to
  capture.
- Collapsing the projection horizon to a single end-year delta with no
  year-by-year share view (step 4-A).
- Cross-validation against vendor reports described as independent
  confirmation.
- A finished matrix left unregistered because "no project run exists yet" —
  write the registration script anyway (Step 8), so registration is one
  command once the run appears.
