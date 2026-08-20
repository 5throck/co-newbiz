# Database Schema (ERD) — co-newbiz

**Owner**: data-architect
**Design of record**: design v1.0 §4-1 (data architecture), §10 (Stage 4 task 4.3), ADR-0001/0002/0003
**Status**: All 68 documented tables are migrated as of `db/migrations/0011_dd_finding_and_remaining_tables.sql` (2026-08-21) — the last 24 (M&A special-topics, Green Field, governance policy/procedure, review/access, and fact_financial/fact_industry/value_chain_link/document/fx_policy) had been documented since Stage 4 but never migrated; closed in one pass after a routine doc-vs-schema audit found the gap. SQLite (`bun:sqlite`, WAL) per ADR-0001, written to the portability constraint of ADR-0002 (no `AUTOINCREMENT`, no implicit `ROWID` dependence, no dynamic-type dependence, no `INSERT OR REPLACE`; ISO-8601 `TEXT` dates; no floating-point money columns; `PRAGMA foreign_keys=ON`).

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
| `md_project` | Internal project number | `id`, `project_no` | Owner of every `run`/`dd_finding`/`document` |

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
| `project_policy_pin` | Policy version an in-flight project is evaluated against | `project_id`, `policy_id`, `policy_version`, `pinned_at`, `pinned_by`, `migration_note` |
| `policy_change` | Amendment record | `id`, `policy_id`, `from_version`, `to_version`, `summary`, `adr_ref`, `detected_at`, `applied_at` |
| `policy_impact` | Impact-analysis output per amendment | `policy_change_id`, `target_type`, `target_id`, `impact`, `action`, `status` |
| `approval_chain` | Per-gate approval record | `id`, `project_id`, `level` (`entity`\|`group`), `gate`, `sequence`, `required_procedure_id`, `approver_role`, `entity_id`, `status`, `decision`, `decided_at`, `conditions`, `blocked_reason` |
| `group_agenda` | Group IC ranking cycle entry | `id`, `cycle`, `project_id`, `entity_id`, `submitted_at`, `capital_request`, `priority_rank`, `decision`, `rationale` |
| `compliance_check` | Gate compliance evaluation | `id`, `project_id`, `gate`, `rule_key`, `layer`, `result`, `detected_at`, `resolved_at` |
| `waiver` | Exception record — `expires_at` NOT NULL | `id`, `project_id`, `governance_doc_id`, `clause_ref`, `reason`, `requested_by`, `approver_role`, `approved_by`, `approved_at`, `expires_at`, `status` |
| `interpretation` | Clause-question-answer registry | `id`, `governance_doc_id`, `clause_ref`, `question`, `answer`, `asked_by`, `answered_by`, `answered_at`, `supersedes`, `published` |
| `governance_kpi` | Periodic KPI value | `id`, `period_id`, `entity_id`, `metric_key`, `value`, `note` |

Decision-state enum for `approval_chain.decision` (Entity IC) and `group_agenda.decision` (Group IC): `approved` \| `rejected` \| `conditional` \| `withdrawn_pending_resubmission` (FR-GOV-06, pilot 003 finding F-2).

## 6. RAG Tables

| Table | Purpose | Key Fields |
|---|---|---|
| `rag_rule` | Threshold/priority definition per stage gate | `id`, `stage_gate`, `dimension`, `grade`, `condition_expr`, `priority`, `enabled`, `policy_id` |
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

## 8. Green Field Tables

| Table | Purpose | Key Fields |
|---|---|---|
| `site_candidate` | Scored site | `id`, `project_id`, `name`, `region_code`, `infra_score`, `infra_capex`, `incentive_npv`, `logistics_cost`, `labor_availability`, `permit_lead_time_days`, `affected_area_notification_status`, `total_score`, `rank` |
| `permit` / `permit_edge` | Permit DAG node/edge | `permit.id`, `permit.agency`, `permit.statutory_days`; `permit_edge.from_permit_id`, `permit_edge.to_permit_id` |
| `certification` / `certification_edge` | Certification DAG — **kept structurally separate from permits** | same shape as `permit`/`permit_edge` |
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
