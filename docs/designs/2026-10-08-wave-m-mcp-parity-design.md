---
title: Wave M — MCP Parity (remote transport, OAuth 2.1, full-stage tools, proposal-only decisions)
status: approved
date: 2026-10-08
owner: platform-lead
contributors: security-engineer (threat model review), backend-engineer (implementation), frontend-engineer (confirmation page)
related_adrs: [ADR-0154 (accepted)]
---

# Wave M — MCP Parity Design

> Pre-approved by the user in chat on 2026-10-08. ADR-0154 is Accepted on the same basis.

## 1. Context

The co-newbiz MCP server (`mcp/co-newbiz/index.ts`) is stdio only. It authenticates with one personal API token (`CO_NEWBIZ_API_TOKEN`) through `mcp/co-newbiz/shared/rest-client.ts`, which calls the web REST API. It exposes 19 tools, and only 3 of them write: `create_opportunity`, `create_route_decision`, and `record_gate_decision`. The web app has about 214 API routes. As a result, an agent working over MCP cannot carry a deal through S1–S12 (`process/flow.spec.yaml`).

There are two client families:

- **Local CLIs** (Claude Code, Codex, Gemini CLI) use stdio.
- **Hosted chat clients** (ChatGPT connectors, Claude.ai web connectors, the Gemini app) need a remote HTTPS MCP endpoint using Streamable HTTP with OAuth.

Wave F added typed closure (`POST /close`; agents must not close), the review engine (reviews routes, AI 2nd on demand), RAG recompute, and the PMI kickoff (human only). Wave M must respect these additions.

Binding constraints:

- **Boundary #1.** Agents inherit the calling user's permissions and have no accounts of their own.
- **Boundary #2.** Gate approval and decisions are human-only. Agents produce proposals only.

## 2. Goals and Non-goals

**Goals**
1. Add a remote Streamable HTTP transport at `/api/mcp` and keep stdio.
2. Add an in-app OAuth 2.1 authorization server whose tokens are delegated by, and bound to, a human user.
3. Provide write, generate, review, and proposal tools for every flow.spec activity in S1–S12, enforced by a coverage script.
4. Decision tools only record proposals. A human confirms each proposal in a web session.
5. Add MCP prompts (per-stage work guides) and resources (glossary).
6. Add a parity test showing that the REST path and the MCP path reach the same `evaluateProcess` result.

**Non-goals**
- Tool logic that duplicates route handlers. Tools are thin wrappers.
- Agent service accounts or machine-to-machine (client-credentials) grants.
- Exposing closure, PMI kickoff, or approval execution over MCP in any form.
- Federated identity providers. Login stays on the existing accounts table.

## 3. Transport

### 3.1 Shared tool registry
- Move tool definitions out of `index.ts` into `mcp/co-newbiz/registry.ts`. Each entry is `{ name, scope, kind, stageActivities[], inputSchema (Zod), handler(ctx, input) }`, where `kind` is one of `read`, `write`, `generate`, `review`, or `propose`.
- Handlers call a `RestPort` interface. Two implementations exist:
  - `HttpRestPort`: the existing `rest-client.ts`, used by stdio with a bearer token.
  - `InProcessRestPort`: invokes the Next.js route handler functions directly with a synthetic `Request` that carries the delegated principal. This port is used by `/api/mcp` and by the parity test. It avoids a network hop and guarantees that the same route code runs.
- Both transports register the same tools, prompts, and resources. Parity between them is structural.

### 3.2 Streamable HTTP endpoint
- `app/web-next/app/api/mcp/route.ts` handles `POST` (JSON-RPC, responding with JSON or SSE), `GET` (SSE stream for server notifications and elicitation), and `DELETE` (session end), following the MCP Streamable HTTP spec.
- `Mcp-Session-Id` is issued at initialize and bound to the token's `user_id` and `client_id`. A request whose session belongs to a different principal is rejected with 404.
- The endpoint validates the `Origin` header against an allowlist (DNS-rebinding defense). It is HTTPS only in production.
- Unauthenticated requests receive `401` with `WWW-Authenticate: Bearer resource_metadata=".../.well-known/oauth-protected-resource"` (RFC 9728).
- Stdio (`mcp/co-newbiz/index.ts`) is unchanged for clients. Internally it switches to the shared registry.

## 4. OAuth 2.1 Authorization Server

### 4.1 Endpoints (in the web app)
| Endpoint | Purpose |
|---|---|
| `/.well-known/oauth-authorization-server` | RFC 8414 metadata |
| `/.well-known/oauth-protected-resource` | RFC 9728 metadata for `/api/mcp` |
| `/api/oauth/register` | RFC 7591 dynamic client registration (needed by ChatGPT and Claude.ai connectors) |
| `/oauth/authorize` | Consent page (human web session required) |
| `/api/oauth/token` | `authorization_code` + PKCE (S256 only) and `refresh_token` grants |
| `/api/oauth/revoke` | RFC 7009 revocation |

### 4.2 Rules
- **PKCE is mandatory** (S256). The implicit and password grants do not exist. `client_credentials` is not supported, because it would create an agent principal and violate boundary #1.
- **Bound to the user.** An authorization code can be issued only to a logged-in human session. Every token row carries `user_id`, and the effective permission is the intersection of the user's current permissions and the granted scopes, evaluated on every request. If the user is deactivated or loses project access, the next call fails.
- **Scopes:** `read`, `propose`, and `write`. `write` implies neither of the others. Consent shows each scope in plain language. `propose` covers decision proposals only. No scope executes a decision.
- **TTL:** access tokens last 15 minutes. Refresh tokens last 7 days, rotate on every use, and use reuse detection: a replayed refresh token revokes the whole token family.
- **Redirect URIs** must match exactly. Dynamically registered clients may register only `https` URIs or loopback `http` URIs. Registered clients start as `unverified`, and the consent page shows that status. An admin can pin an allowlist of client names or domains through config.
- **Resource indicators** (RFC 8707): tokens are audience-bound to `/api/mcp`. Tokens are not accepted by the general REST API, and REST tokens are not accepted by `/api/mcp`, except for the existing personal API token used by stdio.
- **Audit:** every issue, refresh, revoke, and tool call writes to the existing audit log with `user_id`, `client_id`, `token_family_id`, tool name, scope, and result. Arguments are hashed rather than stored.
- **Revocation UI:** an "Connected apps" section in account settings lists clients with their last use and offers revoke.

### 4.3 Reuse of existing infrastructure
- Extend the existing `api_tokens` table additively with `kind` (`personal|oauth_access|oauth_refresh`), `client_id`, `scopes`, `family_id`, `audience`, `expires_at`, and `revoked_at`. Store hashes only, as today.
- Add one new table, `oauth_client` (client_id, name, redirect_uris, registered_by_user_id nullable, verified, created_at), and one short-lived table, `oauth_code` (hash, user_id, client_id, pkce_challenge, scopes, expires_at ≤ 60s, consumed_at).
- Personal API tokens remain valid for stdio. They gain an optional `scopes` value, and existing rows default to `read write` for backward compatibility. Their use of `propose` is covered by the migration in §6.4.

## 5. Tool Coverage

### 5.1 Principle
Every tool wraps an existing REST route through `RestPort`. A tool may compose several route calls (for example, fetching the evaluation and then posting an artifact), but business validation lives only in route handlers and repositories. When a route is missing for a spec activity, the route is added in the web app first, and the tool then wraps it.

### 5.2 Coverage map (summary)
| Stage | Representative tools (kind) |
|---|---|
| S1 | `create_opportunity` (write), `record_market_sizing` (write), `generate_market_sizing_draft` (generate), `request_review` (review) |
| S2–S3 | `upsert_strategic_fit`, `record_capability_list` (write), `propose_route_decision` (propose) |
| S4–S5 | `record_case`, `generate_case_comparison` (write/generate), `propose_case_adoption` (propose) |
| S6–S7 | `add_candidate`, `record_candidate_screening` (write), `propose_target_selection` (propose) |
| S8–S10 | DD workspace item writes, `record_dd_finding`, `record_assumption`, `run_rag_recompute` (generate), `get_project_ic_package` (read) |
| S11 | `propose_gate_decision`, `propose_approval` (propose); PMI planning drafts (write). PMI kickoff is not exposed. |
| S12 | `record_learning`, `propose_transition_decision` (propose). Close is not exposed. |
| All | `request_review` (runs AI 1st, and AI 2nd on demand), `get_review_buckets`, `get_process_evaluation`, `get_proposal_status` |

The exhaustive mapping lives in the registry's `stageActivities[]` metadata, not in this document.

### 5.3 Coverage script
`scripts/co-newbiz/mcp-coverage.ts` loads `process/flow.spec.yaml` and the registry. It fails (exit 1) when any S1–S12 activity or `requiredArtifacts` entry has no tool whose `stageActivities` includes it, or when a registry entry references an unknown activity. An explicit `mcp-coverage.exclusions.yaml` lists the human-only items (closure, PMI kickoff, approval execution) with a reason, and the script also fails if an excluded item gains a tool. The script runs in `bun scripts/audit.ts` and in CI.

## 6. Proposal-only Decisions (Boundary #2)

### 6.1 Decision tools
Gate decisions, route decision, case adoption, target selection, transition decision, and approvals are exposed only as `propose_*` tools (scope `propose`). Closure (`POST /close`) and PMI kickoff have no tool at all.

### 6.2 Proposal record
Add a new table, `decision_proposal`: id, kind, project/opportunity keys, stage_id, payload_json (Zod-validated against the target route's input schema), rationale, evidence_refs, proposed_by_user_id, via_client_id, status (`pending|confirmed|rejected|expired|superseded`), confirm_token_hash, expires_at (72h), confirmed_by_user_id, confirmed_at, and resulting_record_id.

A proposal never writes `gate_decision`, `approval`, `route_decision`, `venture_transition_decision`, or closure rows. Repository guards and an import-graph test enforce this, reusing the ADR-0153 pattern.

### 6.3 Confirmation
1. The tool returns `{ proposal_id, confirm_url, status: "pending" }`. The URL is `/proposals/{id}/confirm`. It carries no token in the query string; access is checked against the web session.
2. If the client supports **MCP elicitation**, the server additionally sends an elicitation that shows the summary and the confirm URL. The elicitation response itself never executes the decision. It only says that the user intends to open the link, because an elicitation answer comes through the agent's client and cannot prove a human web session.
3. The human opens the confirmation page in their own logged-in web session. The page shows the payload, rationale, evidence, review buckets (verified / could not verify / needs judgement), and the gate RAG grade. The human can edit, then confirm or reject.
4. On confirm, the web session (not the token) POSTs to the existing decision route. The route records `confirmed_by_user_id` as the decider and links `resulting_record_id`. Normal role checks apply. A confirmer who lacks gate authority gets 403 even though the proposer had `propose` scope.
5. Self-confirmation, where the proposer and confirmer are the same user, is allowed only when the underlying route already allows that user to decide. The proposal does not change who may decide.

### 6.4 Breaking change: `record_gate_decision`
- In M-2, `record_gate_decision` is **removed** and replaced by `propose_gate_decision`. `create_route_decision` is likewise replaced by `propose_route_decision`.
- **Migration:** for one release, the old names stay registered as deprecated aliases. They create a proposal and return a `deprecation` notice with the confirm URL, so they never write the decision directly. The aliases are deleted in the following release. CHANGELOG, `mcp/co-newbiz/README.md`, and the skills that mention the old tools are updated in M-2. Existing `gate_decision` rows are unaffected. The personal API token path follows the same rule; there is no direct-write exception for stdio.

## 7. Prompts and Resources

- **Prompts:** `stage_guide_s1` … `stage_guide_s12`. Each prompt is generated from `flow.spec.yaml` at load time. It names the stage, lists the activity keys, required artifact keys, and procedure keys, and maps each item to its tool name. It never restates procedure steps; it tells the agent to call `get_procedure` for them (boundary #3).
- **Resources:** `glossary://term/{key}` and `glossary://index` serve the glossary through the same path as `lookup_term`. `flowspec://stage/{id}` serves the read-only spec slice.

## 8. Parity Test

`tests/integration/mcp-parity.test.ts`:
1. Seed two identical fixture deals (Green Field, plus one Brown Field M&A variant).
2. **REST path:** drive S1→S12 with direct route calls as the human fixture user.
3. **MCP path:** drive the same scenario through an in-process MCP client (SDK `InMemoryTransport`) connected to the server built on `InProcessRestPort` with a delegated OAuth token. Each `propose_*` call is followed by a simulated human confirmation: the test calls the confirm route with the human's session, not the token.
4. Assert that `evaluateProcess` results are deep-equal, ignoring ids and timestamps, at each stage boundary and at the end. Also assert that the MCP path left no decision row whose decider is null or not the human, and that zero close rows came from a token principal.
5. Negative cases: a `propose`-scope token calling the confirm route gets 403; a `read`-scope token calling a write tool gets an `insufficient_scope` error; and the excluded tools are absent from `tools/list`.

## 9. PR Split

| PR | Content | Exit criteria |
|---|---|---|
| M-1 | Shared registry + `RestPort`; `/api/mcp` Streamable HTTP; OAuth AS (metadata, DCR, authorize/consent, token, revoke); `api_tokens` extension + `oauth_client`/`oauth_code` migrations; connected-apps UI | Existing 19 tools work on both transports; OAuth conformance tests pass; Claude.ai connector smoke test passes |
| M-2 | Full-stage tools; missing REST routes; `decision_proposal` + confirmation page; `record_gate_decision` deprecation alias; `mcp-coverage.ts` | Coverage script green; decision-guard tests green; a11y check of the confirm page passes |
| M-3 | Prompts and resources; parity test; docs | Parity test green on both fixtures |

Each PR is sequential (CONSTITUTION §3.3) and goes through `/sync`.

## 10. Security Threat Model

| Threat | Mitigation |
|---|---|
| **Token theft** (leaked bearer, logs, client compromise) | 15-minute access TTL; rotating refresh tokens with family revocation on reuse; hashed storage; audience binding to `/api/mcp`; tokens never in URLs or logs; per-token rate limits; connected-apps revoke; anomaly alerts (new IP or ASN) to SRE |
| **Prompt injection via tool outputs** (deal documents, notes, or web data steering the agent) | Tool outputs wrap untrusted text in labelled `untrusted_content` fields; no tool output can trigger a decision, because decisions need a human web confirmation; the confirmation page shows the full payload, so an injected change is visible; write tools validate against Zod and project scope |
| **Confused deputy** (the server acting with more authority than the calling user, or one client acting for another) | Every call is evaluated as the token's `user_id` against live permissions; there are no agent accounts and no server-side elevated credential; `InProcessRestPort` passes the principal and never a system role; sessions are bound to the user and client; the confirm route uses the session cookie only and rejects bearer auth |
| **Scope escalation** (getting write or decision power from a narrower grant) | Scopes are checked per tool in the registry and again at the route; refresh cannot widen scopes; DCR clients cannot pre-grant scopes; there is no decision-executing scope; the coverage script blocks new tools on excluded items |
| **Malicious DCR client / phishing consent** | Unverified badge, exact redirect match, optional admin allowlist, consent shows client name, redirect host, and scopes |
| **CSRF on consent and confirm** | SameSite=Lax cookies, CSRF token, `Origin` check, POST-only state changes |
| **DNS rebinding** against `/api/mcp` | `Origin` allowlist, HTTPS only |
| **Direct decisions over the remote transport before M-2** (the legacy `record_gate_decision` / `create_route_decision` write decision rows directly) | The registry marks them `legacyDirectDecision`; the HTTP transport never lists or runs them. They stay on stdio only until M-2 replaces them with `propose_*` aliases (§6.4) |
| **Authorization-code interception or replay** | Codes are single use, expire in ≤ 60s, and are bound to client, exact `redirect_uri`, PKCE challenge, and resource. A failed redemption burns the code, and a replayed code revokes the token family it produced (OAuth 2.1 §4.1.3) |
| **Open redirect from the authorize endpoint** | Errors are sent to `redirect_uri` only after the client and the exact `redirect_uri` match. Otherwise the error is shown locally |
| **Authorization-server mix-up** | The authorization response carries `iss` (RFC 9207), and the metadata advertises it |
| **Clickjacking or Referer leakage on consent** | `/oauth/*` and the connected-apps page send `X-Frame-Options: DENY`, `frame-ancestors 'none'`, and `Referrer-Policy: no-referrer` |
| **Agent self-consent** (a bearer token approving its own client) | The consent API accepts only the human's cookie session with Origin and CSRF double-submit checks. Bearer-authenticated consent is refused (403) |
| **Host-header issuer or audience spoofing** | `CO_NEWBIZ_PUBLIC_ORIGIN` pins the issuer and resource. Production must set it. The request-derived fallback is for local development only |
| **In-process principal forgery** (`InProcessRestPort`) | The delegated principal travels in an `AsyncLocalStorage` scope that only `InProcessRestPort` enters. There is no header or cookie form, so the general REST API still rejects OAuth tokens |
| **Session hijack or exhaustion** (`Mcp-Session-Id`) | Sessions are bound to `(user_id, client_id)`, and a mismatch returns 404. Sessions close after 30 minutes idle, with at most 10 per user and 1000 in total |
| **DCR abuse** (registration spam, confidential or machine clients) | Registration is rate-limited per IP (20 per hour). Only `token_endpoint_auth_method=none` clients with `authorization_code`/`refresh_token` grants are accepted. Names and URIs are length-capped. An optional redirect-host allowlist is available (`CO_NEWBIZ_OAUTH_REDIRECT_HOST_ALLOWLIST`) |
| **Role drift after grant** | Effective scopes are recomputed on every request as granted ∩ role-allowed. Viewer and admin get `read` only. A deactivated user's next call fails, and a refresh by a deactivated user revokes the family |

**M-1 review notes (security-engineer, 2026-10-08).** The rows from "Direct decisions over the remote transport" onward were added in the M-1 review. The following items are still open and need a human security review before production exposure:
- Rate-limit, session, and DCR counters are in-memory and per process. A multi-instance deployment needs a shared store.
- The anomaly alerts for a new IP or ASN (Token theft row) are not implemented in M-1. They are an SRE follow-up.
- Unverified DCR clients are never purged. A retention job is a follow-up.
- Access tokens remain valid for up to 15 minutes after a refresh-token rotation (not after revocation, which is immediate). This is accepted by design.

security-engineer reviews this model before M-1 merges. Per CLAUDE.md, the auth model cannot pass on AI review alone.

## 11. Accessibility (confirmation and consent pages)

- Both pages are built from Onyx 3.0 shared components and pass `design:lint`.
- The page has one primary action ("Confirm decision"). "Reject" is secondary, and "Edit" opens inline fields. No action fires on page load.
- Keyboard: a logical tab order, focus on the heading on load, visible focus rings, and no keyboard traps.
- Screen readers: landmark regions; the proposal summary is a definition list; the review buckets are headed lists; status changes are announced through `aria-live="polite"`.
- RAG grades and statuses carry text labels as well as color (WCAG 1.4.1). Contrast is at least 4.5:1.
- Expired or already-handled proposals show a clear text state with no active buttons.
- Target: WCAG 2.1 AA, checked with axe-core in CI.

## 12. Risks

| Risk | Mitigation |
|---|---|
| Connector OAuth quirks differ between ChatGPT, Claude.ai, and Gemini | Conformance test per client in M-1; follow MCP auth spec strictly |
| Breaking `record_gate_decision` disrupts existing agent workflows | One-release alias that creates a proposal; changelog and README notice |
| Proposal backlog: humans ignore pending proposals | 72h expiry; notifications through the existing notification route; pending count on the dashboard |
| Missing REST routes inflate M-2 | The coverage script lists gaps first; route additions are scoped per stage |
| In-process port drifts from HTTP semantics | Both ports run the shared contract test suite |

## 13. Verification

- `bun scripts/audit.ts`, typecheck, and unit tests.
- `bun scripts/co-newbiz/mcp-coverage.ts` exits 0.
- OAuth tests: PKCE required, wrong verifier rejected, refresh reuse revokes family, revoked token rejected, audience mismatch rejected, deactivated user rejected.
- Decision-guard tests: no `propose_*` path writes decision tables; close and PMI kickoff are absent from `tools/list`.
- Parity test green (§8).
- The DB schema change is covered by ADR-0154.

## 14. Preview Verification

1. Start the web app through `.claude/launch.json` and open the Browser pane.
2. Fetch `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource`, and check the fields.
3. Run the MCP Inspector against `http://localhost:<port>/api/mcp`: complete DCR, consent, and token; list tools; and call a read tool.
4. Call `propose_gate_decision` on a fixture project and open the returned confirm URL in the browser. Check the payload, buckets, and RAG label; check keyboard-only navigation and an axe scan; then confirm and verify that the gate decision row shows the human as decider.
5. Revoke the client in Connected apps and check that the next tool call returns 401.

## 15. M-2 implementation notes (backend-engineer, 2026-10-08)

Differences between this design and what M-2 shipped, recorded so reviewers do not have to rediscover them:

- **Approval proposals cover three human acts, not one.** Three routes stamp a `human_final` review of a stage artifact: charter confirmation (S11), a DD checklist judgment (S9), and four-axis completion (S10). If an agent ran them through its delegated identity, an AI action would be recorded as the human's final review. They are therefore `propose_approval` with subject `charter_baseline`, `dd_checklist_judgment`, or `four_axis_completion`, and the in-process port refuses the underlying routes. `record_deal_structure` refuses the `complete_four_axis` action for the same reason.
- **Further human-only routes found while mapping tools** (all in `mcp-coverage.exclusions.yaml`, refused by `HUMAN_ONLY_ROUTES`): synergy score confirmation, Short List re-ranking, waiver decisions, DD tailoring item review, and opportunity promotion. S3 "synergy assessment" is covered by `start_synergy_analysis` (the recommendation); S7 "Target Ranking/Score" by `record_candidate_screening` (the computed scores).
- **Tool inputs.** Route tools take path ids plus an opaque `body` object that the route validates, rather than re-declaring every route field. This keeps the tools free of duplicated validation (design §5.1) at the cost of less self-describing input schemas; each tool's `body` description names the route contract.
- **`record_learning` is not a separate tool.** The S12 learning capture is a field of the transition decision (`propose_transition_decision`), and no other route records it.
- **`confirm_token_hash`** is used as a single-use confirm nonce that only the cookie-session confirm view can obtain, so a proposal cannot be confirmed without its payload first being served to a human session. Edits at confirm time are stored in `confirmed_payload_json` next to the proposed `payload_json`.
- **`propose` scope on REST.** A propose-only token maps to REST scope `write` for exactly `POST /api/proposals` and nowhere else (`lib/auth.ts` `restScopesFor`).
- **Audit hook.** `scripts/audit.ts` is core and unchanged; the coverage gate runs through the variant hook probed at `scripts/co-newbiz/audit-variant.ts` (audit §27).
- **Left for M-3:** prompts, resources, and the parity test (design §7, §8), and the REST/MCP parity of `evaluateProcess`.
