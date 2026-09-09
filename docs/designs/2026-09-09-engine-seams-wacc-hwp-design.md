# Wave C1/C2 — Engine seams: WACC input session and HWP extraction

Date: 2026-09-09
Status: implemented in Wave C branch

## Problem
Two engine seams were still implicit:

1. Business-case valuation used a hardcoded 10% WACC, while the WACC input-session skill required a human-confirmed `kind='user'` assumption before FS gates.
2. `.hwpx` generation existed, but legacy binary `.hwp` extraction was documented as deferred.

## Decision — WACC
Project WACC is stored through the existing run-scoped assumption registry rather than a new project column. `POST /api/projects/{id}/wacc` creates a new versioned run snapshot with `run_input.wacc` (and optional `run_input.hurdle_irr`) and writes matching `assumption` rows with exact keys `wacc` / `hurdle_irr`, `kind='user'`.

Resolution order:

1. user-confirmed `assumption.assumption_key='wacc'` for any run on the project;
2. latest `run_input.wacc` if a snapshot exists without the assumption row;
3. deterministic 10% fallback with `source='default'` provenance.

The business-case generator and Monte Carlo run bridge both call the shared resolver. The fallback is allowed for backwards compatibility but is labeled as default provenance, so it cannot be mistaken for a gate-ready user confirmation.

## API and UI

- `GET /api/projects/{id}/wacc` returns `{ wacc, hurdle_irr }` with provenance.
- `POST /api/projects/{id}/wacc` is analyst+ and deny-by-default project-visible; viewers cannot write.
- `/projects/{id}/wacc` provides the direct-entry UI and links from project sub-navigation.

## Decision — HWP extraction
Port the legacy HWP 5.0 text extractor as `python/extract_hwp.py`, add `olefile` to `python/requirements.txt`, and wire `bun scripts/co-newbiz/newbiz.ts hwp-extract <file.hwp> [--output out.txt]`. The extractor reads OLE `BodyText/Section*` streams, decompresses when the HWP FileHeader flag requires it, and extracts `HWPTAG_PARA_TEXT` records as UTF-16LE text.

The extractor is intentionally text-only. Layout reconstruction and template fidelity remain report-authoring tasks, not parser output.

## Tests

- WACC route/helper regression covers default provenance, user session rows, viewer denial, business-case use of confirmed WACC, and Monte Carlo preference for user WACC over legacy `sim.discount_rate`.
- HWP parser regression uses a deterministic unpacked BodyText section fixture so CI does not need a proprietary HWP sample or `olefile` installed for that parser-level check.

## Out of scope
CAPM component UI, external market-rate fetching for risk-free rates, hurdle policy decisioning, and binary `.hwp` layout reconstruction are deferred.
