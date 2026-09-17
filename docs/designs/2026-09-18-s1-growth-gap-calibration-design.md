---
lang: ko
lang_reason: source-material
---

# S1 Growth-Gap Calibration Loop

- Spec ID: `2026-09-18-s1-growth-gap-calibration`
- Date: 2026-09-18
- Status: implemented

## Problem

The S1 headline growth rate (`consistency.bottomUpCagr`) is a deterministic
rollup of LLM-produced per-cell CAGRs. External reference figures
(`consistency.topDownCagr`, `externalForecast`) come from one-shot LLM
prior-knowledge queries: they are not persisted, not sourced, and not
reproducible. A gap computation exists (step 5-B `gapPct` + narrative
`gapAnalysis`/`newDrivers`) but has no threshold, no numeric driver
attribution, and no feedback into the next run — a rerun replays the same
prompts with fresh sampling noise, so the gap never converges. The user
requirement: when our growth rate differs from an external-report-based rate
by 20% or more, identify and analyze the key drivers and CALIBRATE, with the
difference actually shrinking across reruns.

## Requirements (ASD-STE100)

- R1: An analyst can record the external reference (source label required,
  URL optional, target year, external CAGR %, optional external size) per
  industry. A recorded reference is reused verbatim on reruns — the LLM prior
  is a fallback only, and a prior-based forecast is persisted once
  (`captured_from='llm_prior'`) so later runs stop re-rolling the dice.
- R2: When `|our CAGR − external CAGR| / external CAGR ≥ 20%` (constant,
  relative basis), the version records `calibration.triggered = true`, the
  report shows a 보정 필요 badge, and the pipeline runs driver attribution.
- R3: Driver attribution (step 5-C) produces NUMERIC proposals per driver —
  direction, estimated CAGR contribution (percentage points), rationale —
  stored as `status='proposed'`. Nothing is auto-applied.
- R4: A person accepts or dismisses each proposal. Accepted drivers form the
  industry's calibration set and are injected as constraints into the next
  rerun's step-2/step-4 prompts, together with the previous gap and the
  external reference; the run must state its remaining gap.
- R5: Each calibrated version records `calibration {triggered, ourCagrPct,
  externalCagrPct, gapPct, previousGapPct, appliedDrivers}` so the report can
  show the gap trend across versions (convergence is visible).
- R6: Gate semantics unchanged — calibration is advisory for S1 completion
  (the kill criteria stay human decisions).

## Design

### Storage (migration `0113_s1_calibration.sql`)

- `market_external_reference`: id, industry_id UNIQUE-ish (latest wins via
  version_no), source_label NOT NULL, source_url, target_year,
  external_cagr_pct REAL NOT NULL, external_size_b REAL, captured_from CHECK
  IN ('user','web_research','llm_prior'), created_by, created_at. Reads take
  the newest row; writes append (audit-friendly history).
- `industry_driver_calibration`: id, industry_id, version_id (proposal origin),
  driver TEXT NOT NULL, direction CHECK IN ('upside','downside'), impact_pct
  REAL (percentage points of CAGR), rationale TEXT NOT NULL, status CHECK IN
  ('proposed','accepted','dismissed'), proposed_by, decided_by, decided_at,
  created_at.

### Pipeline (`lib/market-sizing-pipeline.ts`)

- Startup (alongside the existing `prev` read): parse the previous payload's
  `consistency.bottomUpCagr`, `externalForecast.gapPct`, and `calibration`;
  load the newest external reference and the accepted calibration drivers.
- Step 2/step 4 prompts: append `buildCalibrationConstraints(...)` when there
  is anything to inject (external reference CAGR, previous gap, accepted
  drivers). The step-4 prompt additionally instructs the model to justify any
  remaining gap.
- Step 5-B: resolve the external forecast — recorded reference first
  (captured_from='user'/'web_research'), else the existing LLM prior query;
  when the prior produces a usable forecast and no user reference exists, the
  result is persisted as a `llm_prior` reference so it stabilizes.
- Gap trigger on the CAGR basis (relative, 20%); when triggered, step 5-C asks
  the LLM for 2-5 numeric driver attributions grounded in the run's research
  and qualitative factors, deletes this industry's previous un-decided
  proposals, and inserts fresh `proposed` rows.
- Payload: `matrix.calibration` per R5; step summaries gain a 5-C entry when
  the loop runs.

### API + UI

- `GET/PUT /api/market-overview/industry/[industryId]/external-reference`
  (PUT analyst+; source_label and external_cagr_pct required).
- `GET /api/market-overview/industry/[industryId]/calibration` — proposals,
  accepted set, and the per-version gap trend. `POST .../calibration/[rowId]`
  with `{action:'accept'|'dismiss'}` (analyst+, audited).
- Market report 5-B section: trigger badge (보정 필요 ≥20%), driver proposal
  cards with 수용/기각, external-reference editor, version gap trend list, and
  a 보정 반영 재분석 button (existing rerun).
- `insights` route exposes `calibration` so S2 keeps the linkage.

### Methodology doc

`.agents/skills/systematic-market-sizing/SKILL.md`: step 5-B gains the
recorded-reference preference and the 20% trigger; a new 5-C documents the
attribution + accept loop (schemaVersion stays; pipeline methodology string
bumps to v1.2.0).

## Test plan

- `tests/unit/market-calibration.test.ts`: trigger math (relative basis,
  boundary at 20%), constraint builder contents, external-reference
  resolution order (user > llm_prior > none), proposal accept/dismiss flow and
  audit — lib-level against scratch SQLite.
- Full gates: `bun run test:unit`, design-lint, migrate + integrity.

## Out of scope

- Automatic (no-human) application of driver adjustments — the accept step is
  deliberately a person's action (boundary #2).
- Deterministic scaling of cell CAGRs (methodology stays LLM-constraint
  based); escalation is a future decision.
