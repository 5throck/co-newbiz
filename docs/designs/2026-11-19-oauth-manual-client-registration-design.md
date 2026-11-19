---
lang: en
date: 2026-11-19
status: proposed
owner: backend-engineer (design), pm (dispatch)
related: docs/designs/2026-11-18-mcp-guides-design.md, docs/architecture/mcp-integration.md, docs/architecture/api-spec.md, ADR-0011, ADR-0154
spec: oauth-manual-client-registration
---

# Design — Manual OAuth Client Registration and DCR Refusal Audit

## Problem

Creating a ChatGPT connector against `https://<APP_HOST>/api/mcp` with the default Dynamic Client Registration (DCR) failed with HTTP 403 on `POST /api/oauth/register`. `<APP_HOST>` is the host the environment is served from; it must equal the host in `CO_NEWBIZ_PUBLIC_ORIGIN`, so read it from that environment's `CO_NEWBIZ_PUBLIC_ORIGIN` value.

- `app/web-next/app/api/oauth/register/route.ts` never returns 403. Its only refusals are 400 (`invalid_client_metadata`, `invalid_redirect_uri`) and 429 (per-IP limit, 20/hour). The 403 therefore most likely comes from the edge (Cloudflare WAF or bot rules in front of the tunnel), not from the application.
- Today a refused DCR leaves no trace: `registerClient()` (`db/lib/oauth.ts`) writes an `oauth_client_register` audit row only on success, and the route's 400/429 branches write nothing. We cannot prove from our own data where a 403 originated.
- Many MCP hosts (ChatGPT "user-defined OAuth client", others) let a human enter a client id instead of using DCR, but the server has no way to mint one for a signed-in person.

## Decision

1. Add a human-only manual registration path that reuses the existing registration engine (`registerClient`, which already accepts `registeredByUserId` and today is never given one).
2. Add a UI form on Connected Apps to use it.
3. Audit every DCR refusal (reason code only, no secrets) so that "no audit row for the request" is positive evidence that the edge blocked it.
4. Document the ChatGPT steps and the Cloudflare skip rule.

Scope update (user, 2026-11-19): the primary goal is that DCR itself works for hosted clients (ChatGPT, Claude.ai). Manual registration is a fallback, not the main fix. Section 3 (refusal audit) and section 3b (DCR conformance) are therefore the primary work; sections 1-2 (manual registration API and UI) are the secondary, fallback track.

## Boundaries honoured

- Boundary #1 (no agent accounts): the endpoint requires the human's own cookie web session; a bearer token (personal API token, OAuth access token) is refused, exactly like `/api/oauth/authorize`. The new client is attributed to that person (`registered_by_user_id`), never to a service identity.
- Boundary #2 (humans decide): registering a client grants no data access. The registrant must still pass the consent screen for the client, and scopes remain capped by role (`allowedScopesForRole`). Clients stay `verified = 0` (admin pins are unchanged).
- ADR-0011: no change to the MCP package; the REST layer remains the only door.

## 1. API

### `POST /api/oauth/clients` (new)

`app/web-next/app/api/oauth/clients/route.ts`, same auth contract as authorize (`authenticate()` then `via === "cookie"`, else `403 session_required`). POST also gets authenticate()'s Origin + CSRF double-submit checks.

Request body (JSON): `{ "client_name": string, "redirect_uris": string[] }`. No other field is read. There is no `token_endpoint_auth_method` and no secret: the client is always a public client, PKCE S256 is the only proof (enforced in the token endpoint today), and no client secret is generated or returned.

Behavior:
- Validate through `registerClient(db, { name, redirectUris, registeredByUserId: auth.userId, now })`; this reuses the length limits, URI count limit and `isAllowedRedirectUri` (https or loopback http, no fragments). Errors map to a 400 envelope with the engine's code.
- Honour `CO_NEWBIZ_OAUTH_REDIRECT_HOST_ALLOWLIST`: factor the existing `hostAllowed()` out of `register/route.ts` into `app/web-next/lib/mcp/config.ts` (one shared helper, both routes call it) so the two doors cannot drift. A non-allowlisted host returns 400 `invalid_redirect_uri`.
- Per-user rate limit: 10 registrations per user per hour, in-memory window keyed by `user_id` (same `Symbol.for` globalThis pattern as the DCR limiter). Over the limit: 429 envelope. Also cap live clients per user at 25 (counted from `oauth_client.registered_by_user_id`) to bound table growth; over the cap: 409 `client_limit_reached`.
- Audit: `registerClient` already writes `oauth_client_register` with the actor set to the user id (it now receives a real user instead of "anonymous"). The route adds one more row `oauth_client_register_manual` carrying `{client_id}` only, so the source (manual vs DCR) is queryable without a schema change. Append-only per ADR-0012; no delete path is introduced.
- Response (201, standard envelope): `{ client_id, client_name, redirect_uris, token_endpoint_auth_method: "none", created_at }`. `client_id` is not a secret.

### `GET /api/oauth/clients` (new, small)

Same human-session requirement. Returns only rows where `registered_by_user_id = <caller>`. The filter lives in a new `listClientsByUser(db, userId)` in `db/lib/oauth.ts`, i.e. below the route handler (FR-SEC-03). Fields: `{ client_id, name, redirect_uris, verified, created_at }`. Another user's client is never returned; there is no by-id lookup, so there is no 404/403 question.

### `DELETE /api/oauth/clients/{clientId}` — out of scope

Deleting a client row would orphan or cascade over `oauth_code`/`oauth_token` rows that reference it (FKs) and needs a revoke-then-delete order plus its own audit semantics. Users can already stop a client from working through the existing Connected Apps revoke (`DELETE /api/oauth/apps/{clientId}`, `revokeConnectedApp`), and an idle registered client carries no access. Revisit if clients accumulate; it needs its own small design.

### Schema

No DB schema change and no migration. `oauth_client` (migration 0128) already has `client_id, name, redirect_uris, registered_by_user_id (FK app_user), verified, created_at`; every column the feature needs exists. `registered_by_user_id` is nullable and DCR simply never populated it. If a later iteration wants a client "kind" column (manual vs DCR) or a soft-delete flag, that is a schema change and requires an ADR first; this design avoids it by recording the source in the audit row.

## 2. UI: "Register a client manually"

Location: `app/web-next/app/settings/connected-apps/page.tsx`, inside the hosted-AI-app (OAuth) section, below the connector URL and connection steps, as a collapsible section (closed by default; DCR remains the recommended path).

Onyx 3.0 conformance (`docs/design-system/`; `bun scripts/co-newbiz/design-lint.ts` must pass): use existing `Button`, `PageState`, `useToast` and the `crud.tsx` primitives rather than new components; tokens only (no hard-coded colors); one primary action ("Register client"); state conveyed by text plus icon, not color alone.

Content:
- Fields: Client name (1-100 chars, required) and Redirect URIs (one per line, 1-5; helper text shows the callback pattern from the user guide). Inline validation messages mirror the API codes.
- After success: `client_id` in a read-only field with a Copy button, plus a note "Public client: no client secret. Leave the secret blank in the host app; token endpoint authentication method: none."
- List of the user's registered clients (name, id, redirect hosts, created, verified badge) from `GET /api/oauth/clients`; empty state explains the purpose. No delete control (out of scope); authorized clients are revoked through the existing connected-app list.
- Human-only: the form uses the session cookie via `lib/api.ts`; it never sends a bearer header.

i18n: new next-intl keys in both ko and en message files under `connectedApps.manualClient.*` (title, description, nameLabel, redirectUrisLabel, redirectUrisHelp, submit, successTitle, clientIdLabel, copy, copied, noSecretNote, listTitle, empty, errors.invalid_redirect_uri, errors.invalid_client_metadata, errors.rate_limited, errors.client_limit_reached, errors.session_required). Korean copy follows the plain-language preference; i18n-audit must report no missing key.

### Accessibility (WCAG 2.1 AA)

- Every input has a programmatically associated visible `<label>`; helper and error text are linked with `aria-describedby`; invalid fields set `aria-invalid="true"` and errors are announced via an `aria-live="polite"` region, never by color alone (1.4.1, 3.3.1, 3.3.3).
- The disclosure is a `<button aria-expanded aria-controls>`; fully keyboard operable (2.1.1), visible token-based focus ring (2.4.7), logical tab order (2.4.3). Enter in the name field does not submit a half-filled form.
- The Copy button has an accessible name ("Copy client ID") and confirms through the live region and toast, not only an icon change (4.1.3).
- Text contrast >= 4.5:1 and non-text >= 3:1 by using design tokens only (1.4.3, 1.4.11); targets >= 24px.
- The client list is a real table or list with header semantics and reflows at 320px without horizontal page scroll (1.4.10).
- design-lint (no icon-only button without `aria-label`, no color-only state) and the existing axe-based audit pass.

### Preview Verification (ADR-0065 / ADR-0070)

Run the dev server (the app's dev port, see the project run scripts) and verify Connected Apps at no fewer than two breakpoints (desktop 1280 and mobile 375) and at least one interaction: open the disclosure, submit an invalid redirect URI (error shown and announced), then a valid one (client id shown, row appears in the list). Record screenshots or notes in the PR description; required before the UI work is marked done.

## 3. DCR refusal audit

In `register/route.ts`, every non-201 return writes one audit row through `appendAudit` (small `auditDcrRefusal(db, reason, status, ip)` helper):

| Branch | HTTP | reason code (action `oauth_dcr_refused`) |
|---|---|---|
| per-IP limit | 429 | `rate_limited` |
| non-JSON body | 400 | `body_not_json` |
| auth method not `none` | 400 | `auth_method_unsupported` |
| unsupported grant | 400 | `grant_unsupported` |
| host not on allowlist | 400 | `redirect_host_not_allowed` |
| engine rejection | 400 | engine error code (`invalid_client_metadata` or `invalid_redirect_uri`) |

The audit target JSON contains only `{ reason, status, ip_hash }`, where `ip_hash` is a keyed pseudonym: HMAC-SHA256 of the normalized client IP under `CO_NEWBIZ_AUDIT_IP_HMAC_KEY`, truncated to 16 hex (enough to correlate bursts; not reversible without the key, but anyone holding the key can confirm a guessed IP, so the key is a secret). In production with no key set, no `ip_hash` is written and a one-time warning is logged; an unkeyed SHA-256 is never used. The target also carries the server-generated `request_id` and, separately, the sanitized inbound `client_request_id`, plus the redirect host for the allowlist reason. It never contains the request body, client name, full redirect URIs, tokens, or headers. Actor is `"anonymous"`. To stop the audit log being used for amplification, once an IP hits the 429 limit only one `rate_limited` row is written per IP per window. The 201 path keeps its existing `oauth_client_register` row.

Diagnostic rule (goes into the admin guide): a 403 on `/api/oauth/register` with no matching `oauth_dcr_refused` or `oauth_client_register` row around that time means the request never reached the app, so the edge blocked it.

## 3b. DCR conformance (primary track)

Audited files: `register/route.ts`, `lib/mcp/config.ts`, `app/.well-known/oauth-authorization-server/route.ts`, `app/.well-known/oauth-protected-resource/[[...path]]/route.ts`, `app/api/oauth/token/route.ts`, `lib/mcp/http-server.ts`, `lib/mcp/cors.ts`, `lib/auth.ts`, `next.config.ts`, `docker-compose.yml`. There is no Next `middleware.ts`/`proxy.ts`, so no app-level gate sits in front of these routes. Not audited in depth: `db/lib/oauth.ts` token-exchange internals (unchanged by this design). The gaps below are from reading code; none has been reproduced against a live ChatGPT/Claude.ai client yet.

| # | Gap | Evidence | Disposition |
|---|---|---|---|
| a1 | Register response does not echo `scope` (and drops other accepted metadata such as `client_uri`, `logo_uri`, `contacts`, which RFC 7591 §3.2.1 says should be returned as registered). A strict client may treat missing echo as failure. | route returns a fixed object | Code fix: echo `scope` (validated against `OAUTH_SCOPES`; unknown scopes dropped, not refused) and accepted informational fields; keep unknown fields ignored. |
| a2 | `token_endpoint_auth_method` other than `none` is refused with 400. Some hosted clients send `client_secret_post`/`client_secret_basic` in DCR even when they can run as public clients; refusing breaks registration where RFC 7591 §3.2.1 lets the server substitute and report the value it actually applied. | `register/route.ts` method check | Code fix (needs decision, open question 6): register as public, return `token_endpoint_auth_method: "none"` and no secret. The token endpoint already authenticates by PKCE only, so no weaker path is created. |
| a3 | `response_types` in the request is not validated and `grant_types` omitting `authorization_code` is accepted. | route | Code fix: accept `["code"]` only; reject others with `invalid_client_metadata`. |
| b1 | Content-Type is not checked; the body is parsed as JSON regardless. Array, string or `null` JSON bodies are not rejected up front. Empty body gives 400 `JSON body required` (good). | route | Code fix: require an object; keep tolerance for a missing/odd Content-Type header when the body is valid JSON object (hosted clients are inconsistent); reject non-objects with 400 and an audited reason. |
| b2 | Error body is JSON `{error, error_description}` with `no-store` (conformant, RFC 7591 §3.2.2). | `oauthError` | No change. |
| c1 | No `/.well-known/openid-configuration`. The MCP authorization spec tells clients to try RFC 8414 then OIDC discovery, and some hosts try OIDC first. | only `oauth-authorization-server` exists | Code fix: add `/.well-known/openid-configuration` returning the same document (plus `subject_types_supported`/`id_token_signing_alg_values_supported` omitted: this is OAuth only; document returned is the 8414 one). |
| c2 | Path-suffixed variants (`/.well-known/oauth-authorization-server/api/mcp`, `/.well-known/openid-configuration/api/mcp`, `/api/mcp/.well-known/openid-configuration`) 404. Issuer has no path, so the canonical form is correct, but clients that build the URL from the resource path will 404. | route files | Code fix: make the AS route an optional catch-all (like the protected-resource route) and serve the same document for the `api/mcp` suffix; `/api/mcp/.well-known/*` alias is optional (open question 7). |
| c3 | AS metadata fields: `token_endpoint_auth_methods_supported: ["none"]`, `code_challenge_methods_supported: ["S256"]`, `grant_types_supported`, `scopes_supported`, `response_types_supported`, `registration_endpoint` are present. Missing optional: `service_documentation`. | `authorizationServerMetadata` | No change required; optional `service_documentation` link to the user guide. Unit test pins the required set. |
| c4 | `authorization_endpoint` is `/oauth/authorize` (the consent UI page, not under `/api`), which is correct but is a separate path class for WAF rules. | config | Documented in the Cloudflare section. |
| d1 | 401 with `WWW-Authenticate: Bearer resource_metadata="..."` exists (`http-server.ts` `unauthorized()`), conformant to RFC 9728 §5.1. It carries no `scope` parameter. | http-server.ts | Optional code improvement: add `scope="read propose"` hint. Add a test pinning the header and the metadata URL (no such pin is known; verify while implementing). |
| d2 | The HTTPS and Origin checks run before the bearer check, so a hosted client that sends a browser `Origin` not in the allowlist gets 403 instead of the 401 that starts discovery. Same for a mis-detected scheme (`httpsRequired` relies on `X-Forwarded-Proto`; a proxy that omits it yields 403 "HTTPS is required"). | `handleMcpRequest` | Code fix: evaluate the bearer check first (an unauthenticated request must always receive the 401 + `WWW-Authenticate`), keep Origin enforcement for authenticated requests (the DNS-rebinding concern is about authenticated state). Keep the HTTPS check but include its reason in the body; document `CO_NEWBIZ_MCP_ALLOWED_ORIGINS` entries for `https://chatgpt.com` and `https://claude.ai` if those clients are browser-originated. |
| e1 | Rate limit key is `x-forwarded-for` first element, else `x-real-ip`, else `"local"`. Behind the Cloudflare tunnel there is one connecting IP; if the proxy strips or never sets XFF, every caller shares one `local`/proxy key and 20/hour is exhausted for everyone. Conversely the first XFF element is client-controlled when the proxy appends rather than replaces it, so the limiter is bypassable by spoofing. | `clientIp()` | Code fix: shared `clientIp(request)` helper in `lib/mcp/` preferring `CF-Connecting-IP` when `CO_NEWBIZ_TRUST_PROXY_HEADERS=cloudflare` is set (documented for the production container), else the rightmost XFF entry set by our own proxy, else `"local"`. Use it in register (and the manual route). Also add an unknown-key fallback so a missing header does not collapse all clients into one bucket silently: log a one-time warning. |
| e2 | The window is 20 per IP per hour and is in-memory (lost on restart, per container). Acceptable for this deployment. | route | No change; note in admin guide. |
| f1 | Application sources of 403 on the public OAuth paths: none in `register`, `token`, `revoke`, `.well-known/*` (no auth gate, CSRF check, Origin check, or bot guard there; CORS is wildcard by design). 403 exists only in `/api/mcp` (HTTPS, Origin, password-change) and the cookie-session routes (`authenticate()` CSRF/Origin), which DCR does not touch. | grep of `403`/`forbidden`/`originAllowed` | Confirms the register 403 is not from the app. Dev-only `allowedDevOrigins` 403s apply to the dev server's `/_next/*` assets, not to API routes, and not to the Docker production container. |
| g1 | No request correlation: a refused or accepted request cannot be tied to a log line, and the app emits no per-request id. | route | Code fix: generate a server UUID as `x-request-id` (an inbound value is recorded separately as `client_request_id`, length-capped and sanitized, never reused as the id) on register/token/well-known responses and include it in the refusal audit target and a single structured log line (`oauth_dcr` with status, reason, request id, ip_hash). Cloudflare Ray ID (`cf-ray` header) is also recorded in the audit target when present, so an operator can join Cloudflare Security Events to app rows. |

Proof method, edge versus app (g): for a failing registration the operator collects (1) the HTTP response headers from the client side if available (a `cf-ray` and `server: cloudflare` with no `x-request-id` header and a Cloudflare-styled HTML/JSON body indicates the edge; an app response always has `x-request-id` and an OAuth JSON error body); (2) the app audit table: `oauth_dcr_refused` or `oauth_client_register` row with the same `cf-ray`; (3) the Cloudflare Security Events entry for that Ray ID. Presence of an app row with the Ray ID proves the app saw and refused it; absence plus a Security Events block proves the edge. A direct local `curl` against `http://127.0.0.1:<APP_PORT>/api/oauth/register` with a valid body returning 201 isolates the app from the edge.

### What is code (in scope) versus Cloudflare (documented only)

Code fixes (in scope): a1, a2 (pending decision), a3, b1, c1, c2, d1 (optional scope hint), d2, e1, g1, plus the section 3 refusal audit and the optional section 1-2 fallback.

Cloudflare configuration (documented only, in `mcp-admin-guide*.md`): the Skip custom rule for `/api/oauth/register` and `/.well-known/*` (also `/oauth/authorize`, `/api/oauth/token`, `/api/mcp` only if challenged), ensuring Bot Fight Mode / Super Bot Fight Mode and "Browser Integrity Check" do not challenge server-to-server clients (these clients send non-browser User-Agents and cannot solve challenges), Managed Rules false positives on JSON bodies, setting the real-IP header handling, and tunnel `X-Forwarded-Proto: https` pass-through. Hosted clients' egress IP ranges are not allowlisted in this design (open question 8).

## 4. Documentation

Update the English guides and their `_ko` counterparts (docs-writer for the language policy):

- `docs/manuals/mcp-user-guide.md` / `_ko.md`: "ChatGPT: user-defined OAuth client" steps. (1) In Connected Apps open "Register a client manually", enter a name and the redirect URI ChatGPT shows, copy the `client_id`. (2) In ChatGPT create the connector, choose the user-defined OAuth client option, enter MCP URL `https://<APP_HOST>/api/mcp` and the client id, leave the client secret empty, token endpoint auth method none. (3) Complete the consent screen. Say when to prefer this path (DCR blocked at the edge).
- `docs/manuals/mcp-admin-guide.md` / `_ko.md`: Cloudflare WAF section. Add a custom rule with action Skip (managed rules, bot protection, and rate limiting that match) for `http.request.uri.path eq "/api/oauth/register"` and `starts_with "/.well-known/"`, placed above blocking rules; add `/api/oauth/token`, `/api/oauth/authorize`, `/api/mcp` only if Security Events show them challenged. State the tradeoff: these paths are unauthenticated by design (RFC 7591 registration, RFC 9728 / RFC 8414 discovery), so the compensating controls are the in-app per-IP limiter, the redirect-host allowlist, and the refusal audit. Include the diagnostic rule from section 3 and a pointer to the Cloudflare Security Events log to confirm which rule blocked.
- `docs/architecture/mcp-integration.md`: one paragraph on the two registration doors, only if the file already describes DCR.

## 5. Contract and tests

openapi.yaml (`docs/architecture/openapi.yaml`, same change, drift gate): add `/api/oauth/clients` with `get` (operationId `oauthClientsList`) and `post` (`oauthClientsRegister`), cookie-session security, envelope responses 200/201, 400, 401, 403 `session_required`, 409, 429. Note in the existing `/api/oauth/register` entry that refusals are audited. `docs/architecture/api-spec.md` gets a line for the endpoint in the OAuth section.

Tests in `tests/unit/mcp-oauth.test.ts` (bun:test, temp DB):

- POST creates a client with `registered_by_user_id` set to the caller, returns a `client_id`, no secret in the response, and writes `oauth_client_register` (actor = user id) and `oauth_client_register_manual`.
- Bearer token (personal API token) refused 403 `session_required`; no session 401; missing CSRF/Origin refused.
- Rejects non-loopback `http://`, fragments, empty or over-long name, more than the URI limit (400 with engine codes).
- Allowlist: with `CO_NEWBIZ_OAUTH_REDIRECT_HOST_ALLOWLIST=chatgpt.com`, `https://other.example/cb` is refused and `https://chatgpt.com/cb` accepted; loopback still allowed.
- Rate limit: the 11th registration by one user in the window returns 429; another user is unaffected; the 25-client cap returns 409.
- GET returns only the caller's clients (create as user A and B, assert disjoint lists), the unauthorized-access case; GET with bearer refused.
- A manually registered client completes authorize validation with PKCE S256 and token exchange end to end (reusing existing helpers); a request without `code_challenge` is still refused.
- DCR refusals: each branch in the table writes exactly one `oauth_dcr_refused` row with the right reason; the target JSON has no body, client name, or full URI; the 201 path writes no refusal row; a flood writes one `rate_limited` row per IP per window.
- The existing MCP DB-import scan test stays green (no `db/client.ts` or `bun:sqlite` import in `mcp/co-newbiz/`; this change touches only app routes and `db/lib`).
- UI: extend the connected-apps page source-pin test for labels and `aria-describedby`/`aria-live`; i18n key parity test passes.

Evidence on delivery: `bunx tsc --noEmit` in `app/web-next`, `bun test tests/unit/mcp-oauth.test.ts`, design-lint and the openapi drift check; no `--no-verify`.

## 6. Security review points (for `security-engineer`)

- Session-only enforcement cannot be bypassed by a bearer token (same helper as authorize; tested).
- A registered client cannot widen privileges: scope is still capped by role at consent, the unverified badge shows at consent, and redirect URI exact-match plus the https/loopback rule are unchanged.
- Open-redirect surface: a user can register any https redirect URI. Mitigations: allowlist applies, exact-match at authorize, consent screen shows the redirect host, per-user cap and rate limit, audit per registration. See open question 1.
- Audit rows carry ids and reason codes only; the IP is hashed; no body, secrets, or tokens (FR-SEC-06/07). No delete path is added for `audit_log` (ADR-0012).
- CSRF: POST relies on authenticate()'s Origin + double-submit checks; GET is read-only and user-scoped.
- Refusal-audit amplification is bounded by the per-IP window rule.
- The edge skip rule widens the unauthenticated surface at Cloudflare; compensating controls are listed in the admin guide.

## Work split (for PM to dispatch)

Row 1 — backend-engineer (primary, DCR conformance; do first, no UI dependency): refusal audit (section 3) with request id and `cf-ray`; DCR conformance fixes a1, a2, a3, b1, c1, c2, d1, d2, e1, g1 (section 3b); shared `clientIp()` helper; openapi/api-spec updates for the register response and new well-known routes; tests in `tests/unit/mcp-oauth.test.ts` (conformance cases below plus the section 5 DCR-refusal tests). Also the fallback API (`POST/GET /api/oauth/clients`, `listClientsByUser`, shared allowlist helper) as a second PR in the same row, after the conformance PR is green.

Row 2 — frontend-engineer (secondary, depends on the fallback API from Row 1): the manual-registration form, list, ko/en keys, accessibility and preview verification (sections 2). May be deferred if the DCR fixes resolve the ChatGPT/Claude.ai failure.

Row 3 — docs-writer (with backend-engineer input): user guide (ChatGPT user-defined client steps, DCR first, manual as fallback) and admin guide (Cloudflare skip rule and settings, edge-versus-app proof method, request-id and Ray ID usage), en and ko; `security-engineer` reviews section 6 before merge.

Added conformance tests for Row 1: register echoes `scope`/`response_types`/`client_name` and ignores unknown fields; non-object JSON and wrong `response_types` return 400; `token_endpoint_auth_method: client_secret_post` is registered as public with `none` echoed (if decision a2 is approved); AS metadata served at `/.well-known/oauth-authorization-server`, `/.well-known/openid-configuration` and the `api/mcp` suffix with identical bodies and the required field set; unauthenticated `/api/mcp` with a foreign `Origin` returns 401 with `WWW-Authenticate` containing `resource_metadata`; with `CO_NEWBIZ_TRUST_PROXY_HEADERS=cloudflare`, distinct `CF-Connecting-IP` values get separate rate buckets and a spoofed `X-Forwarded-For` does not bypass the limit; every response from register/token/well-known carries `x-request-id`.

## Out of scope

Deleting a registered client (see section 1); confidential clients and client secrets; changes to scopes, token lifetimes, or the consent screen; changes to ADR-0154 or the MCP package; an admin "verify client" UI; automating Cloudflare configuration (documented only); any DB schema change.

## Open questions

1. Should manual registration require the redirect host to be on the allowlist even when the env allowlist is unset (stricter than DCR)?
2. Confirm or adjust the proposed limits (10 registrations per user per hour, 25 live clients).
3. Is an ADR-0154 amendment wanted to record the second registration door, or is this design doc sufficient? No schema change, so no ADR is mandatory under the schema trigger; auth/MCP-scope changes may still warrant one.
4. Which redirect URI does ChatGPT show for the user-defined client flow today? Confirm against the live ChatGPT UI before the guide text is final.
5. Which Cloudflare plan and features does the zone use (Skip-rule support for bot protection differs by plan)?
6. Gap a2: may DCR accept a non-`none` `token_endpoint_auth_method` and register the client as public (returning `none`), or must it keep refusing? This changes the existing contract and ADR-0154 §2 wording ("public clients only"), so confirm and decide whether an ADR-0154 amendment is needed.
7. Gap c2: add the `/api/mcp/.well-known/*` alias as well as the suffixed well-known forms?
8. Should hosted-client egress IP ranges be allowlisted at Cloudflare, or is the skip rule on the specific paths enough?
9. A captured real failing ChatGPT/Claude.ai DCR request (headers and body) would confirm gaps a2/b1; none was available when this was written.

## Disclaimer

This design is engineering decision support, not security certification or legal advice. The 403 root cause is a hypothesis until the Cloudflare Security Events log confirms the blocking rule; where this document conflicts with the code or ADR-0154, the code and ADR govern.
