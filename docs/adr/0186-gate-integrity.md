# ADR-0186: Gate integrity (acknowledged GO snapshot, binding checks, maker/checker, full ladder, WACC confirmation)

- Status: Accepted (2026-10-27) - approved by the human owner at the merge of PR 5throck/co-newbiz#746 (merge commit 6fa3ed6d); owner decisions recorded in design section 13 are authoritative. History: Proposed 2026-10-26, AI-2nd technical review by platform-lead returned REVISE (B1-B5), resolved in 'Review outcome and revisions'.
- Date: 2026-10-26
- Decider: human owner (approved 2026-10-27 at PR #746 merge). Drafted by process-governance-manager on PM dispatch (wave W2).
- Design-of-record: [docs/designs/2026-10-26-gate-integrity-design.md](../designs/2026-10-26-gate-integrity-design.md)
- Source review: [docs/reports/2026-10-26-project-review-s1-s12.md](../reports/2026-10-26-project-review-s1-s12.md) findings C1, C2, C3, H5, H6 (WACC part), H10, M16 and domain finding A-06.
- Related: ADR-0028 / ADR-0029 (two-tier approval chain), ADR-0036 (waiver expiry), ADR-0037 / ADR-0048 (mandatory validators, applicability registry), ADR-0053 (human decision steps and the human-role registry), ADR-0057 / ADR-0060 / ADR-0064 (kill-criteria evaluator, classification, armed vars), ADR-0074 (flow.spec SSOT), ADR-0094 / ADR-0095 / ADR-0098 (project gates), ADR-0152 (KILL learning capture), ADR-0153 (human-final review snapshot), ADR-0157 (per-target DD scope), ADR-0161 (retroactive-application precedent), ADR-0182 (judgement confirmations), ADR-0185 (six-validator definition, `target-selector` role). Does not supersede any ADR. It amends the neb-policy (policy_change record required) and adds migrations (see Schema).

## Context

The 2026-10-26 review found that the gate-decision write path records whatever a person types. In the live database (36 gate decisions: 33 GO, 3 HOLD, 0 KILL; 3 distinct recorders; `approval_chain` 0 rows; `kill_criteria_evaluation` 0 rows; `waiver` 0 rows; `validator_completeness_record` 0 rows; no `wacc`/`hurdle_irr` assumption anywhere):

| ID | Gap | Evidence |
|---|---|---|
| C1 | GO is not conditioned on kill criteria, RAG, validators, WACC or waivers. A one-character rationale is accepted. One user recorded all IC decisions (no maker/checker). The ladder is enforced only `entity_ic` to `group_ic`. | `gate-decisions/route.ts` (project) lines 57-105; `lib/process-flow.ts` `gateGoPrerequisiteGaps` (only stage-completion checks); `lib/gate-sequence-view.ts` `IC_SEQUENCE = [entity_ic, group_ic]`. One opportunity (`target_screening` GO) has no `screening` or `pre_fs` GO. |
| C2 | The kill-criteria evaluator exists (ADR-0057) but only the S8 adoption route and the watch engine call it; the gate path never does. 11 of 35 registry entries are inert. | `db/lib/kill-criteria.ts`; `procedures/_kill-criteria/`; 0 evaluation rows. |
| C3 | The bf-01 six-validator rule is a free-text checklist pass; the completeness engine is wired to nothing at gate time. A real brownfield project received entity and group IC GOs after a DD HOLD with no tracked condition precedent (the project is now soft-deleted; it remains the evidence). | `db/lib/validator-completeness.ts`; `dd-checklist-tailor.ts` ~735-760. |
| H5 | `na` on mandatory items is unguarded (17 `na` rows on the greenfield project PRJ-DSE4PW, 9 on the soft-deleted brownfield project). Waiver `approved_by` is free text (self-approval possible), duration is unbounded, `issueWaiver` never sets `approved_at` although `findActiveWaiver` requires it (so an "approved" waiver never takes effect), `waiver_eligible` is not checked at issue. | `waivers/route.ts` 66-110; `db/lib/compliance.ts` `issueWaiver`, `findActiveWaiver`. |
| H6 | WACC/hurdle is never human-confirmed while FS/DD/IC GOs are recorded, although neb-policy 2.2 and checklist item bf-02 (non-waivable) require `kind=user` before the FS gate opens. | `assumption`: 0 rows for `wacc`, `hurdle_irr`; default 0.10 in the generators. |
| H10 | The Group IC decision step (`group-investment-review` step 5) is owned by an AI agent key (`process-governance-manager`) with `decision_authority: human` ("recorder pattern"). It is the only such step in the procedure set. | `procedures/_shared/group-investment-review/schema.yaml` 51-56. |
| M16 | The AI-recommended decision is not stored beside the human decision, so disagreement and learning cannot be measured. | `gate-brief.ts` persists nothing; 33/36 GO, 0 KILL. |

Boundary constraints that shape every decision below (project CLAUDE.md, Non-Negotiable Boundaries):

- Boundary 2: gate approval belongs to humans. The system must not decide a gate or silently veto a GO on a RAG grade or any judgement call. It must instead force the conflict onto the record.
- Boundary 4: data confidence caps the RAG grade.
- bf-01 (six validators) and bf-02 (confirmed WACC/hurdle) are non-waivable and binding (neb-policy 2.2, 2.3, 4.2).
- neb-policy 2.5: kill criteria are binding; overriding one requires an explicit, recorded Group IC decision.

## Decision

### Enforcement classes (used throughout)

- **HARD BLOCK**: the write is refused (HTTP 409/422/403). Used only where the neb-policy or a non-waivable checklist item already makes the condition binding, or where the check is mechanical record hygiene that involves no judgement about the deal.
- **ACK**: the GO is recordable only when the recorder explicitly acknowledges each listed item with a reason. The system never decides the outcome; it makes the conflict un-skippable and permanent.
- **DISPLAY**: shown on the gate brief, gate panel and IC package, and stored in the snapshot; no input required.

HOLD and KILL are never blocked by any rule in this ADR (a KILL still needs `learning_capture`, a HOLD still needs `missing_artifacts`). The snapshot is persisted for every decision, not only GO.

### D1. GO acknowledgement snapshot (C1) - ACK, with named HARD BLOCKs

On every GO at every gate, opportunity (`screening`, `pre_fs`, `target_screening`) and project (`fs`, `dd`, `entity_ic`, `group_ic`), the server recomputes (never trusts the client) and stores, in the same transaction as the `gate_decision` row, a `gate_decision_snapshot` with: kill-criteria outcomes (triggered, unassessed, false, plus the inert count), overall RAG with dimensions and the data-confidence cap (project gates only; RAG is project-scoped), six-validator completeness (brownfield, `dd` and later), open non-waivable checklist items, WACC confirmation state, active and expiring waivers, open condition precedents, ladder predecessor, and the AI recommendation. At the human confirmation step (revision R2) the recorder submits `snapshot_hash` (the hash of the snapshot they saw) plus `acknowledgements[]`, each `{key, kind, reason}`. A changed state between viewing and recording returns 409 `snapshot_stale` with the fresh snapshot.

| Item | Class | Rule |
|---|---|---|
| Triggered kill criterion with action `halt` | HARD BLOCK (409 `kill_binding_unoverridden`) unless a `kill_criteria_override` exists for this entity and criterion | neb-policy 2.5 and 4. Override is issued only by a person holding `group-ic-reviewer` (D6), is who-when-why recorded, may precede the formal `group_ic` sitting, and is itself ACK-listed in the later snapshots. |
| Triggered kill criterion with action `escalate_to_risk_officer` or `mark_conditional` | ACK with reason; `mark_conditional` auto-creates a condition precedent (D4) | Not policy-binding as halts. |
| Unassessed kill criterion | ACK with reason (one reason may cover several unassessed items of the same procedure; one row is stored per item) | Silence is never read as pass (project review model). |
| Inert criteria | DISPLAY (count and list) | Visible, not evaluated. |
| Overall RAG = RED | ACK with reason | Never a block (boundary 2). |
| Overall RAG absent (never computed) at a project gate | ACK with reason | |
| Data-confidence cap applied | DISPLAY (grade and which dimension capped it) | Boundary 4 is already enforced inside the RAG engine; the snapshot makes the cap visible beside the decision. |
| bf-01 incomplete (applicable core validator missing), brownfield `dd` GO | HARD BLOCK (409 `validators_incomplete`) | neb-policy 2.3, 4.2; no waiver path. Re-checked, still hard, at `entity_ic` and `group_ic` GO. See D4. |
| bf-02 / WACC not user-confirmed, `fs` GO | HARD BLOCK (409 `wacc_unconfirmed`) | neb-policy 2.2. See D8. At later gates the state is re-read: if it regressed to `assumed`, HARD BLOCK as well (same policy clause). |
| bf-03: certification change-of-control transferability not confirmed from the certifying body's own rules, where load-bearing, at `pre_fs` GO | HARD BLOCK (409 `certification_unconfirmed`) | neb-policy 2.4 and 4.5; binding and non-waivable like bf-01 and bf-02 (owner decision O-3). |
| Any other open non-waivable item (mandatory, `waiver_eligible: false`, status not `pass`) | ACK with reason | No further hardening is decided. |
| Active waivers on this entity | DISPLAY (id, clause, approver, expiry); expiring within 14 days flagged | |
| Ladder predecessor GO missing | HARD BLOCK (D7) | |
| Open condition precedents | DISPLAY at GO; HARD BLOCK at closing (D4) | |

Enforcement is staged per rule family by environment variables `CO_NEWBIZ_GATE_INTEGRITY_<FAMILY> = off | shadow | enforce` (revision R6; rollout, design section 7): in `shadow` the server computes and logs what it would have blocked or required, without refusing.

### D2. Rationale substance check (C1) - HARD BLOCK (422 `rationale_insufficient`)

A deterministic, script-aware function, no model call (thresholds revised by R4; the earlier flat 20-character figure no longer applies). Applies to the decision rationale, the `gap_rationale`, the `divergence_reason`, and (with a lighter profile) acknowledgement and waiver reasons. Decision profile: after Unicode NFKC normalization and trimming, the text must have at least 20 letter-or-digit characters (any script), at least 4 whitespace-separated tokens, at most 70 percent of letters from a single repeated character, must not match a denylist of placeholder strings (period, "ok", "n/a", "test", "lgtm", "approved" and their Korean equivalents such as bare approval or agreement words and jamo-only strings, case-folded; the list lives in a data file), and must not be identical (normalized) to any earlier rationale on another gate of the same entity. Acknowledgement profile: at least 12 letter-or-digit characters and at least 3 tokens. The function judges form, not merit; whether the reasoning is good stays a human matter. Existing rows are not rewritten.

### D3. Kill criteria on the gate brief and gate decision paths (C2) - evaluation mandatory; effects per D1

`evaluateKillCriteria` runs (a) when the gate brief is generated (so reviewers see outcomes before deciding) and (b) authoritatively inside the decision write. Persistence is split by carrier (revision R1): project gates persist one `kill_criteria_evaluation` row per evaluated criterion under a dedicated `run` row per evaluation event; opportunity-gate outcomes live only in `gate_decision_snapshot.snapshot_json`. Procedure scope per gate: opportunity gates use that stage's screening or pre-FS procedures for the opportunity's track; project gates use the existing `applicableKillProcedures`.

Predicate activation (anchors: neb-policy 4 and the checklists named; each activation also bumps `procedures/_kill-criteria/_baseline.json`):

| Criterion | Decision | Reason and evidence |
|---|---|---|
| `greenfield-dd` `dd_finding_with_value_impact_not_in_valuation_bridge` (halt) | Activate in the implementation wave. New snapshot var `fin.dd_value_impact_unbridged` = count of `dd_finding` rows with a non-null value impact and no `assumption_key` that resolves to an assumption in the adopted business case. | Evidence exists (`dd_finding.value_impact`, `assumption_key`; commercial-dd-checklist cdd-06 "no narrative-only"). A brownfield twin criterion would need a new declared YAML entry in `brownfield-dd`; that is a procedure change and is deferred (see "Deferred to W3 (needs owner decision)"). |
| `brownfield-fs-comparative` `no_target_meets_base_scenario_hurdle` (escalate) | Activate after D8 lands. Var `fin.targets_meeting_hurdle` = number of shortlisted targets whose base-scenario IRR is at least the user-confirmed hurdle. Hurdle not user-confirmed gives UNASSESSED. | Evidence exists (per-target business cases, ADR-0157). Meaningless while the hurdle is the 0.10 default, hence the dependency. |
| `greenfield-fs` `growth_projection_outside_top_decile_without_risk_officer_signoff` (halt) | DEFER to W3. | The decile basis (ADR-0018 anchoring) is undecided and no sign-off variable exists. Interim: the existing IRR and ratio guards (`irr-guard`, `share-guard`) appear as DISPLAY lines in the snapshot. |
| `brownfield-fs` `qoe_reveals_material_earnings_quality_gap_unexplained` (escalate) | DEFER to W3. | Dual-blocked: no QoE variable exists and "material" is undefined; needs an owner threshold. |
| New `brownfield-fs` growth versus base-rate criterion (C2) | DEFER to W3 together with the greenfield growth criterion. | Same decile basis; adding an inert entry now would only increase the inert count. |
| `entity-ic-review` `kill_criteria_condition_triggered` | Stays declared; realized by the snapshot (it is the aggregate of D1) and annotated in its registry notes. | |

### D4. bf-01 derived from the completeness engine; condition precedent as a tracked object (C3)

- bf-01 stops being a hand-set checklist state. `evaluateValidatorCompleteness` (read-only) is the source: the checklist view renders bf-01 as derived, the DD completion summary counts it from the engine, and a manually written `pass` for bf-01 is ignored. Core rows only (six, per ADR-0185); `contingent-liability` remains a reported non-core row.
- Brownfield `dd` GO is HARD BLOCKED while any applicable core validator is missing (`validators.applicable_missing >= 1`), consistent with the existing armed kill criterion.
- A **condition precedent** becomes a row in a new `condition_precedent` table: text, `clear_by` (`group_ic`, `establishment`, or `closing`), owner role, source decision, status `open | cleared | withdrawn`, cleared-by, cleared-at, evidence reference. Creation: the recorder may attach `conditions[]` to an IC GO; an acknowledged `mark_conditional` kill result and the missing-artifact list of the most recent HOLD at the same gate are offered as pre-filled candidates that the recorder must keep or drop with a reason. Clearing requires a person holding `entity-ic-reviewer` or `group-ic-reviewer` who is not the person who created the condition. An open condition with `clear_by = closing` or `establishment` makes the S11 closing steps incomplete (HARD BLOCK on S11 completion and on confirming the execution baseline); `clear_by = group_ic` blocks the `group_ic` GO.

### D5. Waiver and `na` hardening (H5)

- Approval is a separate authenticated act (`POST /api/projects/:id/waivers/:waiverId/approve`). The free-text `approved_by` field is removed from the request body. The approver is the authenticated user, must differ from `requested_by`, and must hold the human role matching `approver_role` (D6 grant table). HARD BLOCK on violation.
- Maximum duration 90 days from approval (HARD BLOCK on a longer `expires_at`); no automatic extension; a renewal is a new request.
- Approval sets `approved_at`; a waiver without `approved_at` never takes effect (already the lookup rule).
- At issue, `clause_ref` must resolve to a checklist item; if the item is mandatory and `waiver_eligible: false` the request is refused (422 `not_waivable`).
- `na` on a mandatory item requires a substantive reason (ACK profile of D2) and a second-person confirmation by a different user with analyst role or higher. Until confirmed, the row counts as pending in DD completion. Overlay-derived N/X cells (ADR-0185 D-8 overlays) are scope, not a user `na`, and are unaffected. Existing `na` rows are grandfathered but flagged "unconfirmed (legacy)" in the IC package.

### D6. Maker/checker on `entity_ic` and `group_ic`; `group-ic-reviewer` human role (C1, H10)

- The person who records an IC decision (maker, `gate_decision.decided_by`) cannot be its approver (checker). An IC GO becomes effective only when the existing two-tier approval chain (`approval_chain`, ADR-0028/0029) holds an `approved` or `conditional` decision by a different authenticated user holding the matching human role. Until then the gate state is `pending_countersign` and counts as not-GO for the ladder (D7) and S11. HARD BLOCK on same-person countersign (403 `checker_must_differ`).
- New human role `group-ic-reviewer` in `procedures/_human-roles.yaml` (Group IC decision: approved, rejected, conditional, withdrawn_pending_resubmission; also the issuer of kill-criteria overrides). `group-investment-review` step 5 is re-owned from `process-governance-manager` to `group-ic-reviewer`. A new table maps authenticated users to human roles (grants are recorded, dated and revocable); agents hold no grants (boundary 1).
- Reverse validator rule in `procedures/_validate.ts` and `graph-map.ts --check`: a step whose `agent_key` resolves to an AI agent (`agents/<key>.md` exists) must not carry `decision_authority: human`. Today exactly one step violates it (`group-investment-review` step 5), which this ADR re-owns.

### D7. Full gate ladder (C1; neb-policy 2.1) - HARD BLOCK, policy wording clarified (decision: enforce)

GO at gate N requires the latest effective decision at gate N-1 on the track ladder to be GO (not stale per `gate_decision_stale`, not `pending_countersign`). Ladders: greenfield `screening, pre_fs, fs, dd, entity_ic, group_ic`; brownfield `screening, pre_fs, target_screening, fs, dd, entity_ic, group_ic`. The first project gate (`fs`) also requires the source opportunity's last ladder gate to be GO. `gateSequenceBlocker` is generalized to take the track ladder. Chosen over amending the policy to "deliverables only" because neb-policy 2.1 already says the system rejects entry, the data shows the ladder is already followed except for one grandfathered record, and the alternative would legitimize skipping the screening and pre-FS decisions. Policy 2.1 is clarified to say "recorded GO" explicitly. Write-time only; existing rows untouched.

### D8. WACC and hurdle confirmation (H6 WACC part) - HARD BLOCK at `fs`; labels until then

- S8 is not complete (process engine) until the project's WACC subject is set (`md_project.wacc_subject` with rationale and decider; bf-13 for brownfield, where the subject is the target) and `wacc` and `hurdle_irr` assumptions for that subject are `kind=user` (the existing `fin.wacc_source_status = sourced`). `fs` GO is hard-blocked while this is not so (neb-policy 2.2, bf-02).
- Until confirmed, every WACC-dependent output (business case, NPV and IRR tables, simulation, gate brief, IC package) carries a visible "provisional discount rate" label. This is DISPLAY; it blocks nothing by itself.
- bf-13 stays `waiver_eligible: true`; bf-02 stays non-waivable.

### D9. Decision-record hygiene (M16)

The gate brief persists its recommendation (`gate_brief_record`: recommended decision, confidence, generation reference). The decision body carries `brief_id`. `gate_decision` gains `ai_recommended_decision`, `ai_brief_id` and `divergence_reason`. If an AI recommendation exists and differs from the human decision, a `divergence_reason` meeting the D2 decision profile is required (HARD BLOCK 422 `divergence_reason_required`); if no brief was generated the recommendation is stored as none and nothing is required. Divergence counts feed governance KPIs and the S1/S2 base-rate learning loop (risk-officer). The system never changes the human decision.

## Schema changes (this ADR is the required ADR for each)

Five additive migrations starting at 0173 (R1 removes the proposed `kill_criteria_evaluation.gate_decision_id` change from migration 1; project-gate rows are linked through their `run` row recorded in the snapshot) (numbering confirmed by data-architect at implementation): (1) `gate_decision_snapshot` (+ `gate_decision.ai_recommended_decision / ai_brief_id / divergence_reason`) and `gate_brief_record`; (2) `kill_criteria_override`; (3) `condition_precedent`; (4) `app_user_human_role` (grants) and `approval_chain` columns for maker/checker (`recorded_by`, `decided_by`); (5) `project_checklist_item_state` second-person confirmation columns (`na_confirmed_by`, `na_confirmed_at`) and waiver approval wiring (no table change beyond a trigger or application check for the 90-day cap). All additive and nullable; no data rewrite; reversible metadata per ADR-0014.

## Policy, procedure and registry impact

neb-policy (en and ko mirror) amendments to 2.1, 2.2, 2.3, 2.5 and new 2.9 (gate-record integrity), 2.10 (condition precedents), 2.11 (waiver and `na` rules), with a `policy_change` record. Procedures: `group-investment-review` (step 5 owner), `entity-ic-review` (maker/checker and snapshot wording), `brownfield-dd` (bf-01 derivation only), `brownfield-fs-comparative` (hurdle activation note). Checklists: `brownfield-feasibility-checklist` bf-01 text (derived), guideline text for `na`. Registry: `_human-roles.yaml` (+`group-ic-reviewer`), kill-criteria JSON entries and `_baseline.json`. flow.spec: group_ic and entity_ic activity text (minor version bump). Skills: `stage-gate-governance`, `waiver-management`, `two-tier-approval-chain`, `compliance-monitoring`, `wacc-input-session`. Details, the in-flight project check and the `project_policy_pin` analysis are in the design.

## Alternatives considered

1. **Hard-block every triggered or unassessed kill criterion and RED RAG.** Rejected: violates boundary 2 (the system would decide), and unassessed is a measurement gap, not a verdict.
2. **Do nothing mechanical; rely on reviewer training.** Rejected: the data shows 33 GO / 0 KILL, one-character rationales accepted, and zero evaluation rows.
3. **Amend neb-policy 2.1 to "deliverables recorded" and keep only the entity-to-group ladder.** Rejected (D7): it would legalize the recorded ladder violation.
4. **A separate maker/checker mechanism instead of `approval_chain`.** Rejected: the two-tier chain, its `recordDecision` engine and its tests already exist (0 rows because nothing calls it).
5. **LLM-judged rationale quality.** Rejected: a model grading human reasoning is a decision-support output, not a gate rule; a deterministic form check is reproducible and cheap.
6. **Block RED RAG after a Group IC override.** Rejected as redundant: the override is for binding kill criteria; RED stays ACK-only.

## Consequences

- Positive: every GO carries a permanent, replayable record of what was known and what the recorder chose to accept; disagreement with the AI becomes measurable; binding policy clauses become mechanical; the dormant evaluator, completeness engine and approval chain get their first callers.
- Cost: more fields on the decision form; more friction on unassessed-heavy projects (mitigated by one reason per procedure group); a second person is required for IC decisions (single-owner deployments need a second user ; the owner confirmed a second human is available (O-1)).
- Risk: false stalls from stale snapshots (409 flow is explicit); shadow mode exists so thresholds are tuned on real traffic before enforcement.
- In-flight impact: no recorded decision is rewritten. PRJ-DSE4PW and the two demo projects hold full GO ladders recorded under the old rules and are labelled legacy; PRJ-T7T81A (brownfield, no project gates yet) is the first real project to run under the new contract and cannot record an `fs` GO until its WACC subject and rates are user-confirmed.

## Owner decisions (2026-10-27, authoritative)

- **O-1 Maker/checker.** A second human is available. Maker/checker is enforced as designed with no bypass; the admin grants `entity-ic-reviewer` and `group-ic-reviewer` to at least two people before the `maker_checker` family flips to enforce.
- **O-2 Waiver maximum** is 90 days.
- **O-3 bf-03** (certification transferability confirmed by Pre-FS close, neb-policy 2.4) is a HARD BLOCK at `pre_fs` GO where load-bearing: binding and non-waivable like bf-01 and bf-02. The D1 table lists it as a hard block.
- **O-4 Waiver approvers** are the IC reviewer roles: `entity-ic-reviewer`, and `group-ic-reviewer` for group-level items; approver differs from requester. No new role.
- **O-5 Demos and fixtures.** The S1-S12 demo projects are reseeded through the new gate contract and the 27 blank `NP-*` projects are soft-deleted (phase P5, owners in the design plan).
- **O-6 PRJ-DSE4PW.** Its history stays legacy; WACC confirmation and an IC countersign are required before it is used for anything new.
- **O-7 Early override.** A `group-ic-reviewer` may issue a Group IC kill-criteria override before the formal `group_ic` sitting, with a reason, recorded and audited.
- **O-8 W3 thresholds.** risk-officer proposes, with quant-methodologist (growth reference-class decile) and financial-analyst (QoE materiality); a human approves through a decision record in W3.

## Review outcome and revisions (AI-2nd technical review, platform-lead: REVISE)

Verdict REVISE, 5 blocking findings. The PM's resolutions are recorded here and amend the Decision text above wherever they conflict; the human owner may override any of them at approval.

**R1 (B1) kill-evaluation persistence.** `kill_criteria_evaluation.run_id` references `run(id)` NOT NULL and `project_id` is NOT NULL (migration 0023), and `UNIQUE(run_id, procedure_key, criterion_id)` holds; opportunities have no project, and the earlier reference to a `process_run` of kind `gate_snapshot` was wrong. Resolution: (a) project gates create one `run` row of a dedicated kind (`gate_integrity_eval`) per evaluation event (the brief and the decision each get their own), so the unique key holds and rows are written through the existing repository; (b) opportunity gates write no `kill_criteria_evaluation` rows: outcomes live only in `gate_decision_snapshot.snapshot_json`; (c) cost: each project evaluation runs `fillSnapshot` (it fills the variable snapshot if absent), which is the dominant cost and is covered by the snapshot cache (R6); (d) opportunity evaluation uses an opportunity-scoped variable source; where a predicate variable exists only at project scope, the criterion is reported UNASSESSED for the opportunity and is therefore ACK-listed, never silently passed. The schema stays additive.

**R2 (B2) propose then confirm.** The MCP and proposal layer can only propose (boundary 2). `propose_gate_decision` and the REST record payloads carry no `snapshot_hash` and no `acknowledgements`. The human confirmation step computes a fresh snapshot (confirm GET returns it with the proposal nonce) and the confirm POST carries `snapshot_hash` plus `acknowledgements`, so acknowledgement is always a human act on current state. `validatePayload` in `lib/proposals.ts` and the MCP tool contracts are changed accordingly (design 3.10); acceptance adds the mcp-proposal scenario and proposals unit tests.

**R3 (B3) test harness.** The new write rules break existing fixtures. The design adds a harness section (3.11): a second user with grants, an extended `recordGate` helper, pre-seeded ladder GOs, a user-confirmed WACC in the brownfield-ma scenario, rationales meeting the profile, and each affected scenario/test as an owned per-phase deliverable. Unit environment defaults to mode off; the scenario environment flips to enforce only after the fixtures land.

**R4 (B4) script-aware rationale profile.** Hangul text needs at least 12 syllables and 3 eojeol (space-separated units); Latin text needs at least 20 letters/digits and 4 words; mixed text is judged by its dominant script. Jamo-only strings and repeated-syllable runs are rejected by caps; the denylist is normalized for endings. Boundary tests use the real scenario strings. All user-facing messages come from the next-intl catalogs (ADR-0184), both locales.

**R5 (B5) authorization of grants.** The grants table follows ADR-0038 deny-by-default: an absent grant yields 403 on the countersign, approve, clear and override routes only and changes nothing elsewhere. Grants are exercised by cookie sessions only; a bearer token or MCP call can never exercise one. Issuance is admin-only and no one may grant themselves the checker role for a decision they recorded. The grant is re-read at countersign time, and a revocation in flight invalidates a pending countersign. Phase P3 ships a dev/scenario seed that creates two grant holders.

**R6 judgement items adopted.**
- Rollout flags: per-family env vars `CO_NEWBIZ_GATE_INTEGRITY_<FAMILY>` with values off, shadow, enforce; production default shadow, unit-test default off; a restart is required to change them (accepted).
- Shadow audit entries are de-duplicated per (entity, gate, code, day).
- The snapshot GET targets under 500 ms, with a cache keyed by (entity, gate, input-version).
- Hash canonicalization: sorted keys, fixed number format, waivers and conditions sorted by id, RAG = latest stored assessment, volatile ids and timestamps excluded.
- Check-then-insert runs under BEGIN IMMEDIATE. A re-decision on the same gate is legal; the latest effective decision wins.
- Legacy rows (no snapshot) count as effective for the ladder.
- `effectiveGateState` consumers are inventoried and migrated together: process engine, IC package, MCP `get_gate_decisions` and `get_project_gate_decisions`, inbox, S12, and the panel.
- The waiver `approved_by` body field is accepted for one release behind a flag, then rejected.
- "RAG never computed" at a project `fs` GO is an ACK (the first real project will see it).
- The `fs` WACC hard block depends on `fin.wacc_source_status`; the design now specifies its run/snapshot source and the fixture work (3.8).

**Security additions.** The snapshot inherits the project classification and information wall: the snapshot GET and the IC package use the same `visibleProject` checks. `gate_decision_snapshot` is append-only (no UPDATE or DELETE path in code, and a trigger forbids both). The countersign, grant, override and clear routes get CSRF/Origin checks and rate limits like the existing cookie routes. New audit events: `grant.issue`, `grant.revoke`.

The previously open owner questions were answered on 2026-10-27 (see Owner decisions).

## Deferred to W3 (needs owner decision)

- **Brownfield twin of the value-impact criterion** (`dd_finding_with_value_impact_not_in_valuation_bridge` in `brownfield-dd`). The owner has not decided it and it edits a procedure, so it is not part of this ADR. Until decided, DD findings are bridged by the greenfield-dd criterion only.
- Growth-decile criterion (greenfield-fs and a brownfield-fs growth/base-rate criterion) and QoE materiality: thresholds proposed by risk-officer with quant-methodologist and financial-analyst, approved by a human decision record (O-8).

## Open items for the owner

None. All eight questions were answered on 2026-10-27 (Owner decisions above). Status is Accepted (approved at the merge of PR #746, commit 6fa3ed6d).

## Amendment (2026-11-08, extended 2026-11-09 at Phase E landing): IC committee sessions (ADR-0196 M7)

At `entity_ic` and `group_ic`, the IC committee recommendation and scorecard are a DISPLAY item in `gate_decision_snapshot`, alongside the existing AI recommendation; they are never an input to any HARD BLOCK or ACK rule. Unconfirmed minutes at GO are an ACK item with a reason (silence is never read as pass); a missing session is an ACK item with a reason in the first release — hardening it to a HARD BLOCK needs a separate owner decision. Recorded dissent appears verbatim in the snapshot reference. `snapshot_hash` covers the minutes `input_hash` and confirmation state, so changed minutes return 409 `snapshot_stale`. The committee session is neither maker nor checker (D6 maker-checker and countersign are untouched, and kill-criteria overrides by `group-ic-reviewer` are unaffected); the person who confirms the minutes may not also countersign the GO — maker-checker extended to the minutes confirmation. Procedure carriers: `entity-ic-review` v1.5.0 (step 4.5.5) and `group-investment-review` v1.4.0 (step 4.4), committees registered in `procedures/_committees.yaml`. The snapshot contract bumps `GATE_SNAPSHOT_SCHEMA_VERSION` 2→3 (same add-fields-inside-hash pattern as v1→v2; recorded rows keep verifying). Policy impact analysis and the `project_policy_pin` check (0 pinned projects) are at `docs/governance/policy-impact/2026-11-09-phase-e-entity-group-ic.md`.
