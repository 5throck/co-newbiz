# Pilot 012 — LG Electronics / Studio341 (R&BD, Brown Field Sub-Type — Accelerator-Partnered)

**Case type**: R&BD (Brown Field sub-type, `case_subtype: rbd`) — internal venture spin-off, but structurally different from pilot 011: run with an **external accelerator partner**, not fully in-house, and with real **government co-funding program** (TIPS/DIPS) involvement
**Region**: Korea (KR)
**Run mode**: Manual (no system — Stage 3/4 pilot per ADR-0034)
**Case source**: researched per user instruction (2026-08-20) to broaden R&BD pilot coverage beyond pilot 011's single case
**Status**: In progress — program is ongoing (Season 2 spin-offs still in progress as of the most recent reporting)

## 0. Purpose and Scope

Same public-data-only constraint as prior pilots. Chosen specifically because it fills two real gaps pilot 011 (POSCO/Amberoad) left open: rbd-02 (government co-funding conditions) was N/A in pilot 011 since Amberoad's track record came from purely internal POSCO project work; this case has real, named government co-funding program involvement (TIPS/DIPS) for the spun-off teams. It also introduces a structurally distinct R&BD pattern — an **externally accelerator-partnered** internal venture program, not a fully in-house one.

## 1. Program and Deal Facts (Real Public Facts)

| Field | Value |
|---|---|
| Originating company | LG Electronics |
| Program name | Studio341 (스튜디오341) — named after 341 Yeonji-dong, Busanjin-gu, Busan, the founding address of LG's predecessor Goldstar (금성사) |
| Program structure | Run in partnership with Bluepoint Partners (블루포인트파트너스), an external startup accelerator — covers selection, incubation, and spin-off execution, not run fully in-house |
| Program launch | 2023 |
| Season 1 (2024) | 6 finalist teams, 5 successfully spun off; the spun-off startups were subsequently selected for TIPS (창업성장기술개발사업, Korea's private-investment-led tech startup support program) and DIPS (초격차 스타트업 프로그램) — both **real government co-funding programs**, confirming government-funding involvement at the post-spin-off stage |
| Season 2 finalist selection (2025-07) | Selected from a real ~12:1 competition ratio |
| Season 2 final spin-offs (2026-04, 4 teams) | SECA (hardware-design-data error-detection AI), Machineflow (enterprise AI coding agent), Freekitchenlab (kitchen-automation robotics/B2B ops solution), Atomor (fabless flame-retardant-materials design solution) |
| Season 2 additional pre-spin-off cohort (2025-11, 7 teams for 2026 spin-off) | Atomor, Morpheus (3D digital-twin smart control), Reflow (small-batch manufacturing collaboration platform), Kitchen Automation, Dogminjeongeum (behavior/sound-recognition AI care), SECA Labs (AI-agent data-poisoning security), AGI Labs |
| Per-team initial investment (disclosed) | Up to KRW 400 million |
| Real technology/commercialization-path risk data point | ~70% of teams in the selection process revised their business model during the program (pivoted) before reaching final spin-off selection |
| Post-spin-off support | LG Electronics continues support for a period after spin-off, particularly seeking synergy in AI automation, robotics, and materials — areas connected to LG's own existing business |

## 2. Walkthrough Against `checklists/rbd-technology-checklist.yaml`

| Item | Real-world check | Result |
|---|---|---|
| rbd-01 (core-technology TRL) | Real but **structurally different from pilot 011**: pilot 011's Amberoad had a mature, field-proven track record (33 deployed internal projects) before spin-off. This program's teams are earlier-stage — the ~70% pivot rate during selection is itself evidence that TRL at entry is lower and less proven than Amberoad's case, closer to a genuine early-stage venture than a field-tested internal solution. | **Satisfiable, and reveals a real TRL-spectrum within R&BD spin-offs — not every internal-venture case has Amberoad's level of pre-spin-off validation.** |
| rbd-02 (government co-funding conditions) | **Real and previously untested** — TIPS and DIPS are actual government co-funding programs with real conditions (TIPS specifically requires a private lead-investor match and carries its own reporting/milestone conditions). This is the pilot set's first real case where an R&BD target's post-spin-off funding stack includes government co-funding with real, named program conditions to diligence. | **Satisfiable — closes pilot 011's N/A gap with real data.** |
| rbd-03 (IP/freedom-to-operate) | Not fully disclosed publicly (specific IP-assignment terms between LG and each spin-off aren't public), same boundary as pilot 011. | **Not executable from public data, consistent with pilot 011.** |
| rbd-04 (build/license/spin-off decision, with rationale) | Real: LG explicitly chose the accelerator-partnered spin-off model over building internally or licensing out — the stated rationale (combining "LG's internal capability with the accelerator's specialized expertise," explicit fast-market-validation focus for Season 2, explicit PMF-and-pivot-oriented process design) is a real, disclosed justification distinct from Amberoad's rationale (internal projects don't convert to sales without an independent commercial motion). | **Satisfiable — a second real, differently-reasoned example of this decision.** |
| rbd-05 (continuing parent relationship) | Real: LG explicitly continues support post-spin-off and names specific synergy-seeking areas (AI automation, robotics, materials) tied to its own existing business — a more explicit, ongoing-synergy-oriented relationship than Amberoad's more independent post-spin-off posture. | **Satisfiable — a second real case with a different relationship shape (synergy-seeking vs. Amberoad's brand-halo-plus-independent-sales-motion).** |
| rbd-06 (track record corroboration) | The ~70% pivot-rate figure and per-team investment cap are both attributed to program/press sources, same corroboration caveat as pilot 011. | **Satisfiable as a check, same finding as pilot 011.** |

## 3. New Finding: Accelerator-Partnered vs. Fully-Internal R&BD Programs

Pilot 011 (POSCO/Amberoad, fully internal POVENTURES program) and this pilot (LG/Studio341, run jointly with an external accelerator) are both real "internal-venture spin-off" cases, but they differ in a structurally meaningful way the current checklist doesn't distinguish: **who runs the selection/incubation process**. An externally accelerator-partnered program brings in outside company-building expertise and (per this case) a more explicit pivot/PMF-validation discipline, which plausibly changes the risk profile a DD process should expect — a fully internal program's targets may carry more mature-but-less-externally-validated technology (Amberoad's pattern), while an accelerator-partnered program's targets may carry earlier-stage-but-more-externally-market-tested technology (Studio341's pattern, evidenced by the 70% pivot rate).

## 4. Findings

| # | Finding | Type | Action |
|---|---|---|---|
| F-1 | rbd-02 (government co-funding conditions) validated with real data for the first time — TIPS/DIPS are real, named programs with real conditions, confirming this checklist item is not merely theoretical. | Positive — closes pilot 011's open N/A gap with a real positive case | None needed |
| F-2 | Internal-venture R&BD programs come in at least two structurally distinct shapes — fully internal (pilot 011) vs. externally accelerator-partnered (this pilot) — with different implied risk profiles (validated-but-less-externally-tested vs. earlier-stage-but-market-validated). The `rbd_source` field refinement flagged in pilot 011's finding F-2 should be widened to capture this distinction (`internal_only` vs. `accelerator_partnered` vs. `external_technology_acquisition`), not just internal-vs-external. | Gap — refines pilot 011's F-2 rather than opening a new one | Update the planned `rbd_source` field's enum (still a Stage 5 forward reference, not yet built) to three values instead of two |
| F-3 | A real, quantified technology/commercialization-path risk figure (~70% pivot rate during selection) is now available as a base-rate reference for R&BD deals sourced from an accelerator-partnered program — useful context for calibrating expectations when reviewing an early-stage R&BD target's stated technology maturity. | Positive — real calibration data acquired | Note as a reference point in `docs/governance/rag-framework.md` §6 alongside the existing base-rate-check guidance, if an R&BD-specific base rate is ever formalized (not applied now — insufficient sample size from a single program) |
| F-4 | LG's explicit, named post-spin-off synergy-seeking (AI automation, robotics, materials — areas tied to LG's own business) is a real, more tightly-coupled parent-relationship pattern than Amberoad's brand-halo-plus-independent-sales-motion pattern — confirms rbd-05's requirement to document the *specific shape* of the continuing relationship, not just its existence. | Positive — validates rbd-05's specificity requirement | None needed |

## 5. Verdict

**Process fully executable for the R&BD checklist's applicable items, with one real gap closed (rbd-02) and one existing finding refined (F-2, sharpened from pilot 011)** — no new logic error surfaced, consistent with the pattern across all twelve pilots to date. This case's main contribution is breadth: it confirms the R&BD checklist generalizes across at least two structurally distinct real program shapes, not just the one pilot 011 happened to test first.

## 6. Cross-Pilot Update (001-012)

Twelve real cases across ten industries/case-types have now been walked, with R&BD (pilots 011, 012) confirmed to generalize across both fully-internal and accelerator-partnered program structures. The pattern holds without exception across all twelve: every finding has been a real-case-surfaced scope gap or refinement, never a procedure logic error.
