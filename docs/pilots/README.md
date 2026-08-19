# Manual Pilot Records

**Owner**: pm, process-governance-manager
**Design of record**: design v1.0 §10 (Stage 3.5), ADR-0034 (manual-pilot-first principle)

> Design v1.0 §10 refers to a single `docs/pilot-report.md`. This directory generalizes that into **one file per pilot case**, per the user's instruction (2026-08-20) that more cases are expected to follow — a single-file assumption would force awkward append-only editing or overwriting of a completed pilot's record. This is a documentation-organization choice, not an architectural one: when Stage 5 builds the system, each entry here becomes a `pilot` record (or equivalent), and this directory's structure maps directly to that.

## Index

| # | Case | Type | Status | Report |
|---|---|---|---|---|
| 001 | HD Hyundai / STX Heavy Industries (2024) | Brown Field | In progress | [pilot-001-hd-hyundai-stx-heavy-industries.md](pilot-001-hd-hyundai-stx-heavy-industries.md) |
| 002 | Hanwha Impact / HSD Engine (2023-2024) | Brown Field | In progress | [pilot-002-hanwha-impact-hsd-engine.md](pilot-002-hanwha-impact-hsd-engine.md) |
| 003 | Doosan Bobcat / Doosan Robotics share exchange (2024) | Intra-group restructuring | In progress (real case suspended) | [pilot-003-doosan-bobcat-robotics.md](pilot-003-doosan-bobcat-robotics.md) |
| 004 | SK Group cross-subsidiary capital rebalancing (2023-2025) | Group capital allocation | In progress | [pilot-004-sk-group-capital-rebalancing.md](pilot-004-sk-group-capital-rebalancing.md) |

## Candidate Sourcing

New candidate cases (real, publicly documented — not fabricated, per the design's explicit rule that a synthetic case cannot substitute for the pilot) are researched and logged in `../pilot-candidate-research.md` before being promoted to a numbered entry here. Promotion happens when a candidate is confirmed by the user as the working case for an actual pilot run.

## Findings Resolved

- **F-3/F-5 (pilots 001, 002) — missing Pre-FS/FS/DD/Entity-IC procedure schemas**: closed 2026-08-20. See `docs/process-map.md` §Gate Procedures for the full set of `procedures/_shared/*/schema.yaml` files now covering every gate, informed directly by all four pilots' findings.
- **F-2 (pilot 003) — no decision state for a withdraw-then-resubmit pattern**: closed 2026-08-20. `entity-ic-review` and `group-investment-review` both gained a fourth decision state, `withdrawn_pending_resubmission`.
- **F-2 (pilot 002) — ma-07/08 customer-only wording**: closed 2026-08-20 (applied directly to `checklists/ma-special-topics-checklist.yaml` v1.1.0 at the time).
- **F-1 (pilot 004) — step 4 (group agenda ranking) has no public-data calibration path**: still open, tracked in `docs/rag-framework.md` §6 as requiring internal historical cases specifically.

## Two-Consecutive-Failure Rule (ADR-0034)

If two pilot cases in a row fail to complete the process end-to-end (not "the deal would have failed the review" — that's a valid outcome — but "the process itself could not be executed as written"), the project halts progression to system development and returns to process design. This applies across cases in this directory, not per-case.
