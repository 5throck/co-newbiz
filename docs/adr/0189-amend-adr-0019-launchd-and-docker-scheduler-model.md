# ADR-0189: Amend ADR-0019 — macOS launchd, a single minute-tick dispatcher, and the Docker production model

**Status**: Accepted (owner merge of #773, 2026-10-29)
**Date**: 2026-10-29
**Deciders**: PM (approval); proposed by platform-lead; reviewers infra-automation-engineer, sre, security-engineer, data-architect
**Amends**: ADR-0019 (OS-level scheduler for periodic collection)
**Design of record**: `docs/designs/2026-10-29-scheduled-jobs-design.md`

## Context

ADR-0019 requires periodic work to be fired by the OS scheduler rather than an in-app timer, naming Windows Task Scheduler and systemd. The actual host is macOS, production runs as the Docker container `co-newbiz-web` (port 7749) on that host, and dev runs as a host process (port 7748). No OS registration exists, so no scheduled job has ever run. The owner selected four job families on 2026-10-29 (watch evaluation, external data collection, retention cleanup, gate-integrity weekly report) and wants admin enable/disable and cron edits to take effect without re-registering OS entries.

## Decision

1. **Supported OS schedulers**: launchd (macOS, primary, implemented by the installer), systemd user timers (Linux, templated and documented), Task Scheduler (Windows, templated and documented).
2. **One OS entry per environment, firing every minute**: the OS launches `bun scripts/co-newbiz/schedule-tick.ts`, a short-lived dispatcher that reads `schedule_job` (enabled, cron) and pending manual requests, then spawns `run-job.ts` per due job and exits. Cron evaluation happens in application code; the clock stays with the OS. Per-job OS entries are not used.
3. **Docker production model**: the prod entry runs `docker exec co-newbiz-web bun scripts/co-newbiz/schedule-tick.ts`, so jobs execute inside the container against the container's DB and environment. Dev runs the tick as a host process against the dev DB. Each run records its environment; the tick refuses to start without `CO_NEWBIZ_SCHEDULER_ENV`.
4. **No in-process execution from the web server**: the admin "run now" action only enqueues a request row; the next tick executes it.
5. **Heartbeat**: every tick writes a heartbeat; a stale heartbeat is a high-severity SRE alert. This replaces "job_run is checked first" as the primary did-it-fire signal; `job_run` remains the per-run audit trail.

## Consequences

- Admin toggles and cron edits take effect within one minute with no OS re-registration and no privileged call from the web container.
- A broken tick stops all jobs; the heartbeat alert is the required mitigation.
- A macOS LaunchAgent only runs while the owner's user session is active (Docker Desktop has the same constraint); a move to a Linux host would switch to the documented systemd path without changing application code.
- `schedule_job`, `job_run` and new lock/request/heartbeat tables change shape. Decided (owner, 2026-10-29): this ADR governs that schema change (design §3.4–3.5): additive `job_run` columns (trigger, actor, env, row counts, attempt, detail_json; status adds `skipped`, `timeout`), `schedule_job` columns (display_name, description, timeout_sec, max_retries, updated_at, updated_by, last_fire_minute), and new tables `schedule_job_lock`, `schedule_job_request`, `schedule_heartbeat`. Notification delivery schema is governed separately by ADR-0190.
- ADR-0019's core rule (no in-app timers) is preserved and strengthened.

## Owner decisions

All of the following are Decided (owner, 2026-10-29), approved as recommended. Design §10 has the full wording.

- D1 Collection frequency: DART weekdays 07:00, ECOS daily 08:00, KRX weekdays 18:30, KOSIS Mondays 09:00, law daily 06:00 (KST).
- D2 Retention defaults: `job_run` deleted after 12 months, `notification` archived after 12, `raw_payload` archived after 24, terminal `execution_job` rows deleted after 6. `audit_log` is never eligible. The final table list is confirmed by dba.
- D3 Both environments register the tick. Prod jobs are enabled; dev jobs are seeded disabled.
- D4 `watch.evaluate` runs every 30 minutes, with a 5-minute minimum.
- D5 LaunchAgent (user session), accepting that nothing runs while the owner is logged out.
- D6 Retention archive goes to `db/archive/` inside the backed-up volume.
- D7 After host sleep, catch-up runs once for collection, retention and report jobs, and is skipped for watch.
- D8 `execution_job` is not reused as the scheduler queue; only its stale-reclaim pattern is reused.

## Alternatives considered

- **Per-job launchd plists**: rejected — edits require `launchctl` re-registration from the admin path, and launchd calendar intervals cannot express common cron patterns without enumeration.
- **In-container cron daemon**: rejected — dies with the container and duplicates the OS role ADR-0019 assigns to the host.
- **Reuse `execution_job` / `job-worker.ts` as the scheduler queue**: deferred — that queue serves the simulation runtime with resource classes; its stale-reclaim pattern is reused instead.

## Decision log

- 2026-10-29: Accepted by the owner's merge of #773.
- 2026-10-29: Owner reordered the rollout phases so notifications follow the runner immediately: P1 runner, P2 OS registration and dev soak, P3 notification delivery (ADR-0190), P4 notification history, watch management and test send, P5 collection, P6 retention, P7 admin job CRUD UI and prod rollout. See design section 8.
- 2026-10-29: P1 records scheduler failures in `job_run` only; the `batch_failure` notification awaits the nullable `notification.project_id` (ADR-0190, P3).
