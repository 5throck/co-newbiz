# Traceability Matrix — Regulation Clause → Procedure → System Requirement → Implementation → Test

**Owner**: process-governance-manager, data-architect
**Design of record**: design v1.0 §10 (Stage 4 task 4.2), ADR-0033
**Status**: Stage 4 draft. Covers every **Must**-priority requirement in `docs/srs.md` (MVP scope, ADR-0042) — this is the mechanism that lets `policy:impact` (Stage 5 CLI) know exactly what to re-check when a regulation clause changes, closing the design's own problem #9 (regulations change, system doesn't follow).

**Column meaning**: *Source* = the governance artifact clause this requirement traces back to. *Requirement* = the `docs/srs.md` FR-ID. *Implementation Target* = the planned module/table/component that will satisfy it (Stage 5, not yet built). *Verification* = how this is checked — either an already-passed manual-pilot walkthrough (Stage 3) or a planned Stage 5 automated test.

## 1. Data Architecture

| Source | Requirement | Implementation Target | Verification |
|---|---|---|---|
| Design §4-1 (three-layer model) | FR-DATA-01 | `db/raw_payload`, `db/fact_*`, `db/v_*` schema layers | Stage 5: schema migration test asserting layer separation |
| Design §4-1 (master data catalog) | FR-DATA-02 | `md_industry`, `md_company`, `md_unit`, `md_currency`, `md_country`, `md_period`, `md_source`, `md_statute`, `md_account`, `md_entity`, `md_project` | Stage 5: FK-constraint test rejecting free-text codes |
| Design §4-1 (unit conversion) | FR-DATA-03 | `md_unit.dimension` + `proxy_link` traversal enforcement | Stage 5: cross-dimension conversion attempt must raise a DB-level error |
| Design §4-1 (staging) | FR-DATA-04 | `staging_unmapped` quarantine table | Stage 5: ingest test with an unregistered industry code → load failure + quarantine row |
| ADR-0004 | FR-DATA-05 | `ensure_fresh()` function, `data_change_log` table | Stage 5: repeat-fetch test (0 network calls) + revised-value test (new `revision_no` row, old preserved) |
| Design §4-1 | FR-DATA-06 | `scripts/lib/ssrf.ts` `safeFetch()` call-site audit | Stage 5: static scan for direct `fetch()` calls bypassing `safeFetch()` |
| Design §4-1 | FR-DATA-07 | `assumption` table with `kind`/`rationale`/`ttl_days` | Stage 5: report-finalize test blocked by an expired `assumed` input |
| ADR-0041 (meeting G4) | FR-DATA-08 | `fx_policy` table, `run` FX snapshot fields | Stage 5: two runs on different dates reproduce identical historical FX application |
| Design §9 (meeting G5) | FR-DATA-09 | `retention_policy` table + archival batch job | Stage 5: simulated N-month-aged `simulation_draw` rows archived, quantiles retained |
| ADR-0005 | FR-DATA-10 | `run`, `run_input`, `simulation.seed`, `document.superseded_by` | Stage 5 (design §12 verification item 13): same seed + inputs reproduces identical output |

## 2. Governance System

| Source | Requirement | Implementation Target | Verification |
|---|---|---|---|
| Design §2-0 | FR-GOV-01 | `governance_doc` table | Stage 5: layer/enforceability enum constraint test |
| Design §2-2, `procedures/_validate.ts` | FR-GOV-02 | `procedure` table with `references`/`overrides` JSON columns | Already partially verified: `procedures/_validate.ts` passes 12/12 real procedure files (Stage 2-3) |
| Design §2-2 | FR-GOV-03 | Audit-script duplication detector | Stage 5: intentionally duplicate a `_shared` procedure into an entity override → audit must fail |
| `procedures/_shared/group-investment-review/schema.yaml` step 1 | FR-GOV-04 | `approval_chain` table, hard-reject logic | Stage 5: Group-level procedure entry attempt without Entity IC record → hard rejection + `blocked_reason` populated |
| ADR-0029 | FR-GOV-05 | `group_agenda` ranking view | Stage 5: 3 concurrent proposals in one cycle → ranked comparison view, not 3 isolated approvals |
| `docs/pilots/pilot-003-doosan-bobcat-robotics.md` F-2 | FR-GOV-06 | `entity_ic_decision`/`group_ic_decision` 4-state enum | Already verified: pilot 003 walkthrough confirmed the real withdraw-resubmit case needed this state |
| ADR-0021 | FR-GOV-07 | `project_policy_pin` table | Stage 5 (design §12 verification item 4): in-flight project stays on pinned version after a policy amendment |
| Design §2-4 | FR-GOV-08 | `policy_change` + `policy_impact` tables | Stage 5: `policy:impact --from vX --to vY` produces the affected-object list |
| Design §2-5, `docs/governance-operations.md` §1 | FR-GOV-09 | `compliance_check` gate-blocking logic | Stage 5 (design §12 verification item, governance ops): incomplete mandatory checklist → gate blocked absent a waiver |
| ADR-0037 | FR-GOV-10 | `waiver` table, `expires_at` NOT NULL constraint, six-validator no-waiver-path exception list | Stage 5: waiver attempt against the six-validator completeness check → rejected regardless of approver role |

## 3. RAG Assessment Engine

| Source | Requirement | Implementation Target | Verification |
|---|---|---|---|
| ADR-0016, `docs/rag-framework.md` §3 | FR-RAG-01 | `rag_rule` priority-ordered evaluation engine | Already verified manually: `docs/pilots/pilot-010-affinity-lotte-rental.md` §3 (first real Red-grade case); Stage 5 automated test: force chain grade C → overall capped Amber regardless of financial strength |
| `docs/rag-framework.md` §2 (meeting M3 D-M3-1) | FR-RAG-02 | Financial-dimension grading function | Stage 5: IRR/DSCR boundary-value test matrix |
| `docs/rag-framework.md` §3 | FR-RAG-03 | Data-confidence mapping function | Stage 5: chain grade A/B/C → confidence Green/Amber/Red mapping test |
| `docs/rag-framework.md` §4 | FR-RAG-04 | Hysteresis state machine keyed to `run` timestamps | Stage 5: same-day duplicate manual run does not satisfy the 7-day hold |
| `docs/rag-framework.md` §2.5, `docs/pilots/pilot-008-delivery-hero-woowa-brothers.md` F-1 | FR-RAG-05 | Structural-vs-behavioral remedy discrimination in the Regulatory/Permit grading function | Already partially verified: pilot 008 walkthrough; Stage 5: discharge-confirmed structural remedy re-grades toward Green, live behavioral remedy stays capped |
| `greenfield-fs`/`brownfield-fs` kill criteria | FR-RAG-06 | Base-rate check against historical/peer distribution | Stage 5 (design §12 verification item 7): growth forced to top-5% → automatic warning |
| `docs/rag-framework.md` §7 | FR-RAG-08 | `rag_rule` seed data load script | Stage 5: seed-data load test against the literal bands in `docs/rag-framework.md` §2-4 |

## 4. M&A Special Topics

| Source | Requirement | Implementation Target | Verification |
|---|---|---|---|
| Design §8.9-1(f) | FR-MA-01 | `dd_finding` six-validator completeness check, no-waiver enforcement | Stage 5 (design §12 verification item): any of six validators missing at DD exit → hard block |
| `docs/pilots/pilot-010-affinity-lotte-rental.md` F-2 | FR-MA-02 | `antitrust_finding` common-ownership combination type | Already verified manually via pilot 010; Stage 5: a common-control (not direct-merger) case correctly flagged |
| `checklists/ma-special-topics-checklist.yaml` ma-02 | FR-MA-03 | Multi-jurisdiction filing tracker | Already verified: pilots 001 (single-jurisdiction) and 002 (multi-jurisdiction) both correctly handled manually |
| Design §4-6 | FR-MA-04 | Gun-jumping procedural block (pre-clearance integration action guard) | Stage 5: attempted pre-clearance integration action → blocked, not just flagged after the fact |
| `docs/pilots/pilot-002-hanwha-impact-hsd-engine.md` F-2 | FR-MA-05 | CoC clause scan covering customer AND supplier contracts | Already applied to `checklists/ma-special-topics-checklist.yaml` ma-07/08 (Stage 3) |
| Design §4-9-1(b) | FR-MA-06 | `management_package.executive_ref` role-based key constraint, `comp_benchmark` aggregate-only schema | Stage 5 (design §12 verification item 6): zero individual-level salary rows, zero real names |
| ADR-0027 | FR-MA-07 | Compensation-harmonization upward-bias calculation | Stage 5 (design §12 verification item): both target-higher and acquirer-higher inputs each raise the modeled labor cost |
| ADR-0026 | FR-MA-08 | `contingent_liability` table + Monte Carlo integration | Stage 5 (design §12 verification item): downside NPV tail visibly thickens when contingent liabilities are added |
| `checklists/ma-special-topics-checklist.yaml` ma-11 | FR-MA-09 | `covenant_test` table, +200bp shock scenario | Stage 5 (design §12 verification item): DSCR breach → `covenant_test.breached=1` + Kill Criteria fires |
| ADR-0030 | FR-MA-10 | Unified `incentive(direction, obligation_json, clawback_rule)` table | Stage 5: a single incentive record surfaces both acquisition NPV and clawback exposure |

## 4.5. R&BD (Brown Field Sub-Type)

| Source | Requirement | Implementation Target | Verification |
|---|---|---|---|
| `checklists/rbd-technology-checklist.yaml`, `docs/pilots/pilot-011-posco-amberoad.md` | FR-RBD-01, FR-RBD-03, FR-RBD-04, FR-RBD-05 | `dd_finding.category='rbd'` extension fields (core-tech TRL, IP/FTO status, commercialization-path decision, parent-relationship terms) | Already verified manually: pilot 011 walkthrough confirmed every new checklist item and structure-hypothesis branch on first real-case use |
| `procedures/_shared/brownfield-pre-fs/schema.yaml` v1.2.0 | FR-RBD-07 | `deal_structure_hypothesis.vehicle` enum extended with `internal_venture_spinoff` | Already verified manually: pilot 011 is a real worked example of exactly this structure |

## 5. Green Field

| Source | Requirement | Implementation Target | Verification |
|---|---|---|---|
| Meeting M6 D-M6-1 | FR-GF-01 | `site_candidate` two-stage filter-then-score pipeline | Already verified manually: `docs/pilots/pilot-007-punggu-offshore-wind.md` §4 F-3 confirms the design choice by contrast with a real flawed alternative |
| `docs/pilots/pilot-007-punggu-offshore-wind.md` F-1 | FR-GF-02 | Legal-standard-driven affected-area radius calculation, applied to `greenfield-screening` step 2 | Already applied to `procedures/_shared/greenfield-screening/schema.yaml` v1.2.0 (Stage 3) |
| `docs/pilots/pilot-005-sk-hynix-yongin-cluster.md` F-1 | FR-GF-03 | `infrastructure_plan_not_finalized_at_site_announcement` kill criteria | Already applied to `greenfield-screening` v1.1.0 (Stage 3) |
| Design §4-7 | FR-GF-04 | `site_candidate.incentive_npv`, `infra_capex`, `logistics_cost` on one comparable row | Stage 5: `compare_sites` output has all three on one table |
| Design §4-7, §5-2 | FR-GF-05 | `permit`/`permit_edge` DAG + deadline-vs-critical-path check | Stage 5 (design §12 verification item): construction deadline shorter than permit critical path → warning fires |
| `docs/pilots/pilot-005-sk-hynix-yongin-cluster.md` F-2 | FR-GF-06 | `checklists/site-selection-checklist.yaml` ss-08 broadened scope | Already applied (Stage 3) |

## 6. Information Protection (Non-Descopable)

| Source | Requirement | Implementation Target | Verification |
|---|---|---|---|
| ADR-0038 | FR-SEC-01 | `project_member` deny-by-default repository filter | Stage 5 (design §12 verification item, "one gap and it fails"): non-member sees the project nowhere |
| Design §4-9-1(a) | FR-SEC-02 | Role/membership two-axis access model | Stage 5: admin account without membership still denied deal data |
| Design §4-9-1(a) | FR-SEC-03 | `db/repositories/*.ts` context-injected project filter | Stage 5: code review + static scan for a bypass query path |
| Design §4-9-1(a) | FR-SEC-04 | `wall_group` exclusion at the repository layer | Stage 5: wall-group-excluded user denied access despite otherwise-valid membership |
| ADR-0039 | FR-SEC-05 | `comp_benchmark` aggregate-only, `management_package.executive_ref` substitute-key constraint | Stage 5 (same test as FR-MA-06) |
| ADR-0040 | FR-SEC-06 | `insider_list`, `data_access_log`, MCP default-exclusion for `mnpi_flag=true` | Stage 5 (design §12 verification item): MNPI project auto-generates insider list, logs every access, excluded from default MCP responses |
| ADR-0012 | FR-SEC-07 | Append-only `audit_log` (no DELETE grant at the DB role level) | Stage 5: DB-role permission test — no role, including admin, can execute DELETE against `audit_log` |
| Design non-negotiable boundary #1 | FR-SEC-08 | No service-account credential type exists in the auth schema | Stage 5: schema review confirming no agent-specific credential table exists |
| ADR-0009 | FR-SEC-09 | `scripts/lib/auth.ts` PBKDF2 reuse | Stage 5 (design §12 verification item): direct DB read cannot recover a plaintext password |

## 7. Three-Stage Review

| Source | Requirement | Implementation Target | Verification |
|---|---|---|---|
| Design §10.1-2 | FR-REV-01 | `review_stage` sequencing enforcement (author-domain ≠ 2nd-reviewer-domain check) | Stage 5: same-domain 2nd review attempt → rejected, counted as 1st stage only |
| Design §8.9-1 | FR-REV-02 | `review_stage.unverified_items_json` NOT NULL constraint | Stage 5: AI review submission without could-not-verify items → rejected |
| Design non-negotiable boundary #2 | FR-REV-03 | Human-only-approval gate list (regulations, gate approvals, investment decisions, security model, ADRs) | Stage 5: attempted AI-only approval on a listed item type → blocked |
| `procedures/_shared/entity-ic-review/schema.yaml` | FR-REV-04 | `analysis_task.reviewed_by` NOT NULL gate check | Stage 5: gate-pass attempt with a NULL `reviewed_by` on a required deliverable → blocked |

## 8. System-Level (MCP, Auth, Ops)

| Source | Requirement | Implementation Target | Verification |
|---|---|---|---|
| ADR-0011 | FR-SYS-01 | MCP server implemented as a REST client only, no DB driver dependency in `mcp/co-newbiz/` | Stage 5: dependency-graph check — MCP package has no DB client import |
| Design §4-9-1(c) | FR-SYS-02 | Same `mnpi_flag` exclusion logic reused at the MCP response layer | Stage 5 (same test as FR-SEC-06) |
| ADR-0022 | FR-SYS-04 | Glossary tooltip/report-appendix/`glossary:lint`/`lookup_term` all wired at glossary-entry-creation time | Already partially verified: `glossary/_validate.ts` enforces required fields (Stage 0.3) |
| ADR-0014 | FR-OPS-01 | Migration metadata `reversible: boolean` field, pre/post migration hooks | Stage 5 (design §12 verification item): backup-before, health-check-after sequencing confirmed on a real migration |
| `docs/ops-cadence.md` §1 | FR-OPS-03 | Scheduled recovery-drill job + `job_run` record | Stage 5: one real recovery drill executed and logged |
| `docs/ops-cadence.md` §2, meeting M7-3 | FR-OPS-04 | `reviewer_capacity` computed fresh per cycle, not cached/hardcoded | Stage 5: two consecutive cycles with different reviewer rosters produce different concurrent-deal caps |

## 9. Coverage Note

Every row above traces to a Must-priority `docs/srs.md` requirement, which in turn traces to either an already-approved governance artifact (`policies/`, `procedures/`, `checklists/`) or a specific pilot finding (`docs/pilots/pilot-NNN-*.md`). Rows marked "Already verified" or "Already applied" reflect Stage 2-3 manual validation — Stage 5's job is to make the same behavior hold automatically, not to re-derive it. Should/Could-priority requirements from `docs/srs.md` are intentionally excluded from this matrix's Must-only scope; they get their own lighter-weight tracing once Tier 2/3 scoping is confirmed in Stage 5 planning.
