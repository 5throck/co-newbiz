---
lang: en
date: 2026-11-27
status: implemented
owner: ux-designer-agent (design), pm (dispatch)
related: docs/designs/2026-11-19-oauth-consent-screen-redesign-design.md, docs/designs/2026-11-19-oauth-manual-client-registration-design.md, docs/designs/2026-10-08-wave-m-mcp-parity-design.md (§4.3), docs/architecture/api-spec.md (§8), docs/architecture/ui-spec.md (§5), ADR-0154, ADR-0091, ADR-0203
spec: admin-oauth-client-stop-start
---

# Design — Admin START/STOP for connected OAuth clients (`연결된 앱 시작·중단`)

## Doc choice: a new focused design doc (ruled, with reasons)

This design is recorded as a **new focused doc** (`docs/designs/2026-11-27-admin-oauth-client-stop-start-design.md`, this file), not as an amendment to the consent-screen doc of record (`2026-11-19-oauth-consent-screen-redesign-design.md`). Reasons:

1. **The consent doc's recorded scope excludes this work.** Its scope guard reads "no API/backend change, no admin verify-client UI", and it is `status: implemented`. Amending it would rewrite a finished deliverable's fence to admit unrelated work — the fence is a recorded decision, not spare room.
2. **House precedent.** The sibling OAuth feature (manual client registration, same date) took its own focused doc rather than amending the consent doc. One OAuth capability = one doc keeps each doc's scope honest.
3. **Design Gate mechanics (ADR-0074)**: a code change carries a per-change design doc at `docs/designs/<spec-id>-design.md`. This change spans a migration, two admin routes, four enforcement points, and a new admin section — materially more than a consent-screen amendment could carry without dissolving its scope.

The consent doc remains the design of record for the consent *screen*; this doc references its contract where the stopped state must surface there (§ Consent surface).

## Problem and corrected premise

The request `연결된 앱 시작·중단` is an **admin-console fleet kill switch**, not a per-user self-service feature. `중단` must immediately stop ALL users' access to one registered OAuth client; `시작` re-enables it. The settings page (`app/web-next/app/settings/connected-apps/page.tsx`) is **not** the surface for the command — per-user suspend there is out of scope (§ Out of scope).

Today there is no way to stop a compromised or unwanted client: an admin can only revoke one user's connection (`revokeConnectedApp`, db/lib/oauth.ts:454, audit `oauth_app_revoke`), while the client keeps every other user's live tokens and keeps issuing new ones via the token endpoint. A fleet-wide stop needs a client-level state.

## JTBD

**Persona**: operator (admin).
**Job**: *when a connected external app turns out to be untrusted, compromised, or no longer wanted, cut off every user's access to it in one action — immediately and provably — and be able to restore the app later without pretending the old connections still exist.*

Input: the registered-client inventory (`oauth_client`). Output: a client stamped stopped with all its token families revoked (`중단`), or a client re-opened for new authorizations (`시작`). Sub-jobs: (a) see at a glance which clients are operating and which are stopped; (b) understand, before committing `중단`, that every user's connection dies now and that reconnection is required after a later `시작`.

## Semantic ruling: revoke-at-stop, not gate-only — and the re-auth consequence

**`중단` (STOP)** = all three, atomically per client:

1. **Stamp** `oauth_client.stopped_at = now` (the marker every gate reads).
2. **Revoke ALL users' live tokens** for that client — `UPDATE api_token SET revoked_at WHERE client_id = ? AND kind IN ('oauth_access','oauth_refresh') AND revoked_at IS NULL` (the fleet-wide generalization of `revokeConnectedApp`, db/lib/oauth.ts:454).
3. **Reject** authorization, issuance, and validation while stopped (§ Enforcement gates).

**Why revoke-at-stop, not gate-only** (gate-only = stamp the marker, let live tokens expire naturally): access tokens live 15 minutes and refresh tokens 7 days (`ACCESS_TOKEN_TTL_S` / `REFRESH_TOKEN_TTL_S`, db/lib/oauth.ts:31–32). A kill switch that leaves up to 7 days of silent refresh cycling is not a kill switch — an emergency stop is exactly the case where "wait for expiry" is unacceptable. The house already accepts this semantics for the account case: admin disable revokes sessions and all tokens in the same action (`app/web-next/app/api/admin/users/[userId]/route.ts:61–68`). Client stop mirrors it.

**`시작` (START)** = clear `stopped_at` only. **Tokens are NOT restored — previously authorized users must reconnect.** This consequence is stated explicitly, in the confirm dialog and in this ruling: revoke-at-stop destroys the grant, so `시작` re-opens the door but does not resurrect keys. The alternative (start silently resumes stored refresh tokens) is rejected: it contradicts the admin's mental model of a circuit breaker (`중단` must mean "stopped until someone deliberately reconnects") and would surprise both sides — an app the admin believed cut off resumes out of nowhere, and users never learn their grant was interrupted. A user reconnects through the normal connector flow; the consent screen issues fresh tokens.

## Data model — migration `db/migrations/0202_oauth_client_stop.sql` (next number in sequence; 0201 is the latest existing)

```sql
-- @reversible: true (additive only — one nullable column on oauth_client;
-- rollback is pre-migration backup restore, scripts/co-newbiz/restore.ts,
-- ADR-0014. SQLite >= 3.35 can also DROP COLUMN.)
--
-- Admin START/STOP for connected OAuth clients (design
-- 2026-11-27-admin-oauth-client-stop-start). NULL = operating,
-- non-NULL ISO timestamp = stopped by an admin. The actor is not
-- stored here — it lives in the append-only audit_log (FR-SEC-07)
-- as oauth_app_stop / oauth_app_start.
ALTER TABLE oauth_client ADD COLUMN stopped_at TEXT;
```

No CHECK constraint (SQLite cannot ADD CONSTRAINT; a nullable timestamp needs none). `OAuthClient` (db/lib/oauth.ts:110) gains `stopped_at: string | null`; `getClient` (db/lib/oauth.ts:151) selects it. No other table changes: `oauth_code`, `api_token` untouched — revocation uses the existing `revoked_at` column.

## Enforcement gates — every door the client passes, with verified anchors

The check is "client row has `stopped_at IS NOT NULL`". It is enforced **below the route handlers, in `db/lib/oauth.ts`**, so all callers of the OAuth engine get it (the FR-SEC-03 single-enforcement-point spirit). Four doors:

| # | Door | Function (verified) | Ruling while stopped |
|---|---|---|---|
| G1 | Authorization / consent entry | `validateAuthorizeRequest` (db/lib/oauth.ts:186), called from `GET/POST /api/oauth/authorize` (app/web-next/app/api/oauth/authorize/route.ts:53, :81) | After the `getClient` lookup succeeds (so an unknown client keeps its existing `invalid_client` path), a stopped client fails with error code `client_stopped`, `redirectSafe: false` — shown locally on the consent screen, never sent to `redirect_uri` (no open redirect, consistent with the route's pre-verification rule). Distinct from `invalid_client` on purpose: client_ids are 128-bit random (`mcp_` + 32 hex, db/lib/oauth.ts:136) so there is no enumeration risk, and the legitimate user sent by their connector needs the honest reason. |
| G2 | Token issuance — authorization_code grant | `exchangeAuthorizationCode` (db/lib/oauth.ts:282), called from `POST /api/oauth/token` (app/web-next/app/api/oauth/token/route.ts:21) | After the existing `row.client_id !== opts.clientId` match check: stopped → `unauthorized_client` (RFC 6749 §5.2), description `client is stopped by an administrator.` A pre-stop code (≤60 s window, `AUTH_CODE_TTL_S` db/lib/oauth.ts:33) must not mint tokens. |
| G3 | Token issuance — refresh grant | `refreshTokens` (db/lib/oauth.ts:319), same token endpoint (route.ts:31) | Same check and error as G2. Defense-in-depth: stop already revoked every token, so a live refresh token presenting at a stopped client indicates a race or missed revoke — reject `invalid_grant`-equivalent (`unauthorized_client`) and revoke the presented family as the reuse-detection branch already does. |
| G4 | Token validation — MCP bearer path | `validateAccessToken` (db/lib/oauth.ts:375), called from `handleMcpRequest` (app/web-next/lib/mcp/http-server.ts:162) | JOIN `oauth_client` and require `stopped_at IS NULL`; failure returns `null` → the existing 401 + `WWW-Authenticate` path (`unauthorized()`). No error detail leaks to the resource-server response. Cheap gate: normally a no-op because stop revoked everything, but it closes the in-flight race and any future code path that inserts tokens outside the engine. |

Personal tokens (`kind='personal'`) are unaffected everywhere: every gate above filters on OAuth kinds or joins `oauth_client`; the general REST API never accepted OAuth tokens (db/lib/api-tokens.ts filters `kind='personal'`).

## API — admin routes per console conventions

Two routes, mirroring the admin surface conventions (requireAdmin + audit; `PUT …/[id]` action-style exactly as `app/web-next/app/api/admin/users/[userId]/route.ts:12`):

### `GET /api/admin/oauth-clients` (new)

`app/web-next/app/api/admin/oauth-clients/route.ts`. `authenticate` → `requireAdmin` (same guard lines as `app/api/admin/system-mode/route.ts:10–15`). Returns every `oauth_client` row — including stopped ones — with per-client stats derived server-side:

```jsonc
{
  "clients": [
    {
      "client_id": "mcp_…", "name": "ChatGPT", "verified": true,
      "registered_by_user_id": "analyst1", "created_at": "…",
      "stopped_at": null,                    // non-null when stopped
      "authorized_users": 3,                 // DISTINCT user_id with live (unrevoked, unexpired) oauth tokens — the listConnectedApps predicate (db/lib/oauth.ts:430) generalized to all users
      "live_tokens": 7                       // count of live kind IN ('oauth_access','oauth_refresh') rows
    }
  ]
}
```

Sorted by `created_at DESC`. redirect_uris are listed but wrapped (count, not full URIs — the full list is the registrant's view; admin needs presence, not contents). No delete endpoint (§ Out of scope).

### `PUT /api/admin/oauth-clients/[clientId]` (new)

`app/web-next/app/api/admin/oauth-clients/[clientId]/route.ts`. Body `{ "action": "stop" | "start" }`. Behavior:

- **stop**: single transaction: stamp `stopped_at = now`, then revoke all live tokens for the client (the fleet-wide UPDATE above). Response `200 { ok: true, client_id, status: "stopped", stopped_at, revoked: <n> }`. **Edge cases**: unknown clientId → **404 `notFound()`** (the house 404-not-403 rule — existence is protected, same as `app/api/admin/users/[userId]/route.ts` returns `notFound()` for missing users); already stopped (the stamped UPDATE affects 0 rows) → **409 `oauth_client_already_stopped`** with the current `stopped_at` — a truthful answer for a concurrent-admin race, never a silent 200 that lies about what just happened; the UI reloads the list on 409 (self-healing).
- **start**: clear `stopped_at` (set NULL) only where it is non-NULL. `200 { ok: true, client_id, status: "operating" }`. **Edge cases**: unknown clientId → 404; start-on-active (already NULL) → **409 `oauth_client_already_running`**; response carries the consequence flag `users_must_reconnect: true` so the UI toast can state it without re-deriving it.
- **Audit** (FR-SEC-07, append-only, admin actor): the stop/start logic lives in two new functions `stopClient` / `startClient` in `db/lib/oauth.ts`, which audit through the module's existing `audit()` helper (db/lib/oauth.ts:66 → `appendAudit`) so the JSON target style matches the OAuth lifecycle family (`oauth_client_register`, `oauth_app_revoke`): action **`oauth_app_stop`** target `{ client_id, revoked }`, action **`oauth_app_start`** target `{ client_id }`, actor = the admin's `auth.userId`. One row per command; no route-level duplicate row.

Both routes must be registered in `docs/architecture/openapi.yaml` (the openapi.yaml == handler equality gate applies to new admin method sets, per api-spec as-built rows).

## UI — `ConnectedAppsSection` in the admin console

### Placement and registration (the section pattern)

A new admin section `connected-apps` following the existing section-component + AdminConsole registration exactly:

- Component: `app/web-next/components/admin/console/ConnectedAppsSection.tsx` (self-contained data fetching like `NotificationSection.tsx` — the P4 precedent for sections that own their state; not the shared `useAdminData` hook, which does not need to grow another domain).
- Route: `app/web-next/app/admin/connected-apps/page.tsx` rendering `<AdminConsole section="connected-apps" />` (pattern: `app/admin/audit/page.tsx`), under the existing `app/admin/layout.tsx` `AdminGuard`.
- Registration points (all four, each verified to exist): `Section` union in `components/admin/console/types.ts`; `SECTION_TITLE_KEY` + `SECTION_INTRO_KEY` in `constants.ts`; `ADMIN_NAV` in `app/web-next/lib/navigation.ts:183` (label `nav.admin.connectedApps`, placed after `nav.admin.adr`, before `nav.admin.systemMode`); `ADMIN_ICON_BY_HREF` in `components/AppShell.tsx:86–96`.
- The console itself is admin-only end to end (ADR-0091 role-screen separation; `requireAdmin` per route is the defense-in-depth gate).

### Screen-type judgment (explicit, per checklist item 1)

**P2 Report** (ADR-0086): an admin list with status and per-row lifecycle actions. No stage furniture — the admin console sits outside S1–S12 (ui-spec §5). CRUD conformance is partial **by recorded decision**: **R** = list + search + status filter (full); **U** = lifecycle `중단/시작` (the feature itself); **C and D deliberately absent** — create is a user-side flow (DCR + manual registration, `POST /api/oauth/clients`); delete was ruled out with reasons in the manual-registration design (§ "DELETE /api/oauth/clients/{clientId} — out of scope": FK orphans, revoke-then-delete ordering). Admin manages the fleet; it does not mint or destroy clients. This is the same R+U shape the users section shows for its disable/enable actions, not a CRUD gap.

### Layout

```
┌ h1 `연결된 앱`          (PageHeader: admin.section.connectedApps / admin.pageIntro.connectedApps)
│ ┌ toolbar ─────────────────────────────────────────────────────┐
│ │ [`검색` input] (name·client_id substring)   `상태`: [`전체`|`운영 중`|`중단`] │  FilterChip group
│ └──────────────────────────────────────────────────────────────┘
│ ┌ table (table-scroll, list-table) ────────────────────────────────────────
│ │ `앱 이름`      | client_id (mono)  | `검증` | `연결 사용자` | `상태`        | `중단 일시` | `작업` │
│ │ ChatGPT     | mcp_9f…           | ● `검증된 앱`  | 3`명`       | ● `운영 중`   | —      | [`중단`(danger)] │
│ │ OldBot      | mcp_c1…           | ⚠ `미검증 앱` | 0`명`       | ✕ `중단`     | 26.11.20. | [`시작`(ghost)] │
│ └ …
│ empty: PageState state="empty" (`admin.connectedApps.emptyClients`)
└
```

- **Columns**: name (truncate + title), `client_id` (`--font-mono`, truncate), verified chip (reuse `status-green ● 검증된 앱` / `status-amber ⚠ 미검증 앱` — same pair the settings page and consent screen already use), `연결 사용자` count (`N명`; mono numeral), **status chip**, `중단 일시` (compact date-time, `—` when operating), actions.
- **Status chip** (design-guide §3.2 — never color-only, icon + label always):
  - `운영 중` → `.status-chip.status-green`, icon `●`, label `운영 중` (pass/complete family — the app is serving).
  - `중단` → `.status-chip.status-red`, icon `✕`, label `중단` (kill family — an admin-declared kill, matching §3.2's red semantics; amber "hold" would understate a kill switch).
- **Row actions — one action per row, state-dependent**: a stopped row shows only `[시작]` (`Button variant="ghost" size="sm"` — restoring is the safe-side action, no destructive styling); an operating row shows only `[중단]` (`Button variant="danger" size="sm"` — destructive styling reserved for the consequential direction, per the doctrine's confirm-dialog rule; the danger appears on the button because `중단` is a one-click fleet event, unlike the per-row revoke menu on the settings page).
- **Both actions go through ConfirmDialog** (`useConfirm`, components/crud.tsx — the house commitment pattern):
  - `중단` confirm: title `'{p1}' 앱을 중단할까요?`, body `모든 사용자의 연결이 즉시 해지되고, 이 앱은 인증·재연결이 거부됩니다. 다시 시작해도 기존 연결은 복구되지 않습니다.`, confirmLabel `중단`.
  - `시작` confirm: title `'{p1}' 앱을 시작할까요?`, body `새 연결과 재연결이 허용됩니다. 이전에 연결했던 사용자는 다시 연결해야 합니다.`, confirmLabel `시작`.
  - The `중단` body carries the two consequences that matter (immediate revocation for everyone; no silent resume after a later `시작`) — the measurable part of theJTBD sub-job (b).
- **Toast + 409 self-healing**: success toasts (`admin.connectedApps.stoppedToast` / `startedToast`); any 409 reloads the list and toasts the catalog error text, so a concurrent-admin race never leaves a stale row.
- **Single primary action**: the section has no form; the list's only interactive commitments are the row actions above, one per row — no competing primary. The section toolbar's search input is the entry point of the R surface, per the standard list pattern.
- **Empty state**: no clients registered yet → `PageState state="empty"` with `admin.connectedApps.emptyClients` (`아직 등록된 앱이 없습니다.`).

### Consent surface reflection (ruled)

The consent screen (`app/web-next/app/oauth/authorize/page.tsx`, redesigned per the consent doc) gains **one new error state** for G1: when the authorize GET returns error code `client_stopped`, the page renders a dedicated stopped state instead of the generic invalid state — heading `연결이 중단된 앱입니다`, body `관리자가 이 앱의 연결을 중단했습니다. 자세한 내용은 관리자에게 문의하세요.`, plus the existing `viewConnectedApps` link as the state's single action. Icon `✕` + text (§3.2). This is the only place a user meets the stopped state honestly, at the moment they try to (re)connect. Rendering stays inside the chromeless consent card of the consent doc.

### Settings page reflection (ruled: no banner)

`app/web-next/app/settings/connected-apps/page.tsx` **stays untouched**. Ruling: a `중단 배너` is **not** warranted. (1) `중단` revokes all the user's tokens, so the app correctly disappears from the connected-apps list (`listConnectedApps`, db/lib/oauth.ts:430, lists only live tokens) — the list already tells the truth; (2) a banner would need a new per-user query over revoked-token history for marginal value; (3) the honest moment is the reconnect attempt, which G1 handles at the consent screen. This also keeps the settings page's static-source-pin contract (`connected-apps-page.test.ts` reads exact source shapes) untouched.

## Edge cases (register)

| Case | Ruling |
|---|---|
| Double-stop (already stopped) | 409 `oauth_client_already_stopped`; no re-revoke (the stamp UPDATE affects 0 rows and aborts before the revoke runs); UI reloads |
| Start-on-active | 409 `oauth_client_already_running` |
| Unknown clientId | 404 `notFound()` — the 404-not-403 house rule (existence protected; api-spec `/api/projects/:id` row wording, applied to admin client routes) |
| In-flight access token at stop instant | G4 join rejects at next validation; a tool call already executing completes (no mid-request ejection) — same semantics as account disable |
| Outstanding authorization code (≤60 s) | G2 rejects redemption after stop |
| Concurrent admin race | Single transaction per command; the second command answers 409 with current state |
| `registered_by_user_id` user later disabled/deleted | No effect on client state; the client keeps operating — stopping a client is an explicit admin action, never a side effect (recorded so backend does not couple them) |
| Personal tokens | Out of blast radius entirely (kinds filtered per § Enforcement gates) |

## i18n — new keys, both catalogs (`ko.json` / `en.json`, same PR — key-parity test enforces)

| Key | ko | en |
|---|---|---|
| `nav.admin.connectedApps` | `연결된 앱` | `Connected apps` |
| `admin.section.connectedApps` | `연결된 앱` | `Connected apps` |
| `admin.pageIntro.connectedApps` | `외부 앱(OAuth 클라이언트)의 연결 상태를 관리합니다. 중단하면 모든 사용자의 연결이 즉시 해지됩니다.` | `Manage the connection status of external apps (OAuth clients). Stopping an app immediately revokes every user's connection.` |
| `admin.connectedApps.colApp` | `앱 이름` | `App name` |
| `admin.connectedApps.colClientId` | `client_id` | `client_id` |
| `admin.connectedApps.colVerified` | `검증` | `Verified` |
| `admin.connectedApps.colUsers` | `연결 사용자` | `Connected users` |
| `admin.connectedApps.colStatus` | `상태` | `Status` |
| `admin.connectedApps.colStoppedAt` | `중단 일시` | `Stopped at` |
| `admin.connectedApps.statusOperating` | `운영 중` | `Operating` |
| `admin.connectedApps.statusStopped` | `중단` | `Stopped` |
| `admin.connectedApps.verifiedChip` | `검증된 앱` | `Verified app` |
| `admin.connectedApps.unverifiedChip` | `미검증 앱` | `Unverified app` |
| `admin.connectedApps.userCount` | `{p1}명` | `{p1} user(s)` |
| `admin.connectedApps.stopButton` | `중단` | `Stop` |
| `admin.connectedApps.startButton` | `시작` | `Start` |
| `admin.connectedApps.stopConfirmTitle` | `'{p1}' 앱을 중단할까요?` | `Stop '{p1}'?` |
| `admin.connectedApps.stopConfirmBody` | `모든 사용자의 연결이 즉시 해지되고, 이 앱은 인증·재연결이 거부됩니다. 다시 시작해도 기존 연결은 복구되지 않습니다.` | `Every user's connection is revoked immediately and the app is refused authentication and reconnection. Starting it again does not restore existing connections.` |
| `admin.connectedApps.startConfirmTitle` | `'{p1}' 앱을 시작할까요?` | `Start '{p1}'?` |
| `admin.connectedApps.startConfirmBody` | `새 연결과 재연결이 허용됩니다. 이전에 연결했던 사용자는 다시 연결해야 합니다.` | `New connections and reconnections are allowed. Users who connected before must reconnect.` |
| `admin.connectedApps.stoppedToast` | `'{p1}' 앱을 중단했습니다. {p2}개 연결이 해지되었습니다.` | `Stopped '{p1}'. {p2} connection(s) revoked.` |
| `admin.connectedApps.startedToast` | `'{p1}' 앱을 시작했습니다. 기존 사용자는 다시 연결해야 합니다.` | `Started '{p1}'. Existing users must reconnect.` |
| `admin.connectedApps.errAlreadyStopped` | `이미 중단된 앱입니다. 목록을 새로 고칩니다.` | `The app is already stopped. Refreshing the list.` |
| `admin.connectedApps.errAlreadyRunning` | `이미 운영 중인 앱입니다. 목록을 새로 고칩니다.` | `The app is already operating. Refreshing the list.` |
| `admin.connectedApps.errNotFound` | `앱을 찾을 수 없습니다. 이미 삭제되었거나 등록이 취소되었을 수 있습니다.` | `App not found. It may have been removed or its registration cancelled.` |
| `admin.connectedApps.errLoad` | `목록을 불러오지 못했습니다.` | `Failed to load the list.` |
| `admin.connectedApps.emptyClients` | `아직 등록된 앱이 없습니다.` | `No apps registered yet.` |
| `admin.connectedApps.searchAria` | `앱 이름 또는 client_id 검색` | `Search by app name or client_id` |
| `admin.connectedApps.filterAll` | `전체 ({p1})` | `All ({p1})` |
| `admin.connectedApps.filterOperating` | `운영 중 ({p1})` | `Operating ({p1})` |
| `admin.connectedApps.filterStopped` | `중단 ({p1})` | `Stopped ({p1})` |
| `admin.connectedApps.stopButtonAria` | `'{p1}' 앱 중단` | `Stop app '{p1}'` |
| `admin.connectedApps.startButtonAria` | `'{p1}' 앱 시작` | `Start app '{p1}'` |
| `admin.connectedApps.tableCaption` | `등록된 외부 앱 목록` | `Registered external apps` |
| `pages.oauthAuthorize.stoppedHeading` | `연결이 중단된 앱입니다` | `This app's connection is stopped` |
| `pages.oauthAuthorize.stoppedBody` | `관리자가 이 앱의 연결을 중단했습니다. 자세한 내용은 관리자에게 문의하세요.` | `An administrator has stopped this app's connection. Contact your administrator for details.` |

Reused as-is: `common.status`, `common.copy`, `common.actions`, consent page's `viewConnectedApps`. Chip vocabulary (`● 운영 중` / `✕ 중단`) keeps icon + text so no state is color-only (WCAG 1.4.1).

## Components and tokens consumed (named from the doctrine)

| Element | Component / class | Tokens |
|---|---|---|
| Page header | `PageHeader` (`components/layout.tsx`) — console standard | `--fs-h1`, section/intro catalog keys |
| Toolbar search | `.form-input` | `--surface`, `--border`, `--radius-md` |
| Status filter | `FilterChip` (`components/ui.tsx`) with counts | `--surface-2`, selected state per component |
| Table | `.table-scroll` + `.data-table.list-table.table-fixed-pct` + `ColGroup` | column min-widths; `col-label` ≥12rem for the name column; `word-break: keep-all` global |
| `client_id` cell | `<code>` | `--font-mono`, `--fs-caption` |
| Status chips | `.status-chip.status-green` / `.status-red` | `--green-*` / `--red-*` pairs, icon + label (§3.2) |
| Verified chip | same classes as settings/consent (`status-green`/`status-amber`) | `--amber-*` for unverified |
| Stop button | `Button variant="danger" size="sm"` | `.btn-danger`, `--red-*` |
| Start button | `Button variant="ghost" size="sm"` | `.btn-ghost` |
| Confirm dialogs | `useConfirm` / ConfirmDialog (`components/crud.tsx`) | house commitment pattern; `btn-danger` on the `중단` confirm label |
| Loading / empty / error | `PageState` | — |
| Consent stopped state | consent-card error block (consent doc container) | `--surface-2` note box, `--fs-caption` body |

No new component, no new token, no raw colors or spacing — `bun run design:lint` clean by construction. Amount notation rules do not apply (no financial figures).

## Icon registration (checklist item 4)

New nav entry needs one new icon: **`Cable`** (lucide) for `ADMIN_ICON_BY_HREF["/admin/connected-apps"]` — nominated here as the vocabulary entry for "external connected app" (one icon per domain concept; no existing ADMIN_ICON covers it — `Plug`/`Link2` alternatives rejected as `Link2` reads as hyperlinks and `Database`/`Layers` are taken). Escalation note for `design-system-agent`: register `Cable` in the icon vocabulary table with this domain concept.

## Embedded accessibility checklist (WCAG 2.1 AA, both themes)

- [ ] **1.4.1 not color-only**: both chips carry icon + text (`● 운영 중`, `✕ 중단`); the row shows exactly one action button whose label names the action — no icon-only controls.
- [ ] **1.4.3 contrast**: token pairs already covered by `bun run contrast:check`; new pair to verify: `--red-fg` chip label on `--red-bg` (same pair the kill-chip family uses — must pass 4.5:1 both themes before merge).
- [ ] **2.1.1 keyboard**: search → filter chips → table rows (no row tab stops; actions are buttons) → confirm dialog focus trap via the house `useConfirm`; Esc cancels; focus returns to the invoking button.
- [ ] **4.1.3 status messages**: toasts announce via the house toast `role="status"`; 409 self-heal toasts announce as alerts (`"alert"` variant).
- [ ] **3.3.3 error suggestion**: 404/409 error texts state what to do (refresh; contact admin), never a bare code.
- [ ] **Table semantics**: `<th scope="col">`, `sr-only` caption (`admin.connectedApps.tableCaption` — add to the key list), `aria-label` on the table.
- [ ] **Responsive minimum**: `table-scroll` wrapper with column min-widths (`4-열 표준` per DESIGN-CHECKLIST §F); 320px reflow without horizontal page scroll outside the scroll wrapper.
- [ ] Mechanical gates: `bun run design:lint`, `bun run contrast:check`, axe-core clean, i18n key-parity test green.

## Handoff

**To**: PM (Design Gate approval) → `backend-engineer` (migration + db/lib/oauth.ts gates + admin routes + openapi registration) and `frontend-engineer` (ConnectedAppsSection + registration + consent stopped state + i18n), with `design-system-agent` reviewing the `Cable` icon registration.

**Reasoning in one line**: a kill switch that only gates future issuance leaves 7-day refresh families alive, so `중단` = stamp + revoke-everything + reject-at-all-four-doors, and `시작` honestly re-opens the door while saying out loud that old connections are gone.

**Real contracts consumed**: `GET/PUT /api/admin/oauth-clients*` as specified above (this design defines them — they do not exist yet; the frontend implements against these shapes only after backend lands them); existing chips/ConfirmDialog/PageState contracts as consumed today.

**Implementation notes for backend-engineer**:

- Put `stopClient`/`startClient` in `db/lib/oauth.ts` next to `revokeConnectedApp` (:454) and reuse its UPDATE predicate verbatim, minus `user_id` (fleet-wide). Wrap stamp + revoke in one transaction.
- The G1 check reads the client row `getClient` already returns — extend `OAuthClient` (:110) and `getClient` (:151) with `stopped_at`; do NOT add a second lookup.
- G2/G3/G4 need their own checks (they do not call `getClient`): match-check position as cited in § Enforcement gates.
- `authorized_users`/`live_tokens` stats: one grouped query on `api_token` per the `listConnectedApps` (:430) predicate generalized (drop `user_id = ?`, keep `revoked_at IS NULL AND expires_at > now`, count DISTINCT user_id and rows).
- openapi.yaml equality gate: register both routes before merge.
- Flag for the 215+-path uncommitted template-upgrade landing: this design adds paths only; it does not modify any upgraded file except the four registration points (types.ts, constants.ts, navigation.ts, AppShell.tsx) — keep those edits minimal and separate from upgrade content.

**Measurable success criteria**:

1. **Kill-switch latency (primary)**: from the `중단` confirm resolving to (a) an in-flight-scoped MCP call with a previously live token returning 401 and (b) the token endpoint refusing `authorization_code` and `refresh_token` grants with `unauthorized_client` — all within one request cycle; verified by an integration test that stops mid-stream.
2. **Consequence honesty**: ≥ 90% of admin participants (moderated, n ≥ 5) can state after the `중단` confirm, without re-reading, that (a) all users lose access now and (b) `재시작 후에도 기존 연결은 복구되지 않는다` — the two sentences the dialog carries.
3. **Audit completeness**: every `중단/시작` leaves exactly one `audit_log` row (`oauth_app_stop` / `oauth_app_start`, admin actor, `{client_id, revoked}` / `{client_id}` target); zero rows for the 409/404 refusals (nothing happened, so nothing is recorded).
4. **Mechanical**: design:lint, contrast:check, i18n parity, openapi equality gate, axe-core all green; new section reachable only as admin (non-admin direct URL → AdminGuard block); 409 self-heal reloads without a stale row.

## Out of scope (scope fence)

- **Per-user self-service suspend on the settings page** — explicitly out of scope (corrected premise). The user-side surface remains connect/revoke only (`DELETE /api/oauth/apps/{clientId}` → `revokeConnectedApp`).
- Settings-page `중단 배너` — ruled not warranted (§ Settings page reflection).
- Client delete / client edit (name, redirect_uris) from the admin console — the manual-registration design's DELETE analysis stands; needs its own small design if clients accumulate.
- Per-user allow/deny lists, client un-verify flows, consent-screen copy beyond the stopped state, token TTL changes — ADR-0154/ADR-0203 domain, untouched.
- Migration numbering or code changes executed by this design: none. This doc specifies; implementation follows after Design Gate approval (UX agent writes no code, per agent boundary).

## Boundary compliance

- **ADR-0154** (MCP OAuth): transport, token model, TTLs, scopes, and boundary #2 (proposal-only decisions) untouched — stop/start adds a client-level lifecycle switch to the existing authorization server; no new grant type, no agent account, issuance stays human-delegated.
- **ADR-0091** (admin console split): the new section joins the admin-only navigation group; `requireAdmin` on both routes is the enforcement gate, `AdminGuard` the defense-in-depth; admins gain no business-data visibility through this section (client metadata and counts only — no token values, no user deal data; FR-SEC-02 honored).
- **FR-SEC-07** (append-only audit): stop/start append; no delete path touched. **FR-SEC-09**: no secret material in this feature — client_id is not a secret (manual-registration design §1); no token values appear in any API response, UI, or audit target.

## Disclaimer

This design is decision support, not a security certification. The kill-switch latency claim is a testable hypothesis until criterion 1 runs; where this document conflicts with ADR-0154/ADR-0203 or the code, the ADRs and the code govern.
