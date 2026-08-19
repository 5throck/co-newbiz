# Pilot 005 — SK hynix Yongin Semiconductor Cluster (Green Field)

**Case type**: Green Field (new establishment) — the first Green Field pilot; pilots 001-004 were all Brown Field or intra-group restructuring
**Region**: Korea (KR)
**Run mode**: Manual (no system — Stage 3 pilot per ADR-0034)
**Case source**: researched per user instruction (2026-08-20) to fill a real gap — no pilot to date had exercised `greenfield-screening`, `greenfield-pre-fs`, `greenfield-fs`, or `greenfield-dd`
**Status**: In progress — real-world project is still under construction, not concluded

## 0. Purpose and Scope

Same public-data-only constraint as pilots 001-004. This case is structurally different from all prior pilots: it is a **new-facility establishment**, not an acquisition or restructuring, so it is the first real exercise of the Green Field procedure family (`procedures/_shared/greenfield-screening`, `greenfield-pre-fs`, `greenfield-fs`, `greenfield-dd`). It was deliberately sourced because it has an unusually dense public record on exactly the axes the design's Green Field procedures are built around: infrastructure lead time (power, water), permit critical path, and regional incentive negotiation — see §1.

**Real-world status caveat**: as of the last confirmed public reporting, Fab 1 site-preparation progress is ~78% (as of the most recent reporting available), with up to 26,000 workers expected on-site by H1 2027 and total investment across the cluster's phases continuing. This pilot walks the process against a project still in construction, not a completed one — itself a realistic scenario for a Green Field review, where DD-equivalent monitoring continues well past initial approval.

## 1. Deal Facts (Real Public Facts)

| Field | Value |
|---|---|
| Developer | SK hynix (general industrial complex, ~600 trillion KRW combined cluster figure including Samsung's adjacent complex) |
| Location | Yongin-si, Cheoin-gu, Wonsam-myeon, Gyeonggi-do, Korea |
| Site scale | ~4.15 million m² (~1.26 million pyeong): ~600,000 pyeong SK hynix fab, ~140,000 pyeong materials/parts/equipment (소부장) cooperation park, ~120,000 pyeong infrastructure |
| Designation | National Industrial Complex candidate site announced 2023-03; designation confers fast-track permitting, infrastructure buildout support, and tax credits |
| Fab 1 building permit | Approved by Yongin City; construction commenced following approval |
| Fab 1 facility investment (announced 2024-07) | ~KRW 9.4 trillion (part of an estimated ~KRW 31 trillion total for Fab 1 construction) |
| Core infrastructure requirement | 15 GW power, 1.07 million tons of water |
| Water supply dispute | Upstream provinces (Gangwon, Chungcheongbuk-do) and eastern Gyeonggi rural areas (Yangpyeong, Yeoju, Icheon) initially resisted supplying water from the Han River watershed; K-water formed a dedicated task force and introduced Korea's first integrated water-supply model covering raw water through ultra-pure water in a single pipeline; most of the water is drawn from Paldang Lake |
| Power infrastructure support | Government committed to subsidize underground transmission-line cost up to 100% via the Semiconductor Special Act enforcement decree, addressing what was identified as the largest single bottleneck |
| Permit acceleration (2026-08 policy) | Government's "field-centered corporate investment/innovation support plan (1st)" simplifies the plant-expansion permit process specifically for this cluster, targeting acceleration of ~KRW 2.5 trillion in investment execution |
| Tax incentive | A new gift-tax exemption (2027-2031) for the non-profit entity operating the "Trinity Fab" semiconductor demonstration testbed (~KRW 800 billion in associated investment) |
| Zoning/development tool | "Urban Innovation Zone" designation available for high-priority national industrial complexes — removes use restrictions and allows exceeding the statutory 1500% floor-area-ratio cap |
| Local subsidy equity dispute | Provincial (Gyeonggi-do) investment-promotion subsidy allocation to the Yongin/Hwaseong/Icheon semiconductor hub region has been publicly criticized as comparatively low relative to the region's tax contribution — an active local-incentive-equity dispute, not a settled figure |
| Timeline | 24-hour construction ongoing; Fab 1 site-prep ~78% complete as of the most recent reporting; up to 26,000 workers expected on-site by H1 2027 |

## 2. Walkthrough Against `procedures/_shared/greenfield-screening/schema.yaml`

| Step | Real-world check | Result |
|---|---|---|
| 1. Market sizing (TAM/SAM/SOM + value-chain linkage) | Not directly disclosed at the individual-project level — semiconductor demand sizing is industry-wide public knowledge (AI/HBM-driven fab expansion cycle, consistent with pilot 004's SK hynix profit-swing context) but not reconstructible as a fresh TAM/SAM/SOM exercise from this case alone. | **Not executable as a fresh exercise — the demand context is real but pre-existing, not something this pilot derives.** |
| 2. Site shortlist AFTER hard pre-filter (infrastructure minimums, partner dependency) | **Real and highly informative, though inverted from the procedure's intended sequence**: the real project's public record shows infrastructure (water, power) was **not fully resolved before site selection** — reporting explicitly notes the pattern that large cluster announcements state "scale and direction" first, with water/power plans concretized only ~2 years later. This is a direct, real counter-example to the procedure's own hard-pre-filter-first design intent (meeting M6 D-M6-1: infrastructure minimums exclude non-qualifying sites *before* scoring, not after). | **Executable as a check, and the check found a real gap between design intent and real-world practice — see §4 F-1.** |
| 3. Weighted site-candidate scoring (infra 30% / incentive NPV 25% / logistics 15% / labor 15% / permit critical path 15%) | Partial: incentive elements are real and disclosed (national-industrial-complex tax credits, gift-tax exemption, urban-innovation-zone FAR relief) but not converted to a single NPV figure in public reporting — no per-site comparison exists since Yongin was a single-track designation, not a multi-site bake-off in the public record. | **Partially satisfiable — real incentive line items exist; the weighted-score mechanics can't be validated without a genuine multi-candidate comparison, which this single-site case doesn't provide.** |
| 4. Gate pass record | Confirmed by the real-world fact that the project proceeded past initial designation to building-permit approval and construction start. | **Satisfiable.** |

**Kill Criteria check**: `zero_site_clears_infrastructure_minimums` — not directly testable (single-site case, no rejected alternatives in the public record). `partner_dependency_unconfirmed_and_no_alternative` — not applicable (no third-party technology/JV partner dependency disclosed for this case).

## 3. Walkthrough Against `procedures/_shared/greenfield-pre-fs/schema.yaml`

| Step | Real-world check | Result |
|---|---|---|
| 1. WACC/hurdle confirmed | Not public — same `assumption.kind='user'` boundary as every prior pilot. No number fabricated. | **Not executable from public data.** |
| 2. Infra lead-time/cost estimate | **Strong real match**: the water-supply integrated model (K-water's dedicated TF, raw-to-ultra-pure single pipeline) and the underground-transmission-line 100% government cost subsidy are real, disclosed lead-time/cost mitigations — directly the kind of finding this step exists to produce. | **Satisfiable — a strong real example.** |
| 3. Incentive NPV vs. infra capex on one comparison table | Line items are real (tax credits, gift-tax exemption, FAR relief) but, as in Screening step 3, no public NPV conversion exists to check against a single comparison table. | **Partially satisfiable.** |
| 4. Certification transferability | Not applicable — new facility, no existing certified operation being relied upon. | **N/A, correctly excluded.** |
| 5. Gate pass record | Confirmed by real construction commencement. | **Satisfiable.** |

## 4. Walkthrough Against `procedures/_shared/greenfield-fs/schema.yaml` and `greenfield-dd/schema.yaml`

- **FS capex schedule with permit critical path**: real and strong — the government's explicit stated goal of shortening industrial-complex formation from the usual 10 years to 5 years, plus the 2026-08 permit-simplification policy targeting KRW 2.5 trillion of investment acceleration, is a direct real instance of permit lead time being treated as a first-order schedule variable, exactly as the procedure intends.
- **DD — site visit / infrastructure findings**: the water-supply conflict with upstream provinces and eastern Gyeonggi rural municipalities is a real, checkable instance of `checklists/site-selection-checklist.yaml` ss-08 (community acceptance / prior dispute history) — though the dispute here is inter-regional water-rights politics rather than the checklist's more typical framing of local-community-adjacent-to-site objections. Worth broadening the checklist's framing, similar to pilot 002's ma-07/08 finding.
- **DD — talent pipeline**: real, indirectly — up to 26,000 workers expected on-site by H1 2027 is a labor-availability figure of the scale `checklists/site-selection-checklist.yaml` ss-07 is meant to assess, though the source data doesn't break down local-vs-imported labor composition.

## 5. Findings

| # | Finding | Type | Action |
|---|---|---|---|
| F-1 | The real-world pattern (infrastructure plans concretized ~2 years *after* site announcement, not before) is a direct counter-example to the procedure's hard-pre-filter-first design intent (meeting M6 D-M6-1). This is not evidence the procedure is wrong — it is evidence that **real large-scale Green Field projects sometimes proceed politically/strategically before infrastructure is fully secured**, which the procedure should treat as an elevated-risk path requiring explicit escalation, not something the schema currently flags. | Gap — procedure enhancement candidate | Consider adding a kill-criteria-adjacent condition: `infrastructure_plan_not_finalized_at_site_announcement` → `escalate_to_risk_officer`, informed by this real pattern, for the Stage 4 SRS |
| F-2 | Site-selection-checklist's ss-08 (community acceptance) framing is oriented toward local-community-adjacent objections; this case's real dispute is inter-regional water-rights politics between upstream provinces and the project region — the same underlying risk category (non-technical, non-regulatory obstruction risk) from a different actor class. | Gap — checklist wording, same pattern as pilot 002's ma-07/08 finding | Broaden ss-08 wording to cover inter-regional resource disputes, not just adjacent-community objections |
| F-3 | Incentive-NPV mechanics (Screening step 3, Pre-FS step 3) could not be validated numerically — real incentive line items exist, but no public multi-site comparison or NPV conversion exists for this single-track case. | Scope limitation, not a defect (same class as prior pilots' WACC/hurdle gaps) | Track: a genuine multi-candidate Green Field case (several disclosed site finalists with public incentive comparisons) would be needed to validate this mechanic quantitatively — noted as a future pilot candidate if one surfaces |
| F-4 | Infrastructure lead-time/cost mitigation (Pre-FS step 2) and permit-critical-path-as-schedule-driver (FS) both had strong, clean real matches — the strongest Green Field-relevant findings in this pilot. | Positive — process validated | None needed |
| F-5 | The local-subsidy-equity dispute (Gyeonggi provincial allocation to Yongin/Hwaseong/Icheon criticized as low relative to tax contribution) is a real instance of `incentive-agent`'s scope (regional incentive sourcing, design §4-7) surfacing a genuine negotiation dynamic — incentives are not simply "received," they are actively contested even after a project proceeds. | Positive — informs incentive-agent's real-world operating context | None needed, informational |

## 6. Verdict

**Process partially executable — the first real test of the Green Field procedure family, with two genuinely strong matches (infrastructure mitigation, permit-critical-path scheduling) and one structurally important negative finding (F-1: real large-scale projects can and do proceed before infrastructure is fully secured, which the current schema doesn't explicitly flag as elevated risk).** Not a failure under ADR-0034 — every non-executable step failed for a data-availability or single-case-comparison reason (same class as prior pilots), not a process defect, and F-1 is a genuine, actionable design improvement surfaced specifically because this was a real case rather than a synthetic one — a fabricated Green Field case would very likely have shown infrastructure secured before site selection, since that is the "textbook" order, and would never have caught this real deviation.

## 7. Cross-Pilot Update (001-005)

Adds Green Field coverage to the pilot 004 §6 synthesis table:

| Pilot | Case type | What it validated | What it couldn't reach |
|---|---|---|---|
| 001-004 | (see `docs/pilots/pilot-004-sk-group-capital-rebalancing.md` §6) | | |
| 005 | Green Field (new facility) | Infrastructure lead-time/cost mitigation, permit-critical-path scheduling, real elevated-risk pattern (F-1) the schema didn't previously flag | Incentive-NPV numeric validation (single-site case), fresh TAM/SAM/SOM sizing, WACC/hurdle (same boundary as all prior pilots) |

All five pilots to date have found zero cases where the team's own procedures were fundamentally wrong — every finding has been a **scope gap** (a state, wording, or condition the schema didn't yet cover) rather than a **logic error**, and every gap found has come from a real case's actual complexity, not from synthetic-case fabrication. This is the strongest evidence yet that the manual-pilot-first principle (ADR-0034) is working as designed.
