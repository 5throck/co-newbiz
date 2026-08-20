# API Specification — co-newbiz

**Owner**: backend-engineer, data-architect
**Design of record**: design v1.0 §4-11 (task 4.4), `docs/srs.md` §12, `docs/db-schema.md`
**Status**: Endpoint catalog and access-control contract — implemented Stage 5 Wave 5.6 (`app/server/*.ts`: `admin.ts`, `auth.ts`, `envelope.ts`, `glossary.ts`, `governance.ts`, `monitoring.ts`, `projects.ts`, `tokens.ts`). OpenAPI 3.1 is the SSOT for MCP tool definitions (design §4-11) — **`openapi.yaml` itself has not been generated yet**, so this document remains the only human-readable index; that gap is separate from (and does not block) the REST API being live.

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

| Endpoint | Method | Purpose | Access Control |
|---|---|---|---|
| `/api/projects/:id/runs` | GET/POST | List/create analysis runs | Membership |
| `/api/runs/:id` | GET | Run detail (`run_input` snapshot, `input_hash`) | Membership on `run.project_id` |
| `/api/runs/:id/diff/:other_id` | GET | Version-comparison bridge | Membership |
| `/api/assumptions` | GET/POST | Assumption registry entries | Membership; `kind='assumed'` write requires non-empty `rationale` |
| `/api/proxy-chains/:id` | GET | Chain detail with per-hop reliability grade | Membership |
| `/api/proxy-chains/:id/calibrate` | POST | Recalibration trigger | `quant-methodologist` role |
| `/api/simulations` | POST | Monte Carlo run (seeded) | Membership |
| `/api/simulations/:id/results` | GET | Quantile summary (`simulation_result`) — raw draws not exposed after archival (retention_policy) | Membership |

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

| Endpoint | Method | Purpose | Access Control |
|---|---|---|---|
| `/api/projects/:id/dd-findings` | GET/POST | `dd_finding` records, including `category='rbd'` fields | Membership |
| `/api/projects/:id/antitrust` | GET | HHI/remedy-type/discharge-status | Membership |
| `/api/projects/:id/contingent-liabilities` | GET/POST | Feeds Monte Carlo | Membership |
| `/api/projects/:id/management-package` | GET | **`executive_ref` only, never a real name** (FR-MA-06/SEC-05) — response schema has no name field to accidentally populate | Membership + elevated role (compensation data) |
| `/api/projects/:id/comp-benchmark` | GET | Aggregate-only rows | Membership + elevated role |
| `/api/projects/:id/sites` | GET | `site_candidate` comparison table | Membership |
| `/api/projects/:id/permits` | GET | Permit DAG with critical path | Membership |
| `/api/projects/:id/incentives` | GET/POST | Unified acquisition/clawback record | Membership |
| `/api/projects/:id/partners` | GET/POST | Partner candidate screening | Membership |

## 7. Monitoring, Notifications, Reports

| Endpoint | Method | Purpose | Access Control |
|---|---|---|---|
| `/api/watch` | GET/POST/DELETE | User subscriptions | Session (own subscriptions only) |
| `/api/notifications` | GET | Delivered/pending, per-user | Session |
| `/api/data-changes` | GET | `data_change_log` scan | Membership on affected projects |
| `/api/reports/:run_id` | POST | Generate deliverable (docx/pdf/hwpx) — staleness gate blocks if inputs exceed `ttl_days` | Membership |
| `/api/glossary/:term` | GET | Glossary lookup (also backs UI tooltip, MCP `lookup_term`) | Public within the workspace |

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
