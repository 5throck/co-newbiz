# ADR-0161 — Greenfield execution (S11) and post-management (S12) scoped by track and sub-track

- Status: Proposed
- Date: 2026-10-11 (updated 2026-10-12)
- Deciders: Human reviewer (pending final acceptance). Drafted by process-governance-manager. AI review alone cannot accept this ADR (procedure, checklist applicability, flow.spec change, retroactive policy application).
- Design of record: `docs/designs/2026-10-11-greenfield-investment-execution-and-post-management-design.md`
- Related: ADR-0047, ADR-0052, ADR-0059, ADR-0150, ADR-0159, ADR-0160
- Prerequisite: PR #511 (migration 0136 `capex_tranche`, flow.spec v2.7.0, ADR-0159, ADR-0160, migration 0138, human-only route pattern) merged first.

## Update 2026-10-12

Open questions Q1-Q7 were decided by the user in chat on 2026-10-12. The ADR stays Proposed until the human final review accepts the full text.

| # | Decision | Decided by |
|---|---|---|
| Q1 | New procedure `greenfield-execution-baseline`; not an extension of `entity-establishment-execution`. | user (chat) |
| Q2 | Changed from the draft recommendation: apply **retroactively** to in-flight projects, not at the next policy pin. | user (chat) |
| Q3 | External brownfield S12 coverage via a post-close step in `pmi-integration-execution` (activity `integration-monitoring`); partnership via `jv-lifecycle-governance` step 2 (activity `partnership-monitoring`). | user (chat) |
| Q4 | Tranche schedule uses the existing `capex_tranche` table (migration 0136), not `process_run.meta_json`. | user (chat) |
| Q5 | Greenfield is identified by `track` and `case_type`, not `origin`. | user (chat) |
| Q6 | Greenfield `investment-structuring` owned by greenfield-agent with financing-agent co-review; brownfield stays brownfield-agent. | user (chat) |
| Q7 | Default `venture_class`: driving (new site), enabling (existing_business_rbd), emergent (intra_venture); changeable by the person recording. | user (chat) |

## Context

S11 and S12 apply to both tracks but their execution and monitoring content assumes an acquisition closing. Greenfield has no execution baseline (capex tranches bound to S10 conditions, permit and certification milestones, hiring plan, ramp-up KPIs against the S8 adopted case and ADR-0159 goals). The S12 PMI tab is visible and writable for greenfield. `portfolio-venture-monitoring` is gated on `origin in {internal, hybrid, joint}`, so greenfield rows with null origin and every external brownfield deal (m_and_a, strategic_investment, partnership) have no applicable S12 procedure. PR #511 added `capex_tranche` (planned/released/withheld, two-person release, human-only route), which this ADR now binds to.

## Decision

1. New shared procedure `greenfield-execution-baseline` (applies_when `project.track eq greenfield` or `project.case_type eq greenfield`; six steps; human confirmation last) and an S11 activity of the same id. Step 1 binds to `capex_tranche` rows (source_stage S10) and the S10 deal-structure conditions; it never stores tranches elsewhere.
2. `portfolio-venture-monitoring` v1.2.0: predicate `any_of(origin in {internal, hybrid, joint}, case_type eq greenfield)`; greenfield ramp-up measure keys documented; five-term vocabulary unchanged with a greenfield mapping. S12 uses ADR-0159 project business goals and the S8 adopted case as reference evidence for ramp-up KPIs; never gate-blocking.
3. External brownfield S12: `pmi-integration-execution` gains a post-close monitoring step (activity `integration-monitoring`); partnership gets `partnership-monitoring` via `jv-lifecycle-governance` step 2.
4. `financing-plan-checklist` fin-04..fin-08 scoped to brownfield; new items gx-01..gx-03 in `entity-formation-checklist`.
5. flow.spec bumped to v2.8.0 (after v2.7.0). Activity-level `applicableTracks` is NOT supported (ADR-0160 follow-up confirmed stage-level only); scoping is enforced by procedure `applies_when` plus UI/API guards.
6. UI/API: PMI tab and writes gated by `pmiKickoffApplies`; new execution-baseline route. Baseline confirmation is human-only, by the project lead, with a mandatory rationale and every open finding acknowledged (Row 2 review addendum); tranche release stays human-only and two-person (proposer recorded, release locked while pending, audit before/after). Both routes join `HUMAN_ONLY_ROUTES` and the mcp-coverage exclusions. The DB change is limited to what PR #511 already ships (`capex_tranche`); this ADR adds no new table.
7. Brownfield m_and_a baseline (PMI kickoff, `pmi_*` tables, routes, rendered S11/S12 DOM) remains byte-identical.
8. Retroactive application: applied to all in-flight projects by procedure `applies_when` evaluated against the current spec, with one recorded, human-initiated policy migration entry (audit log) per project; no re-pin of `project_policy_pin`. New steps are recommended, not blocking, for any stage a project has already completed; blocking only for stages not yet reached. Nothing is deleted and no completed gate is reopened.

## Alternatives considered

- Extend `entity-establishment-execution`: rejected, entity-shaped and origin-gated; existing_business_rbd has no new entity.
- Add greenfield terms to the transition vocabulary: rejected, the five terms map cleanly.
- Tranches in `process_run.meta_json`: rejected (Q4); `capex_tranche` already exists with release controls.
- Apply at next policy pin: rejected by the user (Q2) in favour of retroactive application.
- Retroactive re-pin of every project: rejected; mutates pins silently at scale. Predicate application plus a recorded migration entry gives the same audit trail with less state change.

## Consequences

- Positive: every track/sub-track cell has an applicable S12 procedure; greenfield execution is tracked against the case, goals and real tranche rows; PMI data hygiene; in-flight projects benefit immediately.
- Negative: one more procedure; origin and track predicates coexist; retroactive application shows new recommended items on projects past S11/S12 that reviewers must understand are non-blocking.
- Rollback: revert spec to v2.7.0 and procedure versions; UI/API guards are additive; policy migration entries stay in the audit log (append-only) with a reversal entry; `capex_tranche` rows are untouched.

## Addendum 2026-10-12 — implementation Row 1 (procedures, checklists, flow.spec)

Status stays **Proposed**. Row 1 of the design task split is implemented in the working tree; the human final review has not happened. Decision record: `docs/decisions/DEC-20261012-02.md`.

- New `procedures/_shared/greenfield-execution-baseline/` v1.0.0 (Q1/Q4/Q5): applies when `project.case_type = greenfield`. The routing-var registry has no separate `project.track` var; `case_type` carries the track. It has six steps, and step 6 is the human confirmation by the new human role `execution-baseline-confirmer`. Step 1 reads `capex_tranche` and the S10 conditions and never writes tranche status. Seven output types were added to `procedures/_output-types.yaml`. `skill_key` was first omitted on every step; the follow-up (user decision 2026-10-12) restored it on all six steps and added `greenfield-execution-baseline` to `metadata.procedure_keys` of the six named skills (financing-plan-review, certification-roadmap, talent-pipeline-planning, greenfield-feasibility, incentive-clawback-assessment, stage-gate-governance), satisfying the skill-graph bidirectional contract.
- `portfolio-venture-monitoring` v1.2.0 (Q5/Q7): `any_of(origin in {internal, hybrid, joint}, case_type eq greenfield)`; documents the greenfield measure keys, the greenfield transition mapping and the default venture_class.
- `pmi-integration-execution` v1.1.0 (Q3): additive step 6 (post-close integration monitoring, m_and_a and strategic_investment by sub-track predicate). Steps 1-5 and the kill criteria are unchanged. Step-6 cycle rows are read from the existing `pmi_*` ledgers (`pmi_synergy_certification`, `pmi_key_talent`) and are not written to `venture_scorecard`, whose `source_procedure` CHECK (migration 0024) admits only `jv-lifecycle-governance` and `portfolio-venture-monitoring`; no migration is introduced (user decision 2026-10-12, follow-up).
- `jv-lifecycle-governance` v1.1.0 (Q3): `any_of(origin eq joint, sub_track eq partnership)`. Steps 1, 3, 4 and 5 carry `origin eq joint`, so the JV step set is unchanged, and step 2 has a partnership variant.
- `entity-ic-review` v1.3.0 (Q6): step 3 is scoped to brownfield, and the new step 3.1 is the greenfield IC memo (greenfield-agent, financing-agent co-review).
- Checklists: `financing-plan-checklist` v1.3.0 states the S11 scope of fin-04..fin-08 (brownfield) in its header, without changing item text or the S9 overlays. `entity-formation-checklist` v1.1.0 adds gx-01..gx-03; gx-03 (human confirmation) is binding (`waiver_eligible: false`). The financing-plan header carries a greenfield reading of the binding fin-09: funds flow is read as the capex drawdown plan (capex_tranche plus S10 conditions) and the FX plan applies when there is foreign-currency exposure.
- `process/flow.spec.yaml` v2.8.0 adds the activities `greenfield-execution-baseline` (S11), `integration-monitoring` and `partnership-monitoring` (S12), the S11/S12 outputs lines and an S12 greenfield reference completion criterion. The S11 objective (track-neutral wording) and the S12 `requiredArtifacts` addition (execution baseline variance, greenfield) from design §5.4 were first deferred, because `app/web-next/lib/process-flow.ts` mirrors them verbatim; the Row 1 follow-up (user decision 2026-10-12) applied them in both files with the version kept at v2.8.0. MCP coverage maps the S11 activity to `get_project_ic_package` and the two S12 activities to `get_portfolio_scorecard` (read tools only).

## Addendum 2026-10-12 — implementation Row 2 (backend)

Status stays **Proposed**. Row 2 is implemented in the working tree; the human final review and the Row 4 cross review are still pending. No migration was added (`db/migrations/` untouched).

- `app/web-next/lib/greenfield-execution.ts` (new): track resolution by `case_type` (live `project_case_classification`) and route/`md_project.track`, never `origin` (Q5). A missing or conflicting track is `needs_classification` and is not applied to either track (design §5.1.5).
- `GET/POST /api/projects/:id/execution-baseline` (new). GET reconciles live `capex_tranche` rows against the S8 adopted case capex lines (KRW_M over the case horizon). Any difference is a finding (O2), as are a non-KRW tranche, a missing case or capex line, and a missing S10 structure. GET also lists the source permits, certifications and incentives, and the ADR-0159 goals (reference only). POST is human-only (cookie, CSRF, analyst+, MNPI insider check). `record_entries` stores validated entries: permit and certification milestones as separate lists, an aggregate-only hiring plan, KPI targets and incentive obligations. `confirm` needs a rationale of at most 2000 characters. Both write append-only `process_run` rows (stage `s11_execution_baseline`, the `s11_pmi_kickoff` pattern) with audit before/after. The baseline never writes `capex_tranche`; release stays the two-person route.
- Retroactive rule (Q2): the S11 predicate in `lib/process-flow.ts` blocks a greenfield project on a missing confirmation unless S11 was already completed before the rule. "Already completed" means every other S11 criterion holds and either both IC GO decisions are dated before 2026-10-12 or the project's `policy_migration` entry lists S11. In that case the item is recommended and S11 is not reopened. S12 items are never blocking. *(The IC-GO-date part is superseded by review fix R1 below.)*
- `GET/POST /api/projects/:id/policy-migration` (new): one human-initiated `policy_migration` audit entry per project (`adr`, `from_spec` 2.7.0, `to_spec` 2.8.0, `migration_note` required, `completed_stages`, `applies`). It does not re-pin. O1 is encoded as the **project lead** (`project_member.project_role = 'lead'`), because no process-owner role exists in `procedures/_human-roles.yaml` or in the auth roles. `inFlightAdr0161Counts()` is the read-only impact query.
- `GET /api/projects/:id/post-management` (new): S12 applicability (portfolio-venture-monitoring including `case_type` greenfield, integration-monitoring, partnership-monitoring; all recommended). It also returns read views over `pmi_*`, `jv_term` and `venture_scorecard`, and the greenfield ramp-up view (`goal:` keys resolved to ADR-0159 goals, reference only). `recordGreenfieldScorecardCycle()` prefills the Q7 default `venture_class` and audits an override (`venture_scorecard.venture_class_override`). It writes only through the existing repository. `POST /api/projects/:id/post-management/scorecard` (human-only: cookie, CSRF, no MCP principal, non-agent, analyst+, MNPI insider check) records one greenfield cycle through it: `review_cycle`, `measures[]` (documented greenfield keys or `goal:<metric_key>`, finite numbers, status, evidence_ref), and an optional `venture_class` whose difference from the sub-track default requires a `note` of at most 2000 characters; the override audit entry carries before/after/note, and every cycle also gets a `venture_scorecard.greenfield_cycle_recorded` entry. Brownfield is 409 `not_applicable_track`, an unresolved track 409 `needs_classification`. Because the migration 0024 UNIQUE key (`run_id, source_procedure, section, measure_key`) excludes `review_cycle`, a cycle is stored on the latest run that does not already carry those measures; otherwise 409 `run_required` (a new analysis run is needed; no migration added). The post-management GET returns the effective `venture_class` (default, effective, overridden, override who/when/note) with the latest cycle values. S8 goals stay reference evidence only.
- PMI guards: the writes to `pmi/kickoff`, `pmi/synergy-certifications[/:id]` and `pmi/key-talent[/:id]` return 403 `not_applicable_track` unless `pmiKickoffApplies`. Reads are unchanged. `stageTabGroupsFor({ pmiApplies })` in `lib/stage-tabs.ts` removes the PMI tab; for PMI cases it returns the same object. The component wiring is Row 3.
- The new POST routes (execution-baseline, policy-migration, post-management/scorecard) are in `HUMAN_ONLY_ROUTES` and the mcp-coverage exclusions. The MCP read tool `get_execution_baseline` (design §6) is not added in this row.

## Addendum 2026-10-12 — Row 2 review fixes (risk-officer + security-engineer)

Status stays **Proposed**. The recommended option was implemented for each review item. No migration was added.

- **R1 (F1):** IC GO dates are no longer evidence of an already completed S11. Only a `policy_migration` entry whose server-computed `completed_stages` lists S11 exempts an unconfirmed baseline (`recommended`). A project that completes S11 after the rule needs a confirmed baseline. A DSE4PW-like fixture (greenfield existing_business_rbd, GOs dated 2026-09-04, S11 not complete) evaluates to `blocking`.
- **R2 (F2/S1, F6):** `lib/project-track.ts` is the one resolver for S11, S12 and PMI (`pmiApplicability` now uses it; `pmiKickoffApplies` and the m_and_a success path are unchanged). A `case_type` vs route conflict blocks S11 with an explicit blocker (`classification_conflict`). No signal at all never blocks; a warning is shown on the execution-baseline surface, and brownfield process output is unchanged. The `pmi/kickoff` POST error path for a non-applicable track changed from 400 `not_applicable` to 403 `not_applicable_track`.
- **R3 (F3/F4/C, S4):** Confirmation is restricted to the project lead (403 `lead_required`).
  - Required sections must be filled (409 `baseline_empty` with `missing_sections`): KPI targets, the hiring plan, and permit or certification milestones (except intra_venture).
  - Every open finding code must be acknowledged in `acknowledged_findings: [{code, rationale 1..500}]` (409 `findings_open` with `open_findings`). The acknowledgements are stored with the confirmation and audited.
  - The reads and the write run in one immediate transaction. The record and the audit name both the recorder and the confirmer.
  - A tranche change after confirmation sets `reconfirm_required`.
- **R4 (F5/D):** After S11 is complete with a confirmed baseline, new entries or tranche drift give `reconfirm_required` as a warning and do not re-block S11. It blocks only while S11 is not otherwise complete. A migration snapshot that lists S11 exempts only an unconfirmed baseline.
- **R5 (F7):** The reconciliation sums planned and released tranches only. Withheld tranches are listed but excluded; retired tranches are never listed. A capex line with a null unit is a finding and is not treated as KRW_M. Matching stays exact.
- **R6 (S2):** A scorecard `review_cycle` must be YYYY-Qn and no later than the current quarter plus one. `observed_at` must be a strict YYYY-MM-DD date or a full ISO 8601 datetime, parseable, and at most one day in the future.
- **R7 (S3):** The committee session routes (transcript, minutes GET/POST, advance, positions) bind the session to the path opportunity, to a committee run (stage not an `s<N>_*` ledger and `meta_json.committee_key` present) and to promoted-project visibility. Session meta is read and written only for runs that pass this check, and `confirmCommitteeMinutes` refuses ledger runs. A `s11_execution_baseline` run returns 404 and is never rewritten. The business-case run GET also excludes that stage.
- **R8/R9:** The post-management GET includes closed projects but not deleted ones. All three new GETs check MNPI insider status.
- **R10 (B):** The audit targets for baseline entries, baseline confirmation, `policy_migration` and the scorecard cycle and override hold record ids, hashes and summaries of at most 120 characters. Full text stays in the `process_run` record or the `venture_scorecard` rows. For `policy_migration`, which has no ledger row, only the summary and the hash are kept.
