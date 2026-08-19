# Pilot 011 — POSCO / Amberoad (R&BD, Brown Field Sub-Type)

**Case type**: R&BD (Research & Business Development) — internal-venture-to-spin-off carve-out. Per user decision (2026-08-20), R&BD is treated as a **Brown Field sub-type** (`case_subtype: rbd`), not a separate top-level review type — the transaction shape (equity in a newly independent entity, ongoing parent relationship) is BF mechanics, not GF site-selection mechanics.
**Region**: Korea (KR)
**Run mode**: Manual (no system — Stage 3/4 pilot per ADR-0034)
**Case source**: researched per user instruction (2026-08-20) to ground the new R&BD checklist/procedure extension in a real case
**Status**: In progress

## 0. Purpose and Scope

Same public-data-only constraint as prior pilots. Chosen specifically because it is a real, well-documented case of internal R&D (not a licensed-in or acquired-from-outside technology) reaching a genuine commercialization decision point — build internal, license out, or spin off — with real quantified track-record evidence and a real post-spin-off performance record, including continued commercial ties to the originating company.

## 1. Deal Facts (Real Public Facts)

| Field | Value |
|---|---|
| Originating company | POSCO (steel manufacturer) |
| Internal venture program | POVENTURES (POSCO Group's internal venture system) |
| Spin-off entity | Amberoad (앰버로드), a manufacturing-AI solutions company |
| Core product | "Miner Report" — an AI solution for quality/yield/energy-efficiency optimization in manufacturing processes, deployable in ~3 months vs. a conventional ~10-month build |
| Pre-spin-off track record (real, quantified) | 33 AI projects delivered inside POSCO, generating a disclosed ~KRW 39.7 billion in annual profit impact |
| Spin-off date | 2023-09 |
| Team | Founding members include CEO Lim Eon-ho, CTO Kim Young-gil (formerly led smart-factory builds at POSCO DX for POSCO Group and external clients), COO Park Do-gyeom; 18-person team as of the most recent reporting |
| Post-spin-off customer traction (real, 1 year post-spin-off) | 16 enterprise customers across 7 industries (steel, secondary battery, automotive, food, etc.), including POSCO itself, Kia, and KG Steel |
| Product performance (real, disclosed) | 0% production-deployment failure rate for delivered solutions, vs. an industry-reported 87% failure rate for AI solutions reaching production; customer-side ROI reported above 100% |
| External investment (real) | ~KRW 2 billion pre-Series A round (2025-01) from Stonebridge Ventures and Sparklabs |
| Continuing parent relationship (real, disclosed by the CEO) | The spin-off's association with POSCO's manufacturing credibility is itself described as a commercial asset ("the fact that we spun off from POSCO is itself a source of synergy") — but the CEO also noted POSCO's own internal project history did not automatically convert to purchase contracts, requiring a separate free-trial-then-convert sales motion |

## 2. Walkthrough Against `procedures/_shared/brownfield-pre-fs/schema.yaml` and `brownfield-dd/schema.yaml`

| Step | Real-world check | Result |
|---|---|---|
| Deal structure hypothesis (Pre-FS) | **Real and directly on point for the new R&BD branch**: this is exactly the "internal-venture spin-off carve-out" structure option added to `brownfield-pre-fs` step 2 in this same change — Amberoad is a real, worked instance of that structure, not a hypothetical. | **Satisfiable — validates the newly added structure option immediately.** |
| rbd-01 (core-technology TRL, distinct from production-process TRL) | Real: the 33-project, KRW 39.7B track record IS the TRL evidence — a mature, field-proven technology (not an early-stage lab result), which is itself informative: TRL for an R&BD target sourced from an internal-venture program tends to be higher than a from-scratch startup, since it was already deployed inside the parent before spin-off. | **Satisfiable — and reveals a useful pattern: internal-venture-sourced R&BD targets carry real pre-existing deployment evidence a from-scratch startup target wouldn't have.** |
| rbd-02 (government co-funding conditions) | **Not applicable to this specific case** — Amberoad's track record was generated through POSCO's own internal project work, not a government-cofunded R&D grant. No technology-fee or IP walk-away condition is publicly reported. | **N/A, correctly excluded — confirms rbd-02 is conditional on the funding source, not a blanket requirement.** |
| rbd-03 (IP/freedom-to-operate) | Not fully disclosed publicly (internal IP-assignment terms between POSCO and the spin-off are not public), but the checklist item's real-world relevance is confirmed by the CTO's background — he built smart-factory systems for POSCO Group AND external clients while at POSCO DX, raising a real, checkable question of whether any IP or client-relationship boundaries needed clarifying at spin-off. | **Partially satisfiable — the item's relevance is confirmed even though the specific terms aren't public.** |
| rbd-04 (build/license/spin-off decision, with rationale) | **Real and clean**: POSCO chose spin-off over building Amberoad as an internal unit or licensing the technology out — the CEO's own stated rationale (POSCO's internal projects didn't automatically convert to sales, implying the technology needed an independent, externally-facing commercial motion POSCO's internal structure wasn't suited to provide) is a real, checkable justification for the choice. | **Satisfiable — a real, well-reasoned example of exactly the comparison this checklist item requires.** |
| rbd-05 (continuing parent relationship documented) | **Real and rich**: POSCO remains a customer post-spin-off, the CEO explicitly frames the POSCO association as a commercial asset (brand halo), and the CTO's POSCO DX background is a real, disclosed continuity thread. This is a strong real example of what this checklist item is meant to capture. | **Satisfiable — the richest real match for this specific item found in the pilot set.** |
| rbd-06 (track record verification) | The 33-project/KRW 39.7B figure and the 0%-failure/100%+-ROI figures are both attributed to company/press sources rather than an independent audit — a real illustration of exactly the corroboration risk this item exists to flag (this pilot itself could not independently verify the figures beyond citing the same press sources cited by other outlets). | **Satisfiable as a check, and it surfaces a real, generalizable point: R&BD track-record claims sourced from the target's own reporting need independent corroboration in an actual DD process, not just citation.** |

## 3. RAG-Adjacent Observation

Same discipline as pilots 002/006/009: the real, disclosed pre-Series A valuation-adjacent event (KRW 2 billion raised from named VCs) and the real customer-traction figures (16 customers, 0% failure rate) are **not** converted into an inferred Financial-dimension grade here — no hurdle rate or full capital structure is public for this case. This is the fourth real case where the framework's resistance to inferring a grade from tempting real numbers has been exercised and held.

## 4. Findings

| # | Finding | Type | Action |
|---|---|---|---|
| F-1 | The newly added "internal-venture spin-off carve-out" structure option (`brownfield-pre-fs` step 2) and the new `checklists/rbd-technology-checklist.yaml` both validated cleanly against a real case on first use — no gap surfaced in the newly added content itself. | Positive — new procedure content validated immediately | None needed |
| F-2 | Internal-venture-sourced R&BD targets (spun off from an existing corporation's own internal program) carry real pre-existing deployment evidence that a from-scratch/externally-sourced R&BD target would not have — this is a meaningful sub-distinction within R&BD deals worth naming explicitly. | Gap — minor refinement opportunity | Consider adding a `rbd_source` field distinction (`internal_spinoff` vs. `external_technology_acquisition`) when the system schema for R&BD deals is eventually built (Stage 5), since the TRL-evidence-availability pattern differs structurally between the two |
| F-3 | Track-record figures for an R&BD target are commonly sourced from the target's own reporting (or its former parent's press materials) rather than independent audit — confirms rbd-06's corroboration requirement is not a formality but a real, generalizable DD risk. | Positive — checklist item validated as substantively necessary | None needed |
| F-4 | The Financial dimension resisted inference from a real, tempting number (KRW 2B raise, strong customer-traction figures) for the fourth time across the pilot set — the framework's discipline continues to hold specifically because it is applied consistently, not selectively. | Positive — framework validated a fourth time | None needed |

## 5. Verdict

**Process fully executable for the newly added R&BD content on its first real test** — every new checklist item and the new structure-hypothesis branch found real, relevant material in this case, with only one minor refinement (F-2) rather than a genuine gap. This is a stronger first-pass validation than most prior pilots' initial procedure versions received, likely because the R&BD extension was scoped narrowly and grounded in a real case (this one) from the start rather than derived abstractly first. Not a failure under ADR-0034.

## 6. Cross-Pilot Update (001-011)

Eleven real cases across ten industries/case-types (marine engines, heavy machinery, diversified conglomerate, semiconductors, biopharma, renewable energy, food-delivery platforms, retail/e-commerce, rental cars, and now R&BD/internal-venture spin-offs) have been walked. R&BD is confirmed as a Brown Field sub-type rather than a new top-level case type: its deal mechanics (equity stake in a newly independent or license-in target) are BF-shaped, and it shares real, already-identified gaps with pilot 006's biopharma case (certification/QoE steps assuming operational/historical-earnings targets) rather than requiring GF-style site/infrastructure procedures. The pattern holds without exception across all eleven: every finding has been a real-case-surfaced scope gap (or, in this pilot's case, a confirmation with only a minor refinement), never a procedure logic error.
