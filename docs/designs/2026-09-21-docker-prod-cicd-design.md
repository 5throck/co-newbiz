# Docker Production Deployment + CI/CD Pipeline

- Spec ID: `2026-09-21-docker-prod-cicd`
- Date: 2026-09-21
- Status: **Implemented**
- Related: ADR-0001 (SQLite — volume persistence), ADR-0006 (calibration methodology — Python-backed, see Limitations), ADR-0014 (deployment/rollback discipline), ADR-0019 (OS-level scheduler), ADR-0069/0070 (Next.js/Bun stack, Route Handler boundary), ADR-0075 (env/secret loading discipline), `docs/runbooks/deployment.md` §8

## Requirements

- REQ-P1: The production server is a Docker container on the operator workstation; development remains a direct host process (`bun --bun next dev -p 7749`, unchanged).
- REQ-P2: Production serves on host port **7748** → container 7749 (7749 belongs to dev; 8787 is occupied by an unrelated local Docker service).
- REQ-P3: CI builds the image on every push to `main` and publishes it to `ghcr.io/5throck/co-newbiz-web` (`latest` + `sha-<commit>`); PRs touching relevant paths build the image without pushing.
- REQ-P4: Applying a published image to production is a deliberate manual act: `scripts/deploy-web.ts` (pull → up → health-check gate; `--build` builds locally instead of pulling).
- REQ-P5: The SQLite database survives container replacement (named volume) and the ADR-0014 order — backup → migrate → health check — is enforced mechanically (entrypoint backup, boot migrations, script health gate), not by operator memory.
- REQ-P6: Secrets never enter git or the image: production config lives in host-local `.env.prod` (gitignored, compose `env_file`), templated by `.env.prod.sample`.
- REQ-P7: The container runs no in-process timers; scheduled jobs stay on the host OS scheduler (ADR-0019).

## Design

**Image** (`docker/Dockerfile`, context = repository root): multi-stage on `oven/bun:1`. The app imports the shared SQLite layer from `../../db` and parts of the root `scripts/` tree both at build time (Turbopack bundling: `proc-resolve.ts`, `source-adapters.ts`, `glossary-lint.ts`, `scripts/lib/auth.ts`) and at runtime (spawned subprocesses: `report.ts`, `newbiz.ts calibrate`, `job-worker.ts`); it also reads the governance trees at build (page-data collection) and runtime (`procedures/` via `proc-resolve.ts`/`_committees.yaml`, `process/flow.spec.yaml` via `spec-activities.ts`, `docs/adr` via the admin ADR route) — so the build context is the repo root under a whitelist `.dockerignore`, and the runtime image carries `db/`, `scripts/`, `procedures/`, `process/`, `docs/`, root `node_modules`, and the app bits. `bun install --ignore-scripts`: the slim image has no node-gyp toolchain and nothing imports `better-sqlite3`/`@prisma/adapter-better-sqlite3` at runtime (all DB access goes through `db/client.ts`'s `bun:sqlite`); no remaining dependency needs a postinstall. Non-root `bun` user; `prisma generate` gets a build-time `DATABASE_URL` so `prisma.config.ts` never reads an absent `.env`.

**Runtime-stage import-surface rule (extended 2026-11-29)**: two docker-exec-side import surfaces must resolve inside the runtime image, and every relative import they transitively reach must have a matching runtime COPY, pinned by `tests/unit/dockerfile-next-config-imports.test.ts` — (1) `next.config.ts`'s local imports (`lib/dev-origins.ts`, 2026-10-13), and (2) the docker-exec scheduler surface: `scripts/co-newbiz/schedule-tick.ts`, `scheduler-core.ts`, `run-job.ts`, `schedule-seed.ts`, `job-worker.ts` and every handler under `scripts/co-newbiz/jobs/` (ADR-0189) statically import `app/web-next/lib/**` at process start (schedule/cron.ts, dart-client, llm, the analysis pipeline reached via watch-run) plus `i18n/` and `locales/` data — the runtime stage therefore copies `lib/`, `i18n/` and `locales/` wholesale. Incident note (2026-11-29): prod ticks crashed every minute since ~Nov 20 because the scheduler feature (2026-10-29) added `lib/schedule/cron.ts` to the scripts→app import surface without extending the runtime COPY list; `schedule-tick` died at import (`Cannot find module '../../app/web-next/lib/schedule/cron.ts'`), the prod DB showed no heartbeat after 2026-11-19T12:33:21Z, and dev was unaffected (host process).

**Runtime**: the `co-newbiz-data` named volume is mounted at the app's own `<repo>/db/data` directory — deliberately NOT an arbitrary `/data` path with `CO_NEWBIZ_DB_PATH`, because `db/client.ts` derives `DB_DIR` (the migrations lookup root) as the DB path's grandparent, so an external DB path silently breaks boot migrations (`scandir '/migrations'`, found empirically in the first smoke test); the repo-layout mount keeps every default resolution correct. `CO_NEWBIZ_BOOTSTRAP_MIGRATIONS=auto` applies pending migrations at boot (`instrumentation.ts`) and bootstraps the first admin account on a fresh volume (random password printed once to the container log). `docker/entrypoint.sh` copies the quiescent SQLite file (server not yet running; WAL/SHM sidecars included) to `backups/pre-deploy-<timestamp>.db` (bind-mounted host dir) before the server can migrate — the §3.1 backup discipline, automated.

**CI/CD** (`.github/workflows/docker.yml`): PR job builds without pushing (GHA layer cache); `main` push job logs in to ghcr.io with the workflow `GITHUB_TOKEN` (`packages: write`) and pushes `latest` + `sha-<sha>`. Existing `ci.yml` (audit, secret-scan, unit tests) is untouched; this workflow only adds image build/publish. Deployment stays manual by design — `scripts/deploy-web.ts` records the previous image for a concrete rollback hint, then gates completion on `/api/health` polling (the §4 health-check discipline).

**Known limitations (accepted for v1)**: (1) Python-backed analysis subprocesses (proxy-chain calibration via `.venv/bin/python3`, ADR-0006) have no venv inside the image — those routes fail there; host-scheduler-driven batch collection remains the path for them (ADR-0019). (2) `playwright-core` has no browser binaries in the image — browser-rendering routes degrade. Both are documented in the deployment runbook §8 and are the first candidates if container parity gaps bite.

**Follow-up fix (same day, 2026-09-21)**: the admin ADR route (`app/api/admin/adr`) 500'd in the container — Turbopack rewrites `import.meta.dirname` to a synthetic import-meta object whose `dirname` is `undefined` at bundled runtime (`path.resolve(undefined, …)`). Fixed by locating `docs/adr` via a cwd walk-up (the `proc-resolve.ts` discipline), which also corrects a latent off-by-one in the original source-relative depth (`…/app/api/admin/adr` is 5 levels above the repo root, the code assumed 6).

## Verification

- [x] `docker build -f docker/Dockerfile -t co-newbiz-web:local .` succeeds from the whitelist context
- [x] `docker compose up -d` boots; first boot applies migrations + admin bootstrap; `http://127.0.0.1:7748/api/health` returns `{"status":"ok"}`
- [x] Data persists across `docker compose down && up` (named volume); dev server on 7749 unaffected
- [x] `bun scripts/deploy-web.ts --build` completes the full ADR-0014 order (backup written → migrate at boot → health gate passes)
- [x] `bun scripts/audit.ts` exit 0; `gitleaks detect` clean
- [x] CI run of `.github/workflows/docker.yml` green on the PR (build) and after merge (publish)
- [ ] Follow-up: in a throwaway container (fresh volume), admin login → `GET /api/admin/adr` returns 200 with non-empty `adrs` and `scanned_dir=/repo/docs/adr`

## Addendum (2026-11-28): Host-Side Production Port-Publish Invariant Probe

**Status: implemented (2026-11-28).** Probe: `scripts/co-newbiz/prod-port-probe.ts`; registration: `scheduler-install.ts --job port-probe` rendering `ops/scheduler/launchd/co-newbiz-portprobe.plist.tmpl`; tests: `tests/unit/prod-port-probe.test.ts`; runbook placement as designed (`docs/runbooks/deployment.md` §8, scheduler.md §10 pointer). This addendum extends the design above; the original requirements and verification record are unchanged. (REQ-P2's "7748 → 7749" predates the 2026-10-11 port swap — the layout this addendum designs against is the current one, host `127.0.0.1:7749` → container 7749, per `docker-compose.yml` and `docs/runbooks/deployment.md` §8.)

### Incident and detectable signature (2026-11-28, verified)

`co-newbiz-web` reported `healthy` and served `/api/health` correctly **inside** the container, while its host port publish was dead: `HostConfig.PortBindings` still carried the desired binding (`{"7749/tcp":[{"HostIp":"127.0.0.1","HostPort":"7749"}]}`), but the active mapping (`NetworkSettings.Ports`) was `{"7749/tcp":[]}` — nothing listened on host 127.0.0.1:7749, and the Cloudflare tunnel (`cloudflared`, targeting host 7749 for `https://newbiz.bizknights.org`) served nothing. `docker restart` did **not** fix it: the same container object replayed the dead state; only `docker compose up -d --force-recreate web` restored the mapping. Root cause: Docker Desktop (macOS) backend port-forward desync — a trigger outside this repository. The class-defining fact: **the compose healthcheck cannot see this outage** — it runs its `fetch` inside the container (`docker-compose.yml` healthcheck), so it stays green while every client outside the container is dark. "Container running and healthy with an empty active `NetworkSettings.Ports` for 7749/tcp" is the precise, detectable signature.

### Requirements

- REQ-P8: a host-side probe detects the dead-publish state within ~5 minutes of onset, independent of the container's own healthcheck, the app's notify pipeline, and the Cloudflare tunnel.
- REQ-P9: the probe distinguishes three outcomes — **OK / DEGRADED** (app unhealthy) **/ PUBLISH_DEAD** (publish invariant broken) — and prints one machine-readable line per run.
- REQ-P10: on any non-OK outcome the probe raises a host-visible alert that works when the app, the tunnel, and the container are all unavailable, and leaves a persistent log line.
- REQ-P11: the probe is scheduled by the host OS (launchd, ADR-0019/ADR-0189), never an in-process timer; it performs no DB writes and holds no secrets.

### Design

**Probe** (`scripts/co-newbiz/prod-port-probe.ts`, a short-lived host process — the dev-tick model, not the prod-tick `docker exec` model, because the HTTP check must originate on the host to exercise the publish). Two checks, invariant first:

1. **Publish invariant**: `docker inspect co-newbiz-web --format '{{json .NetworkSettings.Ports}}'` must show a non-empty host binding for `7749/tcp`. An empty array or absent key on a running container is PUBLISH_DEAD — the incident signature — and is checked before HTTP so the operator gets the specific diagnosis instead of an ambiguous "health check failed". For the alert body the probe also captures `HostConfig.PortBindings` as diagnostic detail: desired binding present → backend desync (force-recreate is the fix); absent → compose/config drift. Diagnostic only — the invariant itself keys on the active mapping alone.
2. **HTTP**: `GET http://127.0.0.1:7749/api/health` (the same constant `scripts/deploy-web.ts` gates on) must return 200.

Classification (invariant first, then HTTP):

| Publish invariant | HTTP | Outcome | Exit code |
|---|---|---|---|
| non-empty binding | 200 | OK | 0 |
| non-empty binding | fail | DEGRADED (`app_down`) | 1 |
| `docker inspect` fails, container missing or not running | any | DEGRADED (`docker_down`) | 1 |
| empty/absent binding on a running container | any | PUBLISH_DEAD | 2 |

Output: one JSON line per run, e.g. `{"ts":"2026-11-28T00:00:00.000Z","outcome":"PUBLISH_DEAD","sub_reason":null,"publish_binding":"present","http":"fail","detail":"container running but host 7749 unpublished"}`, on stdout — grep-shaped for the out-log patterns the scheduler runbook already uses. The classification is an exported pure function (`classifyOutcome`) so the unit test needs no Docker daemon and no network.

**Alerting**: on DEGRADED or PUBLISH_DEAD the probe (a) appends a line to `~/Library/Logs/co-newbiz/prod-port-probe.log` — the directory `scheduler-install.ts` already creates and manages (mode 0700 dir, 0600 files), so no new log location is invented — and (b) fires a macOS user notification: `osascript -e 'display notification "…" with title "co-newbiz prod" subtitle "PUBLISH_DEAD: host 7749 unpublished"'`. This is the only channel that survives the incident state by construction: the app's notify pipeline (SMTP `NOTIFY_SMTP_*`, webhook `NOTIFY_WEBHOOK_URL_OPS`) executes **inside the container** through the `notify.deliver` job against the prod DB (scheduled-jobs design §6/D11), and posting to the public origin traverses exactly the tunnel that is down — both channels are dark precisely when this probe must speak. A host-side SMTP re-send reusing the `NOTIFY_*` secrets would be container-independent but requires the probe to parse `.env.prod`, handle SMTP/TLS, and duplicate `notify-transport` — rejected for v1 (v2 candidate). The LaunchAgent runs in the user session, so the notification inherits the tick's accepted limitation (nothing fires while logged out — `docs/runbooks/scheduler.md` §1, owner decision D5); the log line persists regardless.

**Scheduling**: LaunchAgent per ADR-0019/ADR-0189 — label `org.bizknights.co-newbiz.prod.portprobe`; host process `bun scripts/co-newbiz/prod-port-probe.ts`; `StartInterval 300` (5 min); `RunAtLoad true` (probe once at load, so a dead publish left over from a previous session alerts immediately); `ProcessType Background`; explicit `PATH` pinned the same way the tick's plist is. Registration extends `scripts/co-newbiz/scheduler-install.ts` (a `--job port-probe` mode rendering a new `ops/scheduler/launchd/co-newbiz-portprobe.plist.tmpl`) rather than a hand-rolled plist — the installer stays the only supported registration path and its render / log-dir / PATH-pinning / bootstrap-bootout machinery is reused unchanged. Runbook placement decision: the registration and troubleshooting steps are documented in **`docs/runbooks/deployment.md` §8** (new subsection), not in scheduler.md — §8 owns the production container's health and recovery path (deploy-web.ts health gate, cutover steps), while scheduler.md is scoped to the job tick; scheduler.md §10 "Related" gains a one-line pointer as a follow-up.

**Recovery** (documented, not automated — v1 alerts; a human or operator script recovers):

```bash
docker compose up -d --force-recreate web   # plain docker restart replays the dead state (2026-11-28 incident)
```

### Tests

`tests/unit/prod-port-probe.test.ts`, following the existing pure-logic unit pattern (no daemon, no network — cf. `scheduler-p2-install.test.ts`): the full `classifyOutcome` matrix above; malformed `docker inspect` output classified as DEGRADED (`docker_down`), never silently as OK; container present but `State.Running` false classified DEGRADED, not PUBLISH_DEAD; and the one-line JSON output shape.

### Non-goals (v1) and rollback

Not in v1: **self-healing** — the probe never runs `--force-recreate` itself (an automated recreate could race an active deploy or an operator's intervention; a `--remediate` mode is a v2 candidate); no host-side SMTP/webhook alerting; no monitoring of `cloudflared` itself (the tunnel container has its own health state); no probe of the dev server (7748). The probe is strictly read-only — one `docker inspect`, one HTTP GET, zero DB writes, zero secrets held. Rollback is the inverse of registration: `launchctl bootout gui/$UID/org.bizknights.co-newbiz.prod.portprobe`, delete the plist, remove the script/template/test, and (optionally) the log file — no persistent state beyond the log.
