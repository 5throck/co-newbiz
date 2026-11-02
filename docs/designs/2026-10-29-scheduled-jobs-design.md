# Scheduled Jobs — OS Registration, Runner, and Admin CRUD (Proposed)

- **Date**: 2026-10-29
- **Status**: Accepted (owner merge of #773, 2026-10-29; D1–D8 decided by owner 2026-10-29; phase order revised 2026-10-29)
- **Author**: platform-lead (technical domain lead), under PM dispatch
- **Related**: ADR-0019 (OS-level scheduler), ADR-0189 (amendment: launchd + Docker production model), ADR-0190 (notification delivery), ADR-0011 (MCP never touches the DB), ADR-0012 (append-only audit), ADR-0017 (deterioration notifications), ADR-0186 (gate integrity), FR-MON-01, `docs/runbooks/deployment.md`
- **Owner selection (2026-10-29)**: watch-rule evaluation; external data collection (DART, ECOS, KRX, KOSIS, law); retention cleanup; gate-integrity weekly shadow report

## 1. Problem

ADR-0019 requires periodic work to be fired by the OS scheduler, not an in-app timer, but nothing is registered: no launchd/systemd/Task Scheduler entry and no installer exist. `schedule_job` and `job_run` (migration 0007, rebuilt in 0033) are empty. The admin `/admin/schedule` page can only list and toggle. Consequently none of the four owner-selected jobs runs unattended, and FR-MON-01 deterioration alerts only fire when someone runs `watch:run` by hand.

Facts verified while writing this design:

| Fact | Anchor |
|---|---|
| `schedule_job(id, job_key UNIQUE, cron_expr, enabled, created_at)` | `db/migrations/0033_pk_not_null_rebuild.sql:1256` |
| `job_run(id, job_key, started_at, finished_at, status IN running/success/failed, error)` — no row counts, no trigger source | `db/migrations/0033_pk_not_null_rebuild.sql:767` |
| `fetch --source <dart|ecos|krx|kosis|law|opendata>` and `md:sync --source <dart|law>` already exist in the CLI | `scripts/co-newbiz/newbiz.ts:603`, `:170` |
| Nothing writes `data_change_log`; only `watch-run.ts` reads it | `db/migrations/0003_fact_and_assumptions.sql:30`; grep |
| `watch-run.ts` stage [1] fetch is explicitly "a later wave" | `scripts/co-newbiz/watch-run.ts:13` |
| `retention_policy(table_key, basis, retention_months, action archive|delete, last_run_at)` is configurable; no executor exists | `app/web-next/app/api/admin/retention/route.ts:13-43` |
| `execution_job` queue + `job-worker.ts` claim/stale-reclaim pattern exists | `db/migrations/0117_execution_job.sql:14`, `scripts/co-newbiz/job-worker.ts` |
| Host is macOS; prod = Docker `co-newbiz-web` on 7749, dev = host process on 7748 | `docs/runbooks/deployment.md` |

## 2. Recommended architecture

### 2.1 Single minute-tick dispatcher (recommended) vs per-job plists

| Criterion | Per-job plists | Single tick dispatcher |
|---|---|---|
| Admin toggle / cron edit takes effect | Only after re-generating and `launchctl bootout/bootstrap` the plist — the web server would have to shell out to launchctl (forbidden in spirit by ADR-0019 and a privilege problem in the container) | Immediately — the tick reads `schedule_job` at fire time |
| Cron expressiveness | launchd `StartCalendarInterval` cannot express `*/15` or ranges without enumerating dicts; systemd `OnCalendar` and Task Scheduler each need their own translation | One cron parser in TypeScript, identical on all three OSes |
| Survives app crash (ADR-0019 intent) | Yes | Yes — launchd fires a fresh process each minute; no resident timer |
| Missed runs while asleep/down | launchd coalesces; behaviour differs per OS | Explicit catch-up policy per job (§3.4) |
| OS footprint | N entries per environment | 1 entry per environment |
| Failure blast radius | Isolated | A broken tick stops all jobs — mitigated by a heartbeat alert (§6) |

**Decision recommended: single dispatcher.** ADR-0019's intent is "the thing that fires must not live inside the application process". A launchd-launched, short-lived `schedule-tick.ts` process satisfies that exactly: it starts, decides, spawns, exits. Cron evaluation moves into our code, but the *clock* stays with the OS. Per-job plists would re-couple admin edits to OS re-registration, which is the coupling the owner asked to remove.

### 2.2 Components

```
launchd (every 60 s)                         admin UI (/admin/schedule)
   │  StartInterval=60                          │  REST (admin-only, audited)
   ▼                                            ▼
schedule-tick.ts ──reads──► schedule_job ◄── /api/admin/schedule-jobs[...]
   │  due? enabled? not locked?                 │  "run now" = INSERT schedule_job_request
   │  claims schedule_job_lock (lease)          │  (never executes in the web process)
   ▼
spawn: bun scripts/co-newbiz/run-job.ts --job <key>   (one child per due job, detached, timeout-guarded)
   │  writes job_run (start → end, status, error, counts)
   ▼
job handler (watch, collect:<source>, retention, gate-integrity-report)
   │  on failure / overdue → notification row (ADR-0017 path) + SRE watch rule on job_run
```

- `scripts/co-newbiz/schedule-tick.ts` — new. Idempotent per minute: computes due jobs from `cron_expr` (5-field cron, Asia/Seoul) and `last fire minute`, plus pending manual requests; spawns `run-job.ts` per job; exits within a few seconds. Never runs handler code itself.
- `scripts/co-newbiz/run-job.ts` — new thin runner. Re-checks `enabled` (except manual requests, which carry an explicit actor), acquires the lock, opens a `job_run`, runs the handler with a hard timeout, records the outcome, releases the lock. Can also be called directly by an operator.
- Handlers live in `scripts/co-newbiz/jobs/<job>.ts` and call existing library functions (`runWatchCycle`, fetch adapters, etc.), not the CLI via a sub-shell, so counts are returned structurally.
- Operational note: a manual `run-job.ts --actor <...>` invocation runs a job even when it is disabled (`enabled = 0`), so "disabled" is not a hard off-switch — it only stops the tick from firing it on schedule.

### 2.3 Environments: where the tick runs

The DB lives with the process that owns it. The tick must run against the right DB:

| Environment | launchd label | ProgramArguments |
|---|---|---|
| prod (Docker) | `org.bizknights.co-newbiz.prod.tick` | `docker exec co-newbiz-web bun scripts/co-newbiz/schedule-tick.ts` |
| dev (host) | `org.bizknights.co-newbiz.dev.tick` | `bun scripts/co-newbiz/schedule-tick.ts` (WorkingDirectory = repo, dev DB) |

Running inside the container via `docker exec` keeps one DB writer topology (the container's volume), uses the container's env (secrets already injected), and needs no host mount of the prod SQLite file. If the container is down, `docker exec` fails, launchd logs it, and the heartbeat alert (§6) fires — the correct behaviour. `schedule-tick.ts` refuses to run when `CO_NEWBIZ_SCHEDULER_ENV` (`prod`|`dev`) is unset, and records the env on every `job_run`, so a dev tick can never be mistaken for a prod run. Default: **prod schedules all four jobs; dev registers the tick but seeds every job `enabled = 0`** (owner decision D3).

## 3. Job definitions

### 3.1 Per-job table

| job_key | Command (handler) | Default cron (KST) | Timeout | Retry | Catch-up | Idempotency |
|---|---|---|---|---|---|---|
| `watch.evaluate` | `runWatchCycle` + resume passes from `watch-run.ts` | `*/30 * * * *` | 10 min | none (next tick retries) | skip missed, run once | Watch cooldown/hysteresis (FR-MON-03) and `watch.last_checked_at` watermark already prevent duplicate alerts |
| `collect.dart` | fetch adapter `dart` + `md:sync dart` | `0 7 * * 1-5` | 30 min | 2 retries, backoff 5/15 min, only on network/5xx/429 | run once if missed within 24 h | Upsert on (series_id, period); `data_change_log` row only when value differs. **(2026-11-01, platform-lead AI-2nd review): the handler performs the `fetch` + `md:sync` pair once — for the catalog-kind dart adapter both commands are the same catalog sync, so calling it twice would download the corp-code ZIP twice for zero additional rows (justified in the `scripts/co-newbiz/jobs/collect/dart.ts` header).** **(2026-11-02, backend-engineer, P5 gate fix): DART ships the corp-code download as a streaming ZIP — each local file header declares csize/usize 0 and the true sizes live in the trailing data descriptor and the central directory. `parseCorpXml` (app/web-next/lib/dart-client.ts) was rewritten to locate the End-of-Central-Directory record by scanning from the END of the buffer and to inflate each entry using the central directory's true compressed size; the previous next-signature scan cut the deflate stream at a false PK byte-pair (offset 2,893,889 of the 3.63 MB file) and failed deterministically with "unexpected end of file". A buffer with no EOCD (a transfer cut short) now raises a clear truncation error, which `isRetryableCollectError` classifies as retryable — the same network-class policy as this row's retry column; ordinary non-streaming ZIPs take the identical code path, and the zip-slip/ratio guards are unchanged. Pinned by tests/unit/dart-corp-zip.test.ts.** **(2026-11-02, backend-engineer, follow-up to the P5 gate fix): `fetchDisclosureText` (dart-client v1.2.0) — which had kept the old next-signature fallback and inherited the same false-PK truncation hazard — now extracts through the same shared `readZipEntries` EOCD/central-directory walk (subject-parameterized so its truncation errors read "DART disclosure ZIP truncated"); the fail-soft error surface and the first-decodable-entry selection are unchanged, and `isRetryableCollectError`'s truncation class covers the disclosure errors too. Pinned by the disclosure-shaped fixtures in tests/unit/dart-corp-zip.test.ts.** |
| `collect.ecos` | fetch adapter `ecos` | `0 8 * * *` | 20 min | same | same | same |
| `collect.krx` | fetch adapter `krx` | `30 18 * * 1-5` (after market close) | 20 min | same | same | same |
| `collect.kosis` | fetch adapter `kosis` | `0 9 * * 1` (weekly) | 30 min | same | same | same |
| `collect.law` | fetch `law` + `md:sync law` | `0 6 * * *` | 30 min | same | same | Upsert by statute id + promulgation date. **(2026-11-01, data-architect review): the idempotency key is `korea_statute_id` — promulgation-date deferral: md_statute has no such column; amendment detection is a future data-architect change. The key is DB-enforced by the partial unique index `idx_md_statute_code` (migration 0186), mirroring `idx_md_company_dart` (0033).** |
| `retention.cleanup` | new `retention` handler reading `retention_policy` | `0 3 * * *` | 30 min | none | run once if missed | Deterministic cutoff `now - retention_months`; batch deletes/archives of 1,000 rows; rerun is a no-op; updates `retention_policy.last_run_at` |
| `gate_integrity.shadow_report` | `gate-integrity-shadow-report.ts` main | `0 8 * * 1` (Mon) | 15 min | 1 retry | run once if missed within 7 d | Report keyed by ISO week; rerun overwrites the same week |
| `governance.sync` (TODO, register after P1 lands) | `applyGovernanceManifest` from `db/lib/governance-registry.ts` over `docs/governance/governance-registry.generated.json` (same code as `newbiz.ts governance:sync` and the admin sync button; writes one `governance_sync` audit row per run) | `0 6 * * *` | 2 min | none | run once if missed | Upsert by (layer, key); a version change inserts a new row and supersedes the old one; rows are never deleted |

All collect jobs run only if the adapter's `credentialEnv` is present; a missing key ends the run `skipped` with reason `credential_missing`, not `failed` (avoids nightly false alarms for intentionally disabled sources).

### 3.2 Collection: closing the "later wave" fetch stage

As far as the code allows today: the adapters and `fetch` command exist (`newbiz.ts:603`); what is missing is (a) a library-level entry point that returns counts instead of printing, and (b) writing `data_change_log` on value changes so `watch.evaluate` has input. Phase P5 extracts `fetchSource(db, source, opts) → {series, rows_upserted, rows_changed, failures}` from the CLI case, has both the CLI and the handler call it, and inserts a `data_change_log` row per changed observation inside the same transaction as the upsert. `watch.evaluate` then consumes those rows as it already does. Ordering: collect jobs are scheduled before the next `watch.evaluate` slot; no explicit dependency engine is introduced.

### 3.3 Retention executor guardrails

`retention.cleanup` touches only tables present in an allow-list in code (`job_run`, `notification`, `raw_payload`, `execution_job` terminal rows, session tables — final list from `dba`). **`audit_log` is never eligible** regardless of `retention_policy` contents (ADR-0012); a policy row naming it is reported as an error. `archive` writes rows to `db/archive/<table>/<yyyy-mm>.jsonl.gz` before deleting. A dry-run mode (`--dry-run`) is mandatory for the first prod run.

### 3.4 Locking, overlap, timeout

- New table `schedule_job_lock(job_key PK, holder TEXT, acquired_at, lease_until)`. Acquire = `INSERT ... ON CONFLICT DO UPDATE ... WHERE lease_until < now` in one statement (SQLite atomic). Lease = timeout + 5 min. A second tick or a manual run that cannot acquire records nothing and exits (or, for manual, marks the request `rejected_locked`).
- Timeout: `run-job.ts` runs the handler under an `AbortController` and a hard `setTimeout` → `process.exit(124)`; the tick also passes `timeout` to the spawned child. A killed run leaves `job_run.status = running`; the next tick's sweep marks runs older than the lease `failed` with `error = 'timeout_or_crash'` (same pattern as `reclaimStaleJobs` in `job-worker.ts`).

### 3.5 `job_run` recording (schema change — governed by ADR-0189, data-architect)

Additive migration on `job_run`: `trigger TEXT CHECK (trigger IN ('schedule','manual','catchup'))`, `actor TEXT NULL` (manual only), `env TEXT`, `rows_read INTEGER`, `rows_written INTEGER`, `rows_changed INTEGER`, `attempt INTEGER DEFAULT 1`, `detail_json TEXT` (per-source counts, report path). Status CHECK gains `skipped` and `timeout`. `schedule_job` gains `display_name`, `description`, `timeout_sec`, `max_retries`, `updated_at`, `updated_by`, `last_fire_minute`. New table `schedule_job_request(id, job_key, requested_by, requested_at, status queued|claimed|done|rejected_locked, job_run_id)`. `error` is truncated to 2 KB and passed through the secret scrubber (§5).

## 4. Admin UI and API

Follows Onyx 3.0 (`docs/design-system/`, `design:lint`) and the admin CRUD conventions landed in commit 69703135: `PageHeader`, search + paging list, `useAdminLabel` for readable labels, ko/en via next-intl.

### 4.1 API (backend-engineer)

| Method / path | Change |
|---|---|
| `GET /api/admin/schedule-jobs?q=&page=` | Extend: `display_name`, `cron_expr`, human preview, `enabled`, `next_run_at` (computed), last run `{started_at, status, duration}` |
| `POST /api/admin/schedule-jobs` | New: create — only for `job_key` values that have a registered handler (no arbitrary commands, ever) |
| `PATCH /api/admin/schedule-jobs/[jobKey]` | Extend existing toggle to edit `cron_expr`, `timeout_sec`, `max_retries`, `enabled`; server-side cron validation; rejects intervals < 5 min except `watch.evaluate` (floor 5 min) |
| `DELETE /api/admin/schedule-jobs/[jobKey]` | New: soft — sets `enabled=0`; `job_run` history is retained. (2026-11-02, QA iteration 2: DROP is implemented as PATCH `{enabled:false}`; no separate DELETE endpoint — QA-verified) |
| `POST /api/admin/schedule-jobs/[jobKey]/run` | New "run now": inserts `schedule_job_request`; returns 202 with request id. **No in-process execution** (ADR-0019) |
| `GET /api/admin/schedule-jobs/[jobKey]/runs?page=` | Extend with new columns, error text, trigger, actor |
| `POST /api/admin/schedule-jobs/seed` | New: idempotent upsert of the eight default rows (§3.1 — the registry's handlers; grows as phases land); never overwrites admin-edited cron |
| `GET /api/admin/schedule-jobs/health` | New: last tick heartbeat, overdue jobs |

Every mutating call is admin-only (existing admin guard) and calls `appendAudit` with action `schedule_job_create|update|disable|run_requested|seed`, before/after cron in `target`. Cron parsing/preview uses one shared module (`app/web-next/lib/schedule/cron.ts`, also imported by `schedule-tick.ts`) — the parser choice is `cron-parser` or an in-repo 5-field parser; the human-readable preview uses `cronstrue` with ko locale. One parser for both preview and execution is mandatory, otherwise the preview can lie.

### 4.2 UI (ux-designer-agent → frontend-engineer)

- **List**: PageHeader (title, primary action "Seed defaults" only when table empty, otherwise "New job"), search by key/name, paging; columns — name, schedule (preview text + raw cron in mono), enabled switch, next run, last run status chip (text + icon, not color-only), duration.
- **Create/edit drawer**: job (select from registered handlers), cron input with inline validation, live preview ("Every weekday at 07:00 KST"), next 5 fire times, timeout, retries.
- **Detail**: run history table (paged) — started, finished, trigger, actor, status, counts, error expander; "Run now" secondary action with confirm, then polls the request until a `job_run` id appears.
- **Health banner**: shown when the tick heartbeat is older than 3 min ("Scheduler not firing — check launchd registration").

### 4.3 Row 0 browser diagnosis and the confirmed screen subset (2026-10-31, ux-designer-agent)

Owner directive (2026-10-31): pull the P7 **list-and-edit** subset forward. The owner cannot tell what
each job on `/admin/schedule` does (rows render raw `job_key` only) and cannot adjust a schedule from
the web (only an enable toggle exists). **Scope cut, explicit: run-now, run-history detail and the
health banner stay in P7** — they are NOT part of this round. Job creation (§4.1 POST) is also out:
all rows come from the registry seed.

Browser findings (dev server 7748, admin session via the UI; analyst-role gate screen also captured):

| Observed | Detail |
|---|---|
| List columns today | `작업 키` (raw key), `스케줄 (cron)` (raw expr in `<code>`), `상태` (`활성/비활성` chip with ●/○), `최근 실행` (status · finished date, or `실행 이력 없음`), actions = a single `활성화/비활성화` button |
| Not shown | `display_name`, `description`, `timeout_sec`, `max_retries` — the columns exist in `schedule_job` since migration 0183 and the seed fills them, but `GET /api/admin/schedule-jobs` selects `id, job_key, cron_expr, enabled, created_at` only (`app/web-next/app/api/admin/schedule-jobs/route.ts`) |
| Not possible | editing cron / timeout / retries from the web — `PUT /api/admin/schedule-jobs/[jobKey]` accepts `{ enabled }` only; no PATCH, no run endpoint |
| Interactions | toggle fires instantly with no confirmation, no toast and no inline error state; no search, no paging; empty state exists; no human cron preview; no next-run column |
| Live data shape (dev) | 4 seeded rows, all `비활성` (D3 invariant); `gate_integrity.shadow_report` showed `성공 · 2026. 10. 30.`, the rest `실행 이력 없음` |

Confirmed screen design (amends §4.2; the list and edit drawer are the whole round):

**List** — admin shell section, list-table standard (`.data-table.list-table.table-fixed-pct` +
`ColGroup`; `ListSearch` above the table, `Pager` via `usePaged` rendered only when pages > 1):

| Column | Content |
|---|---|
| `작업` | readable name from a new `useAdminLabel` group `jobName.<job_key>` (ko catalog; DB `display_name` is the en fallback), `job_key` in mono caption on the second line, `description` (catalog `jobDesc.<job_key>`) as a muted third line |
| `스케줄` | human cron preview in the active locale (ko example: `매주 월요일 오전 8시`) + the raw expr in mono caption |
| `상태` | existing `활성/비활성` chip; the enable action stays the existing two-state `btn-ghost` button — no switch component exists in the codebase, and registering one is a design-system-agent escalation, not an inline invention |
| `다음 실행` | `next_run_at` computed by the shared `app/web-next/lib/schedule/cron.ts` (`nextFireTimes`), absolute date-time + relative (`3분 후`) |
| `최근 실행` | unchanged (status label + icon · finished_at; error line truncated with `title`) |
| `작업` | `편집` button (`aria-label="{name} 작업 편집"`) → opens the edit dialog |

Empty state: keep `emptyJobs`, and add a `기본 작업 등록` ghost button calling the existing
`POST /api/admin/schedule-jobs/seed` (the §4.2 "Seed defaults only when the table is empty" rule;
the endpoint already exists).

**Edit dialog** — §4.2's "drawer" is realized as the established `modal-panel` + `useModalFocus`
dialog (no drawer component exists in the codebase; naming reconciled here, no new component):
header shows `display_name` + `job_key`; the description is shown read-only; fields — cron input
(mono; inline validation via `validateCron` with the error bound by `aria-describedby`, never
colour-only), live human preview line in the active locale, `다음 5회 실행 시각` list
(`nextFireTimes(expr, now, 5)`, formatted `formatDateTime`), timeout input in **minutes**
(stored as `timeout_sec`, allowed 1–120), max_retries (0–5). Buttons: `취소` (ghost) + `저장`
(primary). A disabled job stays editable; saving never enables. One primary action per dialog.

ko catalog strings (drafted for `locales/ko.json`, `admin.ops`; key = "ko string", fenced because
the i18n values themselves are the Korean source material and the language gate exempts code
blocks — en strings mirror in `locales/en.json`):

```
jobName.watch.evaluate = "감시 규칙 평가"
jobName.notify.deliver = "알림 발송"
jobName.notify.digest = "알림 일일 요약"
jobName.gate_integrity.shadow_report = "게이트 무결성 주간 점검"
jobDesc.watch.evaluate = "새 데이터에 감시 규칙을 평가하고 악화·기회 알림을 기록하며 일시중지된 파이프라인을 재개합니다."
jobDesc.notify.deliver = "새 알림을 수신자·채널별 발송 행으로 확장하고 예정된 이메일·웹훅 발송을 처리합니다."
jobDesc.notify.digest = "지난 24시간의 일일 요약 대상 알림을 한 이메일로 묶어 발송합니다."
jobDesc.gate_integrity.shadow_report = "게이트 무결성 셰도우 감사 로그의 주간 요약 리포트를 만듭니다."
colName = "작업"
colNextRun = "다음 실행"
editJob = "편집"
editJobAria = "{p1} 작업 편집"
nextFireTimesHeading = "다음 5회 실행 시각"
cronInvalid = "cron 식이 올바르지 않습니다: {p1}"
cronTooFrequent = "실행 간격은 5분 이상이어야 합니다."
timeoutLabel = "실행 제한(분)"
retriesLabel = "실패 시 재시도 횟수"
```

Success criterion: an operator who has never seen the registry can, from the list alone, say what
each job does and when it next fires, and can change `watch.evaluate` to hourly and see the preview
and the next-fire list agree with the saved value — measured in the P7 gate's `design:lint` +
preview-verification evidence.

## 5. Security

- Admin-only API and page; agents inherit user permissions (no service account). The OS-launched runner is not a user: `job_run.actor` is `NULL` for schedule triggers and the requesting user id for manual triggers; audit entries are written for every admin change and every manual request (ADR-0012, append-only).
- MCP gets no scheduler tool in this round; if added later it goes through the REST API (ADR-0011).
- Secrets: handlers read keys through the existing env/root-env loader (`app/web-next/lib/root-env.ts` semantics; scripts use the same resolution). Plists contain **no secrets** — only the label, program arguments, `CO_NEWBIZ_SCHEDULER_ENV`, and log paths. In prod, secrets come from the container env.
- Layering: the scheduler core and handlers live in `scripts/co-newbiz/` and import downward (`db/lib/secret-scrubber.ts`, `app/web-next/lib/schedule/cron.ts`); `db/lib` never imports `scripts/` or `app/web-next/lib` (s10-checks). The adapter credential env names are injected into the scrubber by the scripts layer. run-job's stdout/stderr pass through the scrubber.
- Never log secrets: `run-job.ts` wraps handler errors with a scrubber that redacts values of every known `credentialEnv` and URL query params named `key|crtfc_key|serviceKey|OC|apiKey` before writing `job_run.error` or stdout. Unit-tested.
- launchd logs go to `~/Library/Logs/co-newbiz/<env>-tick.{out,err}.log`, mode 0600, rotated by the retention job.
- "Create" accepts only registered handler keys — no free-text command field, which would be remote code execution from the admin console.

## 6. Failure alerting

- On `failed`/`timeout` (after retries) `run-job.ts` inserts a `notification` with `trigger_type = 'batch_failure'` and `severity = 'ops'` (escalated to `urgent` for `watch.evaluate` and `retention.cleanup`), addressed per the recipient policy in §13.4 and delivered by `notify.deliver` (§13). `notification.project_id` became nullable in migration 0072 (ADR-0102) — corrected 2026-10-31 per P3 Row 0 conformance review; the §13.3 rebuild adds `title`/`source_ref` only.
- SRE watch rules (owned by `sre`): (a) tick heartbeat — `schedule-tick.ts` upserts `schedule_heartbeat(env, last_tick_at)` every run; stale > 3 min → high alert; (b) job overdue — `next_run_at + timeout` passed with no `job_run` → warning; (c) 3 consecutive failures of the same job → high.
- A failure of the alerting insert itself is written to stderr (launchd log) and never masks the original error.

## 7. OS registration and installer

New `scripts/co-newbiz/scheduler-install.ts` (infra-automation-engineer):

```
bun scripts/co-newbiz/scheduler-install.ts --env prod|dev [--platform launchd|systemd|schtasks] [--uninstall] [--dry-run] [--print]
```

- **launchd (macOS, implemented)**: renders `ops/scheduler/launchd/co-newbiz-tick.plist.tmpl` to `~/Library/LaunchAgents/org.bizknights.co-newbiz.<env>.tick.plist` with `StartInterval 60`, `RunAtLoad false`, `ProcessType Background`, **`AbandonProcessGroup = true`** (mandatory: the tick spawns detached run-job children and exits; without it launchd kills the tick's process group, children included), explicit `PATH` including bun and docker, log paths; then `launchctl bootstrap gui/$UID` (uninstall: `bootout`). `--print` emits the plist only. LaunchAgent (user session) rather than LaunchDaemon, because Docker Desktop runs in the user session — documented trade-off: no runs while logged out (owner decision D5).
- **systemd (documented + template)**: `ops/scheduler/systemd/co-newbiz-tick@.service` + `.timer` with `OnCalendar=*-*-* *:*:00`, `Persistent=false`; installer prints commands, `--platform systemd` writes units under `~/.config/systemd/user/`.
- **Task Scheduler (documented + template)**: `ops/scheduler/schtasks/co-newbiz-tick.xml` with a 1-minute repetition trigger; installer prints the `schtasks /Create /XML` command.
- Enable/disable sync needs **no** re-registration: the OS entry is static; `schedule_job.enabled` and `cron_expr` are read at every tick. Uninstalling the OS entry is the global kill switch.
- `docs/runbooks/deployment.md` and a new `docs/runbooks/scheduler.md` (install, verify with `launchctl print`, heartbeat check, uninstall, troubleshooting) are part of P2.

## 8. Rollout phases (PR-sized)

| Phase | Scope | Owner agents | Gate to next |
|---|---|---|---|
| P0 | This design + ADR-0189 (which also governs the scheduler schema change, owner decision 2026-10-29) and ADR-0190 (notification delivery schema) accepted | platform-lead, PM | ADR accepted (done: owner merge of #773, 2026-10-29) |
| P1 | Runner: migration (job_run columns, schedule_job columns, lock, request, heartbeat tables); shared cron module; `run-job.ts`, `schedule-tick.ts`, scrubber; handlers for `watch.evaluate` and `gate_integrity.shadow_report` (code already exists). Failures are recorded in `job_run` only; the `notification` insert for `batch_failure` (needs the nullable `project_id` of ADR-0190) lands in P3 behind a TODO hook | data-architect (design) -> dba (execute), backend-engineer | Unit tests green; manual `run-job.ts` writes complete `job_run` rows on dev |
| P2 | OS registration and dev soak: `scheduler-install.ts` + templates + runbook; register **dev** tick; seed endpoint | infra-automation-engineer, release-engineer | 48 h dev soak, heartbeat continuous |
| P3 | Notification delivery (former P5a): `notification_delivery`/recipient-policy migration, nullable `notification.project_id`, email + webhook senders, `notify.deliver` and `notify.digest` handlers, scrubber/URL masking, and the `batch_failure` notification hook from P1 (13.1-13.4) | data-architect -> dba, backend-engineer, security-engineer review | Test send succeeds on both channels on dev; retries and dedupe proven by integration tests |
| P4 | Notification history, watch management and test send (former P5b): admin notification history UI + test send; watch / watch_rule CRUD with fire preview (13.5-13.7) | backend-engineer, ux-designer-agent -> frontend-engineer, design-system-agent | design:lint clean; a seeded watch rule produces a previewed and then a delivered notification end-to-end |
| P5 | Collection (former P3): `fetchSource` extraction, `data_change_log` writes, five `collect.*` handlers | backend-engineer, data-architect review | Each source run once manually with real keys; counts correct; no secrets in logs |
| P6 | Retention (former P4): executor (allow-list, dry-run, archive) | backend-engineer, dba | Dry-run report reviewed by owner before first destructive prod run |
| P7 | Admin job CRUD UI and prod rollout (former P5 jobs UI and P6): admin API CRUD + UI (list, drawer, history, run now, health banner); then register prod tick, seed, enable jobs one by one; SRE watch rules | backend-engineer, ux-designer-agent -> frontend-engineer, design-system-agent, security-engineer review; release-engineer, sre | design:lint clean; 1 week prod with no missed heartbeat |

Phase order changed by the owner on 2026-10-29: notifications (P3, P4) come right after the runner and its OS registration, so failures raised by later jobs are deliverable from the start.

**P7 subset pulled forward (owner directive, 2026-10-31)**: the admin list-and-edit screen (§4.3 — readable list + edit dialog + the GET/PATCH API extensions behind it) lands ahead of full P7; run-now, run-history detail, the health banner and job creation remain in P7. The dev tick and seed (P2) are already registered, so the UI ships against live dev data.

Landing order respects schema -> API -> UI -> deploy. P5 and P6 are independent of P7 and may run in parallel branches only if the sequential-branch rule is explicitly waived by PM.

## 9. Test plan

- **Unit**: cron parse/next-fire incl. KST, DST-free assumption, month ends; due-computation with `last_fire_minute` (no double fire within a minute, catch-up rules); lock acquire/contend/expire; scrubber redacts every adapter key pattern; retention cutoff and `audit_log` refusal.
- **Integration (temp SQLite)**: tick → spawn → `job_run` lifecycle success/failed/timeout/skipped; manual request path; disabled job not run on schedule; stale `running` sweep; two concurrent ticks produce one run.
- **Collection**: recorded-fixture adapters (no live calls in CI); change detection writes `data_change_log` only on diff; `watch.evaluate` consumes it end-to-end and raises a deterioration notification.
- **Installer**: `--dry-run --print` snapshot of plist/systemd/xml; `plutil -lint` on the rendered plist.
- **API**: admin-only (403 for analyst/viewer), audit row per mutation, create rejects unknown handler keys, run-now never executes in-process (assert no handler import in route module).
- **UI**: design:lint, keyboard/a11y on drawer, ko/en strings.
- **Notifications (§13)**: SMTP sender against a local capture server (e.g. smtp4dev/MailHog container) in tests, never a real relay; webhook sender against a local HTTP stub asserting the Slack and Teams payload shapes; retry/backoff schedule and terminal `failed` after max attempts; 4xx (non-429) is not retried; dedupe — the same `dedupe_key` within the window yields one delivery per channel; rate limit holds excess rows as `deferred`, not dropped; digest groups one user's daily rows into one message and marks every row; opt-out suppresses email/webhook but never in-app or `urgent` kill-criteria; recipient policy resolution per role; URL masking in API responses (no full webhook URL ever leaves the server); scrubber removes SMTP password and webhook tokens from `last_error`; test send writes an audit row and a delivery tagged `is_test`; watch_rule validation (threshold required for `threshold_breach`, forbidden where meaningless) and preview returns would-fire results without writing `notification` rows.
- **Manual (P2/P7)**: `launchctl print gui/$UID/org.bizknights.co-newbiz.dev.tick`; sleep/wake catch-up; `docker stop` → heartbeat alert fires.

## 10. Owner decisions

D1–D8 were decided by the owner on 2026-10-29 by approving the recommendations. D9–D14 (notifications, §13) are recommendations to be confirmed at PR review.

| # | Decision | Recommendation |
|---|---|---|
| D1 | Collection frequency per source | **Decided (owner, 2026-10-29):** As §3.1: DART weekdays 07:00, ECOS daily 08:00, KRX weekdays 18:30, KOSIS weekly Mon 09:00, law daily 06:00. Respects free-tier quotas; tune after one month of `rows_changed` data |
| D2 | Retention defaults | **Decided (owner, 2026-10-29):** `job_run` 12 months delete; `notification` 12 months archive; `raw_payload` 24 months archive; `execution_job` terminal rows 6 months delete; `audit_log` never. dba to confirm list |
| D3 | Do prod and dev both schedule? | **Decided (owner, 2026-10-29):** Both register the tick; prod jobs enabled, dev jobs seeded disabled (avoid double API quota use and noisy dev alerts) |
| D4 | Watch evaluation interval | **Decided (owner, 2026-10-29):** 30 min (floor 5 min); hourly is acceptable if notification volume is a concern |
| D5 | LaunchAgent vs LaunchDaemon | **Decided (owner, 2026-10-29):** LaunchAgent (Docker Desktop is user-session); accept no runs while logged out, or move prod to a Linux host later (systemd path already documented) |
| D6 | Archive destination for retention `archive` | **Decided (owner, 2026-10-29):** Local `db/archive/` inside the backed-up volume; revisit if size grows |
| D7 | Catch-up after host sleep | **Decided (owner, 2026-10-29):** Run once on wake for collect/retention/report; skip for watch (next slot is soon) |
| D9 | Who receives what (recipient policy) | `urgent` (kill_criteria, rag_downgrade to Red, batch_failure of watch/retention): watch owner + project members with role ≥ analyst + all admins, immediate, in-app + email + webhook. `warning`: watch owner, immediate in-app + daily email digest. `opportunity`/`info`: watch owner, in-app + daily digest. `ops`: admins only, in-app + webhook ops channel |
| D10 | Digest time | 08:30 KST daily (after the 06:00-08:00 collection jobs and the 08:00 watch slot) |
| D11 | Webhook targets | Two channels: `deals` (project alerts) and `ops` (scheduler/batch failures); URLs in env (`NOTIFY_WEBHOOK_URL_DEALS`, `NOTIFY_WEBHOOK_URL_OPS`); admin config stores only the channel key → env-var name mapping and format (slack|teams) |
| D12 | Per-user opt-out | Allow email opt-out per severity except `urgent`; webhook is channel-level, not per user; in-app cannot be disabled |
| D13 | SMTP provider | Use the owner's existing mail relay over STARTTLS 587 with an app password; external recipients restricted to an allow-listed domain (MNPI: payloads to email/webhook carry title, severity, project code and a deep link, never figures) |
| D14 | Rate limits | Per channel: email ≤ 30/min, webhook ≤ 20/min per target; per user ≤ 10 immediate emails/hour, excess folded into the next digest |
| D8 | Should `collect.*` use `execution_job`/`job-worker.ts` instead of a new runner? | **Decided (owner, 2026-10-29):** No for now — `execution_job` is the simulation runtime queue with resource classes; reuse its stale-reclaim pattern, not the table. Revisit if a unified queue ADR appears |

## 11. Risks

| Risk | Mitigation |
|---|---|
| Single tick is a single point of failure | Heartbeat alert; tick does no work itself, so its failure surface is tiny |
| `docker exec` fails silently when container restarts | launchd err log + heartbeat; `docker exec` exit code recorded in log |
| SQLite write contention between web server and jobs | WAL mode (verify), batch sizes ≤ 1,000, retention at 03:00 |
| Destructive retention mis-config | Allow-list, `audit_log` hard refusal, mandatory first dry-run, archive before delete |
| API quota exhaustion / key revocation | Credential-missing = skipped; 429-aware backoff; per-source enable switch |
| Secrets leaking into `job_run.error` | Central scrubber + tests; 2 KB truncation |
| Admin console becomes a command runner | Handler registry only; no free-text command |
| Cron preview and execution disagree | One shared parser module for both |

## 13. Notifications: delivery, history, watch rules (extension, owner decision 2026-10-29)

Owner decision: deliver in-app **plus email and webhook**. Governing ADR: ADR-0190 (sibling of ADR-0189 — new schema and an outbound transport warrant their own record).

Verified state (corrected 2026-10-31 per P3 Row 0 conformance review — 0007:62 is superseded): `notification(id, user_id, project_id nullable — since migration 0072 per ADR-0102, trigger_type (10 values), severity opportunity|warning|urgent|info|ops, payload, channel in_app|email|webhook|all, bundle immediate|daily, sent_at, read_at, dedupe_key + partial unique index per recipient)` (`db/migrations/0141_establishment_notifications_and_call_path.sql`; this changeset's migration 0185 extends the shape further); producers `db/lib/watch-engine.ts` (comment: no transport yet), `app/web-next/lib/pipeline.ts` (pause), establishment steps; `watch` and `watch_rule` empty; `/api/admin/notifications` lists 200 rows with no filters, payload view or delivery status.

### 13.1 Transport

- **Email sender** `db/lib/notify/email.ts`: SMTP via env `NOTIFY_SMTP_HOST`, `NOTIFY_SMTP_PORT`, `NOTIFY_SMTP_USER`, `NOTIFY_SMTP_PASS`, `NOTIFY_SMTP_FROM`, `NOTIFY_SMTP_TLS` (`starttls|tls|none`; `none` refused when `CO_NEWBIZ_SCHEDULER_ENV=prod`). Library: nodemailer (Bun-compatible) — final pick by backend-engineer. Plain-text + simple HTML templates in ko/en, rendered from the payload.
- **Webhook sender** `db/lib/notify/webhook.ts`: formats `slack` (`{text, blocks}`) and `teams` (MessageCard/Adaptive Card) JSON. Target URLs are secrets (they embed tokens): they live only in env (`NOTIFY_WEBHOOK_URL_<CHANNEL>`). Admin config (`notify_webhook_target(channel_key, env_var, format, enabled)`) stores the env-var *name*, never the URL. 10 s timeout; HTTPS only in prod.
- **Content rule (MNPI, FR-SEC)**: email and webhook bodies carry title, severity, trigger, project code/name and a deep link to the app; no figures, valuations or document excerpts. The full payload is visible only in-app, behind normal project permissions.
- Credentials are resolved through the env/root-env loader (`app/web-next/lib/root-env.ts` semantics); missing SMTP or webhook env disables that channel (deliveries recorded `skipped: channel_unconfigured`), not an error storm.

### 13.2 Delivery worker (scheduler jobs)

| job_key | Cron | What it does |
|---|---|---|
| `notify.deliver` | `* * * * *` (every tick) | Expands new `immediate` notifications into `notification_delivery` rows per resolved recipient × channel; sends due rows (`status IN (pending, retry)` and `next_attempt_at <= now`) with per-channel rate limits; timeout 50 s so it never overlaps the next tick (lock §3.4 also guards) |
| `notify.digest` | `30 8 * * *` | Groups each recipient's undelivered `daily` rows of the past 24 h into one email (and optionally one webhook post per channel); marks every included delivery `sent` with the shared digest id |

- In-app needs no transport: the notification row is the delivery; `read_at` remains per row.
- **Retries**: backoff 1, 5, 15, 60 min, then `failed` (4 attempts default, `schedule_job.max_retries`). SMTP 4xx / HTTP 429/5xx/timeout = retry; SMTP 5xx / HTTP 4xx (except 408/429) = terminal. `Retry-After` honoured.
- **Dedupe**: producers already set `dedupe_key`; delivery adds a unique index on `(notification_id, recipient, channel)` so re-expansion is a no-op, and suppresses a new email/webhook delivery when one with the same `dedupe_key` + recipient + channel was sent within the rule's `cooldown_hours`.
- **Rate limits**: token bucket per channel/target and per user (D14); over-limit rows go to `deferred` and are folded into the next digest rather than dropped. `urgent` bypasses the per-user limit, not the per-target limit.
- On terminal failure of an `urgent` delivery, an `ops` notification is produced for admins (in-app only, to avoid loops).

### 13.3 Schema (ADR-0190; data-architect design, dba execution)

- `notification`: `project_id` becomes nullable (system/ops notifications), plus `title TEXT`, `source_ref TEXT` (e.g. `job_run:<id>`, `watch_rule:<id>`). SQLite needs a table rebuild — migration with reversible metadata per ADR-0014.
- New `notification_delivery(id, notification_id FK, recipient_user_id NULL, recipient_address_masked, channel email|webhook, target_key NULL, status pending|retry|sent|failed|skipped|deferred, attempt INTEGER, next_attempt_at, last_error (scrubbed, ≤ 2 KB), provider_message_id, digest_id NULL, is_test INTEGER, created_at, sent_at)`, unique `(notification_id, recipient_user_id, channel, target_key)`, index `(status, next_attempt_at)`.
- New `notification_recipient_policy(id, severity, trigger_type NULL, audience owner|project_members|role:<role>|admins, channels, bundle, enabled)` — seeded per D9.
- New `user_notification_pref(user_id, channel, severity, opt_in)` — opt-out per D12.
- New `notify_webhook_target` (see 13.1).
- Recipient email addresses are read from the user record at send time and stored only masked (`j***@example.com`) on the delivery row.

### 13.4 Recipient policy resolution

Producer writes one `notification` per addressed user (existing behaviour) or, for system events, one row with `user_id = 'system'`; `notify.deliver` resolves the policy (severity + trigger → audience → channels), subtracts user opt-outs (never for in-app or `urgent` kill-criteria), and applies the watch rule's own `channel` as an upper bound. Agents never receive notifications on their own account (agents have no accounts).

### 13.5 Admin notification history UI

- API: extend `GET /api/admin/notifications` with server-side filters `from,to,trigger_type,severity,channel,read(read|unread),delivery_status,project_id,q` and paging (`page`, `page_size` ≤ 100; drop the hard 200 limit); `GET /api/admin/notifications/[id]` returns payload, recipients and the delivery attempts.
- UI (Onyx 3.0, PageHeader, search/paging, `useAdminLabel`): filter bar (period presets, trigger, severity, channel, read, delivery status); list columns — time, severity chip (text + icon), trigger, project link, recipient, per-channel delivery badges; detail drawer — formatted payload (JSON viewer, read-only), project deep link, delivery attempts table (channel, masked target/recipient, attempt, status, error, timestamps).
- Webhook targets always shown masked (`https://hooks.slack.com/…/****abcd`); the full URL is never returned by any API.

### 13.6 Watch and watch_rule management

- API (admin, plus project members for their own watches if PM agrees — default admin-only in this round): `GET/POST /api/admin/watches`, `PATCH/DELETE /api/admin/watches/[id]` (soft delete = disable all rules), `GET/POST /api/admin/watches/[id]/rules`, `PATCH/DELETE /api/admin/watch-rules/[id]`. All audited.
- Validation: `trigger_type` from the CHECK set; `threshold` required for `threshold_breach` (percentage points, > 0) and `staleness` (days), rejected for triggers without a threshold; `cooldown_hours` 1–720; `channel` limited to channels configured on the server; one watch per (project, user).
- **Preview**: `POST /api/admin/watch-rules/preview` runs the watch-engine evaluation for the rule against current data in dry-run mode (no `notification` writes, no watermark advance) and returns would-fire items with reason, severity and resolved recipients/channels. Requires a dry-run flag on `runWatchCycle` / `watch-engine.ts` — backend-engineer change in P4.
- `watch.evaluate` (§3.1) consumes enabled rules unchanged; a disabled rule or watch is skipped at evaluation time, so toggles need no scheduler action.

### 13.7 Test send

`POST /api/admin/notifications/test` with `{channel: email|webhook|in_app, target}` where target is a user (email/in-app) or a configured webhook channel key. Creates a `notification` with a dedicated `trigger_type = 'test'` (ADR-0190 adds it to the CHECK set, so test traffic never pollutes real trigger statistics); severity `info`, `is_test = 1` on the delivery, delivered immediately by enqueueing (the next tick, ≤ 60 s; the UI polls the delivery status). Audited as `notification_test_sent` with channel and masked target. Rate-limited to 5 per admin per hour.

### 13.8 Security additions

- SMTP password and webhook URLs are added to the central scrubber (§5); `last_error` and logs pass through it.
- API responses mask webhook URLs and recipient addresses for everyone, admins included.
- Outbound HTTPS only in prod; webhook hosts restricted to an allow-list (`hooks.slack.com`, `*.webhook.office.com`, plus owner-approved hosts) to prevent SSRF via admin config.
- security-engineer reviews 13.1–13.7 before P3 merges (outbound transport is a new exfiltration path).

## 12. Review notes (Review Model)

- **Verified**: table shapes, existing CLI commands, absence of `data_change_log` writers, retention policy API without executor, deployment topology per runbook.
- **Could not verify**: whether `watch-engine.ts` can run in dry-run without side effects today (preview depends on it); whether user records hold verified email addresses; whether SQLite runs in WAL mode in the prod container; Docker Desktop behaviour under `docker exec` from a LaunchAgent at login before Docker is up; adapter rate limits per source; contents of `gate-integrity-shadow-report.ts` output destination.
- **Needs judgement**: D9–D14 (D1–D8 decided by the owner 2026-10-29; scheduler schema rides ADR-0189).
- **Surfaces not examined in depth**: UI component internals of the new admin CRUD pattern (only the convention names were taken from commit 69703135).
