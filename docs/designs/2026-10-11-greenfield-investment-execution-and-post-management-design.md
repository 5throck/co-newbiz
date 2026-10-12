---
title: Greenfield investment execution (S11) and post-management (S12) by track and sub-track
status: draft
date: 2026-10-11
updated: 2026-10-12
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

> **Update 2026-10-12.** The user decided Q1-Q7 in chat (see section 15 and the ADR
> "Update 2026-10-12" note). This section reflects those decisions. Prerequisite: PR #511
> merged (migration 0136 `capex_tranche`, flow.spec v2.7.0 with S9 activities
> financial-dd / hr-dd / market-dd / financing-dd and the S9 workspace overlays,
> migration 0138 single-person `site_required` confirmation, ADR-0159 project business
> goals with goals attainment and `goals_ack`, ADR-0160 greenfield S10 establishment
> structure, the `HUMAN_ONLY_ROUTES` pattern with mcp-coverage exclusions).

### 5.1 Principles

1. Track discrimination uses `track` + `case_type` (+ `sub_track` from the route
   decision), never `origin` (Q5). `origin` remains a secondary predicate inside
   procedures where it already is.
2. **Brownfield byte-identical invariant**: everything currently correct for brownfield
   stays byte-identical: `pmi-integration-execution` steps 1-5 (incl. 4.5), the
   `pmi-kickoff` activity, `pmi_*` tables and routes, `pmiKickoffApplies`, entity/group IC,
   `venture_transition_decision` vocabulary, and the rendered S11/S12 DOM of the m_and_a
   baseline. The only brownfield additions are new, separately keyed items (a post-close
   step and two S12 activities) that do not alter any existing step, row or render.
3. Reuse ids and tables. New procedure ids only where no existing procedure can carry the
   content. Tranches live in `capex_tranche` (Q4); no new table.
4. Binding items are never scoped out (risk-officer principle): scoping removes only
   closing-specific items that have no greenfield meaning (fin-04..fin-08), and each
   removal has a greenfield replacement (gx-01..gx-03).
5. Fail-closed: if `track`/`case_type` cannot be resolved, the greenfield baseline and the
   PMI guard both treat the project as "not applicable, needs human classification", never
   as applicable-by-default to the other track.

### 5.2 S11 target per track

| Track / sub-track | Execution activity | Procedure (id) | Agent |
|---|---|---|---|
| GF null (new site) | `greenfield-execution-baseline` | `entity-establishment-execution` (when a new entity) + `greenfield-execution-baseline` | greenfield-agent (lead), financing-agent, incentive-agent, certification-agent, legal-counsel |
| GF existing_business_rbd | same activity, establishment steps skipped (no new entity) | `greenfield-execution-baseline` | greenfield-agent |
| GF intra_venture | establishment execution (existing) + baseline | `entity-establishment-execution`, `greenfield-execution-baseline` | greenfield-agent, process-governance-manager |
| BF m_and_a / jv / strategic_investment | unchanged: pmi-kickoff | `pmi-integration-execution` | pmi-agent |
| BF minority / rbd / corporate_venture / partnership | unchanged (no PMI); monitoring entry in S12 | existing | unchanged |

`investment-structuring` activity (Q6): owner is greenfield-agent with financing-agent as
co-reviewer for greenfield; brownfield-agent for brownfield (unchanged). Because
activity-level fields cannot vary by track, the spec keeps `owner: brownfield-agent` for
byte-identity and adds `greenfield-agent` plus `financing-agent` as track-scoped
co-owners through the procedure layer (`entity-ic-review` greenfield step owner) and a
spec comment. Wording "acquisition closing" becomes "entity establishment, establishment
execution baseline, or acquisition closing".

New procedure `procedures/_shared/greenfield-execution-baseline/schema.yaml` (Q1;
applies_when `any_of(project.track eq greenfield, project.case_type eq greenfield)`; gate
`Entity IC`, post-approval):

| Step | Agent | Output | Content |
|---|---|---|---|
| 1 | financing-agent | capex_tranche_schedule | Binds to live `capex_tranche` rows for the project (tranche_no, amount, currency, release_condition, status). Rows are created from S10 deal-structure conditions (source_stage S10) and reconciled against the S8 adopted case capex profile. The step reads and reconciles; it never writes tranche status. A gap (no rows, or sum differs from the case beyond tolerance) is a finding for the human, not an auto-fix. |
| 2 | certification-agent + legal-counsel | permit_certification_milestones | Execution milestones from S5 permit records (operate) and certification roadmap (sell), kept separate (boundary #5). |
| 3 | greenfield-agent (talent-pipeline-planning) | hiring_plan_baseline | Headcount ramp by role family; intra_venture links to establishment step 4. Aggregate only, no individual rows. |
| 4 | greenfield-agent | ramp_up_kpi_targets | Stage-gate KPI targets: first revenue date, utilisation ramp, BEP month, revenue/EBITDA vs S8 adopted case, plus ADR-0159 project business goals (reference evidence only). |
| 5 | incentive-agent | incentive_obligation_register | Clawback-bearing obligations (employment, investment amount, deadlines) from S10 incentives. |
| 6 | human (project lead, the Entity IC owner) | execution_baseline_confirmation | The project lead confirms the baseline with a mandatory rationale. Required sections must be non-empty, and every open step-1 finding must be acknowledged with its own rationale (review R3, 2026-10-12). Agents never confirm. |

Checklist: reuse `chk-entity-formation` (ef-*) for establishment, `financing-plan-checklist`
fin-01..fin-03 for greenfield and mark fin-04..fin-08 `applies_when case_type eq brownfield`
(closing-specific: consideration, FX on consideration, earn-out, escrow, deferred
payment). New items gx-01 (tranche schedule bound to `capex_tranche` and S10 conditions),
gx-02 (ramp-up KPI targets reference S8 case and ADR-0159 goals), gx-03 (human
confirmation recorded with rationale), added to `entity-formation-checklist.yaml` as a new
group.

### 5.3 S12 target per track

| Track / sub-track | Activity | Procedure | Scorecard content (venture_scorecard measure_key) |
|---|---|---|---|
| GF all | portfolio-monitoring (unchanged id) | `portfolio-venture-monitoring` v1.2.0 (predicate widened) | financial: capex_deployed_vs_tranche, revenue_vs_case, ebitda_vs_case, bep_month_vs_plan, goal:<metric_key>; strategic: first_revenue_reached, utilisation_pct, headcount_vs_plan, permit_milestones_met, certification_milestones_met |
| BF jv / corporate_venture / minority (hybrid) | unchanged | `portfolio-venture-monitoring` | unchanged |
| BF m_and_a / strategic_investment | new activity `integration-monitoring` (Q3) | `pmi-integration-execution` new post-close step (step 6), reusing `pmi_synergy_certification` and `pmi_key_talent` | synergy run-rate, key talent retention, customer attrition |
| BF partnership | new activity `partnership-monitoring` (Q3) | `jv-lifecycle-governance` step 2 scorecard (partnership variant) | partnership KPIs |
| BF rbd | portfolio-monitoring | `portfolio-venture-monitoring` | as greenfield ramp-up minus establishment |

Predicate change: `origin in [internal, hybrid, joint]` becomes
`any_of(origin in [internal, hybrid, joint], case_type eq greenfield)`.

**Use of project business goals in S12 (ADR-0159).** Ramp-up KPIs are measured against
the S8 adopted case and the S8 project business goals (`goal:<metric_key>` measure keys).
Goal variance is reference evidence in the scorecard and the monitoring brief only: it is
never gate-blocking, never auto-selects a transition term, and an unmet goal does not by
itself trigger kill. X pointers (cross-references to goals) hold only where the goal
target was judged pass/fail by a human; unjudged goals are shown as "not judged".

Transition vocabulary stays the five terms. Greenfield mapping (documented, no new
terms): next_tranche_released = release the next `capex_tranche` row (condition = its
`release_condition` met; release is the two-person human act); held_evidence_incomplete =
hold or mark `withheld`; graduate_to_core = hand over to the operating business unit after
BEP/stable ramp; reduce_or_divest = scale down, sell or wind down; kill_with_learning_captured
= stop with learning fed to S1/S2 base rates (risk-officer). Labels unchanged.

Default `venture_class` (Q7): `driving` for a new site, `enabling` for
existing_business_rbd, `emergent` for intra_venture. The default is a prefill; the person
recording the scorecard can change it, and the change is audited.

### 5.4 flow.spec changes (v2.8.0, after v2.7.0)

- S11 objective/outputs wording (track-neutral phrasing).
- S11 `investment-structuring`: greenfield co-owners per 5.2 (Q6).
- S11 new activity `greenfield-execution-baseline`.
- S12 new activities `integration-monitoring` and `partnership-monitoring`; requiredArtifacts gain "execution baseline variance (greenfield)".
- S12 completionCriteria: "for greenfield, each scorecard cycle reports variance against the S11 execution baseline, the S8 adopted case and the S8 project goals (reference only)".

### 5.5 Activity-level applicableTracks is not supported

Activity-level `applicableTracks` is NOT supported: flow.spec uses it only at stage level
and `app/web-next/lib/process-flow.ts` types it only on stages (confirmed by the ADR-0160
follow-up). Scoping is therefore enforced by each procedure's `applies_when` plus UI/API
guards, with a spec comment on each scoped activity. Adding activity-level support is out
of scope and would need its own ADR.

## 6. System changes

| Layer | Change | Brownfield impact |
|---|---|---|
| `lib/stage-tabs.ts` | Hide the S12 PMI tab unless `pmiKickoffApplies(track, subTrack)`; show "Execution baseline" for greenfield. | None for PMI sub-tracks. |
| `app/projects/[id]/pmi` + `api/projects/[id]/pmi/*` | Server guard: 409 `not_applicable_track` for writes when `pmiKickoffApplies` is false; reads return empty with reason. | None for m_and_a/jv/strategic_investment. |
| New `api/projects/[id]/execution-baseline` | GET assembles S10 conditions, `capex_tranche` rows, S8 adopted case, ADR-0159 goals, S5 permits. POST confirm is human-only. The confirmation record (single row in `process_run.meta_json` stage `s11_execution_baseline`, same pattern as `s11_pmi_kickoff`) stores only confirmer, timestamp, rationale and a snapshot hash of tranche ids; tranches stay in `capex_tranche`. | None. |
| Capex tranche release (existing route from PR #511) | Unchanged: human-only, two-person (proposer and approver differ), release locked while a proposal is pending, audit entry with before/after and proposer. | None. |
| `IcReviewStage.tsx` | Greenfield "Execution baseline" card; establishment card shows sub-track reason instead of origin-only reason. | Brownfield DOM unchanged. |
| `PortfolioStage.tsx` | Greenfield variance panel (actual vs case vs goals), tranche condition prefill from `capex_tranche`, brief inputs exclude synergy/key talent. | Brownfield unchanged. |
| Scorecard route / `scorecard:rollup` | Accept greenfield measure_keys; `goal:` prefix resolution to ADR-0159 goals. | None. |
| MCP | New read tool `get_execution_baseline`; confirm and release routes in `HUMAN_ONLY_ROUTES` and the mcp-coverage exclusions. | None. |

### 6.1 Human-only confirmations

| Action | Who | Rule | Audit |
|---|---|---|---|
| Execution baseline confirmation (step 6) | the project lead (`project_member.project_role = 'lead'`) | mandatory rationale; non-empty KPI targets, hiring plan and (except intra_venture) permit or certification milestones; every open reconciliation finding acknowledged (`acknowledged_findings`); agent tokens rejected (review R3, 2026-10-12) | audit entry with before/after record ids and hashes, recorder, confirmer, a 120-character rationale summary and hash (full text only in the `process_run` record) |
| Capex tranche release | two humans | follows the PR #511 rule: proposer and approver must differ; tranche locked while pending | audit entry with before/after, proposer and approver |
| Retroactive policy migration entry (section 8) | one human (process owner) | human-initiated per project | append-only audit entry |

Agents inherit the calling user's permissions; no agent can perform any row above.

### 6.2 MNPI and insider checks

The baseline surfaces S10 deal terms, tranche amounts and S8 case figures. These inherit
the project's need-to-know scope; the GET route enforces project membership, the MCP read
tool returns only to members, and the monitoring brief must not copy tranche amounts or
goal targets into portfolio-wide rollups visible to non-members. For listed counterparties
(strategic_investment, partnership with a listed partner), the existing MNPI flag on the
project gates the S12 brief export; integration-monitoring inherits the PMI MNPI handling.
security-engineer reviews these controls in Row 4.

## 7. DB

No new migration in this ADR. Tranches use `capex_tranche` from migration 0136 (PR #511;
status planned/released/withheld, retire instead of delete, status_changed_* stamps).
KPIs use `venture_scorecard` (free `measure_key`); decisions use
`venture_transition_decision`; the baseline confirmation is one small record in
`process_run.meta_json` that references tranche ids and never duplicates them.

## 8. Policy impact analysis (retroactive application)

The user decided (Q2, 2026-10-12) that the change applies retroactively to in-flight
projects.

### 8.1 Mechanism (chosen)

Apply by predicate, not by re-pin: each new or changed procedure's `applies_when` is
evaluated against the v2.8.0 spec for every project, regardless of `project_policy_pin`.
For each in-flight project a human (process owner) records one **policy migration entry**
in the audit log (`action = policy_migration`, `adr = ADR-0161`, `from_spec = 2.7.0`,
`to_spec = 2.8.0`, `migration_note`, actor). `project_policy_pin` is not rewritten.

Justification: re-pinning every project mutates pin state at scale and hides why; the
predicate approach changes no stored project state, and the per-project entry gives the
audit trail a reviewer needs. The entry is human-initiated, never automatic.

**Review update (2026-10-12, R1/R2/R4).** IC GO dates are not evidence that S11 was completed. S11 counts as already completed only when the project's `policy_migration` entry lists S11 in its server-computed `completed_stages`, or, for a project that completed S11 after the rule, when a confirmed baseline exists. A later change (new entries or a tranche change after confirmation) makes the requirement `reconfirm_required`, which blocks only while S11 is not otherwise complete. A conflict between `case_type` and the route track blocks S11 with an explicit blocker. When there is no track signal at all, nothing is blocked and a warning is shown instead.

### 8.2 Rules that protect existing state

1. Nothing is deleted or rewritten: no `pmi_*`, `venture_scorecard`, `capex_tranche`, gate
   decision or judgement rows change.
2. No completed gate is reopened. New steps and checklist items are **recommended, not
   blocking** for any stage the project has already completed; they are **blocking only
   for stages not yet reached** (or the current stage if its gate is not yet decided).
3. Scoping out fin-04..fin-08 for greenfield never invalidates a recorded judgement: any
   existing fin-04..fin-08 record on a greenfield project stays visible as historical
   evidence, marked "not applicable under v2.8.0".
4. The PMI guard hides the tab and blocks new writes for non-PMI cases; existing `pmi_*`
   rows on such projects (expected zero) remain readable from the audit view.

### 8.3 In-flight projects

| Project | State | Retroactive change | Could anything be invalidated? |
|---|---|---|---|
| PRJ-DSE4PW (greenfield, existing_business_rbd, S9) | Before S11 | S11 `greenfield-execution-baseline` applies and will be blocking at S11; S12 `portfolio-venture-monitoring` applies via `case_type`; PMI tab hidden (`pmiKickoffApplies` false); fin-04..fin-08 out of scope; gx-01..gx-03 apply at S11; default venture_class `enabling`. | No. Not yet at S10/S11; no tranche rows required yet. Verify zero `pmi_*` rows before deploy. |
| PRJ-T7T81A (brownfield partnership, S8, opted into the brownfield workspace scope) | Before S9 | S12 `partnership-monitoring` applies; PMI tab hidden (non-PMI sub-track); fin-04..fin-08 remain in scope; no greenfield baseline. | No. S8/S9 obligations and the workspace scope opt-in unchanged. |
| PRJ-QGB2W5 (brownfield strategic_investment, S9, 37 S9 judgements) | At S9 | S11 `pmi-kickoff` unchanged; S12 `integration-monitoring` applies (post-close step); PMI tab stays visible; fin-04..fin-08 remain in scope. | No. All 37 S9 judgements stay; no S9 step or checklist item changes. |
| DEMO-S1-S12 (brownfield m_and_a, S12, with data) | S11 and S12 reached | `integration-monitoring` (post-close step) applies as **recommended, not blocking** (S11 completed; S12 has no gate). PMI content unchanged. | No. S11 gates stay decided; existing PMI and scorecard data unchanged; render byte-identical apart from the new recommended item. |

The m_and_a baseline (DEMO-S1-S12 and fixtures) must stay byte-identical except for the
additive, separately keyed post-close step; a DOM and API snapshot proves it (section 10).

### 8.4 Risks

- Reviewer confusion: recommended items on completed stages might be read as defects.
  Mitigation: explicit "recommended (added by ADR-0161 after this stage closed)" label.
- Predicate drift: a project with unresolved `track` falls outside both tracks.
  Mitigation: fail-closed (5.1.5) plus a pre-deploy query listing such projects.
- Pin semantics: projects pinned to v2.7.x evaluate v2.8.0 predicates. Mitigation: the
  per-project migration entry documents it; the pin is unchanged for every other rule.
- Live data differs from the dev snapshot (origin on DSE4PW). Mitigation: run the impact
  query against the live database before deploy and attach the result to the PR.

## 9. Review model

- **AI 1st (deterministic validators first)**: `procedures/_validate`, flow.spec schema
  validation, spec-activities regeneration diff, checklist id uniqueness, applies_when
  predicate evaluation over all projects, HUMAN_ONLY_ROUTES / mcp-coverage check, brownfield
  snapshot diff.
- **AI 2nd (cross-domain, different from the functional author)**: risk-officer (binding
  items not scoped out, transition mapping, fail-closed, goals never blocking),
  legal-counsel (permit vs certification milestones, incentive obligations), security-engineer
  (human-only routes, two-person release, audit before/after, MNPI), auditor (retroactive
  migration entries, audit trail, byte-identical evidence). Each declares what it could not
  verify.
- **Human final**: procedure and checklist changes, flow.spec bump, retroactive
  application and this ADR cannot pass on AI review alone. Output is split into verified /
  could not verify / needs judgement; no PASS stamp.

## 10. Tests

- Unit: `pmiKickoffApplies` unchanged truth table; stage-tabs visibility per track/sub-track
  (10 cells); `portfolio-venture-monitoring` v1.2.0 predicate incl. greenfield with null
  origin; fin-04..fin-08 applicability; default venture_class per sub-track and override;
  fail-closed on unresolved track.
- Procedure: `greenfield-execution-baseline` step 1 reads `capex_tranche` (planned,
  released, withheld, retired excluded); gap reported, never auto-fixed.
- API: pmi write returns 409 for greenfield; execution-baseline confirm rejects agent
  tokens, requires rationale, CSRF; tranche release two-person, lock while pending, audit
  before/after with proposer; MCP read tool membership check.
- Retroactive: completed-stage items render as recommended and do not block; not-yet-reached
  stages block; policy migration entry recorded with migration_note; no rows deleted.
- Scenario: extend `tests/scenarios/greenfield.test.ts` through S11 baseline and one S12
  cycle with goals variance (non-blocking); `brownfield-ma.test.ts` snapshot unchanged.
- Regression: rendered S11/S12 DOM and API snapshot for the m_and_a fixture byte-identical
  apart from the additive post-close item.

## 11. Accessibility and preview

Onyx 3.0 components only; variance status uses icon + text, never color only; tabs keep
keyboard order; hidden PMI tab removed from DOM. Preview: DSE4PW and an m_and_a fixture at
`/projects/<id>/ic-review`, `/portfolio`, `/pmi`.

## 12. Non-goals

New transition vocabulary; changes to entity/group IC; automated tranche release; gate
blocking on missed goals (ADR-0159 boundary); brownfield PMI content changes; activity-level
`applicableTracks`; new DB tables.

## 13. Rollback

1. Revert flow.spec to v2.7.0 and the procedure/checklist versions (v1.2.0 to v1.1.0 for
   portfolio-venture-monitoring; remove the post-close step, gx-01..gx-03 and the
   fin-04..fin-08 scoping).
2. UI/API guards are additive and revert cleanly.
3. Policy migration entries are append-only; record a reversal entry per project
   (`action = policy_migration_reversed`) instead of deleting.
4. `capex_tranche` rows (PR #511) are untouched; the baseline confirmation record becomes
   inert if unread.
5. Any S12 scorecard rows written under the new measure keys stay as data (free-text keys).

## 14. Decisions (2026-10-12, user in chat)

| # | Decision |
|---|---|
| Q1 | New procedure `greenfield-execution-baseline`. |
| Q2 | Retroactive application to in-flight projects (section 8), replacing the earlier "next policy pin" recommendation. |
| Q3 | `integration-monitoring` via a post-close step in `pmi-integration-execution`; `partnership-monitoring` via `jv-lifecycle-governance` step 2. |
| Q4 | `capex_tranche` (migration 0136), not `process_run.meta_json`. |
| Q5 | Greenfield identified by `track` and `case_type`, not `origin`. |
| Q6 | Greenfield `investment-structuring`: greenfield-agent, financing-agent co-review; brownfield unchanged. |
| Q7 | Default venture_class driving / enabling / emergent, changeable by the recorder. |

## 15. Open questions (still open)

| # | Question | Recommendation |
|---|---|---|
| O1 | Who may record the per-project policy migration entry: process owner only, or any project lead? | Process owner (compliance-officer operated), so one accountable actor per migration. |
| O2 | Tolerance for step 1 reconciliation between `capex_tranche` sum and the S8 case capex. | Exact match in currency, any difference shown as a finding; no numeric tolerance auto-passes. |
| O3 | Q6 encoding: track-scoped co-owner via procedure layer (chosen here) vs splitting `investment-structuring` into two activity ids. | Keep one id (byte-identity); revisit only if activity-level scoping gets its own ADR. |
| O4 | Should the S12 post-close step for DEMO-S1-S12 be populated retroactively with demo data? | No; leave recommended and empty, so demo shows the non-blocking state. |

## 16. Task split

| Row | Task | Agent | Depends |
|---|---|---|---|
| 0 | Prerequisites: PR #511 merged; this design + ADR-0161 human approval; live impact query attached | process-governance-manager / human | PR #511 merged |
| 1 | Procedure `greenfield-execution-baseline`, `portfolio-venture-monitoring` v1.2.0, pmi post-close step, `jv-lifecycle-governance` partnership variant, fin-04..fin-08 applies_when, gx-01..gx-03, flow.spec v2.8.0 | process-governance-manager | Row 0 |
| 2 | Backend: execution-baseline API, PMI guards, HUMAN_ONLY_ROUTES and mcp-coverage, MCP read tool, policy migration entry route, scorecard `goal:` resolution | backend-engineer | Row 1 |
| 3 | Frontend: stage-tabs, IcReviewStage / PortfolioStage greenfield panels, recommended-item labels | frontend-engineer, design-system-agent | Row 2 |
| 4 | Cross review: risk-officer, legal-counsel, security-engineer, auditor; human final | cross-domain / human | Rows 1-3 |
| 5 | Verify (tests, snapshots, audit) + /sync | pm | Row 4 |
