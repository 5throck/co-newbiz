---
title: Greenfield investment execution (S11) and post-management (S12) by track and sub-track
status: draft
date: 2026-10-11
owner: process-governance-manager
spec_id: 2026-10-11-greenfield-investment-execution-and-post-management-design
adr: docs/adr/0161-greenfield-execution-and-post-management-by-track.md
related: [ADR-0047, ADR-0052, ADR-0059, ADR-0150, ADR-0159, ADR-0160]
---

# Greenfield investment execution (S11) and post-management (S12) by track and sub-track

## 1. Problem

S11 ("investment review and execution") and S12 ("post management") are declared
`applicableTracks: [greenfield, brownfield]` in `process/flow.spec.yaml`, but their
execution and monitoring content assumes an acquisition closing: the S11 objective
text says "execute (entity establishment or acquisition closing)", the
`investment-structuring` activity is owned by `brownfield-agent`, the only
post-approval integration activity is `pmi-kickoff` (pmi-agent), and the S12 tab
row exposes a "PMI" screen (key talent retention, synergy certification) to every
project regardless of track. Greenfield-specific execution (establishment steps,
capex tranche release against S10 conditions, permits and certifications, hiring,
ramp-up against the S8 business case and the ADR-0159 project business goals,
first revenue and BEP) has no procedure, no activity and no screen.

A second, less visible defect: S12's only procedure, `portfolio-venture-monitoring`,
applies only when `project.origin in {internal, hybrid, joint}`. Brownfield
external acquisitions (`origin = external` / `acquisition`) therefore have NO
applicable S12 procedure at all (PMI is S11-only), and greenfield projects whose
`origin` is null (legacy rows) also have none.

## 2. Evidence (read-only)

| Source | Finding |
|---|---|
| `process/flow.spec.yaml` S11 (lines ~570-643) | Activities: ic-preparation (pm), charter-baseline (pm), investment-structuring (brownfield-agent; entity-ic-review, jv-lifecycle-governance), risk-review (risk-officer), group-review (group-review-agent), entity-establishment-execution (process-governance-manager; origin in {internal, joint}), pmi-kickoff (pmi-agent; pmi-integration-execution). Gates `[entity_ic, group_ic]`. Outputs include "execution entry (PMI / venture monitoring / R&BD execution)". No activity-level track scoping in the file. |
| `process/flow.spec.yaml` S12 (lines ~645-678) | Single activity portfolio-monitoring (group-review-agent, portfolio-venture-monitoring). Five-term transition vocabulary (ADR-0150). `gates: []`. |
| `procedures/_shared/pmi-integration-execution/schema.yaml` | `applies_when: project.case_type eq brownfield`. Steps 1-5 (incl. 4.5) are integration-specific: Day-1 governance, IMO, synergy baseline, key talent, customer retention. |
| `procedures/_shared/portfolio-venture-monitoring/schema.yaml` v1.1.0 | `applies_when: project.origin in [internal, hybrid, joint]`. Comment states the predicate deliberately excludes external acquisitions because "the PMI track owns those". Step 1 inputs name "the PMI synergy tracker". |
| `procedures/_shared/entity-establishment-execution/schema.yaml` v1.1.0 | `applies_when: origin in [internal, joint] AND origin not null`. Five steps, chk-entity-formation evidence. Track-neutral by predicate, establishment-shaped by content. |
| `app/web-next/lib/pmi-kickoff.ts` | `pmiKickoffApplies(track, subTrack)`: false unless track = brownfield; `NON_PMI_SUB_TRACKS` = minority_investment, partnership, rbd, corporate_venture, existing_business_rbd, intra_venture. Already correctly track-scoped. |
| `app/web-next/components/stages/IcReviewStage.tsx` | PMI kickoff card is gated by `pmi_kickoff.applies`. Establishment 5-step card is always rendered; shows a "not applicable (not internal/joint)" note when origin does not match. |
| `app/web-next/lib/stage-tabs.ts` S12 row | Tabs: portfolio, **pmi**, charter (more: partnership, process, timeline). PMI tab is NOT gated by track. |
| `app/web-next/app/projects/[id]/pmi/page.tsx` + `app/api/projects/[id]/pmi/{kickoff,key-talent,synergy-certifications}` | Key-talent register and synergy certification ledger; no track guard in the page. |
| `db/migrations/0024` `venture_scorecard` | `measure_key` is free text, `section in (financial, strategic)`, `source_procedure in (jv-lifecycle-governance, portfolio-venture-monitoring)`, `venture_class in (driving, enabling, emergent, passive, jv)`. Can carry greenfield ramp-up KPIs without schema change. |
| `venture_transition_decision` (migration 0071) | Five-term vocabulary, rationale/learning_capture fields; track-neutral. Labels in `app/web-next/lib/labels.ts` (graduate_to_core, reduce_or_divest, ...). |
| `checklists/financing-plan-checklist.yaml` fin-04..fin-08 | Closing-specific items (consideration currency/FX, etc.) named as a follow-up by ADR-0160. |
| ADR-0160 "Follow-ups" | "S11 wording and agent for greenfield; closing-specific financing items fin-04..fin-08 for greenfield" left open. This design closes them for S11/S12. |
| Data snapshot `db/data/co-newbiz.sqlite` | DSE4PW: track greenfield, origin internal. T7T81A: track brownfield, origin external. Distribution: greenfield (null origin) 1, greenfield internal 1, brownfield external/acquisition/internal 1 each. |
| Running app (localhost:7748, read-only, project DSE4PW) | See section 4. Note: the S11 screen reports establishment as NOT applicable for DSE4PW, i.e. the live database's `origin` for DSE4PW is not internal/joint (likely null), unlike the dev snapshot. Origin is therefore unreliable as the greenfield discriminator. |

## 3. Current-state matrix

Legend: **E** exists and fits; **B** exists but brownfield-shaped (wrong or misleading for this cell); **N** missing; **n/a** correctly not applicable; **O?** depends on `origin` (may silently not apply).

### 3.1 S11

| Capability | GF null (new site) | GF existing_business_rbd | GF intra_venture | BF m_and_a | BF jv | BF strategic_investment | BF minority_investment | BF rbd | BF corporate_venture | BF partnership |
|---|---|---|---|---|---|---|---|---|---|---|
| IC package, entity/group IC, charter baseline | E | E | E | E | E | E | E | E | E | E |
| investment-structuring activity (owner brownfield-agent) | B | B | B | E | E | E | E | E | E | E |
| Entity establishment execution (5 steps) | O? | n/a (no new entity by default) | O? | n/a | O? (joint) | n/a | n/a | n/a | O? | n/a |
| PMI kickoff (integration baseline) | n/a (correctly hidden) | n/a | n/a | E | E | E | n/a | n/a | n/a | n/a |
| Capex tranche schedule bound to S10 conditions | N | N | N | n/a (consideration schedule) | N | n/a | n/a | N | N | n/a |
| Permit / certification execution milestones | N (S5 records exist, not an execution plan) | N | n/a | E (cert transferability) | N | n/a | n/a | n/a | n/a | n/a |
| Hiring plan baseline | N | N | N (intra_venture team transfer only via establishment step 4) | E (key talent) | B | B | n/a | n/a | n/a | n/a |
| Financing items fin-04..fin-08 | B (closing-specific) | B | B | E | E | E | E | E | E | E |
| Objective/output wording | B ("acquisition closing") | B | B | E | E | E | E | E | E | E |

### 3.2 S12

| Capability | GF null | GF existing_business_rbd | GF intra_venture | BF m_and_a | BF jv | BF strategic_investment | BF minority_investment | BF rbd | BF corporate_venture | BF partnership |
|---|---|---|---|---|---|---|---|---|---|---|
| Applicable S12 procedure | O? (none if origin null) | O? | E (origin internal) | **N** (external: none) | E (joint) | **N** (external) | O? (hybrid only) | O? | E | **N** (external) |
| Venture scorecard + 5-term transition decision | E (if procedure applies) | E | E | B (vocabulary is venture-shaped; no integration KPIs) | E | B | E | E | E | B |
| PMI tab (key talent, synergy certification) | **B (visible, writable)** | **B** | **B** | E | E | E | B (visible) | B | B | B |
| Synergy realization tracking | n/a | n/a | n/a | E | E | E | n/a | n/a | n/a | N (partnership value tracking) |
| Ramp-up vs S8 business case / ADR-0159 goals | N | N | N | n/a | N | n/a | n/a | N | N | n/a |
| Capex tranche release decision | B (next_tranche_released exists, not bound to S10 conditions) | B | E (venture tranche) | n/a | E | n/a | n/a | B | E | n/a |
| First revenue / BEP / utilisation KPIs | N | N | N | n/a | N | n/a | n/a | N | N | n/a |
| Permit / certification milestone tracking | N | N | n/a | n/a | N | n/a | n/a | n/a | n/a | n/a |
| Monitoring brief inputs | B (cites synergy certs, key talent) | B | B | E | E | E | B | B | B | B |

Summary: S11 is mostly track-neutral at the review/IC level and correctly scopes PMI
kickoff; its gaps are greenfield execution content (tranches, permits, hiring) and
brownfield wording/ownership. S12 is the weaker stage: its single procedure is
venture-shaped and origin-gated, so greenfield-with-null-origin and every external
brownfield deal (m_and_a, strategic_investment, partnership) currently have no
applicable post-management procedure, and the PMI tab leaks into greenfield.

## 4. What a greenfield project sees today (DSE4PW, read-only)

- **S11 `/ic-review`**: IC package, entity IC and group IC decision blocks (track-neutral,
  fine). The establishment 5-step table is rendered with all steps "pending" and a note
  that establishment does not apply because the project is not internal/joint. No PMI
  card (correctly gated). No capex tranche, permit, or hiring execution surface.
- **S12 `/portfolio`**: scorecard trend and rollup (empty), AI monitoring brief whose
  description lists synergy certifications and key talent as inputs, three-stage review
  panel, and the five-term transition decision form with a required "next tranche
  condition" field. No link to S8 business case, project goals, or S10 tranche
  conditions.
- **S12 `/pmi`** (tab visible in the primary row): "PMI post integration" with key-talent
  retention register and synergy certification ledger, both with write buttons for
  analysts. Meaningless for greenfield and a data-hygiene risk (rows could be written
  against a greenfield project).

## 5. Target state

### 5.1 Principles

1. Track discrimination uses `track` + `sub_track` (route decision), never `origin`
   alone. `origin` remains a secondary predicate inside procedures where it already is.
2. Everything currently correct for brownfield stays **byte-identical**: pmi-integration-execution,
   pmi-kickoff activity, `pmi_*` tables and routes, `pmiKickoffApplies`, entity/group IC,
   venture_transition_decision vocabulary.
3. Reuse ids. New procedure ids only where no existing procedure can carry the content.
4. No DB migration (section 7).

### 5.2 S11 target per track

| Track / sub-track | Execution activity | Procedure (id) | Agent |
|---|---|---|---|
| GF null (new site) | establishment-and-ramp-up-plan (new activity id `greenfield-execution-baseline`) | `entity-establishment-execution` (when a new entity) + new `greenfield-execution-baseline` | greenfield-agent (lead), financing-agent, incentive-agent, certification-agent, legal-counsel |
| GF existing_business_rbd | same activity, establishment steps skipped (no new entity); baseline = capex tranches + hiring + KPI targets | `greenfield-execution-baseline` | greenfield-agent |
| GF intra_venture | establishment execution (existing) + baseline | `entity-establishment-execution`, `greenfield-execution-baseline` | greenfield-agent, process-governance-manager |
| BF m_and_a / jv / strategic_investment | unchanged: pmi-kickoff | `pmi-integration-execution` | pmi-agent |
| BF minority / rbd / corporate_venture / partnership | unchanged (no PMI); monitoring entry in S12 | existing | unchanged |

`investment-structuring` activity: owner becomes track-dependent (brownfield-agent for
brownfield, greenfield-agent for greenfield) as a reference-only bundling of the S10
output; wording "acquisition closing" becomes "entity establishment, establishment
execution baseline, or acquisition closing".

New procedure `procedures/_shared/greenfield-execution-baseline/schema.yaml`
(applies_when `project.case_type eq greenfield`; gate `Entity IC`, post-approval):

| Step | Agent | Output | Content |
|---|---|---|---|
| 1 | financing-agent | capex_tranche_schedule | Capex tranches with release conditions copied by reference from S10 deal-structure conditions and the S8 adopted case capex profile. |
| 2 | certification-agent + legal-counsel | permit_certification_milestones | Execution milestones from S5 permit records (operate) and certification roadmap (sell), kept separate (boundary #5). |
| 3 | greenfield-agent (talent-pipeline-planning) | hiring_plan_baseline | Headcount ramp by role family; intra_venture links to establishment step 4. |
| 4 | greenfield-agent | ramp_up_kpi_targets | Stage-gate KPI targets: first revenue date, utilisation ramp, BEP month, revenue/EBITDA vs S8 adopted case, plus ADR-0159 project business goals (reference evidence only). |
| 5 | incentive-agent | incentive_obligation_register | Clawback-bearing obligations (employment, investment amount, deadlines) from S10 incentives. |
| 6 | human (Entity IC owner) | execution_baseline_confirmation | Human confirms the baseline; agents never confirm. |

Checklist: reuse `chk-entity-formation` (ef-*) for establishment, `financing-plan-checklist`
fin-01..fin-03 for greenfield and mark fin-04..fin-08 `applies_when case_type eq brownfield`
(closing-specific: consideration, FX on consideration, earn-out, escrow, deferred
payment). New checklist items only for steps 1, 4 and 6 (`gx-01..gx-03`), added to
`entity-formation-checklist.yaml` as a new group rather than a new checklist file.

### 5.3 S12 target per track

| Track / sub-track | Activity | Procedure | Scorecard content (venture_scorecard measure_key) |
|---|---|---|---|
| GF all | portfolio-monitoring (unchanged id) | `portfolio-venture-monitoring` v1.2.0 (predicate widened) | financial: capex_deployed_vs_tranche, revenue_vs_case, ebitda_vs_case, bep_month_vs_plan, goal:<metric_key>; strategic: first_revenue_reached, utilisation_pct, headcount_vs_plan, permit_milestones_met, certification_milestones_met |
| BF jv / corporate_venture / minority (hybrid) | unchanged | `portfolio-venture-monitoring` | unchanged |
| BF m_and_a / strategic_investment | new activity `integration-monitoring` | `pmi-integration-execution` (extend: a step 6 post-close cadence, reusing pmi_synergy_certification and pmi_key_talent) | synergy run-rate, key talent retention, customer attrition |
| BF partnership | new activity `partnership-monitoring` | `jv-lifecycle-governance` step 2 scorecard (partnership variant) | partnership KPIs |
| BF rbd | portfolio-monitoring | `portfolio-venture-monitoring` | as greenfield ramp-up minus establishment |

`portfolio-venture-monitoring` predicate change: from `origin in [internal, hybrid, joint]`
to `any_of(origin in [internal, hybrid, joint], case_type eq greenfield)`. External
brownfield remains with PMI, now with an explicit S12 activity, closing the
"no applicable procedure" gap.

Transition vocabulary stays the five terms. Greenfield mapping (documented, no new
terms): next_tranche_released = release next capex tranche (condition = S10 tranche
condition met); held_evidence_incomplete = hold tranche; graduate_to_core = hand over
to the operating business unit after BEP/stable ramp; reduce_or_divest = scale down,
sell or wind down the facility; kill_with_learning_captured = stop with learning fed to
S1/S2 base rates (risk-officer). Labels in `app/web-next/lib/labels.ts` unchanged.

### 5.4 flow.spec changes (version bump to v2.8.0, after v2.7.0)

- S11 objective/outputs wording (track-neutral phrasing).
- S11 `investment-structuring`: owner by track (see 5.5 assumption).
- S11 new activity `greenfield-execution-baseline`.
- S12 objective unchanged; new activities `integration-monitoring` (BF m_and_a, jv, strategic_investment) and `partnership-monitoring` (BF partnership); requiredArtifacts gain "execution baseline variance (greenfield)".
- S12 completionCriteria: add "for greenfield, each scorecard cycle reports variance against the S11 execution baseline and the S8 adopted case" (ADR-0150 cadence unchanged).

### 5.5 Assumption on activity-level applicableTracks

Another agent is verifying whether `applicableTracks` per activity is supported. Today
`process/flow.spec.yaml` uses it only at stage level and `app/web-next/lib/process-flow.ts`
(line ~28) types it only on stages. **Assumption**: activity-level scoping is NOT supported
yet. Fallback used by this design: scoping is enforced by each procedure's `applies_when`
(already the pattern for pmi-integration-execution and entity-establishment-execution) and
by UI/API guards; the spec carries a comment per activity. If the verification finds
support, add `applicableTracks` on the three new activities and on `pmi-kickoff`.

## 6. System changes

| Layer | Change | Brownfield impact |
|---|---|---|
| `lib/stage-tabs.ts` | Hide the S12 PMI tab unless `pmiKickoffApplies(track, subTrack)`; show a new "Execution baseline" tab for greenfield. | None for PMI sub-tracks (byte-identical render). |
| `app/projects/[id]/pmi` + `api/projects/[id]/pmi/*` | Server guard: 409 `not_applicable_track` for writes when `pmiKickoffApplies` is false; read returns empty with reason. | None for m_and_a/jv/strategic_investment. |
| New `api/projects/[id]/execution-baseline` (GET, human-only POST confirm) | Reads S10 deal-structure conditions, S8 adopted case, ADR-0159 goals, S5 permits; stores the baseline in `process_run.meta_json` (stage `s11_execution_baseline`), same pattern as `s11_pmi_kickoff`. | None. |
| `IcReviewStage.tsx` | Greenfield card "Execution baseline" next to establishment; establishment card shows sub-track reason instead of origin-only reason. | Brownfield DOM unchanged. |
| `PortfolioStage.tsx` | Greenfield: variance panel (actual vs case vs goals), tranche condition prefill from the baseline, brief inputs exclude synergy/key talent. | Brownfield unchanged. |
| Scorecard route / `scorecard:rollup` | Accept greenfield measure_keys (free text already); add `goal:` prefix resolution to ADR-0159 goals. | None. |
| MCP | `get_portfolio_scorecard` unchanged; new read tool `get_execution_baseline`; confirm stays human-only (excluded in mcp-coverage). | None. |

### 7. DB

No migration. Baseline lives in `process_run.meta_json`; KPIs in `venture_scorecard`
(free `measure_key`); decisions in `venture_transition_decision`. `venture_class` for
greenfield uses existing values (`driving` for new site, `enabling` for
existing_business_rbd, `emergent` for intra_venture). If reviewers require queryable
tranche rows, that becomes a separate ADR with an additive migration (open question Q4).

## 8. Policy impact analysis (in-flight projects)

| Project | State | Impact |
|---|---|---|
| PRJ-DSE4PW (greenfield, S8) | Not yet at S11. Live origin appears not internal/joint. | Will reach S11 under v2.8.0 if merged first: gains the execution baseline; PMI tab disappears (no PMI rows expected; verify zero `pmi_*` rows before deploy). `project_policy_pin` must be checked; if pinned to v2.7.x, apply at next re-pin, not retroactively. |
| PRJ-T7T81A (brownfield partnership, S8) | Not at S11; partnership is a non-PMI sub-track. | PMI tab hidden (correct). Gains `partnership-monitoring` at S12. No change to S9/S10 obligations. |
| All brownfield PMI sub-tracks | n/a | Byte-identical; regression snapshot required. |

ADR-0150 was applied immediately to all projects; this change should NOT be: recommend
application at next policy pin (see Q2).

## 9. Review model

- AI 1st (deterministic): `procedures/_validate`, flow.spec schema validation, spec-activities regeneration diff, checklist id uniqueness, lint for track-scoped visibility.
- AI 2nd (cross-domain): platform-lead (technical) reviews system changes; risk-officer reviews kill/transition mapping; region-lead reviews permit milestone wording. Author domain (functional) cannot be second reviewer.
- Human final: procedure and checklist changes, flow.spec bump, and the ADR cannot pass on AI review alone.

## 10. Tests

- Unit: `pmiKickoffApplies` unchanged truth table; stage-tabs visibility per track/sub-track (10 cells); predicate evaluation of portfolio-venture-monitoring v1.2.0 incl. greenfield with null origin; fin-04..08 applicability.
- API: pmi write returns 409 for greenfield; execution-baseline confirm human-only (agent token rejected), CSRF.
- Scenario: extend `tests/scenarios/greenfield.test.ts` through S11 baseline and one S12 cycle; `brownfield-ma.test.ts` snapshot unchanged.
- Regression: rendered S11/S12 DOM snapshot for an m_and_a fixture byte-identical.

## 11. Accessibility and preview

Onyx 3.0 components only; variance status uses icon + text, never color only; tabs
keep keyboard order; hidden PMI tab removed from DOM (not `display:none`) so screen
readers do not announce it. Preview: DSE4PW (greenfield) and an m_and_a fixture at
`/projects/<id>/ic-review`, `/portfolio`, `/pmi` (expect 404-style "not applicable" page).

## 12. Non-goals

New transition vocabulary; changes to entity/group IC; automated tranche release;
gate blocking on missed goals (ADR-0159 boundary); brownfield PMI content changes;
DB migration.

## 13. Rollback

Revert flow.spec to v2.7.0 and procedure versions; UI guards are additive and revert
cleanly; baseline rows in `process_run` are inert if unread. No data migration to undo.

## 14. Open questions (recommended answers)

| # | Question | Recommendation |
|---|---|---|
| Q1 | New procedure `greenfield-execution-baseline` or extend `entity-establishment-execution`? | New procedure: establishment is entity-shaped and origin-gated; existing_business_rbd has no entity. |
| Q2 | Apply to in-flight projects immediately (like ADR-0150) or at next policy pin? | At next policy pin; neither in-flight project is at S11 yet. |
| Q3 | Should external brownfield (m_and_a, strategic_investment) get an S12 activity via PMI step 6 or be added to portfolio-venture-monitoring? | PMI step 6: keeps venture vocabulary out of integration tracking; reuse pmi_* tables. |
| Q4 | Store tranche schedule in process_run meta (no migration) or a new table? | meta_json now; revisit with an ADR if tranche-level querying is needed in S12 reports. |
| Q5 | Use `track`/`sub_track` instead of `origin` as greenfield discriminator for portfolio monitoring? | Yes (`any_of` with case_type greenfield); origin is null or unreliable on live greenfield rows. |
| Q6 | Owner of `investment-structuring` for greenfield? | greenfield-agent, financing-agent as co-reviewer. |
| Q7 | Default venture_class for greenfield sub-tracks? | driving / enabling / emergent as in section 7, editable by the human recorder. |

## 15. Task split

| Row | Task | Agent | Depends |
|---|---|---|---|
| 0 | This design + ADR-0161 human approval | process-governance-manager / human | ADR-0160 Row 1 merged |
| 1 | flow.spec v2.8.0, new procedure, portfolio-venture-monitoring v1.2.0, pmi step 6, fin-04..08 applies_when, gx-01..03 | process-governance-manager | Row 0; activity-scoping verification result |
| 2 | Stage-tabs and PMI API guards | frontend-engineer, backend-engineer | Row 1 |
| 3 | Execution-baseline API + MCP read tool + coverage exclusion | backend-engineer | Row 1 |
| 4 | IcReviewStage / PortfolioStage greenfield panels | frontend-engineer, design-system-agent | Row 3 |
| 5 | Tests (unit, API, scenario, regression snapshot) | backend-engineer | Rows 2-4 |
| 6 | AI 2nd review: platform-lead, risk-officer, region-lead; human final | cross-domain / human | Row 5 |
| 7 | /sync | pm | Row 6 |
