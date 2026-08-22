# Database Schema (ERD) — co-newbiz

**Owner**: data-architect
**Design of record**: design v1.0 §4-1 (data architecture), §10 (Stage 4 task 4.3), ADR-0001/0002/0003
**Status**: All 68 documented tables are migrated as of `db/migrations/0011_dd_finding_and_remaining_tables.sql` (2026-08-21) — the last 24 (M&A special-topics, Green Field, governance policy/procedure, review/access, and fact_financial/fact_industry/value_chain_link/document/fx_policy) had been documented since Stage 4 but never migrated; closed in one pass after a routine doc-vs-schema audit found the gap. Migration `0013_classification_infra.sql` (2026-08-22) adds the classification-infrastructure tables (`dimension_input`, `project_case_classification`, `deal_structure_hypothesis`); their governance-controlled write paths land with PR-5b in the same release window (`db/repositories/classification.repository.ts`, `dimension-input.repository.ts`, `deal-structure-hypothesis.repository.ts`, plus the `setMnpiFlag` retroactive-enrollment fix in `db/lib/access-control.ts`). Migration `0014_routing_vars.sql` (2026-08-23) seeds the first `evidence_var` rows — routing facts only; scoring-var seeds come with PR-6. Migration `0015_project_policy_pin.sql` (2026-08-23) rebuilds `project_policy_pin` to the 0013 append-only supersede pattern and grandfathers every existing `md_project` row onto the 13 in-force procedure versions (ADR-0047 §4 — the backfill is a precondition of PR-5, not a follow-up). Migration `0016_validator_completeness.sql` (2026-08-23) adds the six-validator completeness artifacts (PR-5c, ADR-0048): `compliance_check` gains the not_applicable invalidation columns, and `validator_completeness_record` stores the durable "6 declared / N applicable / M completed" record brownfield-dd step 14 emits; the engine, not_applicable writer, and same-transaction invalidation sweep live in `db/lib/validator-completeness.ts`, `db/lib/validator-applicability.ts`, `db/repositories/compliance.repository.ts`, and `db/lib/dd-cross-validation.ts`. Migration `0017_market_evidence_layer.sql` (2026-08-23) lands the market dimension evidence layer (PR-6, 2026-08-22 design Decisions 2/6, ADR-0046 §5): the `project_variable_snapshot` table (status carries a documented fourth member `low_confidence` — the design DDL said three, but its own Decision 6 requires low-confidence to be distinguishable from missing), the first scoring-var seeds (9 market / right-to-win vars plus `market.link_fit_quality`), and five `market-dd-*` `rag_rule` rows staged `enabled=0` with `_threshold_placeholder` scalars — every threshold, the fillers, the `switching_cost_grade` CHECK, and `competitive_intensity`'s source stay gated on the thresholds meeting (`docs/decisions/open/market-thresholds.md`), and PR-9 activation stays blocked until that agenda is replaced by a dated decision record. SQLite (`bun:sqlite`, WAL) per ADR-0001, written to the portability constraint of ADR-0002 (no `AUTOINCREMENT`, no implicit `ROWID` dependence, no dynamic-type dependence, no `INSERT OR REPLACE`; ISO-8601 `TEXT` dates; no floating-point money columns; `PRAGMA foreign_keys=ON`).

## 1. Three-Layer Model

```
raw_payload   → verbatim external-source capture, never mutated after insert
md_* / fact_* → normalized master data and observations (3NF)
v_*           → query-optimized views, derived, never a source of truth
```

## 2. Master Data Catalog

| Table | Code System | Key Fields | Why This Code System |
|---|---|---|---|
| `md_industry` | KSIC + NAICS/ISIC mapping | `id`, `ksic_code`, `naics_code`, `isic_code`, `name_ko`, `name_en` | The proxy-chain axis — without a real cross-mapped industry code, chain traversal has nothing to anchor to |
| `md_company` | DART `corp_code` + business registration number + LEI | `id`, `dart_corp_code`, `biz_reg_no`, `lei`, `name_ko`, `name_en` | Peer-group/benchmark and target/competitor identification |
| `md_unit` | Internal unit code + `dimension` + SI coefficient | `id`, `code`, `dimension`, `si_coefficient` | `dimension` is what forces cross-dimension conversions through `proxy_link` rather than ad hoc math (FR-DATA-03) |
| `md_currency` | ISO 4217 | `id`, `iso_code` | — |
| `md_country` | ISO 3166-1 alpha-3 | `id`, `iso_code` | — |
| `md_period` | date/year/quarter/month + `fiscal_year` | `id`, `period_type`, `start_date`, `end_date`, `fiscal_year` | Handles fiscal-year misalignment across entities/regions |
| `md_source` | Internal source code + reliability grade | `id`, `code`, `reliability_grade` | Provenance anchor for every observation |
| `md_statute` | 법제처 statute ID + foreign framework key | `id`, `korea_statute_id`, `foreign_framework_key` | Anchors regulatory requirements to a real legal-text reference |
| `md_account` | IFRS canonical (reused from co-consult `ifrs_general.json`) | `id`, `ifrs_code`, `name_ko`, `name_en` | Financial-statement normalization |
| `md_entity` | Group internal entity code | `id`, `entity_code`, `name_ko` | Anchor for entity-scoped procedure overrides |
| `md_project` | Internal project number | `id`, `project_no`, `current_stage_gate` (`screening`\|`pre_fs`\|`fs`\|`dd`\|`entity_ic`\|`group_ic`, nullable pre-backfill — migration 0013, 2026-08-22 design Decision 5c) | Owner of every `run`/`dd_finding`/`document` |

## 3. Fact and Observation Tables

| Table | Purpose | Key Fields |
|---|---|---|
| `raw_payload` | Verbatim external API/file capture | `id`, `source_id` (→`md_source`), `fetched_at`, `content_hash`, `payload` |
| `fact_market_observation` | Time-series market/industry observations | `series_id`, `period_id` (→`md_period`), `revision_no`, `value`, `unit_id` (→`md_unit`), `source_id` |
| `fact_financial` | Normalized company financials | `company_id` (→`md_company`), `period_id`, `account_id` (→`md_account`), `value`, `revision_no` |
| `fact_industry` | Normalized industry-level metrics | `industry_id` (→`md_industry`), `period_id`, `metric_key`, `value` |
| `data_change_log` | Every detected `new`/`revised`/`deleted` observation | `series_id`, `detected_at`, `change_type`, `old_value`, `new_value` |
| `staging_unmapped` | Quarantine for unregistered master-data references | `id`, `raw_value`, `attempted_master_table`, `first_seen_at` |
| `proxy_link` | Proxy-chain hop, engineering or statistical | `id`, `from_industry_id`, `to_industry_id`, `hop_type` (`engineering`\|`statistical`), `coefficient`, `beta`, `r2`, `lag_months`, `evidence_ref` |
| `value_chain_link` | Value-chain-linkage axes — **no coefficient overlap with `proxy_link`** (ADR-0025) | `id`, `project_id`, `from_industry_id`, `to_industry_id`, `direction`, `elasticity`, `lag_months`, `pass_through_rate`, `concentration_hhi`, `substitution_threat` |

## 4. Assumption, Run, and Versioning

| Table | Purpose | Key Fields |
|---|---|---|
| `assumption` | Every model input, versioned | `id`, `run_id`, `assumption_key`, `kind` (`live`\|`user`\|`derived`\|`assumed`), `value`, `rationale`, `anchor_ref`, `as_of`, `ttl_days` |
| `run` | Immutable analysis snapshot | `id`, `project_id`, `label`, `input_hash`, `created_by`, `created_at`, `superseded_by` |
| `run_input` | Frozen input set per run | PK `(run_id, assumption_key)`, `value` |
| `simulation` | Monte Carlo run | `id`, `run_id`, `seed`, `iterations`, `created_at` |
| `simulation_draw` | Raw iteration output — **archived after N months (`retention_policy`)** | `simulation_id`, `iteration_no`, `metric`, `value` |
| `simulation_result` | Quantile summary — **retained permanently** | `simulation_id`, `metric`, `p05`, `p50`, `p95` |
| `document` | Rendered deliverable | `id`, `run_id`, `version`, `superseded_by`, `document_section_hash` |
| `fx_policy` | FX rate-type assignment per item category | `id`, `scope`, `rate_type`, `source_series_id` |
| `retention_policy` | Archival rule per table | `table_key`, `basis`, `retention_months`, `action`, `last_run_at` |

## 5. Governance Tables

| Table | Purpose | Key Fields |
|---|---|---|
| `governance_doc` | Every policy/procedure/guideline/checklist/template | `id`, `layer`, `key`, `title`, `scope`, `entity_id`, `region_code`, `enforceability`, `owner_agent`, `effective_from`, `superseded_by`, `review_cycle_months` |
| `procedure` | Structured procedure record | `id`, `procedure_key`, `scope`, `entity_id`, `region_code`, `references_id`, `spec_json`, `effective_from` |
| `policy` | Regulation-layer record | `id`, `scope`, `entity_id`, `region_code`, `version`, `effective_from`, `superseded_by` |
| `project_policy_pin` | Procedure/policy version an in-flight project is evaluated against — one live pin per (project, policy_doc_id), re-pinning supersedes. Rebuilt in migration 0015 (2026-08-23) from the 0011 mutable-slot shape to the 0013 append-only pattern, and backfilled: every `md_project` row existing at migration time is grandfathered onto the 13 in-force procedure versions (`pinned_by='migration-0015'`, ADR-0047 §4). `policy_doc_id` is plain TEXT with no FK — the `compliance_check.waiver_id` precedent: the governance-doc anchor tables are still unseeded and owned by the later policy:sync work | `id`, `project_id`, `policy_doc_id`, `pinned_version`, `pinned_at`, `pinned_by`, `superseded_by` |
| `policy_change` | Amendment record | `id`, `policy_id`, `from_version`, `to_version`, `summary`, `adr_ref`, `detected_at`, `applied_at` |
| `policy_impact` | Impact-analysis output per amendment | `policy_change_id`, `target_type`, `target_id`, `impact`, `action`, `status` |
| `approval_chain` | Per-gate approval record | `id`, `project_id`, `level` (`entity`\|`group`), `gate`, `sequence`, `required_procedure_id`, `approver_role`, `entity_id`, `status`, `decision`, `decided_at`, `conditions`, `blocked_reason` |
| `group_agenda` | Group IC ranking cycle entry | `id`, `cycle`, `project_id`, `entity_id`, `submitted_at`, `capital_request`, `priority_rank`, `decision`, `rationale` |
| `compliance_check` | Gate compliance evaluation. Since migration 0013 (2026-08-22 design Decision 5d), `result` also admits `not_applicable` — one row per validator skipped **by classification**, `detail` carrying the rendered `applies_when` sentence + classification row id + `classified_by`/`approved_by`; six-validator completeness is recorded as "6 declared / N applicable / M completed", not a boolean. Since migration 0016 (PR-5c, ADR-0048 §5), a `not_applicable` row carries `invalidated_at`/`invalidated_by_classification` — reclassification (PR-5b `supersede()`) stamps every live skip of the project in the same transaction, so a skip never outlives the classification that justified it; rows are marked, never deleted | `id`, `project_id`, `gate`, `rule_key`, `layer`, `result` (`pass`\|`blocked`\|`reason_required`\|`waived`\|`not_applicable`), `detail`, `waiver_id`, `detected_at`, `resolved_at`, `invalidated_at`, `invalidated_by_classification` |
| `validator_completeness_record` | The durable six-validator completeness artifact brownfield-dd step 14 emits (migration 0016, PR-5c, ADR-0048 §4): declared is pinned to 6 by CHECK — the no-waiver core's size is a governance fact, not a variable — and `completed_count` may exceed `applicable_count` because a covered-with-reason skip counts as completed. `validator_rows` JSON carries `{key, status, compliance_check_id}` per validator (status `completed`\|`not_applicable`\|`missing`); the halt condition (an APPLICABLE validator missing) is surfaced as the kill-criterion trigger, never written as a row | `id`, `project_id`, `run_id` (nullable), `gate` (`dd`), `declared` (=6), `applicable_count` (0-6), `completed_count` (0-6), `validator_rows`, `created_at` |
| `project_case_classification` | Append-only deal classification history — one live row per project, re-classification supersedes (migration 0013, Decision 5b). `origin` is 4-valued: `joint` (true bilateral JV, shared control) is deliberately separate from `hybrid` (passive minority stake) so opposite governance structures never share a bucket. Approver fields are required at the application layer (PR-5) when `origin` reduces the validator set (`internal`\|`hybrid`\|`joint`) — the two-party approval is waiver-equivalent control | `id`, `project_id`, `case_type` (`greenfield`\|`brownfield`), `origin` (`internal`\|`external`\|`hybrid`\|`joint`), `technology_track` (`none`\|`rbd`), `classified_by`, `approver_role`, `approved_by`, `approved_at`, `classified_at`, `rationale`, `superseded_by` |
| `waiver` | Exception record — `expires_at` NOT NULL | `id`, `project_id`, `governance_doc_id`, `clause_ref`, `reason`, `requested_by`, `approver_role`, `approved_by`, `approved_at`, `expires_at`, `status` |
| `interpretation` | Clause-question-answer registry | `id`, `governance_doc_id`, `clause_ref`, `question`, `answer`, `asked_by`, `answered_by`, `answered_at`, `supersedes`, `published` |
| `governance_kpi` | Periodic KPI value | `id`, `period_id`, `entity_id`, `metric_key`, `value`, `note` |

Decision-state enum for `approval_chain.decision` (Entity IC) and `group_agenda.decision` (Group IC): `approved` \| `rejected` \| `conditional` \| `withdrawn_pending_resubmission` (FR-GOV-06, pilot 003 finding F-2).

## 6. RAG Tables

| Table | Purpose | Key Fields |
|---|---|---|
| `rag_rule` | Threshold/priority rule per stage gate — rebuilt in migration 0012 (typed-predicate rules, 2026-08-22 design Decision 1). `enabled` **defaults to 0** and the table CHECK requires both `policy_id` and `thresholds_source` to enable a rule (anti-tamper staging: enabling is a deliberate attributable act, not the silent default). Migration 0017 (PR-6) stages the first rule rows: five `market-dd-*` placeholders (`dd`/`market`), all `enabled=0` with every undecided scalar written as the string `"_threshold_placeholder"` and `grade='amber'` — the only grade that survives the Decision 9 Green cap pre-calibration, so a placeholder cannot manufacture a Green signal even in error. One schema-forced exception: `at_least.k` must be an integer, so `market-dd-right-to-win` carries the agenda §3.6 worked-example `k=2`, re-decided at the thresholds meeting | `id`, `rule_key`, `version`, `stage_gate`, `dimension`, `grade`, `condition_expr`, `priority`, `enabled`, `policy_id`, `thresholds_source`, `created_at` |
| `evidence_var` | Evidence registry — every variable the RAG predicate language can reference (2026-08-22 design Decision 2). `label_ko` feeds `renderKo`'s governance artifact. Migration 0014 (2026-08-23, Decision 5e/7) seeds the routing facts: `target.has_external_market_presence` (asserted — read from the live, reviewed `dimension_input` row) and `project.case_type` / `project.origin` / `project.technology_track` (`column` — read off the live `project_case_classification` row; routing-read views of the ADR-0047 axes). Deliberately NO data defaults: absence is resolved fail-closed by `db/lib/applies-when.ts` (unassessed routing var ⇒ the step APPLIES with an applied-by-default note), never papered over by seed data. Migration 0017 (PR-6, Decision 6) seeds the first scoring vars — the 9 decidable market vars (`bargaining_power_hhi`, `switching_cost_grade`, `tam`, `growth_rate`, `top3_share` computed; `entry_barrier` and the 3 decomposed `right_to_win.*` asserted with mandatory evidence) plus `market.link_fit_quality` (the fit-quality conjunct of agenda §3.1's bargaining-power rule; r2 lives on the `value_chain_link` row); `market.competitive_intensity` is deliberately unseeded — its source is the thresholds meeting's blocking item #1 | `var_key`, `label_ko`, `value_type` (`number`\|`string`\|`boolean`), `unit`, `source_kind` (`column`\|`computed`\|`asserted`), `requires_evidence_ref`, `max_age_days`, `created_at` |
| `rag_rule_variable` | Rule↔variable join — answers "which rules break if this var_key is renamed" in SQL instead of an unindexable LIKE over `condition_expr`. Migration 0017 wires the five staged `market-dd-*` rules; tests assert the wiring equals each parsed `condition_expr`'s var set exactly (`collectPredicateVars`), so a drifted join row fails a test rather than a silent scan | `rule_id`, `var_key` (composite PK) |
| `project_variable_snapshot` | Run-scoped variable snapshot (migration 0017, 2026-08-22 design Decision 2, ADR-0046 §5) — filled once per run by hand-written static SQL per variable family (no dynamic identifier interpolation, no N+1 per-var queries); `dimension_input` is one source among several, not the special case. `status` carries a **documented fourth member** `low_confidence`: the design DDL sketch enumerated three, but Decision 6 requires a value excluded on fit quality (r2 < 0.6, the same standard `gradeChain()` applies — D-M4-1) to be distinguishable from `missing`; the table was new with zero writers, so extending the enum was free now versus an ALTER on a live table later. The exclusion standard is documented, not encoded — no consumer exists until the value_chain_link filler lands (thresholds-meeting-gated). Zero writers today: the fillers are deferred with the thresholds | `run_id`, `project_id`, `var_key` (composite PK), `value_num`, `value_text`, `evidence_ref`, `observed_at`, `status` (`present`\|`missing`\|`stale`\|`low_confidence`) |
| `dimension_input` | Run-scoped, history-preserving judged inputs (migration 0013, 2026-08-22 design Decision 3) — a judgement variable is never a single-row-per-project slot, or classification history (the audit trail that catches a false skip) is deleted. One live assertion per (project, var) is a DB fact via the partial unique index; superseded rows never block re-assertion. `reviewed_by` (cross-domain second reviewer) is nullable at DB level — the write layer (PR-5) refuses to reflect an unreviewed assertion in scoring | `id`, `run_id`, `project_id`, `var_key`, `value_kind` (`num`\|`text`\|`bool` — XOR CHECK against `value_num`/`value_text`), `unit` (snapshots the registry unit at assertion time), `evidence_ref`, `asserted_by`, `reviewed_by`, `rationale`, `observed_at`, `superseded_by` |
| `rag_assessment` | Per-run dimension grade | `id`, `run_id`, `project_id`, `dimension`, `grade`, `triggered_rules`, `rationale`, `assessed_at` |
| `rag_transition` | Grade-change event | `id`, `project_id`, `from_grade`, `to_grade`, `run_id`, `at`, `reason`, `notified` |

`rag_assessment.dimension` includes a `remedy_shape` field (`structural`\|`behavioral`\|`none`) on the Regulatory/Permit row specifically, per FR-RAG-05.

## 7. M&A Special-Topics Tables

| Table | Purpose | Key Fields |
|---|---|---|
| `dd_finding` | Every DD observation with financial consequence. `category='rbd'` findings (R&BD sub-type — technology/IP acquisition, license-in, internal-venture spin-off) additionally carry `trl_grade`, `ip_ownership_status`, `commercialization_path`, `parent_relationship_json`, `rbd_source` (`internal_only` \| `accelerator_partnered` \| `external_technology_acquisition` — pilot 011 F-2, refined by pilot 012 F-2) | `id`, `project_id`, `category`, `description`, `value_impact`, `assumption_key`, `evidence_ref` |
| `antitrust_finding` | Antitrust screen result | `id`, `project_id`, `market_definition`, `hhi_before`, `hhi_after`, `combination_type` (`direct_merger`\|`common_ownership`), `filing_jurisdictions`, `remedy_type` (`none`\|`behavioral`\|`structural`\|`prohibited`), `remedy_detail`, `discharge_confirmed_at` |
| `management_package` | Executive comp — **no real names** | `id`, `project_id`, `executive_ref` (role-based key), `role`, `base_pay`, `coc_trigger`, `coc_payout_estimate`, `accelerated_vesting`, `non_compete_months`, `non_compete_enforceable`, `flight_risk`, `value_impact` |
| `comp_benchmark` | Pay-parity aggregate — **no individual rows** | `id`, `project_id`, `job_family`, `grade`, `headcount`, `target_median`, `acquirer_median`, `gap_pct`, `annual_cost_delta` |
| `benefit_item` | Benefits harmonization | `id`, `project_id`, `category`, `target_value`, `acquirer_value`, `per_capita_delta`, `harmonization_cost` |
| `debt_instrument` | Target debt structure | `id`, `project_id`, `lender`, `principal`, `rate_type`, `rate`, `maturity`, `covenant_json`, `coc_acceleration` |
| `contingent_liability` | Contingent liability for Monte Carlo | `id`, `project_id`, `category`, `probability`, `amount_low`, `amount_expected`, `amount_high`, `distribution`, `expected_timing`, `value_impact` |
| `covenant_test` | Per-scenario covenant check | `simulation_id`, `period_id`, `covenant_key`, `threshold`, `projected_value`, `breached` |
| `incentive` | Unified acquisition/clawback record | `id`, `project_id`, `site_id`, `direction` (`prospective`\|`granted`), `type`, `grantor`, `amount`, `npv_value`, `obligation_json`, `clawback_rule`, `estimated_clawback` |
| `deal_structure_hypothesis` | Deal-structure hypothesis with real columns — until migration 0013 this existed only as a procedure `output_type` string (`procedures/_shared/brownfield-pre-fs/schema.yaml`). Carries ADR-0045's four mandatory review axes (`tax_structure_note`, `liability_isolation_note`, `financing_leverage_note`, `exit_structure_note`; `four_axis_review_completed` defaults 0 — completion is a deliberate act) plus the acquisition-shape axes, for both Brown Field and Green Field tracks. `run_id` is nullable: a hypothesis can precede any analysis run | `id`, `project_id`, `run_id` (nullable), `asset_or_stock` (`asset`\|`stock`\|`mixed`), `stake_type` (`full`\|`majority`\|`minority`\|`joint_control`), `instrument_mix` (`primary`\|`secondary`\|`mixed`), `vehicle` (`direct`\|`spc`\|`holdco`\|`internal_venture_spinoff`\|`jv`), `commercialization_path` (`build`\|`license_in`\|`license_out`\|`spin_off`\|`minority_venture_investment`), the four ADR-0045 note columns, `four_axis_review_completed`, `hypothesized_by`, `hypothesized_at`, `rationale` — all five shape enums nullable at hypothesis time |

## 8. Green Field Tables

| Table | Purpose | Key Fields |
|---|---|---|
| `site_candidate` | Scored site | `id`, `project_id`, `name`, `region_code`, `infra_score`, `infra_capex`, `incentive_npv`, `logistics_cost`, `labor_availability`, `permit_lead_time_days`, `affected_area_notification_status`, `total_score`, `rank` |
| `permit` / `permit_edge` | Permit DAG node/edge | `permit.id`, `permit.agency`, `permit.statutory_days`; `permit_edge.from_permit_id`, `permit_edge.to_permit_id` |
| `certification` / `certification_edge` | Certification DAG — **kept structurally separate from permits**. Since migration 0012, `certification` carries transferability columns (2026-08-22 design, overturn 7): `transferability_basis` (`verified`\|`inferred` — `inferred` is hard-blocked at the repository write layer; inference is disallowed for certification transferability on change of control), `transferable_on_coc`, `transferability_evidence_ref`, `load_bearing` (1 = the business case depends on this certification), `confirmed_at` | `permit`-shaped core (`id`, `project_id`, `name`, `agency`, `statutory_days`, `status`) + the five transferability columns |
| `partner_candidate` | Partner sourcing/screening | `id`, `project_id`, `name`, `partner_type`, `compliance_risk`, `dependency_risk`, `status` |
| `jv_term` | JV structuring terms | `id`, `project_id`, `partner_id`, `equity_split`, `governance_json`, `veto_matters`, `exit_clause`, `deadlock_mechanism` |

## 9. Information Protection Tables (Non-Descopable)

| Table | Purpose | Key Fields |
|---|---|---|
| `project_member` | Deny-by-default membership | `project_id`, `user_id`, `project_role`, `granted_by`, `granted_at`, `revoked_at`, `need_to_know_basis` |
| `project_classification` | Sensitivity/wall-group tagging | `project_id`, `sensitivity`, `mnpi_flag`, `wall_group`, `classified_by`, `classified_at` |
| `insider_list` | MNPI access roster | `project_id`, `user_id`, `added_at`, `removed_at`, `reason`, `acknowledged_at` |
| `data_access_log` | Every access to sensitive tables — **including reads** | `id`, `user_id`, `table_key`, `record_ref`, `project_id`, `action`, `at`, `ip` |
| `audit_log` | **Append-only, no DELETE grant at any role** | `id`, `actor_user_id`, `action`, `target`, `created_at` |

## 10. Review and Access Tables

| Table | Purpose | Key Fields |
|---|---|---|
| `review_stage` | Per-stage review record | `id`, `run_id`, `stage` (`ai_1st`\|`ai_2nd`\|`human_final`), `reviewer_agent_or_user`, `reviewer_domain`, `unverified_items_json` (NOT NULL), `result` |
| `analysis_task` | Deliverable-level review gate | `id`, `project_id`, `deliverable_type`, `reviewed_by`, `reviewed_at` |
| `job_run` | Scheduled batch execution record | `id`, `job_key`, `started_at`, `finished_at`, `status`, `error` |
| `schedule_job` | OS-scheduler-registered job definition | `id`, `job_key`, `cron_expr`, `enabled` |
| `watch` / `watch_rule` | User monitoring subscription | `watch.id`, `watch.project_id`, `watch.user_id`; `watch_rule.watch_id`, `watch_rule.trigger_type`, `watch_rule.threshold`, `watch_rule.cooldown_hours` |
| `notification` | Delivered/pending alert | `id`, `user_id`, `project_id`, `trigger_type`, `payload`, `channel`, `sent_at` |

## 11. Index Rationale

| Index | Table | Reason |
|---|---|---|
| `(series_id, period_id, revision_no)` PK, covering | `fact_market_observation` | Every read needs the latest revision for a series/period pair |
| `idx_obs_latest(series_id, period_id DESC)` | `fact_market_observation` | `ensure_fresh()`'s primary read path |
| `idx_fact_fin(company_id, period_id)` | `fact_financial` | Peer-benchmark and driver-tree queries |
| `idx_fact_ind(industry_id, period_id)` | `fact_industry` | Proxy-chain source-industry lookups |
| `(run_id, assumption_key)` PK | `run_input` | Frozen-snapshot lookup by run |
| `idx_sim_draw(simulation_id, metric)` | `simulation_draw` | 10,000-iteration × multi-metric read pattern — without this, quantile computation collapses |
| `idx_change_log(series_id, detected_at DESC)` | `data_change_log` | `watch:run`'s change-detection scan |
| `idx_audit(actor_user_id, created_at DESC)` | `audit_log` | Compliance/incident-response lookups |
| `idx_rag(project_id, assessed_at DESC)` | `rag_assessment` | Dashboard's current-grade lookup |
| `idx_rag_rule_variable_var(var_key)` | `rag_rule_variable` | Reverse rule-impact lookup when a `var_key` is renamed (2026-08-22 design Decision 2) |
| `idx_dimension_input_live(project_id, var_key) WHERE superseded_by IS NULL` | `dimension_input` | Makes "one live assertion per (project, var)" a database fact; history rows never block re-assertion (2026-08-22 design Decision 3) |
| `idx_dimension_input_project(project_id, observed_at DESC)` | `dimension_input` | Assertion-history timeline per project — the audit trail that catches a false skip |
| `idx_case_classification_live(project_id) WHERE superseded_by IS NULL` | `project_case_classification` | One live classification per project; re-classification is append-only (2026-08-22 design Decision 5b) |
| `idx_project_policy_pin_live(project_id, policy_doc_id) WHERE superseded_by IS NULL` | `project_policy_pin` | One live pin per (project, policy doc); re-pinning is append-only so "which policy set judged this project last quarter" stays answerable (migration 0015, ADR-0047 §4) |
| `idx_validator_completeness_record(project_id, gate, created_at DESC)` | `validator_completeness_record` | Latest-first completeness-record lookup per project — step 14's read path and the re-run bookkeeping audit (migration 0016, ADR-0048 §4) |
| `idx_procedure(procedure_key, scope, entity_id)` | `procedure` | `proc:resolve`'s merge-lookup path |
| `idx_project_member(user_id, project_id)` | `project_member` | Every repository-layer access-filter check (FR-SEC-01) — this index is on the hottest path in the entire system |

FTS5 full-text search (statute/procedure text) is isolated to `db/engine/sqlite/` per ADR-0001/0002 — no Postgres-portable equivalent assumed; migration maps it to `tsvector`.

## 12. Portability Constraints (ADR-0002, Verified at Design Time)

- No `AUTOINCREMENT` — all PKs are explicit ULIDs or composite keys.
- No `INSERT OR REPLACE` — all upserts are explicit read-then-insert-or-update.
- Dates: ISO-8601 `TEXT`, never SQLite's dynamic date functions relied upon for business logic.
- Money: integer minor-units (e.g. won, not floating decimal) — never `REAL` for a monetary column.
- `PRAGMA foreign_keys=ON` enforced at every connection open.
- All access through `db/repositories/*.ts` — no raw SQL in application code outside that layer, since FR-SEC-03's project-filter injection depends on a single enforcement point.
- Verification: `db:export --dialect postgres` DDL diffed against the portability constraints above (Stage 5 gate, design §12).

## 13. Related

- `docs/master-data-catalog.md` *(forward reference — expands §2 above with full field lists per master table, Stage 5)*
- `docs/srs.md` — the requirements each table realizes
- `docs/traceability-matrix.md` — clause-to-table tracing
