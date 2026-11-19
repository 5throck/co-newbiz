# ADR-0203: Amend ADR-0154 — DCR registers a public client whatever auth method is requested

**Status**: Accepted (2026-11-19, decided by the user in chat)
**Date**: 2026-11-19
**Deciders**: Human reviewer (user). Drafted by backend-engineer. AI review alone cannot accept this ADR (auth model change).
**Design of record**: `docs/designs/2026-11-19-oauth-manual-client-registration-design.md` (§3b gap a2)

## Context

ADR-0154 §2 states that Dynamic Client Registration (RFC 7591) serves public clients only, and the register endpoint refused any `token_endpoint_auth_method` other than `none` with HTTP 400. Hosted MCP hosts (ChatGPT, Claude.ai) are inconsistent: some send `client_secret_post` or `client_secret_basic` in the registration request even though they can run as public clients. RFC 7591 §3.2.1 lets the server apply different values than requested and report the ones it applied. Refusing therefore broke registration for hosts that would have worked.

## Decision

1. `POST /api/oauth/register` accepts any `token_endpoint_auth_method`, registers the client as **public**, issues **no client secret**, and returns `token_endpoint_auth_method: "none"` in the 201 response.
2. Nothing else relaxes. PKCE S256 stays mandatory at authorize and at the token endpoint (which authenticates by PKCE only), `client_credentials` and unknown grants are still refused, `response_types` must be `["code"]`, redirect URIs stay https or loopback http, clients start unverified, and scopes are still capped by role at consent.
3. The response now echoes `client_name`, `redirect_uris`, `grant_types`, `response_types`, `token_endpoint_auth_method`, and, when the request named known scopes, `scope` (unknown scopes dropped). Unknown request fields are ignored.
4. Every refusal writes one `oauth_dcr_refused` audit row with a reason code, status, a keyed IP pseudonym (`ip_hash`: HMAC-SHA256 of the normalized IP under `CO_NEWBIZ_AUDIT_IP_HMAC_KEY`, truncated to 16 hex; not reversible without the key, and omitted entirely in production when no key is set), a server-generated request id (the sanitized inbound `x-request-id` is recorded separately as `client_request_id`) and `cf-ray` — never the body, name, URIs, or tokens. `grant_types` must be an array containing `authorization_code`, otherwise the request is refused (`grant_unsupported`).
5. **Reserved brand names are bound to the brand's own redirect hosts.** DCR is anonymous and clients start unverified, so a `client_name` such as "ChatGPT" would be shown on the consent screen as that brand to an impersonator. A `client_name` containing (case-insensitively, also with non-alphanumerics removed) `chatgpt`/`openai`, `claude`/`anthropic`, `gemini` or `newbiz` is accepted only when EVERY redirect_uri is https and its host equals or is a subdomain of that brand's hosts: ChatGPT/OpenAI -> `chatgpt.com`, `openai.com`; Claude/Anthropic -> `claude.ai`, `claude.com`, `anthropic.com`; Gemini -> `gemini.google.com`, `google.com`; co-newbiz -> the app's own public origin host only. Loopback http hosts never satisfy the rule. Otherwise the request is refused with 400 `invalid_client_metadata` and audited as `oauth_dcr_refused` with reason `reserved_client_name` (no name, no URIs in the row). `CO_NEWBIZ_OAUTH_REDIRECT_HOST_ALLOWLIST` is unchanged and applies first. Implemented in `app/web-next/lib/mcp/reserved-client-names.ts`.

## Consequences

- ADR-0154 §2 "public clients only" is unchanged in effect: the server still never creates a confidential client; it now substitutes instead of refusing. Boundary #1 (no agent accounts) and boundary #2 (humans decide) are untouched.
- A host that asked for a secret and receives `none` must cope with a secretless client; hosts that cannot will fail at their own token step, with the applied method visible in the registration response.
- No schema change and no migration.

## Alternatives rejected

- **Keep refusing non-`none` methods.** Breaks registration for hosts that tolerate substitution, for no security gain, since the token endpoint never accepts a secret.
- **Issue a secret for confidential methods.** Creates a second, weaker credential path next to PKCE and was explicitly out of scope.
