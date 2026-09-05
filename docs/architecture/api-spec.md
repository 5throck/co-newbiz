# API Specification — co-newbiz

**Owner**: backend-engineer, data-architect
**Design of record**: design v1.0 §4-11 (task 4.4), `docs/architecture/srs.md` §12, `docs/architecture/db-schema.md`
**Status**: Endpoint catalog and access-control contract — implemented Stage 5 Waves 5.6-5.7 plus the engine-1 run-versioning and engine-2 simulations waves (`app/server/*.ts`: `admin.ts`, `analysis.ts`, `auth.ts`, `deal-review.ts`, `envelope.ts`, `glossary.ts`, `governance.ts`, `index.ts`, `middleware.ts`, `monitoring.ts`, `projects.ts`, `tokens.ts`). `docs/architecture/openapi.yaml` (OpenAPI 3.1, as-built surface only) is now generated, and `tests/unit/openapi.test.ts` is its executable drift gate — set equality with the `app/server/*.ts` route declarations in both directions (mcp-integration.md §6), so a route without a spec entry, or a spec entry without a route, fails the suite. This document stays the human-readable index; the §4/§6/§7 tables carry an Implementation column separating `as-built` rows from `forward-design` rows (the contract the later engine waves will implement: proxy chains, group agenda, reports, management package, comp benchmark, customer risk — run versioning landed with engine-1: `model`/`diff` CLI + the §4 runs rows; simulations landed with engine-2: the §4 simulations rows + `run_simulation` MCP).

## 1. Design Rules (Non-Negotiable)

- **Every endpoint enforces `project_member` filtering at the repository layer** (FR-SEC-01/03) — there is no endpoint that bypasses it, including admin-scoped ones.
- **Session cookie (web) + Bearer API token (MCP/CLI)** — tokens are stored hashed, scope-limited, never logged in plaintext.
- **MCP calls this API exclusively** (ADR-0011) — no separate code path with looser enforcement.
- **`mnpi_flag=true` projects are excluded from default list/search responses** across every endpoint below, not just MCP (FR-SEC-06/SYS-02).
- **Write endpoints are audit-logged**, including the actor, scope, and diff where applicable (append-only `audit_log`, FR-SEC-07).

## 2. Authentication & Session

| Endpoint | Method | Purpose | Auth |
|---|---|---|---|
| `/api/auth/register` | POST | Self-registration → `pending` status | None |
| `/api/auth/login` | POST | Session cookie issuance | Credentials |
| `/api/auth/me` | GET | Current identity (`user_id`, `role`, `must_change_password`) — part of the must-change-password allowlist | Session |
| `/api/auth/logout` | POST | Session invalidation | Session |
| `/api/auth/password-reset` | POST | Admin-initiated reset, forces `must_change_password` | Admin |
| `/api/auth/password-change` | POST | User-initiated change, checked against `password_history` | Session |
| `/api/tokens` | POST/GET | API token issuance/list, scope-limited | Session |
| `/api/tokens/:id` | DELETE | Revoke one own API token — foreign ids resolve to 404, never 403 | Session |

## 3. Projects and Membership

| Endpoint | Method | Purpose | Access Control |
|---|---|---|---|
| `/api/projects` | GET | List projects — **filtered to caller's `project_member` rows only**, `mnpi_flag` projects further gated. Rows carry `rag_overall` + `rag_assessed_at` (the latest overall-grade `rag_assessment` row, one aggregate query) only when an overall assessment exists — absence means "no overall grade yet" (never a default color, same rule as `/api/projects/:id/rag`). `stale` is deliberately not emitted: `fact_market_observation` carries no project binding and `ttl_days` is per (run, assumption_key), so no honest per-project freshness signal exists to report | `project_member` deny-by-default |
| `/api/projects` | POST | Create project (`md_project`) | `analyst`+ role |
| `/api/projects/:id` | GET | Project detail | Membership required — 404, not 403, for a non-member (existence itself is protected, FR-SEC-01) |
| `/api/projects/:id/members` | GET/POST/DELETE | Membership management | `lead` role on the project |
| `/api/projects/:id/classification` | GET/PUT | `sensitivity`/`mnpi_flag`/`wall_group` | `legal-counsel` or `compliance-officer` role |

## 4. Analysis and Runs

| Endpoint | Method | Purpose | Access Control | Implementation |
|---|---|---|---|---|
| `/api/series` | GET | Series catalog from `fact_market_observation` (`?q=` substring filter) | Authenticated | as-built (5.7B) |
| `/api/series/:id/observations` | GET | Latest revision per period; `?all_revisions=1`, `?period_id=` | Authenticated | as-built (5.7B) |
| `/api/projects/:id/runs` | GET/POST | List/create analysis runs — POST records a **versioned input snapshot** (`run_input` copy + `set` overrides + `input_hash`), not a valuation result; `from_run_id` defaults to the project's latest run and must belong to the same project (400 otherwise) | Membership; POST `analyst`+ role, audit-logged | as-built (engine-1) |
| `/api/runs/:id` | GET | Run detail (`run_input` snapshot, `input_hash`) | Membership on `run.project_id` — 404 for a non-member | as-built (engine-1) |
| `/api/runs/:id/diff/:other_id` | GET | Variable-level bridge — changed/added/removed per `assumption_key` plus both `input_hash`es; NPV-level decomposition deferred until the valuation engine exists | Membership; both runs must belong to one project (400 otherwise) | as-built (engine-1) |
| `/api/assumptions` | GET/POST | Assumption registry entries | Membership; `kind='assumed'` write requires non-empty `rationale` | as-built (5.7B) |
| `/api/proxy-chains/:id` | GET | Chain detail with per-hop reliability grade | Membership | forward-design |
| `/api/proxy-chains/:id/calibrate` | POST | Recalibration trigger | `quant-methodologist` role | forward-design |
| `/api/simulations` | POST | Monte Carlo run (seeded) — composes the scenario from the run's `sim.*` inputs (`sim.discount_rate`, `sim.cf1..N`) plus the project's `contingent_liability` rows (stored **KRW millions**, scaled ×1e6 into the engine's raw-won contract), spawns `python/monte_carlo.py` with an args array (never shell), and persists `simulation` + `simulation_result`; omitted seed defaults to a value derived from the run's `input_hash` (identical inputs stay reproducible), omitted iterations to the engine's 10000; no `label` — the table has no such column | Membership via `run.project_id`; `analyst`+ role, audit-logged; input problems 400, engine failures 500 | as-built (engine-2) |
| `/api/simulations/:id/results` | GET | Quantile summary (`simulation_result`) ONLY — `simulation_draw` is never read (retention_policy archives raw draws; the permanent record is the summary); meta carries seed + iterations. Quantiles are **engine-native units** (the seeded-reproduction contract, ADR-0061 scope correction #2 — not rescaled) | Membership via simulation → run → project | as-built (engine-2) |
| `/api/portfolio-scorecard` | GET | Cross-project rollup over projects where the caller holds membership; meta self-discloses the subset when `mnpi_flag` projects are excluded | Authenticated, membership-filtered | as-built |
| `/api/projects/:id/scorecard` | GET | Per-project dimension scores for the venture scorecard | Membership + elevated role | as-built |

## 5. RAG and Governance

| Endpoint | Method | Purpose | Access Control |
|---|---|---|---|
| `/api/projects/:id/rag` | GET | Current RAG assessment, all six dimensions + rationale | Membership |
| `/api/projects/:id/rag/history` | GET | `rag_transition` timeline | Membership |
| `/api/procedures/resolve` | GET | Merged procedure (shared+region+entity), with source attribution per step | Membership on the requesting entity/region context |
| `/api/projects/:id/approval-chain` | GET | Entity/Group IC status, `blocked_reason` if applicable | Membership |
| `/api/group-agenda/:cycle` | GET | Ranked comparison view for a review cycle | Group IC role |
| `/api/projects/:id/compliance-checks` | GET | Gate-blocking status | Membership |
| `/api/projects/:id/waivers` | GET/POST | Waiver list/request for the project — `expires_at` required on POST, no waiver path for the six-validator completeness check (rejected server-side, not just client-validated); as-built role mapping: project lead files, admin activates at filing time (the account model has three roles — see module doc in `app/server/projects.ts`) | Membership (GET); project `lead` + `admin` (POST activate) |
| `/api/interpretations` | GET/POST | Interpretation registry, search by clause; POST audit-logged (`interpretation_record`) | Public within the workspace (not project-scoped); POST `admin` only |

## 6. M&A Special Topics and Green Field

| Endpoint | Method | Purpose | Access Control | Implementation |
|---|---|---|---|---|
| `/api/projects/:id/dd-findings` | GET/POST | `dd_finding` records, including `category='rbd'` fields; POST `value_impact` is an **INTEGER in KRW millions** (ADR-0061) | Membership | as-built (5.7B) |
| `/api/projects/:id/antitrust` | GET | HHI/remedy-type/discharge-status | Membership | as-built (5.7B) |
| `/api/projects/:id/liabilities` | GET | Combined exposure — `debt_instrument` + `contingent_liability` + the latest simulation's `covenant_test` (money fields **KRW millions** per ADR-0061; covenant thresholds/ratios are ratios) | Membership | as-built (5.7B) |
| `/api/projects/:id/contingent-liabilities` | POST | Feeds Monte Carlo | Membership | forward-design (read side served by `/liabilities`) |
| `/api/projects/:id/management-package` | GET | **`executive_ref` only, never a real name** (FR-MA-06/SEC-05) — response schema has no name field to accidentally populate | Membership + elevated role (compensation data) | as-built (2026-08-28 — viewer rejected, analyst/admin read; M&A 검토 tab section) |
| `/api/projects/:id/comp-benchmark` | GET | Aggregate-only rows | Membership + elevated role | as-built (2026-08-28 — viewer rejected; M&A 검토 tab section) |
| `/api/projects/:id/sites` | GET | `site_candidate` comparison table | Membership | as-built (5.7B) |
| `/api/projects/:id/permits` | GET | Permit DAG with critical path (`?include_dag=1`); certifications returned in parallel, never merged | Membership | as-built (5.7B) |
| `/api/projects/:id/incentives` | GET/POST | Unified acquisition/clawback record | Membership | GET as-built (5.7B); POST forward-design |
| `/api/projects/:id/partners` | GET/POST | Partner candidate screening | Membership | GET as-built (5.7B); POST forward-design |
| `/api/projects/:id/value-chain-links` | GET | `value_chain_link` with industry names (ADR-0025: separate table from proxy chains) | Membership | as-built (5.7B) |

## 7. Monitoring, Notifications, Reports

| Endpoint | Method | Purpose | Access Control | Implementation |
|---|---|---|---|---|
| `/api/watch` | GET/POST/DELETE | User subscriptions | Session (own subscriptions only) | as-built (5.6A) |
| `/api/notifications` | GET | Delivered/pending, per-user — no read/unread state: `notification` has no `read_at` and no cleanly-fitting column exists elsewhere (`session`/`app_user` carry no last-seen; `watch.last_checked_at` is a change-detection watermark), so adding one requires a migration; `sent_at` is the only lifecycle timestamp | Session | as-built (5.6A) |
| `/api/data-changes` | GET | `data_change_log` scan | Authenticated — market data is workspace-level (`fact_market_observation` carries no project binding) | as-built (5.7B) |
| `/api/reports/:run_id` | POST | Generate deliverable (docx/pdf/hwpx) — staleness gate blocks if inputs exceed `ttl_days` | Membership | forward-design |
| `/api/glossary` | GET | Glossary term list (collection view) | Public within the workspace | as-built (5.6A) |
| `/api/glossary/:term` | GET | Glossary lookup (also backs UI tooltip, MCP `lookup_term`) | Public within the workspace | as-built (5.6A) |
| `/api/reports` | GET | Deliverable document list + superseded chain (joins `document` on `run`) | Authenticated | as-built (2026-08-27 web-implementation-plan) |
| `/api/reports/:id/export` | GET | Render a document's markdown to `docx`/`hwpx`/`pdf` via `scripts/co-newbiz/report.ts` → `python/report/render_*.py`; `format` query param (`docx`/`hwpx`/`pdf`) | Authenticated | as-built (2026-08-27 web-implementation-plan) |

### 7.1 PMI and Class-C Evidence Surfaces (as-built — ADR-0063 write paths)

All project-scoped via membership (404-not-403); writes analyst-gated and audit-logged. Money fields INTEGER KRW millions; `run_rate_bp` is basis points.

| Endpoint | Method | Purpose | Access Control |
|---|---|---|---|
| `/api/projects/:id/pmi/key-talent` | GET/POST | Close-locked key-talent roster (#28 attrition input) | Membership; POST project `analyst`+ |
| `/api/projects/:id/pmi/synergy-certifications` | GET/POST | Synergy run-rate certifications (#29 BAU-exit halt input) | Membership; POST `analyst`+ |
| `/api/projects/:id/deal-shape-evaluations` | GET/POST | P3 candidate-shape verdicts (#14 viable count) | Membership; POST `analyst`+ |
| `/api/projects/:id/incentive-deadlines` | GET/POST | Incentive deadlines (#4 permit-path tripwire) | Membership; POST `analyst`+ |
| `/api/projects/:id/dimension-inputs` | GET/POST | Judged-variable assertions (`?var_key=` narrows; POST lands UNREVIEWED by design) | Membership; POST `analyst`+ |
| `/api/projects/:id/dimension-inputs/:rowId/review` | POST | Cross-domain second review (reviewer ≠ asserter) | Membership; POST `analyst`+ |

### 7.2 Market and Value-Chain Simulation (as-built — ADR-0066 Phases A/C)

| Endpoint | Method | Purpose | Access Control |
|---|---|---|---|
| `/api/projects/:id/value-chain/topology` | GET | Layered chain graph (upstream→end-market); cycle → 400 `topology_cycle` | Membership |
| `/api/projects/:id/industries/:industryId/financials` | GET | Per-year metric aggregates for one node (`?years=1..10`) | Membership |
| `/api/projects/:id/financial-imports` | POST | User-provided fallback ingestion into `fact_industry` (DART collector unavailable) — analyst+, audited | Membership; POST `analyst`+ |
| `/api/projects/:id/structure-simulations` | POST | ADR-0066 Phase C engine run: drv.* assumptions + sensitivities + links → per-node quantiles persisted; re-run same run+scenario rejected pre-spawn | Membership; POST `analyst`+ |
| `/api/projects/:id/structure-simulations` | GET | Persisted quantile rows (`?run_id=` narrows) | Membership |

## 8. Admin Console (Never MCP-Exposed)

| Endpoint | Method | Purpose | Access Control |
|---|---|---|---|
| `/api/admin/users` | GET/PUT | User management | `admin` role — **still cannot see project data via this endpoint** |
| `/api/admin/data-sources` | GET | API key presence/last-success only, **never the key value** | `admin` role |
| `/api/admin/schedule-jobs` | GET/PUT | `job_run` history, retry | `admin` role |
| `/api/admin/audit-log` | GET | Read-only, no delete endpoint exists at any privilege level | `admin` role |
| `/api/admin/retention` | GET/POST | Retention policy management | `admin` role |
| `/api/admin/governance` | GET | Governance document registry (`governance_doc`: layer/key/title/version/enforceability/owner/superseded_by) | `admin` role |
| `/api/admin/master-data` | GET | Master-data unmapped queue (`staging_unmapped`: raw_value/attempted_master_table/first_seen_at) | `admin` role |
| `/api/admin/adr` | GET | ADR index scanned from `docs/adr/*.md` (id/title/status); excludes README | `admin` role |

## 9. Response Envelope and Error Contract

```json
{
  "data": { ... },
  "meta": { "as_of": "...", "run_id": "...", "policy_version": "..." },
  "error": null
}
```

Every numeric figure in `data` that traces to an `assumption` carries its `assumption_key`, `as_of`, `source`, and `anchor_ref` in `meta` — this is the API-level realization of FR-SYS-03 (UI source tooltips read directly from this envelope, no separate lookup).

Landing state: `ok()` carries provenance fields into `meta` via `envelope.ts`'s `provenance()` normalizer (`assumption_key`/`source`/`anchor_ref`/`run_id`; null/blank values are dropped so absent stays absent), attached **only where a route derives them from the rows it returns**: `GET /api/series/:id/observations` sets `source` when every returned row shares one `source_id`, and `POST /api/projects/:id/dd-findings` links the finding's `assumption_key` to the latest assumption-registry row for that key (`run_id`, `anchor_ref`). A multi-row response whose rows carry differing provenance keeps it per-row — the rows already carry their own columns — and never collapses it into one fabricated meta entry.

## 10. Rate Limiting and Abuse Prevention

- MCP write-scoped tools (marked ✱ in design §4-11) are rate-limited per token, independent of the web session limits.
- `safeFetch()` (FR-DATA-06) applies to any endpoint that triggers an outbound fetch (e.g. `watch:run`-adjacent manual-trigger endpoints), preventing SSRF via a crafted `source` override.

## 11. Related

- `docs/architecture/mcp-integration.md` — the MCP tool catalog built on top of this API
- `docs/architecture/ui-spec.md` — the frontend consuming this API
- `docs/security/security-model.md` — the threat model this access-control design defends against
