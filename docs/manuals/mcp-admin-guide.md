---
lang: en
counterpart: mcp-admin-guide_ko.md
---

# MCP Admin Guide — Token Policy and Package Release

> **Language**: **English** · [한국어](mcp-admin-guide_ko.md)

**Audience**: system administrators and release owners (release-engineer, sre)
**Not for**: people who only want to connect an AI client (see `mcp-user-guide.md`)

## What This Guide Covers

The personal API token policy, the release of the `@co-newbiz/co-newbiz-mcp` package to two registries, the secrets that release needs, and the 90-day rotation of `NPM_TOKEN`. Sources: `docs/architecture/mcp-integration.md`, `.github/workflows/mcp-package.yml`, `docs/designs/2026-11-18-mcp-package-distribution-design.md`, and the Connected Apps page source.

## 1. Personal API Token Policy

| Rule | Value |
|---|---|
| Who may issue | Analysts and viewers. **Administrators cannot issue tokens**, read scope included (`POST /api/tokens` returns 403 `role_forbidden`) |
| Scopes | `read-only` (default) or `read-write`. Viewers lose `write`; only analysts may hold it |
| Expiry options | 7, 30, 90 or 180 days; default 30 |
| Active-token cap | 5 per user; the 6th request is refused |
| Role inheritance (ADR-0146) | The MCP server relays the bearer token, so every tool runs with the token owner's role. Write and `propose_*` tools need an analyst token |
| Existing admin tokens | A token issued before the rule stays valid until it expires. Any admin token receives 403 `role_forbidden` on business routes |
| MNPI | `mnpi_flag=true` projects are excluded from tool responses by default |
| Issue and revoke | Human web-session only. Tokens and agents cannot issue or revoke tokens |
| Storage | Hashed at rest; the secret is shown once at issue |
| Audit | Each tool call becomes a REST call and an `audit_log` entry, read-only calls included |
| Rate limit | Per-token limits, independent of web-session limits; write tools get a tighter budget |

## 2. Package Release

Release owners publish the package by tag. Follow `docs/runbooks/deployment.md` for the surrounding release checks.

1. Bump the version in `mcp/co-newbiz/package.json`.
2. Push a tag `mcp-vX.Y.Z`. The tag version **must equal** the manifest version.
3. The `guard` job fails the run if the tag and manifest differ, or if the tarball contains a file outside the allowlist (the `mcp/co-newbiz` subtree; no `db/`, `app/` or `scripts/` code; ADR-0011).
4. Two publish jobs then run in parallel from the same tagged commit (section 3).
5. The `smoke` job installs the packed tarball and runs a stdio handshake against a stub REST server (`initialize`, then `tools/list`).

## 3. Dual Publish and Secrets

| Job | Registry | Secret | Role |
|---|---|---|---|
| `publish-npmjs` | `registry.npmjs.org` | `NPM_TOKEN` | Primary channel. Consumers install anonymously |
| `publish` | `npm.pkg.github.com` | `MCP_PACKAGES_PAT` | Secondary channel |

- `MCP_PACKAGES_PAT` is a **classic PAT with `write:packages`**, owned by a member of the `co-newbiz` GitHub organization. The `co-newbiz` organization must exist.
- Both jobs publish the same manifest version from the same tag, so the registries cannot drift.
- `1.0.1` onwards is the npmjs line; `1.0.0` exists only on GitHub Packages.
- Neither secret is ever written in a document. Consumers need neither: anonymous npmjs install works (verified 2026-11-18, HTTP 200 on the tarball).

## 4. NPM_TOKEN Rotation (every 90 days)

**Requirement.** `NPM_TOKEN` must be an npm **granular access token** with **Read and write** permission on `@co-newbiz/*` and **bypass 2FA** enabled, expiring at most 90 days after creation. Rotate it **every 90 days, before it expires**.

**Current state.** The token in place was set on 2026-11-18, so it lapses about **2027-02-16**. Confirm the exact expiry date on npmjs.com (Access Tokens page) and record it in the table below.

**Failure signature.** An expired or insufficient token makes `publish-npmjs` fail with E403 while the GitHub Packages `publish` job (a different secret) still passes. The first npmjs publish on 2026-11-18 failed with the same E403 because the token had no 2FA bypass. After you confirm the token has not expired, check the bypass-2FA setting.

**Rotation steps.**

1. On npmjs.com, create a new granular token: Read and write on `@co-newbiz/*`, bypass 2FA, expiry of 90 days or less.
2. Replace the repository secret `NPM_TOKEN` (GitHub repository Settings, Secrets and variables, Actions).
3. Record the new expiry date and the next due date in the Rotation record below. Set a reminder some days before the due date.
4. Revoke the old token on npmjs.com.
5. Verify at the next `mcp-v*` release that `publish-npmjs` is green. If no release is imminent, treat the next release as the verification and say so in the record.

**Rotation record.** Update this table on every rotation. Never write the token value here.

| Token created | Expires | Next rotation due | Rotated by | Verified at release |
|---|---|---|---|---|
| 2026-11-18 | about 2027-02-16 (confirm on npmjs.com) | before expiry (set after confirming the date) | to be recorded | next `mcp-v*` release |

## 5. Incident Symptoms

| Symptom | Likely cause | First check |
|---|---|---|
| `guard` fails on the version step | Tag does not equal `mcp/co-newbiz/package.json` version | Bump the manifest, then retag |
| `guard` fails on the tarball step | A file outside the allowlist entered the package | Read the listed offenders; keep the package inside the subtree (ADR-0011) |
| `publish-npmjs` fails with E403 while `publish` passes | `NPM_TOKEN` expired or insufficient | Check expiry on npmjs.com, then the bypass-2FA and `@co-newbiz/*` read-write settings; rotate (section 4) |
| `publish` fails | `MCP_PACKAGES_PAT` invalid or expired, or the `co-newbiz` organization precondition is unmet | Check the PAT owner, its `write:packages` scope and the organization |
| `smoke` fails | Tarball content or the stub-handshake broke | Read the job log. The workflow lists `smoke` as running after `publish` |
| A consumer cannot install a just-published version | A registry read can lag shortly after a first publish; 2026-11-18 showed 404 for a few minutes. Observed once, not a guarantee | Retry after a few minutes; then check the job results |

## 6. Hosted connectors: DCR returns 403 (Cloudflare)

**Symptom.** Creating a ChatGPT or Claude.ai connector fails at dynamic client registration (`POST /api/oauth/register`) with HTTP 403. The application has no 403 on its public OAuth paths, so the likely source is the Cloudflare edge. An administrator, not the application, changes Cloudflare.

### 6.1 Prove edge versus app

1. In Cloudflare, open Security, then Events. Filter by Host (`<APP_HOST>`, the host the environment is served from; use the value in the CO_NEWBIZ_PUBLIC_ORIGIN setting of that environment), Path `/api/oauth/register` and action block or challenge. The matching event names the service and the rule id that acted.
2. In the app, look for an `oauth_dcr_refused` audit row at the same time. The app writes one for every refusal it makes, with `reason`, `status`, `ip_hash`, `request_id` and `cf_ray`.
3. A 403 with no app audit row came from the edge. Match `cf_ray` in the audit row to the Ray ID in the Cloudflare event to join the two.

### 6.2 Add the Skip rule

Create custom rules and place them **first** in the order. The host differs by environment, and an environment's host can change. Add one rule per host that serves hosted connectors, and write `<DEV_HOST>` or `<PROD_HOST>` below as that environment's own host. Use the host the environment is served from; it must equal the host in `CO_NEWBIZ_PUBLIC_ORIGIN`. Look it up in the `CO_NEWBIZ_PUBLIC_ORIGIN` value of that environment.

Rule 1, name `Allow OAuth DCR and discovery (<ENV>)`, with `<ENV>` set to `dev` and the host set to `<DEV_HOST>`:

```text
(http.host eq "<DEV_HOST>" and (http.request.uri.path in {"/api/oauth/register" "/api/oauth/token" "/api/oauth/revoke" "/.well-known/openid-configuration"} or starts_with(http.request.uri.path, "/.well-known/oauth-")))
```

Rule 2, name `Allow OAuth DCR and discovery (<ENV>)`, with `<ENV>` set to `prod` and the host set to `<PROD_HOST>`. Add it only when that environment serves hosted connectors:

```text
(http.host eq "<PROD_HOST>" and (http.request.uri.path in {"/api/oauth/register" "/api/oauth/token" "/api/oauth/revoke" "/.well-known/openid-configuration"} or starts_with(http.request.uri.path, "/.well-known/oauth-")))
```

Action (both rules): **Skip**, for All managed rules, Super Bot Fight Mode rules (plan dependent) and Browser Integrity Check. Skip only the services that the Events entry from 6.1 names first. Hosted clients send non-browser User-Agents and cannot solve challenges.

Keep `/api/mcp` and `/oauth/authorize` protected: do not add them to the rule. These paths are unauthenticated by design (client registration, discovery), so the compensating controls are the in-app per-IP limiter, the redirect-host allowlist and the refusal audit.

### 6.3 Trust the Cloudflare client IP

Bind the origin port first (6.7), then set `CO_NEWBIZ_TRUST_PROXY_HEADERS=cloudflare` in the production environment. The registration rate limit (20 per IP per hour, in memory, reset on restart) then keys on `CF-Connecting-IP`. Without it, all clients behind the tunnel may share one bucket.

### 6.4 Redirect-host allowlist

`CO_NEWBIZ_OAUTH_REDIRECT_HOST_ALLOWLIST` is a comma-separated list of hosts. Loopback hosts are always allowed. A blocked host returns 400 `invalid_redirect_uri`, not 403.

- Set it in production. Without it, any `https` redirect host can register a client, which opens a phishing-consent risk.
- Candidate hosts: `chatgpt.com`, `claude.ai`, `claude.com`. Confirm each against the connector you actually use before you set the list.
- The administrator sets it in the deployment environment. The application does not set it.

Example (confirm the hosts first):

```text
CO_NEWBIZ_OAUTH_REDIRECT_HOST_ALLOWLIST=chatgpt.com,claude.ai,claude.com
```

The server also refuses reserved client names. A `client_name` that contains ChatGPT or OpenAI, Claude or Anthropic, Gemini or Google, or co-newbiz is accepted only when every redirect host belongs to that brand:

| Brand | Allowed redirect hosts |
|---|---|
| ChatGPT / OpenAI | `chatgpt.com`, `openai.com` |
| Claude / Anthropic | `claude.ai`, `claude.com`, `anthropic.com` |
| Gemini / Google | `gemini.google.com`, `google.com` |
| co-newbiz | the application's own host |

A refusal returns 400 `invalid_client_metadata` with audit reason `reserved_client_name`. Real ChatGPT and Claude.ai registrations are unaffected.

### 6.5 Refusal reason codes

Each refusal writes an `oauth_dcr_refused` row with one of these reasons:

| Reason | Meaning |
|---|---|
| `rate_limited` | The per-IP registration limit was reached (HTTP 429) |
| `body_not_json` | The request body is not valid JSON |
| `body_not_object` | The JSON body is not an object (array, string or null) |
| `response_type_unsupported` | `response_types` is something other than `["code"]` |
| `grant_unsupported` | `grant_types` does not include `authorization_code` |
| `redirect_host_not_allowed` | A redirect URI host is not on the allowlist (6.4) |
| `reserved_client_name` | The `client_name` uses a reserved brand name and a redirect host does not belong to that brand (6.4) |
| `invalid_client_metadata` | The registration engine rejected the client metadata |
| `invalid_redirect_uri` | The registration engine rejected a redirect URI |

### 6.6 Discovery URLs served

- `/.well-known/oauth-authorization-server` (also with the `/api/mcp` suffix)
- `/.well-known/openid-configuration`
- `/.well-known/oauth-protected-resource/api/mcp`

### 6.7 Bind the origin port before trusting proxy headers

A deployment that publishes the app's port on all interfaces (see `docker-compose.yml` for the published port) is exposed. A caller that reaches the port directly can forge `X-Forwarded-For`, `CF-Connecting-IP`, `X-Forwarded-Proto` and `cf-ray`. Do the steps in this order:

1. Publish the port on loopback only (`127.0.0.1:<APP_PORT>:<APP_PORT>`), or put `cloudflared` on the compose network and stop publishing the port. This is an administrator change. Do not change the port without the owner's approval.
2. Only then set `CO_NEWBIZ_TRUST_PROXY_HEADERS=cloudflare` (6.3).
3. From another host on the LAN, check that `http://<host>:<APP_PORT>` is refused.

The `cf_ray` value in audit rows is trustworthy evidence only after step 1.

### 6.8 Audit pseudonym key

Set `CO_NEWBIZ_AUDIT_IP_HMAC_KEY` in the production environment. It is a secret: never commit it to git. Without it, `oauth_dcr_refused` rows carry no `ip_hash`. With it, `ip_hash` is a keyed pseudonym of the client IP and cannot be reversed without the key.

## Related Screens

- `연결된 앱` / Connected Apps (`/settings`) — where users issue and revoke their own tokens.
- `연결된 앱 관리` / Connected apps (admin) (`/admin/connected-apps`) — the admin-console fleet stop/start for registered OAuth clients; see the [admin manual](admin-manual.md) section 7.
- `docs/runbooks/deployment.md` — release procedure that links here for the rotation requirement.
- `docs/architecture/mcp-integration.md` — architecture and client registration.
- `mcp-user-guide.md` — the user-side counterpart of this guide.
