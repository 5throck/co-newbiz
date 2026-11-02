# Close Self-Registration — Admin-Provisioned Accounts Only (Implemented)

- **Date**: 2026-11-02
- **Status**: Implemented (owner decision 2026-11-02, Option A)
- **Author**: backend-engineer, under PM dispatch
- **Related**: ADR-0146-adjacent access tightening; ADR-0009 (PBKDF2 credentials); FR-SEC-01 (deny-by-default); `docs/architecture/openapi.yaml` `/api/auth/register`; `app/web-next/lib/register-rate-limit.ts` (L1 throttle, unchanged)

## 1. Problem

`POST /api/auth/register` allowed unauthenticated self-registration. Every
account created this way defaults to role `viewer`, and a viewer gets full
business READ via `requireBusinessActor` read mode — so anyone who could reach
the login page could self-register and read the entire deal pipeline
(MNPI-adjacent). The pre-approval `pending` state blocked login but not the
queue-and-wait path, and the login page actively advertised the affordance.

## 2. Owner decision (2026-11-02, "Option A")

Registration is closed; accounts are admin-provisioned only. The capability is
kept behind an explicit, documented environment flag so the decision is
durable and reversible without a code change:

- `CO_NEWBIZ_ALLOW_REGISTER` **unset or any value other than `1`** → registration closed.
  The endpoint refuses at the door with `403 registration_disabled`
  ("Registration is disabled. Accounts are issued by the administrator.") —
  the check precedes body parsing (no request-shape oracle) and the L1
  throttle (no quota consumption while closed).
- `CO_NEWBIZ_ALLOW_REGISTER=1` → the original behavior, unchanged and intact:
  rate-limited (L1, CF-Connecting-IP bucket) creation of a pending
  role=viewer account awaiting administrator approval.

Unaffected paths (verified by reading them; they never route through
`/api/auth/register`):

- The first-admin / operator CLI flow: `newbiz.ts user:create` (password via
  stdin, FR-SEC-09) + `user:approve`.
- Admin user creation: `POST /api/admin/users` (admin-session-gated,
  `createUser` + `approveUser`, audited).
- OAuth dynamic client registration `/api/oauth/register` (RFC 7591, ADR-0154)
  — registers OAuth clients, not user accounts; out of scope.

## 3. Changes

| Layer | Change |
|---|---|
| `app/web-next/app/api/auth/register/route.ts` | Dated header comment recording the owner decision; `registrationEnabled()` gate (exact `1`, read per request) returning `403 registration_disabled`; rate-limit + create logic intact behind the flag |
| `app/web-next/app/login/page.tsx` | Register link/section (`login-assist`) removed; header comment updated; accounts are admin-issued |
| `app/web-next/app/register/page.tsx` | Route kept, now a short disabled notice (no form, no API call) so stale bookmarks get an explanation instead of a 404 |
| `app/web-next/locales/{en,ko}.json` | `auth.registerHint` / `auth.registerPrompt` removed; `auth.register` reduced to `backToLogin` + `disabledHeading` / `disabledMessage` (en + ko parity) |
| `docs/architecture/openapi.yaml` | `/api/auth/register` summary/description reflect the closed-by-default contract; `403` response added |
| `.env.sample` | `CO_NEWBIZ_ALLOW_REGISTER` documented with a default-off comment |
| Tests | `tests/unit/api.test.ts`, `tests/unit/login-form-hardening.test.ts` — see §4 |

## 4. Test evidence

- `tests/unit/api.test.ts` — default-off `403 registration_disabled` with an
  assert that no account row is created; flag-on path still creates a pending
  viewer (the capability stays testable); pre-existing "pending account cannot
  log in" keeps its subject (created under the flag in the prior test).
- `tests/unit/login-form-hardening.test.ts` — login-page markup: no
  `href="/register"`, no register copy; register page markup: no form, no
  `api.post`, disabled notice + back-to-login link; route: closed
  form-encoded native POST is `403 registration_disabled` with no credential
  echo, no session, and no throttle-quota use; GET still 405; JSON contract
  behind `CO_NEWBIZ_ALLOW_REGISTER=1` still creates a pending account; flag
  removal closes the endpoint again (per-request read, not sticky).
- `tests/unit/register-rate-limit.test.ts` — L1 lib tests untouched and green.

## 5. Operational notes

- Deployments that want self-signup back set `CO_NEWBIZ_ALLOW_REGISTER=1`
  explicitly (see `.env.sample`); no code change, no migration.
- Existing self-registered `viewer` accounts (audit marker
  `created_by = 'self-signup'`) keep their access; an administrator may
  disable or delete them at their discretion — this change closes the door,
  it does not evict anyone already inside.
