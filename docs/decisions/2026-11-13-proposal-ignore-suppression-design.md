---
title: Suppress repeatedly-ignored brownfield target proposals — persisted ignore events, count-based suppression at 2, shared company key
date: 2026-11-13
status: Draft (Design Gate ADR-0074 — Row 0 determination accepted per DEC-20261113-04; implementation has not started; spec registration DEFERRED to landing time by PM — an in-flight batch owns docs/specs/registry.json)
owner: backend-engineer (design; PM dispatch per DEC-20261113-04)
reviewers_required: process-governance-manager (AI-2nd, functional domain — author is technical domain), data-architect consult (new table), frontend-engineer consult (DiscoveryPanels/UniverseSection surfaces), security-engineer consult (new write route), owner (human approval)
decision_record: docs/decisions/DEC-20261113-04.md
related: design 2026-11-11-target-identity-resolution (owns canonicalCompanyName, §D1), design 2026-11-11 §4/§5 (DART name enrichment + code-or-canonical dedupe — untouched), ADR-0118 (web-search proposal contract — unchanged), ADR-0012 (append-only audit), ADR-0074 (Design Gate), ADR-0142 (competitor-web-proposals — out of scope, boundary noted)
---

# Suppress repeatedly-ignored brownfield target proposals

## 1. Conclusion (the chosen design)

The brownfield S6/S7 proposal ignore becomes **a persisted event, not a UI gesture**. Today the
ignore button (`DiscoveryPanels.tsx:149-158`) only filters the in-memory `webProposals` array, so
an ignored company reappears on every regeneration. This design adds one append-only event table
(`brownfield_target_proposal_ignore`, migration 0192), one audited write route
(`POST /api/brownfield/[oppId]/target-proposals/ignore`, analyst+), and one rule enforced on
**both** brownfield proposal surfaces (web-search POST and master-proposals GET): a candidate
whose normalized company key has **2 or more** ignore events for the opportunity is filtered out
of the proposal response before it reaches the client. The suppression key is a new pure
`companyKey()` that composes the existing `canonicalCompanyName` with an explicit
stock-company-word (the Korean legal-form word, romanized jusikhoesa — Korean copy, translated)/`㈜`
legal-form token strip and the existing `normalizeName`, so `jusikhoesa Hanyang`,
`Hanyang(Ju)`, `Hanyang jusikhoesa`, and `Hanyang` collapse to one key (company names romanized
from the Korean examples throughout); suppression matches **exact key equality
only** — no fuzzy matching, because silently excluding a legitimate candidate is strictly worse
than one extra recurrence. The ignored raw names are also injected into the LLM prompt as an
advisory exclusion hint (belt and suspenders; the post-extraction hard filter is normative).
The UI keeps its current gesture (persist, then remove the card) and gains one text chip —
"Ignored 1 time" (Korean copy, translated) — on a re-proposed card that already carries one
ignore, so the user can reach the second ignore deliberately. Per-opportunity scope; no un-ignore UI in v1; the same `companyKey`
also hardens the two exact-string existing-name matches in the same change.

Mental model: the ignore list is a **do-not-call register keyed by the person's own clicks**, not
a blacklist. Nobody curates it; it grows exactly as fast as the user dismisses candidates, and it
only speaks up (suppresses) after the user has dismissed the same name twice. One dismissal
leaves the door open with a sticky note on it ("Ignored 1 time" — Korean copy, translated) — two
dismissals close the door.

## 2. Verified state (KNOWN)

All file:line anchors read on the working tree, 2026-11-13.

- **Web-search proposal route** `app/web-next/app/api/brownfield/[oppId]/target-proposals/web-search/route.ts`:
  `POST` at `:203`; role gate `requireBusinessActor(auth.auth, "write", { viewerMessage: "Web-search
  proposal generation requires the analyst role or higher." })` at `:206-209`; opportunity lookup
  `:212-223`; `existingNames` from `brownfield_target` at `:236-240`; the search ladder
  (Tavily → Playwright headless → `llmKnowledgeFallback` → `synthesisFallback`) at `:244-296`;
  LLM extraction `:299-314`; `normalizeLlmSuggestions(llmRes, sources, existingNames)` at `:316`
  (defined `:391-427`) — candidates without `source_indices` are discarded (ADR-0118, `:411-412`)
  and each kept name is deduped against `seen = [...existingNames]` plus previously accepted
  candidates via `isSimilar(name, seen)` (`:404`, `seen.push` at `:423`); `enrichSuggestions`
  attaches `dart_corp_code` on exact-unique cache hits (`:436-458`). The LLM-knowledge fallback
  path mirrors this with `normalizeLlmKnowledgeSuggestions` (`:184-201`, same `isSimilar` dedupe,
  no sources required). The deterministic `synthesisFallback` filters md_company rows with the
  bare exact match `!existingNames.includes(c.name_ko)` (`:80`). Audit: `appendAudit` with
  `action: "target_proposal.web_search"` / `"..._llm_knowledge"` (`:89`, `:136-141`, `:317-322`).
  No ignore/suppression state is read anywhere in the file (grep-verified).
- **Master-proposals route** `app/web-next/app/api/brownfield/[oppId]/target-proposals/route.ts`:
  GET (deterministic md_company suggestions) at `:40-65` — filters already-registered candidates
  with `names.has(c.name_ko)` on a `Set` of raw strings (`:53`, `:60`); POST (accept) at
  `:67-123` — role gate analyst+ `:70-73`, `discovery_source` whitelist
  `manual | master_proposal | web_proposal` (`:83-85`), brownfield track guard (`:93-99`),
  duplicate acceptance returns the existing row idempotently via `findDuplicateTarget`
  (`:105-114`), fresh accept writes `brownfield_target` with `proposal_accepted_at` and audited
  `target_proposal.accept` (`:115-122`). This POST is the accept path both proposal kinds reuse.
- **UI** `app/web-next/components/stages/brownfield/DiscoveryPanels.tsx`: web proposal cards
  render `webProposals` (`:96-161`); the ignore button at `:149-158` (i18n `tc("ignore")` at
  `:157`) calls only
  `setWebProposals((prev) => (prev ?? []).filter((p) => p.company_name !== s.company_name))`
  (`:153-155`) — client-ephemeral; no route call, no persistence, no count.
- **Proposal generation + accept in the client**:
  `useBrownfieldUniverse.tsx:215-232` (`generateWebProposals` → POST web-search, sets
  `webProposals`/`webNote`/`webSource`); `useBrownfieldBase.ts:126-146` (`acceptProposal` →
  POST `/target-proposals` with `discovery_source`, then removes the card from BOTH the master
  `proposals` and `webProposals` lists); master suggestions render as control chips in
  `UniverseSection.tsx:130-137` (no ignore affordance there today). `WebProposalResponse` is
  defined in `components/stages/brownfield/types.ts:82`.
- **Normalization helpers**:
  - `app/web-next/lib/name-similarity.ts` — `normalizeName` (`:8-10`: lowercase, strip
    whitespace + `\p{P}` punctuation) and `isSimilar` (`:13-35`: normalized equality, substring
    containment, or raw-token Jaccard ≥ 0.6). `(Ju)Hanyang` normalizes to `juHanyang` (parens stripped,
    marker letter kept) — `normalizeName` alone does NOT neutralize corporate-form markers, and
    neither helper strips the Korean stock-company word (jusikhoesa — Korean copy, translated).
  - `app/web-next/lib/company-name.ts` — `canonicalCompanyName` (`:31-43`, design
    2026-11-11-target-identity-resolution §D1): trim + whitespace collapse, repeated
    right-to-left trailing parenthetical-gloss strip (`HanjeonKPS(KEPCO KPS)` → `HanjeonKPS`,
    `Hanyang(Ju)` → `Hanyang`), leading `(Ju)/(Jae)/(Yu)` marker strip (`(Ju)Hanyang` → `Hanyang`)
    — corporate-form markers romanized from the Korean originals (stock / foundation / limited) —
    idempotent. It does NOT handle the word form `jusikhoesa Hanyang` / `Hanyang jusikhoesa` or the single-glyph
    `㈜`.
- **Dedup on accept** uses `findDuplicateTarget` (`brownfield-targets.ts:312-327`), which
  matches by `dart_corp_code` first, then `canonicalCompanyName` equality (`:321-325`) — the
  accept side is already variant-tolerant; only the proposal-side filters are not.
- **Audit family**: every write path lands in `audit_log` via `appendAudit`
  (`db/lib/access-control.ts`) and gains no delete path (ADR-0012 / FR-SEC-07 house rule).
- **Migrations**: `db/migrations/` numbering is `NNNN_name.sql`; the latest is
  `0191_external_reference_supersede.sql`, which carries the house `@reversible: true` header
  with a manual-rollback note.
- **openapi.yaml**: the two proposal paths are registered at
  `/api/brownfield/{oppId}/target-proposals` (`:7922-7952`, operationIds
  `listBrownfieldTargetProposals` / `acceptBrownfieldTargetProposal`) and
  `/api/brownfield/{oppId}/target-proposals/web-search` (`:7970-7984`, operationId
  `generateWebSearchTargetProposals`); an unregistered route fails the drift gate.
- **Test precedent**: `tests/unit/external-reference-supersede.test.ts` pins route contracts via
  the `tests/unit/helpers/next-route-dispatch.ts` helper with a scratch SQLite DB
  (`process.env.CO_NEWBIZ_DB_PATH` → `db/data/test-*.sqlite`), `runMigrations`, real login
  cookies per role (analyst/viewer via `createUser`/`approveUser`), and
  `process.env.CO_NEWBIZ_LLM_PROVIDER = "none"` is the house guard for suites that must not dial
  LLMs (docs/context.md testing notes).
- **Related surface (boundary)**: `lib/competitor-web-proposals.ts` reuses the same
  search-extraction ladder for the competitor domain (ADR-0142); it has its own accept surface
  (`company_competitor`) and no ignore UI. Out of scope for this change (§8).

### INFERRED

- The requirement "2 or more ignores" can only be satisfied by an event-count store: a boolean
  flag cannot express "ignored twice", and the count chip (§3.5) needs the 1-ignored state.
- Within-generation duplicate names are already impossible on the web-search path
  (`normalizeLlmSuggestions` / `normalizeLlmKnowledgeSuggestions` dedupe via `isSimilar` against
  `seen`, and the UI removes the card on ignore), so "dedupe within one generation" is moot;
  cross-generation repeats are exactly the recurrence the user's rule counts. Each accepted
  ignore click therefore appends one row, and count = row count.
- The master-proposals GET re-proposes the same md_company rows on every panel load, so an
  ignore made in the web-search modal must suppress there too, or the same company resurfaces
  through the other surface. The two surfaces share no extraction code, but the store is
  key-based and surface-agnostic — filtering both is three lines each and keeps suppression
  consistent.
- Hardening the existing-name exact matches with the same key is a defect fix in the same family
  (name variants currently defeat `includes`/`Set.has`), testable with the same helper.

### ASSUMED

- The Korean stock-company word (jusikhoesa — Korean copy, translated; the literal Hangul token
  the implementation strips) appears only as a legal-form marker (prefix or suffix token) in
  practice; stripping
  every remaining stock-company-word/`㈜` occurrence after `canonicalCompanyName` never merges two
  genuinely distinct Korean companies whose names differ only by that token. If implementation
  finds a counterexample, the fallback (recorded in DEC-20261113-04 Conditions) is to key on
  `canonicalCompanyName` + `normalizeName` only.
- The proposals this design suppresses are proposal-time artifacts only; no historical
  `brownfield_target` row is created, moved, or deleted by any part of this change.
- The dev/production SQLite file will only ever hold modest ignore volume (analyst clicks), so
  `COUNT(*) GROUP BY` on the `(opportunity_id, company_key)` index stays trivial.

### UNKNOWN

- Whether any non-repo client calls the proposal surfaces and would be surprised by the
  additive `ignore_count` field on web-search suggestions — none exists in this workspace (the
  MCP registry has no brownfield proposal tools; grep-verified). The field is additive and the
  suppression behavior is server-side, so the break notice in the PR body is informational.

## 3. Design

### 3.1 Storage — append-only ignore events (migration 0192)

New file `db/migrations/0192_target_proposal_ignore.sql` (next number after 0191; header cites
this design + DEC-20261113-04, carries `@reversible: true` with the manual rollback
`DROP TABLE brownfield_target_proposal_ignore;`):

```sql
CREATE TABLE brownfield_target_proposal_ignore (
  id TEXT PRIMARY KEY,                                    -- ulid (db/lib/ulid.ts, house style)
  opportunity_id TEXT NOT NULL REFERENCES opportunity(id),
  company_name_raw TEXT NOT NULL,                         -- exactly what the card showed
  company_key TEXT NOT NULL,                              -- companyKey(company_name_raw), see §3.2
  ignored_by TEXT NOT NULL,                               -- app_user.id of the clicking analyst
  created_at TEXT NOT NULL                                -- ISO 8601, same convention as audit_log
);
CREATE INDEX idx_btpi_opp_key ON brownfield_target_proposal_ignore(opportunity_id, company_key);
```

- **Append-only, event-per-click**: no UNIQUE constraint on `(opportunity_id, company_key)` —
  the user's rule counts ignore EVENTS, so repeated ignores across generations accumulate rows
  and `ignore_count = COUNT(*)` per `(opportunity_id, company_key)`. No UPDATE, no DELETE in
  application code (audit-family precedent ADR-0012; un-ignore is a manual DB op, §8).
- One new lib owns the store: `app/web-next/lib/brownfield-proposal-ignore.ts` with
  `recordProposalIgnore(db, oppId, rawName, userId) → { companyKey, ignoreCount }` (insert +
  count + audit) and `suppressedProposalKeys(db, oppId) → Set<string>` (the ≥2-threshold query,
  `GROUP BY company_key HAVING COUNT(*) >= PROPOSAL_IGNORE_SUPPRESS_THRESHOLD`). Routes stay
  thin; the threshold constant `PROPOSAL_IGNORE_SUPPRESS_THRESHOLD = 2` lives here and is
  exported for tests.

### 3.2 Company key — one deterministic normalizer (D-B)

New exported pure function `companyKey(raw: string): string` in `app/web-next/lib/name-similarity.ts`
(the matching/normalization helper file; `company-name.ts` stays the canonical-identity home per
design 2026-11-11 §D1 and gains nothing):

1. `canonicalCompanyName(raw)` — trims, collapses whitespace, strips trailing parenthetical
   glosses and leading `(Ju)/(Jae)/(Yu)` corporate-form markers (existing, idempotent).
2. Remove the residual legal-form tokens `㈜` (single glyph) and the Korean stock-company word
   (jusikhoesa — Korean copy, translated; word form, any
   position — after step 1 any remaining occurrence is marker residue), then trim again.
3. `normalizeName(...)` — lowercase, strip whitespace and punctuation (existing).

Examples (all → the same `Hanyang`-equivalent key; company names romanized from the Korean
examples): `Hanyang`, `(Ju)Hanyang`, `Hanyang(Ju)`,
`jusikhoesa Hanyang`, `jusikhoesaHanyang`, `Hanyang jusikhoesa`, `㈜Hanyang`, `Hanyang(Guwon)`
(the Guwon gloss marks a rescued/restructured entity).
Empty result (e.g. raw `"(Ju)"`) → the caller rejects (`company_required`-style badRequest); an
empty key is never stored and never matches.

- **Exact-key equality only for suppression** (DEC ruling): a candidate is suppressed iff
  `companyKey(candidate) ∈ suppressedProposalKeys(db, oppId)`. `isSimilar` stays exactly where it
  is today — the existing-name dedupe inside the extractors (`:404`, `:193`) — and is NOT used
  for suppression. Tradeoff recorded: distinct companies sharing one base name after legal-form
  collapse share a key and are suppressed together; v1 accepts this because false suppression is
  strictly worse than recurrence, and true base-name collisions in Korean proposal pools are
  rare. Most web-search proposals carry no `dart_corp_code`, so a code-based key cannot serve.

### 3.3 Ignore route (D-C)

`app/web-next/app/api/brownfield/[oppId]/target-proposals/ignore/route.ts`, POST only:

1. `authenticate` + `requireBusinessActor(auth.auth, "write", { viewerMessage: ... })` — the same
   analyst+ gate shape as the accept POST (`target-proposals/route.ts:70-73`).
2. Opportunity existence check → `notFound()` (404-not-403 house rule).
3. Body `{ company_name: string }` — trim, reject empty/blank with
   `badRequest("company_required", ...)` (mirrors the accept route `:81`).
4. `recordProposalIgnore(...)` — INSERT event row, `appendAudit(db, { actor, action:
   "target_proposal.ignore", target: `${oppId}:${companyKey}`, now })`.
5. Response `201` with `{ company_key, ignore_count }` (`ok(payload, 201)`, matching the accept
   route's Created). A repeated click is a new event and a new 201 — accumulation is the
   contract, not idempotence.

No GET on this route in v1; the count is already visible via the suggestion chip (§3.5).

### 3.4 Suppression on both proposal surfaces (D-D)

- **Web-search POST** (`web-search/route.ts`): load
  `const suppressed = suppressedProposalKeys(db, oppId)` next to `existingNames` (`:236`).
  - *Hard filter (normative)*: pass `suppressed` into the three extractors —
    `normalizeLlmSuggestions(llmRes, sources, existingNames, suppressed)`,
    `normalizeLlmKnowledgeSuggestions(llmRes, existingNames, suppressed)`, and
    `synthesisFallback(..., suppressed)` — each skips a candidate when
    `suppressed.has(companyKey(name))` (all three are exported pure functions today, so the
    extra parameter is test-first-able; synthesisFallback's bare `!existingNames.includes(...)`
    at `:80` becomes the key comparison per §3.6).
  - *Prompt hint (advisory)*: `buildPrompt` and `buildKnowledgePrompt` gain an optional
    `ignoredNames: string[]` parameter rendered as an exclusion block
    "Candidates ignored in previous proposals (re-proposal prohibited): - <raw name>" (Korean
    copy, translated), mirroring the existing
    "Candidates already registered in the Long List" block (Korean copy, translated) (`:373`, `:169`). The POST loads the raw ignored names
    (DISTINCT `company_name_raw`, most recent first, capped ~20) for the prompt and passes them
    to the builders. Hints reduce waste; the post-extraction filter enforces the rule.
  - *Count chip payload*: each emitted suggestion carries an additive optional field
    `ignore_count?: number` — the count of ignore events for its key when the key has exactly
    one event (keys with ≥2 never reach the response). Zero extra queries: the suppression query
    already groups counts; counts of 1 come from the same scan.
- **Master-proposals GET** (`target-proposals/route.ts:40-65`): the same
  `suppressedProposalKeys(db, oppId)` filters `suggestions` by
  `!suppressed.has(companyKey(c.name_ko))` (replacing the bare `names.has` exact match per
  §3.6). The response shape is unchanged — no chip on master chips in v1 (§8).
- Threshold check lives ONLY in `suppressedProposalKeys` — one place owns "what counts as
  suppressed".

### 3.5 UI — persist then remove, plus the one-ignore chip (E)

- `useBrownfieldBase.ts` gains `ignoreProposal(companyName: string)`: POST
  `/api/brownfield/${opportunityId}/target-proposals/ignore` with `{ company_name }`; on success
  it performs the existing local removal (`setWebProposals` filter — the current `:153-155`
  behavior); on failure it surfaces the error through the existing `setError` path and leaves
  the card in place (a failed persist must not silently discard the user's dismissal).
  `DiscoveryPanels.tsx` swaps the inline filter (`:153-155`) for the
  `ignoreProposal(s.company_name)` call (`:157` label unchanged).
- **One-ignore chip**: proposal cards render
  `{s.ignore_count != null && s.ignore_count >= 1 && (<span className="status-chip status-not-started">{t("ignoredCountChip", { count: s.ignore_count })}</span>)}`
  beside the existing confidence chip (`DiscoveryPanels.tsx:103-115` area). Text carries the
  status ("Ignored 1 time" — Korean copy, translated); color is never the only signal. Locale keys land in
  `stages.s67.discoveryPanels` of both `locales/en.json` and `locales/ko.json` (house
  convention: English key, Korean value in ko.json).
- `WebProposalResponse` (`types.ts:82`) gains the optional `ignore_count?: number` on its
  suggestion type. No other client state changes.

### 3.6 Existing-name filter hardening (G — included in this change)

The two exact-string existing-name matches switch to the same key comparison — the same
matching problem, one helper serving both, small and testable:

- `synthesisFallback` (`web-search/route.ts:80`):
  `!existingNames.includes(c.name_ko)` → key-set comparison
  (`!existingKeys.has(companyKey(c.name_ko))`, the key set built once from `existingNames`).
- Master GET (`target-proposals/route.ts:60`): `names.has(c.name_ko)` → the same key-set check
  merged with the suppression check (one pass, two sets).
- The extractors' `isSimilar` dedupe against `seen` stays unchanged — it is the wider net that
  keeps near-duplicate names out of one response, and it never silently excludes candidates from
  future generations.

### 3.7 openapi registration (same change, drift gate)

`/api/brownfield/{oppId}/target-proposals/ignore` → `post`, `operationId:
ignoreBrownfieldTargetProposal`, summary "Persist an ignore event for a proposed candidate
(analyst+; count-based suppression at 2, audited target_proposal.ignore).", tags `[Analysis]`,
responses `201 Created / 400 BadRequest / 401 Unauthorized / 403 Forbidden / 404 NotFound` —
placed adjacent to the two existing proposal paths (`openapi.yaml:7922-7984`).

## 4. Alternatives considered

| # | Alternative | Why rejected |
|---|---|---|
| 1 | Threshold 1 (ignore once, never return) | The user stated "2 or more times"; one accidental click must not permanently silence a candidate. The chip (§3.5) makes the two-click path deliberate. |
| 2 | Boolean flag row (UNIQUE (opportunity, key), `ignored_at` stamp + UPDATE on re-ignore) | Cannot represent "ignored twice" as the user's rule requires, hides the 1-ignored state the chip needs, and adds an UPDATE path to an audit-style record. Count-of-events is the direct encoding of the stated rule. |
| 3 | Suppress on `isSimilar` (fuzzy) | `isSimilar`'s substring/Jaccard matching is right for list dedupe but wrong for exclusion: key `Samsung` would silence `Samsung Electronics` forever (company names romanized from the Korean examples). False suppression is strictly worse than recurrence — exact key equality only (v1 tradeoff recorded). |
| 4 | Per-user suppression (`ignored_by` in the match) | Proposals are shared deal-flow artifacts; one analyst's dismissal silencing the candidate for the whole opportunity review is the consistent reading. `ignored_by` is still recorded for audit. |
| 5 | Workspace-global suppression | Market scope differs across opportunities; a company irrelevant to deal A may be core to deal B. The user's rule addresses repeated proposals within one deal flow. |
| 6 | Prompt-hint-only suppression (no post-extraction filter) | Prompt hints are advisory — the model can emit an excluded name. The requirement is a hard guarantee; the hint is belt-and-suspenders. |
| 7 | Client-only ignore list (localStorage) | Breaks on any other device/session, no audit trail, invisible to server-side generation. |
| 8 | Dedupe ignore clicks within a generation (client or server) | Moot: extractors already dedupe names within one response (`seen` + `isSimilar`), and the UI removes the card on ignore, so one click per name per generation is structurally guaranteed; cross-generation repeats are exactly what the rule counts. |
| 9 | Defer the existing-name exact-match hardening (G) | Same defect family (name variants defeat exact match), one helper serves both, marginal added test surface — deferred work is paid twice. |
| 10 | Un-ignore UI + delete route in v1 | Out of scope by ruling (DEC-20261113-04); the append-only event model has no UPDATE/DELETE path in application code; removal is a manual DB op if ever needed. |

## 5. Acceptance criteria (testable)

1. **Persist**: POST `/api/brownfield/{oppId}/target-proposals/ignore` with `{ company_name:
   "(Ju)Hanyang" }` (analyst cookie; company names romanized from the Korean examples) → 201, body `{ company_key: "Hanyang" }`-equivalent (post-strip
   key), `ignore_count: 1`; a row exists with `company_name_raw = "(Ju)Hanyang"`, `ignored_by` set;
   an `audit_log` row with action `target_proposal.ignore` and target `{oppId}:{key}` exists.
2. **Count accumulation**: ignoring `jusikhoesa Hanyang` then `Hanyang(Ju)` in the same opportunity →
   both map to one key; second response `ignore_count: 2`; row count 2.
3. **Role gate**: viewer cookie → 403 `role_required`; unknown opportunity → 404 (not 403);
   blank `company_name` → 400 `company_required`.
4. **Suppression at 2**: with 2 ignore rows for key K, the web-search POST response contains no
   candidate whose `companyKey` equals K (verified with a stubbed extraction returning K's
   variants `Hanyang` / `(Ju)Hanyang`); with exactly 1 row, K appears AND carries
   `ignore_count: 1`; with 0 rows it appears with no `ignore_count` field.
5. **Prompt hint**: when ≥1 ignore event exists for the opportunity, `buildPrompt` /
   `buildKnowledgePrompt` output contains the ignored raw name under the re-proposal-prohibited
   block (Korean copy, translated);
   with none, the block is absent (pure-function pins).
6. **Master GET suppression**: the same 2-ignore key K is absent from
   `GET /api/brownfield/{oppId}/target-proposals` suggestions while a K-variant md_company row
   exists; a key with 1 ignore still appears there (no chip required).
7. **Key normalization**: `companyKey` table-driven pins — `(Ju)Hanyang`, `Hanyang(Ju)`,
   `jusikhoesa Hanyang`, `jusikhoesaHanyang`, `Hanyang jusikhoesa`, `㈜Hanyang`, `Hanyang(Guwon)`, ` Hanyang ` all equal
   `companyKey("Hanyang")` (company names romanized from the Korean examples); `"Hanyang"` ≠ `companyKey("Hanyang Electronics")` (no fuzzy); `"(Ju)"` → empty key
   (reject path).
8. **Existing-name hardening**: with `brownfield_target` row `jusikhoesa Hanyang`, the master GET and
   `synthesisFallback` no longer propose `Hanyang(Ju)` (old code: they would); an unregistered
   `Hanyang Electronics` still passes.
9. **UI**: clicking the ignore button (Korean label, translated) calls the ignore route, then removes the card; a failed call keeps the
   card and shows the error; a card with `ignore_count ≥ 1` renders the "Ignored 1 time" text chip (Korean copy, translated);
   locale keys present in both en.json and ko.json (i18n lint green).
10. **Boundary**: an ignore in opportunity A does not suppress the same key in opportunity B
    (per-opportunity isolation pin).
11. **Schema**: migration 0192 applies cleanly on a fresh DB and on a DB migrated to 0191;
    table has no unique constraint on `(opportunity_id, company_key)`; rollback SQL in the
    header is valid.
12. **Standard gates**: `bun run test:unit`, `bunx tsc --noEmit` (web), `biome ci --changed`,
    design-lint, `lint:i18n`, and the openapi drift gate all green.

## 6. Touched files

- `db/migrations/0192_target_proposal_ignore.sql` — NEW, table + index (§3.1).
- `app/web-next/lib/name-similarity.ts` — `companyKey()` added (§3.2); `normalizeName`/`isSimilar` unchanged.
- `app/web-next/lib/brownfield-proposal-ignore.ts` — NEW: threshold constant, `recordProposalIgnore`, `suppressedProposalKeys`, ignored-raw-names loader (§3.1, §3.4).
- `app/web-next/app/api/brownfield/[oppId]/target-proposals/ignore/route.ts` — NEW POST route (§3.3).
- `app/web-next/app/api/brownfield/[oppId]/target-proposals/web-search/route.ts` — suppression filter on all three extractors, prompt-hint parameter, `ignore_count` on suggestions, key-based existing-name check (§3.4, §3.6).
- `app/web-next/app/api/brownfield/[oppId]/target-proposals/route.ts` — GET suppression + key-based existing-name check (§3.4, §3.6); POST untouched.
- `docs/architecture/openapi.yaml` — new path block (§3.7).
- `app/web-next/components/stages/brownfield/useBrownfieldBase.ts` — `ignoreProposal` (§3.5).
- `app/web-next/components/stages/brownfield/DiscoveryPanels.tsx` — ignore button wires the route; one-ignore chip (§3.5).
- `app/web-next/components/stages/brownfield/types.ts` — `ignore_count?` on the suggestion type (§3.5).
- `app/web-next/locales/en.json`, `app/web-next/locales/ko.json` — `stages.s67.discoveryPanels.ignoredCountChip` (§3.5).
- Tests (§7).

## 7. Test plan (house patterns: scratch SQLite + next-route-dispatch route suites, pure-function pins, renderToStaticMarkup)

- `tests/unit/company-key.test.ts` — NEW: the §5.7 table-driven `companyKey` pins (variants
  collapse, no-fuzzy pin, empty-key pin); `normalizeName`/`isSimilar` regressions untouched.
- `tests/unit/proposal-ignore-suppress.test.ts` — NEW: `suppressedProposalKeys` threshold
  (0/1/2 events → absent/present+chip field/filtered), per-opportunity isolation (§5.10),
  accumulation across name variants (§5.2), no-unique-constraint insert (§5.11 partial).
- `tests/unit/proposal-ignore-route.test.ts` — NEW route suite on the
  `external-reference-supersede.test.ts` pattern: scratch DB + `runMigrations` +
  `next-route-dispatch`, analyst/viewer roles — the §5.1/5.2/5.3 contract pins (201 + row +
  audit action `target_proposal.ignore`; 403 viewer; 404 unknown opp; 400 blank name).
- `tests/unit/web-search-proposals.test.ts` (existing suite extended, `CO_NEWBIZ_LLM_PROVIDER =
  "none"` guard kept) — extractor suppression pins: stubbed LLM responses naming a suppressed
  key's variants are filtered at 2 events, pass with `ignore_count: 1` at 1 event; prompt
  builder hint block present/absent (§5.4, §5.5); `synthesisFallback` key-based existing-name
  check (§5.8).
- `tests/unit/brownfield-target-proposals.test.ts` (existing master route suite extended) —
  GET suppression + key-based dedupe vs a seeded `brownfield_target` variant name (§5.6, §5.8).
- `tests/unit/discovery-panels-render.test.ts` — NEW render pins (house
  `renderToStaticMarkup` under `NextIntlClientProvider`): one-ignore chip markup with text
  "Ignored 1 time" (Korean copy, translated), absent at `ignore_count` undefined; ignore button calls the injected
  `ignoreProposal` (source-assertion pin for the `DiscoveryPanels.tsx` wiring replacing the
  inline filter).
- Full gates per AC-12.

## 8. Out of scope / non-goals

- **No un-ignore UI and no delete/update path** on the ignore table in application code (v1
  boundary; removal is a manual DB op if ever needed — recorded in DEC-20261113-04).
- **Per-opportunity scope only** — no workspace-global ignore register (§4.5).
- **Competitor domain untouched**: `lib/competitor-web-proposals.ts` (ADR-0142) keeps its own
  ladder with no ignore surface; extending the pattern there is future work for that domain's
  owner.
- **No change to the accept path** (`findDuplicateTarget`, `createTarget`,
  `target_proposal.accept` audit) and no change to `brownfield_target` schema — accepted
  candidates are governed by the existing Long List lifecycle (shortlist/exclude), not by the
  ignore register.
- **No chip on master-suggestion chips in v1** — they render as compact `control-chip` buttons
  (`UniverseSection.tsx:130-137`) where a count chip would clutter; suppression already applies
  there, and the chip's job (make the second ignore deliberate) belongs where the ignore button
  lives.
- **No change to ADR-0118 extraction contracts** — evidence-citation rules, source labeling,
  reliability grades, and the fallback ladder are untouched; suppression composes after
  extraction.

## 9. Accessibility

- The ignore button (Korean label, translated) keeps its existing button semantics and `title` (`:152`); it remains keyboard
  operable via native `<button>` (no new focus traps — the modal's existing
  `useModalFocus`/Esc behavior is unchanged).
- The one-ignore chip is a text span ("Ignored 1 time" — Korean copy, translated) — status is never conveyed
  by color alone; it inherits the existing `status-chip` contrast pair.
- Error feedback for a failed ignore persist goes through the panel's existing `setError`
  text path (announced as page text, not color-only).
- No motion, no timed behavior, no new touch-target changes; verification is the render pins in
  §7 plus the standing design-lint gate.
