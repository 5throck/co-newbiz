# Port Swap (Dev 7748 / Docker 7749) and Public Domain Access — Design

- **Date**: 2026-10-11
- **Status**: draft (Design Gate Row 0)
- **Owner**: release-engineer
- **ADR**: none required (no DB schema, auth model or MCP scope change; verified)
- **Supersedes**: `2026-09-20-dev-port-7749-design.md` and the port layout in `2026-09-21-docker-prod-cicd-design.md` (both stay as history)

## 1. Problem

1. Operator request: host development uses 7748 and Docker production uses 7749. Before this change dev used 7749 and Docker mapped host 7748 to container 7749.
2. `https://newbiz.bizknights.org` answers 200 but is served by the dev server (Turbopack HMR client present) because the Cloudflare tunnel targets host port 7749, which is the dev server. The dev server answers 403 for dev-only resources (`/_next/webpack-hmr`) when the request Origin is `newbiz.bizknights.org`, since `allowedDevOrigins` lacks that host.

## 2. Decision

- Dev (`next dev`/`next start` on the host): **7748**.
- Docker: compose `ports: "7749:7749"`. The container-internal port stays 7749 (Dockerfile `EXPOSE`/`CMD` and the in-container healthcheck unchanged — verified).
- Tunnel target 7749 (unchanged, outside the repo) now reaches the production container, so the public site stops running dev code.
- `allowedDevOrigins` gains `newbiz.bizknights.org` (old host kept) so a dev server reached through the public name still has HMR.
- Test guard: the E2E harness must never bind 7748 or 7749.

## 3. Changes

Config: `app/web-next/package.json` (dev, start, description), `.claude/launch.json`, `.env.sample`, `docker-compose.yml`, `scripts/deploy-web.ts` (health URL 7748 to 7749), `mcp/co-newbiz/shared/rest-client.ts` (default base URL 7748), `app/web-next/next.config.ts`, the Production section of `.env.sample` (documents `CO_NEWBIZ_PUBLIC_ORIGIN` and the redirect allowlist). Docs: README, both deployment runbooks (new "Operator cutover steps" with rollback), `scripts/SCRIPTS.md`, `demo.ts` comment, regenerated `library.generated.ts`. Tests: harness forbids both ports; MCP test origins moved to 7748; new `tests/unit/next-config-origins.test.ts` asserts the production hostname is in `allowedDevOrigins`.

## 4. Origin/host-sensitive review (findings, not guesses)

| Area | Finding | Action |
|---|---|---|
| `lib/mcp/config.ts` `publicOrigin` | Pinned by `CO_NEWBIZ_PUBLIC_ORIGIN`; otherwise derived from `x-forwarded-host`/`host` + forwarded proto. The production env template did not mention it. | Documented in the Production section of `.env.sample`; operator sets `https://newbiz.bizknights.org`. |
| `httpsRequired` | In production requires `x-forwarded-proto: https` (or https URL). Cloudflare sets the header. | None; verify via tunnel. |
| `lib/auth.ts` CSRF | Cookie-authenticated mutations compare the `Origin` host with the `Host` header. Works only if the tunnel forwards the original Host (default; breaks if the tunnel config sets an `httpHostHeader` override). | Operator check. |
| Cookie flags | `httpOnly`, `sameSite=lax`, `path=/`, `secure` derived from forwarded proto, no `Domain`. Fine for a single host. | None. |
| OAuth redirect allowlist | `CO_NEWBIZ_OAUTH_REDIRECT_HOST_ALLOWLIST` is a list of client redirect hosts, unrelated to the server hostname; empty means https or loopback only. | Documented only. |
| `CO_NEWBIZ_MCP_ALLOWED_ORIGINS` | Extra browser origins for `/api/mcp`; public origin always allowed. | None. |
| Connected-apps screen | Connector URL uses `window.location.origin` (correct on the public host); no hardcoded port. | None. |

## 5. Operator-only verification

Not verifiable from the repository: the cloudflared tunnel config and its target; which containers are running; whether `.env.prod` has `CO_NEWBIZ_PUBLIC_ORIGIN`; whether the tunnel preserves the Host header. The cutover order (stop dev on 7749, start dev on 7748, `docker compose up -d`) and the rollback are in `docs/runbooks/deployment.md` (and `_ko`). Nothing was started or stopped while implementing this change.

## 6. Amendment: dev tunnel hostname

The Cloudflare public hostname `dev-newbiz.bizknights.org` fronts the dev server (`http://192.168.0.44:7748`). The dev server answered 403 for dev-only resources (`/_next/webpack-hmr`, dev chunks) when the request Origin was that hostname, so the page could not hydrate. `allowedDevOrigins` now also lists `dev-newbiz.bizknights.org`, the current Tailscale IPv4 `100.87.220.26` and its MagicDNS name `macmini.tail03efbe.ts.net`; all earlier entries are kept. Entries are bare hostnames or IPs (no scheme, no port). The built-in list now lives in `app/web-next/lib/dev-origins.ts` and is extended without code changes through `CO_NEWBIZ_ALLOWED_DEV_ORIGINS` (comma- or whitespace-separated bare hostnames or IPs). The variable is read from the process environment, else from the repo-root `.env` (Next itself loads only `app/web-next/.env*`; only this one key is parsed). Scheme, port and path are stripped with a warning, invalid tokens are rejected, and the result is merged with the built-in defaults and deduplicated. `next.config.ts` is evaluated once at startup and the root `.env` is not watched, so the dev server must be restarted after a change. Production builds ignore it. Any new Cloudflare or Tailscale hostname is therefore added to the root `.env`, not to code.

## 7. Amendment: production environment discoverability and boot warning

A separate `.env.prod.sample` cannot be tracked (`.env.*` is ignored and the workspace sensitive-file guard in `dev-sync` only allows `.env.sample` and `.env.example`), so the production origin settings are documented in a clearly labelled Production section of the tracked `.env.sample` (placeholders only; the real `.env.prod` stays ignored). That section and the deployment runbooks (`_ko` in sync) document `CO_NEWBIZ_PUBLIC_ORIGIN`, `CO_NEWBIZ_MCP_ALLOWED_ORIGINS`, `CO_NEWBIZ_OAUTH_REDIRECT_HOST_ALLOWLIST` and `CO_NEWBIZ_ALLOWED_DEV_ORIGINS` with purpose, format, default and when to set. The container reads `.env.prod`, not the root `.env`, and needs `docker compose up -d --force-recreate` to apply changes. The cookie-session CSRF check compares only the request Origin host with the Host header, so new public hostnames need no app setting.

At boot, `instrumentation.ts` calls the pure helper `lib/public-origin-check.ts`. When `NODE_ENV=production` and `CO_NEWBIZ_PUBLIC_ORIGIN` is unset or blank it logs one `console.warn` explaining the Host-header spoofing risk and the fix; it warns once if the value is not a valid http(s) origin (missing scheme, path, query or credentials; a trailing slash is accepted). It never throws and never blocks boot, and logs only the origin value itself.
