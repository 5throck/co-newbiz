# Runbook — Deployment and Release

**Owner**: release-engineer, platform-lead
**Design of record**: ADR-0014, `docs/security-baseline.md` §2 (pre-deployment gate)
**Status**: Stage 5 Wave 5.9. Covers what actually exists today — `app/server/` (Hono API + static-served SPA) and `mcp/co-newbiz/` (stdio MCP server). No containerization/orchestration layer exists yet; this runbook is for a direct-process deployment.

## 1. Pre-Deployment Gate (`docs/security-baseline.md` §2)

Run before every release, no exceptions:

1. **Secrets/dependency scan**: `gitleaks detect -v --source .` — 0 leaks required. Weekly cadence also covers this; a release doesn't skip it because the weekly scan ran recently.
2. **Test suite**: `bun test` — 0 failures required.
3. **Audit gate**: `bun scripts/audit.ts` — 0 errors required (warnings reviewed, not necessarily blocking).
4. **Threat-model currency check**: if this release touches a trust boundary (new API endpoint, new MCP tool, new auth path), confirm `docs/security-model.md` §2's STRIDE matrix and §8's verification-status table are still accurate — update them in the same PR, not as a follow-up.

## 2. Build

```bash
cd app/web && bun install && bun run build   # SPA -> app/web/dist
```

`app/server/index.ts` serves `app/web/dist` automatically once it exists (checked via `existsSync` at `buildApp()` time — see the routing-precedence comment in that file, which documents a real bug Wave 5.6B found and fixed: static-serve middleware must be registered before the auth-gated API routers, not after, or it never gets a chance to run).

## 3. Database

1. **Backup immediately before migrating** (`docs/runbooks/backup-restore.md` §2-3) — this is the release's rollback plan, not a separate step someone might skip under time pressure.
2. `bun scripts/co-newbiz/newbiz.ts db:migrate` — applies any pending `db/migrations/*.sql` in filename order.
3. Confirm every new migration in this release is tagged `@reversible: true|false` (`db-migration-governance`) — an irreversible one requires joint release-engineer + dba sign-off, obtained before this step, not after.

## 4. Start the Server

```bash
CO_NEWBIZ_PORT=8787 bun run app/server/index.ts
```

Health check: `GET /api/health` should return `{"status":"ok"}`. This is the "health check immediately after" step ADR-0014 requires — confirm it before considering the release complete, not just that the process started without crashing.

## 5. MCP Server (Per Client)

The MCP server is launched per-client via each AI client's own config (`.mcp.json` for Claude Code; see `docs/mcp-integration.md` §4 for the other three clients' config locations) — it is not a separately deployed service, each client spawns its own `bun run mcp/co-newbiz/index.ts` process over stdio. A release that changes the REST API surface should confirm the MCP tool layer still passes `tests/unit/mcp.test.ts`'s real stdio-transport test, not just the `dispatch()`-level tests, since that's the one that actually exercises the JSON-RPC wire protocol a real client uses.

## 6. Rollback

If the health check fails or a post-deploy issue surfaces: `docs/runbooks/backup-restore.md` §3's rollback procedure — restore the pre-migration backup taken in step 3.1 above, then redeploy the prior release's code. Database rollback and code rollback are two separate, sequenced actions; restoring the DB alone against newer code (or vice versa) is not a valid rollback state.

## 7. Post-Deployment

1. Confirm scheduled jobs are still registered with the OS scheduler after the deploy (`batch-scheduling-operations`) — a deploy process that doesn't preserve OS-level scheduler registrations is a real risk this check exists to catch.
2. Confirm `observability-and-alerting`'s job-run monitoring shows the expected jobs running on schedule post-deploy, not just that the deploy itself succeeded.

## 8. Related

- `docs/runbooks/backup-restore.md` — the rollback mechanism this runbook depends on
- `docs/security-baseline.md` — the pre-deployment gate this runbook executes
- `skills/deployment-and-release/SKILL.md`, `skills/db-migration-governance/SKILL.md` — the operational disciplines this runbook implements
