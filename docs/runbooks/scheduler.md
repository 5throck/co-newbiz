---
lang: en
counterpart: scheduler_ko.md
---

# Runbook — Scheduler Tick (OS Registration, Heartbeat, and Jobs)

**Owner**: infra-automation-engineer
**Audience**: operators, release-engineer, sre
**Design of record**: ADR-0189, `docs/designs/2026-10-29-scheduled-jobs-design.md` (§2.3 environments, §6 failure alerting, §7 installer, §8 P2, §9 manual tests)
**Status**: active (P2). The installer (`scripts/co-newbiz/scheduler-install.ts`) is shipped; registration is run by the operator. Prod registration lands with P7.

## 1. Model overview

One OS entry per environment fires `bun scripts/co-newbiz/schedule-tick.ts` every 60 seconds. The tick is a short-lived dispatcher: it writes the heartbeat, sweeps stale runs, reads `schedule_job` (enabled flag and cron) at fire time, spawns `run-job.ts` once per due job, and exits. It never runs handler code itself (ADR-0019/ADR-0189: the OS is the clock, the application never runs an in-app timer).

Two consequences to internalize:

- **Admin toggles and cron edits need no OS re-registration.** The OS entry is static; `schedule_job.enabled` and `cron_expr` are read at every tick, so a change from the `/admin/schedule` page takes effect within one minute.
- **Uninstalling the OS entry is the global kill switch.** With no tick, nothing fires — jobs are never dispatched, manual "run now" requests sit queued, and the heartbeat goes stale (a high-severity alert, design §6).

Environment split (design §2.3):

| Environment | OS entry (label / instance) | Tick command | DB |
|---|---|---|---|
| prod | `org.bizknights.co-newbiz.prod.tick` (launchd) | `docker exec -e CO_NEWBIZ_SCHEDULER_ENV=prod co-newbiz-web bun scripts/co-newbiz/schedule-tick.ts` | container volume |
| dev | `org.bizknights.co-newbiz.dev.tick` (launchd) | `<bun> scripts/co-newbiz/schedule-tick.ts` | `db/data/co-newbiz.sqlite` on the host |

The tick refuses to run without `CO_NEWBIZ_SCHEDULER_ENV` (`prod`|`dev`) and records the environment on every `job_run`, so a dev tick can never be mistaken for a prod run. Default cron expressions are evaluated on the KST wall clock (Asia/Seoul, no DST).

The launchd entry is a LaunchAgent (user session), not a LaunchDaemon: Docker Desktop runs in the user session, and the trade-off — accepted as owner decision D5 — is that **nothing runs while the user is logged out**.

## 2. Install (dev, macOS)

The installer is the only supported registration path. It renders `ops/scheduler/launchd/co-newbiz-tick.plist.tmpl`, writes the plist, creates the log directory, and calls `launchctl bootstrap gui/$UID` itself — you never call `launchctl` by hand to install.

1. **Preview the plan** (writes nothing, calls nothing):

   ```bash
   bun scripts/co-newbiz/scheduler-install.ts --env dev --dry-run
   ```

   Expected output (paths follow your home directory):

   ```
   [dry-run] would write plist: ~/Library/LaunchAgents/org.bizknights.co-newbiz.dev.tick.plist
   [dry-run] would create log dir ~/Library/Logs/co-newbiz (mode 0700) with log files (mode 0600):
   [dry-run]   ~/Library/Logs/co-newbiz/dev-tick.out.log
   [dry-run]   ~/Library/Logs/co-newbiz/dev-tick.err.log
   [dry-run] would run: launchctl bootstrap gui/${UID} ~/Library/LaunchAgents/org.bizknights.co-newbiz.dev.tick.plist
   ```

2. **Inspect the rendered plist** if you want to see exactly what launchd will load:

   ```bash
   bun scripts/co-newbiz/scheduler-install.ts --env dev --print
   ```

   What it contains: label `org.bizknights.co-newbiz.dev.tick`; `ProgramArguments` = `<bun> scripts/co-newbiz/schedule-tick.ts`; `WorkingDirectory` = the repository root (dev only); `EnvironmentVariables` = an explicit `PATH` (the bun directory plus the system paths — launchd's inherited PATH is minimal) and `CO_NEWBIZ_SCHEDULER_ENV=dev`; `StartInterval 60`; `RunAtLoad false`; `ProcessType Background`; `AbandonProcessGroup true` (mandatory: the tick spawns detached `run-job.ts` children and exits — without it launchd kills the children when the tick exits); log paths. **No secrets.**

3. **Install**:

   ```bash
   bun scripts/co-newbiz/scheduler-install.ts --env dev
   ```

   The installer prints `installed: <plist path>`, the log paths, and the `launchctl print` verify command. On failure it exits non-zero and prints the `launchctl bootstrap` error; if the label is already loaded, run `--uninstall` first (§8).

What gets written where:

| Artifact | Path | Mode |
|---|---|---|
| Plist | `~/Library/LaunchAgents/org.bizknights.co-newbiz.dev.tick.plist` | 0644 |
| Log directory | `~/Library/Logs/co-newbiz/` | 0700 |
| Stdout log | `~/Library/Logs/co-newbiz/dev-tick.out.log` | 0600 |
| Stderr log | `~/Library/Logs/co-newbiz/dev-tick.err.log` | 0600 |

Then seed the job rows (§6) — the tick without rows does nothing except write the heartbeat.

## 3. Install (prod)

The prod entry is registered on the same macOS host, but the tick runs **inside the container** via `docker exec` (design §2.3): one DB-writer topology, the container's environment carries the secrets, and no host mount of the prod SQLite file is needed.

```bash
bun scripts/co-newbiz/scheduler-install.ts --env prod
```

Implications to accept before installing:

- **The `co-newbiz-web` container must be up.** If it is down, `docker exec` fails every minute, launchd logs the failure to `~/Library/Logs/co-newbiz/prod-tick.err.log`, and the heartbeat goes stale → high alert (§6). That is the designed behaviour, not a malfunction — the fix is bringing the container back (`bun scripts/deploy-web.ts`), not disabling the tick.
- **No container env setup is required.** `docker exec` does not forward the launchd job's environment into the container, so the installer injects the environment into the exec itself — the prod `ProgramArguments` carry `-e CO_NEWBIZ_SCHEDULER_ENV=prod` inside the `docker exec` (the same flag is baked into the systemd `ExecStart` and the Task Scheduler `Arguments`). Rendered by `bun scripts/co-newbiz/scheduler-install.ts --env prod --print`:

  ```
  	<key>ProgramArguments</key>
  	<array>
  		<string>docker</string>
  		<string>exec</string>
  		<string>-e</string>
  		<string>CO_NEWBIZ_SCHEDULER_ENV=prod</string>
  		<string>co-newbiz-web</string>
  		<string>bun</string>
  		<string>scripts/co-newbiz/schedule-tick.ts</string>
  	</array>
  ```

- **Prod jobs are seeded enabled; dev jobs are seeded disabled** (owner decision D3) — see §6.

## 4. Other OS paths (documented, not auto-installed)

The installer supports the same CLI for systemd (Linux) and Windows Task Scheduler, but neither platform is bootstrapped automatically: the installer writes files and prints commands, and never executes `systemctl` or `schtasks`.

**systemd user timer** — `--platform systemd` renders `ops/scheduler/systemd/co-newbiz-tick@.service` and `.timer` into `~/.config/systemd/user/`, then prints:

```bash
systemctl --user daemon-reload
systemctl --user enable --now co-newbiz-tick@<env>.timer
```

The timer fires every minute (`OnCalendar=*-*-* *:*:00`, `Persistent=false` — missed minutes are handled by the tick's own catch-up policy, §7). Run these two commands yourself; the installer never does. Uninstall: `--uninstall` prints the `systemctl --user disable --now co-newbiz-tick@<env>.timer` command and removes the shared template units (both environment instances stop).

**Windows Task Scheduler** — `--platform schtasks` prints the rendered XML from `ops/scheduler/schtasks/co-newbiz-tick.xml` and the registration command; nothing is written on the machine running the installer:

```
schtasks /Create /TN "co-newbiz-<env>-tick" /XML "<path-to-saved-xml>" /F
```

Save the XML to a file on the Windows host and run the command there. The task repeats every minute (`PT1M`, `StartWhenAvailable=true`). Uninstall on the Windows host: `schtasks /Delete /TN "co-newbiz-<env>-tick" /F`.

The same injection applies to the systemd and schtasks prod variants: the installer bakes `-e CO_NEWBIZ_SCHEDULER_ENV=prod` into the `ExecStart` / `Arguments` line, so the container itself needs no env setup.

## 5. Verify

### 5.1 launchd registration

```bash
launchctl print gui/$UID/org.bizknights.co-newbiz.dev.tick
```

Healthy output contains these key lines (exact format varies by macOS version):

```
org.bizknights.co-newbiz.dev.tick => ...
	program = /Users/<you>/.bun/bin/bun
	arguments = (
		0: /Users/<you>/.bun/bin/bun
		1: scripts/co-newbiz/schedule-tick.ts
	)
	state = waiting
	run interval = 60000 milliseconds
	last exit code = 0 (no error)
```

`state = waiting` between fires is normal. `last exit code = 0` after a fire means the tick ran clean; `could not find service` means the plist is not bootstrapped (rerun §2). For prod, use the `prod.tick` label.

### 5.2 Heartbeat

Every tick upserts `schedule_heartbeat(env, last_tick_at)` **before** doing anything else, so a later failure still shows that the tick fired (ADR-0189 decision 5). A heartbeat older than 3 minutes is a **high-severity** alert (design §6); the future admin health banner uses the same threshold.

Dev (host DB):

```bash
sqlite3 db/data/co-newbiz.sqlite "SELECT env, last_tick_at, CAST((strftime('%s','now') - strftime('%s', last_tick_at)) / 60 AS INTEGER) AS minutes_ago FROM schedule_heartbeat;"
```

Healthy: one row for `dev`, `minutes_ago` 0 or 1, refreshed every minute.

Prod (inside the container):

```bash
docker exec co-newbiz-web bun -e 'const { getDb } = await import("./db/client.ts"); console.log(getDb().query("SELECT env, last_tick_at FROM schedule_heartbeat").all())'
```

Run the tick by hand to see what the dispatcher decides (idempotent per minute — safe to run):

```bash
CO_NEWBIZ_SCHEDULER_ENV=dev bun scripts/co-newbiz/schedule-tick.ts
```

It prints a JSON summary (`env`, `tickAt`, `dispatched`, `skippedMissed`, `invalid`) and exits 0; exit code 2 means the environment variable is missing or the scheduler schema (migration 0183) is not applied.

### 5.3 Logs

| File | Content |
|---|---|
| `~/Library/Logs/co-newbiz/<env>-tick.out.log` | the tick's JSON summaries, one per minute |
| `~/Library/Logs/co-newbiz/<env>-tick.err.log` | tick failures: env refusal, DB/schema errors, `docker exec` failures (prod) |

Useful greps:

```bash
tail -20 ~/Library/Logs/co-newbiz/dev-tick.out.log
grep -c '"dispatched":\[\]' ~/Library/Logs/co-newbiz/dev-tick.out.log   # how many ticks fired nothing
tail -20 ~/Library/Logs/co-newbiz/dev-tick.err.log
```

The tick itself does no handler work, so a clean err log does not prove jobs succeed — check `job_run` (§9) for run outcomes.

## 6. Seeding

`schedule_job` rows are created **disabled** (owner decision D3) — enabling a job is a separate, deliberate admin action. Seeding is idempotent: an existing row is never touched, so an admin-edited cron or enabled flag is never overwritten.

Two paths, both writing the same registry rows for every registered handler:

**CLI (dev / operator):**

```bash
CO_NEWBIZ_SCHEDULER_ENV=dev bun scripts/co-newbiz/schedule-seed.ts --dry-run   # preview: no writes
CO_NEWBIZ_SCHEDULER_ENV=dev bun scripts/co-newbiz/schedule-seed.ts             # insert missing rows
```

Output is JSON: `{"env":"dev","dryRun":false,"inserted":[...],"existing":[...],"note":"rows are created disabled"}`. Pass `--db-path <path>` to target a specific database.

**Admin API (prod / server DB):** `POST /api/admin/schedule-jobs/seed` (admin-only, body `{"dryRun": true}` optional). Every non-dry-run call is audited (`schedule_job_seed`). Enable jobs afterwards from the `/admin/schedule` page (or `PATCH /api/admin/schedule-jobs/[jobKey]`) — the seed endpoint never enables a job.

Which rows exist is decided by the handler registry (`scripts/co-newbiz/jobs/index.ts`): as of P2, `watch.evaluate` (every 30 min) and `gate_integrity.shadow_report` (Mondays 08:00 KST). The `collect.*` and `retention.cleanup` handlers land in later phases (P5/P6); a re-seed after those phases adds the missing rows without touching existing ones.

A job only fires on schedule when its row is **enabled**. A manual `run-job.ts` invocation runs a job even when it is disabled (`CO_NEWBIZ_SCHEDULER_ENV=dev bun scripts/co-newbiz/run-job.ts --job <job_key>`; actor defaults to `operator:cli`) — "disabled" stops the tick from firing it, it is not a hard off-switch.

## 7. Sleep/wake catch-up

The LaunchAgent does not fire while the host sleeps. At the first tick after wake, a fire whose cron minute is more than 2 minutes in the past counts as **missed**, and each job's catch-up policy decides (design §3.4, owner decision D7):

| Job family | Policy | Behaviour after sleep |
|---|---|---|
| `watch.evaluate` | skip | missed fires are consumed without a run; the next slot is at most 30 minutes away |
| collect / retention / report | run once | a single catch-up run with `trigger = 'catchup'`; `gate_integrity.shadow_report` only within 7 days of the missed fire |

How to check after a wake:

1. The first post-wake tick summary lists what happened — `dispatched` entries with `"trigger":"catchup"` and `skippedMissed` entries:

   ```bash
   tail -5 ~/Library/Logs/co-newbiz/dev-tick.out.log
   ```

2. Or query the audit trail:

   ```bash
   sqlite3 db/data/co-newbiz.sqlite "SELECT job_key, started_at, \"trigger\", status FROM job_run WHERE \"trigger\" = 'catchup' ORDER BY started_at DESC LIMIT 5;"
   ```

## 8. Uninstall

```bash
bun scripts/co-newbiz/scheduler-install.ts --env dev --uninstall
```

The installer calls `launchctl bootout gui/$UID` on the label (best-effort; a not-loaded label does not fail the uninstall) and removes **only that environment's plist**. Other LaunchAgents are never touched. Preview the plan with `--dry-run` first if you want.

This is the global kill switch for that environment: no tick → no scheduled or manual job runs → heartbeat goes stale within 3 minutes. `schedule_job` rows, `job_run` history, and the admin page are untouched. If both environments are registered on one host, uninstall each env explicitly (`--env dev`, then `--env prod`).

For systemd: `--uninstall` prints the disable command and removes the shared template units. For schtasks: `--uninstall` prints the `schtasks /Delete` command (run it on the Windows host).

## 9. Troubleshooting

| Symptom | Likely cause | Action |
|---|---|---|
| `launchctl print ... could not find service` | plist not bootstrapped, or removed | rerun the installer (§2/§3); if `launchctl bootstrap` reports the label already loaded, `--uninstall` first |
| `last exit code` non-zero in `launchctl print` | tick crashed or refused | read `<env>-tick.err.log`; exit code 2 with `CO_NEWBIZ_SCHEDULER_ENV must be set` on prod = the installed entry lacks the `-e CO_NEWBIZ_SCHEDULER_ENV=prod` exec flag — check with `bun scripts/co-newbiz/scheduler-install.ts --env prod --print`, then `--uninstall` and re-install (§3) |
| Nothing in `out.log`, no new fires | launchd not firing at all | confirm the plist exists and `launchctl print` shows `run interval = 60000`; log out/in reloads LaunchAgents; check `err.log` for spawn errors |
| Heartbeat `minutes_ago` > 3 | tick not firing (high alert, §6) | work through the rows above; the heartbeat only moves when a tick actually completes |
| `bun: command not found` in `err.log` | bun moved/removed; the plist PATH pins the bun directory captured at install time | reinstall the bun binary, then `--uninstall` + reinstall the tick so the PATH is re-rendered |
| Job rows stay idle, heartbeat fresh | jobs seeded but not enabled (D3) | enable from `/admin/schedule`; verify with `sqlite3 db/data/co-newbiz.sqlite "SELECT job_key, enabled, cron_expr FROM schedule_job;"` |
| A job fails or times out | handler error, timeout, or crash | `sqlite3 db/data/co-newbiz.sqlite "SELECT job_key, started_at, status, substr(COALESCE(error,''),1,200) FROM job_run WHERE env IS NOT NULL ORDER BY started_at DESC LIMIT 10;"` — `error` is scrubbed (secret-looking text redacted) and truncated to 2 KB; `status = 'timeout'` with `error = 'timeout_or_crash'` means the process was killed and the next tick's sweep closed the row |
| Same job fails 3 times in a row | recurring failure | design §6 makes this a high alert; fix the cause (credentials, network) before re-enabling; a missing API key ends the run `skipped` with `credential_missing`, not `failed` |
| Prod: heartbeat stale, `docker exec` errors in `prod-tick.err.log` | container down or restarting | `docker ps`, then redeploy with `bun scripts/deploy-web.ts`; do not disable the tick — a stale heartbeat while the container is down is the designed alert |

The full SRE alert set (heartbeat, job overdue, 3 consecutive failures) is specified in design §6; the "run now" request path (enqueue → next tick claims) never executes a job in the web process (ADR-0019/ADR-0189).

## 10. Related

- `docs/runbooks/deployment.md` — deployment pipeline; §8 documents the prod container the prod tick executes into
- `docs/runbooks/rag-host-scheduler.md` — the pre-ADR-0189 host-level RAG staleness job (independent of this tick)
- `docs/adr/0189-amend-adr-0019-launchd-and-docker-scheduler-model.md`, `docs/designs/2026-10-29-scheduled-jobs-design.md` — decisions D1–D8 and the installer contract
