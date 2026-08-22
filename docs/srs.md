# Software Requirements Specification (SRS)

**Owner**: data-architect, backend-engineer, frontend-engineer
**Design of record**: design v1.0 §4, §10 (Stage 4 task 4.1)
**Status**: Requirements derived from the regulation book (`policies/`, `procedures/`), checklists, `docs/rag-framework.md`, `docs/ops-cadence.md`, and ten real-case manual pilots (`docs/pilots/`). Priority uses MoSCoW, mapped to the MVP tiering already fixed in design v1.0 §10 (ADR-0042): Must = MVP (non-negotiable), Should = Tier 2 (deferrable), Could = Tier 3 (follow-on release). Stage 5 has since built every Must-priority requirement below (see `docs/dev-plan.md`); this document remains the requirement source of record, not a status tracker — check `docs/traceability-matrix.md` for per-requirement implementation status.

## 1. Scope

This SRS covers Stage 5's system build. It does not re-litigate process content (settled in Stages 2-3) — every requirement below traces to an already-approved governance artifact or a pilot finding, per `docs/traceability-matrix.md`.

## 2. Data Architecture Requirements

| ID | Requirement | Priority | Source |
|---|---|---|---|
| FR-DATA-01 | Three-layer data model: `raw_payload` (verbatim external data) → `md_*`/`fact_*` (normalized) → `v_*` (query views) | Must | Design §4-1 |
| FR-DATA-02 | Master data tables per design §4-1's catalog (industry/company/unit/currency/country/period/source/statute/account/entity/project), each with a real code system — no free-text codes | Must | Design §4-1 |
| FR-DATA-03 | Unit conversion restricted to `md_unit`-FK-mediated `proxy_link` traversal — dimension mismatch is a DB-enforced rejection, not an application check | Must | Design §4-1 |
| FR-DATA-04 | Unmapped master-data values quarantine to `staging_unmapped` on ingest — no silent auto-creation | Must | Design §4-1 |
| FR-DATA-05 | `ensure_fresh(series_id)`: cache-first fetch, conditional request (ETag/content-hash) on cache miss, revision-preserving insert (never overwrite) on a genuine change, logged to `data_change_log` | Must | Design §4-1, ADR-0004 |
| FR-DATA-06 | All external HTTP calls route through `scripts/lib/ssrf.ts`'s `safeFetch()` | Must | Design §4-1 |
| FR-DATA-07 | `assumption.kind ∈ {live, user, derived, assumed}`; `assumed` requires non-NULL `rationale`; `as_of + ttl_days` expiry blocks report finalization | Must | Design §4-1 |
| FR-DATA-08 | `fx_policy(scope, rate_type, source_series_id)` — P&L items use period-average, balance-sheet items period-end, transaction consideration contract-date rate; every `run` snapshots the applied rate and source series | Must | Design §9 (meeting G4), ADR-0041 |
| FR-DATA-09 | `retention_policy` table drives archival: `simulation_draw` raw iterations archived after N months (only `simulation_result` quantiles kept permanently); `raw_payload` compressed-archived after M months | Must | Design §9 (meeting G5) |
| FR-DATA-10 | `run`/`run_input` immutable snapshot with `input_hash`; `simulation` additionally records `seed`; `document.superseded_by` chain | Must | Design §4-1, ADR-0005 |

## 3. Governance-System Requirements

| ID | Requirement | Priority | Source |
|---|---|---|---|
| FR-GOV-01 | `governance_doc` table with `layer ∈ {policy, procedure, guideline, checklist, template}`, `enforceability ∈ {mandatory, recommended, mixed}` | Must | Design §2-0 |
| FR-GOV-02 | `procedure` table supports `references:` + `overrides:` (add_steps, replace_steps, thresholds) — shared/entity/region merge with explicit precedence (`_shared` → `regions/<code>` → `entities/<company>`), no implicit merge | Must | Design §2-2, `procedures/_validate.ts` |
| FR-GOV-03 | Audit script (or its Stage 5 equivalent) detects and rejects duplicated copies of a `_shared` procedure in an entity/region override | Must | Design §2-2 (verification gate) |
| FR-GOV-04 | `approval_chain(level ∈ {entity, group})` — Group-level procedure entry hard-rejected (not soft-warned) without a recorded Entity IC approval; `blocked_reason` populated | Must | Design §2-3, `procedures/_shared/group-investment-review/schema.yaml` step 1 |
| FR-GOV-05 | `group_agenda` ranking view comparing concurrent proposals in one review cycle — ranking, not per-project isolated approval | Must | Design §2-3, ADR-0029 |
| FR-GOV-06 | `entity_ic_decision` / `group_ic_decision` support four states: approved / rejected / conditional / **withdrawn_pending_resubmission** | Must | `docs/pilots/pilot-003-doosan-bobcat-robotics.md` finding F-2 |
| FR-GOV-07 | `project_policy_pin(project_id, policy_doc_id, pinned_version, pinned_at, superseded_by)` — a project is evaluated against its pinned version; one live pin per (project, policy doc), re-pinning is append-only (migration 0015, ADR-0047 §4); new-policy application requires an explicit `policy_change` migration record, never silent | Must | Design §2-4, ADR-0021 |
| FR-GOV-08 | `policy_change` impact analysis identifies affected `procedure`/`rag_rule`/`assumption`/checklist/glossary-term references on a regulation amendment | Must | Design §2-4 |
| FR-GOV-09 | `compliance_check`: gate blocked if a required deliverable or mandatory checklist item is missing, unless covered by an active (non-expired) `waiver` | Must | Design §2-5, `docs/governance-operations.md` §1 |
| FR-GOV-10 | `waiver` requires a non-NULL `expires_at`; no indefinite waivers; the six-validator BF completeness check (DD gate) has **no waiver path at all** | Must | Design §2-5, ADR-0037 |
| FR-GOV-11 | Waiver-concentration and interpretation-query-volume feed `governance_kpi` as amendment-priority signals | Should | Design §2-5 |
| FR-GOV-12 | `interpretation` registry with `supersedes` chain — a later answer to the same clause/question never silently contradicts an earlier one | Should | Design §2-5, `docs/governance-operations.md` §3 |

## 4. RAG Assessment Engine

| ID | Requirement | Priority | Source |
|---|---|---|---|
| FR-RAG-01 | Six-dimension rule-based grading: Red if any dimension Red or Kill Criteria triggered; Green only if all six Green (including data confidence); else Amber — priority-ordered, **never averaged** | Must | `docs/rag-framework.md` §3, ADR-0016; validated Red-path-for-real by `docs/pilots/pilot-010-affinity-lotte-rental.md` |
| FR-RAG-02 | Financial dimension bands: Green = IRR≥hurdle+2.0pp AND DSCR≥1.3x; Amber = IRR≥hurdle below Green band; Red = IRR<hurdle | Must | `docs/rag-framework.md` §2 (meeting M3 D-M3-1) |
| FR-RAG-03 | Data confidence mapping: chain grade A→Green, B→Amber, C/staleness-violation→Red; caps the overall grade structurally | Must | `docs/rag-framework.md` §3 |
| FR-RAG-04 | Hysteresis: promote Amber→Green at IRR≥hurdle+2.0pp sustained one full run cycle; demote Green→Amber at IRR<hurdle+0.5pp; 7-day minimum hold measured against `run` timestamps, not wall-clock | Must | `docs/rag-framework.md` §4 |
| FR-RAG-05 | Regulatory/Permit dimension distinguishes structural remedies (re-gradable once discharge confirmed) from behavioral remedies (capped for the full obligation duration) | Must | `docs/rag-framework.md` §2.5, `docs/pilots/pilot-008-delivery-hero-woowa-brothers.md` finding F-1 |
| FR-RAG-06 | Base-rate check: a growth projection outside the top decile of historical/peer distribution auto-warns and requires explicit risk-officer sign-off to proceed | Must | `docs/rag-framework.md` §7 forward reference, `greenfield-fs`/`brownfield-fs` kill criteria |
| FR-RAG-07 | Calibration dry-run against 5-10 historical decisions before live gating is trusted; group-agenda-ranking's quantitative mechanics require internal historical cases specifically — no public-data calibration substitute exists | Should | `docs/rag-framework.md` §6, `docs/pilots/pilot-004-sk-group-capital-rebalancing.md` finding F-1 |
| FR-RAG-08 | `rag_rule(stage_gate, dimension, grade, condition_expr, priority)` seed data encodable directly from `docs/rag-framework.md` §2-4 without re-deriving from meeting transcripts | Must | `docs/rag-framework.md` §7 |

## 5. Monitoring, Notification, and Alerting

| ID | Requirement | Priority | Source |
|---|---|---|---|
| FR-MON-01 | OS-level scheduler (Task Scheduler / systemd timer) drives `watch:run` — never an in-process timer | Must | Design §4-3, ADR-0019 |
| FR-MON-02 | Bidirectional notification: RAG upgrade AND downgrade both alert; downgrade is not optional | Must | Design §4-3 |
| FR-MON-03 | Per-(project, trigger_type) cooldown, hysteresis-aligned re-trigger suppression, daily-digest bundling for non-urgent triggers | Should | Design §4-3 |
| FR-MON-04 | `job_run` is the operational audit trail — checked first when a scheduled run appears not to have fired | Must | `docs/ops-cadence.md` §1 |

## 6. Financial Analysis and Proxy-Chain Engine

| ID | Requirement | Priority | Source |
|---|---|---|---|
| FR-FIN-01 | Historical financial pipeline reused from co-consult: DART ingest → accounting-consistency validation → IFRS-canonical normalization → KPI → 5-stage ROIC driver tree | Must | Design §4-4 |
| FR-FIN-02 | `peer_group`/`peer_member` selection rationale mandatorily recorded — arbitrary peer selection defeats the benchmark | Must | Design §4-4 |
| FR-FIN-03 | Proxy chain: engineering hops (fixed coefficient) vs. statistical hops (regression-estimated) classified explicitly per hop; chain reliability grade (A/B/C) driven by **statistical hop count only** | Must | `guidelines/proxy-chain-hop-classification.md`, ADR-0006, meeting M4 |
| FR-FIN-04 | `value_chain_link` and `proxy_link` stored in separate tables with no shared coefficient reference — code-level check verifies neither reads the other's beta | Must | Design §4-5, ADR-0025, `docs/pilots/pilot-006-orion-ligachem-bio.md` §3 (null-result case) |
| FR-FIN-05 | A value-chain-linkage analysis producing a null result across all six axes is a valid, expected outcome for a pure-diversification thesis — not treated as an analysis failure | Should | `docs/pilots/pilot-006-orion-ligachem-bio.md` finding F-3 |
| FR-FIN-06 | QoE/normalized-EBITDA step requires an alternate path (pipeline/licensing-value or comparable-deal-value approach) for pre-revenue or R&D-stage targets that have no historical EBITDA to normalize | Should | `docs/pilots/pilot-006-orion-ligachem-bio.md` finding F-2 |
| FR-FIN-07 | Certification-transferability step requires an alternate branch (regulatory-pathway/clinical-stage risk assessment) for targets whose regulatory approval is asset-tied rather than entity-tied | Should | `docs/pilots/pilot-006-orion-ligachem-bio.md` finding F-1 |

## 7. M&A Special Topics

| ID | Requirement | Priority | Source |
|---|---|---|---|
| FR-MA-01 | Six-validator BF completeness check at DD exit: antitrust, customer-retention, incentive, hr-integration, contingent-liability, certification — **no waiver path** | Must | Design §8.9-1(f), `procedures/_shared/brownfield-dd/schema.yaml` step 14 |
| FR-MA-02 | Antitrust screening covers HHI/HHI-delta including **common-ownership/common-control** combinations (a sponsor controlling one competitor acquiring another), not only direct target-to-target mergers | Must | `docs/pilots/pilot-010-affinity-lotte-rental.md` finding F-2 |
| FR-MA-03 | Multi-jurisdiction filing determination — real cases confirm both single-jurisdiction (pilots 001, 008) and multi-jurisdiction (pilot 002) shapes occur | Must | `checklists/ma-special-topics-checklist.yaml` ma-02 |
| FR-MA-04 | Gun-jumping prohibition enforced procedurally, not just checked retrospectively | Must | Design §4-6 |
| FR-MA-05 | Change-of-control clause scan covers customer **and supplier** contracts, debt covenants, and executive compensation — not customer-only | Must | `docs/pilots/pilot-002-hanwha-impact-hsd-engine.md` finding F-2 |
| FR-MA-06 | `management_package.executive_ref` uses a role-based substitute key, never a real name; `comp_benchmark` stores job-family/grade aggregates only, never individual salary rows | Must | Design §4-9-1(b) |
| FR-MA-07 | Compensation harmonization applies an **upward bias** in both directions (target-higher and acquirer-higher both raise the post-integration floor) | Must | ADR-0027 |
| FR-MA-08 | Contingent liabilities carry probability + amount distribution (low/expected/high) + expected timing, integrated directly into Monte Carlo — no narrative-only entries | Must | Design §4-6, ADR-0026 |
| FR-MA-09 | Covenant-breach scenario tested under a rate shock (+200bp default); CoC acceleration clauses trigger a modeled cash outflow at closing | Must | `checklists/ma-special-topics-checklist.yaml` ma-11 |
| FR-MA-10 | Incentive table unifies acquisition (`direction=prospective`) and clawback (`direction=granted`) records — obligation and clawback risk on the same row | Must | Design §4-7, ADR-0030 |

## 7.5. R&BD (Brown Field Sub-Type)

Per user decision (2026-08-20): R&BD (Research & Business Development — technology/IP acquisition, license-in, or internal-venture spin-off carve-out) is a **Brown Field sub-type** (`case_subtype: rbd`), not a separate top-level case type — its deal mechanics (equity stake, license terms) are BF-shaped, not GF site-selection-shaped.

| ID | Requirement | Priority | Source |
|---|---|---|---|
| FR-RBD-01 | Core-technology TRL assessed distinctly from production-process TRL (`technical-dd-checklist.yaml` tdd-03) — an R&BD target's core risk is whether the underlying technology works, before production readiness is relevant | Must | `checklists/rbd-technology-checklist.yaml` rbd-01 |
| FR-RBD-02 | Government co-funding conditions (technology-fee repayment, IP walk-away/ownership, employment/localization conditions) identified when applicable — conditional on funding source, not blanket | Should | `checklists/rbd-technology-checklist.yaml` rbd-02, `docs/pilots/pilot-011-posco-amberoad.md` (N/A case), `docs/pilots/pilot-012-lg-studio341.md` (real positive case — TIPS/DIPS) |
| FR-RBD-03 | Freedom-to-operate/IP ownership diligence — who owns the IP and whether license terms transfer cleanly on the contemplated structure | Must | `checklists/rbd-technology-checklist.yaml` rbd-03 |
| FR-RBD-04 | Commercialization-path decision (build internal / license out / spin off) documented with explicit rationale, not defaulted | Must | `checklists/rbd-technology-checklist.yaml` rbd-04, validated by `docs/pilots/pilot-011-posco-amberoad.md` |
| FR-RBD-05 | Continuing parent-entity relationship (equity retained, customer/supplier ties, brand association, non-compete scope) documented as part of deal structure when the target originated as an internal venture | Must | `checklists/rbd-technology-checklist.yaml` rbd-05 |
| FR-RBD-06 | Track-record evidence independently corroborated, not accepted from the target's own reporting alone | Should | `checklists/rbd-technology-checklist.yaml` rbd-06 |
| FR-RBD-07 | `deal_structure_hypothesis` names "internal-venture spin-off carve-out" as an explicit structure option alongside direct/SPC/holdco | Must | `procedures/_shared/brownfield-pre-fs/schema.yaml` v1.2.0 |
| FR-RBD-08 | `dd_finding.rbd_source` distinguishes `internal_only`, `accelerator_partnered`, and `external_technology_acquisition` — each has a materially different public-disclosure/DD profile (real-case-validated across all three) | Must | `docs/pilots/pilot-011-posco-amberoad.md`, `pilot-012-lg-studio341.md`, `pilot-013-hexapro-etri.md` |
| FR-RBD-09 | For `external_technology_acquisition` deals, rbd-01 (TRL) and rbd-05 (originator relationship) both branch: TRL leans on direct licensor documentation over public corroboration; the continuing relationship is royalty/follow-on-program-shaped, not equity/brand-shaped | Should | `checklists/rbd-technology-checklist.yaml` v1.1.0, `docs/pilots/pilot-013-hexapro-etri.md` findings F-1/F-2 |
| FR-RBD-10 | rbd-02 classifies a government-institute relationship as formal co-funded grant (binding conditions) vs. informal/in-kind collaboration (conditions may not apply) before assessing DD implications | Must | `checklists/rbd-technology-checklist.yaml` v1.2.0, `docs/pilots/pilot-014-c2y-university-techholdings.md` finding F-1 |
| FR-RBD-11 | rbd-03 covers joint-IP-ownership diligence for active co-research/co-development relationships, distinct from a simple license-in ownership chain | Must | `checklists/rbd-technology-checklist.yaml` v1.2.0, `docs/pilots/pilot-014-c2y-university-techholdings.md` finding F-2 |
| FR-RBD-12 | `deal_structure_hypothesis` names "minority venture investment" as a fourth R&BD deal shape alongside build/license/spin-off — not every R&BD review is an acquisition/absorption thesis | Must | `procedures/_shared/brownfield-pre-fs/schema.yaml` v1.3.0, `docs/pilots/pilot-014-c2y-university-techholdings.md` finding F-4 |

## 8. Green Field (Site Selection, Infrastructure, Incentives)

| ID | Requirement | Priority | Source |
|---|---|---|---|
| FR-GF-01 | Two-stage site selection: hard infrastructure pre-filter, then weighted score (infra 30% / incentive NPV 25% / logistics 15% / labor 15% / permit critical path 15%) — pre-filter excludes, never just down-weights | Must | Meeting M6 D-M6-1, `procedures/_shared/greenfield-screening/schema.yaml` |
| FR-GF-02 | Community-notification/consultation boundary computed from the **legally applicable affected-area radius**, never assumed equal to the project's administrative jurisdiction | Must | `docs/pilots/pilot-007-punggu-offshore-wind.md` finding F-1 |
| FR-GF-03 | Kill-criteria escalation when infrastructure plans are not finalized at site announcement — an elevated-risk path, not a silent pass | Must | `docs/pilots/pilot-005-sk-hynix-yongin-cluster.md` finding F-1 |
| FR-GF-04 | Incentive NPV compared on the same table as infra capex and logistics cost per site — never a separate, uncomparable figure | Must | Design §4-7 |
| FR-GF-05 | Permit-pathway DAG with per-agency statutory lead time; incentive application/construction deadlines checked against the DAG's critical path | Must | Design §4-7, §5-2 |
| FR-GF-06 | Site-selection checklist covers inter-regional resource disputes (e.g. upstream water-rights objections from a different jurisdiction), not only local-community-adjacent objections | Must | `docs/pilots/pilot-005-sk-hynix-yongin-cluster.md` finding F-2 |

## 9. Partnership

| ID | Requirement | Priority | Source |
|---|---|---|---|
| FR-PT-01 | Compliance screening (sanctions, anti-corruption history) mandatory for every shortlisted partner candidate | Must | `checklists/partnership-checklist.yaml` pt-02 |
| FR-PT-02 | Where the business model has a hard partner dependency, partner-sourcing failure is modeled as a Kill Criteria candidate (termination), not a schedule delay | Must | ADR-0031 |
| FR-PT-03 | JV governance, contribution valuation, exit clauses, and deadlock-resolution mechanism required before term-sheet negotiation | Should | `checklists/partnership-checklist.yaml` pt-06 |

## 10. Information Protection (Non-Descopable — MVP)

| ID | Requirement | Priority | Source |
|---|---|---|---|
| FR-SEC-01 | Deny-by-default project access: `project_member` explicit membership required to see a project in any listing, search, API, or report response | **Must (non-descopable)** | Design §4-9-1(a), ADR-0038 |
| FR-SEC-02 | `admin` role grants system-administration privilege only — never automatic deal-data visibility | **Must (non-descopable)** | Design §4-9-1(a) |
| FR-SEC-03 | Repository-layer project-filter injection at every DB access entry point — no code path may bypass it | **Must (non-descopable)** | Design §4-9-1(a) |
| FR-SEC-04 | `wall_group` exclusion enforced at the same layer as project membership | **Must (non-descopable)** | Design §4-9-1(a) |
| FR-SEC-05 | No individual identifiers stored for compensation data; aggregate-first principle enforced at the schema level, not just by convention | **Must (non-descopable)** | Design §4-9-1(b), ADR-0039 |
| FR-SEC-06 | `mnpi_flag=true` projects auto-generate and maintain `insider_list`; every access logged to `data_access_log`; excluded from MCP tool responses by default, scoped-token override itself audited | **Must (non-descopable)** | Design §4-9-1(c), ADR-0040 |
| FR-SEC-07 | Audit log is append-only — no delete path exists for any role, including admin | **Must (non-descopable)** | ADR-0012 |
| FR-SEC-08 | Agents inherit the calling user's permissions; no agent service account exists anywhere in the system | **Must (non-descopable)** | Design non-negotiable boundary #1 |
| FR-SEC-09 | PBKDF2-HMAC-SHA256 (210,000 iter, 16B salt, 32B key) reused from `scripts/lib/auth.ts` — plaintext password never logged or recoverable, including by direct DB access | Must | ADR-0009 |

## 11. Three-Stage Review Model

| ID | Requirement | Priority | Source |
|---|---|---|---|
| FR-REV-01 | AI 1st (formal/deterministic) → AI 2nd (cross-domain, different domain than author) → human final — no stage may be skipped | Must | Design §10.1-2 |
| FR-REV-02 | Human review surface shows no "PASS" stamp; output split verified / could-not-verify / needs-judgement; `review_stage.unverified_items_json` NOT NULL | Must | Design §8.9-1 |
| FR-REV-03 | Regulations, gate approvals, investment decisions, security/privacy model, and ADRs cannot pass on AI review alone | Must | Design non-negotiable boundary #2 |
| FR-REV-04 | `analysis_task.reviewed_by` NULL blocks the gate on any required deliverable | Must | `procedures/_shared/entity-ic-review/schema.yaml` kill criteria |

## 12. UI, API, and MCP (Detail in `docs/ui-spec.md`, `docs/api-spec.md`, `docs/mcp-integration.md` — Stage 4 follow-up)

| ID | Requirement | Priority | Source |
|---|---|---|---|
| FR-SYS-01 | MCP server calls REST API exclusively — never a direct DB connection; same permission/audit enforcement as a web session | Must | ADR-0011 |
| FR-SYS-02 | `mnpi_flag` projects excluded from MCP tool responses by default (see FR-SEC-06) | Must | Design §4-9-1(c) |
| FR-SYS-03 | Every numeric figure in the UI carries a source tooltip (assumption key, as_of, source, anchor_ref) | Should | Design §4-10 |
| FR-SYS-04 | Glossary tooltip, report-appendix auto-generation, `glossary:lint`, and MCP `lookup_term` all wired from day one — no glossary addition ships without a consuming surface | Must | ADR-0022 |
| FR-SYS-05 | Color-blind-safe RAG display (icon + label, never color alone) | Should | Design §4-2 |

## 13. Deployment, Operations, Security

| ID | Requirement | Priority | Source |
|---|---|---|---|
| FR-OPS-01 | Every migration tagged reversible-or-not at write time; backup runs immediately before, health check immediately after | Must | ADR-0014 |
| FR-OPS-02 | Irreversible migrations require joint release-engineer + dba sign-off | Must | ADR-0014 |
| FR-OPS-03 | Monthly recovery drill — a backup never restored is not a verified backup | Must | `docs/ops-cadence.md` §1 |
| FR-OPS-04 | Concurrent-deal capacity (`min(reviewer_capacity/0.3, wall_group_compatible_assignments)`) recomputed fresh at the start of every review cycle, never a hardcoded default beyond the conservative floor of 1 | Must | `docs/ops-cadence.md` §2, meeting M7-3 |

## 14. Requirements Explicitly Out of MVP Scope (Tier 2/3)

| Area | Rationale |
|---|---|
| Web UI + admin console | CLI can substitute for MVP operation |
| Auto-monitoring/alerting automation | Manual re-run substitutes in MVP |
| MCP server | Deferred until REST API is stable |
| Region profiles beyond KR/EU (initial) | US/CN/SEA already drafted but not the full MVP-critical set |
| Simulation/calibration sophistication beyond the base Monte Carlo | Base implementation sufficient for MVP |
| Governance KPI dashboard | Manual KPI tracking substitutes in MVP |
| Multi-language UI | Korean-only UI is MVP-sufficient |

## 15. Related

- `docs/traceability-matrix.md` — clause-to-requirement-to-implementation-to-test mapping for the Must-priority rows above
- `docs/db-schema.md` — ERD realizing the tables named throughout this SRS
- `docs/pilots/` — the ten real-case pilots this SRS's pilot-sourced requirements (FR-*-0x referencing `docs/pilots/pilot-NNN-*.md`) trace back to
