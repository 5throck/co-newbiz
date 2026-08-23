# ADR-0060: Kill-criteria executability classification (29 entries), greenfield twin activation, and the registry-extension backlog

**Status**: Accepted (2026-08-24)
**Date**: 2026-08-24
**Deciders**: process-governance-manager (author), risk-officer (threshold anchors owner), pm

## Context

The readiness audit's residual R5 and the remediation design §4 roadmap: the kill-criteria registry holds **29 declared entries, of which only 2 are executable** (and both enabled since ADR-0057). Before expressing more predicates, the design required classifying every entry against the registry's **actual** evidence plane — not against an idealized one.

That evidence plane, verified against the code:

- **22 snapshot vars** — the set the snapshot filler owns (`SNAPSHOT_VAR_KEYS` in `db/lib/snapshot-filler.ts`; seeded by migrations 0017/0018/0019 across market, technical, and risk).
- **4 routing vars** — `project.case_type`, `project.origin`, `project.technology_track`, `target.has_external_market_presence` (migration 0014), read **live** by `applies-when.ts` for procedure routing and **never snapshotted**.
- The evaluator (`db/lib/kill-criteria.ts`, ADR-0057) reads **only `project_variable_snapshot`**. A predicate over any var that is not in the snapshot set cannot be evaluated — and, worse, an `is_null` over a never-snapshotted var is **always TRUE** (a false-halt machine).

Classification definitions (design §4): **(i)** the evidence var exists AND the threshold is decided; **(ii)** the var exists, threshold pending; **(iii)** a new evidence var is needed.

## Decision

### 1. The classification of record — all 29 entries

The table below is the classification of record (from the D-round annex §3); each registry JSON's `notes` carries its one-line classification sentence.

| # | procedure__criterion | Class | Predicate (if i) / proposed var (if iii) | Justification |
|---|----------------------|:----:|------------------------------------------|---------------|
| 1 | brownfield-dd__covenant_breach_with_coc_acceleration_under_downside | (i) | already expressed + enabled (ADR-0057) | var `risk.covenants_breached`; D-M-RISK-2 + AI-1; anchor gd-0022-risk-thresholds |
| 2 | brownfield-dd__partner_dependency_unconfirmed_and_no_alternative | (i) | already expressed + enabled (ADR-0057) | vars `risk.partner_candidates_active` + `risk.partner_dependency_risk`; D-M-RISK-3 + AI-1 |
| 3 | greenfield-screening__partner_dependency_unconfirmed_and_no_alternative | (i) NEW | `all_of[count(risk.partner_candidates_active) lte 1; in(risk.partner_dependency_risk, ["high"])]` — enabled under gd-0022-risk-thresholds | Exact twin of #2: same vars, same D-M-RISK-3 conjunction verbatim (`lte 1` per the 0019 finalization), same record anchors — anchors are record-scoped, not procedure-scoped. The filler fills the vars whenever a `deal_structure_hypothesis` exists; before that the criterion is UNASSESSED-listed, never a silent pass |
| 4 | greenfield-fs__permit_critical_path_exceeds_incentive_deadline | (ii) | var exists: `permit.critical_path_duration` | Threshold is a per-project incentive deadline — no registry constant, and no open-question (a)–(d) item covers it → registered as a NEW thresholds-agenda item; additionally the AST has no var-vs-var comparator, so the executable form will need a computed boolean var (e.g. `permit.critical_path_exceeds_incentive_deadline`) once the deadline convention is decided. Stays inert with both pointers |
| 5 | brownfield-pre-fs__wacc_hurdle_still_assumed | (iii) | `fin.wacc_source_status` (sourced\|assumed) | No finance-source var exists; threshold ("assumed") is decided by the criterion wording — the var is the blocker |
| 6 | greenfield-pre-fs__wacc_hurdle_still_assumed | (iii) | same var | Twin of #5 |
| 7 | brownfield-pre-fs__certification_transferability_unconfirmed_and_load_bearing | (iii) | `cert.load_bearing_unconfirmed` (count: `load_bearing=1 AND transferability_basis IS NULL`) | Existing `cert.load_bearing_non_transferable_on_coc` counts confirmed-'no' rows — a different condition ("unconfirmed" ≠ "confirmed non-transferable") |
| 8 | greenfield-pre-fs__certification_transferability_unconfirmed_and_load_bearing | (iii) | same var | Twin of #7 |
| 9 | brownfield-dd__certification_transferability_computed_by_inference_not_confirmation | (iii) | `cert.transferability_inferred_count` (basis='inferred') | No var; the repository write-block is the companion control — this predicate is the tripwire |
| 10 | brownfield-dd__any_of_six_ma_validators_missing_at_dd_exit | (iii) | `validators.applicable_missing` (count, computed by the validator-completeness engine) | The 3-number record is computed in `db/lib/validator-completeness.ts` but exposes no snapshot var; threshold (≥1) decided by wording |
| 11 | brownfield-fs__qoe_reveals_material_earnings_quality_gap_unexplained | (iii) | `fin.qoe_material_gap_unexplained` (boolean) | No QoE var; "material" also undefined — dual-blocked, both noted |
| 12 | brownfield-screening__no_viable_target_in_longlist | (iii) | `screening.viable_targets` (count) | No longlist var; "viable" screen pending |
| 13 | brownfield-screening__preliminary_hhi_flags_certain_block | (iii) — premise-locked | any antitrust var | Migration 0018 premise-locks antitrust vars OUT of `evidence_var` (F19/Decision 4): extension requires a **reversal ADR**, not a seed. Explicit note; `market.bargaining_power_hhi` is value-chain HHI, not antitrust screening HHI — do not reuse |
| 14 | deal-shape-chain__no_viable_deal_shape | (iii) + (d) | `dealshape.viable_shapes` (count) | Strategic-fit thresholds are open question (d) |
| 15 | deal-shape-chain__partner_dd_red_financial_distress | (iii) | `partner.financial_distress` (form TBD) | "Red finding in machine-readable form" is itself the pending item |
| 16 | deal-shape-chain__partner_dd_red_ip_chain | (iii) | `partner.dd_ip_red` (boolean) | `tech.ip_ownership_status` covers the target's dd_finding, not partner DD |
| 17 | entity-establishment-execution__employment_transfer_without_consent_determination | (iii) | `legal.employment_transfer_consent_regime_determined` (boolean) | No var; jurisdictional determination fact |
| 18 | entity-establishment-execution__ip_assignment_chain_incomplete_at_establishment | (iii) | `legal.ip_assignment_chain_complete` (boolean) | Completeness fact, threshold decided; no var |
| 19 | entity-establishment-execution__origin_classification_missing_at_entity_ic_exit | (iii) — engine-domain gap | mirror routing vars into the snapshot, or computed `classification.origin_missing` | `project.origin` EXISTS in the registry but is never snapshotted. `is_null` evaluates against snapshot status, and a never-snapshotted var is always `missing` → `is_null` is ALWAYS TRUE = a false-halt machine. Expressing it now is forbidden; the extension decision (snapshot mirroring vs computed boolean) is recorded here, not made silently |
| 20 | entity-ic-review__analysis_task_reviewed_by_null_on_required_deliverable | (iii) | `deliverables.required_unreviewed` (count over analysis_task × required outputs) | No var |
| 21 | entity-ic-review__kill_criteria_condition_triggered | (iii) — meta | n/a (ledger reader) | Evidence is the `kill_criteria_evaluation` ledger (0023), not a snapshot var; `getRecordedEvaluation` already groups exactly this — decide-meta-criteria stay procedural gate-flow readers |
| 22 | greenfield-dd__dd_finding_with_value_impact_not_in_valuation_bridge | (iii) | `fin.dd_value_impact_unbridged` (count/boolean) | No bridge-linkage var |
| 23 | greenfield-dd__wastewater_capacity_insufficient_and_no_mitigation | (iii) | `infra.wastewater_capacity_sufficient` + mitigation flag | No infrastructure var |
| 24 | greenfield-fs__growth_projection_outside_top_decile_without_risk_officer_signoff | (iii) | `fin.growth_projection_decile` + `fin.growth_signoff` | `market.growth_rate` is the market, not the projection; decile basis per ADR-0018 anchoring undecided |
| 25 | greenfield-screening__infrastructure_plan_not_finalized_at_site_announcement | (iii) | `infra.plan_finalized` (boolean) | No var (pilot-005 F-1 origin) |
| 26 | greenfield-screening__zero_site_clears_infrastructure_minimums | (iii) | `screening.sites_clearing_minimums` (count) | No var; minimums also pending |
| 27 | pmi-integration-execution__clean_team_protocol_breach | (iii) — event, not state | depends on breach-recording schema | Registry note already says: a breach is an auditable event, not a snapshot variable; may never be predicate-expressible |
| 28 | pmi-integration-execution__key_talent_attrition_above_threshold_at_90d | (iii) + (c) | `pmi.key_talent_attrition_90d` (ratio) | No var AND threshold ILLUSTRATIVE until (c) — both blockers recorded |
| 29 | pmi-integration-execution__synergy_run_rate_uncertified_at_bau_handover | (iii) + (c) | `pmi.synergy_run_rate_certified` (boolean) | "Certified by Finance" criteria pending (c) |

**Outcome: 3 class (i) / 1 class (ii) / 25 class (iii).**

The honest headline: the evidence-var registry covers market/technical/risk — the pre-deal and DD evidence plane. Kill criteria span the whole lifecycle (formation, entity IC, PMI, deal-shape, screening), so the roadmap's real bottleneck is **registry extension**, not predicate authoring.

### 2. The greenfield twin activates (class (i), the only new one)

`greenfield-screening__partner_dependency_unconfirmed_and_no_alternative` is expressed and flipped to `enabled: true` with `policy_id: gd-0022-risk-thresholds` and a `thresholds_source` citing risk-thresholds.md D-M-RISK-3 + AI-1, activated by this ADR. Its predicate is the verbatim twin of the brownfield-dd entry (#2): same two 0018-seeded vars, the same D-M-RISK-3 conjunction (`partner_candidates_active <= 1` AND dependency IN ["high"]), and the same record anchors — the thresholds record is **record-scoped**, not procedure-scoped, so it governs both procedures' readings of the same vars. Screening-stage semantics follow the ADR-0049 honesty rule: with no `deal_structure_hypothesis` recorded, the filler has filled nothing and the criterion is UNASSESSED-listed — never a silent pass.

### 3. The 25 class-(iii) proposed vars are the explicit, prioritized registry-extension backlog

**Nothing is seeded this round.** Design §4: registry extension is an explicit decision with its own ADR, never a silent seed riding a classification change. Extension PRs pick from the backlog one lifecycle dimension at a time (finance-source → certification → validators → …), each with a filler, migration seeds, tests, and an ADR recording why the var set is now decidable.

### 4. The class-(ii) threshold need is registered, not decided

Row 4's incentive-deadline threshold is a **new thresholds-agenda item** — per-project (a deadline is set by the incentive package, not a registry constant) and outside open questions (a)–(d). Until it is decided (and the computed-boolean var of Decision 1 row 4's note exists), the entry stays inert with both pointers in its notes.

### 5. Baseline 2 → 3

`procedures/_kill-criteria/_baseline.json` moves to `executable_count: 3` in the same change (the strict gate passes rises with a reminder; landing the bump with the predicate it counts keeps the two from drifting).

### 6. DMN hit-policy vocabulary is prose only

Multi-condition entries' notes (#3, #4, #13, #15, #16, #28) carry DMN hit-policy vocabulary ("first match / collect" style disambiguation) per design §4.3 — a documentation aid for conjunction reading. There is no DMN runtime and none is implied.

## Policy-Impact Analysis (procedures/** modified — registry JSONs + baseline)

- **YAML untouched.** No procedure `schema.yaml` `kill_criteria` declaration changes; the registry JSONs are the executable layer of record, and the activation follows the ADR-0057 convention exactly (existing vars, both anchors, an ADR recording why the criterion is now machine-evaluable).
- **Additive only, in the safe direction.** One new mark_conditional path (over the same vars and record as its already-enabled brownfield twin); nothing is weakened, narrowed, or removed. All 28 other entries change only in `notes`.
- **`project_policy_pin`:** prospective, as with ADR-0057 — a run evaluates kill criteria under the registry state at evaluation time; no re-pin, no retroactive effect.

## Consequences

- The evaluator (`db/lib/kill-criteria.ts`), the evaluation ledger (table 0023), and the repository reader (`getRecordedEvaluation`) are untouched — this ADR changes registry state and documentation, not runtime code beyond what the one new enabled entry exercises.
- **The `is_null`-over-routing-var trap is now normative**: no predicate may reference a var that is not in the snapshot set (`SNAPSHOT_VAR_KEYS`). Row 19 stays inert until an explicit decision — mirror the routing vars into the snapshot, or add a computed boolean — lands as its own change. Expressing `is_null` over `project.origin` as-is would build a false-halt machine (always TRUE).
- **Antitrust vars remain premise-locked OUT of `evidence_var`** by migration 0018's Decision 4 (row 13). Any extension there requires a **reversal ADR** superseding that premise — not a seed.
- Thresholds themselves stay **class C** (blocked on the thresholds meeting + calibration corpus); the (a)–(d)-tagged rows stay inert until those decisions land.
- The strict baseline gate now guards ≥ 3; any future executable-count change bumps `_baseline.json` in the same change.
- Registry state after this change: **29 declared / 3 executable / 3 enabled**.

## Cross-references

- Remediation design `docs/designs/2026-08-23-readiness-gap-remediation-design.md` §4 (the executability roadmap this executes).
- ADR-0046 (typed JSON predicate AST + evidence-var registry) §5 — the AST and registry the predicates live in.
- ADR-0057 (evaluator + first activations) — the activation convention this follows; ADR-0058 (evaluation ledger + evidence_ref vocabulary) — the record an activation feeds.
- Migrations 0014 (routing vars, live-read), 0017/0018/0019 (snapshot var seeds); `gd-0022-risk-thresholds` (the anchors record).
