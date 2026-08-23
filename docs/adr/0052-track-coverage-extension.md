# ADR-0052: Track coverage extension — deal-shape chain, PMI, JV lifecycle, R&BD gating, portfolio monitoring

**Status**: Accepted (2026-08-23 — user approval to proceed with implementation; Sections A–B landed as PR-12a/PR-12b, C–F sequenced)
**Date**: 2026-08-23
**Deciders**: process-governance-manager, compliance-officer, legal-counsel, market-intelligence-agent, quant-methodologist

## Context

PR-10 closed the fifteen-step M&A chain's front half, but the readiness audit of the ADR-0047 classification matrix (12 reachable cells: `case_type` × 4-value `origin` × `technology_track`) found the workflow still ends at Entity-IC approval. Nothing in any procedure covers signing → close → integration → BAU for M&A, operate/monitor/restructure/exit for JVs (origin=joint), or portfolio-level venture monitoring. The root cause mirrors PR-10's: **routing, not inventory** — four agents (`partnership-agent`, `pmi-agent`, `quant-methodologist`, `industry-lead`) and eight skills (`partner-sourcing-strategy`, `partner-due-diligence`, `jv-structuring`, `proxy-industry-chain`, `pmi-planning`, `monte-carlo-simulation`, `scenario-planning`, `expert-interview`) exist with zero procedure dispatches, and license-in / co-development / minority-investment deal shapes have no route at all.

Four research reports supply the external best practice (all committed under `docs/research/`): M&A DD workstreams (62 sources), venture governance (38 sources), PMI/JV-lifecycle/CVC monitoring, and R&BD stage-gating with partner sourcing and deal governance (22 sources). The user directive was to reflect the researched practice for the R&BD / internal-venture / M&A tracks into the design — a design-only PR; implementation is sequenced as PR-12 with its own spec.

## Decision

Adopt `docs/designs/2026-08-23-track-coverage-extension-design.md` Sections A–F as the **design of record for the track extension**:

1. **Section A — deal-shape selection chain**: partner sourcing → screening/fit → partner DD → deal-shape selection → execution, on a G0–G6-derived stage skeleton; five shapes (license-in, co-development, minority investment, JV origin=joint, full M&A origin=external) with shape-specific pre-signing checklists; selection criteria (control need, IP position, capital at risk, exit optionality, time-to-market); NIH anti-shelving revocation as license-in protection; kill criteria for partner-DD red findings and shape-recycle.
2. **Section B — PMI procedure design**: future `procedures/_shared/pmi-integration-execution/` (applies_when case_type=brownfield AND approval granted), owner `pmi-agent`; four phases (pre-close, day-1, first 100 days, value-up→BAU); synergy run-rate certified by Finance as the BAU-exit completeness fact.
3. **Section C — JV lifecycle governance** (origin=joint): operate / monitor / restructure / exit as the operate-side counterpart of PR-10's formation-time JV addendum; seven-dimension health scorecard; metric-tied restructuring triggers; exit designed at formation and executed here.
4. **Section D — R&BD gating**: TRL/MRL evidence matrix per gate (cutoffs ILLUSTRATIVE), derisking gates preceding commercial scale-up per Cooper, GAO-20-48G evidence-quality rules, real-options staged funding; `quant-methodologist` routed to FS valuation (monte-carlo) and FS risk (scenario-planning) on both tracks.
5. **Section E — portfolio monitoring**: bifurcated financial/strategic metrics, tranche-gated funding, kill/graduate governance at stage transitions; portfolio-monitoring script specified at design-statement level only.
6. **Section F — orphan routing**: all zero-dispatch assets gain designed routes **except `industry-lead`, which stays undispatched by design** — it is one of the four domain leads (design §Team Axes); industry input enters via `industry-profiles/` (mandatory `source`/`verified_on`) and lead consultation, not procedure steps. This closes that audit item as by-design.

**Cross-references**: ADR-0047 (origin=joint routing — Sections A/C write its classification axes, never a fifth origin value); ADR-0031 (partner-sourcing failure modeled as deal termination where the dependency is structural — Section A's P2 partner DD and its kill criteria are where that risk is surfaced before commitment); ADR-0051 (PR-10 anchor steps this design routes into: strategic-fit screen at screening, partner evidence at DD, `entity-establishment-execution` at execution).

**Six-validator invariant: untouched.** All of the above is post-IC or front-of-funnel; no DD-side validator changes are proposed or permitted by this design.

**Illustrative-numbers discipline**: every research-derived benchmark (83% integration failure, JV 65% buyout endings, 79% vs 33% restructuring outcome, 45% governance-framework prevalence, 39-month restructuring lag, 20–30% CVC success, TRL/MRL cutoffs, synergy stage-gate count, deadlock time-boxes) is marked ILLUSTRATIVE in the design and is not enforcement-active; activation requires the thresholds meeting under `docs/decisions/open/` — the same rule as `rag_rule` `enabled=0` and ADR-0051's scorecard bands.

**Attribution correction**: JV-lifecycle practice is cited to the Watermark / Water Street Partners → Ankura lineage (Bamford, Ernst, Branding Pyle, Walker, Bhargava, Mogstad, Kwicinski). "Vann & Willis-Shore" is unlocatable and must not appear in governance documents.

**TIPS / tech-holding verification flag**: Korea co-funding content (TIPS program mechanics, KONEX/KOSDAQ technology-special listing) arrived without primary-source verification and carries that flag wherever referenced; nothing in this design depends on it.

## Open Questions (for the thresholds meeting — `docs/decisions/open/`)

- **(a)** TRL/MRL cutoffs per gate (Section D.1 table — all ILLUSTRATIVE).
- **(b)** JV health-scorecard weights and review cadence (Section C.3 — seven dimensions, no weights yet).
- **(c)** Synergy certification criteria for BAU demobilization (Section B.4 — what "certified by Finance" requires, and the 90-day attrition threshold).
- **(d)** Deal-shape selection thresholds (Section A.3 — criterion weights/minimums at gate P3).
- **(e)** Whether portfolio-monitoring scorecards need a schema addition (Section E.4 — **ADR trigger**: no table stores JV/venture scorecards today; the monitoring script is blocked until this is decided).

## Consequences

- **PR-12 implementation scope is now defined**: the deal-shape chain procedure(s), `pmi-integration-execution`, the JV lifecycle extension/sibling, R&BD gate evidence demands, quant-methodologist dispatches, and the orphan-routing wiring — each per the design doc's WHAT/WHEN specs; skills own the HOW (boundary #3).
- **graph-map coverage grows** once PR-12 lands: `partnership-agent`, `pmi-agent`, `quant-methodologist` gain dispatches; eight zero-dispatch skills gain skill_key references. Until PR-12, the zero-dispatch audit findings stand unchanged.
- **No six-validator impact**: `brownfield-dd` steps 6–11 (validators, certification last at 11) and the no-waiver completeness check at 14 are outside this design's blast radius.
- **Sequencing dependency**: the portfolio-monitoring script follows, not precedes, open-question (e) — schema ADR → script → portfolio view is the longest lead chain; cells 5/6/9 of the classification matrix stay thin until it completes.
- **Section A landed (PR-12a, 2026-08-23)**: `procedures/_shared/deal-shape-chain/` — six steps P0–P5, closing `partnership-agent`'s zero-dispatch status; three kill-criteria registry entries (all inert — predicates null until open questions (a)–(d) resolve; registry executable baseline stays 2); six new output types; `checklists/deal-shape-presigning-checklist.yaml` (§A.2 shape gate sets); `checklists/partnership-checklist.yaml` v1.1.0 (+pt-08..pt-12, the P1 screen criteria). `applies_when` is deliberately absent: entry is a human funnel-entry decision made before case classification exists — the P3 outcome *writes* the classification axes, so no legal routing var can gate it (the migration-0014 registry is the only var vocabulary).
- **PM decisions on the design's four open items (2026-08-23)**: (1) JV lifecycle — **sibling procedure** remains the lean, decided at PR-12c; (2) PMI partial-stake predicate — **resolved at PR-12b**: the structured `applies_when` covers only the classification part (`project.case_type = brownfield`); "approval granted, activated at signing" is temporal state with no routing var, and the reduced-phase scope for non-control acquisitions stays **prose** keyed to ADR-0045's stake axis (stake lives in `deal_structure_hypothesis`, not the routing registry — inventing a var is out of scope); (3) P1 checklist — **reuse `chk-partnership`, extended to v1.1.0** (no separate chk-partner-fit; the shape-specific pre-signing content lives in its own `chk-deal-shape-presigning`); (4) P5 review ownership — **partnership-agent** (the design default), review executed via the existing `project-review` skill, feeding Section C/E monitoring.
- **Section B landed (PR-12b, 2026-08-23)**: `procedures/_shared/pmi-integration-execution/` — five steps at the NEW `post_close` gate slot: pre-close / day-1 / first-100-days / BAU-exit evidence (pmi-agent / `pmi-planning`) plus a human BAU-exit certification step (`bau-exit-certifier`, added to `procedures/_human-roles.yaml` in the same change per the registry discipline; decision vocabulary demobilization_approved | held_pending_certification | conditional_with_named_gaps). Closes `pmi-agent`'s and `pmi-planning`'s zero-dispatch status. Three kill-criteria registry entries (all inert): `synergy_run_rate_uncertified_at_bau_handover` (halt — completeness fact, blocks IMO demobilization), `key_talent_attrition_above_threshold_at_90d` (escalate_to_risk_officer), `clean_team_protocol_breach` (halt, with legal-counsel — gun-jumping). Registry 26→29 declared / 2 executable. Five new output types (44→49). B.5 boundary held: brownfield-dd steps 6–11 and 14 untouched; HR DD step 13 outputs consumed as inputs, not restated. `stage-gate-governance` skill (1.2.0) documents the post_close slot.
- **Policy impact (lifecycle rule, `procedures/**` + `checklists/**` modified)**: additions only — no existing procedure, step, or checklist item was modified or removed (`partnership-checklist.yaml` gains items; pt-01..pt-07 text unchanged). No in-flight `project_policy_pin` is affected: pins bind policy documents, and this change binds no new policy. This ADR is the required decision record.

## Source basis

Primary external sources (full reports with complete citation lists at `docs/research/pmi-jv-lifecycle-best-practice.md` and `docs/research/rbd-partnership-best-practice.md`; PR-10's two at `docs/research/ma-dd-best-practice.md` and `docs/research/venture-governance-best-practice.md`):

- Cooper / Stage-Gate International — 5th-generation model; research/derisking front-end preceding the commercial 5-gate process; Hold/Recycle gate vocabulary
- GAO — Technology Readiness Assessment Guide (GAO-20-48G): credibility, objectivity, reliability, usefulness
- EU Horizon 2020 General Annexes G-A (TRL definitions); NASA TRL; DoD MRL deskbook lineage; ISO 16290:2013
- ASAP — Alliance Life Cycle (7 phases); ISO 44001 collaborative-relationship management-system bar
- NIH techtransfer — license types, development benchmarks, anti-shelving revocation architecture
- NVCA — model legal documents (voting agreement, IRA, ROFR/co-sale, management rights letter)
- Bain ("10 Steps to Successful M&A Integration"; culture report), BCG (synergy stage gates; corporate venturing model; scaling corporate ventures), McKinsey (operating-model design; CVC essentials), EY/MergerIntegration (IMO practice), Galpin
- Harvard Law School Forum on Corporate Governance + Ankura JV Alchemist (Watermark/Water Street lineage) — JV governance index, exit five-step, portfolio gameboard, failure causes, deadlock ladders
