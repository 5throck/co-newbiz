---
title: Owner-decision intake batch — client-request intake record, admin token-issuance gate, bootstrap password file, MFA deferral (E1–E4)
date: 2026-11-11
status: Draft (Row 0 — Design Gate ADR-0074; implementation lands in Rows 1+ by separate dispatch)
owner: platform-lead (design); functional review by data-architect (E1 schema), security-engineer (E2, E3), frontend-engineer (E1 UI), docs-writer (language policy)
reviewers_required: data-architect + security-engineer (AI-2nd, different domain than author), owner (human approval)
decision_record: docs/decisions/DEC-20261111-03.md
related: ADR-0001 (SQLite), ADR-0042 (opportunity/gate primitives, migration 0042), ADR-0074 (Design Gate, flow.spec stage SSOT), ADR-0086 (standard screen patterns), ADR-0120 (deal funnel), ADR-0127 (opportunity detail screen), ADR-0146 (personal API tokens), ADR-0152 (typed closure), docs/security/security-model.md FR-SEC-07/09, design 2026-10-11-self-service-api-tokens-design, design 2026-11-11-admin-security-and-board-fixes-design
---

# Owner-decision intake batch (E1–E4)

## 1. Scope and inputs

Four items dispatched by PM under the Design Gate, Row 0 only (design doc + ADR + decision record + spec registration — no code changes in this batch):

| ID | Item | Track |
|---|---|---|
| E1 | Client-request intake record — new `deal_intake` table, board intake modal, deal-overview origin line, audit `intake_created` | intake |
| E2 | Admin API-token issuance forbidden — gate both issuance seams; existing tokens stay valid until expiry | security |
| E3 | Bootstrap admin password written to a 0600 file instead of the container log; runbook updated | security |
| E4 | Admin MFA deferred — accepted-risk record only, no code | governance |

**Decision basis (no owner answer).** The Track A owner decisions were put to the owner; no answer arrived by dispatch time, so PM best-judgment defaults apply for all four rulings (recorded in DEC-20261111-03 with a revisit-on-owner-input note). Each item below is designed so that an owner reversal is cheap: E1 is additive schema + UI, E2 is refusal guards + one locale note, E3 is a boot-path change confined to `instrumentation.ts` + one lib + the runbook, E4 is a record.

**Out of this batch:** any S0 stage in `process/flow.spec.yaml`, gate changes, MFA implementation, an intake listing/report screen, retro-linking of historical opportunities to intakes, and the schema-level audit upgrades already committed in DEC-20261111-02 (§ follow-ups).

## 2. Findings: what exists today (verified)

### 2.1 The two board CTAs and where they land

- Deal board `app/web-next/app/deals/page.tsx:313` — `PrimaryAction inline href="/market?new=1"` (label `pages.deals.newDealCta`, locales ko/en :9051 `"＋ 새 검토 시작 (시장분석부터)"` / `"＋ Start a new deal (from market analysis)"`); `:314` — `Link href="/opportunities?known_target=1"` class `btn-ghost` (label `pages.deals.knownTargetCta`, ko/en :9052 `"알려진 대상으로 시작"` / `"Start from a known target"`). These are the only two entry CTAs on the board.
- `PrimaryAction` (`app/web-next/components/ui.tsx:87`) renders a `Link` when `href` is given and a `button` when `onClick` is given — both forms are supported, so a modal can intercept without a new component class. Viewers are blocked in-place (R2-C 9, viewer reason text).
- Query-carrier exemptions in `app/web-next/components/CarrierGate.tsx`: `startsKnownTarget` :108 (`route === "opportunities" && searchParams.get("known_target") === "1"`), `startsNew` :111 (`searchParams.get("new") === "1"` on market or opportunities). With no carrier in the URL, both exemptions bypass the Rule-1/Rules-3 redirects and render the working forms directly:
  - `/market?new=1` → `MarketAnalysisStage embedded startNew` (`:158-163` of the component tree; stage re-export shim `components/stages/MarketAnalysisStage.tsx:5` → implementation `components/stages/market/MarketAnalysisStage.tsx:39`). `startNew` opens the new-industry form (`:56-62`); its submit calls `openLinkModal(...)` (`components/stages/market/IndustryListSection.tsx:65`) which ultimately POSTs `/api/market-overview/analyses` (`components/stages/market/useMarketLinking.ts:121,135`). **S1's new-analysis flow creates an `md_industry` + market analysis row, not an opportunity** — the deal carrier is created later, in S2.
  - `/opportunities?known_target=1` → `OpportunityFunnelStage startRegister="known_target"` (`CarrierGate.tsx:163`) — the S2 funnel registration form opens with the known-target field active; submit POSTs `/api/opportunities` (`components/stages/OpportunityFunnelStage.tsx:256`), creating the opportunity immediately, then redirects to `/opportunities/[id]` (`:265-268`).

### 2.2 Opportunity creation seams and the audit writer

- `POST /api/opportunities` — `app/web-next/app/api/opportunities/route.ts:51`; analyst+ write gate via `requireBusinessActor(ctx, "write")` (:57-61); INSERT into `opportunity` at :110-127; audited `appendAudit(db, { actor, action: "opportunity_create", target: "<id>:<name>" })` at :130. Body accepts `known_target` (Wave C-3 D-5, :70-71) which also creates the S6 target row.
- Opportunity table DDL: `db/migrations/0042_opportunity_and_gate_decision.sql:8-24` — `opportunity(id, project_id nullable, name, ..., created_by, created_at)`; `project_id` nullable on purpose (comment :5-7: opportunities exist before and sometimes without a project). House CHECK-enum style at :17-19 (`status IN ('identified','assessed','selected','dropped')`).
- Audit writer: `db/lib/access-control.ts:37-46` — `appendAudit` inserts into append-only `audit_log (id, actor_user_id, action, target, created_at)`; the header comment (:34-36) records that migration 0008's triggers abort update/delete at the DB level. `target` is FK-free TEXT — used throughout for compound strings (`"<id>:<name>"`, denial reasons like `"role:admin"` in `app/api/tokens/route.ts`).
- Migration runner: `db/migrate.ts:177-179` — `readdirSync(MIGRATIONS_DIR).filter(.sql).sort()`; **latest migration is `db/migrations/0189_site_announcement_and_effective_on.sql`**, so the intake migration takes **0190**.
- Deal overview: `app/web-next/app/opportunities/[id]/page.tsx` (ADR-0127, "use client") — renders `PageHeader` + `DealBreadcrumb` + `StageHandoff`/`StageRail` (imports :13-19); it also mounts `KnownTargetGuide` (import :20; component `components/KnownTargetGuide.tsx:16`, rendered only when a `[알려진 대상]`-prefixed S6 target exists). Detail data comes from `GET /api/opportunities/[id]` (`app/api/opportunities/[id]/route.ts:20`, `SELECT * FROM opportunity` + composed extras). This page is the "deal overview" the origin line attaches to.

### 2.3 Token issuance seams (E2)

- UI mirror `app/web-next/lib/token-issue-access.ts` (header :1-5: "server stays authoritative … a unit test pins the parity"):
  - `canIssueToken(role)` :9-11 — true for all three roles (`analyst | viewer | admin`).
  - `canIssueWriteToken(role)` :13-15 — **`return role === "analyst"`** (the analyst-only write rule).
  - `writeScopeNoteKey(role)` :18-22 — admin/viewer get per-role write-scope explanation copy.
- Self-service issuance `POST /api/tokens` (`app/web-next/app/api/tokens/route.ts`): session-only gate `sessionGate` :48-79 (any `Bearer` header refused before authenticate; cookie-only). Write-scope refusals: viewer :93-96 (`role_required`), admin :97-100 (`role_forbidden`, both audited `api_token_issue_denied` with reason targets via `denyIssue` :44-46). **An admin self-issuing a read-scoped token is allowed today** — there is no read-scope refusal. TTL whitelist, 5-active cap, 10/hour rate limit, all refusals audited.
- Admin-on-behalf issuance `POST /api/admin/users/[userId]/tokens` (`app/web-next/app/api/admin/users/[userId]/tokens/route.ts`): `requireAdmin` :14-21; POST :35-58 calls `issueApiToken` with **raw `body.scopes` — no scope validation on this path at all** (an admin can mint a write-scoped token for any user here), audited `api_token_admin_issue` :50; plaintext returned once :51-53. `GET` (list) :23-28 and `DELETE` (revoke) :60-70 complete the route. **No test pins this route** (grep over `tests/unit/` for the path and `api_token_admin_issue` returns nothing).
- Validation (must stay unchanged): `db/lib/api-tokens.ts:103` `ROLE_WRITE_FORBIDDEN = new Set(["viewer", "admin"])`; `validateApiToken` :127; role re-check at :159-161 **strips `write` at validation** for viewer/admin holders. Read scope is untouched by the re-check, so an existing admin (or any) read token keeps working until expiry/revocation — this is the exact "read-scope-at-validation behavior unchanged" the ruling references.
- Tests pinning issuance: `tests/unit/token-issue-access.test.ts:10` (loop asserts `canIssueToken` true for analyst **and admin** — must flip), :12-13 (`canIssueWriteToken` analyst-only — unchanged), :17 (`writeScopeNoteKey("admin")` → `writeNoteAdmin` — becomes dead copy if the admin form is removed); `tests/unit/api-tokens.test.ts:196-206` ("viewer cannot request write at issue; admin cannot either (audited)" — pins the audited `role:admin`/`role:viewer` denial targets at the self-service route), :99-135 (session-only mint/revoke), :182-195 (role re-check at validation).
- UI consumer: `app/web-next/app/settings/connected-apps/page.tsx:230-231` — `canIssue = canIssueToken(me?.role)`, `canWrite = canIssueWriteToken(me?.role)` gate the issue form.

### 2.4 Bootstrap password block (E3)

- `app/web-next/instrumentation.ts` — `randomPassword(bytes = 16)` :6-9 (CSPRNG over `crypto.getRandomValues`, 16 chars from a 70-symbol alphabet — distinct from the `tmp-…!A` helper in `lib/temp-password.ts` used by admin user create/reset; the divergence is cosmetic, both CSPRNG, and out of scope here).
- Bootstrap block :150-182: `if (listUsers(db).length > 0) return` (:150-153) → `randomPassword()` :160 → `createUser` :161-168 (role admin) → `approveUser` :169 → **console.log banner :171-180 printing the password in plaintext** (`  password: ${password}` :176) → outer catch :181-182.
- `must_change_password` is **hardcoded to 1** in `createUser`'s INSERT (`db/lib/accounts.ts:100-107`, the literal `1` in the VALUES list; doc comment :84-88 "the first login forces the change flow") — E3 keeps this untouched.
- Runbook instructions that today tell the operator to scrape the log: `docs/runbooks/deployment.md:65` ("a fresh volume also bootstraps the first admin account (random password printed once to the container log — capture it: `docker logs co-newbiz-web | grep -i password`)") and `:96` ("on first boot capture the admin password with `docker logs co-newbiz-web | grep -i password`").
- DB file location default: `app/web-next/db/data/` (gitignored — `.gitignore:99` `app/web-next/db/data/**`; `db/client.ts:53` comment; `CO_NEWBIZ_DB_PATH` overrides for tests). A file written next to the DB ships inside the same docker volume (`co-newbiz-data`).

### 2.5 Modal accessibility patterns (E1)

- `components/ClosureModal.tsx` is the house modal: backdrop `role="presentation"` + `onKeyDown` :144; panel `role="dialog"` `aria-modal="true"` `aria-labelledby={titleId}` :149-151; error line `role="alert"` :164; form with `aria-label` :170. Focus trap and Escape come from `useModalFocus(onClose)` (`app/web-next/lib/use-modal-focus.ts:30`).

## 3. E1 — Client-request intake record

### 3.1 Shape decision

A new table, not new columns on `opportunity`: an intake is created **before** an opportunity exists (the market-CTA path creates only an industry+analysis in S1; the opportunity arrives in S2), and `opportunity` is the S2 funnel table — stuffing pre-funnel origin fields into it would force funnel reads to tolerate half-initialized rows. A separate additive table keeps `opportunity` untouched and mirrors the existing nullable-predecessor pattern (`opportunity.project_id`, migration 0042 :5-7).

No existing table serves: `opportunity.rationale` (:22) is the analyst's assessment note, not the client request; `gate_decision.rationale` (0042 :47) is gate output; `audit_log` is display-hostile (append-only, compound TEXT targets). Confirmed — `deal_intake` is new.

### 3.2 Schema — migration `db/migrations/0190_deal_intake.sql`

```sql
-- 0190_deal_intake.sql
-- Client-request intake record (design 2026-11-11-owner-decisions-intake-batch §3):
-- a first-class record of WHO asked for this deal and through which board entry,
-- created at board-CTA time and linked to the opportunity once S2 creates it.
-- opportunity_id is NULLABLE on purpose — the intake precedes the deal, and an
-- abandoned intake stays as the honest record that a request was made and no
-- deal resulted.
CREATE TABLE deal_intake (
  id TEXT PRIMARY KEY NOT NULL,
  opportunity_id TEXT REFERENCES opportunity(id),
  source TEXT NOT NULL CHECK (source IN ('board_new_deal', 'board_known_target')),
  requested_by TEXT,
  note TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_deal_intake_opportunity ON deal_intake(opportunity_id);
CREATE INDEX idx_deal_intake_created ON deal_intake(created_at);
```

Column notes (deviation from the dispatch's five-column sketch is +`created_by` only):

- `source` — closed vocabulary with the two board CTAs; CHECK-enum follows migration 0042 house style. Future channels (email, CLI) extend the CHECK via a new migration.
- `requested_by` — free-text name of the external requester (client/sponsor), **not** an `app_user` FK: the requester is typically not an account holder. Nullable: recording the channel (source) is the mandatory datum; the name is best-effort.
- `note` — nullable free text.
- `created_by` — the session user who submitted the modal (NOT NULL, like `opportunity.created_by`, 0042 :21). The dispatch sketch omitted it; added because the origin line displays "recorded by" from the row rather than formatting `audit_log.target` strings (audit is append-only evidence, not a display join).
- No `updated_at`, no status column — an intake is written once (create + one optional link); there is no intake editing in this batch.

### 3.3 Repository — `db/repositories/deal-intake.repository.ts`

House pattern (repositories own the SQL; routes orchestrate):

- `createDealIntake(db, { source, requestedBy, note, createdBy, now })` → row id (ulid, same `db/lib/ulid.ts` the routes use).
- `linkDealIntakeToOpportunity(db, { intakeId, opportunityId })` → boolean; single `UPDATE deal_intake SET opportunity_id = ? WHERE id = ? AND opportunity_id IS NULL` — the `IS NULL` predicate makes linking idempotent and refuses re-linking.
- `getIntakeByOpportunity(db, opportunityId)` → row | null (origin-line read).
- `getIntakeById(db, intakeId)` → row | null (backfill validation).

### 3.4 API

1. **`POST /api/deal-intake`** (new route `app/web-next/app/api/deal-intake/route.ts`):
   - `authenticate` + `requireBusinessActor(ctx, "write", { viewerMessage: ... })` — same gate as opportunity registration (analyst+, route.ts:57-61); viewers see the board but `PrimaryAction` already blocks them in-place (ui.tsx:87-96), so the server gate is defense-in-depth, not the primary UX.
   - Body: `{ source: "board_new_deal" | "board_known_target", requested_by?: string, note?: string }`. Unknown source → 400 (the CHECK is the backstop, but validate before INSERT for a typed envelope error).
   - INSERT via repository; `appendAudit(db, { actor: ctx.userId, action: "intake_created", target: "<intake_id>:<source>", now })`.
   - Returns `201 { id }`. No bearer-token restriction here (unlike `/api/tokens`): an intake is ordinary business write data.
2. **Backfill at opportunity creation** — `POST /api/opportunities` (route.ts:51) gains an optional `intake_id` body field:
   - If present: intake must exist, have `opportunity_id IS NULL`, and not be older than **30 days** (stale-intake guard — an intake whose deal never materialized within a month should not be silently annexed by an unrelated later creation; the limit is a revisit-on-owner-input default).
   - On success: `linkDealIntakeToOpportunity` + `appendAudit(action: "intake_linked", target: "<intake_id> -> <opportunity_id>")`.
   - On failure: 409 `intake_not_linkable` — the opportunity creation itself is **not** blocked (the intake carrier is a stale leftover; proceeding is correct, the refusal is audited with reason in target).
   - Known-target path: `OpportunityFunnelStage` submit (:256) adds `intake_id` from the query carrier. The server-side `known_target` branch needs no change — intake linking is orthogonal to target pre-fill.
3. **Origin read** — `GET /api/opportunities/[id]` (route.ts:20) response gains `intake: { id, source, requested_by, note, created_by, created_at } | null` via one LEFT JOIN on `deal_intake.opportunity_id`. No new route, no extra round-trip from the detail page.

### 3.5 Board intake modal — `components/DealIntakeModal.tsx`

- `app/deals/page.tsx:313-314` changes: `PrimaryAction` switches from `href` to `onClick={openNewDeal}` (ui.tsx:87 supports both); the known-target `Link` becomes a same-styled `button` (`btn-ghost`). Both open `DealIntakeModal` with the destination preset.
- Modal content: title, one **Requester** text input (optional), one **Note** textarea (optional), Cancel + Start buttons. `source` is NOT asked — it derives from which CTA opened the modal (asking the user to re-state what they clicked is friction with zero information gain).
- Submit → `api.post("/api/deal-intake", ...)` → navigate to the original destination **plus the intake carrier**: `/market?new=1&intake=<id>` or `/opportunities?known_target=1&intake=<id>` (plain `window.location.assign`, same as OpportunityFunnelStage.tsx:266 — these exemption paths have no redirect race).
- Cancel closes with nothing written. There is deliberately no "skip recording" — creating the record *is* the ruling (DEC-20261111-03 ruling 1).
- Query-carrier ride-through: `CarrierGate` exemptions (`:108, :111`) are untouched; the stages read `intake` themselves — `OpportunityFunnelStage` attaches it to the register POST; `MarketAnalysisStage` (market) appends it to `nextHref` (`market/MarketAnalysisStage.tsx:78`, `/opportunities`) so the carrier survives the S1→S2 hop. If the S1 user instead links the analysis to an *existing* deal (`LinkToDealModal`), no opportunity is created and the intake stays unlinked — the honest outcome (the request did not become a new deal).
- i18n: new keys under `pages.deals.intakeModal.*` (title, requester, note, submit, cancel) and `pages.opportunityDetail.intakeOrigin.*` (origin caption template) — **ko master + en mirror**, both files, same key paths (locales/ko.json:9051-9052 neighborhood for the deals keys). The ui-label-sweep/i18n suites read `locales/ko.json` directly (tests/unit/ui-label-sweep.test.ts:65) so both catalogs must land together.
- Visible labels use the catalog everywhere — no raw Korean/English literals in the component (same rule the sweep enforces for other pages).

### 3.6 Origin line on the deal overview

- `app/opportunities/[id]/page.tsx`: one muted caption line under the `PageHeader`/status area (before `KnownTargetGuide`), `data-testid="deal-intake-origin"`:
  `검토 기원: <source label> — 요청자 <requested_by || "—">, <created_at> <created_by> 기록` (ko; en mirror), source labels from the catalog (`board_new_deal` → `"딜 보드 — 새 검토"`, `board_known_target` → `"딜 보드 — 알려진 대상"`).
- Renders only when `intake` is non-null — historical opportunities show nothing (no fabrication), and unlinked intakes render nowhere in this batch (§9 follow-up 3).

### 3.7 Audit actions

| Action | When | Actor | Target |
|---|---|---|---|
| `intake_created` | POST /api/deal-intake success | session user | `<intake_id>:<source>` |
| `intake_linked` | backfill success | session user (opportunity creator) | `<intake_id> -> <opportunity_id>` |
| `intake_link_refused` | backfill validation failure | session user | reason (`not_found\|already_linked\|stale`) |

All through `appendAudit` (access-control.ts:37) — insert-only, FK-free TEXT target, compatible with the 0008 no-update/no-delete triggers.

### 3.8 E1 tests

1. `tests/unit/deal-intake-api.test.ts` (API, seeded sqlite like `api-tokens.test.ts`): analyst POST creates row + `intake_created` audit; viewer POST 403; unauthenticated 401; unknown `source` 400; detail GET returns `intake` for a linked deal and `null` otherwise.
2. Backfill cases (same file or `api.test.ts` additions): `intake_id` links + `intake_linked` audit; already-linked 409 + `intake_link_refused`; unknown id 409 + refusal audit; opportunity still created in refusal cases.
3. Static UI test `tests/unit/deal-intake-static.test.ts` (pattern: `project-write-gating-static.test.ts` / `kill-eval-view-static.test.ts`): `app/deals/page.tsx` contains no bare `/market?new=1` href (both CTAs route through the modal), `DealIntakeModal` imports `useModalFocus`, and `app/opportunities/[id]/page.tsx` renders `deal-intake-origin`.
4. i18n parity: extend the existing sweep expectations so the new `pages.deals.intakeModal.*` / `pages.opportunityDetail.intakeOrigin.*` keys exist in ko AND en.

### 3.9 Accessibility (modal)

Reuse the ClosureModal pattern verbatim (§2.5): `useModalFocus(onClose)` for the focus trap + Escape-to-cancel + focus return; backdrop `role="presentation"` with `onKeyDown`; panel `role="dialog"` `aria-modal="true"` `aria-labelledby`; `<label for>` on both inputs (the S1 new-industry form already pairs `id="market-new-name"` with a label — IndustryListSection.tsx:70); error line `role="alert"`; Enter submits via the wrapped `<form>` (ClosureModal.tsx:170 pattern). Focus lands on the first input on open (useModalFocus default). No new CSS beyond `modal-backdrop`/existing classes.

## 4. E2 — Admin API-token issuance forbidden

### 4.1 Ruling shape

"Admins can no longer issue new API tokens" — both issuance seams close for admin-issued NEW tokens; listing and revocation stay (an admin keeps visibility and the kill switch, loses minting). Existing tokens (including an admin's existing read token) stay valid until expiry/revocation; `validateApiToken`'s role re-check (api-tokens.ts:103, :159-161) is untouched, so read-scope-at-validation behavior is unchanged, exactly as ruled.

### 4.2 Change spec (the exact seams)

1. **Self-service `POST /api/tokens`** (`app/api/tokens/route.ts`): insert an admin refusal for **all scopes** immediately before the scope checks (:92), e.g.

   ```ts
   if (auth.role === "admin") {
     denyIssue(db, auth.userId, now, "role:admin");
     return forbidden("role_forbidden", "Administrator accounts cannot issue personal API tokens.");
   }
   ```

   The existing admin write-scope branch (:97-100) becomes unreachable and is removed; the viewer write branch stays. Read-scoped viewer self-issue stays allowed (the ruling names admins only).
2. **Admin-on-behalf `POST /api/admin/users/[userId]/tokens`** (`app/api/admin/users/[userId]/tokens/route.ts`): the whole POST handler returns `forbidden("role_forbidden", "Administrators cannot issue API tokens on behalf of users.")` after `requireAdmin` (:36-37), audited once: `appendAudit(db, { actor: guard.ctx.userId, action: "api_token_admin_issue_denied", target: "<targetUser>", now })`. `GET` (list) and `DELETE` (revoke) are unchanged. The raw-scopes hole (:47-49) disappears with the handler — no separate scope validation needed.
3. **UI mirror** `app/web-next/lib/token-issue-access.ts`: `canIssueToken` :9-11 drops `"admin"` → analyst/viewer only; header comment (:1-5) updated to state the new rule; `writeScopeNoteKey` :18-22 loses its admin branch (dead copy after the form gate). `canIssueWriteToken` :13-15 untouched (analyst-only, as today).
4. **Connected-apps page** (`app/settings/connected-apps/page.tsx:230-231`): with `canIssue` false for admins the form hides; render instead a muted catalog note (`pages.connectedApps.noIssueAdmin`, ko+en: `"관리자 계정은 새 API 토큰을 발급할 수 없습니다 — 기존 토큰은 만료까지 유효합니다."` / `"Administrator accounts cannot issue new API tokens — existing tokens stay valid until expiry."`). `canWrite` remains meaningful for analyst.
5. **Locales**: `pages.connectedApps.noIssueAdmin` in ko.json + en.json (both, same path).

### 4.3 Unchanged (recorded so review does not flag them)

- `db/lib/api-tokens.ts` — `validateApiToken`, `ROLE_WRITE_FORBIDDEN`, grace-stamping of legacy NULL-expiry rows, `revokeApiToken`, `listApiTokens`: all untouched. An existing admin read token validates with `read` until it expires or is revoked; a demotion/promotion still strips `write` at validation (:159-161).
- `issueApiToken` itself keeps its signature — the OAuth/MCP paths and tests that call the engine directly are unaffected; the gate lives at the two HTTP seams only.

### 4.4 E2 tests

- `tests/unit/token-issue-access.test.ts:10` — admin moves from the true-loop to the false-list (`canIssueToken("admin")` false); parity comment updated.
- `tests/unit/api-tokens.test.ts`:
  - :196-206 — the admin write denial still holds, now via the all-scopes refusal; extend with the new assertion: **admin read-scope self-issue → 403 `role_forbidden` + `api_token_issue_denied` target `role:admin`**; viewer read-scope self-issue still succeeds.
  - New: **admin-on-behalf POST → 403 + `api_token_admin_issue_denied` audit; admin-on-behalf GET list and DELETE revoke still succeed** (first-ever coverage of that route).
  - Validation trio :182-195 unchanged and still passing (proves the unchanged-validation claim).

## 5. E3 — Bootstrap admin password to a 0600 file

### 5.1 Change spec

- New helper `app/web-next/lib/bootstrap-password-file.ts`: `writeBootstrapPasswordFile(filePath, { userId, password, now })` — `mkdirSync(dirname, { recursive: true })` if needed, then `writeFileSync(filePath, banner, { mode: 0o600 })` **followed by `chmodSync(filePath, 0o600)`** (writeFileSync's `mode` applies only at creation; the chmod guarantees 0600 even when a stale file exists). Banner content: timestamp, user id, password, "change it at first login". Returns the path.
- `instrumentation.ts` :150-182 reorder (fail-closed ordering — the credential is never created if it cannot be stored):
  1. Generate `password` (:160, unchanged `randomPassword`).
  2. Resolve path: `CO_NEWBIZ_BOOTSTRAP_PASSWORD_FILE` env override, else **the directory of the resolved DB file** + `/bootstrap-admin-password.txt` (the DB dir is already gitignored, `.gitignore:99`, and ships inside the docker volume; deriving from the DB keeps dev, prod volume, and `CO_NEWBIZ_DB_PATH` test layouts all correct without a second knob).
  3. `writeBootstrapPasswordFile(...)` — on throw: `console.error("[bootstrap] could not write the initial-admin password file (<path>):", message)` **without the password**, and abort bootstrap (no `createUser`). The fresh DB self-heals on next boot (`listUsers` still 0, :150).
  4. `createUser` + `approveUser` (:161-169, unchanged; `must_change_password` stays hardcoded 1 — accounts.ts:100-107).
  5. Replace the console.log banner :171-180 with a password-free line: `console.log("[bootstrap] initial admin created — password written once to <path> (0600); change it at first login.")`. **The `password:` line is removed, not masked** (§8, alternative rejected).
- Operator deletion of the file after first login is a runbook recommendation, not enforced (enforcement would need a boot-time sweep — out of minimal scope; §9 follow-up 5).

### 5.2 Runbook edits — `docs/runbooks/deployment.md`

- :65 — replace "(random password printed once to the container log — capture it: `docker logs co-newbiz-web | grep -i password`)" with "(a random password is written once to `<data-dir>/bootstrap-admin-password.txt`, permissions 0600 — read it from inside the container: `docker exec co-newbiz-web cat /app/data/bootstrap-admin-password.txt`, then delete the file after the first login; the container log never contains it)".
- :96 — same replacement for the production first-boot paragraph (the volume path the operator already mounts).
- Both edits stay in the runbook's existing voice; the file path is the single source the operator needs (the dispatch: "the log line is REMOVED — the runbook tells the operator the file path").

### 5.3 E3 tests

1. `tests/unit/bootstrap-password-file.test.ts`: writes with `statSync().mode & 0o777 === 0o600`; content contains the password exactly once and no trailing-log artifacts; overwriting a pre-existing wider-permission file re-chmods to 0600; mkdir-recursive for a missing directory.
2. Static tripwire `tests/unit/bootstrap-password-static.test.ts` (pattern: the requireAdmin tripwire from DEC-20261111-02 D2): `instrumentation.ts` must NOT contain the interpolation `` `password: ${password}` `` (or any `console.log` referencing `password`'s value) — the regression this batch exists to kill cannot silently return; and the file must reference `writeBootstrapPasswordFile`.

## 6. E4 — Admin MFA deferred (record only)

No code, no schema, no dependency. Recorded as an accepted risk: admin accounts today are protected by PBKDF2 password hashing + the forced `must_change_password` flow + session auth + (this batch) the token-issuance lockout E2, and MFA for administrators is deferred pending an owner decision on factor choice (TOTP vs passkey) and recovery custody. Revisit triggers: any admin-account incident, or the next security review round that scores admin-auth risk. Details in DEC-20261111-03 ruling 4.

## 7. Alternatives considered

1. **Formal S0 stage for intake** — rejected. `process/flow.spec.yaml` (ADR-0074) is the SSOT for stages/gates; a new stage means spec surgery, stage predicates, S1–S12 coverage-test updates, procedure wiring, and gate semantics for what is a *record*, not a *stage with entry/exit criteria*. An intake has no artifacts, no gate, no dispatch; making it a stage would add process weight to satisfy an audit need a table already satisfies. Recorded as the primary rejected alternative per dispatch.
2. **Log-line masking (print `pass****` instead of removing the line)** — rejected for E3. A masked credential still transits the container log pipeline (docker log drivers, collectors, `docker logs` in shell history); 0600-file removal takes the secret out of the pipeline entirely, which is the actual ruling.
3. **Intake columns on `opportunity`** — rejected (§3.1): intake precedes the opportunity on the market path; nullable-origin fields would pollute the funnel table and every funnel query.
4. **`requested_by` as `app_user` FK** — rejected: the requester is an external person, not an account.
5. **Intake modal on the stage screens instead of the board** — rejected: the ruling anchors intake to the board CTAs (the origin of the request); stage screens are mid-flow surfaces where an intake prompt would interrupt work already in progress.
6. **Gate admin token issuance by removing the admin-on-behalf route only** (keep admin self-issue read) — rejected: the ruling is "admins can no longer issue new API tokens", unqualified; leaving the self-issue seam open would keep exactly the credential-minting power being withdrawn.
7. **Bootstrap file in a fixed repo-relative path** (ignore the DB dir) — rejected: docker volumes mount the data dir, not the repo; a repo path would silently diverge between dev and container. DB-dir default + env override covers all three layouts (§5.1 step 2).

## 8. Follow-ups

1. Intake listing/report surface (who requested what, unlinked intakes review) — deferred until the owner confirms the intake semantics in production (§9.3). Requires its own design.
2. Retention: decide whether unlinked intakes older than N months need pruning or must be kept as request history (data-architect review; interacts with the retention framework `app/api/admin/retention`).
3. Unlinked-intake visibility — today an intake whose deal never materializes is audited but rendered nowhere; if the owner wants an "open client requests" queue, that is follow-up 1's scope.
4. MFA for admin accounts (E4 revisit) — factor choice + recovery custody design when the owner picks it up.
5. Optional boot-time cleanup of a stale `bootstrap-admin-password.txt` on non-first boots (warn if present; delete-after-verified-login needs a login-hook decision).
6. `randomPassword` (instrumentation.ts:6-9) vs `generateTemporaryPassword` (lib/temp-password.ts) remain two CSPRNG shapes; unification was considered out of E3's ruling scope and can ride a later security batch.

## 9. Revisit-on-owner-input

Every ruling in this batch came from PM best-judgment defaults (DEC-20261111-03). Items cheap to reverse, and how:

- E1: intake semantics (mandatory modal, optional requester field, 30-day link window, source vocabulary) — all constants/localized copy; reversing costs a migration-less code tweak unless `requested_by` moves to NOT NULL.
- E2: re-opening admin issuance = deleting the two refusal guards + restoring the UI mirror loop (one-line each); no data migration involved.
- E3: path/env default and abort-on-write-failure semantics are constants in one helper.
- E4: MFA design starts from §6 as written.
