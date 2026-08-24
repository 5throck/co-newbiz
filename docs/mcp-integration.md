# MCP Integration — co-newbiz

**Owner**: backend-engineer
**Design of record**: design v1.0 §4-11 (task 4.4), ADR-0011
**Status**: `mcp/co-newbiz/` is implemented and running (Stage 5 Waves 5.7A/5.7B + engine-1/2), following the `Projects/co-architect/mcp/` pattern (`@modelcontextprotocol/sdk` + stdio, `index.ts` + `tools/*.ts` + `shared/{logger,errors,rate-limiter,retry,types}.ts`). **39 of the catalog tools below are live**: Wave 5.7A shipped the 11 behind the Wave 5.6A REST surface; Wave 5.7B wired every tool whose backing endpoint is a plain membership-filtered table read (`tools/analysis.ts`: `search_series`, `get_observations`, `list_data_changes`, `get_assumptions`, `set_assumption`✱; `tools/deal-review.ts`: `list_dd_findings`, `get_rbd_source_profile`, `add_dd_finding`✱, `get_antitrust_assessment`, `get_incentive_exposure`, `get_liability_exposure`, `compare_sites`, `list_partner_candidates`, `list_regulatory_requirements`, `get_permit_path`, `get_value_chain_linkage`); the engine-1 run-versioning wave added `compare_runs` (`tools/analysis.ts`) over the new runs REST surface — the variable-level bridge, with NPV-level decomposition explicitly deferred until a valuation engine exists; the engine-2 simulations wave added `run_simulation`✱ (`tools/analysis.ts`) over `POST /api/simulations` — the Monte Carlo engine spawn lives REST-side (`db/lib/simulation.ts`: scenario composed from the run's `sim.*` inputs + the project's contingent liabilities, args-array spawn, quantile summary persisted), so this relay stays a thin write wrapper. The ADR-0063 Class C wave added eight (`tools/pmi.ts`): `list_key_talent` / `add_key_talent`✱ / `list_synergy_certifications` / `add_synergy_certification`✱ / `list_deal_shape_evaluations` / `add_deal_shape_evaluation`✱ / `list_incentive_deadlines` / `add_incentive_deadline`✱ over the `app/server/pmi.ts` surfaces — money fields are INTEGER KRW millions (ADR-0061). Still deferred, because their engines run through the CLI (`newbiz.ts`) and need an async job/analysis surface rather than a synchronous REST handler: `get_financial_analysis`, `get_peer_benchmark`, `get_projection`, `get_proxy_chain`, `calibrate_chain`✱, `get_customer_risk`, `get_compensation_gap`, `run_model`✱, `generate_report`✱, `export_report` (see `docs/co-newbiz.context.md`'s remaining-gaps note). The ADR-0066 Phase C wave added two (	ools/structure.ts): un_structure_simulation✱ / get_structure_simulation_results over the structure-simulation REST surface.

## 1. Non-Negotiable Design Rule

**The MCP server calls the REST API exclusively — it never opens a direct database connection** (ADR-0011, FR-SYS-01). Every permission check, audit log entry, and `mnpi_flag` exclusion is enforced once, at the REST layer, so no AI client can bypass it through a shorter code path. `mcp/co-newbiz/`'s `package.json` must have zero DB-client dependency — this is a Stage 5 dependency-graph gate, not just a design intention.

## 2. Authentication

Bearer API token (same token type as CLI access), scope-limited, hashed at rest. `mnpi_flag=true` projects are excluded from MCP tool responses **by default** — a scoped token with an explicit MNPI grant is required to override, and that access is itself logged to `data_access_log` and reflected in the project's `insider_list` (FR-SEC-06/SYS-02).

## 3. Tool Catalog

### Read-Only

| Tool | Purpose |
|---|---|
| `list_projects` | Membership-filtered project list |
| `get_project_status` | Status summary, current RAG grade |
| `get_rag_assessment` | Full six-dimension breakdown + rationale |
| `list_notifications` | Caller's pending/recent notifications |
| `lookup_term` | Glossary lookup — backs UI tooltip and this same call |
| `get_procedure` | Merged procedure result (`proc:resolve` equivalent) |
| `search_series` / `get_observations` | Market/industry data queries |
| `list_data_changes` | `data_change_log` scan |
| `get_financial_analysis` / `get_peer_benchmark` / `get_projection` | Financial pipeline outputs |
| `get_assumptions` | Assumption registry read |
| `get_proxy_chain` | Chain detail with reliability grade |
| `compare_runs` | Version-diff bridge |
| `get_value_chain_linkage` | Six-axis value-chain data (separate table from proxy chain — ADR-0025) |
| `get_antitrust_assessment` | HHI, remedy type, discharge status |
| `get_customer_risk` | Change-of-control clause findings |
| `get_incentive_exposure` | Acquisition/clawback unified view |
| `get_compensation_gap` | Aggregate-only comp benchmark (never individual rows) |
| `get_liability_exposure` | Contingent liability / covenant test summary |
| `get_approval_chain` | Entity/Group IC status |
| `get_compliance_status` | Gate-blocking status |
| `list_waivers` | Active/expired waiver list |
| `search_interpretations` | Interpretation registry search |
| `compare_sites` | Site-candidate comparison table |
| `list_partner_candidates` | Partner screening results |
| `list_regulatory_requirements` / `get_permit_path` | Permit DAG queries |
| `list_dd_findings` | DD finding list, including `category='rbd'` fields |
| `get_rbd_source_profile` | R&BD-specific: `rbd_source`, TRL grade, commercialization-path decision, originator-relationship shape (new — added alongside the R&BD checklist extension) |

### Write (✱ — scoped, audited)

| Tool | Purpose |
|---|---|
| `manage_watch` ✱ | Create/update a monitoring subscription |
| `set_assumption` ✱ | Write an assumption — `kind='assumed'` requires non-empty `rationale`, rejected server-side otherwise |
| `calibrate_chain` ✱ | Trigger proxy-chain recalibration |
| `run_model` ✱ | Execute a valuation model run |
| `run_simulation` ✱ | Execute a Monte Carlo run (seeded) |
| `add_dd_finding` ✱ | Add a DD finding with `value_impact` |
| `generate_report` ✱ | Trigger deliverable generation — subject to the staleness gate |
| `export_report` | Export a generated report to docx/pdf/hwpx |

**Explicitly never MCP-exposed**: user management, database administration, batch/schedule management, regulation/procedure authoring, master-data correction — all admin-console-only (design §4-11).

## 4. Client Registration

| Client | Config Location |
|---|---|
| Claude Code | project `.mcp.json` |
| Claude Desktop | `claude_desktop_config.json` → `mcpServers` |
| Antigravity / Gemini CLI | `.gemini/settings.json` |
| Codex App / CLI | `~/.codex/config.toml` → `[mcp_servers.*]` |

Common stdio command, all clients: `{"command":"bun","args":["run","--env-file",".env","./mcp/co-newbiz/index.ts"],"timeout":300000}` — one server binary covers every client since all support stdio (design §4-11).

## 5. Rate Limiting and Retry

`shared/rate-limiter.ts` applies per-token limits independent of web-session limits (write-scoped tools get a tighter budget than read tools). `shared/retry.ts` wraps outbound REST calls with backoff; a persistent 403 (membership/MNPI denial) is never retried — it is a terminal response, not a transient failure.

## 6. OpenAPI as SSOT

Per design §4-11, the same `openapi.yaml` that documents `docs/api-spec.md`'s REST surface is the source MCP tool definitions are generated or validated against — a tool exposed here without a matching REST endpoint (or vice versa) is a Stage 5 CI failure, not a silent drift. `docs/openapi.yaml` (OpenAPI 3.1) documents the as-built REST surface, and `tests/unit/openapi.test.ts` makes the REST half of that equality executable: it asserts set equality between the spec and the `app/server/*.ts` route declarations in both directions.

## 7. Verification (Design §12 Forward Reference)

- Tool call → REST call → `audit_log` entry, for every tool, including read-only ones.
- A scoped token without write permission attempting a ✱ tool → rejected, logged.
- `mnpi_flag=true` project → absent from `list_projects`/`search_*` results for a token without the explicit MNPI grant.
- At least one real call succeeds from each of Claude Desktop, Antigravity, and Codex CLI before this integration is considered complete.

## 8. Related

- `docs/api-spec.md` — the REST surface this server proxies
- `docs/security-model.md` — threat model covering MCP-specific risks (token leakage, scope escalation)
