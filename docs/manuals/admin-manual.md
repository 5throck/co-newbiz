---
lang: en
counterpart: admin-manual_ko.md
---

# Admin Manual — System Administrators

> **Language**: **English** · [한국어](admin-manual_ko.md)

**Audience**: system administrators (not the same as investment-committee "administrators" of the review process — this is technical system administration)
**Not for**: analysts (see `business-manual.md`) or operators running the batch/backup pipeline day-to-day (see `operations-manual.md`)

## What This Manual Covers

Account management, regulation-version administration, master-data administration, external data-source keys and approvals, and notification-rule configuration — the job of the admin console at `/admin` (`app/web-next/app/admin`).

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
| DART (Financial Supervisory Service OpenAPI) | `DART_API_KEY` | `opendart.fss.or.kr` key sign-up | Key sign-up; lead time not documented in the repo | Company financial sync, observed D/E, the operating-income figure that picks the statutory tax-rate bracket on the WACC page, and the disclosed credit rating that picks the credit spread there (in-app credit-rating collection reads the business report and the debt-securities registrations; analyst role); company-profile and S6 evaluation evidence | Company sync answers `503 dart_not_configured`; credit-rating collection answers `503 dart_api_key_missing` and the WACC card keeps the default `BBB-` rating with a collect hint; DART lookups degrade to `DART_API_KEY 미구성` and financial values stay `N/A` |
| KRX Data Marketplace OPEN API | `KRX_API_KEY` | `openapi.krx.co.kr` > `마이페이지` > API `인증키 신청`, then a usage application per service | Administrator approval for the key and again for each service; lead time not published, apply early. Beta collection needs six services (`idx/kospi_dd_trd`, `idx/kosdaq_dd_trd`, `sto/stk_bydd_trd`, `sto/ksq_bydd_trd`, `sto/stk_isu_base_info`, `sto/ksq_isu_base_info`) | Beta series collection (WACC page `수집 실행`, `scripts/co-newbiz/beta-series.ts`), scheduled `collect.krx` | Missing key: `503 krx_api_key_missing` on the in-app collection; key set but a service not approved: the run fails with `respCode 401 - Unauthorized API Call` and 0 observations |
| Bank of Korea ECOS | `ECOS_API_KEY` | `ecos.bok.or.kr` > MyPage > `인증키 신청` | Personal key; the public `sample` key works only for 10 rows per request, which is too small for production collection. Lead time not documented | Risk-free rate and credit-spread reference on the WACC page (`ECOS 금리 수집 실행`), scheduled `collect.ecos` | `503 ecos_api_key_missing`; the WACC reference card lists the risk-free rate and spread as missing |
| `법제처` Open Law (`LAW_API_OC`) | `LAW_API_OC` (the registered OC id, not a secret key) | `open.law.go.kr` > OPEN API > `활용신청` | About 1 to 2 business days per the `k-law` skill | Statute catalog sync (`collect.law`), statute and article checks by agents (`k-law`) | The scheduled job is skipped with `credential_missing`; agent statute checks cannot run |
| KOSIS | `KOSIS_API_KEY` | `kosis.kr/openapi` > `활용신청` | Lead time not documented in the repo | Macro series collection (`collect.kosis`) | The scheduled job is skipped with `credential_missing` |
| `공공데이터포털` (data.go.kr) | `DATA_GO_KR_API_KEY` | `www.data.go.kr` > the dataset's `openapi.do` page > `활용신청`, once per dataset | The key is shared, but each dataset needs its own approval. All current approvals are development accounts and expire (the customs datasets on 2028-09-03, `금융위원회_채권기본정보` on 2028-11-26); renew with `활용연장` before then | Today only agent lookups through the `k-opendata` skill (customs trade statistics). Planned, not built: credit-rating cross-check on the WACC page, which needs `금융위원회_채권기본정보` (approved 2026-11-26) and `금융위원회_채권시세정보` (**not yet applied for: apply before the feature works**) | HTTP 403 `SERVICE_KEY_IS_NOT_REGISTERED_ERROR` (`resultCode 30`) means the key is valid but that dataset has no approval. The planned credit-rating cross-check does not work until `금융위원회_채권시세정보` is applied for and approved, and a probe on 2026-11-26 still failed for `금융위원회_채권기본정보` (likely approval propagation; recheck) |

### 6.2 The data.go.kr dataset registry

`docs/runbooks/data-go-kr-datasets.yaml` is the single authoritative list of every data.go.kr dataset the project uses or plans to use, with its provider, dataset id, endpoints, status (`in_use` or `planned`), application status, approval date, the feature that uses it, and the owner.

Before using a new data.go.kr dataset:

1. **Apply.** Open the dataset's `openapi.do` page on data.go.kr and press `활용신청`.
2. **Register.** Add the dataset to the registry in the same pull request that adds the code, with status `planned` and application status `pending`.
3. **Build.** Write the code after the approval arrives, then set status `in_use`, application status `approved`, and the approval date.

`tests/unit/data-go-kr-registry.test.ts` fails when code or a skill references an `apis.data.go.kr` endpoint that the registry does not list.

The registry records the application status; it cannot read it from the portal. It was last checked against data.go.kr `마이페이지` > `활용신청 현황` on 2026-11-26: nine applications, all approved, none pending, rejected, or expired, all on **development accounts** (`개발계정`). The `application_status` of every dataset is a recorded statement, not a fact the system checks, so confirm it on the portal whenever you edit the registry and correct it where it differs.

**Expiry.** Each approval has an expiry date (`expires_on`). Renew with `활용연장` on data.go.kr before **2028-09-03** (the customs datasets) and before **2028-11-26** (`금융위원회_채권기본정보`, `금융위원회_채권시세정보`). `국세청_사업자등록정보 진위확인 및 상태조회 서비스` shows no expiry on the portal; check it. After expiry the dataset answers 403 again. A development account is also traffic-capped; move to a production account (`운영계정`, reviewed by the portal) before a recurring-traffic feature goes live.

## 7. Logs & Audit

- The audit log is **append-only** — not even an admin can delete an entry. Retention/archival is the only lifecycle action available.
- CSV export is available for compliance reporting.

## 8. Related

- `docs/governance/governance-operations.md` — waiver and interpretation administration (compliance-officer's domain, adjacent to but distinct from this manual's system-admin scope).
- [`mcp-admin-guide.md`](mcp-admin-guide.md) — MCP personal-token policy, package release, and the 90-day `NPM_TOKEN` rotation; [`mcp-user-guide.md`](mcp-user-guide.md) — the user-side guide to connecting an AI client.

## 9. Related Screens

- `/flows` — stage-flow visualization with a dry-run lane (ADR-0183).
- UI language switch — ko/en message catalogs behind cookie-based locale negotiation (ADR-0184).
- `/wiki` — in-app viewer for the user-manual wiki.
