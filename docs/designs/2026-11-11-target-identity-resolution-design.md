---
title: Target identity resolution — canonical company names, DART corp-code authority, and visible sync failure
date: 2026-11-11
status: implemented (Row 0 design — AI-2nd cross-domain review approved 2026-11-11, QA approve-with-conditions resolved 2026-11-12; DEC-20261111-06; Rows 1+ implementation merged)
owner: technical design specialist (design); implementation by backend-engineer + frontend-engineer (PM dispatch)
reviewers_required: process-governance-manager (AI-2nd, functional domain — author is technical domain), brownfield-agent persona review (S6/S7 stage owner), owner (human approval)
decision_record: docs/decisions/DEC-20261111-06.md
related: ADR-0074 (Design Gate), ADR-0118 (evidence citation for LLM stage proposals), ADR-0116 (DART financial facts pipeline), ADR-0140 (financial verdict draft reads fact_financial), ADR-0139 (S7 eval layer), DEC-20261111-06 (this batch's rulings), docs/wiki/ko/50-`브라운필드`-S6-`대상`-`후보`-`발굴`.md (unchanged this batch)
---

# Target identity resolution — canonical company names, DART corp-code authority, and visible sync failure

## 1. Scope and inputs

At S6 brownfield, LLM web-search candidate suggestions arrive without a DART corp code, get
registered under paren-glossed display names (`한전KPS(KEPCO KPS)`), and poison every
downstream identity join: the corp-code resolver cannot match them, the DART financial sync
deadlocks or silently resolves by broken name search, sync failures are invisible, and the
repair path (PATCH) is split-brained across two routes. The live database already carries the
damage (§2.3). This design fixes the identity layer end to end: canonical names at the
creation boundary, server-side code enrichment at suggestion time, code-aware duplicate
handling, one unified target-update path, corp-code authority with visible mismatch warnings,
surfaced sync failures, and an honest chip when no code is known.

**Row 0 scope** (this document, DEC-20261111-06, spec registration): the full design and test
plan. **No code is edited in Row 0.** Data repair on the live DB is explicitly OUT of code and
out of this batch (§9): it becomes owner/UX actions THROUGH the fixed PATCH after merge.

**Constraints held:**

- No new tables, no migration. All changes are code-level within `app/web-next`.
- `md_company.dart_corp_code` carries a UNIQUE partial index
  (`db/migrations/0001_master_data.sql:27`) — identity repair must LINK, never blindly
  overwrite; the design's resolution order (by-code first) already respects it (§3.1).
- The LLM may propose NAMES, never codes (hallucination risk). Codes enter only from the
  deterministic DART corp-code cache or from a human typing them (§4, §6).
- Proposal-only discipline (ADR-0118) unchanged: suggestions remain proposals; a person
  accepts them onto the Long List.

## 2. Findings: what exists today (verified, file:line)

### 2.1 The eight verified defect claims

All eight claims from the diagnosis were re-verified against `main @ fb729a51`:

1. **LLM suggestions carry no corp code.** The prompt asks only
   `company_name / rationale / source_indices`
   (`app/web-next/app/api/brownfield/[oppId]/target-proposals/web-search/route.ts:366`); the
   `Suggestion` interface has no code field (:38-43); the normalize whitelist emits only
   `company_name / rationale / sources / reliability` (:376-404). Only the deterministic
   `synthesisFallback` emits `dart_corp_code` (:72-78) — its rows come straight from
   `md_company`, which is why only fallback suggestions ever sync.
2. **Registration stores the paren gloss verbatim with a NULL code.**
   `resolveOrCreateCompany` inserts `companyName` unchanged as `name_ko`
   (`app/web-next/lib/brownfield-targets.ts:122-134`), and `createTarget` writes the same raw
   string into `brownfield_target.company_name` (:147-157).
3. **Corp-code resolution is a substring match over the FULL query.** The bulk-cache path
   filters `corp_name === q` (exact) and `corp_name.includes(q)` (partial) where `q` is the
   whole input string (`app/web-next/lib/dart-client.ts:363-364`); the list.json fallback uses
   the same `name.includes(q)` (:385); `resolveCorpCode` then picks exact-if-present else the
   FIRST result (:418). A paren name like `비에이치아이(BHI)` matches nothing: the cache holds
   the clean name `비에이치아이` (00409788, unique exact hit — verified against
   `db/data/dart-corpcode-cache.json`), and no `corp_name` contains the glossed string.
4. **Duplicate guard is a bare-name equality.** Both registration routes 400
   `duplicate_target` on exact `company_name` equality within the opportunity
   (`app/web-next/app/api/brownfield/[oppId]/targets/route.ts:156-159`; same guard in the
   accept route `.../target-proposals/route.ts:89-91`).
5. **PATCH split-brain.** The opportunity-keyed PATCH writes `brownfield_target` directly and
   never touches `md_company` (`app/web-next/app/api/brownfield/[oppId]/targets/[targetId]/route.ts:24-31`),
   while the detail-keyed PATCH re-runs `resolveOrCreateCompany`
   (`app/web-next/app/api/brownfield/targets/[targetId]/route.ts:66-96`, relink at :91). The
   opp-keyed route also uses COALESCE semantics, so it can never CLEAR a code (empty string →
   null → COALESCE keeps the old value).
6. **Financial sync keys on `md_company` and validates by containment.**
   `syncCompanyFinancialFacts` reads `md_company.dart_corp_code`, validates it against
   `md_company.name_ko` via `validateCorpCode`, nulls the code when containment fails, and
   downgrades to a name search
   (`app/web-next/lib/dart-financial-facts.ts:102-116`); containment is
   `name === e || name.includes(e) || e.includes(name)`
   (`app/web-next/lib/dart-client.ts:453`). With a glossed `name_ko` the downgrade search
   fails → `DartSyncError("corp_code_unresolved")`.
7. **Auto-sync is code-gated and swallows errors.** The detail hook skips sync without
   `dartCode` and calls the sync endpoint with `.catch(() => {})`
   (`app/web-next/components/brownfield-target/useTargetDetail.ts:100-108`, swallow at :107).
   The sync route audits only SUCCESS
   (`app/web-next/app/api/companies/[companyId]/sync/route.ts` — `company_financial_sync` in
   the try; the catch returns 409/503 without an audit row). The eval-draft note tells the
   user "`재무` facts`는 후보 상세 진입 시 자동 동기화되니 잠시 후 다시 시도하세요`"
   (`.../eval-draft/route.ts:119`) — wrong advice exactly when there is no code or the sync
   failed, which are the two cases that produce the empty-facts state.
8. **Live damage (dev DB `db/data/co-newbiz.sqlite`, verified).** md_company row
   `01M728V2FE9BTRH3B1SNZZZ5V6` is named `한전KPS(KEPCO KPS)` but holds corp code **00159193 =
   `한국전력공사`** (cache-verified) — the wrong company. A second, clean row
   `01M72ACGG5VVA5ADBGAD5YSMVW | 한전KPS | 00159218` exists with 40 `fact_financial` rows;
   the wrong-code row has **0** fact rows (the deadlock meant nothing was written — the
   silent-success variant of the same bug is the bigger exposure, §6). Three orphan targets
   on opportunity `01M6JN4YGJXD0BYT7DFH9MWKQ0` carry glossed names and NULL codes:
   `파워(Power)`, `비에이치아이(BHI)`, `태웅(Taeung)`.

### 2.2 Reality deltas vs the diagnosis

Four facts the diagnosis did not state, which shape the design:

- **`태웅` is ambiguous in the cache.** The dispatch's repair suggestion
  `태웅(Taeung) → 00216267` is one of FIVE exact-name cache rows (00216267, 01494631,
  01411203, 01697593, and 00186799 which carries stock code 044490 — the KRX-listed `태웅`).
  Exact-name uniqueness does NOT hold for `태웅`, so the §4 enrichment rule correctly attaches
  nothing, and the repair step needs owner confirmation (§9). 00216267 is not self-evidently
  the right code.
- **There is a SECOND bare-name duplicate guard** in the accept route
  (`target-proposals/route.ts:89-91`) — code-aware dedupe must cover both POST routes, not
  one.
- **The unique index makes repair a LINK, not an overwrite.** Fixing the wrong-code row by
  writing 00159218 onto it would violate `idx_md_company_dart` (the clean row already holds
  that code). The correct repair — which `resolveOrCreateCompany`'s by-code-first lookup
  already produces — is to point the TARGET at 00159218, which links it to the existing clean
  md_company row; the wrong-code row becomes an orphan for owner cleanup (§9).
- **Containment has a lenient direction that canonicalization exploits.**
  `e.includes(name)` means a gloss wrapping the true name would pass containment if the whole
  gloss were the expect-name. The observed deadlock happens because the glossed string is
  compared as a whole. Canonicalizing the expect-name first (§6) removes the paren-glass class
  of containment failures entirely; what remains are genuine mismatches (e.g.
  `CJ제일제당` vs DART `씨제이제일제당`), which is the case the code-authority ruling (§6)
  is designed for.

### 2.3 Incident mechanics (why the safety boundary is what it is)

The `한전KPS` wrong code did not come from a user typo alone — the pipeline has a silent
code-swap path: when containment fails, the code is nulled and `resolveCorpCode(name)` runs a
substring search that returns the FIRST partial hit (`dart-client.ts:418`), and
`dart-financial-facts.ts:117-118` then PERSISTS whatever came back onto `md_company`. A name
search that succeeds fuzzily silently re-brands the company; a name search that fails
(as here) deadlocks with an unactionable error and zero facts. Both branches are wrong.
§6 replaces this with explicit code authority + visible mismatch warnings, and tightens the
no-code path to exact-unique resolution only.

## 3. D1 — Name canonicalization at the company boundary

### 3.1 The canonical form

New pure module `app/web-next/lib/company-name.ts` (zero imports, follows the
`name-similarity.ts` extraction precedent):

```ts
export function canonicalCompanyName(raw: string): string
```

Rules, applied in order:

1. Trim; collapse internal whitespace runs to single spaces.
2. Strip trailing parenthetical groups repeatedly (ASCII `(...)` and fullwidth `（...）`),
   right-to-left — `한전KPS(KEPCO KPS)` → `한전KPS`; `삼성에스원(주)(구원)` → `삼성에스원(주)`
   → `삼성에스원`.
3. Strip a leading corporate-form marker `(주)`, `(재)`, `(유)` — `(주)한양` → `한양`.
4. If the result is empty (name was entirely parenthetical), return the trimmed raw string.

No transliteration, no case folding, no other rewriting. The function is total and
deterministic; idempotent by construction (`canonical(canonical(x)) === canonical(x)`).

### 3.2 Where it applies — and what keeps the gloss

Applied at EVERY identity write boundary, so both `md_company.name_ko` and
`brownfield_target.company_name` hold the canonical form:

- `resolveOrCreateCompany` (brownfield-targets.ts:122) canonicalizes its input and returns
  canonical names on insert;
- `createTarget` (brownfield-targets.ts:147) canonicalizes `companyName` before INSERT and
  before handing to `resolveOrCreateCompany`;
- the unified PATCH path (§5) canonicalizes incoming `company_name`.

**Why brownfield_target.company_name is canonicalized too, not just md_company:** the detail
GET resolves `company_id` with a name fallback `mc.name_ko = bt.company_name`
(`targets/[targetId]/route.ts:25`); keeping both sides canonical preserves that invariant
with no query change, and the duplicate guards collapse onto one comparison (§4).

**Where the gloss still lives (display fidelity):** the suggestion card shows the raw
proposal until accepted; the accept flow embeds the proposal rationale and source URL into
`universe_note` / the evidence timeline (`useBrownfieldBase.ts` `acceptProposal`), which
keeps the original string on the record; and once a code is attached, DART's own
`corp_name` — the authoritative display — flows through `validateCorpCode` /
`resolveCorpCode` results. Nothing loses information the audit trail does not hold.

### 3.3 resolveOrCreateCompany: two-pass name match + legacy normalization

Today a canonical input cannot match a legacy non-canonical row (`WHERE name_ko = ?` exact),
so repairing `비에이치아이(BHI)` via PATCH would mint a canonical TWIN row. The lookup
becomes a three-pass idempotent chain:

1. **By code** — unchanged (`WHERE dart_corp_code = ?`), respecting the unique index.
2. **By canonical name** — `WHERE name_ko = canonical(input)`.
3. **By raw name** — `WHERE name_ko = raw input` (legacy rows). When this pass hits and
   `canonical(input) !== name_ko`, the row's `name_ko` is UPDATED to the canonical form
   (one-time normalization; idempotent; audit coverage comes from the calling
   `brownfield_target.update` row — `resolveOrCreateCompany` has no actor parameter and
   gains none this batch).

Insert (pass 4) always uses the canonical name. The conditional code-fill on match
(:128 `AND dart_corp_code IS NULL`) is unchanged — an existing non-null code is never
overwritten here (unique index + authority belongs to the by-code pass).

## 4. D2 — Server-side suggestion enrichment

### 4.1 Prompt asks for an optional DART-registered name

The output-contract line in `buildPrompt` (web-search route:366) gains one OPTIONAL field:

```
{"candidates":[{"company_name":"회사명(한글, 간결)","dart_corp_name":"DART 공시에 등록된 정확한 법인명(확실할 때만, 모르면 생략)","rationale":"…","source_indices":[…]}]}
```

`dart_corp_name` is optional and never blocks: normalize passes it through when present
(`Suggestion` gains `dart_corp_name?: string`), drops it otherwise. The model is never asked
for the 8-digit code — names only (alternatives §8.5).

### 4.2 Enrichment — exact-unique attach, best-effort

After `normalizeLlmSuggestions`, the route enriches each suggestion server-side
(new private helper `enrichSuggestions` in the same route file):

1. `q = canonicalCompanyName(company_name)`.
2. `rows = await searchCorpCodes(q, 8)` — wrapped in try/catch; enrichment failure NEVER
   fails the response (best-effort by contract).
3. Attach `dart_corp_code` **iff** the rows contain exactly one entry with
   `corp_name === q` (exact and unique). Attach nothing on zero hits, on multiple exact hits
   (the `태웅` case: five rows), or on any error.
4. If step 3 found nothing and the model supplied `dart_corp_name`, repeat steps 1-3 with
   `q2 = canonicalCompanyName(dart_corp_name)` — again exact-unique only.

The accepted code therefore always comes from the deterministic cache against a canonical
name, never from the model, never from a fuzzy partial hit. `WebSuggestion`
(`components/stages/brownfield/types.ts:75-81`) already carries the optional
`dart_corp_code`, and the accept call already forwards `s.dart_corp_code ?? null`
(`DiscoveryPanels.tsx:128`) — the enriched code reaches `createTarget` with no client change.

## 5. D3/D4 — Code-aware duplicate handling and one PATCH path

### 5.1 D3 — duplicate semantics per route

Both registration POSTs (`[oppId]/targets/route.ts:156` and
`[oppId]/target-proposals/route.ts:89`) replace the bare-name guard with a canonical,
code-aware match over the opportunity's non-excluded targets (rows fetched, compared in JS —
long lists are tens of rows, not thousands):

- **Code match**: incoming code non-null and equals an existing target's `dart_corp_code`;
  OR
- **Canonical-name match**: `canonicalCompanyName(existing.company_name) === canonical(incoming)`.

On a hit: return **200 `ok(existing_target)`** with envelope meta `{ deduped: true }` and
audit `brownfield_target.dedupe` (actor, target `${oppId}:${existingId}`) — registration
becomes "ensure present" (idempotent). The client's `acceptProposal` already treats 2xx as
success and dismisses the card, so the UX degrades gracefully ("already registered").
The 400 `duplicate_target` shape survives only where an action would CHANGE the set: PATCH
collisions (below).

**PATCH collision rule** (both PATCH routes, §5.2): when a PATCH would move a target's
canonical name or code onto a DIFFERENT non-excluded sibling in the same opportunity,
return **409 `duplicate_target`** with envelope `existing_target_id`. No auto-merge —
merging targets is destructive and stays a human action (alternatives §8.4).

### 5.2 D4 — unified `updateTargetFields`

New exported repo function in `lib/brownfield-targets.ts`:

```ts
export function updateTargetFields(
  db: Database, targetId: string,
  patch: { company_name?: string; dart_corp_code?: string | null; universe_note?: string | null },
  opts: { actorUserId: string },
): TargetRow
```

Semantics (adopting the detail-PATCH contract as the single standard):

- absent key = unchanged; explicit `null` = clear (this also FIXES the opp-keyed route's
  inability to clear a code — §2.1 item 5); `company_name` is canonicalized; code is
  trimmed-or-null;
- the row UPDATE is followed unconditionally by `resolveOrCreateCompany(db, canonicalName,
  code)` — every write path re-links the company master, ending the split-brain;
- audits `brownfield_target.update` with `target: "${row.opportunity_id}:${targetId}"` —
  one shape for both routes (the opp-keyed route currently writes the composite target, the
  detail route writes bare targetId; unified to the composite).

Both PATCH handlers delegate to it after their existing route-level guards (auth; the
detail route's blank-name check). The opp-keyed route gains no new track/promoted guards —
those remain POST-only as today (verified: PATCH at `.../[targetId]/route.ts:10-33` has
none).

The detail GET (targets/[targetId]/route.ts:22-27) is unchanged: canonical-to-canonical
name fallback and by-code-first COALESCE both keep working.

## 6. D5 — Corp-code authority in `syncCompanyFinancialFacts`

### 6.1 New logic

`dart-financial-facts.ts:102-116` becomes:

```ts
let corpCode = opts.corpCode ?? company.dart_corp_code ?? null;
const warnings: string[] = [];
if (!opts.corpCode && corpCode) {
  const check = await (opts.validator ?? validateCorpCode)(corpCode, canonicalCompanyName(company.name_ko));
  if (check.validated === false) {
    // DART responded and KNOWS this code, but its registered name differs from ours.
    // Code authority: proceed with the entered/stored code, surface the mismatch.
    warnings.push(`corp_code_name_mismatch: DART corp_name='${check.corpName ?? "?"}' for code ${corpCode}`);
  }
  // validated === null (DART unreachable): keep current behavior — proceed with the code.
}
if (!corpCode) {
  const resolved = await resolveCorpCode(canonicalCompanyName(company.name_ko));
  if (!resolved.corpCode || resolved.validated !== true) {
    throw new DartSyncError(
      `Cannot resolve the DART corp code — no exact verified match for '${company.name_ko}'. Register the dart corp code on the company screen first.`,
      "corp_code_unresolved");
  }
  corpCode = resolved.corpCode;
}
```

Three changes, each with a reason:

1. **The expect-name is canonicalized first** — the entire paren-gloss class of containment
   failures disappears before validation runs (§2.2 item 4).
2. **`validated === false` no longer nulls the code and no longer downgrades to name
   search.** The code — human-entered or exact-unique-attached — is authoritative; the
   mismatch is RECORDED (`SyncResult` gains `warnings: string[]`, surfaced in the sync
   response and the §7 banner with DART's own corp name) instead of triggering a silent
   substitution or a deadlock.
3. **The no-code path tightens to exact-verified resolution.** `resolveCorpCode` must return
   `validated === true` for its code to be used AND persisted (:117-118 unchanged otherwise);
   a first-partial-hit guess (`dart-client.ts:418`) or an unvalidated web fallback now
   throws `corp_code_unresolved` with advice to register the code manually. This closes the
   silent code-swap path that generated the `한전KPS` incident (§2.3).

`opts.validator` is a test seam mirroring the existing `opts.fetcher` injection pattern.

### 6.2 The safety boundary — why proceed-with-warning beats block and beats downgrade

- **Downgrade-to-name-search is the hazard, not the remedy.** It is the path that can
  silently persist another company's code (first partial hit + :117-118 persist) — the exact
  mechanism behind 00159193 sitting on a `한전KPS` row — or deadlock with zero facts (the
  observed outcome: the wrong-code row has 0 `fact_financial` rows). Removed whenever a code
  exists.
- **Blocking on every containment failure re-creates the deadlock** for legitimate name
  variants where the code is RIGHT (DART `씨제이제일제당` vs our `CJ제일제당`) — the feature
  fails exactly where it is most correct, and the user is pushed toward hand-running the same
  name searches.
- **Proceed-with-warning makes wrongness visible and convergent.** A genuinely wrong code
  produces facts clearly labeled with the mismatch warning, a banner naming DART's registered
  company, and an audit trail; the fix (enter the right code) flows through the now-unified
  PATCH, and re-sync writes the corrected values as new revisions — the house
  `revision_no` history converges to correct (§2.3 noted the wrong row had no facts at all;
  under the new rule it would have SOME wrong-labeled facts and a loud warning, which is
  strictly more actionable than silence). Residual risk accepted and stated: between the
  wrong sync and the repair, latest-revision financial verdicts (ADR-0140) could read
  wrong-company figures — mitigated by the banner shown on the same screen the verdict drafts
  render, and by the §4 attach rule preventing most wrong codes from ever entering.

## 7. D6/D7 — Failure visibility and the unverified-code chip

### 7.1 D6 — sync failures surface and audit

- **Hook** (`useTargetDetail.ts:100-108`): the swallowed `.catch(() => {})` becomes a catch
  that parses the error envelope (`{ ok: false, code, message }` — `fail()` shape) into
  `syncError: { code, message } | null` state; success (manual or auto) clears it. The
  once-per-company `autoSyncedFor` guard stays. When `!dartCode`, the hook exposes
  `syncError = { code: "corp_code_unregistered", ... }` style state (client-derived, no
  request sent) so the banner has one uniform shape.
- **Banner**: the target detail overview (`components/brownfield-target/TargetOverviewTabs.tsx`,
  header slot) renders a warning banner when `syncError` — message from the envelope, plus a
  `재시도` button re-invoking the same POST (and clearing state on success) — and an
  informational banner when no code is registered, pointing at the PATCH form. When a sync
  succeeded with warnings (§6.1), the banner shows the mismatch line including DART's
  registered name.
- **Route** (`companies/[companyId]/sync/route.ts`): the DartSyncError catch appends
  `appendAudit(db, { actor, action: "company_financial_sync_failed", target: companyId, now })`
  before returning `fail(...)`. Honest limitation, stated per the DEC-20261111-05 precedent:
  `audit_log` has no metadata column (`db/migrations/0002_project_access_control.sql:53-58`;
  `db/lib/access-control.ts:37-44`), so the DartSyncError code travels in the response
  envelope, not the audit row; the audit proves THAT a failure happened for which company
  and actor. Encodable-code-in-action-string is a recorded follow-up (§10).
- **eval-draft note** (`eval-draft/route.ts:119`): the `!analysis.available` branch becomes
  conditional on the target's code — no code → "DART `고유번호가 없어 자동 동기화가 시도되지`
  `않았습니다` — `후보 수정에서 고유번호를 등록한 뒤 다시 시도하세요`."; code present →
  "DART `재무 동기화가 아직 성공하지 못했습니다` — `후보 상세의 재무 동기화를 다시 실행하세요`."
  (the route already has the target row in scope; no new query).

### 7.2 D7 — `고유번호 미확인` chip on suggestion cards

`DiscoveryPanels.tsx` web-proposal card (the reliability chip block at :99-107): when
`!s.dart_corp_code`, render a sibling `status-chip status-not-started` chip
`고유번호 미확인` with a `title` tooltip: "DART `고유번호가 확인되지 않은 제안입니다` — `등록 후`
`후보 수정에서 고유번호를 입력해야 재무 자동 동기화가 동작합니다`." Locale catalog keys added to
`locales/ko.json` and `locales/en.json` (ADR-0184 pattern). The chip makes the §4 exact-unique
refusal legible instead of silent. Existing design-system constraints hold (chip classes only,
no new components; `bun scripts/design-lint.ts` gate at implementation).

## 8. Alternatives considered

1. **Fuzzy/partial matching of cache names at suggestion time** (attach best `includes()`
   hit, scored). Rejected — a partial-hit attach is precisely the `한전KPS`-class hazard
   (§2.3): the first partial hit gets persisted as identity. Only exact-unique attach is
   safe; genuine ambiguity defers to the human via the chip and the PATCH form.
2. **Storing the code on `brownfield_target` only** and skipping `md_company`. Rejected —
   `fact_financial`, the company profile/analysis pipeline, competitor registry, and synergy
   surfaces all key on `md_company`; target-only codes fork identity and leave the sync path
   dead. The target column stays as the user-facing entry point; the master remains the
   authority the joins read.
3. **Blocking sync on any containment failure** (validated=false → 409, no facts).
   Rejected — deadlocks legitimate name-variant cases (§6.2), yields zero actionable data
   (the incident row sat at 0 facts under exactly this behavior), and gives no better
   guarantee: blocking does not detect a wrong code any better than the warning does; it
   only hides it behind an error.
4. **Auto-merge of duplicate targets on PATCH collision.** Rejected — merges move evidence,
   judgements, and eval states; destructive actions stay human. 409 + `existing_target_id`
   tells the user exactly what to do.
5. **Asking the LLM for the 8-digit `dart_corp_code`.** Rejected — hallucination risk on an
   opaque identifier; the model may know the registered NAME, which the deterministic cache
   then verifies (§4). Codes enter only from the cache or from a human.
6. **Canonicalizing only `md_company.name_ko`, keeping the gloss on `brownfield_target`.**
   Rejected — breaks the detail GET's name-fallback join (`mc.name_ko = bt.company_name`)
   and leaves the duplicate guards comparing glossed strings. Both sides canonical; raw
   strings live on in proposals/evidence (§3.2).
7. **DB repair script in this batch.** Rejected — live-data writes are owner actions; the
   fixed PATCH is itself the repair instrument (§9). A script would bypass audit and the
   unique-index discipline the by-code link respects.

## 9. Data repair (out of code — owner/UX actions AFTER merge)

All repairs run through the fixed PATCH (detail screen), which now canonicalizes names,
re-links `md_company`, and audits. No SQL is run by this batch.

1. **`비에이치아이(BHI)`** (target on opp `01M6JN4YGJXD0BYT7DFH9MWKQ0`; md_company
   `01M75EFGAWRJFZGG33S7310VJ0`, NULL code): PATCH `dart_corp_code = 00409788` (unique exact
   cache hit, stock 083650). The §3.3 raw-name pass normalizes the md_company `name_ko` to
   `비에이치아이` and fills its NULL code — no twin row. Then re-sync → facts load.
2. **`태웅(Taeung)`** (md_company `01M75EG52CF2HPVG7QZY9P7F4H`, NULL code): AMBIGUOUS — five
   exact-name cache rows (00216267, 01494631, 01411203, 01697593, 00186799[stock 044490 =
   the KRX-listed `태웅`]). The dispatch's suggested 00216267 is NOT confirmed; owner picks the
   entity (listed `태웅` → 00186799 is the likely intent) and PATCHes that code. The §4 rule
   correctly attaches nothing automatically here.
3. **`파워(Power)`** (md_company `01M75EFE99QZB3B0F4YM9BA1CQ`, NULL code): no exact `파워`
   cache row; `파워로직스` = 00269612 exists. Owner confirms whether `파워` meant `파워로직스`
   (then PATCH 00269612) or another entity (manual code entry).
4. **`한전KPS(KEPCO KPS)` wrong code** (target on opp `01M6ZPEZ39R78DW612ECEXY5W4`; md_company
   `01M728V2FE9BTRH3B1SNZZZ5V6` holds 00159193 = `한국전력공사`): PATCH the target with
   `dart_corp_code = 00159218` (+ canonical name) — by-code resolution LINKS the target to
   the existing clean md_company row `01M72ACGG5VVA5ADBGAD5YSMVW` (40 fact rows already);
   re-sync verifies/refreshes. The orphaned wrong-code row (0 facts) is then an owner
   decision: rename its `name_ko` to `한국전력공사` (turning it into the correct KEPCO master
   row) or delete it. NOT automatic in this batch.

## 10. Follow-ups (not this batch)

1. Execute §9 repairs via the UI after merge; consolidate any legacy md_company twins that
   the raw-name pass cannot see (rows whose names differ beyond paren gloss).
2. Reuse the §4 enrichment + §3 canonicalization in the sibling web-search proposal routes
   (`synergy/web-search`, `companies/[companyId]/competitor-proposals/web-search`,
   `our-company/.../business-targets/web-search` — same Suggestion shape, same gap) as a
   separate small dispatch after this batch proves the pattern.
3. Consider encoding the DartSyncError code in the audit action string
   (`company_financial_sync_failed.corp_code_unresolved`) if admin tooling needs queryable
   failure codes — audit-vocabulary change, needs its own ruling.
4. Wiki refresh for the S6/S7 pages (chip + banner + code-entry guidance) —
   handbook-sync-audit will flag the drift; lands with the implementation dispatch.

## 11. Test plan (per item; documented here, implemented in Rows 1+)

All under `tests/unit/`; DB fixtures via `CO_NEWBIZ_DB_PATH` temp sqlite per house pattern;
extending `brownfield-llm-support.test.ts` (the web-search normalize tests live there) and
`dart-financial-facts` fixtures (`test-dart-financial-facts.sqlite` precedent).

1. **D1** — `canonicalCompanyName`: trailing ASCII/fullwidth groups (single, repeated);
   leading `(주)`/`(재)` / `(유)`; gloss-only name falls back to raw; whitespace collapse;
   idempotence. `resolveOrCreateCompany`: raw-name second pass returns the legacy row id and
   normalizes its `name_ko`; by-code pass unchanged; insert uses canonical name;
   `createTarget` stores canonical.
2. **D2** — `normalizeLlmSuggestions` passes `dart_corp_name` through (and drops garbage
   types); prompt string contains the optional `dart_corp_name` ask; `enrichSuggestions`:
   unique exact hit attaches; five-hit ambiguity attaches nothing; zero hit attaches
   nothing; `searchCorpCodes` throwing leaves suggestions unattached and the response intact;
   `dart_corp_name` fallback path.
3. **D3** — POST targets: code-match dedupe → 200 existing id + `deduped: true` meta +
   `brownfield_target.dedupe` audit; canonical-name dedupe (glossed vs clean); no
   cross-opportunity false positive; excluded targets do not block re-registration; POST
   proposals: same matrix; PATCH rename onto sibling's canonical name → 409 +
   `existing_target_id`, row untouched.
4. **D4** — opp-keyed PATCH: re-links md_company (fixture asserts the company master gains
   the code/name), explicit `null` clears `dart_corp_code`, absent key unchanged, audit
   `brownfield_target.update` with composite target string; detail PATCH regression suite
   (existing behavior preserved through the delegation).
5. **D5** — sync with stubbed `validator` → `{validated:false, corpName:"한국전력공사"}` on a
   stored code: proceeds with the stored code, `warnings` contains
   `corp_code_name_mismatch`, `resolveCorpCode` NOT invoked (assert via fetcher spy having
   been reached with the stored code's company); canonical expect-name passes containment
   where the gloss used to fail; no-code path with `validated !== true` resolution → throws
   `corp_code_unresolved` and persists nothing; explicit `opts.corpCode` short-circuit
   unchanged.
6. **D6** — sync route: DartSyncError path writes the `company_financial_sync_failed` audit
   row before the 409 (temp-DB fixture); success audit unchanged. Hook/component: failure
   envelope sets the banner state; retry clears it; no-code state renders the informational
   banner. eval-draft note: no-code variant and code-but-no-facts variant strings.
7. **D7** — proposal card renders the `고유번호 미확인` chip iff `dart_corp_code` absent;
   locale keys present in ko/en catalogs (ADR-0184 catalog test if one exists for these
   files).

Implementation gate: `bun test` (unit dirs touched), `cd app/web-next && bun scripts/design-lint.ts`
(chip/banner are token-only), `bun scripts/audit.ts` green before PR.
