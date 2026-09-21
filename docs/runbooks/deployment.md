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

Runs on port 7749 by default (`package.json`'s `start` script; moved from 8787 — the Phase 5 cutover default, chosen back then for `CO_NEWBIZ_API_BASE_URL` compatibility — to 7749 on 2026-09-20 after an unrelated local Docker service took 8787 on operator machines). `bun --bun` is required, not plain `bun run` — Next's dev/start scripts otherwise execute under Node, which cannot resolve `bun:sqlite` (`db/client.ts`'s import), found empirically during Phase 2.

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
3. **Health check after** — `bun scripts/deploy-web.ts` polls `http://127.0.0.1:7748/api/health` and fails loudly (with rollback hints) if it does not pass. On failure: tag the previous image back (the script prints the exact `docker tag` command) and follow §6 for the database half — code rollback and DB rollback remain separate, sequenced actions.

Layout: host port **7748** → container 7749 (7749 belongs to the dev server; 8787 is taken by an unrelated local Docker service). The database lives in the `co-newbiz-data` named volume mounted at the app's own `<repo>/db/data` directory — never point `CO_NEWBIZ_DB_PATH` elsewhere, because `db/client.ts` derives the migrations location from the DB path's grandparent directory — so container replacement never touches data. Secrets live only in the host-local `.env.prod` (create from `.env.prod.sample`; gitignored, never baked into the image). The repository is private, so the published package is private too: `docker login ghcr.io` once with a PAT holding `read:packages` before the first pull (repeat after PAT rotation).

§7 post-deployment checks apply unchanged: scheduled jobs stay registered at the **host OS scheduler** (launchd) per ADR-0019 — the container runs no in-process timers, and container replacement must not disturb the host scheduler registrations.

## 9. Related

- `docs/runbooks/backup-restore.md` — the rollback mechanism this runbook depends on
- `docs/security/security-baseline.md` — the pre-deployment gate this runbook executes
- `skills/deployment-and-release/SKILL.md`, `skills/db-migration-governance/SKILL.md` — the operational disciplines this runbook implements
