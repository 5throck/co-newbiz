# Phase Definitions — co-newbiz

This document defines the workflow phases used by the `co-newbiz` variant. It follows the standard workspace phase structure (see `templates/common/docs/phase-definitions.md`) with co-newbiz's specialist phases mapped one-to-one onto its six-gate new-business review sequence (design of record §5, `docs/designs/2026-08-19-co-newbiz-design_ko.md`).

**Deliberate deviation from the standard 0–6 table (recorded 2026-08-29):** co-newbiz extends the table to **0–7**. Phases 0–6 mirror its six stage gates one-to-one (`gate:` field in `procedures/**/schema.yaml`) — compressing six gates into the standard phases 1–4 would blur the human IC approval boundary (phase 5) and the post-close operational phase (phase 6) into a single step. Phases 7 (lifecycle finalization + QA) merges the standard phases 5–6, which are PM-owned bookkeeping rather than deal-flow stages. This follows the co-consult precedent of variant-customized phase tables; the `phases:` integers in `variant.json` are opaque labels resolved through this document.

Phase↔gate mapping:

| Phase | Gate(s) | Procedure sources |
|-------|---------|-------------------|
| 0 | — (intake) | PM request intake; no procedure |
| 1 | `Screening` | brownfield-screening, greenfield-screening, deal-shape-chain |
| 2 | `Pre-FS` | brownfield-pre-fs, greenfield-pre-fs |
| 3 | `FS` | brownfield-fs, greenfield-fs |
| 4 | `DD` | brownfield-dd, commercial-dd, technical-dd, legal-dd |
| 5 | `Entity IC`, `Group IC` | entity-ic-review, group-investment-review |
| 6 | `post_close` | entity-establishment-execution, pmi-integration-execution, post-close monitoring |
| 7 | — (finalization) | lifecycle finalization + QA/sync (standard workspace phases 5–6) |

These are the numbers referenced by the `phases:` arrays in `variant.json` `skill_manifest.variant_specific[]`, which produce the `phase` edges in `docs/skill-graph.json`.

---

## Phase Overview

| Phase | Name | PM Role | Who Acts |
|-------|------|---------|----------|
| 0 | Intake & Initiation | Orchestrator | PM (proposal intake, complexity classification) |
| 1 | Screening | Gate Keeper | `brownfield-agent`, `greenfield-agent`, `antitrust-agent`, `process-governance-manager` |
| 2 | Pre-FS | Gate Keeper | domain specialists per proposal type (certification, incentive, site) |
| 3 | Full Feasibility Study (FS) | Coordinator | `financial-analyst`, `valuation-agent`, `market-intelligence-agent`, `quant-methodologist` |
| 4 | Due Diligence (DD) | Coordinator | `commercial-dd-agent`, `technical-dd-agent`, `legal-counsel`, `risk-officer`, DD specialists |
| 5 | Investment Committee (IC) | Gate Keeper (human-final) | `group-review-agent` + PM; **human approval required** |
| 6 | Execution & Post-Close | Coordinator | `pmi-agent`, `hr-integration-agent`, `customer-retention-agent`, `dba`/ops agents |
| 7 | Lifecycle Finalization & QA | Owner | PM (governance records, audit, `/sync`, PR) |

---

## Phase Details

### Phase 0 — Intake & Initiation
PM receives the proposal, classifies its type (green field / brown field / partnership), routes it through the PM Gateway, and opens the deal workspace. No procedure schema covers this phase. **Output**: classified proposal, opened workspace.

### Phase 1 — Screening (gate: `Screening`)
Knock-out filters before any cost is committed: strategic-fit screen, preliminary HHI/antitrust screen, target/longlist building, deal-shape chain. Kill decisions are recorded with written feedback (Go/Kill/Hold/Recycle). **Gate**: screening exit requires no viable-target / HHI kill-criteria trip.

### Phase 2 — Pre-FS (gate: `Pre-FS`)
Coarse feasibility before commissioning analysis: permit pathway, certification transferability, incentive availability, WACC/hurdle sanity checks. Kill criteria include `wacc_hurdle_still_assumed` and `certification_transferability_unconfirmed_and_load_bearing`. **Gate**: Pre-FS exit approval.

### Phase 3 — Full Feasibility Study (gate: `FS`)
The analysis-heavy phase: historical financial analysis, peer benchmarking, proxy-industry-chain sizing, unit-conversion calibration, growth projection, and the DCF/investment-feasibility models. Skills here are the six-axis analysis pipeline inherited from co-consult. **Gate**: FS report accepted for DD (brownfield) or IC packaging (greenfield).

### Phase 4 — Due Diligence (gate: `DD`)
Confirmatory, evidence-based investigation: commercial DD with mandatory triangulation, technical DD (site visit, EHS), legal DD, antitrust merger-control filing analysis, HR/compensation review, quality-of-earnings. DD findings deep-link to assumptions (`dd-to-valuation-bridge`). **Gate**: all declared DD validators pass; the six M&A validators kill on absence.

### Phase 5 — Investment Committee (gates: `Entity IC`, `Group IC`)
Entity-level and group-level investment committee review: portfolio fit, intra-group transaction compliance, capital allocation prioritization across concurrent proposals. **Human-final approval is mandatory** (three-stage review; `analysis_task.reviewed_by` must be a human sign-off — the `review_audit_sample` KPI measures AI-vs-human agreement). **Gate**: IC approval is the only path into execution.

### Phase 6 — Execution & Post-Close (gate: `post_close`)
Entity establishment execution, PMI planning and synergy tracking, compensation harmonization, customer attrition monitoring, incentive clawback exposure. Runs after formation verification (ef-13..17). **Gate**: post-close monitoring cadence per runbook.

### Phase 7 — Lifecycle Finalization & QA
Standard workspace phases 5–6, merged: governance records updated, memory logged, audit gate and `validate-docs-links` run (maximum 2 fix iterations before escalating to user), `/sync` pipeline, PR. Owned by PM. **Output**: passing audit report, merged PR or open PR link.

---

## Maintenance Rules

- `phases:` arrays in `variant.json` are derived from the procedure schemas (`procedures/**/schema.yaml` `gate:` → phase via the table above). When a procedure step moves gates, update the affected skills' `phases` in the same change.
- The `phase` edges in `docs/skill-graph.json` are advisory (ADR-0060): they do not gate dispatch — `procedures/*.yaml` remains authoritative for execution order.
- Regenerate the graph after any change: `bun scripts/generate-skill-graph.ts` (run automatically by `/sync` Step 4.65).
