---
title: Admin security fixes and deal-board honesty fixes — batch design (C-1, C-4, SR2-min, SR3-min, B-2, B-3, B-5, B-6)
date: 2026-11-11
status: Draft (Row 0 — Design Gate ADR-0074; implementation lands in Rows 1+ by separate dispatch)
owner: platform-lead (design); functional review by security-engineer (D1–D4) and process-governance-manager (D5–D8)
reviewers_required: security-engineer (AI-2nd, security items), docs-writer (language policy), owner (human approval)
decision_record: docs/decisions/DEC-20261111-02.md
related: ADR-0001 (SQLite), ADR-0086 (standard screen patterns), ADR-0091 (admin console split), ADR-0102 (deep links), ADR-0120 (deal funnel), ADR-0186 (gate integrity families), ADR-0193 (kill-criteria scoping), ADR-0194 (kill data sources), ADR-0196 (committee minutes as meeting), docs/security/security-model.md, design 2026-10-02-route-cleanup-followup-design §4.2
---

# Admin security fixes and deal-board honesty fixes

## 1. Scope and inputs

Eight items dispatched by PM under the Design Gate, Row 0 only (design doc + decision record + spec registration — no code, prompts, or tests are touched in this batch):

| ID | Item | Track |
|---|---|---|
| D1 | C-1 — unify initial-password generation to one CSPRNG helper | security |
| D2 | C-4 — requireAdmin tripwire static test | security |
| D3 | SR2-minimal — audit ALL failed login attempts (incl. unknown-id), no schema change | security |
| D4 | SR3-minimal — login per-IP throttle keys on the rightmost X-Forwarded-For hop, unit-pinned keying | security |
| D5 | B-2 — serverize CarrierGate AUTO-REDIRECT paths only | board |
| D6 | B-3 — kill-evaluation three-state chip on the gate-aging widget | board |
| D7 | B-5 — StageFrame/StageHandoffStrip mount coverage, test-enforced | board |
| D8 | B-6 — three verification checks (block-reason legibility, snapshot_stale rendering, tranche-conditions view) | board |

**Source-document delta (recorded honestly).** The dispatch references two source documents — `docs/improvement-plans/2026-11-11-website-review-improvement-plan.md` (Tracks A/B/C/D, SR/AR ids) and `docs/security/2026-11-11-admin-account-review.md` (findings section). Neither file exists in the working tree, in git history (`git log -- docs/improvement-plans/ docs/security/` returns only unrelated security-baseline files), or anywhere in the workspace. `memory/2026-11-11.md` shows a session summary claiming both were written, so the files were produced by an uncommitted session and lost. **This design was therefore built from the PM dispatch brief plus direct code verification of every claim (§2).** The missing documents are a documentation-integrity gap recorded in DEC-20261111-02 and its follow-up list; if the originals are recovered, they must be reconciled against §2 before Rows 1+.

**Out of this batch (recorded as such):** B-1 S6/S7 split (deferred to next S7 round), B-4 checklist (already embedded in the plan doc; quarterly cadence), Track A items (owner decisions pending), AR1–AR4 accepted risks (owner pending), schema-level audit upgrades (IP/user-agent columns + durable throttle store — follow-up ADR item, see §13), MFA.

## 2. Findings: what exists today (verified)

### 2.1 C-1 — two divergent initial-password generators

- `app/web-next/app/api/admin/users/route.ts:32` — POST fallback uses **`Math.random`**: `` `tmp-${Math.random().toString(36).slice(2, 10)}!A` ``. Confirmed verbatim.
- `app/web-next/app/api/admin/users/[userId]/route.ts:12-16` — PUT `reset_password` fallback uses a CSPRNG `randomBase36` (`crypto.getRandomValues`, comment at :11 states "the temporary password is a credential, not a display value"), used at :82.
- Both generate `tmp-…!A`-shaped 8-char strings; only the entropy source differs. `Math.random` is not a CSPRNG and is unsuitable for credential material.

### 2.2 C-4 — 38 admin routes, all guarded, no tripwire

- `find app/web-next/app/api/admin -name route.ts` → **38 files** (enumerated in the appendix of the design session; includes nested `[param]` routes such as `users/[userId]`, `schedule-jobs/[jobKey]/run`, `human-roles/[grantId]/revoke`).
- `grep -L requireAdmin` over those 38 → **empty** — every route file references `requireAdmin`. The claim "38/38" is accurate. No test enforces it; a new admin route forgetting `requireAdmin` would land silently.

### 2.3 SR2 — failed logins are only partially audited

`db/lib/accounts.ts`, `authenticate()`:
- `:175` — unknown user → `{ ok: false, reason: "invalid_credentials" }` with **no audit and no failed-attempt increment** (nothing to increment against). Password-sprays of non-existent ids leave no trace.
- `:188` — only the lockout moment is audited (`account_locked`).
- `:191` — wrong password below the lockout threshold increments `failed_attempts` but audits nothing.
- `:198` — successful login audited (`login`).
- Schema fits with zero changes: `audit_log` (migration 0002:57-63, rebuilt 0033:178-186) has `actor_user_id TEXT NOT NULL` — **no FK**, so recording an attempted (possibly non-existent) id as actor is legal; no IP/user-agent columns exist (deferred per §13). Append-only triggers (`audit_log_no_delete`/`no_update`, 0033:191-199) are compatible with insert-only auditing.

### 2.4 SR3 — login throttle keys on the client-spoofable hop

- `app/web-next/app/api/auth/login/route.ts:15-17` — `clientAddress()` takes **`x-forwarded-for.split(",")[0]`** (leftmost = client-controlled). A client that injects a fake leftmost entry gets a fresh bucket per request.
- `:13` — `failedLoginsByAddress` is a module-level `Map`, reset on restart (in-memory; accepted for now, durable store deferred to §13).
- Precedent divergence: `app/web-next/lib/register-rate-limit.ts:14-18` already uses `cf-connecting-ip` (Cloudflare tunnel header) and ignores XFF as client-spoofable. The login route ignores CF-Connecting-IP entirely.

### 2.5 B-2 — CarrierGate redirects are client-side

- `app/web-next/components/CarrierGate.tsx` (`"use client"`): Rule 1 query-carrier redirect at :156-158 (`router.replace`), Rule 3 single-carrier auto-redirect at :173-176 (`router.replace(..., moved=true)` per R2-A item 8), Rule 4 picker focus at :179-181.
- Exemptions that must survive any rework: `startsKnownTarget` (:135, `opportunities?known_target=1`), `startsNew` (:138, `market?new=1` / `opportunities?new=1`), and the zero-carrier embedded renders for market (:187-193) and opportunities (:198-213) — the dead-loop fixes from pilot-009.
- All five flat pages (`app/web-next/app/{market,opportunities,synergy,greenfield,brownfield}/page.tsx`) are `"use client"` stubs that only render `<CarrierGate route=... />`.
- Carrier sources today: `anyTrack()` = `/api/opportunities?status=selected&includePromoted=1` filtered `!deleted_at` (:120-126); `trackFiltered()` = `/api/greenfield` / `/api/brownfield` (greenfield route SQL filters `route_decision.track='greenfield' AND is_current=1`). The API route SQL is at `app/web-next/app/api/opportunities/route.ts:33-47`.
- **No server component in `app/web-next` queries the DB today** (grep for `getDb` in `page.tsx` → none). B-2 establishes the first RSC DB-read pattern; `db/client.ts` v1.1.0 already hardens the Turbopack dev-shim path resolution (marker validation, see header comment) so `getDb()` is safe under Next.

### 2.6 B-3 — gate-aging widget exists; kill evaluation is project-scoped

- Widget: `app/web-next/app/deals/page.tsx:342-375` — `data.currentHolds` from `/api/portfolio/pipeline`, table with decision chip (`kill` → `status-red`, else `status-amber`, :366) and ageDays. No kill-evaluation information today.
- Data: `app/web-next/lib/gate-aging.ts:19-73` (`listGateAging`, 90-day window, latest verdict per entity+gate); pipeline route filters visibility (`app/web-next/app/api/portfolio/pipeline/route.ts:15-24` — opportunity rows visible to all authenticated users, project rows through `visibleProject`).
- Kill ledger: `kill_criteria_evaluation` is **project-scoped** (`db/migrations/0023_kill_criteria_evaluation.sql:31`, `project_id NOT NULL REFERENCES md_project(id)`); three-state vocabulary `triggered | false | unassessed` enforced in `db/repositories/kill-criteria.repository.ts` (interface at :169-173, CHECK-comment at :117). Opportunity-level aging rows therefore have no kill ledger — the chip applies to project rows only.
- MNPI guard precedent: `db/lib/access-control.ts:107-122` (`project_classification.mnpi_flag` + insider list). A board-level aggregate must not leak triggered-criteria existence on MNPI projects to non-insiders.

### 2.7 B-5 — StageFrame is the sole wrapper; strip is unconditional inside it

- `StageHandoffStrip` renders unconditionally inside StageFrame's head (`app/web-next/components/StageFrame.tsx:283`); a standalone `StageHandoff` export exists for non-framed stage screens (:355-373, used by `app/web-next/app/opportunities/[id]/page.tsx:266`).
- Stage-surface mount inventory (verified imports): deal stage tab `app/web-next/app/deals/[id]/[stage]/page.tsx` and deal overview `app/web-next/app/deals/[id]/page.tsx` (direct StageFrame); project S8–S12 wrappers `business-case`, `dd`, `deal-structure`, `ic-review`, `portfolio` (each imports its shared `*Stage.tsx`, which imports StageFrame — verified in all five); S10 sub-tabs `debt/incentives/sites/permits` via `components/stages/S10Frame.tsx` (:44 → StageFrame); direct-mount utility stage pages `charter`, `financial-analysis`, `proxy-chain`, `reports`, `wacc`; `route-decision`, `brownfield/targets/[targetId]`, `projects/page.tsx` (direct).
- Existing static-test precedent: `tests/unit/project-write-gating-static.test.ts` (per-file regex assertions) — the pattern D7 follows.

### 2.8 B-6 — verification trio results

- **(a) `committee_session_missing` legibility — PASSES, no fix required.** The GO screen renders every known hard block with catalog title+body (`app/web-next/components/GateSnapshotAck.tsx:526-570`, `blockText` covers all `KNOWN_HARD_BLOCKS`; `committee_session_missing` listed in `app/web-next/lib/gate-integrity-view.ts:90`); ko/en catalog text exists (`locales/en.json:2981`, `locales/ko.json:2981`). The server rejection message is also legible with repair instructions (`app/web-next/lib/gate-decision-contract.ts:430-438`, 409). Minor inconsistency noted, not blocking: `GateDecisionPanel.tsx:720-723` uses catalog text only for `kill_carry_*`/`kill_lineage_missing`/`kill_enforce_unsafe`, falling back to the (equally legible) server message for other codes — optional cosmetic alignment recorded in §13.
- **(b) 409 `snapshot_stale` rendering — PASSES.** Server message is explicit (`gate-decision-contract.ts:521-526`: "The gate state changed since the snapshot you reviewed…" / missing-hash variant); the client swaps in the fresh snapshot, reconciles ack state, and shows a `staleChanged` notice (`GateDecisionPanel.tsx:682-694`).
- **(c) `venture_transition_decision.tranche_condition` — column exists, NO read-only view.** Added by `db/migrations/0121_venture_transition_record_columns.sql:34`; written by the transition-decision API (`app/web-next/app/api/projects/[id]/transition-decision/route.ts:47-49,128`); no component reads it for display (grep across `app/web-next` → write path only). Per the B-6 mandate, **recorded as a follow-up (§13), not built in this batch.**

## 3. D1 (C-1): one CSPRNG helper for initial/temporary passwords

**Files touched:** new `app/web-next/lib/temp-password.ts`; `app/web-next/app/api/admin/users/route.ts`; `app/web-next/app/api/admin/users/[userId]/route.ts`.

**Design.**
- Move `randomBase36` out of the `[userId]` route into `app/web-next/lib/temp-password.ts` as the single generator, exported as `generateTemporaryPassword(): string` returning `tmp-${randomBase36(8)}!A` (alphabet and shape byte-identical to the current PUT output — `abcdefghijklmnopqrstuvwxyz0123456789`, `crypto.getRandomValues`, `b % alphabet.length`).
- `POST /api/admin/users` (:32) and PUT `reset_password` (:82) both call `generateTemporaryPassword()` when no admin-supplied password (≥8 chars) is present. The admin-supplied branch is unchanged (admins may set their own ≥8-char values).
- Comments updated: the POST route drops any implication that the initial password is non-credential; the header comment of temp-password.ts states the credential rationale (ported from the PUT route's :11 comment).

**Test plan.**
- New `tests/unit/temp-password.test.ts`: alphabet/shape assertions (matches `/^tmp-[a-z0-9]{8}!A$/`), distribution sanity (two calls differ; exercised repeatedly), and a static assertion that no `Math.random` call remains anywhere under `app/web-next/app/api/admin/**` (regex walk, same pattern as D2).
- Extend `tests/unit/admin-users-master-crud.test.ts`: POST without `password` → returned `initial_password` matches the shape and authenticates; PUT `reset_password` without `temporary_password` → same.

## 4. D2 (C-4): requireAdmin tripwire static test

**Files touched:** new `tests/unit/admin-require-admin-tripwire.test.ts` (no product code).

**Design.** A static route-walk test in the `project-write-gating-static.test.ts` pattern:
- Enumerate every `route.ts` under `app/web-next/app/api/admin/**` recursively at run time (`readdirSync` walk — new admin routes are picked up automatically, no fixture to rot).
- For each file, assert (1) the source references `requireAdmin(`, and (2) it imports `authenticate` from the shared auth lib (`/lib/auth`). A route that handles requests but never calls `requireAdmin` fails with a message naming the file.
- Guard against a vacuous pass: assert the enumeration finds ≥ 30 files (38 today) so an accidental path change can't silently empty the walk.
- Scope note: the test asserts presence of the call in the file, not per-handler control flow; this matches the review's intent (a tripwire against a new unguarded route) while keeping the test $0 and deterministic.

**Test plan.** The test itself is the deliverable; it must pass 38/38 today and fail on a fixture mutation (verified in review by temporarily stripping a call).

## 5. D3 (SR2-min): audit every failed login, including unknown-id attempts

**Files touched:** `db/lib/accounts.ts` (`authenticate()` only); tests.

**Design.** In `authenticate()`, add `appendAudit(db, { actor: opts.userId, action: "login_failed", target: opts.userId, now: opts.now })` on every failure return before the return statement:
- unknown user (`:175`),
- disabled (`:176`),
- pending approval (`:177`),
- active lockout window (`:178-180`),
- wrong password (both arms: pre-lock `:191-192` and the lockout arm `:185-189` — `login_failed` is recorded **in addition to** the existing `account_locked`, never instead of).
- `actor` and `target` both carry the attempted id (trimmed, matching the login route's trim at `app/web-next/app/api/auth/login/route.ts:42`) — deliberate: for unknown ids the attempted id IS the forensic datum. `audit_log.actor_user_id` is a free TEXT column (no FK, §2.3), so unknown ids are legal rows. No schema change; no migration.
- Response bodies are unchanged — the identical `invalid_credentials` for unknown vs wrong password is preserved (existence is not leaked; doc comment at `accounts.ts:157-163` stays true).

**Test plan.**
- New/extended unit tests over `authenticate()` against a temp DB: each failure path inserts exactly one `login_failed` row with the attempted id; the lockout arm inserts both `login_failed` and `account_locked`; success inserts only `login`; unknown-id attempts do not create `app_user` rows.
- Extend the login-route-level test (`tests/unit/admin-users-master-crud.test.ts` bootstraps the route harness): three wrong-password attempts then a nonexistent-id attempt → four `login_failed` audit rows visible via `/api/admin/audit-log` filtered by action.

## 6. D4 (SR3-min): login throttle keys on the rightmost XFF hop

**Files touched:** new `app/web-next/lib/login-throttle.ts`; `app/web-next/app/api/auth/login/route.ts`; tests.

**Design.**
- `app/web-next/lib/login-throttle.ts` exports:
  - `trustedLoginAddress(request: Request): string` — takes the **last non-empty** comma-separated entry of `x-forwarded-for` (the hop appended by the trusted edge proxy; client-injected entries sit left of it and cannot shift the key), trimmed, bounded to 64 chars like `register-rate-limit.ts:17`; absent/empty header → `"direct"` (shared bucket, same dev-direct semantics).
  - `loginThrottled(address)` / `recordLoginFailure(address)` over a bounded `Map` with the same sweep/evict discipline as `allowRegisterAttempt` (`register-rate-limit.ts:30-50`) — constants `LOGIN_WINDOW_MS = 15*60_000`, `LOGIN_MAX_FAILURES = 10`, `LOGIN_MAX_TRACKED_ADDRESSES = 5_000` moved with the functions.
- `app/web-next/app/api/auth/login/route.ts:15-29` is replaced by imports of the lib; the throttle call sites (:44-47, :50) keep identical semantics and status codes.
- Accepted-for-now (documented in code header + DEC): the map is in-memory and resets on restart — a restart clears an offender's window; durable store is the §13 follow-up ADR item together with SR2's IP/user-agent columns.

**Test plan.** New `tests/unit/login-throttle.test.ts` pinning the keying (the unit the review asked for):
- `"203.0.113.7, 10.0.0.9"` → keys `10.0.0.9`; trailing whitespace/empty segments tolerated; single-entry header keys itself; absent header → `"direct"`.
- Spoof attempt: `"fake.example, 203.0.113.7"` keys on `203.0.113.7`, not `fake.example`.
- Window math: 10 failures inside 15 min → throttled; failure outside the window does not count; bounded-map eviction never throws at cap.
- Route-level regression: 10 failed logins from one address → 429 `too_many_attempts`; a spoofed leftmost entry does not reset the bucket.

## 7. D5 (B-2): serverize the CarrierGate AUTO-REDIRECT paths only

**Files touched:** `app/web-next/app/{market,opportunities,synergy,greenfield,brownfield}/page.tsx`; `app/web-next/components/CarrierGate.tsx` (split); new `app/web-next/lib/carrier-resolve.ts`; new `app/web-next/lib/rsc-session.ts`; tests.

**Design.**
- **Server page shell.** Each of the five flat pages becomes a server component receiving `searchParams` (Next App Router async prop). Order of resolution, mirroring the client rules exactly:
  1. **Rule 1 (query carrier):** `?opportunity=` or `?deal=` present → `redirect()` to `/deals/{id}/{stage}` preserving every other query param (client `redirectTarget` deletes only `opportunity`/`deal`, `CarrierGate.tsx:143-153`); no `moved` flag (R2-A item 8 sets `moved` only on auto-resolution).
  2. **Rule 3 (auto-resolution):** otherwise, when the session is valid and the query is not exempt (`new=1` for market/opportunities, `known_target=1` for opportunities — `:135-138`), run the server-side carrier query; exactly one carrier → `redirect()` with `moved=<route>` appended.
  3. **Picker/fallback:** zero or multiple carriers, any exemption hit, or **no valid session** → render the client picker component. Session-less visits render the picker rather than a server error — behavior parity with today, where the client APIs 401 into the error state.
- **`app/web-next/lib/carrier-resolve.ts`** (server-only): `resolveCarriers(route: FlatRouteKey, db)` reusing the exact production SQL — any-track: the `opportunities` GET query (`api/opportunities/route.ts:33-47` with `status='selected'`, `includePromoted=1`, `deleted_at IS NULL OR (includePromoted AND project_id NOT NULL)`); greenfield/brownfield: the track routes' `route_decision`-filtered queries. Returns id+name+score rows only. One DB read per page view, replacing one client API round-trip plus a fetch-waterfall.
- **`app/web-next/lib/rsc-session.ts`** (server-only): reads the session cookie via `next/headers` `cookies()` and calls `validateSession` (`db/lib/accounts.ts:228`) — the RSC counterpart of `authenticate()`; returns `ValidSession | null`. Read-only; no DB writes.
- **Client component split.** `CarrierGate.tsx` keeps the picker, the zero-carrier embedded renders (market → `MarketAnalysisStage embedded`, opportunities → `OpportunityFunnelStage`, `:187-213`), the keep-mounted redirect-resolve loading frame (`:215-224`), and Rule 4 focus. Rules 1 and 3 are **removed** from the client (the server owns them); the component is renamed internally `CarrierGatePicker` with `CarrierGate` kept as the exported name so the five pages' import surface stays stable. `STAGE_IDS_BY_ROUTE`/`FLAT_ROUTE_STAGE`/`TRACK_BY_ROUTE` move to `carrier-resolve.ts` as the shared single source (client imports the constants — no `"server-only"` marker on the constants module).
- **Redirect-loop safety:** server redirect fires before any render; the target `/deals/{id}/{stage}` is a different route, so no self-loop. Destination AppShell `moved` notice behavior unchanged.
- The `/deals` board CTAs (`page.tsx:242-243`, `/market?new=1`, `/opportunities?known_target=1`) hit the exemption branches and keep working identically.

**Test plan.**
- Unit: `resolveCarriers` against a temp DB — zero/one/many carriers, promoted-but-archived inclusion (`includePromoted`), deleted-opportunity exclusion, track filtering, exemption params short-circuiting.
- Unit: `rsc-session` valid/expired/absent cookie paths.
- Static: the five page files contain `redirect(` from `next/navigation` and do not contain `"use client"`.
- Route-level (harness as in admin-users tests): GET `/market?deal=<id>` → 303/307 to `/deals/<id>/s1` with params preserved; GET `/market` with 2 carriers → 200 picker; with 1 carrier → redirect + `moved=market`.

## 8. D6 (B-3): kill-evaluation three-state chip on the gate-aging widget

**Files touched:** `app/web-next/app/api/portfolio/pipeline/route.ts`; `app/web-next/lib/gate-aging.ts` (or a sibling helper); `app/web-next/app/deals/page.tsx`; `locales/ko.json`, `locales/en.json`; tests.

**Design.**
- **Data:** the pipeline response's `currentHolds` rows gain one field, `killEval: "triggered" | "false" | "unassessed" | null`. Computed by one aggregate query per visible project (not per-row): for the entity's project id, over `kill_criteria_evaluation` (project-scoped, 0023:31): any row `outcome='triggered'` → `"triggered"`; else any `outcome='unassessed'` → `"unassessed"`; else rows exist and all `outcome='false'` → `"false"`; **no rows → `null` (chip suppressed — absence of the ledger is "no evaluation exists", not "passed")**. Opportunity-type rows are always `null` (the ledger is project-keyed).
- **MNPI guard:** for `project_classification.mnpi_flag = 1` projects where the requesting actor is not on the insider list (predicate extracted alongside `requireInsiderIfMnpi`, `db/lib/access-control.ts:107-122`), the chip is suppressed (`null`) — a board aggregate must not leak triggered-criteria existence that the per-run read path (`getRecordedEvaluation` member+insider guards) would deny. No `data_access` logging for the aggregate: it is a count summary over already-visible projects, not a `kill_criteria_evaluation` record read; this deviation from `getRecordedEvaluation`'s logging is explicit in code comments and the DEC.
- **UI:** the aging table (`deals/page.tsx:351-372`) gains a "KILL evaluation" column (between Decision and Decided-at; `AGING_COL_PCT` rebalanced). Chip vocabulary — text-carried, existing chip classes (labels below are the canonical English strings; the ko.json pair is set at implementation via the i18n catalog, never raw Korean in JSX):
  - `triggered` → `status-chip status-red`, label `pages.deals.killEval.triggered` = "Kill triggered";
  - `false` → `status-chip status-not-started`, label `pages.deals.killEval.evaluatedFalse` = "Evaluated — none triggered";
  - `unassessed` → `status-chip status-amber`, label `pages.deals.killEval.unassessed` = "Unassessed".
- **Honesty rule (DEC-mandated): `unassessed` never renders as pass.** Amber + explicit text, never green, never silence-with-green-implication; `null` renders as "—" (dash), which is a non-claim, not a pass. The same rule is stated in the column header tooltip note (`agingNote` locale key extended).

**Test plan.**
- Unit (temp DB): aggregate state machine — triggered-dominates, unassessed-dominates-over-false, all-false → `"false"`, empty ledger → `null`; MNPI non-insider → suppressed, insider → shown.
- Route-level: pipeline response carries `killEval` on project rows, `null` on opportunity rows.
- View test (existing `tests/unit/*view*` pattern): the three chips render with the right class + label; `null` renders "—"; `unassessed` chip never carries a green class (assertion pins the honesty rule).

## 9. D7 (B-5): StageFrame/StageHandoffStrip mount coverage, test-enforced

**Files touched:** new `tests/unit/stage-frame-coverage-static.test.ts` (no product code).

**Design.** Acceptance: **zero stage surfaces without the StageHandoffStrip** — enforced statically, since the strip is unconditional inside StageFrame (§2.7) and `StageHandoff` is its standalone form:
- Canonical surface fixture in the test (the inventory of §2.7, one entry per file):
  - deal tabs: `app/deals/[id]/[stage]/page.tsx`, `app/deals/[id]/page.tsx`;
  - project stage wrappers: `business-case`, `dd`, `deal-structure`, `ic-review`, `portfolio` (each must import its shared `*Stage` component);
  - S10 sub-tabs: `debt`, `incentives`, `sites`, `permits` (must import `S10Frame`);
  - direct stage pages: `charter`, `financial-analysis`, `proxy-chain`, `reports`, `wacc`, `route-decision/page.tsx`, `brownfield/targets/[targetId]/page.tsx`;
  - non-framed stage screen: `opportunities/[id]/page.tsx` (must use `StageHandoff`).
- For each fixture entry the test reads the file and, when the page only re-exports a shared stage component, follows one import hop into `components/stages/*` to find the StageFrame reference. Assertion: the resolved source chain contains `StageFrame` or `StageHandoff`. Failure names the surface file and the rule ("every stage surface mounts StageFrame or StageHandoff — StageHandoffStrip rides inside both").
- New stages: the fixture is hand-maintained (like `project-write-gating-static.test.ts`'s FILES list); a stage surface added without updating the fixture is caught by a companion assertion that `STAGE_META` stages S1–S12 each map to at least one fixture entry (via the existing stage→surface table in the fixture), so the fixture cannot silently rot.

**Test plan.** The test is the deliverable; review verifies it fails when a StageFrame import is stripped from a fixture file and when a new stage route is added without fixture entry.

## 10. D8 (B-6): verification trio — outcomes

Per §2.8:
- **(a)** `committee_session_missing` legibility on the GO screen: **verified legible (catalog text on the snapshot block + explicit 409 server message with repair steps). No change in this batch.** Optional cosmetic alignment (use catalog text in `GateDecisionPanel.tsx:720-723` for all `KNOWN_HARD_BLOCKS`) → §13 follow-up, fix-if-trivial in a later batch.
- **(b)** 409 `snapshot_stale`: **verified legible and handled gracefully (fresh-snapshot swap + staleChanged notice). No change.**
- **(c)** `tranche_condition` read-only view: **absent** — column written by the transition-decision route, never displayed. Per mandate, **not built here**; recorded as the §13 follow-up with the suggested minimal shape (a read-only panel on the S10/venture-transition surface showing `tranche_condition` text with the decision record).

## 11. Accessibility

- **D6 chip (the only user-facing UI change):** text-carried state — color is never the sole carrier (red/amber/gray chips all carry distinct Korean/English labels, consistent with the existing `status-chip` decisions column at `deals/page.tsx:366` which pairs `status-red`/`status-amber` with `KILL`/`HOLD` text). New column gets `scope="col"` header; the existing table `caption`/`aria-label` are extended to mention the kill-evaluation column. Contrast: chip classes reuse Onyx tokens already meeting WCAG AA on their backgrounds (same tokens as the decision chip). `null` renders as a text dash, not an empty cell.
- **D5:** server redirects preserve the destination `moved` notice (status-region announcement, R2-A item 8) — no a11y regression; picker focus management (Rule 4) unchanged.
- **D1–D4, D7:** no user-facing UI change.

## 12. Alternatives considered

- **D1:** keep two generators but swap POST's `Math.random` for `crypto.getRandomValues` inline — rejected: two copies of a credential generator is the defect shape itself; one helper is also the cheapest thing to unit-test.
- **D3:** separate `login_failed_unknown` action for unknown ids — rejected: two actions double the audit-log UI and query surface for no forensic gain; the attempted id in `target` already distinguishes the cases.
- **D3:** also audit `disabled`/`pending` rejections with distinct reasons — kept minimal (single `login_failed` action, all paths) per the minimal mandate; reason detail can ride in a later schema upgrade (§13).
- **D4:** use `cf-connecting-ip` like `register-rate-limit.ts` — considered and documented as the alternative; the ruling (DEC) keeps rightmost-XFF for login because the login route may also serve behind non-Cloudflare proxies where only XFF is available, and the rightmost entry is proxy-authored in both setups. The two routes' divergence is noted in code comments on both sides.
- **D5:** keep everything client-side and only add a service worker/prefetch — rejected: the review item is precisely that auto-redirects flash a client fetch before resolving; server resolution removes the flash at the source. Middleware-based redirect — rejected: Edge runtime cannot use bun:sqlite.
- **D5:** server-render the picker rows too — rejected: picker rows need keyboard-focus management and the embedded-stage fallbacks are interactive client components; keeping the picker client-side bounds the RSC surface to read-only resolution.
- **D6:** render chip only when a kill run exists (never show `unassessed`) — rejected: that is exactly the dishonesty the review flags; unassessed must be visible.
- **D6:** reuse `getRecordedEvaluation` per entity — rejected: it logs a `data_access` row per call and enforces per-run member guards; a portfolio board would multiply audit noise and change read semantics. The aggregate + MNPI suppression is the minimal honest form.
- **D7:** render-test per stage route with a headless harness — rejected: 15+ surfaces × harness cost for a property ("does the wrapper import StageFrame") that a static read already proves; the static walk matches house precedent.

## 13. Follow-ups and deferred (recorded, not built here)

1. **Follow-up ADR item (SR2/SR3 schema-level upgrade):** add `ip` and `user_agent` columns to `audit_log` (or a sibling `login_attempt` table) and replace the in-memory throttle maps with a durable store (DB table with windowed cleanup, or the register route's shared-bucket pattern). Owner decision on the ADR is the §1 accepted-risks/AR pending set. Both the login throttle (D4) and the register throttle already share the bounded-map shape, so the durable swap should land for both at once.
2. **B-6(c):** read-only `tranche_condition` view on the venture-transition surface (D8 outcome c).
3. **B-6(a) cosmetic:** use catalog hard-block text for all `KNOWN_HARD_BLOCKS` in `GateDecisionPanel.tsx:720-723`.
4. **B-1** S6/S7 split — next S7 round per plan. **B-4** checklist — embedded in the plan doc, quarterly cadence. **Track A** owner decisions, **AR1–AR4** accepted risks, **MFA** — all pending owner; not designed here.
5. **Source-doc recovery:** `docs/improvement-plans/2026-11-11-website-review-improvement-plan.md` and `docs/security/2026-11-11-admin-account-review.md` are referenced by `memory/2026-11-11.md` but missing from the repo; recover or regenerate them before the next plan-driven batch (documentation-integrity gap, DEC §Context).
6. **DEC-20261111-01** is referenced in `memory/2026-11-11.md` but its file is absent from `docs/decisions/` — same uncommitted-session loss; recover or re-issue. This record takes the `-02` slot per the dispatch ruling.

## 14. Out-of-batch confirmation

B-1 (deferred), B-4 (recorded), Track A (owner), AR1–AR4 (owner), schema-level audit/throttle upgrades (follow-up ADR), MFA (owner) — none are designed or implemented by this batch. Rows 1+ implement D1–D6 and D7's test only.
