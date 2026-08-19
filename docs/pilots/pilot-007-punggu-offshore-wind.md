# Pilot 007 — Punggu Offshore Wind Farm (Green Field, Renewable Energy)

**Case type**: Green Field (new establishment) — first pilot in renewable energy / power generation, second Green Field pilot overall
**Region**: Korea (KR)
**Run mode**: Manual (no system — Stage 3 pilot per ADR-0034)
**Case source**: researched per user instruction (2026-08-20) to test another industry outside semiconductors/electronics
**Status**: In progress — real project still in the permitting/development pipeline

## 0. Purpose and Scope

Same public-data-only constraint as prior pilots. Chosen because Korean offshore wind permitting is a real, extensively documented governance failure case — jurisdictional-boundary/community-impact mismatch, a "race-to-file" siting antipattern, and average multi-hundred-day permit lead times are all publicly quantified, giving this pilot unusually precise material to test `greenfield-screening` and permit-DAG concepts against.

## 1. Project Facts (Real Public Facts)

| Field | Value |
|---|---|
| Developer consortium | Seohae Green Power, Korea Southern Power (KOSPO), Uram Construction |
| Location | Waters near Punggu (풍도), administratively within Ansan-si, Gyeonggi-do |
| Scale | 200 MW (25 turbines) |
| Local consent obtained | 2017-07 (Punggu residents) |
| Power generation business license | Granted 2019-07 by the Electricity Committee, Ministry of Trade, Industry and Energy |
| Core conflict | Environmental impact assessment public-comment notification was sent only to Ansan, Hwaseong (Gyeonggi-do), and Dangjin (Chungcheongnam-do) — the site's administrative jurisdictions — but **not to Incheon/Ongjin-gun**, even though Incheon's Seungbong-do, Ijak-do, and Yeongheung-do islands are 7 km, 10 km, and 14 km from the site respectively |
| Legal standard the omission conflicts with | Korea's Power Plant Surrounding Area law defines the affected-area radius by distance from the nearest coastline to the generating facility — **not** by administrative jurisdiction — so the Incheon islands are inside the legally relevant radius despite being in a different province |
| Developer's stated reason | The project site and grid connection fall within Gyeonggi-do's administrative jurisdiction; consulting Incheon residents simultaneously with Punggu's own residents was described as impractical; the developer committed to broadening briefings during later permitting stages |
| Broader national pattern (context, not this project specifically) | 97 offshore wind projects hold business licenses nationally (as of 2024-12) totaling 31.5 GW, but only 0.8 GW (2.5%) had obtained final permits after up to 10 years in the pipeline; the 7 projects that did complete shared-water-surface-use permits took an average of 484 days from filing; Korea's 2030 target of 14.3 GW is ~0.9% operational as of the same reporting |
| Structural siting defect (context) | Under the Electricity Business Act, installing a wind-measurement device first grants priority rights to an area up to 100 km² — a "race to file" mechanism criticized for encouraging land-grabbing ahead of proper site vetting, and for not weighting environmental/social factors in the priority order |
| Legislative response | The Offshore Wind Special Act (해상풍력특별법), enacted 2024-2025, introduces government-led planned siting and a unified permitting procedure, and bars new wind-measurement-device permit applications outside planned-siting zones immediately upon promulgation (closing the land-grab loophole); post-enactment, a new operator is still expected to need a minimum of 32 months from candidate-zone designation to operator selection |
| Related litigation (a different, comparable project, cited for pattern context) | A separate operator's 96-day seabed survey (2025-04 to 2025-10, under a 1,752,357 m² Ongjin-gun water-use permit) drew a lawsuit from fishing organizations alleging survey-vessel movement and drilling damaged/destroyed fishing gear and caused catch losses |

## 2. Walkthrough Against `procedures/_shared/greenfield-screening/schema.yaml`

| Step | Real-world check | Result |
|---|---|---|
| 2. Site shortlist after hard pre-filter (infrastructure minimums, partner dependency) | **Real and directly on point**: Punggu's site qualified administratively (Gyeonggi-do jurisdiction, Ansan-si) but the pre-filter as applied by the real developer **used administrative jurisdiction as its consultation boundary rather than the legally correct distance-based affected-area radius** — a real, concrete instance of a pre-filter being run against the wrong boundary definition. | **Executable as a check, and it found the same class of gap as pilot 005's F-1 but sharper: a legally defined, quantifiable boundary (distance-from-coast) was available and not used.** |
| 3. Weighted site-candidate scoring (community acceptance factored via `regional-incentive-sourcing`/site-selection-checklist) | The 2017 Punggu-resident consent process is real and satisfiable as an input, but it only covered the administratively-correct jurisdiction, not the legally-relevant affected radius — same underlying gap as step 2. | **Partially satisfiable — same root cause as step 2.** |
| Kill criteria: `partner_dependency_unconfirmed_and_no_alternative` | Not applicable — a consortium of three named parties, no undisclosed partner dependency. | **N/A.** |

## 3. Permit-Pathway-Mapping (DAG) — A Real, Quantified Critical Path

Design §5-2 and the `permit-pathway-mapping` skill call for a DAG of permits with agency, statutory lead time, and sequencing. This case supplies real, national-level quantified data directly usable as calibration input, not just a single-project anecdote:

- **Business license** (Electricity Committee, Ministry of Trade, Industry and Energy) — real precedent: this project secured it in 2 years from local consent (2017 → 2019).
- **Shared-water-surface-use permit** — real national average: **484 days** from filing to final permit, across the small number of projects that have completed it.
- **Environmental impact assessment public-comment step** — this project's own failure mode (wrong-boundary notification) is itself a real permit-critical-path risk: a challenge or required re-notification at this step could reset or extend the timeline, which is exactly the kind of risk the DAG's critical-path calculation should carry as a contingency, not treat as a fixed duration.
- **New (post-2024) planned-siting pathway** — real forward-looking figure: **minimum 32 months** from candidate-zone designation to operator selection under the new Offshore Wind Special Act regime, itself a useful anchor for future Green Field renewable-energy cases in this team's pipeline.

This is the richest real permit-DAG timing data found across all seven pilots to date — a direct, usable input for `docs/greenfield-site-guide.md` *(forward reference — Stage 4)* once written.

## 4. Findings

| # | Finding | Type | Action |
|---|---|---|---|
| F-1 | The site pre-filter step's community-consultation boundary should be defined by the **legally applicable affected-area radius** (e.g., Korea's distance-from-coast standard for power plant surrounding areas), not by administrative jurisdiction alone — this case shows a real project got this wrong with real consequences (a public dispute, and a credible re-notification/delay risk). | Gap — procedure enhancement, sharper version of pilot 005's F-1 | Add an explicit step note to `greenfield-screening` step 2: consultation/notification boundary must be computed from the applicable legal standard for affected-area radius, not assumed equal to the project site's administrative jurisdiction |
| F-2 | This case supplies real, national-level permit-timing statistics (484-day average shared-water-surface permit, 32-month minimum under the new siting regime) usable directly as calibration anchors for future renewable-energy Green Field permit-DAG estimates — the richest quantified permit data found in any pilot to date. | Positive — real calibration data acquired | Feed into `docs/greenfield-site-guide.md` when written (Stage 4) |
| F-3 | The pre-2024 "race to file" wind-measurement-device priority system is a real example of a **flawed real-world siting process** the design's own `greenfield-screening` should explicitly avoid replicating — confirms the procedure's two-stage hard-filter-then-weighted-score design (meeting M6 D-M6-1) is a deliberate improvement over a pure first-come priority system, not an arbitrary choice. | Positive — validates a design decision by contrast with a real anti-pattern | None needed — informational confirmation |
| F-4 | Real litigation risk (fishing-gear damage claims during seabed survey) is a concrete instance of a Green Field DD-stage finding that current `greenfield-dd` doesn't explicitly name — closer to an environmental/community-liability finding than the existing checklist items cover. | Gap — minor | Consider whether `checklists/site-selection-checklist.yaml` should add a seabed/marine-survey-liability item for offshore projects specifically — flagged, not applied here, since it is narrow to offshore projects and the checklist is currently written industry-neutral |

## 5. Verdict

**Process partially executable, with the sharpest and most quantifiable real-world procedural gap found across all seven pilots to date (F-1: administrative-jurisdiction-vs-legal-affected-radius mismatch), plus genuinely useful calibration data (F-2) that no prior pilot supplied.** Not a failure under ADR-0034 — the finding is a real-world-informed procedure enhancement, exactly what a manual pilot exists to surface, and it directly sharpens (rather than duplicates) pilot 005's more general infrastructure-timing finding.

## 6. Cross-Pilot Update (001-007)

| Pilot | Industry | Case type | Distinctive finding |
|---|---|---|---|
| 001 | Marine engines/shipbuilding | BF (horizontal) | Antitrust screening validated against a real conditional-approval remedy package |
| 002 | Marine engines/shipbuilding | BF (vertical) | Multi-jurisdiction filing; framework resisted an unsupported financial-grade shortcut |
| 003 | Heavy machinery/robotics | Intra-group restructuring | Strongest real Fair Trade Act §47 match; surfaced the withdraw-and-resubmit decision-state gap |
| 004 | Diversified conglomerate (semiconductor/battery/chemical) | Group capital allocation | Confirmed group-agenda-ranking's quantitative mechanics have no public calibration path, ever |
| 005 | Semiconductors | Green Field | First GF pilot; surfaced infrastructure-plan-timing risk not previously in the schema |
| 006 | Confectionery→biopharma | BF (pure diversification) | First case with zero value-chain linkage; surfaced certification-step and QoE-step scope gaps for R&D-stage targets |
| 007 | Renewable energy (offshore wind) | Green Field | Sharpest real procedural gap (jurisdiction-vs-legal-radius mismatch); richest real permit-timing calibration data |

Seven real, independently-sourced cases across six distinct industries have now exercised every formalized procedure at least partially. The pattern holds across all seven: **every finding has been a real-case-surfaced scope gap, never a logic error** — and the two most industrially "foreign" cases (006, a diversification bet with no value chain; 007, a heavily regulated infrastructure sector) produced the sharpest and most novel findings, confirming that industry diversity in the pilot set is itself doing real validation work, not just adding volume.
