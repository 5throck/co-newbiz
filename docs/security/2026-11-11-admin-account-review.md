---
lang: en
---

# Admin Account Security Review — applying the user-account baseline to `admin`

**Date**: 2026-11-11
**Author**: security-engineer (dispatched by PM; review-only, no code changes in this dispatch)
**Status**: Proposed — owner review required before any fix batch
**Baseline of record**: `docs/security/security-model.md` §4 (authentication/session), §7 (eight-point verification), §8 (wave status), enforced by `tests/unit/security.test.ts`
**Anchors**: FR-SEC-01..09 (`docs/architecture/srs.md` L134-142), ADR-0009, ADR-0011, ADR-0012, ADR-0091, ADR-0146 (incl. 2026-10-29 amendment), ADR-0154
**Dispatch source**: PM pre-dispatch survey, 12 questions

---

## 1. Scope and method

The user-account baseline is defined in `docs/security/security-model.md`:

- **§4** — PBKDF2-HMAC-SHA256 / 210,000 iterations / 16-byte salt / 32-byte key reused from `scripts/lib/auth.ts` (ADR-0009, FR-SEC-09); plaintext never logged; password reset sets `must_change_password=1` + revokes sessions + forces the change flow + checks `password_history`; lockout after N failed attempts; server-side sessions allowing forced termination.
- **§7** — the eight-point verification list (non-member invisibility, admin ≠ deal-data visibility, single enforcement point, MNPI handling, comp aggregate floor, executive surrogate key, append-only audit log, unrecoverable passwords), each pinned in `tests/unit/security.test.ts` (40 tests, real scratch SQLite).
- **§8** — wave-status table recording the evidence per point.

**Method.** Every factual claim in the PM survey was re-verified against source at specific file:line before judging (facts cited below were read, not assumed). Code paths were exercised only through the existing test suite — no server was started, no live DB was opened read-write except one `sqlite3 -readonly` query noted in §7. The baseline was then applied to the `admin` role mechanism by mechanism: where the same engine serves both roles (it nearly always does — one `db/lib/accounts.ts`, one `app/web-next/lib/auth.ts` gate), parity is recorded as such; where admin has its own path (bootstrap, token scope, self-demotion guards, business-content separation), the difference is called out explicitly and judged against FR-SEC-01..09 and the cited ADRs.

**Verdict vocabulary.** *OK* = verified and conformant, no action. *Finding* = a defect or gap against the baseline or good practice, with a recommended fix. *Accepted-risk* = not a defect today; requires an explicit owner decision to keep, with rationale recorded. Severity: **P1** immediate fix / **P2** planned fix / **P3** accepted-risk.

---

## 2. Baseline conformance table — §4/§7 mechanism × user vs admin

| # | Mechanism (baseline ref) | User accounts | Admin account | Verdict |
|---|---|---|---|---|
| 1 | PBKDF2-HMAC-SHA256, 210k iter, 16B salt, 32B key (§4, ADR-0009, FR-SEC-09) | `db/lib/accounts.ts` L26 imports `hashPassword`/`verifyPassword` from `scripts/lib/auth.ts` (L24-30: 210_000/16/32) | **Identical engine** — same import path; no admin-specific hashing anywhere. Live DB check (§7 below): every credential-bearing row at 210,000 iterations | Identical — OK |
| 2 | Plaintext never logged (§4, FR-SEC-09) | `accounts.ts` L8-9 (engine header), L263-268 (only salt+hash persisted) | **Identical**, with one admin-only exception: the first-boot bootstrap prints the initial admin password to stdout (`app/web-next/instrumentation.ts` L160-179) — judged in Finding Q1 | Difference — accepted-risk (Q1) |
| 3 | Reset forces change flow + revokes sessions + `password_history` (§4) | `resetPassword` `accounts.ts` L332-346; `changePassword` L290-316; reuse block L251-261 | **Identical engine.** Admin-initiated reset of an admin account goes through the same function | Identical — OK |
| 4 | `must_change_password` gate (§4) | `app/web-next/lib/auth.ts` L56 (allowlist), L170-173 (gate) | **Identical and stronger than assumed**: gate applies to cookie, bearer, AND in-process MCP-delegated contexts (L93-138 resolve all three before L170) — see Q3 | Identical — OK (Q3) |
| 5 | Lockout 5 failures / 30 min (§4) | `accounts.ts` L30-31, L183-192; audited `account_locked` L188 | **Identical** — role-agnostic constants; admin lockout audited the same way | Identical — OK |
| 6 | Server-side sessions, hashed token storage, revocation (§4, FR-SEC-09) | `accounts.ts` L208-218 (SHA-256 of token stored), L241-249 (revoke) | **Identical** — one `session` table, one `validateSession` | Identical — OK |
| 7 | Audit trail on auth/admin events (§2, FR-SEC-07, ADR-0012) | login `accounts.ts` L198; lockout L188; logout `app/web-next/app/api/auth/logout/route.ts` L19; token issue/use/revoke `db/lib/api-tokens.ts` L90, L153, L175 | **Same writer** (`appendAudit`, `db/lib/access-control.ts` L37-44); admin actions audited: `account_create/approve/set_role/set_display_name/disable/enable/reset/delete` (`app/web-next/app/api/admin/users/[userId]/route.ts`) | Identical writer; evidence-quality gap — Finding Q7 |
| 8 | Approval flow: pending → active (§4, design §4-9) | `createUser` lands `pending` + `must_change_password=1` (`accounts.ts` L99-103); `approveUser` L134-145 | **Identical**, plus one admin-only path: bootstrap **self-approves** (`instrumentation.ts` L161-169, `approvedBy: "bootstrap"`) because no other admin can exist on first boot | Difference — accepted-risk (Q1) |
| 9 | Admin ≠ deal-data visibility (FR-SEC-02) | n/a | Enforced at the repository layer (`security.test.ts` §7-2, L117-122) and extended to all business routes read+write via `requireBusinessActor` (`app/web-next/lib/auth.ts` L215-225; ADR-0146) | Enforced — OK |
| 10 | Personal API tokens | `db/lib/api-tokens.ts` (hash-only storage L84-88, cap L45, TTL L39-41) | **Admin-specific loss of write scope**: `ROLE_WRITE_FORBIDDEN` includes admin (L103), write stripped again at every validation (L158-161), refused at issue (`app/web-next/app/api/tokens/route.ts` L90-92) | Difference — accepted-risk (Q4) |
| 11 | Self-demotion / self-delete guards (admin-only) | n/a | `set_role` refuses demoting self (`[userId]/route.ts` L43); `delete` refuses self-delete (L93) | Admin-only safeguard — OK |
| 12 | Business-content separation (ADR-0146, ADR-0091) | n/a | Admin blocked from ~72 write routes + ~60 read routes via central `requireBusinessActor`; admin keeps `/api/admin/**`, glossary, notifications, auth, reference data | Enforced — OK (pins: `admin-business-write-guard`/`read-guard` tests) |
| 13 | Session parameters: 12h, no idle timeout, no concurrency limit, no rotation | `SESSION_HOURS=12` (`accounts.ts` L32), cookie `maxAge 12*3600` (`lib/auth.ts` L42) | **Identical** — same constants, same engine | Identical — OK (parity); absolute strength — accepted-risk (Q11) |

**Net**: the admin role rides the same account/session engine as users for hashing, lockout, sessions, reset, and audit. The four genuine differences are: bootstrap self-issuance with a log-printed password (Q1), read-only personal tokens (Q4), business-content separation (ADR-0146 — a restriction, not a gap), and self-demotion/self-delete guards (safeguards).

---

## 3. Findings — the 12 questions

### Q1 — Bootstrap admin password printed to the container log

**Fact.** On first boot with an empty user table, `app/web-next/instrumentation.ts` L150-182 generates a 16-byte CSPRNG password (`crypto.getRandomValues`, 68-char alphabet — ~98 bits, L6-9), creates and **self-approves** `admin` (L161-169), and prints the password in a banner to stdout (L171-179). `createUser` always sets `must_change_password=1` (`db/lib/accounts.ts` L101), so the printed password is dead after the first login, and the gate (`lib/auth.ts` L170-173) blocks every other action until then. *Who authenticates first boot*: the human who runs the server — bootstrap self-approval exists precisely because no other admin exists; if the banner is lost before anyone logs in, the break-glass is the CLI (`scripts/co-newbiz/newbiz.ts` `user:create` + `user:approve`, password via stdin) or wiping the DB.

**Judgment: accepted-risk (P3).** The pattern matches established practice (Jenkins initial-admin-password), the secret is CSPRNG, one-time, and forced to rotate. The residual exposure is log retention: container stdout is routinely captured (docker logs, journald, aggregators) with read access often broader than the DB's. For this project's local/LAN deployment profile the risk is low, but it must be an owner decision, not an accident — see §5 AR-1. Optional hardening if production deployment ever arrives: support a pre-provisioned initial credential (env var or CLI seed) so the log never carries a live secret; the CLI path already covers this.

### Q2 — `Math.random()` fallback initial password in POST /api/admin/users

**Fact.** `app/web-next/app/api/admin/users/route.ts` L32:

```ts
const password = body.password && body.password.length >= 8 ? body.password : `tmp-${Math.random().toString(36).slice(2, 10)}!A`;
```

The PUT reset path uses a CSPRNG helper instead (`app/web-next/app/api/admin/users/[userId]/route.ts` L12-16, `crypto.getRandomValues` over base36, used at L82). Both paths return the plaintext once in the response and both force `must_change_password=1`.

**Reachability**: reachable whenever an admin creates a user without supplying a password ≥8 chars — a normal "create user" click in the console. **Judgment: finding (P2).** `Math.random()` is not a CSPRNG (Bun: xorshift128+); a fallback credential should never be sourced from a predictable PRNG, and the two code paths disagree for no reason. Exposure is bounded — the value is returned only inside the admin's authenticated response (not logged, not stored) and dies at first login — so this is hardening, not an incident. **Fix**: replace with the same `randomBase36` helper (hoist it to a shared module, e.g. `app/web-next/lib/password-gen.ts`, and use it in both routes). **Owning agent**: backend-engineer. Related note (same line, out of scope unless the owner wants it): an admin-supplied password of exactly "12345678" is accepted by both POST and PUT; minimum-length is the only check. Not counted as a finding here — password strength policy is an owner decision (see AR-3).

### Q3 — Does the `must_change_password` gate block bearer tokens too?

**Fact.** Yes. `app/web-next/lib/auth.ts` L56 defines `MUST_CHANGE_ALLOWLIST = {"/api/auth/me", "/api/auth/logout", "/api/auth/password-change"}`; L170-173 rejects every other path when `auth.mustChangePassword` is true. That field is populated for **all three** credential transports before the gate runs: cookie sessions (`validateSession` returns it, `accounts.ts` L238), bearer personal tokens (`validateApiToken` reads `u.must_change_password`, `api-tokens.ts` L132-136, L167), and the in-process MCP-delegated principal (`lib/auth.ts` L101-110). The allowlist intentionally permits only me/logout/password-change.

**Judgment: OK.** The claim in the survey is true and the design is correct: a pending-password admin cannot do anything with a token either. No action.

### Q4 — Admin read-scoped tokens (≤180 days) reaching /api/admin/** GETs

**Fact.** An admin may issue personal tokens (`token-issue-access.ts` L11-13 `canIssueToken` includes admin) with `read` scope only: write is refused at issue (`tokens/route.ts` L90-92) and stripped again at every validation (`api-tokens.ts` L103 `ROLE_WRITE_FORBIDDEN`, L158-161). Max TTL 180 days is the owner-approved ADR-0146 amendment (2026-10-29) with listed mitigations (D-n display, 7-day expiry warning, per-user cap 5, revocation, hourly `api_token_use` audit at `api-tokens.ts` L152-154). Such a token does reach `/api/admin/**` GETs: user roster (`/api/admin/users` → `listUsers`, identity columns only, `accounts.ts` L121-125), the full audit trail (`/api/admin/audit-log`), system stats, schedule runs, database overview. Admin endpoints are never MCP-exposed (`docs/architecture/api-spec.md` §8; ADR-0091).

**Judgment: accepted-risk (P3), needs an owner decision.** The write-scope loss is correct and verified (a stolen admin token cannot mutate anything). The remaining question is whether an admin needs personal tokens at all, given admin surfaces are console-UI-only by design; a 180-day unattended read credential over the audit log and user roster is a standing target. Two options for the owner: (a) keep, relying on the ADR-0146 amendment mitigations; (b) exclude admin from issuance (`canIssueToken` → analyst+viewer) with a migration grace period for existing admin tokens. Security-engineer recommendation: (b) if no admin-owned script/integration exists today; record either way as a decision, not silence. See §5 AR-2.

### Q5 — Existence/status leak via distinct auth-failure reasons

**Fact.** `db/lib/accounts.ts` L175-192: unknown id **and** wrong password on an existing account both return `invalid_credentials` (L175, L192) — existence of *active* accounts is not leaked. However, an existing account in a non-active state returns a distinct reason: `disabled` (L176), `pending_approval` (L177), `locked` + `lockedUntil` (L178-180). The login route maps these to distinct status codes (401/403/403/423, `login/route.ts` L51).

**Judgment: OK.** The leak that matters — enumerating loggable accounts — does not exist. The distinguishable states are precisely the ones that cannot be logged into, and telling a real user "your account is pending approval / disabled" is a deliberate usability property. Edge case: an attacker probing during the (attacker-induced) lockout window can confirm an id exists — a narrow, self-limiting window whose cost/benefit does not justify masking. No action.

### Q6 — Lockout DoS on the sole admin; break-glass

**Fact.** Lockout: 5 consecutive failures → 30 minutes (`accounts.ts` L30-31, L183-192); auto-expires on time, and a correct password after expiry unlocks (verified in `security.test.ts` "a successful login after lockout expiry…"). A determined attacker who knows the id `admin` can re-lock indefinitely — but the per-IP login throttle (10 failures / 15 min, `login/route.ts` L12-14) bounds the re-lock rate from one source, and each lock still requires 5 counted failures. **Break-glass exists, twice**: (1) the CLI — `scripts/co-newbiz/newbiz.ts` `user:reset-password` (stdin temp password; `resetPassword` clears `failed_attempts`/`locked_until`, `accounts.ts` L342), and `user:create` + `user:approve` to mint a second admin — host access required, same trust level as the DB; (2) another admin's `enable` action also clears the lockout (`[userId]/route.ts` enable branch). Lockout events are audited (`account_locked`, L188).

**Judgment: OK**, with two operational notes (not code findings): keep ≥2 active admin accounts so a lockout never removes the last administrator, and record the CLI break-glass runbook in `docs/security/security-baseline.md` (currently it lives only in `newbiz.ts` help text).

### Q7 — Audit-log evidence quality for admin incident response

**Fact.** `appendAudit` writes only `id, actor_user_id, action, target, created_at` (`db/lib/access-control.ts` L37-44) — no IP, no user-agent (`data_access_log` has an optional `ip` column, L46-66, but `audit_log` does not). Failed logins: an unknown id returns before any audit write and never touches a counter (`accounts.ts` L175; pinned by `admin-password-reset-login-flow.test.ts` "unknown user id … never touches any account counter"); a wrong password on an existing account increments the counter (L191) but is audited **only** when it reaches lockout (L188 `account_locked`) — the 1st-4th failures leave no durable trace, and the per-IP throttle counts live in an in-memory Map that is never persisted (`login/route.ts` L14). Successful logins, logouts, lockouts, and all admin mutations are audited.

**Judgment: finding (P2).** For an admin-compromise investigation the trail answers *who/what/when* but not *from where*, and password-spray reconnaissance against known ids is invisible until the 5th attempt. **Fix** (owner: backend-engineer; security-engineer review for ADR-0039 minimization): (a) add optional `ip`/`user_agent` columns to `audit_log` populated on auth events only (`login`, `account_locked`, and a new `login_failed` action for counted failures), with retention aligned to the existing `retention_registry` pattern; (b) leave unknown-id attempts uncounted (correct anti-enumeration behavior) but emit a throttled `login_failed_unknown` audit row so spraying is visible in aggregate. ADR-0012 append-only is unaffected (additive columns, INSERT-only).

### Q8 — Per-IP login throttle: in-process Map on leftmost `x-forwarded-for`

**Fact.** `app/web-next/app/api/auth/login/route.ts` L14 (`failedLoginsByAddress = new Map()`), L16-18 (`clientAddress` = **first** entry of `x-forwarded-for`, else "direct"), L20-27 (15-min window, 10 failures). Confirmed weaknesses: (a) the leftmost XFF entry is **client-controlled** whenever any proxy appends to the header — an attacker rotates fake XFF values and the per-IP limit never binds (and can be weaponized to lock out a victim's *real* address by spraying with the victim's IP spoofed); (b) in-process state — a restart clears it, and each worker/process would hold its own Map if the app ever scales beyond one; (c) "direct" collapses all header-less clients into one bucket (benign direction).

**Judgment: finding (P2).** The brute-force control that actually matters — per-account lockout — is not bypassable, so this is defense-in-depth that currently fails its one job against a deliberate attacker. **Fix** (owner: backend-engineer): key on the rightmost untrusted-proxy hop (the last XFF entry appended by *your* proxy) or on the socket remote address, and treat the Map as best-effort; if a trusted-proxy deployment is formalized, derive the client IP once in a helper shared with `requestIsSecure` (which already reads `x-forwarded-proto` correctly).

### Q9 — No rehash-on-login hash-upgrade path; are existing hashes at 210k?

**Fact.** `scripts/lib/auth.ts` (107 lines total) contains only `hashPassword` (default 210,000, L24, L59-70) and `verifyPassword` (uses the **stored** per-row iteration count, L79-86). No rehash-on-login exists anywhere (`accounts.ts` verifies and at most persists a new password on explicit change/reset). **Live DB state** (one `sqlite3 -readonly` query on `db/data/co-newbiz.sqlite`): 10 rows; all 6 credential-bearing accounts (incl. `admin`) at `password_iterations = 210000`; the other 4 (`demo-seed`, `demo-entity-reviewer`, `demo-group-reviewer`, `demo-admin`) have `salt='disabled'`, `hash='disabled'`, `iterations=1` — deliberate non-credential placeholders written by `scripts/co-newbiz/seed-demo-gate-contract.ts` L54-59, all `status='disabled'`. Those rows can never verify (`verifyPasswordSafe` catches the timingSafeEqual throw, `accounts.ts` L54-60), and `enable` does not touch hash columns — re-enabling one leaves an un-verifiable hash, which fails safe.

**Judgment: OK.** There is nothing to upgrade: every real hash is at the ADR-0009 parameters, and every future hash will be (single default). Latent note for the backlog, not a finding: if `PBKDF2_ITERATIONS` is ever raised, add a rehash-on-login (verify with stored iterations → re-hash at the new default) — the per-row `password_iterations` column already makes that possible without a migration.

### Q10 — No MFA anywhere; no admin password-rotation/expiry

**Fact.** Repo-wide grep for TOTP/MFA/2FA/authenticator across `app/`, `db/`, `scripts/`, `mcp/` finds no implementation (only unrelated string matches in migration SQL and a docs-link validator). No `password_expiry`/`max_age` field exists in the schema or engine; the only password-aging control is `password_history` reuse prevention (`accounts.ts` L251-261, tested in `security.test.ts` L365-371).

**Judgment: accepted-risk (P3), owner decision.** On rotation: NIST SP 800-63B discourages forced periodic rotation absent evidence of compromise, and the reset + history machinery covers the compromise case — "no expiry" is defensible and I do not recommend adding it. On MFA: for a single-tenant, admin-issued-account, LAN-scoped system, absence is a reasonable current posture, but admin is exactly the account whose compromise is unbounded, so this should be recorded as a deliberate owner decision with a revisit trigger (e.g., any exposure beyond the trusted network, or a second admin tenant). See §5 AR-3.

### Q11 — Admin session policy parity

**Fact.** Identical engine and constants for both roles: 12-hour absolute expiry (`SESSION_HOURS=12`, `accounts.ts` L32; cookie `maxAge 12*3600`, `lib/auth.ts` L42); no idle timeout (`validateSession` checks only `expires_at` and `revoked_at`, L228-239); no concurrent-session cap (`issueSession` inserts unconditionally, L208-218; forced termination is available rather than prevented); no token rotation mid-life (rotation happens only on password change/reset, which revokes all others, L310-311, L343). Expired-session rows are cleanup-eligible via the retention registry (`db/lib/retention-registry.ts` L147).

**Judgment: OK on parity** — the question asked whether admin matches users, and it does exactly. The absolute strength (no idle timeout / concurrency cap / rotation) is a shared posture for both roles, not an admin gap; recorded as accepted-risk AR-4 for the owner to affirm or schedule.

### Q12 — `requireAdmin` across 38 admin route files; is there a guard test?

**Fact.** `app/web-next/app/api/admin/**` contains **38** `route.ts` files; grep today shows **38/38** import and call `requireAdmin` (`app/web-next/lib/auth.ts` L200-205). **No test asserts this.** No test file walks the admin route directory (no `readdirSync`+`api/admin` combination in `tests/unit/`), and `scripts/co-newbiz/route-audit-scan.ts` (the `lint:route-audit` CI check) scans for audit tokens on write handlers, not for auth guards. The ADR-0070 constraint is real: `app/web-next/lib/auth.ts` L1-13 documents why there is no `middleware.ts` matcher (Next.js edge middleware cannot reach the bun:sqlite client), so FR-SEC-03-style runtime centralization of the *role* check is architecturally blocked; per-route calls are the designed pattern (ADR-0146 Decision 7 chose a central helper called per-route for the same reason).

**Judgment: finding (P2).** One forgotten `requireAdmin` in a future admin route ships silently; today's 38/38 is a manual observation, not a regression gate. **Fix** (owner: backend-engineer): add a static tripwire test in the existing style (cf. `business-write-gating-static.test.ts`) that walks `app/web-next/app/api/admin/**/route.ts` and asserts every file contains `requireAdmin` — with no allowlist needed (none of the 38 should ever be public). That converts Q12 from a review-time check into a CI invariant. Full runtime centralization: not recommended; blocked by ADR-0070 and would reintroduce the path-prefix-policy risk ADR-0146 explicitly rejected (its Alternative (b)).

---

## 4. Priority-ordered fix list (findings only)

| # | Severity | Fix | Question | Owning agent |
|---|---|---|---|---|
| 1 | P2 | Replace the `Math.random()` fallback with the CSPRNG `randomBase36` helper, hoisted to a shared module used by both POST create and PUT reset | Q2 | backend-engineer |
| 2 | P2 | Persist auth-attempt evidence: `ip`/`user_agent` on `audit_log` for auth events + `login_failed` / throttled `login_failed_unknown` actions, retention-registered | Q7 | backend-engineer (security-engineer review: ADR-0039) |
| 3 | P2 | Key the login throttle on the rightmost trusted XFF hop or socket address, not the client-controlled leftmost entry | Q8 | backend-engineer |
| 4 | P2 | Add a static route-walk test asserting every `app/api/admin/**/route.ts` calls `requireAdmin` (no allowlist) | Q12 | backend-engineer |

No P1 findings. Q3, Q5, Q6, Q9 require no code change; Q1, Q4, Q10, Q11 require owner decisions only (below).

---

## 5. Explicit accepted-risk register (owner decisions needed)

These are not defects; each becomes risk only if left *implicit*. The owner should record GO/HOLD per row (a one-line decision each; changes to the register then follow the normal ADR/decision-record path).

- **AR-1 (Q1) — First-boot admin password in container stdout.** Rationale for accepting today: CSPRNG ~98-bit value, printed once, forced rotation at first login, self-approval is unavoidable on a zero-user boot, break-glass CLI exists. Owner to affirm; revisit if the app is ever deployed where logs ship to shared/aggregated storage — at that point prefer pre-provisioned credentials (env or CLI) so the log carries no live secret.
- **AR-2 (Q4) — Admin personal read-tokens, up to 180 days, reaching `/api/admin/**` GETs.** Mitigations verified (write refused at issue `tokens/route.ts` L90-92 and stripped at validation `api-tokens.ts` L158-161; cap 5; hourly use audit; revocation). Owner to decide: keep (affirm ADR-0146 amendment) or exclude admin from token issuance. Security-engineer recommends exclusion unless an admin-owned integration exists.
- **AR-3 (Q10) — No MFA; no periodic password rotation.** Rotation: recommend *not* adding (NIST SP 800-63B; compromise handled by reset+history). MFA: owner decision with an explicit revisit trigger (deployment-scope change). If affirmed, note it in `docs/security/security-baseline.md` §"accepted risks".
- **AR-4 (Q11) — Session policy absolute strength (12h absolute, no idle timeout, no concurrent-session cap, no rotation).** Parity between user and admin confirmed (which was the review question). Affirm for the single-tenant internal posture; revisit on multi-tenant or internet-facing exposure.

**OK verdicts (no decision needed)**: Q3 (must-change gate covers bearer), Q5 (no active-account existence leak), Q6 (lockout self-heals; CLI break-glass exists — ops note: keep ≥2 admins, document the runbook), Q9 (all live hashes at 210k; demo rows are non-credential placeholders).

---

## 6. Verification commands run

Behavior-pinning tests (exact results, this date, Bun test runner):

| Test file | Result |
|---|---|
| `tests/unit/security.test.ts` (§7 eight-point + §4 account/session flows) | **40 pass / 0 fail** (59 expect calls) |
| `tests/unit/login-form-hardening.test.ts` (login form POST contract, register closure) | **20 pass / 0 fail** (58 expect calls) |
| `tests/unit/admin-password-reset-login-flow.test.ts` (reset → temp login → forced change; temp invalidation; unknown-id counter safety) | **8 pass / 0 fail** (50 expect calls) |
| `tests/unit/admin-users-master-crud.test.ts` (supporting: admin route 401/403 guards, audit rows) | 9 pass / 0 fail |
| `tests/unit/token-issue-access.test.ts` + `tests/unit/api-tokens.test.ts` (supporting: role/token scope rules) | 28 pass / 0 fail |

Fact checks (read-only):

- `grep -q requireAdmin` over all 38 `app/web-next/app/api/admin/**/route.ts` files — 38/38 present, 0 missing.
- `grep` for MFA/TOTP/2FA and password-expiry fields across `app/ db/ scripts/ mcp/` — no implementation found.
- `sqlite3 -readonly db/data/co-newbiz.sqlite "SELECT user_id, role, status, password_iterations, must_change_password FROM app_user"` — 6 credential-bearing rows at 210000; 4 demo placeholder rows (`salt/hash='disabled'`, iterations=1, status disabled) traced to `scripts/co-newbiz/seed-demo-gate-contract.ts` L54-59. The live dev DB was never opened read-write.
- Line-citation reads: `instrumentation.ts`, `db/lib/accounts.ts`, `db/lib/access-control.ts`, `db/lib/api-tokens.ts`, `app/web-next/lib/auth.ts`, `app/web-next/lib/token-issue-access.ts`, `app/web-next/app/api/auth/login/route.ts`, `app/web-next/app/api/admin/users/route.ts`, `app/web-next/app/api/admin/users/[userId]/route.ts`, `app/web-next/app/api/tokens/route.ts`, `app/web-next/app/api/admin/audit-log/route.ts`, `scripts/lib/auth.ts`, `scripts/co-newbiz/newbiz.ts`, `scripts/co-newbiz/route-audit-scan.ts`, `docs/security/security-model.md`, `docs/architecture/srs.md`, ADR-0009/0011/0012/0091/0146/0154.

No files other than this document were created or modified; nothing was committed.
