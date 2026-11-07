---
title: Kill-criteria stage scoping for gate acknowledgements
date: 2026-11-07
status: Approved (ADR-0193 Accepted by the owner 2026-11-07) — owner Q1/Q2 decided 2026-11-07; risk-officer conditions C-1..C-7 incorporated (§12); PR-A (registry data + validator + parity) and PR-B (engine, flow.spec 2.19.0) implemented; PR-C (UI) pending
owner: process-governance-manager (functional domain lead)
reviewers_required: risk-officer (kill-criteria authority), platform-lead (technical AI-2nd), owner (human approval)
adr: docs/adr/0193-kill-criteria-stage-scoping-evaluable-from.md
related: ADR-0037, ADR-0053, ADR-0074, ADR-0180, ADR-0192, CHANGELOG 2026-11-06 (AI 1st `not_reached` scoping)
---

# Kill-criteria stage scoping for gate acknowledgements

> Proposal to the gate owners. Nothing here changes a kill criterion's condition, action, or
> predicate. It changes **when** a criterion is asked of a human, and it requires that every criterion
> deferred at one gate be asked at a later gate.

## 1. Problem (verified)

On an opportunity at S3, the Screening gate GO form demands an acknowledgement-with-reason for kill
criteria that cannot be assessed yet.

Root cause, in order:

1. `app/web-next/lib/gate-snapshot.ts:150-154`: `OPPORTUNITY_PROCEDURES.screening(null)` returns
   **both** `greenfield-screening` and `brownfield-screening`. The track is decided at S4 (route
   decision), so it is always `null` at S3.
2. `evaluateOpportunityKill` (same file, ~l.185) evaluates every enabled predicate against
   `opportunityVarRows`. That function supplies only one variable, `screening.viable_targets`, and
   only once `brownfield_target` rows exist (S6 longlist). Every other screening predicate reads a
   **project-scoped** variable (`db/lib/snapshot-filler.ts`) that cannot exist at opportunity scope.
3. The predicate engine returns `unassessed` for a missing variable. Each one becomes a
   `kill_unassessed` RequiredAck (`requiredAcks`, ~l.332), and
   `gate-decision-contract.ts:147` requires a per-key confirmation plus the shared reason.

Result at S3: **5 forced acknowledgements** for criteria whose inputs come in at S5–S7:

| Key | Variable | Where it comes from |
|---|---|---|
| `brownfield-screening:no_viable_target_in_longlist` | `screening.viable_targets` | `brownfield_target` longlist (S6) |
| `brownfield-screening:preliminary_hhi_flags_certain_block` | `antitrust.presumption_screens_triggered` | `antitrust_finding` (S7 ownership-regulatory-screening; project scope) |
| `greenfield-screening:zero_site_clears_infrastructure_minimums` | `infra.sites_clearing_minimums` | `site_candidate` (S5; project scope) |
| `greenfield-screening:infrastructure_plan_not_finalized_at_site_announcement` | `infra.plan_finalized` | site announcement (S5+; project scope) |
| `greenfield-screening:partner_dependency_unconfirmed_and_no_alternative` | `risk.partner_candidates_active`, `risk.partner_dependency_risk` | `partner_candidate` (partner track, S4+; project scope) |

The acknowledgement is meaningless. The human is asked to accept the risk of something nobody could
have measured. Accepting it also creates a false audit trail: it looks as if the criterion was
considered at Screening. And nothing ensures that the criterion is ever asked again. So the current
behavior is noisy, and it also lets criteria be **dropped silently**, which Boundary 4 and the
risk-officer mandate forbid.

The same defect class was fixed for AI 1st review on 2026-11-06 (`scope: "not_reached"` for locked
stages after the current stage, CHANGELOG). This design applies the same principle to kill criteria,
and adds a re-evaluation guarantee.

## 2. Authority layering (AGENTS.md §7)

- `procedures/_shared/*/schema.yaml` `kill_criteria` stays authoritative for **condition and action**.
  This design does not touch it.
- `procedures/_kill-criteria/*.json` (the registry) is where the **executable** metadata lives
  (predicate, enabled, thresholds). `evaluable_from` is executable metadata of the same kind, so it
  belongs in the registry and not in the YAML.
- `process/flow.spec.yaml` `gates[].killCriteriaRegistry` stays the SSOT for which criteria a gate
  **owns**. This design adds a derived rule: a criterion that a gate owns but cannot yet evaluate
  must be carried to a named later gate. The carry gate must itself list the criterion, or must list
  its `reevaluate_at` gate. This is checked by a validator, not by prose.

## 3. Core rule

1. Each registry entry declares `evaluable_from` (a flow stage `S1`–`S12`) and `reevaluate_at`
   (the first gate id whose stage is ≥ `evaluable_from`, where the criterion becomes **binding**).
2. At a gate decision, a criterion whose `evaluable_from` stage is **after** the entity's current
   stage, or whose track does not match a decided track, is classified **`not_reached`**. It shows as
   information only. It needs no acknowledgement and does not count toward `unassessed`.
3. **Triggered always wins.** If a `not_reached` criterion's predicate evaluates `true` (its input
   arrived early), it is treated as triggered with full binding/override semantics. Stage scoping
   never hides a triggered result. Such an early trigger carries `partial_input: true` in the
   snapshot and the UI states that the input is still partial (e.g. longlist under construction),
   so the human sees a possible false positive; the criterion stays triggered (C-5).
4. **Reached criteria stay fail-closed.** If `evaluable_from` ≤ current stage and the result is
   `unassessed`, the `kill_unassessed` acknowledgement is required exactly as today.
5. **No silent drop.** Every `not_reached` item is recorded in the snapshot with its
   `reevaluate_at` gate. At that gate it is either reached (fail-closed) or the decision is refused
   with `kill_carry_overdue`. A carried `halt` criterion that is still `unassessed` at its
   `reevaluate_at` gate hard-blocks (`kill_carry_unassessed`, C-1); the ack path applies only to
   criteria first reached at this gate. A criterion can be deferred, but it can never be skipped or
   closed by an ack alone.

### 3.1 Classification function (pure)

```
classify(entry, ctx) ->
  outcome := evaluate(entry.predicate, vars)          // triggered | false | unassessed
  if outcome == "triggered"            -> "triggered"   // rule 3
  if trackMismatch(entry, ctx.track)   -> "out_of_track" (excluded; see 3.2)
  if stageIndex(entry.evaluable_from) > stageIndex(ctx.current_stage) -> "not_reached"
  else -> outcome                       // false | unassessed (fail-closed)
```

`ctx.current_stage` is the entity's current pipeline stage from `process-flow.ts`, **not** the
gate's nominal stage. The S4 screening re-decision (flow.spec S4 `gates: [screening, pre_fs]`) must
see S4-reachable criteria.

### 3.2 Track handling

- Track `null` (before the S4 route decision): both track procedures stay in scope. Track-specific
  criteria are classified by stage alone. Most fall to `not_reached` because their stage is S5+.
  Track-neutral S3 criteria (market, data confidence, strategic fit) are evaluated on both tracks.
  Once they have predicates, they are deduplicated by `criterion_id` for display only. Acks stay
  per key.
- Track decided: procedures of the other track are `out_of_track`. They are not listed as
  `not_reached`, because they will never be reached. This already happens today through
  `OPPORTUNITY_PROCEDURES`. The design only names the outcome so that the audit trail is explicit.
- Track changes after a decision (route reversal): re-entering a gate recomputes the snapshot. The
  `reevaluate_at` carry list is rebuilt from the new track. A carry recorded under the old track does
  **not** count as satisfied; it is closed as `out_of_track` and listed explicitly in `carried_in`
  with the route decision id that caused it, never dropped (C-4).

### 3.3 Re-evaluation guarantee (`kill_carry`)

- The snapshot's new `kill.not_reached[]` items each carry `{ key, evaluable_from, reevaluate_at }`.
- When **any** decision is recorded (GO, conditional GO, HOLD with re-entry — C-4), these become the decision's **carry list** (inside the snapshot JSON, so
  under the hash). No new table is needed. The carry list is derivable from prior decisions.
- At gate G, the snapshot builder gathers carried keys from all prior recorded decisions on the same
  entity lineage (opportunity → project via `md_project.source_opportunity_id`, the same lineage
  rule as `priorGate`), where `reevaluate_at` ≤ G. Each such key is evaluated even if G's own
  procedure set would not include it. If it still cannot be classified as reached at G (registry
  error), the GO is refused with hard block `kill_carry_overdue` (`enforced: true`). A carry can
  only be closed by evaluation. It cannot be acknowledged away.
- Lineage gap (C-3): if `md_project.source_opportunity_id` is null at the first project gate, the GO
  is refused (hard block `kill_lineage_missing`). It is never treated as "no carries".
- `kill_carry_overdue` has **no** Group IC override (R-5 rejected): overdue is a registry or lineage
  defect, fixed through an ADR-tracked registry change. `kill_override` stays for triggered results only.
- `entity_ic` and `group_ic` already evaluate the full universe. They are the last guard. Any carried
  key not yet closed is evaluated there and is fail-closed — except S12 criteria (#36, #37), which
  IC must not close: they leave IC as `open_monitoring` carries and close only by a recorded human
  decision on the S12 monitoring surface (pmi-agent evidence, risk-officer review) (C-6, Q5).

## 4. Data and contract changes

### 4.1 Registry (`procedures/_kill-criteria/*.json`)

Two new required fields:

```json
"evaluable_from": "S6",
"reevaluate_at": "target_screening",
"evaluable_from_evidence": "screening.viable_targets <- brownfield_target longlist (flow.spec S6)"
```

- `_validate` (registry validator) rejects: a missing field; a `reevaluate_at` that is not a single gate id (compound values rejected, C-2); an unknown stage; a `reevaluate_at`
  whose flow.spec stage is earlier than `evaluable_from`; and an `evaluable_from` earlier than the
  earliest stage at which every predicate variable's filler can produce a value. The last check uses
  a var→stage map kept beside the var registry (`md_var` rows, migrations 0018/0025/0027/0031/0032).
  It is a cross-check, not the source.
- `evaluable_from` is not derived automatically from the var registry. Derivation would hide a
  governance choice (when the team expects the evidence) inside data plumbing. The var map only
  guards against declaring a stage that is too early.

### 4.2 Snapshot (`GateSnapshot`, `gate-snapshot.ts`)

- `schema_version` bump (`GATE_SNAPSHOT_SCHEMA_VERSION` + 1).
- `kill.not_reached: Array<KillItem & { evaluable_from: string; reevaluate_at: string }>` (sorted by key).
- `kill.carried_in: Array<{ key: string; from_decision_id: string; outcome: string }>` (keys closed or still open at this gate).
- `kill.current_stage: string`.
- Triggered items gain `partial_input: boolean` (C-5); `carried_in` items gain `closure: evaluated | out_of_track | open_monitoring` and, for `out_of_track`, `route_decision_id` (C-4).
- `requiredAcks` is unchanged in logic. It reads `kill.unassessed`, which now excludes not-reached
  keys. `hardBlocks` adds `kill_carry_overdue`, `kill_carry_unassessed` (C-1), and `kill_lineage_missing` (C-3).
- Hash: `not_reached`, `carried_in`, and `current_stage` are **inside** the canonical hash, because
  they change what the human was asked. `eval_run_id` stays excluded as today.

### 4.3 Decision contract (`gate-decision-contract.ts`)

- Unchanged for `kill_unassessed` (per-key confirmation + shared reason).
- A submitted confirmation for a key that the server snapshot classifies as `not_reached` is
  **rejected** (stale client). The same applies to a confirmation for an unknown key. This keeps the
  ack set exactly equal to the server's required set.

### 4.4 Audit and legacy decisions

- Recorded decisions are immutable. Legacy snapshots (old `schema_version`) are read with
  `not_reached = []`. Their unassessed acks remain valid records of what was asked at the time.
- **Legacy acks are not carries.** Acknowledging an unassessed criterion under the old rule did not
  evaluate it. For legacy GO decisions, the builder treats every legacy `kill_unassessed` key whose
  new `evaluable_from` is after the decision's stage as an implicit carry (`from_decision_id` = legacy
  decision). This closes the silent-drop gap that exists today. It needs no backfill write, because
  it is computed at read time.
- Snapshot hash verification of legacy rows uses the legacy schema canonicaliser (versioned by
  `schema_version`). Old hashes keep verifying.

## 5. Grandfathering (ADR-0180 / ADR-0192 precedent)

- No change applies retroactively to a recorded decision.
- In-flight opportunities: the new classification applies to **new** snapshots from the effective
  date. No date cut-off on entity `created_at` is needed (unlike ADR-0192). The change only removes
  meaningless acks and adds carries. It never weakens a reached criterion, so applying it to
  in-flight entities is strictly safer than leaving them.
- Implicit legacy carries (§4.4) apply to in-flight entities whose Screening GO was recorded under
  the old rule. Expected effect: at their next `pre_fs` / `target_screening` / `fs` gate, they see
  the carried criteria evaluated, and if the criteria are still unassessed and reached, they see them
  as fail-closed acks.

- One-time, non-blocking risk-officer listing (R-4): legacy Screening `kill_unassessed` acks on
  in-flight entities are listed once to their owners so they see what they signed. It does not block
  any gate.

## 6. UI (`GateSnapshotAck.tsx`, `gate-ack-view.ts`)

- Owner decision Q2 (2026-11-07): new collapsed neutral group **"Not reached yet"** on the decision screen, styled like `ReviewBuckets` from 2026-11-06.
  Each row shows the title, `evaluable_from` stage, and "re-checked at <gate>". It has no checkbox
  and is not counted in the unassessed count or the primary-action enable condition.
- Triggered items are never placed in this group (rule 3). An early trigger shows a "partial input" note (C-5).
- New read-only line "Carried from earlier gates: N (closed M)" when `carried_in` is non-empty.
- i18n keys (`ko`/`en`, ADR-0184): `kind.kill_not_reached`, `notReachedCount`, `reevaluatedAt`,
  `carriedIn`. Onyx tokens only; status is not shown by colour alone (design-lint).

## 7. Tests

Unit (`app/web-next/lib/__tests__`):
1. S3 opportunity, track null: 0 `kill_unassessed` for the 5 keys above; 5 in `not_reached`, each with its `reevaluate_at`.
2. Early input: `brownfield_target` shortlisted = 0 at S3 → `no_viable_target_in_longlist` is **triggered** (not hidden), halt → hard block.
3. A reached criterion at its stage with a missing variable → `kill_unassessed` still required (fail-closed regression).
4. Carry closure: Screening GO with carry → `target_screening` snapshot evaluates the carried key even though the procedure set is `brownfield-target-*`.
5. Overdue carry → `kill_carry_overdue` hard block.
6. Legacy decision (old schema_version) → implicit carries are computed, and the legacy hash still verifies.
7. Contract: an ack for a `not_reached` key → 400.
8. Track switch after a decision → carries are rebuilt, and the old-track carry is not counted as closed.
9. Registry validator: missing `evaluable_from`; compound `reevaluate_at` (C-2); `reevaluate_at` earlier than `evaluable_from`; `evaluable_from` earlier than the var map minimum.
10. C-1: carried `halt` still `unassessed` at `reevaluate_at` → `kill_carry_unassessed` hard block; same criterion first reached at that gate → ack only.
11. C-3: first project gate with null `source_opportunity_id` → `kill_lineage_missing` refusal.
12. C-4: carry recorded from a HOLD decision is evaluated at re-entry; route change closes old-track carries as `out_of_track` with the route decision id listed in `carried_in`.
13. C-5: early trigger carries `partial_input: true`. C-6: #5 predicate reads `infra.plan_finalized` as of the site-announcement date; #36/#37 leave `entity_ic` as `open_monitoring`.

Parity: `check-engine-spec-parity` is extended so that every `killCriteriaRegistry` entry's
`reevaluate_at` names a gate that exists in flow.spec, and so that gate's stage ≥ `evaluable_from`.

UI: render test for the not-reached group (no checkbox, excluded from count). Preview at desktop and 375px.

## 8. Migration of the criterion ids

44 registry files, **37 distinct criterion ids** (7 ids are shared across greenfield/brownfield
procedure pairs). Stage evidence comes from `process/flow.spec.yaml` (stage gates and activities) and
`db/lib/snapshot-filler.ts` / `md_var` migrations (variable source tables). "inert" means
`predicate: null` today. Its stage is still declared, so it is ready when a predicate lands.

| # | criterion_id (procedure prefix) | state | evaluable_from | reevaluate_at | Evidence |
|---|---|---|---|---|---|
| 1 | market_structurally_unattractive (gf/bf-screening) | inert | S3 | screening | S1–S3 market analysis; flow.spec screening gate killCriteria prose |
| 2 | data_confidence_not_judgeable (gf/bf-screening) | inert | S3 | screening | proxy-chain confidence available from S1/S3 |
| 3 | strategic_fit_knock_out_failed (gf/bf-screening) | inert | S3 | screening | S3 strategic-fit-screening activity; ADR-0192 |
| 4 | zero_site_clears_infrastructure_minimums (gf-screening) | enabled | S5 | pre_fs | `infra.sites_clearing_minimums` ← `site_candidate` (project); S5 greenfield site work |
| 5 | infrastructure_plan_not_finalized_at_site_announcement (gf-screening) | enabled | S5 | pre_fs | `infra.plan_finalized` (project text var), read **as of the site-announcement date**, not the gate date (C-6, pilot 005 F-1) — predicate change in PR-B |
| 6 | partner_dependency_unconfirmed_and_no_alternative (gf-screening) | enabled | S5 | pre_fs | `risk.partner_*` ← `partner_candidate` (project); partner sourcing after S4 route |
| 6b | partner_dependency_unconfirmed_and_no_alternative (bf-dd) | enabled | S9 | dd | same vars; gate-owned at dd |
| 7 | no_viable_target_in_longlist (bf-screening) | enabled | S6 | pre_fs | `screening.viable_targets` ← `brownfield_target` longlist (S6, gate pre_fs) |
| 8 | preliminary_hhi_flags_certain_block (bf-screening) | enabled | S7 | target_screening | `antitrust.presumption_screens_triggered` ← `antitrust_finding`; S7 ownership-regulatory-screening (antitrust-agent) |
| 9 | no_viable_deal_shape (deal-shape-chain) | enabled | S4 | pre_fs (single gate, C-2) | `dealshape.viable_shapes`; deal-shape-chain hosted by S4 route-strategy (flow.spec l.642–654) |
| 10 | partner_dd_red_financial_distress (deal-shape-chain) | enabled | S5 | pre_fs | `partner.financial_distress_red_count`; partner DD needs a named partner after the S4 shape (Q3 = S5) |
| 11 | partner_dd_red_ip_chain (deal-shape-chain) | enabled | S5 | pre_fs | `partner.dd_ip_chain_red_count`; as #10 |
| 12 | wacc_hurdle_still_assumed (gf/bf-pre-fs) | enabled | S4 | pre_fs | `fin.wacc_source_status` ← `assumption` wacc/hurdle_irr; S4 wacc-hurdle-confirmation activity |
| 13 | certification_transferability_unconfirmed_and_load_bearing (gf/bf-pre-fs) | enabled | S4 | pre_fs | `cert.load_bearing_unconfirmed` ← `certification`; S4 certification-screen activity |
| 14 | entry_route_undecided_at_pre_fs_exit (gf/bf-pre-fs) | inert | S4 | pre_fs | route decision at S4 |
| 15 | universe_cannot_be_defined (bf-target-identification) | inert | S6 | pre_fs | target universe definition S6 |
| 16 | minimum_coverage_not_achievable (bf-target-identification) | inert | S6 | pre_fs | longlist coverage S6 |
| 17 | no_candidate_passes_knock_out (bf-target-screening) | inert | S7 | target_screening | S7 target-screening activity |
| 18 | shortlist_quality_below_threshold (bf-target-screening) | inert | S7 | target_screening | S7 shortlist |
| 19 | growth_projection_outside_top_decile_without_risk_officer_signoff (gf-fs) | inert | S8 | fs | S8 business case |
| 20 | permit_critical_path_exceeds_incentive_deadline (gf-fs) | enabled | S8 | fs | `permit.critical_path_exceeds_incentive_deadline`; fs gate |
| 21 | qoe_reveals_material_earnings_quality_gap_unexplained (bf-fs) | inert | S8 | fs | QoE in S8 per-target analysis |
| 22 | no_target_meets_base_scenario_hurdle (bf-fs-comparative) | enabled | S8 | fs | `fin.targets_meeting_hurdle`; S8 comparison |
| 23 | dd_finding_with_value_impact_not_in_valuation_bridge (gf-dd) | enabled | S9 | dd | `fin.dd_value_impact_unbridged` |
| 24 | wastewater_capacity_insufficient_and_no_mitigation (gf-dd) | enabled | S9 | dd | `infra.wastewater_insufficient_no_mitigation` |
| 25 | covenant_breach_under_downside_financing_plan (gf-dd) | inert | S9 | dd | downside financing plan in DD |
| 26 | any_of_six_ma_validators_missing_at_dd_exit (bf-dd) | enabled | S9 | dd | `validators.applicable_missing` |
| 27 | certification_transferability_computed_by_inference_not_confirmation (bf-dd) | enabled | S9 | dd | `cert.transferability_inferred_count`; S9 certification-transferability-dd |
| 28 | covenant_breach_with_coc_acceleration_under_downside (bf-dd) | enabled | S9 | dd | `risk.covenants_breached` |
| 29 | analysis_task_reviewed_by_null_on_required_deliverable (entity-ic-review) | enabled | S11 | entity_ic | `deliverables.required_unreviewed` ← `analysis_task` |
| 30 | kill_criteria_condition_triggered (entity-ic-review) | inert | S11 | entity_ic | meta-criterion over all prior outcomes |
| 31 | origin_classification_missing_at_entity_ic_exit (entity-establishment-execution) | enabled | S11 | entity_ic | `classification.origin_live_missing` |
| 32 | employment_transfer_without_consent_determination (entity-establishment-execution) | enabled | S11 | entity_ic | `legal.employment_transfer_consent_regime_determined` |
| 33 | ip_assignment_chain_incomplete_at_establishment (entity-establishment-execution) | enabled | S11 | entity_ic | `legal.ip_assignment_chain_complete` |
| 34 | permit_not_possible_under_existing_entity_name (business-unit-establishment-execution) | inert | S11 | entity_ic | ADR-0167 BU establishment |
| 35 | clean_team_protocol_breach (pmi-integration-execution) | inert | S9 | dd | clean-team breach can occur from S9 DD (C-6) |
| 36 | key_talent_attrition_above_threshold_at_90d (pmi-integration-execution) | enabled | S12 | `open_monitoring` (no gate) | `pmi.key_talent_attrition_90d`; closed only by recorded human decision on S12 monitoring (C-6) |
| 37 | synergy_run_rate_uncertified_at_bau_handover (pmi-integration-execution) | enabled | S12 | `open_monitoring` (no gate) | `pmi.synergy_run_rate_certified`; as #36 |

Summary: **S3: 3 ids** (all inert today) · **S4: 4** · **S5: 5** (incl. 2 partner-DD) · **S6: 3** ·
**S7: 3** · **S8: 4** · **S9: 7** (incl. #35; + bf-dd partner-dependency variant) · **S11: 6** · **S12: 2** (`open_monitoring`).
Effect at the S3 Screening gate: all 5 currently forced acks move to `not_reached`, each with a carry.
No criterion that is reached at S3 loses its ack.

Notable governance observations (to reconcile, not fix locally):
- **O-1**: The flow.spec `screening` gate lists five criteria (#4–#8) whose evidence cannot exist
  before S5–S7. With this design they are owned by Screening but carried to `pre_fs` /
  `target_screening`. Alternative: move them in flow.spec to the gates where they become evaluable.
  That is a spec change (ADR-0074). **Resolved (owner Q1, 2026-11-07): keep on `screening` with carries; no flow.spec gate move.**
- **O-2**: `deal-shape-chain` criteria (#9–#11) are listed on the `screening` gate in flow.spec, but
  `OPPORTUNITY_PROCEDURES.screening` does not include `deal-shape-chain`. Today they are never
  evaluated at the opportunity Screening gate. This divergence predates this design. It is recorded
  here and routed to PM.
- **O-3**: The S12 criteria (#36, #37) have no gate (`S12 gates: []`). Carry semantics end at
  `entity_ic`/`group_ic`. **Resolved by C-6**: they leave IC as `open_monitoring` carries, closed by a recorded human decision on the S12 monitoring surface.
- **O-4** (risk-officer open item, not a blocker): antitrust-agent to assess an S6 preliminary
  market-level HHI screen for #8, to reduce S4–S6 spend on a possibly blocked deal.

## 9. Risk-officer review section

Kill-criteria authority belongs to `risk-officer`. This design must not take effect on AI review
alone. Items for risk-officer sign-off:

- **R-1** Does deferring (with a mandatory carry) count as weakening? The design's position is that
  it does not: the criterion's condition, action, and binding are unchanged. It is asked when it can
  be answered, and a triggered result is never deferred.
- **R-2** Fail-closed preservation: confirm the rule that a reached criterion with a missing variable
  still demands an ack. Should it instead hard-block for `halt` criteria? That would be stricter
  than today, and it is out of scope unless you require it.
- **R-3** The `evaluable_from` stage per criterion (§8 table). Pay particular attention to #5
  (infrastructure plan, which pilot 005 F-1 added because real projects announce sites before
  infrastructure is final), #8 (HHI: is a pre-S7 preliminary screen expected at Screening?), and
  #9–#11.
- **R-4** Implicit legacy carries (§4.4): acceptable as read-time computation, or should a
  risk-officer review of legacy Screening acks be run once?
- **R-5** `kill_carry_overdue` as a hard block with no waiver path. Should a Group IC override be
  allowed, mirroring `kill_override`?

## 10. Rollout and PR split

1. ADR-0193 accepted (owner + risk-officer).
2. PR-A: registry fields + validator (single-gate `reevaluate_at`, C-2) + parity check (data only; no behavior change).
3. PR-B: snapshot schema bump, classifier, carries from every recorded decision (C-4), `kill_carry_unassessed` (C-1), `kill_lineage_missing` (C-3), `out_of_track` / `open_monitoring` closures, `partial_input` (C-5), #5 point-in-time predicate (C-6), contract rejection, tests 1–13.
4. PR-C: UI group (owner Q2) + partial-input note + i18n; design-lint; preview desktop/375px.
5. One-time non-blocking legacy-ack listing for risk-officer (R-4), after PR-B.
5. Lifecycle (co-newbiz rules): `procedures/**` touched → policy impact analysis and
   `project_policy_pin` check for in-flight projects; ADR required (this one).

Risk-officer rulings and conditions C-1..C-7 are recorded in §12 and incorporated in §3–§10.

## 11. Open questions (status 2026-11-07)

- Q1 decided (owner): keep #4–#8 on `screening` with carries. Q2 decided (owner): collapsed group on the decision screen.
- Q3 resolved (risk-officer): S5. Q4 resolved: R-2 → C-1; R-5 rejected. Q5 resolved: C-6. Q6 guarded by C-3 (platform-lead still confirms population in practice).

Original wording, kept for the record:


- **Q1 (owner / PGM)**: Keep the screening gate owning #4–#8 with carries (this design), or move them
  in flow.spec to `pre_fs` / `target_screening`? Moving them is cleaner for the spec, but it needs a
  flow.spec version bump and a decision record.
- **Q2 (owner)**: Should not-reached items show on the Screening decision surface at all (collapsed
  group), or only in the snapshot/audit view? The design proposes a collapsed display.
- **Q3 (risk-officer / partnership-agent)**: Exact stage for partner DD criteria (#10, #11) and the
  partner-dependency criterion (#6): S4 (route strategy) or S5?
- **Q4 (risk-officer)**: R-2 and R-5 above.
- **Q5 (risk-officer / pmi-agent)**: Post-close criteria (#35–#37) have no gate. Should a monitoring
  surface record their closure as the terminal carry?
- **Q6 (platform-lead)**: Lineage join for carries across opportunity → project. Confirm that
  `md_project.source_opportunity_id` is always set before the first project gate (`fs`).

## 12. Risk-officer review (2026-11-07)

Reviewer: `risk-officer` (kill-criteria authority). Owner decisions taken as given: Q1 = keep #4–#8
on the `screening` gate with mandatory carries; Q2 = collapsed "Not reached yet" group. These rulings
are decision support; ADR-0193 status remains for the owner to set.

| Item | Verdict | Ruling |
|---|---|---|
| R-1 deferral = weakening? | Approve-with-condition | Not a weakening only if a carry can never be closed by an ack alone (see R-2) and every carry-loss path hard-blocks (C-3, C-4). |
| R-2 reached-unassessed `halt` | Approve-with-condition | Keep ack for criteria first reached at this gate. A **carried** `halt` criterion that is still `unassessed` at its `reevaluate_at` gate must hard-block (`kill_carry_unassessed`); otherwise defer-then-ack is a silent drop with one extra step. |
| R-3 stages | Approve-with-condition | #4, #6, #10, #11 = S5 approved (Q3: S5, partner DD needs a named partner after the S4 shape). #9: S4 approved, but `reevaluate_at` must be a single gate id = `pre_fs` (the S4 screening re-decision is optional). #8: S7 accepted because the variable is S7-sourced; the cost is S4–S6 spend on a possibly blocked deal; antitrust-agent to assess an S6 preliminary market-level HHI (open item, not a blocker). #5: S5 approved only if the predicate reads `infra.plan_finalized` **as of the site-announcement date**, not as of the gate date (pilot 005 F-1 is about the point in time). |
| R-4 legacy acks | Approve-with-condition | Read-time derived carries are accepted. Also run one non-blocking risk-officer listing of legacy Screening `kill_unassessed` acks on in-flight entities, so owners see what they signed. |
| R-5 Group IC override of `kill_carry_overdue` | Reject | Overdue is a registry or lineage defect, not a business risk to accept. Fix the registry (ADR-tracked). `kill_override` remains available for **triggered** results only. |
| Q5 post-close #35–#37 | Approve-with-condition | `entity_ic`/`group_ic` must not close them; they leave IC as `open_monitoring` carries. They close only by a human decision-record on the S12 monitoring surface (pmi-agent evidence, risk-officer review). Also #35 clean-team breach can occur from S9 DD: `evaluable_from` S9. |

Conditions to add before implementation:

- **C-1** Carried `halt` + `unassessed` at `reevaluate_at` → hard block (R-2).
- **C-2** `reevaluate_at` is a single gate id per registry entry; validator rejects compound values (#9).
- **C-3** Lineage gap: if `md_project.source_opportunity_id` is null at the first project gate, refuse the GO (hard block). Do not treat it as "no carries" (Q6).
- **C-4** Carries are recorded from **every** recorded decision (GO, conditional GO, HOLD re-entry), not GO only; a carry closed as `out_of_track` after a route change must be listed explicitly in `carried_in` with the route decision id, never dropped.
- **C-5** Early-triggered `not_reached` criteria must state that the input is partial (e.g. a longlist still being built) in the snapshot, so the human sees a possible false positive. The criterion stays triggered.
- **C-6** #5 point-in-time predicate; #35 `evaluable_from` S9; S12 carries stay `open_monitoring` (Q5).
- **C-7** Test additions: tests for C-1, C-3, and C-4 (HOLD carry, out_of_track closure).

Kill-criteria evaluation status of this design review: no criterion is evaluated here (process change only). Unassessed: n/a.

## 13. PR-B implementation notes (2026-11-07)

- O-2 resolved: `deal-shape-chain` (#9-#11) is listed on and evaluated at `pre_fs` (flow.spec 2.19.0 moved the listing; the opportunity pre_fs procedure set now includes it), matching the registry `reevaluate_at`.
- #35 is bound to the `dd` gate in flow.spec (owner decision); the engine evaluates the pmi procedure at brownfield `dd` for that one criterion only.
- S12 criteria (#36, #37) are evaluated by data phase (risk-officer ruling A): before close they are reported `unassessed` with the reason "post-close data not yet available" and stay visible in `carried_in` with closure `open_monitoring` at the IC gates. They are never silently skipped; they need no acknowledgement and cannot hard-block (no gate can obtain post-close data); IC never closes them.
- The effective current stage is never earlier than the gate's first stage, and an opportunity is capped at S7.
- Open: the #5 point-in-time predicate (C-6) is not implemented (no site-announcement-date source). Known gap: criteria whose variables are project-scoped (e.g. #4 `infra.sites_clearing_minimums`) cannot be assessed at an opportunity gate, so under `kill_binding=enforce` a carried halt such as #4 hard-blocks the opportunity pre_fs GO (kill_carry_unassessed) until an opportunity-scope source exists or the risk-officer re-points its `reevaluate_at`.
- Enforce guard (risk-officer ruling B): `kill_binding=enforce` is fail-closed. `carriedWithoutDataSource()` lists carried criteria whose variables the opportunity-scoped source cannot supply at their opportunity `reevaluate_at` gate (today #4, #5, #6, #8). While any exist, the server refuses to start with enforce (instrumentation startup check), the snapshot carries hard block `kill_enforce_unsafe` and a GO is refused 409 (HOLD/KILL never). The unit-test environment bypasses it unless `CO_NEWBIZ_KILL_ENFORCE_GUARD_TEST=on`.
- Caveat on #5 (condition C): any snapshot that evaluates #5 carries `kill.caveats` "evaluated on gate-date state, not site-announcement date (ADR-0193 C-6 pending): not clean evidence". `infra.plan_finalized` is read only by the kill predicate (snapshot filler); no RAG rule or the data-confidence grade consumes kill outcomes or this variable, so there is no path by which #5 counts toward a GREEN data-confidence grade - the caveat keeps it from reading as clean evidence at the human surface.
- Scheduled items (condition D): at Screening, `deal-shape-chain` (#9-#11) is listed in `kill.scheduled` as pending with `reevaluate_at` pre_fs, not absent.
- IC package (condition E): `GET /api/projects/{id}/ic-package` returns `kill_carries {gate, open[], open_monitoring[]}` naming each carried criterion that is evaluated but still unassessed (closure `open`) and each S12 criterion that stays open_monitoring; null means not computable, never "none".

### Follow-ups (ticket ids are placeholders until filed)

- FOLLOWUP-ADR0193-C6: a data source for #5's site-announcement date (evidence_var + migration; ADR trigger) so `infra.plan_finalized` can be read as of that date; keeps the `test.todo` in `tests/unit/kill-criteria-carry.test.ts` and the #5 caveat until it lands.
- FOLLOWUP-ADR0193-RESCOPE: re-scope `reevaluate_at` to `fs` for #4, #5, #6 and #8 (their variables are project-scoped and do not exist at opportunity gates) - risk-officer decision; clears the enforce guard.
- FOLLOWUP-ADR0193-OPPSRC: opportunity-scope sources for the parts of #10/#11 that need them (no proxy sources).

## 14. Risk-officer ruling on follow-ups (2026-11-07)

Reviewer: `risk-officer` (kill-criteria authority). Rulings are decision support; the owner records
the decision and ADR-0193 status. Evidence: registry files under `procedures/_kill-criteria/`,
`OPPORTUNITY_SCOPE_VARS` (today only `screening.viable_targets`), `carriedWithoutDataSource()` in
`app/web-next/lib/gate-snapshot.ts`, and the `project_id NOT NULL` source tables (`site_candidate`,
`partner_candidate`, `partner_dd_finding`, `antitrust_finding`). The first project gate is `fs` (§11).

### 14.1 FOLLOWUP-ADR0193-RESCOPE: confirmed for #4, #5, #6, #8

| # | File | Current (from / reevaluate_at) | New | Rationale |
|---|---|---|---|---|
| 4 | `greenfield-screening__zero_site_clears_infrastructure_minimums.json` | S5 / pre_fs | S5 / **fs** | `infra.sites_clearing_minimums` comes from project-scoped `site_candidate`; no opportunity-scope value can exist, so at pre_fs it can only be `unassessed`. |
| 5 | `greenfield-screening__infrastructure_plan_not_finalized_at_site_announcement.json` | S5 / pre_fs | S5 / **fs** | `infra.plan_finalized` is a project text var. See 14.3 for the caveat. |
| 6 | `greenfield-screening__partner_dependency_unconfirmed_and_no_alternative.json` | S5 / pre_fs | S5 / **fs** | `risk.partner_*` come from project-scoped `partner_candidate`. The bf-dd twin (#6b, S9 / dd) stays as it is. |
| 8 | `brownfield-screening__preliminary_hhi_flags_certain_block.json` | S7 / target_screening | S7 / **fs** | `antitrust.presumption_screens_triggered` comes from project-scoped `antitrust_finding`. Cost: a possibly blocked deal reaches S8. O-4 stays open: antitrust-agent should source a preliminary market-level HHI screen at opportunity scope; once it exists, #8 may be re-pointed back to `target_screening` (ADR-tracked). |

`evaluable_from` stays unchanged for all four, because it records when the evidence can first exist,
not where the engine can read it. Update `evaluable_from_evidence` to say "project-scoped source;
re-evaluated at fs, the first project gate (ADR-0193 §14.1)".

Why this is not a weakening: under the current scoping these four carries would end at an
opportunity gate as `unassessed`, either as a forced `kill_carry_unassessed` block (under enforce)
or as an empty acknowledgement (under shadow). Neither tests the condition. At `fs` the variables
exist, C-1 still applies (a carried `halt` that is still `unassessed` at fs hard-blocks), and the
carry chain from `screening` is kept. The deferral costs spend (S5 to S8 work on a deal that may be
killed). It does not cost detection.

Enforce-guard effect: with these four re-scoped, every deferred criterion with a predicate and a
reevaluate_at of `target_screening` or earlier reads only `screening.viable_targets` (#7). So
`carriedWithoutDataSource()` returns **empty**, and the `kill_enforce_unsafe` refusal clears. A unit
test must assert the empty result against the real registry.

**Same problem, not caught by the guard (new finding, RESCOPE-2).** The guard only checks
*deferred* criteria. Criteria *first reached* at the opportunity `pre_fs` gate with project-scoped
variables are always `unassessed` there and close with an acknowledgement. That is the
silent-drop pattern R-2 prohibits, entered at a different point:

| # | File(s) | Var | Ruling |
|---|---|---|---|
| 9 | `deal-shape-chain__no_viable_deal_shape.json` | `dealshape.viable_shapes` | Needs an opportunity source (14.2). Not re-scoped, because the deal shape is the S4 decision itself. |
| 10, 11 | `deal-shape-chain__partner_dd_red_*.json` | `partner.*_red_count` | Re-scope (14.2). |
| 12 | `{greenfield,brownfield}-pre-fs__wacc_hurdle_still_assumed.json` | `fin.wacc_source_status` | Re-scope `reevaluate_at` to `fs`. The fs WACC block (ADR-0186 D8) already re-tests it at project scope. |
| 13 | `{greenfield,brownfield}-pre-fs__certification_transferability_unconfirmed_and_load_bearing.json` | `cert.load_bearing_unconfirmed` | Re-scope `reevaluate_at` to `fs`, unless the implementer shows that `certification` rows can be opportunity-scoped today. |

Guard extension (required): `carriedWithoutDataSource()`, or a sibling check in the same enforce
guard, must also list **reached-at-own-gate** opportunity criteria whose variables are not in
`OPPORTUNITY_SCOPE_VARS`. Enforce stays refused until that list is empty too. Otherwise the guard
reports "safe" while #9 to #13 are acknowledged blind.

### 14.2 FOLLOWUP-ADR0193-OPPSRC: #10 and #11 (and #9)

- **#10 `partner_dd_red_financial_distress` and #11 `partner_dd_red_ip_chain`: re-scope, no
  opportunity source.** Partner DD is substantive diligence on a named partner, and
  `partner_dd_finding` is project-scoped by design (`project_id NOT NULL`). Building an
  opportunity-scope copy would duplicate DD before the project exists. Inferring "red" from
  `partner_candidate` scores would be a proxy source, and proxy sources are rejected. New values:
  `evaluable_from` S5 (unchanged), `reevaluate_at` **fs**. Because `deal-shape-chain` is listed on
  `pre_fs` in flow.spec, at pre_fs these two must show as `not_reached` with a carry to fs. The
  engine must not show them as reached-unassessed. If the engine cannot do that for a procedure
  listed at its own gate, the flow.spec listing for #10/#11 must move to `fs` (ADR-0074 spec change).
  PM is to route that choice.
- **#9 `no_viable_deal_shape`: genuinely needs an opportunity source.** The S4 deal-shape decision
  is an opportunity-stage artefact and is what pre_fs decides on. Minimal acceptable source:
  `dealshape.viable_shapes` = count of deal shapes recorded **at opportunity scope** with a recorded
  status of `viable` in the S4 route-strategy / deal-shape-chain output, read directly from that
  record. It must not be derived from scores, route recommendations or LLM drafts. If such a record
  does not exist at opportunity scope, report #9 `unassessed` with the reason. It must not read as
  passed.
- **ADR trigger:** if #9's source needs a new column or table (for example an `opportunity_id`-keyed
  deal-shape record), that is a DB schema change and **requires an ADR**. Adding a var to
  `OPPORTUNITY_SCOPE_VARS` that reads an existing opportunity-keyed table is an engine change only.
  It still needs `md_var` provenance. The #10/#11/#12/#13 re-scopes are registry-only (ADR-0193
  amendment note, no schema change).

### 14.3 C-6 (#5 site-announcement date)

The caveat is **still required** after the re-scope. Moving the criterion to `fs` fixes *where*
`infra.plan_finalized` can be read. It does not fix *when* it is read: at fs the engine still reads
the current state, not the state on the site-announcement date (pilot 005 F-1). A plan finalized
after the announcement would read `false` (clean) for a condition that was in fact triggered.
Keep the `kill.caveats` text and the `test.todo` until the source lands.

Minimal acceptable data source: a project-scoped, human-recorded **site-announcement event** (date
plus evidence reference, for example the board or public announcement document), and an
**effective date** on the infrastructure-plan finalization record. The predicate is then
`plan_finalized_on <= site_announced_on`. If either date is missing, the outcome is `unassessed`.
It is never `false`. Dates inferred from document timestamps or from gate dates are proxies and are
rejected. Adding the new columns or event table is a schema change, so an **ADR is required**
(already noted in FOLLOWUP-ADR0193-C6).

### 14.4 Kill-criteria evaluation status of this ruling

No criterion is evaluated on any deal here (registry and process ruling only). Unassessed: n/a.

### 14.5 Implementation note (2026-11-07)

PM decision on the 14.2 routing: no flow.spec move. `classifyKill` gains a registry deferral rule: a criterion whose
`reevaluate_at` is a later gate than the evaluating gate is `not_reached` with a carry even when its stage is reached
(a trigger still wins, with `partial_input`). #10/#11/#12/#13 therefore carry from the opportunity `pre_fs` gate to `fs`;
#9 stays reached at `pre_fs` and the enforce guard lists it (`reached_at_own_gate`). The legacy schema-v1 read-time carry
derivation applies the same deferral. Two snapshot-filler defects exposed by the fs-time re-scope were fixed
(`fin.wacc_source_status` fell back to nothing on a gate-evaluation run; `infra.sites_clearing_minimums` queried wrong
columns). See the ADR-0193 amendment note.
