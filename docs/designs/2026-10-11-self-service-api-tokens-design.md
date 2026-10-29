---
title: Self-service personal API tokens on the Connected apps screen
status: draft
date: 2026-10-11
author: security-engineer (Row 0 Design Gate)
related: ADR-0146, ADR-0154, db/migrations/0009_api_tokens.sql, db/migrations/0128_mcp_oauth.sql
---

# Self-service personal API tokens

## 1. Problem

`/settings/connected-apps` lists and revokes OAuth-authorized MCP connectors, but a normal user
cannot issue a personal API token. `POST/GET/DELETE /api/tokens` exist with no UI caller; issuance
UI exists only in the admin console, and ADR-0146 forbids admins from issuing write-scoped tokens.
Analysts who run the local stdio MCP server (`mcp/co-newbiz/shared/rest-client.ts` reads
`CO_NEWBIZ_API_TOKEN`) have no supported way to obtain a token; the stdio server's own error message
tells them to call `POST /api/tokens` by hand.

## 2. Decision tree: which credential does a client use?

| Client | Credential | How the user connects |
|---|---|---|
| Hosted connector (Claude.ai, ChatGPT, Gemini, any remote MCP client) | OAuth 2.1 + PKCE with dynamic client registration (ADR-0154) | Add `<origin>/api/mcp` as the connector URL (already shown on the screen). The client discovers `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server`, registers at `/api/oauth/register`, sends the user to `/oauth/authorize` (consent), then exchanges the code at `/api/oauth/token`. Never paste a personal token into a hosted connector. |
| Local stdio MCP server (`mcp/co-newbiz`), CLI, scripts on the user's own machine | Personal API token (ADR-0146 item 6) | Issue a token in the new "Personal API tokens" section; set `CO_NEWBIZ_API_TOKEN` and `CO_NEWBIZ_API_BASE_URL` in the MCP client config. |

The screen states this tree in a short help block above both sections (English description of the
Korean UI copy): "Connecting a hosted AI app? Use the connector URL above. Running the local MCP
server or a script? Issue a personal token below."

## 3. Verified current state (code read 2026-10-11)

| Item | Finding | Evidence |
|---|---|---|
| Hashed storage | Yes. SHA-256 of a 32-byte random hex token; plaintext returned once, never stored | `db/lib/api-tokens.ts` `hashToken`, `issueApiToken` |
| Audit | `api_token_issue` on issue; revoke audit to be confirmed by Row 1; **use is not audited** (only `last_used_at` updated) | `db/lib/api-tokens.ts` |
| Scopes | Personal tokens: `read`, `write` only. `propose` exists only in the OAuth vocabulary | `api-tokens.ts:22`, `db/lib/oauth.ts:28` |
| Role gates on issue | viewer and admin cannot request `write` | `app/web-next/app/api/tokens/route.ts` |
| **Bearer can mint and revoke tokens** | `POST /api/tokens` and `DELETE /api/tokens/:id` call `authenticate()` only. A write-scoped bearer token can mint new tokens (laundering its lifetime) and revoke sibling tokens. Read-only bearers are stopped only by the generic non-GET write-scope check. The in-process OAuth-delegated principal is also `via: "bearer"`. | `app/web-next/lib/auth.ts:92-170`, both route files |
| **Expiry not enforced for personal tokens** | `api_token.expires_at` exists (migration 0128) but `issueApiToken` never sets it and `validateApiToken` never checks it. Personal tokens never expire today. | `api-tokens.ts:48-95` |
| Role change after issue | `validateApiToken` returns stored scopes; a user demoted to viewer keeps a write token | `api-tokens.ts:74-95` |
| Count cap / rate limit | None on `/api/tokens` | route files |
| Error hygiene | `token_issue_failed` echoes `err.message`; the viewer refusal is a hard-coded Korean string | `route.ts` |
| CSRF | Cookie mutations require same-origin plus double-submit `x-csrf-token` | `auth.ts:147-166` |
| Identification | No prefix; list shows label only | `listApiTokens` |
| OAuth rows in list | Not leaked (`kind = 'personal'` filter) | `listApiTokens` |

## 4. Design

### 4.1 Backend (Row 1)

1. **Human session only.** Reuse the `requireHumanSession` contract from
   `app/api/oauth/authorize/route.ts`: `POST /api/tokens` and `DELETE /api/tokens/:id` return
   `403 session_required` unless `auth.via === "cookie"` (which also excludes the delegated
   principal). `GET` stays available to any authenticated caller (owner-scoped, hash-free).
2. **Expiry.** `issueApiToken` takes `expiresInDays` from the allowed set {7, 30, 90}; default
   **30**, maximum **90**; stored in the existing `expires_at`. `validateApiToken` adds
   `AND (t.expires_at IS NULL OR t.expires_at > ?)`. Justification against ADR-0154: hosted
   connectors get 15-minute access tokens and a 7-day refresh family because they can refresh
   silently. A stdio token has no refresh path, so a 7-day ceiling would force weekly manual
   reissue and push users toward pasting tokens around; 30 days default with a 90-day hard cap
   bounds a leak to one quarter at most, versus unbounded today. Expiry is never extended; reissue.
3. **Count cap.** At most **5 active** (not revoked, not expired) personal tokens per user; the next
   issue returns `409 token_limit_reached`.
4. **Rate limit.** Issue: 10 per user per hour (in-memory window, same pattern as
   `/api/oauth/register`); `429 rate_limited`.
5. **Scope rules.** Allowed requests: `["read"]` or `["read","write"]` (`write` implies `read`).
   viewer and admin: `read` only (ADR-0146). Other roles: either. At validation time
   `validateApiToken` intersects stored scopes with the user's *current* role (drop `write` for
   viewer/admin), mirroring `validateAccessToken` for OAuth.
6. **Prefix.** New tokens are `cnb_pat_` + 64 hex chars. The prefix lets secret scanners (GitHub
   push protection, gitleaks) recognise leaks. For display, the UI shows `cnb_pat_` plus the last
   6 chars of the non-secret token id, so no new column is needed. Legacy unprefixed tokens keep
   validating (the hash covers the full string).
7. **Audit.** `api_token_issue` (detail: scopes, expires_at), `api_token_revoke` (add if absent),
   `api_token_issue_denied` (role, cap, or rate refusal), and `api_token_use` written at most once
   per token per hour (throttled by comparing `last_used_at`). Audit detail never contains the token
   or its hash.
8. **Error hygiene.** Fixed English error codes with messages from the i18n layer; never echo
   `err.message`. Unknown failures return `500 token_issue_failed` with a generic message and are
   logged server-side without the request body.
9. **No secret in logs or URLs.** Token only in the 201 JSON body with `Cache-Control: no-store`.
   Revoke addresses the id, never the token.
10. **List** returns `id, label, scopes, created_at, last_used_at, expires_at, revoked_at,
    display_id`, plus computed `status` (active | expired | revoked).

### 4.2 Frontend (Row 2)

New section "Personal API tokens" on `/settings/connected-apps`, below the connector list, built
from existing Onyx 3.0 components (design-guide.md, `design:lint` clean).

- Help block with the decision tree (section 2).
- Issue form: Label (required, max 80 chars), Access (radio "Read only" / "Read and write"; the
  write option is not offered to viewer/admin, with a one-line reason), Expiry (7 / 30 / 90 days,
  default 30). One primary button, "Issue token".
- One-time reveal modal: token in a read-only monospace field, Copy button, warning ("This token is
  shown only once; store it in your MCP client config now"), and a copyable config snippet:

  ```json
  {
    "mcpServers": {
      "co-newbiz": {
        "command": "bun",
        "args": ["<path-to-repo>/mcp/co-newbiz/index.ts"],
        "env": {
          "CO_NEWBIZ_API_BASE_URL": "<current origin>",
          "CO_NEWBIZ_API_TOKEN": "<token>"
        }
      }
    }
  }
  ```

  Row 2 must confirm the actual stdio entry-point path from `mcp/co-newbiz` before hard-coding it.
  The plaintext lives only in component state, is cleared on close, and is never written to
  localStorage, the URL, analytics, or the console. The modal closes via an explicit
  "I have stored it" button.
- Token table: Label, Identifier, Access, Created, Last used, Expires, Status, Revoke. Status is text
  plus icon, never color alone.
- Revoke: confirmation dialog naming the label; destructive button; result announced.
- All mutations go through the existing `api` client (sends `x-csrf-token`).

## 5. ADR assessment

**No new ADR is required for this design as specified.** No schema change (reuses `expires_at`,
`revoked_at`, `kind`, `last_used_at`), and the auth model is narrowed rather than widened (personal
tokens gain expiry, role re-check, and lose the ability to mint or revoke tokens). It does not
contradict ADR-0154, which rejected long-lived personal tokens in *hosted* connectors and kept them
for local clients. Recommend a dated amendment note on ADR-0146 item 6 recording the new lifetime
and session-only issuance rules. An ADR **is** required if the human opts for a `token_prefix`
column, a `propose` scope on personal tokens, or any change to the OAuth flow.

## 6. Threat model

| Threat | Exposure today | Mitigation |
|---|---|---|
| Stolen token (config file, git commit, shell history) | Valid indefinitely | 30-day default / 90-day max expiry; UI revoke; `cnb_pat_` prefix for secret scanning; last-used and use audit |
| XSS exfiltration of the one-time secret | No UI yet | Secret held only in modal state, rendered as text (no raw HTML injection), cleared on close, `no-store`; existing CSP unchanged |
| Agent or script minting tokens with an existing token | **Possible** with a write bearer | Session-only issue and revoke (`403 session_required`) |
| Privilege escalation via scope | Role checked only at issue | Role re-checked at validation; viewer/admin capped to read; scope allow-list |
| CSRF on issue/revoke | Mitigated (Origin + double-submit) | Unchanged; add regression tests |
| Token hoarding or burst issuance | Unlimited | Cap of 5 active; 10 issues per hour |
| Enumeration via revoke | Mitigated (404 for foreign id) | Unchanged |
| Error leakage | `err.message` echoed | Fixed codes and generic messages |

## 7. Tests

Backend: bearer POST and DELETE rejected (403 `session_required`); cookie without CSRF rejected;
viewer/admin write refused; default expiry 30 days, 91 rejected; expired token rejected by
`validateApiToken`; legacy NULL expiry still accepted (pending Q2); role demotion drops `write`;
cap returns 409; rate limit returns 429; audit rows for issue, revoke, denied, and throttled use;
audit, list, and logs never contain token or hash; prefixed and legacy tokens both validate.
Frontend: token visible only in the modal and cleared on close; copy feedback; write option hidden
for viewer/admin; revoke confirmation. Re-run `tests/unit/mcp-oauth.test.ts` (27 pass at baseline).

## 8. Accessibility (WCAG 2.1 AA)

Modal: `role="dialog"`, `aria-modal="true"`, labelled by its heading; focus moves into the dialog on
open, is trapped while open, and returns to the "Issue token" button on close. Escape does not
discard the token before the "I have stored it" confirmation. Copy outcome announced through an
`aria-live="polite"` region ("Copied to clipboard" / "Copy failed; select the text manually"). The
token field is focusable and selectable. Table uses header cells and a caption; statuses are text.
All controls keyboard operable with visible focus and token-based contrast.

## 9. Preview verification

Verify in the browser preview at desktop (1280 px) and mobile (375 px) at minimum: issue flow, modal
fit and horizontal scroll of the config snippet on mobile, table to card collapse per standard
screens, revoke dialog, and a viewer account (no write option).

## 10. Non-goals

No OAuth changes (flow found intact; section 11). No `propose` scope for personal tokens. No new
columns. No admin-console changes. No expiry-reminder notifications.

## 11. OAuth connector flow check (first-time connector)

Static review of: discovery (`/.well-known/oauth-protected-resource`,
`/.well-known/oauth-authorization-server`); dynamic registration (public clients only, per-IP rate
limit, optional redirect-host allowlist via `CO_NEWBIZ_OAUTH_REDIRECT_HOST_ALLOWLIST`); consent page
`/oauth/authorize` (requires a human cookie session; a logged-out user is redirected by AppShell to
`/login?next=...` and the login page accepts `next` values starting with `/oauth/`); code exchange
and refresh at `/api/oauth/token`; `validateAccessToken` (audience, expiry, role-intersected scopes).
`bun test tests/unit/mcp-oauth.test.ts`: 27 pass, 0 fail. **No broken step found in code.**
Could not verify: a live round trip from a real hosted client against the deployed origin (public
HTTPS reachability, allowlist env correctness).

## 12. Task split

| Row | Agent | Work |
|---|---|---|
| 1 | backend-engineer | Section 4.1 and backend tests |
| 2 | frontend-engineer | Section 4.2, accessibility, preview at two breakpoints |
| 3 | cross review (security-engineer plus a different-domain reviewer) | Re-check section 6 against the diff |

## 13. Open questions for the human

1. Which app did the user try to connect (hosted connector or local stdio)?
2. Existing personal tokens have no expiry: backfill to now + 30 days, or leave until revoked?
3. Should personal tokens ever carry `propose` for stdio proposal tools? (ADR required.)
4. Confirm the numbers: default 30 days, max 90, cap 5 active, 10 issues per hour.

## 14. Amendments (2026-10-11, Row 1 backend execution — decisions fixed by PM)

The open questions in section 13 (items 2-4) were decided by PM for implementation:

1. **Legacy NULL-expiry tokens (Q2): backfill to now + 30 days, applied lazily.** No one-shot
   migration: the first successful `validateApiToken` on a NULL-expiry row writes
   `expires_at = now + 30 days` once (the UPDATE is guarded by `AND expires_at IS NULL`, and the
   value never extends on later validations). Rationale: migration-free, works identically in dev
   and production, and a token only gains its grace window when it is actually used. A grace
   stamping that never runs leaves the token unbounded-but-unused, which is the same exposure as
   today for dormant rows, and any real use immediately bounds it.
2. **Numbers confirmed (Q4):** default 30 days, allowed set {7, 30, 90}, hard maximum 90
   (anything else is `400 invalid_request`); cap of **5 active** personal tokens per user
   (`409 token_limit_reached`); **10 issues per user per hour** (`429 rate_limited`, in-memory
   window keyed by user id — same pattern as `/api/oauth/register`; denials count against the
   window).
3. **No `propose` scope on personal tokens (Q3):** the REST vocabulary stays `read` / `write`
   only; requests outside `["read"]` / `["read","write"]` are `400 invalid_request`. No ADR needed.
4. **No new tables.** The design's optional `api_token_use` / `api_token_issue_denied` audit
   tables were NOT created: the existing append-only `audit_log` (FR-SEC-07) carries both as
   actions (`api_token_use`, throttled to at most one row per token per hour via `last_used_at`;
   `api_token_issue_denied` with the refusal reason — `role:viewer`, `role:admin`, `token_limit`,
   or `rate_limited` — as the target). This avoids the schema change and its ADR trigger entirely;
   `appendAudit` has no detail column, so no token or hash can leak into the log by construction.
5. **Bearer rejection order:** the session gate refuses any `Authorization: Bearer` credential
   *before* `authenticate()` runs, so a read-scoped bearer gets `403 session_required` (not the
   generic `insufficient_scope`) on issue and revoke, matching section 4.1.1's contract.
6. **Prefix:** new tokens are `cnb_pat_` + 64 hex chars (72 total). The hash covers the full
   string, so legacy unprefixed tokens keep validating unchanged.

### 14.1 Row 3 security-review dispositions (2026-10-11, PM decisions)

1. **Viewer/admin issue form:** the UI intentionally hides the whole issue form from viewer and
   admin accounts — stricter than design §4.2, which only hid the write option. The backend still
   accepts a read-only issue from those roles (API-only path), so no route change; revisit if a
   viewer actually needs a read token from the UI.
2. **Cap TOCTOU and in-memory rate limit accepted:** the cap check-then-insert race and the
   per-process in-memory issue rate limit are accepted single-process limitations; revisit both
   on any multi-instance deployment (shared store or DB constraint).
3. **(item 4) Config snippet placeholder:** the `<repo-path>` placeholder in the MCP config
   snippet is accepted as designed; Row 2 resolves it at render time from the page origin, and no
   server-side path disclosure is involved.
4. **List shape (review defect):** the UI now types `scopes` as the comma-joined string the list
   API returns and parses it for display (`split(",")`), replacing the accidental substring
   `includes()` check. The backend list shape is unchanged.

## Amendment 2026-10-29 — 180-day option and Connected apps UI review

- **TTL set:** the allowed expiry set becomes {7, 30, 90, **180**} and the hard maximum 180 days (owner
  request: "add 6 months as a maximum allowed period"). Default stays 30 days. Sections 4.1, 7 and the
  threat table above that cite "90-day max" read 180 from this date. Constants: `TOKEN_TTL_DAYS` /
  `MAX_TTL_DAYS` in `db/lib/api-tokens.ts`, mirrored in `app/web-next/lib/token-issue-access.ts`
  (parity test); `expiresInDays` enum in `docs/architecture/openapi.yaml`. The admin per-user route
  takes no `expiresInDays`, and the MCP server carries no TTL list, so neither changes.
- **ADR:** a longer credential lifetime relaxes the stolen-token mitigation, so it is recorded as a
  dated amendment note on ADR-0146 item 6 (no new ADR: no schema, scope or flow change).
- **UI:** the page was reorganised into two explained sections (hosted AI apps via the connector URL,
  personal tokens for local MCP/scripts), with D-n expiry, an expiring-soon (7 days or fewer) chip,
  relative last-used, and a status filter. API contracts are unchanged.
