# ghcr Image Retention + deploy-web.ts Restoration

- Spec ID: `2026-09-23-docker-image-retention-deploy-restore`
- Date: 2026-09-23
- Status: **Implemented**
- Related: design `2026-09-21-docker-prod-cicd` (REQ-P3 `sha-<commit>` publishing, REQ-P4 deploy script), `docs/runbooks/deployment.md` §8, `docker-compose.yml`, ADR-0074 (Universal Design Gate)

## Background

Two defects surfaced after the 2026-09-21 Docker cutover, both found while
diagnosing rapid host-disk growth:

1. Every push to `main` publishes a new `ghcr.io/5throck/co-newbiz-web`
   version (`latest` + `sha-<commit>`, design `2026-09-21-docker-prod-cicd`
   REQ-P3). No retention rule existed, so package versions accumulate
   without bound on the GitHub Packages side.
2. `scripts/deploy-web.ts` went missing from the working tree at HEAD. The
   runbook (`deployment.md` §8), the compose file header, and the
   `2026-09-21-docker-prod-cicd` design (REQ-P4) all instruct the operator
   to run it. `git log` shows it was deleted by `b0af650f` ("chore: upgrade
   template delivery — fleet resync wave 2"), a fleet-wide template wave
   that swept repo-specific files; the deletion is not reflected in any
   design or changelog entry, so it is treated as an unintended casualty.

Separately (same investigation, no repo change): local Docker.raw growth
was bounded by pruning the BuildKit cache and lowering the daemon
`defaultKeepStorage` GC budget from 20GB to 10GB in `~/.docker/daemon.json`
— host-local config, outside this repository.

## Requirements

- REQ-R1: The `co-newbiz-web` container package retains only a bounded
  window of image versions: the **10 most recent** versions stay, older
  versions are deleted automatically on a weekly schedule.
- REQ-R2: The currently deployable image is never at risk: deploys pull
  `latest`, which is always the newest version, so the retention window
  always covers it.
- REQ-R3: The retention job is manually triggerable (`workflow_dispatch`)
  so the operator can reclaim registry storage on demand.
- REQ-D1: `scripts/deploy-web.ts` is restored from the last-good commit
  (`b0af650f^`), byte-identical to its reviewed state.
- REQ-D2: The restored script passes the repository typecheck gate and
  remains consistent with the current runtime contract (`docker-compose.yml`
  service `web`, image `ghcr.io/5throck/co-newbiz-web:latest`, host port
  7748, `/api/health` gate, `--build` local build path).

## Design

**Retention workflow** (`.github/workflows/docker.yml` sibling,
`docker-cleanup.yml`): a scheduled job (`cron`, weekly, off-peak KST
morning) plus `workflow_dispatch`, with top-level `packages: write`. It
runs the official `actions/delete-package-versions@v5` against
`package-name: co-newbiz-web`, `package-type: container`,
`min-versions-to-keep: 10`. Each push to `main` creates exactly one
package version (carrying both `latest` and `sha-<commit>` tags), so
"keep 10" means "the last 10 published images"; the action deletes
older versions together with their `sha-*` tags. No checkout step is
needed — the action works against the Packages API with the workflow
`GITHUB_TOKEN`. The package is linked to this repository (first publish
used the repo's `GITHUB_TOKEN`), which is the required precondition for
token-based deletion.

**Script restoration**: `git restore --source=b0af650f^ -- scripts/deploy-web.ts`.
The restored file keeps its original single-responsibility flow — record
current container image (for the concrete rollback hint) → pull (or
`--build`) → `compose up -d` → poll `/api/health` → exit with rollback
instructions on failure — and imports only the still-present
`scripts/lib/error-handling.ts`. No behavioral change is introduced; the
restore exists to make the documented operator path (`deployment.md` §8)
real again.

## Verification

- [x] `bun scripts/typecheck.ts` — zero errors over `scripts/` including
      the restored file
- [x] `bun scripts/audit.ts` exit 0
- [x] Workflow YAML loads as valid YAML; job has least-privilege
      `packages: write` only
- [ ] Follow-up (post-merge): trigger `gh workflow run docker-cleanup.yml`
      once and confirm the run deletes versions older than the newest 10
      of `co-newbiz-web`
