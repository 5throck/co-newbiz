---
name: auth-and-account-management
scope: co-newbiz
description: >
  Operates the account lifecycle (pending -> active, lockout, password
  reset) and API-token issuance built in Wave 5.5/5.6A — PBKDF2-HMAC-SHA256
  hashing (FR-SEC-09, reused from `scripts/lib/auth.ts`, never
  reimplemented), existence-never-leaked authentication failures, and the
  must-change-password gate that permits exactly three routes
  (me/logout/password-change) until satisfied.

  Use when: "account lockout", "password reset", "must change password
  gate", "API token issuance", "session lifecycle".
version: 1.0.0
last_reviewed: 2026-08-20
status: active
owner: security-engineer
prerequisites: none
metadata:
  type: implementation
  triggers:
    - account lockout
    - password reset
    - must change password gate
    - API token issuance
    - session lifecycle
---

## Context

`db/lib/accounts.ts` and `db/lib/api-tokens.ts` already implement this
fully (Wave 5.5/5.6A) — this skill is the operational and extension
discipline: `authenticate()` returns `invalid_credentials` for both an
unknown user and a wrong password (never distinguishing them, so
account existence is never leaked); 5 consecutive failures lock for 30
minutes; a `changePassword`/`resetPassword` call revokes all existing
sessions and issues a fresh one; the must-change-password gate allows
exactly `/api/auth/me`, `/api/auth/logout`, `/api/auth/password-change`
until satisfied — enforced in `app/server/middleware.ts`, applying equally
to Bearer tokens so a forced-reset account can't route around the gate by
switching credential type.

## When to Use

- Any change touching authentication, session, or API-token behavior
- Investigating a lockout or password-reset issue
- Adding a new must-change-password-gated route (confirm the allowlist doesn't need extending)

## Execution Steps

1. **Never bypass `scripts/lib/auth.ts`'s hashing functions** — every
   password-touching code path reuses `hashPassword`/`verifyPassword`,
   never a local reimplementation (FR-SEC-09)
2. **Preserve the existence-never-leaked property**: any new
   authentication-adjacent error path must not distinguish "unknown user"
   from "wrong password" in its response
3. **Confirm the lockout counter resets correctly** on a successful login
   and that a stale lock (past its 30-minute window) unlocks automatically,
   not via a manual reset
4. **Confirm both credential paths are gated**: cookie sessions AND Bearer
   tokens both respect must-change-password — a new route added to either
   surface needs the gate to apply, or an explicit, reviewed allowlist addition
5. **API tokens**: `read`/`write` scope enforced before any handler runs
   (middleware-level, not per-route) — a token issued with `read` scope
   can never mutate regardless of which route it hits

## Output Format

- Auth/account behavior change or investigation finding, with confirmation
  the existence-never-leaked and dual-credential-gating properties still hold

## Related Skills

- `rest-api-design` — the auth requirement every endpoint declares
- `access-control-review` — the periodic operational audit of this system
