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
