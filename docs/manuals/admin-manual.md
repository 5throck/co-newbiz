---
lang: en
counterpart: admin-manual_ko.md
---

# Admin Manual — System Administrators

> **Language**: **English** · [한국어](admin-manual_ko.md)

**Audience**: system administrators (not the same as investment-committee "administrators" of the review process — this is technical system administration)
**Not for**: analysts (see `business-manual.md`) or operators running the batch/backup pipeline day-to-day (see `operations-manual.md`)

## What This Manual Covers

Account management, regulation-version administration, master-data administration, external data-source keys and approvals, scheduled jobs, notification-rule configuration, and connected-app (OAuth client) administration — the job of the admin console at `/admin` (`app/web-next/app/admin`).

## 1. Account Management

- **Self-registration → `pending` → admin approval → `active`.** Roles: `admin` / `analyst` / `viewer`.
- **Password reset**: user requests → admin sets a temporary password → user's next login forces a password-change screen before any other action is available (`must_change_password`) → new password checked against `password_history` to block reuse.
- **The admin never sees a user's actual password** — hashing is one-way (PBKDF2-HMAC-SHA256, 210,000 iterations, per `scripts/lib/auth.ts` reused from the workspace).

## 2. Access Control — The One Rule Admins Must Internalize

**`admin` role does not grant automatic access to deal data.** System administration privilege and deal-viewing privilege are separate (design section 8.10, meeting M7-1). To view a specific project's data, an admin needs an explicit `project_member` grant like any other user — and that grant is itself audit-logged. If you find yourself wanting to "just check" a project you're not a member of, that is exactly the case this rule exists to stop.

## 3. Regulation & Procedure Version Administration

- View `project_policy_pin` status across in-flight projects.
- Review `policy_change` impact-analysis records before an amendment takes effect.
- **Never manually override a project's pinned policy version** without a recorded `policy_change` decision — this is the mechanism that stops a regulation amendment from silently flipping an in-flight project's RAG grade.

## 4. Master Data Administration

- Resolve the `staging_unmapped` queue — unmapped industry/company/unit codes are quarantined here, never auto-created.
- Region and industry profile fields require `source`/`verified_on`/`maintainer` metadata; `_validate.ts` rejects unsourced fields. An admin correcting a profile must supply this metadata, not just the value.

## 5. Notification & RAG Rule Administration

- RAG thresholds and hysteresis bands (design section 8.2, meeting M3) are configuration, not hardcoded — but changing them requires an ADR per the trigger list, not an ad hoc admin edit.
- Notification channel configuration, cooldown/hysteresis parameters (meeting M7's 24h/7-day defaults).

## 6. Data Source Administration

**API keys are never displayed** — the admin console shows presence and last-success timestamp only, never the key value. This is a hard rule, not a UI preference (design section 4.9).

### 6.1 External data sources, keys, and approval

Every external data source needs its own key, and several also need an approval before the key works. Keys live in the repo-root `.env` (names as in `.env.sample`; the server reads them at start, so restart after a change). The admin console `Data sources` page (`/admin/data-sources`) shows only whether each key is set. Setting a key does not prove the approval exists.

| Source | Env var | Apply at | Approval and lead time | App features that depend on it | Symptom when missing or unapproved |
|---|---|---|---|---|---|
| DART (Financial Supervisory Service OpenAPI) | `DART_API_KEY` | `opendart.fss.or.kr` key sign-up | Key sign-up; lead time not documented in the repo | Company financial sync, observed D/E, the pre-tax or operating income figure that picks the statutory tax-rate bracket on the WACC page, the interest expense and borrowing figures behind the interest-coverage estimate and the cost-of-debt check (a company synced before migration 0201 needs a financial re-sync, see `docs/runbooks/beta-series-collection.md`), and the disclosed credit rating that picks the credit spread there (in-app credit-rating collection reads the business report and the debt-securities registrations; analyst role); company-profile and S6 evaluation evidence | Company sync answers `503 dart_not_configured`; credit-rating collection answers `503 dart_api_key_missing` and the WACC card keeps the default `BBB-` rating with a collect hint; DART lookups degrade to `DART_API_KEY 미구성` and financial values stay `N/A` |
| KRX Data Marketplace OPEN API | `KRX_API_KEY` | `openapi.krx.co.kr` > `마이페이지` > API `인증키 신청`, then a usage application per service | Administrator approval for the key and again for each service; lead time not published, apply early. Beta collection needs six services (`idx/kospi_dd_trd`, `idx/kosdaq_dd_trd`, `sto/stk_bydd_trd`, `sto/ksq_bydd_trd`, `sto/stk_isu_base_info`, `sto/ksq_isu_base_info`) | Beta series collection (WACC page `수집 실행`, `scripts/co-newbiz/beta-series.ts`), scheduled `collect.krx` | Missing key: `503 krx_api_key_missing` on the in-app collection; key set but a service not approved: the run fails with `respCode 401 - Unauthorized API Call` and 0 observations |
| Bank of Korea ECOS | `ECOS_API_KEY` | `ecos.bok.or.kr` > MyPage > `인증키 신청` | Personal key; the public `sample` key works only for 10 rows per request, which is too small for production collection. Lead time not documented | Risk-free rate and credit-spread reference on the WACC page (`ECOS 금리 수집 실행`), scheduled `collect.ecos` | `503 ecos_api_key_missing`; the WACC reference card lists the risk-free rate and spread as missing |
| `법제처` Open Law (`LAW_API_OC`) | `LAW_API_OC` (the registered OC id, not a secret key) | `open.law.go.kr` > OPEN API > `활용신청` | About 1 to 2 business days per the `k-law` skill | Statute catalog sync (`collect.law`), statute and article checks by agents (`k-law`) | The scheduled job is skipped with `credential_missing`; agent statute checks cannot run |
| KOSIS | `KOSIS_API_KEY` | `kosis.kr/openapi` > `활용신청` | Lead time not documented in the repo | Macro series collection (`collect.kosis`) | The scheduled job is skipped with `credential_missing` |
| `공공데이터포털` (data.go.kr) | `DATA_GO_KR_API_KEY` | `www.data.go.kr` > the dataset's `openapi.do` page > `활용신청`, once per dataset | The key is shared, but each dataset needs its own approval. All current approvals are development accounts (the customs datasets expire 2028-09-03, the two FSC bond datasets 2028-11-26); renew with `활용연장` before then. The key in `.env` is the **Encoding** form (percent escapes); do not escape it again | Agent lookups through the `k-opendata` skill (customs trade statistics) and, since ADR-0208 slice 4, the **bond cross-check** on the WACC page ("Look up outstanding bonds"): `금융위원회_채권기본정보` and `금융위원회_채권시세정보`, both approved and verified live 2026-11-27. It is reference evidence only (never applied, never in apply-all), carries the `공공누리` notice (basic info type 2, price info type 4: attribution, no commercial use, price info also no modification) and matches the issuer by name | HTTP 403 `SERVICE_KEY_IS_NOT_REGISTERED_ERROR` (`resultCode 30`) means the key has no approval for that dataset, or a new approval has not propagated yet, or the key was escaped twice; the WACC panel then says to look up again shortly (HTTP 200, `unavailable`). Missing key: `503 data_go_kr_api_key_missing` |
| Korea Financial Investment Association (KOFIA) bond information service, `kofiabond.or.kr` | none (public pages, no login); a switch `CO_NEWBIZ_KOFIA_COLLECT` | No application exists. Automated collection is **off by default** and must stay off until KOFIA confirms **in writing** that it is permitted | Not an approval process: a written confirmation from KOFIA that automated collection of the grade-by-rating bond yields is allowed (none exists yet; the site has no API contract and no terms clause on automation) | Credit spread by grade on the WACC page (`spread_basis: kofia_grade`, chip "grade yield (KOFIA)"); the collection row "grade yields" appears in "reference data collection" only when the switch is `on` | Switch off (default): the collect route answers `503 kofia_collect_disabled`, no KOFIA row is shown and the spread uses the ECOS bases. Stored KOFIA data is still read. A layout change on the KOFIA side fails the run with a parse error and writes nothing. See `docs/runbooks/beta-series-collection.md`. The scheduled job `collect.kofia` is described in section 6.3 |

### 6.2 The data.go.kr dataset registry

`docs/runbooks/data-go-kr-datasets.yaml` is the single authoritative list of every data.go.kr dataset the project uses or plans to use, with its provider, dataset id, endpoints, status (`in_use` or `planned`), application status, approval date, the feature that uses it, and the owner.

Before using a new data.go.kr dataset:

1. **Apply.** Open the dataset's `openapi.do` page on data.go.kr and press `활용신청`.
2. **Register.** Add the dataset to the registry in the same pull request that adds the code, with status `planned` and application status `pending`.
3. **Build.** Write the code after the approval arrives, then set status `in_use`, application status `approved`, and the approval date.

`tests/unit/data-go-kr-registry.test.ts` fails when code or a skill references an `apis.data.go.kr` endpoint that the registry does not list.

The registry records the application status; it cannot read it from the portal. It was last checked against data.go.kr `마이페이지` > `활용신청 현황` on 2026-11-26: nine applications, all approved, none pending, rejected, or expired, all on **development accounts** (`개발계정`). The `application_status` of every dataset is a recorded statement, not a fact the system checks, so confirm it on the portal whenever you edit the registry and correct it where it differs. The two FSC bond datasets (`금융위원회_채권기본정보`, `금융위원회_채권시세정보`) became `in_use` on 2026-11-27 (ADR-0208 slice 4): their endpoints and response fields are recorded in the registry and were confirmed by a live call with the repo key; they feed a cross-check display only.

**Expiry.** Each approval has an expiry date (`expires_on`). Renew with `활용연장` on data.go.kr before **2028-09-03** (the customs datasets) and before **2028-11-26** (`금융위원회_채권기본정보`, `금융위원회_채권시세정보`). `국세청_사업자등록정보 진위확인 및 상태조회 서비스` shows no expiry on the portal; check it. After expiry the dataset answers 403 again. A development account is also traffic-capped; move to a production account (`운영계정`, reviewed by the portal) before a recurring-traffic feature goes live.

### 6.3 Scheduled jobs

Scheduled jobs collect external data and run housekeeping on a timer. An OS timer (the scheduler tick) fires every minute and starts each job that is due. You manage the jobs on `/admin/schedule` (menu `Collection schedule`, role `admin`). The OS registration, the heartbeat, and the failure triage are in `docs/runbooks/scheduler.md`.

**Set up the jobs.**

1. Seed the job rows. Dev: `CO_NEWBIZ_SCHEDULER_ENV=dev bun scripts/co-newbiz/schedule-seed.ts` (add `--dry-run` to preview). Prod: `POST /api/admin/schedule-jobs/seed` (admin only; the audit log records every non-dry-run call). When the job list is empty, the page also offers `Register default jobs`. Seeding is idempotent: it adds missing rows and never changes an existing row.
2. Enable each job. Seeding creates every row **disabled**. Open `/admin/schedule` and press `Enable` on the row. The change takes effect within one minute.
3. Leave the OS tick alone. The tick is installed once per environment with `scripts/co-newbiz/scheduler-install.ts`, and both the dev and the prod tick are registered on the project host. Enabling a job, disabling a job, and editing a cron expression need no reinstall. Reinstall only on a new host or after `--uninstall`.

State of the dev database on 2026-11-27: all eleven rows are seeded and enabled with the default schedules below.

| Job key | Default schedule (KST) | What it does | Needs |
|---|---|---|---|
| `collect.dart` | `0 7 * * 1-5` (weekdays 07:00) | Syncs the DART corporation-code catalog into the company master data (`md_company`) | `DART_API_KEY` |
| `collect.ecos` | `0 8 * * *` (daily 08:00) | Collects Bank of Korea ECOS monthly interest-rate observations | `ECOS_API_KEY` |
| `collect.kofia` | `45 18 * * 1-5` (weekdays 18:45) | Collects the KOFIA valuation-firm average 3-year yields of the AAA to BBB- corporate bond grades and the KTB 3-year | The switch `CO_NEWBIZ_KOFIA_COLLECT=on`; no key (see the gate below) |
| `collect.kosis` | `0 9 * * 1` (Mondays 09:00) | Collects KOSIS monthly statistical series | `KOSIS_API_KEY` |
| `collect.krx` | `30 18 * * 1-5` (weekdays 18:30) | Collects KRX daily closes (indexes and per-deal stock series) after market close | `KRX_API_KEY` and the approved KRX services |
| `collect.law` | `0 6 * * *` (daily 06:00) | Syncs the deal-review statute whitelist from `법제처` into `md_statute` | `LAW_API_OC` |
| `gate_integrity.shadow_report` | `0 8 * * 1` (Mondays 08:00) | Writes the weekly read-only summary of gate-integrity shadow-mode audit rows and enforce-flip readiness | None |
| `notify.deliver` | `* * * * *` (every minute) | Expands new notifications into per-recipient deliveries and sends the due email and webhook messages | `NOTIFY_SMTP_*` for email, `NOTIFY_WEBHOOK_URL_*` for webhooks (see `.env.sample`); an unconfigured channel records `skipped: channel_unconfigured` |
| `notify.digest` | `30 8 * * *` (daily 08:30) | Folds each recipient's undelivered daily-bundle notifications of the past 24 hours into one email | `NOTIFY_SMTP_*` |
| `retention.cleanup` | `0 3 * * *` (daily 03:00) | Applies the retention policies to the allow-listed tables (archive before delete; the audit log is never eligible) | None; set `RETENTION_DRY_RUN=1` for the first run |
| `watch.evaluate` | `*/30 * * * *` (every 30 minutes) | Evaluates watch rules against new data, records notifications, and resumes paused pipelines | None |

The `collect.*` jobs read the same keys as the in-app collection, so the per-source key, the application page, and the approval lead time are in the table in section 6.1. A missing key ends the run `skipped` with `credential_missing` (not `failed`). A key without the source's approval ends the run `failed`, for example `respCode 401 - Unauthorized API Call` from KRX.

**The KOFIA gate.** `collect.kofia` is a dedicated handler gated by `CO_NEWBIZ_KOFIA_COLLECT`.

- Off (the default): every run ends `skipped` with the reason `kofia_collect_off` and makes no network call. Enabling the job row while the switch is off is harmless.
- On: a scheduled or catch-up run reads the latest published day and stores it, then backfills the weekdays still missing within the last 10 calendar days. It skips a day that is already stored. A holiday weekday costs one request.
- A layout change on the KOFIA side fails the run and writes nothing. A network error, a 5xx, or a 429 retries up to 2 times.
- **Run now** on this job re-collects the latest day (unchanged values write nothing; changed values become a revision). This is the admin's force: admins cannot reach the project collect route. An analyst's `Collect grade yields` button on the WACC page answers `up_to_date` while the stored data is fresh.
- Set the switch in the repo-root `.env` for the dev tick. For the prod tick, set it in the container environment (`.env.prod`). Restart the server after a change.
- **Prod: keep the switch off until KOFIA confirms in writing that automated collection is allowed.** The row in section 6.1 and `docs/runbooks/beta-series-collection.md` ("KOFIA grade yields") carry the reasoning.

**Change a job.** Press `Edit` on the row to change the cron expression (`Quick setup` or `Direct input`; times are KST; the minimum interval is 5 minutes), the timeout in minutes (1 to 120), and the retries on failure (0 to 5).

**See the run history.** The `/admin/schedule` list shows `Next run` and `Last run` for each job. The `History` button opens the run history: start and end time, status (`Succeeded`, `Failed`, `Skipped`, `Running`, `Timeout`), trigger (`Schedule`, `Manual`, `Catch-up`), actor, environment, rows read, written, and changed, attempt, duration, and the scrubbed error. The chips `Overdue` and `N consecutive failures` mark a job that needs attention. The banner `The scheduler is not firing` means the heartbeat is stale; follow `docs/runbooks/scheduler.md` section 9. **Run now** in the history dialog queues a manual run for the next tick (within 60 seconds) and also works on a disabled job.

The history shows the status `Skipped` but not the reason. Read the reason from `job_run.detail_json`:

```bash
sqlite3 db/data/co-newbiz.sqlite "SELECT started_at, status, \"trigger\", detail_json FROM job_run WHERE job_key = 'collect.kofia' ORDER BY started_at DESC LIMIT 5;"
```

## 7. Connected Apps Administration (OAuth clients)

- `연결된 앱 관리` / "Connected apps (admin)" (`/admin/connected-apps`) lists every registered OAuth client — stopped ones included. Columns: app name, `client_id`, verified chip (`검증된 앱` / `미검증 앱`), connected-user count, status (`운영 중` / `중단`), and the stopped-at time. Search matches app name or `client_id`; the status filter narrows the list. No clients registered yet shows `아직 등록된 앱이 없습니다.`.
- **`중단` (Stop) is a fleet kill switch.** One confirm dialog, then every user's live OAuth tokens for that client are revoked immediately (one transaction), and while stopped the client is refused authorization, token issuance, and token validation — new connections and reconnections are rejected. Personal API tokens are unaffected. The confirm dialog states both consequences up front.
- **`시작` (Start) re-opens the door but does not restore keys.** A started client accepts new connections again, but every user who connected before the stop must reconnect through the normal connector flow — the tokens destroyed at stop are not resurrected. The confirm dialog says so.
- A user who tries to (re)connect a stopped app sees `연결이 중단된 앱입니다` on the consent screen — the refusal is shown in place, with no redirect.
- Every `중단`/`시작` leaves exactly one audit row (`oauth_app_stop` / `oauth_app_start`, admin actor, section 8); a refused command (another admin already acted, or an unknown client) records nothing.
- This section manages existing clients only — there is no create, edit, or delete here. Clients are registered on the user side (dynamic registration or the manual-registration flow); the console shows metadata and counts only, never token values (ADR-0091).

## 8. Logs & Audit

- The audit log is **append-only** — not even an admin can delete an entry. Retention/archival is the only lifecycle action available.
- CSV export is available for compliance reporting.

## 9. Related

- `docs/governance/governance-operations.md` — waiver and interpretation administration (compliance-officer's domain, adjacent to but distinct from this manual's system-admin scope).
- [`mcp-admin-guide.md`](mcp-admin-guide.md) — MCP personal-token policy, package release, and the 90-day `NPM_TOKEN` rotation; [`mcp-user-guide.md`](mcp-user-guide.md) — the user-side guide to connecting an AI client.

## 10. Related Screens

- `/flows` — stage-flow visualization with a dry-run lane (ADR-0183).
- UI language switch — ko/en message catalogs behind cookie-based locale negotiation (ADR-0184).
- `/wiki` — in-app viewer for the user-manual wiki.
