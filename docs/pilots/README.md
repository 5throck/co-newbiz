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
| 005 | SK hynix Yongin Semiconductor Cluster (2023-ongoing) | Green Field | In progress (real project still under construction) | [pilot-005-sk-hynix-yongin-cluster.md](pilot-005-sk-hynix-yongin-cluster.md) |
| 006 | Orion / LigaChem Bio (2024-2025) | Brown Field (pure diversification) | In progress | [pilot-006-orion-ligachem-bio.md](pilot-006-orion-ligachem-bio.md) |
| 007 | Punggu Offshore Wind Farm (2017-ongoing) | Green Field | In progress (real project still in permitting pipeline) | [pilot-007-punggu-offshore-wind.md](pilot-007-punggu-offshore-wind.md) |
| 008 | Delivery Hero / Woowa Brothers (Baemin) (2020-2021) | Brown Field (structural antitrust remedy) | In progress | [pilot-008-delivery-hero-woowa-brothers.md](pilot-008-delivery-hero-woowa-brothers.md) |
| 009 | Emart (Shinsegae) / eBay Korea (2021) | Brown Field (retail/e-commerce) | In progress | [pilot-009-emart-ebay-korea.md](pilot-009-emart-ebay-korea.md) |
| 010 | Affinity Equity Partners / Lotte Rental (2025-2026) | Brown Field (rental car — BLOCKED) | In progress (real deal prohibited by KFTC) | [pilot-010-affinity-lotte-rental.md](pilot-010-affinity-lotte-rental.md) |
| 011 | POSCO / Amberoad (2023-2025) | R&BD (Brown Field sub-type — internal-venture spin-off) | In progress | [pilot-011-posco-amberoad.md](pilot-011-posco-amberoad.md) |
| 012 | LG Electronics / Studio341 (2023-2026) | R&BD (Brown Field sub-type — accelerator-partnered spin-off) | In progress (program ongoing) | [pilot-012-lg-studio341.md](pilot-012-lg-studio341.md) |
| 013 | Hexapro / ETRI (2024) | R&BD (Brown Field sub-type — external technology license-in) | In progress (limited public disclosure) | [pilot-013-hexapro-etri.md](pilot-013-hexapro-etri.md) |
| 014 | C2Y / Seoul National University Technology Holdings + KRISS | R&BD (Brown Field sub-type — university-holdco-backed active co-research, minority-investment shape) | In progress | [pilot-014-c2y-university-techholdings.md](pilot-014-c2y-university-techholdings.md) |

## Candidate Sourcing

New candidate cases (real, publicly documented — not fabricated, per the design's explicit rule that a synthetic case cannot substitute for the pilot) are researched and logged in `../pilot-candidate-research.md` before being promoted to a numbered entry here. Promotion happens when a candidate is confirmed by the user as the working case for an actual pilot run.

## Findings Resolved

- **F-3/F-5 (pilots 001, 002) — missing Pre-FS/FS/DD/Entity-IC procedure schemas**: closed 2026-08-20. See `docs/process-map.md` §Gate Procedures for the full set of `procedures/_shared/*/schema.yaml` files now covering every gate, informed directly by all four pilots' findings.
- **F-2 (pilot 003) — no decision state for a withdraw-then-resubmit pattern**: closed 2026-08-20. `entity-ic-review` and `group-investment-review` both gained a fourth decision state, `withdrawn_pending_resubmission`.
- **F-2 (pilot 002) — ma-07/08 customer-only wording**: closed 2026-08-20 (applied directly to `checklists/ma-special-topics-checklist.yaml` v1.1.0 at the time).
- **F-1 (pilot 004) — step 4 (group agenda ranking) has no public-data calibration path**: still open, tracked in `docs/rag-framework.md` §6 as requiring internal historical cases specifically.
- **F-1 (pilot 005) — a real Green Field project proceeded before infrastructure plans were finalized**: closed 2026-08-20. `greenfield-screening` (v1.0.0 → v1.1.0) gained a new kill-criteria condition, `infrastructure_plan_not_finalized_at_site_announcement` → escalate to risk-officer.
- **F-2 (pilot 005) — site-selection-checklist ss-08 framed only for local-community objections**: closed 2026-08-20. Broadened to cover inter-regional resource disputes (`checklists/site-selection-checklist.yaml` v1.1.0), same pattern as pilot 002's ma-07/08 fix.
- **F-3 (pilot 005) — incentive-NPV mechanics not numerically validated**: still open — a single-site case has no multi-candidate comparison to validate against; would need a future case with disclosed competing finalists.
- **F-1 (pilot 006) — certification-transferability step assumes an operational/manufacturing-type certification**: still open — needs a Stage 4 SRS branch for R&D-stage/asset-tied-regulatory-pathway targets (biopharma, etc.).
- **F-2 (pilot 006) — QoE step assumes an operating business with historical EBITDA**: still open — needs a Stage 4 SRS alternate path for pipeline/licensing-value-driven targets.
- **F-1 (pilot 007) — site pre-filter used administrative jurisdiction instead of the legally applicable affected-area radius**: closed 2026-08-20. `greenfield-screening` (v1.1.0 → v1.2.0) step 2 now explicitly requires the notification boundary be computed from the applicable legal standard, not assumed equal to administrative jurisdiction.
- **F-1 (pilot 008) — RAG framework never distinguished structural from behavioral antitrust remedies**: closed 2026-08-20. `docs/rag-framework.md` §2.5 (new) documents the two-shape grading rule.
- **F-3 (pilot 009) — deal-structure-hypothesis step didn't prompt for acquisition vehicle**: closed 2026-08-20. `brownfield-pre-fs` (v1.0.0 → v1.1.0) step 2 now explicitly names direct/SPC/holdco as a structure-hypothesis dimension.
- **F-2 (pilot 009) — no case yet with both acquirer debt AND coverage figures disclosed together**: still open, tracked as a sourcing note for a future pilot.
- **F-2 (pilot 010) — checklist/procedure text implicitly assumed a direct target-to-target merger, missing the common-ownership/common-control fact pattern**: closed 2026-08-20. `checklists/ma-special-topics-checklist.yaml` (v1.1.0 → v1.2.0) ma-01 and `brownfield-dd` (v1.0.0 → v1.1.0) step 3 both broadened to explicitly name common-ownership combinations.
- **F-4 (pilot 010) — a blocked deal's real fallout extended to unrelated, contingent financing plans**: still open — flagged as a possible `brownfield-pre-fs` disclosure item, not applied (narrow scenario).
- **F-2 (pilot 011) — no distinction between internal-spinoff and external-technology-acquisition R&BD sub-sources**: refined by pilot 012 F-2 to a three-value `rbd_source` enum (`internal_only` / `accelerator_partnered` / `external_technology_acquisition`) — still a Stage 5 forward reference, not yet built, but the design is now settled. Recorded in `docs/db-schema.md`.
- **F-1 (pilot 012) — rbd-02 (government co-funding conditions) had no positive real-case test, only pilot 011's N/A**: closed 2026-08-20 — TIPS/DIPS program involvement gives a real positive case.
- **F-2 (pilot 013) — rbd-05's wording is spin-off-shaped (equity/brand), doesn't fit a research-institute licensor relationship**: closed 2026-08-20. `checklists/rbd-technology-checklist.yaml` (v1.0.0 → v1.1.0) rbd-05 broadened to cover licensor royalty/follow-on-program relationships as an alternate shape.
- **F-1 (pilot 013) — rbd-01 didn't note that license-in deals have a lower public-corroboration ceiling than spin-offs**: closed 2026-08-20 — rbd-01 guidance updated to prioritize direct licensor documentation for `external_technology_acquisition` deals.
- **F-1 (pilot 014) — rbd-02 didn't distinguish formal government co-funding from informal research collaboration**: closed 2026-08-20 — rbd-02 broadened.
- **F-2 (pilot 014) — rbd-03 didn't address joint-IP-ownership from active co-research**: closed 2026-08-20 — rbd-03 broadened.
- **F-3 (pilot 014) — rbd-04's build/license/spin-off framing didn't fit an independently-founded target**: closed 2026-08-20 — rbd-04 clarified to concern the reviewing entity's path, not the target's origin, and a fourth path (minority venture investment) added.
- **F-4 (pilot 014) — the R&BD structure-hypothesis note didn't recognize minority venture investment as a deal shape**: closed 2026-08-20 — `brownfield-pre-fs` (v1.2.0 → v1.3.0) step 2 updated.

## Two-Consecutive-Failure Rule (ADR-0034)

If two pilot cases in a row fail to complete the process end-to-end (not "the deal would have failed the review" — that's a valid outcome — but "the process itself could not be executed as written"), the project halts progression to system development and returns to process design. This applies across cases in this directory, not per-case.
