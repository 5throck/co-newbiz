---
title: "Gate integrity (wave W2) - design"
date: 2026-10-26
status: proposed
revision: 2 (after AI-2nd platform-lead review, REVISE)
author: process-governance-manager
design_of_record:
  - "docs/reports/2026-10-26-project-review-s1-s12.md"
  - "docs/adr/0186-gate-integrity.md"
lang: en
---

# Gate integrity (wave W2) - design

Companion to [ADR-0186](../adr/0186-gate-integrity.md) (Proposed). Status is `proposed` because the design waits on ADR approval. Outputs of this system are decision support; every rule below makes a human decision more accountable and never replaces it (boundary 2).

## 1. Scope and principles

In scope: review findings C1, C2, C3, H5, H6 (WACC confirmation only), H10, M16 and domain finding A-06. Out of scope: the route / S8 / S10 structure mismatch and T7T81A data correction (H6 remainder, one-time data), the growth-decile and QoE thresholds (W3), SSO and per-user identity federation.

Principles:

1. **Hard block only what policy already binds or what is mechanical hygiene.** Everything that involves judgement about the deal is an acknowledgement.
2. **The server recomputes.** The client never supplies kill outcomes, RAG, validator state or WACC state; it supplies acknowledgements and the hash of what it saw.
3. **Snapshot beside the decision.** What was known at decision time is stored with the decision, immutable.
4. **Write-time only.** No recorded decision is edited or invalidated. Legacy rows get a label, not a rewrite (ADR-0161 precedent).
5. **HOLD and KILL are never blocked.** They still keep their existing requirements.

## 2. Verified current state (read from code and the DB, 2026-10-26)

- `projects/[id]/gate-decisions` POST: checks role, gate and decision enums, non-empty rationale, HOLD artifacts, KILL learning capture, stage prerequisites (`gateGoPrerequisiteGaps`, stage-completion only), `IC_SEQUENCE = [entity_ic, group_ic]`, and a `gap_rationale` when deliverables are missing. It does not read kill criteria, RAG, validators, WACC, waivers. The opportunity route is the same minus the sequence check.
- The gate brief (`lib/gate-brief.ts`) persists nothing ("Nothing is persisted").
- `evaluateKillCriteria` callers: S8 adoption-recommendation route, watch engine, `ic-review-steps` (read side). Gate path: none. `kill_criteria_evaluation`: 0 rows. Registry: 35 entries, 24 executable, 11 inert (`enabled: false`).
- `approval_chain` table exists with `recordDecision`, `enterGroupReview`, `rankGroupAgenda` (ADR-0028/0029); 0 rows. The table has no recorder/decider user columns.
- `issueWaiver` inserts without `approved_at` even when `approved_by` is given; `findActiveWaiver` requires `approved_at NOT NULL`. `approved_by` comes from the request body. `waiver` has 0 rows (no grandfathering needed).
- `project_checklist_item_state` has 26 `na` rows (17 on PRJ-DSE4PW, 9 on a soft-deleted project). `na` and `waived` on binding extra-checklist items already count as unmet (`dd-checklist-tailor.ts` ~755); plain mandatory items are unguarded.
- `app_user.role` values: admin 1, analyst 10, viewer 4. There is no human-role grant concept; `_human-roles.yaml` is a static registry read by validators.
- `group-investment-review` step 5: `agent_key: process-governance-manager`, `decision_authority: human`. It is the only step in `procedures/_shared/*` pairing an AI agent key with `decision_authority: human`.
- neb-policy 2.2 and bf-02 already require `kind=user` WACC and hurdle before FS; the DB holds no `wacc` or `hurdle_irr` assumption at all.

## 3. Decision contracts

### 3.1 D1 GO acknowledgement snapshot

**API.** New read endpoint on both carriers: `GET /api/projects/:id/gate-snapshot?gate=<gate>` and `GET /api/opportunities/:id/gate-snapshot?gate=<gate>`. It evaluates kill criteria (persisting `kill_criteria_evaluation` rows, D3), reads RAG, validators, WACC state, waivers, conditions and ladder, and returns the snapshot plus `snapshot_hash` (SHA-256 of the canonical JSON, volatile fields such as `computed_at` excluded).

POST gate-decisions gains optional fields (all required on GO when the snapshot lists items that need them):

```
snapshot_hash: string
acknowledgements: [{ key: string, kind: string, reason: string }]
kill_override_id?: string        // D1 binding halts
conditions?: [{ text, clear_by: "group_ic"|"establishment"|"closing", owner_role }]   // D4
brief_id?: string                // D9
divergence_reason?: string       // D9
```

**Snapshot shape** (stored as JSON in `gate_decision_snapshot.snapshot_json`, `schema_version: 1`):

```
{ schema_version, gate, entity: {type,id}, track, computed_at,
  engine_versions: { kill, validators, rag },
  kill: { evaluated, inert, triggered:[{key,procedure,criterion_id,action,binding}],
          unassessed:[{key,procedure,criterion_id}], false_count },
  rag: { overall, dimensions:[...], data_confidence_cap:{grade,applied,capped_dimension}, assessment_id } | null,
  validators: { declared:6, applicable, completed, missing:[...] } | null,
  nonwaivable_open: [{key,checklist_id,item_id,status}],
  wacc: { subject, status:"sourced"|"assumed"|"absent", bf13:"set"|"unset"|"n/a" },
  waivers: { active:[...], expiring_14d:[...] },
  conditions_open: [...], ladder:{ prior_gate, prior_decision_id, effective },
  ai: { brief_id, recommended, confidence } | null }
```

**Ack keys** are stable strings: `kill:<procedure>:<criterion_id>`, `rag:overall`, `rag:absent`, `np:<checklist_id>:<item_id>`, `cond:<condition_id>`. The server computes the required set; a missing key returns 422 `ack_required` listing the keys. Extra or unknown keys are rejected. Unassessed items of one procedure may share a `reason` through a `covers: [keys]` array (one stored row per item).

**Hard blocks at the decision write, in evaluation order** (first failing wins, all failures listed in `details`): `ladder_prerequisite_missing` (D7), `validators_incomplete` (D4), `wacc_unconfirmed` (D8), `kill_binding_unoverridden` (D1), `condition_open` (D4, only `group_ic`-scoped conditions at `group_ic` GO), `checker_must_differ` (D6, at countersign), `rationale_insufficient` and `divergence_reason_required` (D2/D9), then `snapshot_stale`, then `ack_required`. Existing codes `gate_prerequisites_incomplete` and `ic_gap_rationale_required` keep their positions and meaning.

**Opportunity gates.** No RAG block (RAG is project-scoped); the screening gate shows the deterministic recommendation (`gateRecommendation`) as DISPLAY. Kill procedures per gate: `screening` -> `{track}-screening`, `pre_fs` -> `{track}-pre-fs` (greenfield-pre-fs / brownfield-pre-fs), `target_screening` -> `brownfield-target-screening` and `brownfield-target-identification`. Track comes from the S4 route decision; before it exists, both screening procedures are evaluated and the higher-severity result wins.

**HOLD / KILL.** Snapshot computed and stored, no acknowledgements demanded.

**Atomicity.** Snapshot, decision, acknowledgements, evaluation-row linkage, condition rows, countersign request and audit entry are written in one transaction; the human-final review snapshot (ADR-0153) keeps its position before the insert.

### 3.2 D2 Rationale substance (function `validateRationale(text, profile)`)

> Revised by 3.13 (script-aware profile). The table below is superseded where it differs.

Pure function in `app/web-next/lib/rationale-check.ts`, shared by all write routes (gate decision, gap rationale, divergence, acknowledgement, waiver reason, `na` reason, condition clear note).

| Profile | Letters/digits (NFKC, any script) | Tokens | Other |
|---|---|---|---|
| decision | >= 20 | >= 4 | repeated-character share <= 70 percent; not on denylist; not identical to another gate's rationale for the same entity |
| ack | >= 12 | >= 3 | same denylist and repetition rule |

Returns `{ok:true}` or `{ok:false, reason: "too_short"|"too_few_words"|"placeholder"|"repetitive"|"duplicate_of_other_gate"}`; the 422 body carries the reason code. The denylist is a data file (`lib/rationale-denylist.json`) under docs-writer review, ko and en entries. The check is form-only by design; whether the reasoning is sound remains for the human reviewers and the AI review stages.

### 3.3 D3 Kill criteria on the gate paths

- `generateGateBrief` calls the shared snapshot builder, so the brief shows kill outcomes (adds a "kill criteria" block to the manifest, ADR-0118 manifest list updated).
- Persisting: reuse `kill-criteria.repository.ts`. `kill_criteria_evaluation.run_id` currently references a run; the gate path writes under a dedicated `run` row (kind `gate_integrity_eval`, one per evaluation event) for project gates only; see 3.12 for the FK facts and the opportunity case. No `gate_decision_id` column is added. The brief-time run has `evaluated_by = "gate-brief:<user>"`, the decision-time run `evaluated_by = "gate-decision:<user>"`.
- Evaluation scope per gate as in 3.1. Inert entries are counted and listed (DISPLAY).
- Activation table is in ADR-0186 D3. For `fin.dd_value_impact_unbridged` the filler counts `dd_finding` rows (selected-target scope, `target_id IS NULL`, ADR-0157) whose `value_impact` is non-null and non-zero and whose `assumption_key` is null or absent from the adopted business case assumptions. For `fin.targets_meeting_hurdle` it counts shortlisted targets whose base IRR is at least the confirmed hurdle; hurdle not user-confirmed returns missing (UNASSESSED), never zero. Each activation needs `policy_id` and `thresholds_source` (anti-tamper, `_validate.ts`), a `_baseline.json` bump, `snapshot-filler` version bump and tests.
- Deferred to W3 with owners: growth decile basis (risk-officer plus quant-methodologist: choose the reference class and basis, then `fin.growth_projection_decile` and `fin.growth_signoff`, covering the greenfield-fs entry and the new brownfield-fs growth/base-rate criterion) and QoE materiality (financial-analyst plus risk-officer: define "material", add `fin.qoe_material_gap_unexplained`).

### 3.4 D4 bf-01 derivation and condition precedents

**bf-01.** `lib/dd-checklist-tailor.ts`: for the extra checklist `chk-brownfield-feasibility` item bf-01 the state is `derive(evaluateValidatorCompleteness(db, projectId))` -> `pass` when `applicable_missing = 0` and `completed = applicable`, else `fail` with the missing list in the note; a stored manual row is ignored for bf-01 and the UI shows it read-only with "derived from the validator engine". `compliance-check` rows for the six validators remain the engine's input (written by the validators' own steps), so the human cannot satisfy bf-01 by editing a checkbox. DD GO hard block uses the same function so the checklist view and the gate cannot disagree. Greenfield projects have no bf-01; their analogue (greenfield mandatory items) stays on the existing completion path.

**Condition precedent** (`condition_precedent`): `id, project_id, source_decision_id, gate, text, clear_by, owner_role, status(open|cleared|withdrawn), created_by, created_at, cleared_by, cleared_at, clear_note, evidence_ref`. Rules:

- Created with an IC GO (`conditions[]`), or pre-filled and then confirmed: `mark_conditional` kill results and the missing-artifacts of the latest HOLD at the same gate. Dropping a pre-filled candidate needs a reason (stored in the acknowledgement).
- Cleared by a user holding `entity-ic-reviewer` or `group-ic-reviewer` who is not `created_by`; `clear_note` uses the ack profile and `evidence_ref` is required for `closing` conditions.
- Consumers: `gateGoPrerequisiteGaps` (conditions scoped `group_ic` block `group_ic` GO); S11 stage completion in the process engine (open `establishment` or `closing` conditions keep S11 incomplete and the establishment closure and execution-baseline confirm steps report "not done", never a defaulted pass); the IC package lists all open conditions.
- `conditional` already exists as a decision in the approval chain; the countersign carries the same `conditions` through to this table so there is one object, not two.

### 3.5 D5 Waiver and `na` hardening

- `POST /api/projects/:id/waivers` creates a pending request (`approved_by` ignored if sent; deprecated field rejected with 400 after the compatibility window). `POST .../waivers/:waiverId/approve` records `approved_by = authenticated user`, `approved_at = now`, status active.
- Approver checks: `approved_by != requested_by`; the user holds the human role in `approver_role` (roles allowed for waivers: `entity-ic-reviewer`, `group-ic-reviewer`; owner may add a dedicated role, Open Question 4); `expires_at <= approved_at + 90 days`.
- Issue-time eligibility: parse `clause_ref` as `<checklist_id> <item_id>`; item must exist; `mandatory && !waiver_eligible` -> 422 `not_waivable`. A `clause_ref` that resolves to no item is rejected (policy-clause waivers are not supported; none exist).
- `na`: the DD item PATCH route requires `note` meeting the ack profile when the item is mandatory and the user sets `na`; a second user confirms through `POST .../checklist-items/:id/confirm-na`. `na_confirmed_by != assessed_by`. DD completion counts unconfirmed mandatory `na` as pending. Binding items remain unable to be `na` or `waived` (existing rule).
- Waivers in the snapshot: active list and 14-day expiry flag (DISPLAY).

### 3.6 D6 Maker/checker and the `group-ic-reviewer` role

- Gate ladder state for `entity_ic` and `group_ic` becomes: `recorded` (maker wrote GO) -> `effective` (checker countersigned) . View helper `effectiveGateState` replaces raw `latestGateDecisions` consumers for the ladder, S11 and the panel; un-countersigned GO shows "awaiting countersign" and is not-GO for downstream gating. HOLD and KILL are effective immediately (no countersign needed to stop).
- Countersign endpoint `POST /api/projects/:id/gate-decisions/:decisionId/countersign` with `{decision: "approved"|"conditional"|"rejected"|"withdrawn_pending_resubmission", reason, conditions?}` calls the existing `recordDecision` on the matching `approval_chain` row (the chain row is ensured when the first IC decision is recorded; `ensureApprovalChain`). Checks: authenticated user != `gate_decision.decided_by`; user holds `entity-ic-reviewer` (entity_ic) or `group-ic-reviewer` (group_ic) grant. `approval_chain` gains `recorded_by` and `decided_by`.
- A checker `rejected` leaves the maker's GO non-effective and puts the disagreement on the record (both rows retained); the maker may record a new decision.
- Grants: `app_user_human_role(user_id, role_key, granted_by, granted_at, revoked_at)`; role keys validated against `_human-roles.yaml`; admin-only management route with audit entries; at least `entity-ic-reviewer` and `group-ic-reviewer` need two distinct holders for the rule to be satisfiable (Open Question 1).
- `_human-roles.yaml` gains `group-ic-reviewer` (description: Group Investment Committee decision, approved | rejected | conditional | withdrawn_pending_resubmission, and kill-criteria override issuance; reference neb-policy 3 and 2.5).
- Validator rule (`procedures/_validate.ts` and `scripts/co-newbiz/graph-map.ts --check`): error when a step's `agent_key` has an `agents/<key>.md` AND `decision_authority: human`. Fixture tests: the old step 5 form must fail, the re-owned form must pass.
- `kill_criteria_override` table: `id, entity_type, entity_id, criterion_id, procedure_key, reason, issued_by, issued_at, revoked_at`; issuer holds `group-ic-reviewer` and is not the recorder of the decision it will unblock (enforced when the decision is written).

### 3.7 D7 Gate ladder

`gateSequenceBlocker(gates, gate, latest)` is unchanged in signature; callers pass `ladderFor(track, carrier)`. New `ladderFor`: `["screening","pre_fs","fs","dd","entity_ic","group_ic"]` for greenfield; `["screening","pre_fs","target_screening","fs","dd","entity_ic","group_ic"]` for brownfield; project `fs` additionally checks the source opportunity's last ladder gate through `md_project.source_opportunity_id`. Opportunity GO gates apply the same function with the opportunity's track (before the S4 route decision the track is unknown: only `screening` and `pre_fs` apply, and `target_screening` requires brownfield, already enforced). Stale (`gate_decision_stale`) and un-countersigned decisions count as not-GO. The client-safe `gate-sequence-view` panel lock uses the same `ladderFor`, so UI and server cannot drift. Existing violation: one opportunity (`01M1MNQ6MKR8JMD83QESR24PB4`) holds a `target_screening` GO with no `screening` or `pre_fs` row; grandfathered.

### 3.8 D8 WACC and hurdle

- Process engine: stage S8 completion adds "WACC subject set and rates user-confirmed". Inputs: `md_project.wacc_subject`, `wacc_subject_rationale`, `wacc_subject_decided_by`, and `assumption` rows keyed `wacc` and `hurdle_irr` (`kind=user`) via the existing `fin.wacc_source_status` reader (`snapshot-filler.ts` ~773), so the gate and the kill criterion read one source.
- `fs` GO hard block `wacc_unconfirmed` lists which of subject, WACC, hurdle is missing. Brownfield: subject must be the target unless a bf-13 waiver exists (bf-13 is waivable, with the acquirer-based fallback rationale recorded); greenfield: the investing entity.
- Provisional labelling: a shared helper `discountRateProvisional(projectId)` feeds a banner on the S8 stage, business-case and simulation views, the gate brief caution list, the IC package and MCP/REST payloads (`discount_rate_provisional: true`). i18n keys added to both locales.
- Operational note: PRJ-T7T81A has the default 0.10 and no confirmed session; running `wacc-input-session` (quant-methodologist and a human confirmer) is the unblocker, not an ADR change.

### 3.9 D9 Decision-record hygiene

- `gate_brief_record(id, entity_type, entity_id, gate, recommended, confidence, rationale_draft_hash, llm_call_ref, generated_by, generated_at)`; the brief route inserts one and returns `brief_id`. The most recent brief for the same gate by the same user within 24 hours is the default; the client sends `brief_id` explicitly.
- `gate_decision` columns `ai_recommended_decision`, `ai_brief_id`, `divergence_reason` (nullable). Required `divergence_reason` when `ai_recommended_decision` is set and differs from `decision`. The deterministic screening recommendation (opportunity `screening`) is recorded the same way when no LLM brief exists.
- Reporting: `compliance-monitoring` gains divergence rate per gate and recorder, shown in the governance KPI view; risk-officer reads divergence reasons into S1/S2 base-rate learning. Counts are display only; no rate triggers any block.

## 4. Policy impact analysis

neb-policy (`policies/group/neb-policy.md` and the ko mirror), amendment via ADR-0186 plus a `policy_change` record with this analysis:

| Clause | Change | Affects |
|---|---|---|
| 2.1 | "Stage gates are sequential": state explicitly that GO at a gate requires a recorded, effective GO at the preceding gate of the track ladder; add the two ladders. | D7 |
| 2.2 | Add: S8 is not complete and FS does not open until WACC subject and rates are user-confirmed; outputs labelled provisional until then. | D8 |
| 2.3 | Add: six-validator completeness is derived from the validator engine, not from a manual checklist state. | D4 |
| 2.5 | Define the override: a recorded `kill_criteria_override` issued by a `group-ic-reviewer`, per entity and criterion; binding means action `halt`; other actions require acknowledgement. | D1, D6 |
| 2.9 (new) | Gate-record integrity: acknowledgement snapshot, rationale substance, AI-versus-human divergence reason, HOLD/KILL never blocked. | D1, D2, D9 |
| 2.10 (new) | Condition precedents are tracked objects that block closing until a person clears them. | D4 |
| 2.11 (new) | Waiver rules: approver differs from requester and holds the role, 90-day maximum, no waiver of non-waivable items, second-person check for `na` on mandatory items. | D5 |

Other layers touched (lifecycle rules in the project CLAUDE.md apply: ADR, impact analysis, `project_policy_pin` check):

- Procedures: `group-investment-review` (step 5 `agent_key` to `group-ic-reviewer`; step description keeps the four outcomes), `entity-ic-review` (step 2 text points to the snapshot; the decision step notes countersign), `brownfield-dd` (step 14 wording: derived; add twin criterion `dd_finding_with_value_impact_not_in_valuation_bridge` if the owner approves, Open Question 5), `brownfield-fs-comparative` (activation note). Procedure and checklist `version` fields bumped per their convention.
- Checklists: `brownfield-feasibility-checklist` bf-01 text appended with "(derived from the validator engine)"; ma-special-topics and guideline text for `na`.
- Registry JSON: two kill-criteria entries activated (greenfield-dd value impact, brownfield-fs-comparative hurdle), `_baseline.json` raised; `entity-ic-review__kill_criteria_condition_triggered` notes updated.
- `procedures/_human-roles.yaml`: `group-ic-reviewer`.
- flow.spec: `group_ic` and `entity_ic` gate criteria text (countersign, snapshot); minor version bump per ADR-0074; `process/flow.spec.yaml` is changed only through that recorded decision.
- Skills (how, never restating procedure steps): `stage-gate-governance`, `waiver-management`, `two-tier-approval-chain`, `compliance-monitoring`, `wacc-input-session`.
- Code surfaces: both gate-decisions routes, new snapshot / countersign / approve / confirm-na / condition routes, `lib/process-flow.ts`, `lib/gate-sequence-view.ts`, `lib/gate-brief.ts`, `lib/dd-checklist-tailor.ts`, `db/lib/compliance.ts`, `db/lib/approval-chain.ts`, `db/lib/snapshot-filler.ts`, `db/lib/kill-criteria.ts` (caller side), `procedures/_validate.ts`, `scripts/co-newbiz/graph-map.ts`; MCP tools `record_gate_decision`, `propose_gate_decision`, `generate_gate_brief`, `request_dd_waiver`, `tailor_dd_checklist` gain the new fields (MCP stays a REST client, ADR-0011; a tool can only propose, never countersign).

## 5. `project_policy_pin` check and in-flight projects

`project_policy_pin` has 5 rows over 2 projects, pinning `shared-greenfield-dd` and the `ovl-*-workspace-scope` overlays (superseded rows included); the neb-policy itself is not pinned. neb-policy 2.8 therefore does not hold the amended policy back from any project. The new controls are process mechanics applied at the next gate write; the pinned documents (DD checklists and overlays) continue to define item applicability, so bf-01 derivation, `na` checks and the validator applicability use each project's pinned overlay version. No `policy_change` forced re-evaluation is requested: no recorded decision is re-opened.

Read-only snapshot of `db/data/co-newbiz.sqlite` (31 open `md_project` rows; 36 `gate_decision` rows):

| Project | Track | State | Effect |
|---|---|---|---|
| PRJ-T7T81A | brownfield | Source opportunity has `screening`, `pre_fs`, `target_screening` GO. No project gate decision. Report places it at S8. Pins: overlay `ovl-brownfield-workspace-scope` 1.2.3. 0 assumptions; WACC default 0.10; `wacc_subject` unset. | First real project under the new contract. S8 shows incomplete (WACC subject and rates unconfirmed) and all S8 outputs get the provisional label. `fs` GO hard-blocked until a WACC session is confirmed (D8). At `dd`: bf-01 derived from the engine, hard block if an applicable core validator is missing. At IC: countersign by a second human, snapshot acknowledgements. Ladder: all predecessor GOs exist. |
| PRJ-DSE4PW | greenfield | `fs`, `dd`, `entity_ic`, `group_ic` all GO by one user (`techcross`); 17 `na`, 21 `pass`; no WACC assumption; pins `shared-greenfield-dd` 1.1.0, overlay 1.1.0. | Recorded history untouched, labelled legacy (no snapshot, no countersign, WACC unconfirmed, 17 unconfirmed `na`). The IC package shows a legacy-record banner. Any new GO (re-decision) runs the full contract. Whether to retro-confirm WACC and countersign is an owner choice (Open Question 6). |
| DEMO-S1-S12 (brownfield) | brownfield | Four GOs by `demo-seed` with a 37-character templated rationale; 105 `pass`, 8 `fail` DD rows. | Legacy label. Demo seed writes SQL directly and bypasses the API; reseed through the new contract in rollout phase P5 so demos show snapshots and countersign (recommended), otherwise they stay labelled legacy. |
| DEMO-GF (greenfield) | greenfield | Four GOs by `demo-seed`, 78 `pass`. | Same as DEMO-S1-S12. |
| 27 `NP-*` projects | unnamed | No name, no track, no decisions (test or fixture rows). | No impact until used. Recommend soft-delete of fixtures (Open Question 7). |
| PRJ-QGB2W5 | brownfield | Soft-deleted 2026-09-10 (`status` still `open`); history: DD HOLD, then entity_ic GO and group_ic GO. | Not in flight; excluded from enforcement; kept as the C3 evidence. |

Opportunity carrier: 20 recorded gate decisions (`screening` 9 GO and 2 HOLD, `pre_fs` 5 GO, `target_screening` 4 GO). One opportunity has a `target_screening` GO without earlier GOs (grandfathered). Open opportunities that reach a GO after rollout run the snapshot (kill outcomes, ladder, rationale, divergence) under the same flag.

## 6. Schema and migration needs

Each migration is justified by ADR-0186 (the required ADR for DB schema changes); all additive, nullable columns or new tables, no backfill, reversible metadata per ADR-0014. Numbering starts after `0172_dry_run_session.sql` and is confirmed by data-architect.

| Migration | Contents |
|---|---|
| 0173 gate_snapshot | New `gate_decision_snapshot(decision_id PK/FK, schema_version, snapshot_json, snapshot_hash, acknowledgements_json, computed_at, engine_versions_json)`; `gate_brief_record`; `gate_decision.ai_recommended_decision`, `ai_brief_id`, `divergence_reason`. |
| 0174 kill_override | `kill_criteria_override`. |
| 0175 condition_precedent | `condition_precedent` and indexes `(project_id, status)`. |
| 0176 human_role_grant | `app_user_human_role`; `approval_chain.recorded_by`, `approval_chain.decided_by`. |
| 0177 na_confirmation | `project_checklist_item_state.na_confirmed_by`, `na_confirmed_at`. 90-day waiver cap enforced in code and mirrored by a validator test; no table change required. |

Indexes: `gate_decision_snapshot(decision_id)`, `condition_precedent(project_id,status)`, `app_user_human_role(user_id, revoked_at)`. The kill-criteria JSON registry, `_human-roles.yaml`, `_baseline.json`, the neb-policy and procedure YAML are file-based and need no migration. Security-engineer review applies to: human-role grants (privilege model), countersign endpoint authorization, and the principle that agents and MCP never hold grants or countersign.

## 7. Rollout and grandfathering

- Per-family environment variables `CO_NEWBIZ_GATE_INTEGRITY_<FAMILY>` with values `off | shadow | enforce` (production default shadow, unit default off, restart to change; see 3.15). Families: `rationale`, `snapshot_ack`, `kill_binding`, `validators`, `wacc`, `ladder`, `maker_checker`, `waiver`, `divergence`.
- Order: P1 ships `shadow` for all families; after two weeks of shadow logs without unexplained would-block events, flip to `enforce` family by family in this order: rationale, waiver, ladder, validators, wacc, snapshot_ack and kill_binding, divergence, maker_checker (last, because it needs the second human to be provisioned).
- Shadow output: `appendAudit` entries `gate_integrity.would_block:<code>` and a weekly summary in the compliance KPI view.
- Grandfathering: existing rows are never re-evaluated or rewritten; `legacy` is derived (decision has no snapshot row) and shown as a label.
- Rollback: set the family to `off`; schema is additive so no migration rollback is needed for behavior.

## 8. Phased implementation plan

| Phase | Deliverables | Owners | Acceptance criteria |
|---|---|---|---|
| P0 Governance docs | neb-policy en/ko amendments and `policy_change` record; `group-ic-reviewer` in `_human-roles.yaml`; `group-investment-review` step 5 re-owned; reverse validator rule + fixtures; flow.spec minor bump through a recorded decision; skill text updates; procedure/checklist version bumps. | process-governance-manager (content), docs-writer (language policy, ko mirror), backend-engineer (validator rule) | `bun run validate:language` clean; `procedures/_validate.ts` and `graph-map.ts --check` pass; the reverse rule fails on a fixture with an AI key plus `decision_authority: human` and passes on the real tree; policy impact record exists. |
| P1 Hygiene primitives | `validateRationale` + denylist; waiver hardening (approve route, role check, 90-day cap, `approved_at`, eligibility, 422 `not_waivable`); `na` reason + second-person confirm; `ladderFor` + generalized `gateSequenceBlocker` (opportunity and project routes, panel lock); migrations 0176/0177; per-family flag plumbing in shadow. | backend-engineer, data-architect (migrations), security-engineer (grant model review) | Unit tests: placeholder rationales (a period, "ok", a bare Korean approval word) rejected, genuine 150-character Korean and English rationales accepted; waiver self-approval, same-user, over-90-day, non-waivable item, missing `approved_at` all fail, and an approved waiver is returned by `findActiveWaiver`; ladder tests for both tracks including stale and cross-entity; no regression in existing gate route tests. |
| P2 Snapshot and kill evaluation | `gate-snapshot` routes; snapshot builder; kill evaluation on brief and decision paths; `gate_brief_record`; acknowledgement contract; migrations 0173/0174; gate panel UI with acknowledgement list, stale-snapshot recovery, `legacy` label; both locales; MCP tools carry the new fields. | backend-engineer, frontend-engineer (Onyx 3.0 design system, ko/en), data-architect | `kill_criteria_evaluation` rows appear for every gate brief and decision (integration test); a GO without required acks returns 422 `ack_required` with the exact keys; a stale hash returns 409; a HOLD and a KILL need no acks and still store a snapshot; snapshot, decision and evaluation links are in one transaction (fault-injection test); design-lint and i18n lint clean; a11y: acknowledgement list is keyboard operable with labelled controls. |
| P3 Validators, conditions, maker/checker | bf-01 derivation and DD GO hard block; `condition_precedent` + clear flow + S11 blocking + IC package list; `kill_criteria_override`; countersign endpoint and effective-state helper; grant admin route; migrations 0175/0176; UI. | backend-engineer, frontend-engineer, data-architect, security-engineer | A brownfield DD GO with an applicable core validator missing returns 409 `validators_incomplete`; manually setting bf-01 `pass` has no effect; an IC GO with `conditions[]` creates rows and S11 reports not done until cleared by a different eligible user; same-user countersign returns 403 and never changes state; un-countersigned IC GO is not-GO for the ladder; override by a non-holder is rejected; security review signed off. |
| P4 WACC and predicates | S8 completion rule; `fs` GO block; provisional label across outputs; `fin.dd_value_impact_unbridged` and `fin.targets_meeting_hurdle` filler vars and registry activation; baseline bump. | backend-engineer, frontend-engineer, quant-methodologist (hurdle semantics), valuation-agent (bridge semantics), data-architect | A project without user-confirmed WACC/hurdle: S8 incomplete, `fs` GO 409 `wacc_unconfirmed`, labels visible in all listed surfaces; after confirmation the block lifts; new predicates have both a TRUE and a UNASSESSED test; `_validate.ts --strict` baseline passes. |
| P5 Divergence, KPIs, demo reseed, enforce | `divergence_reason`; KPI view; demo reseed through the contract; shadow review and family-by-family flip to `enforce`. | backend-engineer, frontend-engineer, process-governance-manager (KPI definitions), compliance-officer (monitoring operation) | Divergent decisions are rejected without a reason; reseeded demos show snapshots and countersign; each family has a shadow report with zero unexplained would-blocks before its flip; `bun scripts/audit.ts` clean. |

Dependencies: P0 before P1 (role keys and policy wording); P1 before P2 (rationale and ladder used by the new write path); P4 can start after P1 in parallel with P2 and P3. W3 items (growth decile, QoE, brownfield growth criterion, route/S8/S10 reconciliation, T7T81A data) follow after P4.

Review stages per the project review model: AI-1st (formal), AI-2nd from a different domain (platform-lead for the technical contract, risk-officer for the red-team of the blocks versus acknowledgements split), then human final. The ADR, policy changes and the security and privacy aspects cannot pass on AI review alone.

## 9. Alternatives considered

See ADR-0186. Additional design-level options rejected: (a) a client-computed snapshot (rejected, trusts the recorder); (b) storing acknowledgements on the existing `judgement_confirmations_json` sidecar (rejected, that field is optional by ADR-0182 and has no per-item reason or keys); (c) making countersign a second `gate_decision` row (rejected, it would double-count in `latestGateDecisions` and in the 36-row history).

## 10. Risks

- Acknowledgement fatigue: mitigated by one reason per procedure group for unassessed items and by shadow tuning.
- Single-owner deployments: maker/checker cannot be satisfied with one human; no bypass is provided because a bypass would void the control.
- Evidence variable quality: a wrong filler var would hard-block a halt-class criterion; activations ship with TRUE and UNASSESSED tests and start in `shadow`.
- Snapshot size: kill and checklist detail is bounded (35 criteria, tens of items); stored once per decision.

## 11. Observability

Audit events: `gate_snapshot.record`, `gate_decision.countersign`, `kill_override.issue`, `condition.clear`, `waiver.approve`, `gate_integrity.would_block:<code>`. KPIs: acknowledgement counts per kind, unassessed share per gate, divergence rate, countersign latency, open conditions older than 30 days, expired and expiring waivers.

## 12. Acceptance of the design

The design is accepted when ADR-0186 is accepted by the human owner. Until then no code, procedure, checklist, policy or flow.spec file changes.

## 14. Review revisions (AI-2nd platform-lead: REVISE; PM resolutions, owner may override)

Sections 3.10 to 3.16 amend the contracts above; where they conflict, they win.

### 3.10 Propose then confirm (B2)

- `propose_gate_decision` (MCP) and the proposal record payload carry gate, decision, rationale draft, missing artifacts and optional `brief_id`; they carry no `snapshot_hash` and no `acknowledgements`. `validatePayload` in `lib/proposals.ts` rejects both fields on a proposal (400 `human_fields_not_proposable`) so an agent cannot pre-acknowledge.
- Confirm flow: `GET /api/proposals/:id/confirm` (human cookie session) computes a fresh snapshot and returns it with the proposal nonce and `snapshot_hash`; `POST /api/proposals/:id/confirm` carries `snapshot_hash` and `acknowledgements`. Stale hash returns 409 `snapshot_stale`. The same server checks as 3.1 apply at confirm time.
- MCP contracts: `record_gate_decision` and `propose_gate_decision` document the new optional fields as human-only; `generate_gate_brief` returns `brief_id`; no MCP tool can countersign, approve, clear or override.
- Acceptance: a new mcp-proposal scenario (propose, human confirm with acknowledgements, stale-hash retry, attempt to smuggle acknowledgements in the proposal) and unit tests for `validatePayload`.

### 3.11 Test harness and fixtures (B3)

Owned deliverables, per phase (owner: backend-engineer unless noted):

- P1: environment defaults (unit off, scenario enforce only after fixtures land); rationale fixtures: every rationale string in tests and scenarios must meet the profile (audit and fix existing short strings; boundary tests use the real scenario strings); `_support` second user with `entity-ic-reviewer` and `group-ic-reviewer` grants (dev/scenario seed, R5); ladder helper.
- P2: `recordGate` helper extended for snapshot, hash and acknowledgements (computes required acks from the fresh snapshot); `_support/deals.ts` pre-seeds ladder GOs for every scenario that records a later gate; every scenario calling the gate routes is listed in the P2 task and updated (inventory generated by grep of `gate-decisions` in `tests/`).
- P3: countersign helper; scenarios that record `entity_ic` or `group_ic` countersign with the second user; condition-precedent clearing in the S11 scenarios.
- P4: brownfield-ma scenario gets a WACC confirmed `kind=user` (subject target) before `fs`; greenfield scenarios likewise; fixtures for `fin.dd_value_impact_unbridged` and `fin.targets_meeting_hurdle` (TRUE and UNASSESSED).
- Rule: no test assertion is weakened to pass; fixtures change, not expectations.

### 3.12 Kill-evaluation persistence (B1)

Facts: `kill_criteria_evaluation.run_id` references `run(id)` NOT NULL, `project_id` NOT NULL, `UNIQUE(run_id, procedure_key, criterion_id)` (migration 0023 lines 28-41). Consequences:

- Project gates: create one `run` row (kind `gate_integrity_eval`) per evaluation event; the brief and the decision each create their own so the unique key never collides on re-evaluation. Evaluated-by strings as in 3.3. The decision snapshot stores the `run_id` it used, giving the decision-to-evaluation link without a new column.
- Opportunity gates: no `kill_criteria_evaluation` rows; the outcomes (triggered, unassessed, false, inert) are stored in `gate_decision_snapshot.snapshot_json` only.
- Cost: `evaluateKillCriteria` calls `fillSnapshot` when the variable snapshot is missing; this is the dominant cost of the snapshot GET and is bounded by the per-(entity, gate, input-version) cache (3.15).
- Opportunity variable source: an opportunity-scoped reader supplies the variables that exist at opportunity scope; a predicate whose variable is project-only evaluates UNASSESSED for the opportunity. The criterion appears in the ACK list, so nothing passes silently.
- The migration set stays additive; migration 0173 no longer alters `kill_criteria_evaluation`.

### 3.13 Script-aware rationale profile (B4)

Replaces the table in 3.2. Dominant script = the script with the most letters/digits after NFKC normalization; ties go to Hangul.

| Dominant script | Decision profile | Ack profile |
|---|---|---|
| Hangul | >= 12 syllables and >= 3 eojeol | >= 8 syllables and >= 2 eojeol |
| Latin (and other) | >= 20 letters/digits and >= 4 words | >= 12 and >= 3 |

Common caps: jamo-only strings (no complete syllables) fail; a single syllable or character repeated for more than 70 percent of letters fails; the denylist is matched after normalizing endings (polite and plain endings, trailing punctuation, case) so inflected placeholders do not slip through; a rationale identical (normalized) to another gate's rationale for the same entity fails (decision profile). Boundary tests: exactly-at and one-below each threshold, using the real strings from scenarios and seeds. Error messages come from the ko and en next-intl catalogs (ADR-0184); the API returns the reason code and the UI renders the catalog text; no hard-coded message strings.

### 3.14 Grants, authentication and security (B5)

- Semantics under ADR-0038 deny-by-default: no grant row, or a revoked one, means 403 `human_role_required` on the countersign, waiver approve, condition clear, `na` confirm and kill-override routes. The table has no effect on any other route.
- Session type: grants are exercised only through cookie sessions. Bearer tokens and MCP calls are rejected on these routes with 403 even for a user who holds a grant.
- Issuance: admin-only route; a user cannot grant themselves a role, and nobody can grant the checker role to the recorder of a decision that grant would then countersign.
- Re-read at countersign: the grant is read inside the countersign transaction (no cached role); a grant revoked while a countersign is pending invalidates it (409 `grant_revoked`).
- Seed: P3 ships a dev/scenario seed that creates two grant holders; production grants are created by the admin route.
- Information wall: snapshot GET, confirm GET and the IC package apply the same `visibleProject` checks and inherit the project classification; a snapshot never contains data the caller could not already read.
- Append-only: `gate_decision_snapshot` has no UPDATE or DELETE path in code and a database trigger rejects both.
- Hardening: CSRF/Origin checks and rate limits on countersign, approve, clear, confirm-na, override and grant routes, the same as the existing cookie routes.
- Audit events added: `grant.issue`, `grant.revoke`, besides those in section 11.

### 3.15 Operational contract

- Flags: `CO_NEWBIZ_GATE_INTEGRITY_<FAMILY>` per family (rationale, snapshot_ack, kill_binding, validators, wacc, ladder, maker_checker, waiver, divergence), values off, shadow, enforce; production default shadow, unit default off, scenario enforce after fixtures land; changing a value needs a restart (accepted).
- Shadow audit entries (`gate_integrity.would_block:<code>`) are de-duplicated per (entity, gate, code, day).
- Performance: snapshot GET target under 500 ms, cache keyed by (entity, gate, input-version) where input-version covers the decision max id, assessment ids, assumption versions, waiver and condition counters.
- Hash canonicalization: JSON with sorted keys; numbers in a fixed format (shortest round-trip decimal, no exponent); waivers and conditions sorted by id; RAG = the latest stored assessment (never recomputed for the hash); volatile ids and timestamps (`computed_at`, evaluation run ids, brief timestamps) excluded.
- Concurrency: check-then-insert (ladder, snapshot hash, countersign state) runs inside BEGIN IMMEDIATE. A re-decision on the same gate is legal; the latest effective decision wins.
- Legacy rows (no snapshot row) count as effective for the ladder, so grandfathering never breaks the chain.
- `effectiveGateState` consumer inventory, all migrated in P3 behind the same flag: process engine (`lib/process-flow.ts`), IC package, MCP `get_gate_decisions` and `get_project_gate_decisions`, the inbox, S12 portfolio views, and the gate panel (`gate-sequence-view`). A unit test fails if a consumer still reads `latestGateDecisions` for ladder purposes.
- Waivers: the `approved_by` body field is accepted for one release behind a flag (logged, ignored for authority), then rejected.
- "RAG never computed" at a project `fs` GO is an ACK, not a block (the first real project will meet it).

### 3.16 WACC source for the `fs` hard block

`fin.wacc_source_status` is filled by `snapshot-filler.ts` from the `assumption` rows of the project's run (keys `wacc`, `hurdle_irr`). The `fs` hard block therefore needs a defined run: the snapshot reads the latest S8 business-case run of the selected scope (selected target for brownfield) and its assumptions; no run or no rows means `absent`. Fixture work: scenarios that reach `fs` must create these assumptions as `kind=user` (3.11, P4) and the WACC subject on `md_project`; the unit test matrix covers absent, assumed, sourced, and subject unset.

## 13. Open questions for the owner

1. **Second human for maker/checker.** Is a second named human available for `entity-ic-reviewer` and `group-ic-reviewer`? No bypass is designed.
2. **Waiver maximum.** 90 days proposed; confirm or give the policy number.
3. **bf-03 and other non-waivable items.** Hard block (for example certification transferability by Pre-FS close, neb-policy 2.4) or acknowledgement?
4. **Waiver approver role.** The two IC roles, or a dedicated waiver-approver human role?
5. **Demo data and fixtures.** Reseed the demos through the new contract (recommended) and soft-delete the 27 blank `NP-*` projects?
6. **PRJ-DSE4PW.** Leave as legacy, or require WACC confirmation and a countersign before new use?
7. **Early Group IC override.** May a kill-criteria override be issued before the formal `group_ic` sitting? The design assumes yes.
8. **W3 threshold owners.** Who owns the growth-decile reference class and the QoE materiality threshold?

Resolved by PM on review (owner may override): kill-evaluation persistence (3.12), propose-then-confirm (3.10), test harness (3.11), rationale profile (3.13), grant authorization (3.14), and the brownfield value-impact twin remains proposed in ADR-0186 D3 for the owner to confirm with the procedure change.
