---
lang: en
counterpart: deployment_ko.md
---

# Runbook — Deployment and Release

**Owner**: release-engineer, platform-lead
**Design of record**: ADR-0014, `docs/security/security-baseline.md` §2 (pre-deployment gate)
**Status**: Post-cutover (ADR-0069/0070, Phase 5/6, 2026-08-26). Covers what actually exists today — `app/web-next/` (Next.js, serves both the REST API under `/api/**` and the web UI) and `mcp/co-newbiz/` (stdio MCP server). `app/server/` (Hono) and the old `app/web/` (Vite SPA) were decommissioned in Phase 6 — see `docs/designs/2026-08-25-web-stack-migration-nextjs-prisma_ko.md` for the migration record. As of 2026-09-21 production runs as a Docker container on the operator workstation (§9); development runs as a direct process on the host (§2–§4).

## 1. Pre-Deployment Gate (`docs/security/security-baseline.md` §2)

Run before every release, no exceptions:

1. **Secrets/dependency scan**: `gitleaks detect -v --source .` — 0 leaks required. Weekly cadence also covers this; a release doesn't skip it because the weekly scan ran recently.
2. **Test suite**: `bun test` — 0 failures required.
3. **Audit gate**: `bun scripts/audit.ts` — 0 errors required (warnings reviewed, not necessarily blocking).
4. **Threat-model currency check**: if this release touches a trust boundary (new API endpoint, new MCP tool, new auth path), confirm `docs/security/security-model.md` §2's STRIDE matrix and §8's verification-status table are still accurate — update them in the same PR, not as a follow-up.

## 2. Build (Development / Direct-Process)

```bash
cd app/web-next && bun install && bun run build
```

Next.js's own build serves both `/api/**` (Route Handlers) and the App Router pages from one process — no separate static-serve step or dist-directory existence check is needed (that was `app/server/index.ts`'s Hono-era mechanism, retired in Phase 6).

## 3. Database

1. **Backup immediately before migrating** (`docs/runbooks/backup-restore.md` §2-3) — this is the release's rollback plan, not a separate step someone might skip under time pressure.
2. `bun scripts/co-newbiz/newbiz.ts db:migrate` — applies any pending `db/migrations/*.sql` in filename order.
3. Confirm every new migration in this release is tagged `@reversible: true|false` (`db-migration-governance`) — an irreversible one requires joint release-engineer + dba sign-off, obtained before this step, not after.

## 4. Start the Server

```bash
cd app/web-next && bun --bun run start
```

Runs on port 7748 by default (`package.json`'s `dev`/`start` scripts; 8787 until 2026-09-20, then 7749, then swapped to 7748 on 2026-10-11 so that 7749 can belong to the Docker production container the Cloudflare tunnel targets). `bun --bun` is required, not plain `bun run` — Next's dev/start scripts otherwise execute under Node, which cannot resolve `bun:sqlite` (`db/client.ts`'s import), found empirically during Phase 2.

Health check: `GET /api/health` should return `{"status":"ok"}`. This is the "health check immediately after" step ADR-0014 requires — confirm it before considering the release complete, not just that the process started without crashing.

## 5. MCP Server (Per Client)

The MCP server is launched per-client via each AI client's own config (`.mcp.json` for Claude Code; see `docs/architecture/mcp-integration.md` §4 for the other three clients' config locations) — it is not a separately deployed service, each client spawns its own `bun run mcp/co-newbiz/index.ts` process over stdio. A release that changes the REST API surface should confirm the MCP tool layer still passes `tests/unit/mcp.test.ts`'s real stdio-transport test, not just the `dispatch()`-level tests, since that's the one that actually exercises the JSON-RPC wire protocol a real client uses.

## 6. Rollback

If the health check fails or a post-deploy issue surfaces: `docs/runbooks/backup-restore.md` §3's rollback procedure — restore the pre-migration backup taken in step 3.1 above, then redeploy the prior release's code. Database rollback and code rollback are two separate, sequenced actions; restoring the DB alone against newer code (or vice versa) is not a valid rollback state.

## 7. Post-Deployment

1. Confirm scheduled jobs are still registered with the OS scheduler after the deploy (`batch-scheduling-operations`) — a deploy process that doesn't preserve OS-level scheduler registrations is a real risk this check exists to catch.
2. Confirm `observability-and-alerting`'s job-run monitoring shows the expected jobs running on schedule post-deploy, not just that the deploy itself succeeded.

## 8. Container Production Deployment (Docker)

As of 2026-09-21 the production server is the Docker container built from `docker/Dockerfile` and deployed on the operator workstation; development stays a direct host process (§2–§4). The CI/CD split: **CI** — every push to `main` builds the image and pushes it to `ghcr.io/5throck/co-newbiz-web` (`latest` + `sha-<commit>` tags; `.github/workflows/docker.yml`); PRs touching the app build the image without pushing, so Dockerfile breakage is caught before merge. **CD** — deploying the pushed image to the production container is a deliberate manual act: `bun scripts/deploy-web.ts` (or `--build` to build locally instead of pulling).

Deployment maps one-to-one onto the ADR-0014 discipline:

1. **Backup before migration** — `docker/entrypoint.sh` copies the SQLite file (plus WAL/SHM sidecars; the server is not yet running, so a plain copy is consistent) to `backups/pre-deploy-<timestamp>.db` on every container start that finds an existing database.
2. **Migrate** — server boot applies pending migrations automatically (`CO_NEWBIZ_BOOTSTRAP_MIGRATIONS=auto`, `app/web-next/instrumentation.ts`); a fresh volume also bootstraps the first admin account (random password printed once to the container log — capture it: `docker logs co-newbiz-web | grep -i password`).
3. **Health check after** — `bun scripts/deploy-web.ts` polls `http://127.0.0.1:7749/api/health` and fails loudly (with rollback hints) if it does not pass. On failure: tag the previous image back (the script prints the exact `docker tag` command) and follow §6 for the database half — code rollback and DB rollback remain separate, sequenced actions.

Layout: host port **7749** → container 7749 (compose `7749:7749`; the dev server runs on 7748; 8787 is taken by an unrelated local Docker service). The database lives in the `co-newbiz-data` named volume mounted at the app's own `<repo>/db/data` directory — never point `CO_NEWBIZ_DB_PATH` elsewhere, because `db/client.ts` derives the migrations location from the DB path's grandparent directory — so container replacement never touches data. Secrets live only in the host-local `.env.prod` (create from the Production section of `.env.sample`; gitignored, never baked into the image). The repository is private, so the published package is private too: `docker login ghcr.io` once with a PAT holding `read:packages` before the first pull (repeat after PAT rotation).

§7 post-deployment checks apply unchanged: scheduled jobs stay registered at the **host OS scheduler** (launchd) per ADR-0019 — the container runs no in-process timers, and container replacement must not disturb the host scheduler registrations.

### Operator cutover steps (2026-10-11 port swap)

The Cloudflare tunnel (`cloudflared`, a docker container on the operator machine, configured outside this repository) targets host port 7749 for `https://newbiz.bizknights.org`. Until the swap, 7749 was the dev server; afterwards it is the production container. Run in order:

```bash
# 1. stop the dev server that currently holds 7749 (Ctrl-C in its terminal, or)
lsof -ti tcp:7749 | xargs kill
# 2. start dev on the new dev port
cd app/web-next && bun run dev            # http://localhost:7748
# 3. start production (pull the latest image first, or add --build to build locally)
docker compose pull web && docker compose up -d
bun scripts/deploy-web.ts                 # alternative: pull + up + health check in one step
curl -s http://127.0.0.1:7749/api/health  # expect {"status":"ok"}
curl -sI https://newbiz.bizknights.org/ | head -1
```

Any new Cloudflare or Tailscale hostname that fronts the dev server (for example `dev-newbiz.bizknights.org`) must be listed in `CO_NEWBIZ_ALLOWED_DEV_ORIGINS` in the root `.env` (comma- or space-separated bare hostnames or IPs, no scheme or port; no code change needed). Restart the dev server afterwards: `next.config` is evaluated at startup and the root `.env` is not watched. Otherwise the dev server returns 403 for `/_next/webpack-hmr` and dev chunks and the page cannot hydrate. Production builds ignore this variable.

Also set `CO_NEWBIZ_PUBLIC_ORIGIN=https://newbiz.bizknights.org` in `.env.prod` (see the Production section of `.env.sample`) and update any local MCP client config to `CO_NEWBIZ_API_BASE_URL=http://localhost:7748` (or the public URL). The production container starts with a fresh volume unless `co-newbiz-data` already exists; on first boot capture the admin password with `docker logs co-newbiz-web | grep -i password`.

Rollback: `docker compose down`, then start the dev server on 7749 again (`cd app/web-next && bun --bun next dev -p 7749`) so the tunnel serves it as before; revert the port swap commit to restore the scripts.

### Production environment settings

The container reads `.env.prod` (compose `env_file`), **not** the root `.env`. Create it by copying the commented lines of the Production section of the tracked `.env.sample` (placeholders only; the real file stays gitignored). Changes apply only after `docker compose up -d --force-recreate`.

| Variable | Purpose | Format | Default | When to set |
|---|---|---|---|---|
| `CO_NEWBIZ_PUBLIC_ORIGIN` | Pins the OAuth issuer and the MCP resource identifier. Without it the origin comes from the request Host header, which a spoofed Host can change. | `https://host[:port]`, no path | unset | Always in production (boot logs a warning if unset or malformed) |
| `CO_NEWBIZ_MCP_ALLOWED_ORIGINS` | Extra browser Origins allowed to call `/api/mcp`; the public origin is always allowed. | comma list of origins | empty | Only when a browser app on another origin calls `/api/mcp` |
| `CO_NEWBIZ_OAUTH_REDIRECT_HOST_ALLOWLIST` | Hosts allowed as OAuth client redirect targets. | comma list of hosts | empty (https or loopback only) | Only for OAuth clients redirecting to other hosts |
| `CO_NEWBIZ_ALLOWED_DEV_ORIGINS` | Dev server HMR hostnames. | bare hostnames/IPs | built-in list | Development only (root `.env`); ignored in production |

The cookie-session CSRF check only compares the request Origin host with the Host header, so a new public hostname needs no app setting unless it calls `/api/mcp` from a browser.

## 9. Related

- `docs/runbooks/backup-restore.md` — the rollback mechanism this runbook depends on
- `docs/security/security-baseline.md` — the pre-deployment gate this runbook executes
- `skills/deployment-and-release/SKILL.md`, `skills/db-migration-governance/SKILL.md` — the operational disciplines this runbook implements
