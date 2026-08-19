# Manual Pilot Records

**Owner**: pm, process-governance-manager
**Design of record**: design v1.0 §10 (Stage 3.5), ADR-0034 (manual-pilot-first principle)

> Design v1.0 §10 refers to a single `docs/pilot-report.md`. This directory generalizes that into **one file per pilot case**, per the user's instruction (2026-08-20) that more cases are expected to follow — a single-file assumption would force awkward append-only editing or overwriting of a completed pilot's record. This is a documentation-organization choice, not an architectural one: when Stage 5 builds the system, each entry here becomes a `pilot` record (or equivalent), and this directory's structure maps directly to that.

## Index

| # | Case | Type | Status | Report |
|---|---|---|---|---|
| 001 | HD Hyundai / STX Heavy Industries (2024) | Brown Field | In progress | [pilot-001-hd-hyundai-stx-heavy-industries.md](pilot-001-hd-hyundai-stx-heavy-industries.md) |

## Candidate Sourcing

New candidate cases (real, publicly documented — not fabricated, per the design's explicit rule that a synthetic case cannot substitute for the pilot) are researched and logged in `../pilot-candidate-research.md` before being promoted to a numbered entry here. Promotion happens when a candidate is confirmed by the user as the working case for an actual pilot run.

## Two-Consecutive-Failure Rule (ADR-0034)

If two pilot cases in a row fail to complete the process end-to-end (not "the deal would have failed the review" — that's a valid outcome — but "the process itself could not be executed as written"), the project halts progression to system development and returns to process design. This applies across cases in this directory, not per-case.
