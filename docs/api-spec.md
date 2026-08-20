# API Specification — co-newbiz

**Owner**: backend-engineer, data-architect
**Design of record**: design v1.0 §4-11 (task 4.4), `docs/srs.md` §12, `docs/db-schema.md`
**Status**: Endpoint catalog and access-control contract — implemented Stage 5 Waves 5.6-5.7 plus the engine-1 run-versioning wave (`app/server/*.ts`: `admin.ts`, `analysis.ts`, `auth.ts`, `deal-review.ts`, `envelope.ts`, `glossary.ts`, `governance.ts`, `index.ts`, `middleware.ts`, `monitoring.ts`, `projects.ts`, `tokens.ts`). `docs/openapi.yaml` (OpenAPI 3.1, as-built surface only) is now generated, and `tests/unit/openapi.test.ts` is its executable drift gate — set equality with the `app/server/*.ts` route declarations in both directions (mcp-integration.md §6), so a route without a spec entry, or a spec entry without a route, fails the suite. This document stays the human-readable index; the §4/§6/§7 tables carry an Implementation column separating `as-built` rows from `forward-design` rows (the contract the later engine waves will implement: proxy chains, simulations, group agenda, reports, management package, comp benchmark, customer risk — run versioning landed with engine-1: `model`/`diff` CLI + the §4 runs rows).

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
| `/api/auth/logout` | POST | Session invalidation | Session |
| `/api/auth/password-reset` | POST | Admin-initiated reset, forces `must_change_password` | Admin |
| `/api/auth/password-change` | POST | User-initiated change, checked against `password_history` | Session |
| `/api/tokens` | POST/GET/DELETE | API token issuance/list/revoke, scope-limited | Session |

## 3. Projects and Membership

| Endpoint | Method | Purpose | Access Control |
|---|---|---|---|
| `/api/projects` | GET | List projects — **filtered to caller's `project_member` rows only**, `mnpi_flag` projects further gated | `project_member` deny-by-default |
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
| `/api/simulations` | POST | Monte Carlo run (seeded) | Membership | forward-design |
| `/api/simulations/:id/results` | GET | Quantile summary (`simulation_result`) — raw draws not exposed after archival (retention_policy) | Membership | forward-design |

## 5. RAG and Governance

| Endpoint | Method | Purpose | Access Control |
|---|---|---|---|
| `/api/projects/:id/rag` | GET | Current RAG assessment, all six dimensions + rationale | Membership |
| `/api/projects/:id/rag/history` | GET | `rag_transition` timeline | Membership |
| `/api/procedures/resolve` | GET | Merged procedure (shared+region+entity), with source attribution per step | Membership on the requesting entity/region context |
| `/api/approval-chain/:project_id` | GET | Entity/Group IC status, `blocked_reason` if applicable | Membership |
| `/api/group-agenda/:cycle` | GET | Ranked comparison view for a review cycle | Group IC role |
| `/api/compliance-checks/:project_id` | GET | Gate-blocking status | Membership |
| `/api/waivers` | GET/POST | Waiver list/request — `expires_at` required on POST, no waiver path for the six-validator completeness check (rejected server-side, not just client-validated) | Role per `docs/governance-operations.md` §2 approval table |
| `/api/interpretations` | GET/POST | Interpretation registry, search by clause | Public within the workspace (not project-scoped) |

## 6. M&A Special Topics and Green Field

| Endpoint | Method | Purpose | Access Control | Implementation |
|---|---|---|---|---|
| `/api/projects/:id/dd-findings` | GET/POST | `dd_finding` records, including `category='rbd'` fields | Membership | as-built (5.7B) |
| `/api/projects/:id/antitrust` | GET | HHI/remedy-type/discharge-status | Membership | as-built (5.7B) |
| `/api/projects/:id/liabilities` | GET | Combined exposure — `debt_instrument` + `contingent_liability` + the latest simulation's `covenant_test` | Membership | as-built (5.7B) |
| `/api/projects/:id/contingent-liabilities` | POST | Feeds Monte Carlo | Membership | forward-design (read side served by `/liabilities`) |
| `/api/projects/:id/management-package` | GET | **`executive_ref` only, never a real name** (FR-MA-06/SEC-05) — response schema has no name field to accidentally populate | Membership + elevated role (compensation data) | forward-design |
| `/api/projects/:id/comp-benchmark` | GET | Aggregate-only rows | Membership + elevated role | forward-design |
| `/api/projects/:id/sites` | GET | `site_candidate` comparison table | Membership | as-built (5.7B) |
| `/api/projects/:id/permits` | GET | Permit DAG with critical path (`?include_dag=1`); certifications returned in parallel, never merged | Membership | as-built (5.7B) |
| `/api/projects/:id/incentives` | GET/POST | Unified acquisition/clawback record | Membership | GET as-built (5.7B); POST forward-design |
| `/api/projects/:id/partners` | GET/POST | Partner candidate screening | Membership | GET as-built (5.7B); POST forward-design |
| `/api/projects/:id/value-chain-links` | GET | `value_chain_link` with industry names (ADR-0025: separate table from proxy chains) | Membership | as-built (5.7B) |

## 7. Monitoring, Notifications, Reports

| Endpoint | Method | Purpose | Access Control | Implementation |
|---|---|---|---|---|
| `/api/watch` | GET/POST/DELETE | User subscriptions | Session (own subscriptions only) | as-built (5.6A) |
| `/api/notifications` | GET | Delivered/pending, per-user | Session | as-built (5.6A) |
| `/api/data-changes` | GET | `data_change_log` scan | Authenticated — market data is workspace-level (`fact_market_observation` carries no project binding) | as-built (5.7B) |
| `/api/reports/:run_id` | POST | Generate deliverable (docx/pdf/hwpx) — staleness gate blocks if inputs exceed `ttl_days` | Membership | forward-design |
| `/api/glossary/:term` | GET | Glossary lookup (also backs UI tooltip, MCP `lookup_term`) | Public within the workspace | as-built (5.6A) |

## 8. Admin Console (Never MCP-Exposed)

| Endpoint | Method | Purpose | Access Control |
|---|---|---|---|
| `/api/admin/users` | GET/PUT | User management | `admin` role — **still cannot see project data via this endpoint** |
| `/api/admin/data-sources` | GET | API key presence/last-success only, **never the key value** | `admin` role |
| `/api/admin/schedule-jobs` | GET/PUT | `job_run` history, retry | `admin` role |
| `/api/admin/audit-log` | GET | Read-only, no delete endpoint exists at any privilege level | `admin` role |
| `/api/admin/retention` | GET/POST | Retention policy management | `admin` role |

## 9. Response Envelope and Error Contract

```json
{
  "data": { ... },
  "meta": { "as_of": "...", "run_id": "...", "policy_version": "..." },
  "error": null
}
```

Every numeric figure in `data` that traces to an `assumption` carries its `assumption_key`, `as_of`, `source`, and `anchor_ref` in `meta` — this is the API-level realization of FR-SYS-03 (UI source tooltips read directly from this envelope, no separate lookup).

## 10. Rate Limiting and Abuse Prevention

- MCP write-scoped tools (marked ✱ in design §4-11) are rate-limited per token, independent of the web session limits.
- `safeFetch()` (FR-DATA-06) applies to any endpoint that triggers an outbound fetch (e.g. `watch:run`-adjacent manual-trigger endpoints), preventing SSRF via a crafted `source` override.

## 11. Related

- `docs/mcp-integration.md` — the MCP tool catalog built on top of this API
- `docs/ui-spec.md` — the frontend consuming this API
- `docs/security-model.md` — the threat model this access-control design defends against
