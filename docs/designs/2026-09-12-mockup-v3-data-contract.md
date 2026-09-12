# Mockup v3 — Data Contract & API Gap List

- **Date**: 2026-09-12
- **Purpose**: implementation pre-check for the v3 mockup surfaces (P3 of the all-agent design review). Every v3 surface is annotated against the real schema; items below need backend work BEFORE frontend build. Owner: data-architect (schema) + backend-engineer (API).
- **Rule**: designs referencing data no endpoint returns are invalid (ux-designer-agent acceptance checklist) — this list is the resolution of that check.

## A. Schema additions (migrations needed)

| # | Field/Table | Surface | Notes |
|---|---|---|---|
| A1 | `brownfield_target.discovery_source` (TEXT: master_proposal \| web_proposal \| manual) | S6/S7 candidate discovery | proposal acceptance/ignore tracking; provenance-first (P3 principle) |
| A2 | `brownfield_target.proposal_accepted_at` | S6/S7 ② | nullable — set when a master/web proposal is accepted |
| A3 | antitrust screening rows already exist (`antitrust` table, migration 0086-era) — **no migration**, needs REST only | S6/S7 ⑥b | see B2 |
| A4 | `incentive`, `debt_instrument`, `covenant_test`, `contract_coc`, `management_package`, `comp_benchmark`, `site` tables already exist (PR #65 batch 2/3) — **no migration** | t-incentive / t-debt / t-coc / t-comp | legacy surfaces were app/web (removed); REST + UI are new |

## B. API gaps (endpoints to create)

| # | Endpoint | Surface | Notes |
|---|---|---|---|
| B1 | target master/web proposal suggest + accept/ignore | S6/S7 ② | deterministic sources first (company master by KSIC, DART search); web search proposals must carry the LLM-proposal label + evidence (ADR-0118 whitelist normalization) |
| B2 | `GET/POST /api/projects/{id}/antitrust` | S6/S7 ⑥b | rows exist in DB from legacy batches; judge-write follows ADR-0011 REST-only rule |
| B3 | `GET/POST /api/projects/{id}/incentives` (+clawback calc) | t-incentive | region profile recommendation = deterministic join on `region_code` |
| B4 | `GET/POST /api/projects/{id}/sites` | t-site | scoring is stored, not invented (ADR-0112: no sentinel constants) |
| B5 | `GET/POST /api/projects/{id}/permits` (+DAG endpoint) | t-permits | permits vs certifications kept separate per flow.spec |
| B6 | `GET/POST /api/projects/{id}/debt` (+covenant test run) | t-debt | covenant scenario test = deterministic recompute |
| B7 | `GET/POST /api/projects/{id}/interviews` | DD expert-interview tab (Korean label) | evidence_ref mandatory (ADR-0058) |
| B8 | `GET/POST /api/projects/{id}/customer-coc` | DD customer-concentration/CoC tab (Korean label) | concentration ≥30% auto-flag rule |
| B9 | `GET/POST /api/projects/{id}/comp-parity` / `management-package` | PMI compensation | aggregate-only exposure for comp rows (SEC-05) |
| B10 | committee session viewer already exists (`committee-sessions` REST) — surface only | committee viewer | no new API |

### v4 additions (2026-09-12, round-2 review)

| # | Field/Table | Surface | Notes |
|---|---|---|---|
| A5 | `deal_comment` table (entity_type, entity_id, parent_user_id, body, created_at — append-only) | collaboration comment threads (deal overview) | collaboration annotations; member-visibility rules apply |
| A6 | `stage_sla` policy config (stage_id, target_days) | stage timeline·SLA view | operating policy, admin-managed; derived elapsed/overdue is computed, never stored |

### v5 additions (2026-09-12, round-3 review / ADR-0123)

| # | Field/Table | Surface | Notes |
|---|---|---|---|
| A7 | `gate_decision.erp_ref` (nullable TEXT) | S11 gate record | e-approval document cross-reference (ADR-0123 #5) |
| A8 | `share_link` table (id, entity, payload snapshot ref, recipient, expires_at, watermark, created_by) + `share_access` log | external safe-share screen | security-engineer design sign-off required before implementation |
| A9 | backtest fact view (project, forecast scenario NPV/IRR, actuals from venture_scorecard-derived value) | backtest viewer | computed view over existing S8/S12 tables; bias tags stored append-only |

## C. Frontend-only (no backend change)

- Global work-queue topbar (dashboard's my-tasks data, existing endpoint)
- Command palette (client-side index over existing lists)
- Role-preview rendering (existing `Me.role` + ADR-0091 rules)
- Design-system gallery (pure presentation)
- Actor/time badges (audit_log already records these — surface `appendAudit` metadata on decision reads)
- Lucide icon unification (replace decorative emoji; one icon per domain concept, registered in DESIGN-CHECKLIST)
