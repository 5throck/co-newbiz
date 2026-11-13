# Design: company-profile headless-Chrome search fallback + DART-grounded content separation

- **Date**: 2026-11-13
- **Status**: implemented (spec registered at landing — registry id `2026-11-13-profile-headless-fallback-design`, source manual, status implemented, see `docs/specs/registry.json`)
- **Decision of record**: [DEC-20261113-06](../decisions/DEC-20261113-06.md) (Row 0, non-exempt)
- **Owner**: backend-engineer (dispatched by pm under ADR-0074); UI consumption touches reviewed by frontend-engineer
- **Scope**: docs only in this deliverable; implementation lands through the normal QA-gated PR

## 1. Conclusion (first)

1. The profile pipeline's step 2 gains the **chain-integrated Playwright headless fallback** — one added options object on the existing `researchSourcesDetailed` call (`{ playwright: true, deadlineAt, playwrightQueries: 2 }`). When every configured provider (Tavily, Brave, Serper, DuckDuckGo) returns nothing because of quota/bot-block, the pipeline now runs a headless-Chrome DuckDuckGo search before declaring the no-search-evidence degraded reason (the Korean prefix literal pinned as NO_RESEARCH_DEGRADED_PREFIX in profile-degraded.ts — Korean copy, translated: "no external search evidence"). Sources from headless search flow through the SAME `research` array, so citations, `researchSources`, `webResearchCount`, and downstream classification (holding-check "researched") all work unchanged.
2. The degraded message is **split honestly**: when DART succeeded, the degraded reason now states it — `<unchanged no-search-evidence prefix> (…provider causes…) — DART financials retrieved successfully (2019 / 2020 / … / 2023, 40 accounts): the financial analysis is disclosure-based and kept; only the qualitative items (strengths, weaknesses, SWOT, competition) are AI estimates and unverified` (Korean copy, translated — the shipped literal lives in profile-degraded.ts). The chip label distinguishes the two worlds: "No search evidence — financial analysis is disclosure-based; qualitative items unverified (AI estimates)" (Korean copy, translated) vs the existing wording when DART is also missing. This is the Taeung fix (company name romanized from the Korean source material): the user must never again read "DART AND market research failed" when only web search failed.
3. Financial grounding becomes **visible per item**: step 3 finally receives the actual financial figures (today it gets only an account count — `company-profile-pipeline.ts:465`), and tags each strength/weakness/opportunity/threat item `financial | estimate`. Financial-grounded items render a "financial-grounded" chip (Korean copy, translated); unmarked items stay the existing speculative presentation.
4. Nothing structural changes: `degraded` stays a string (prefix unchanged), payload arrays stay `string[]`, `schemaVersion` stays 3 with additive optional fields, the append-only version store, ADR-0132 guard, DART fetch, cross-check, and RAG-cap logic are untouched.

## 2. Requirement trace

| # | User requirement (PM-recorded 2026-11-13) | Where satisfied |
|---|---|---|
| 1 | Full web-search block → headless-Chrome fallback before degraded | §4 (D-A): `researchSourcesDetailed` playwright option in step 2 |
| 2 | DART-based content REFLECTED and DISTINGUISHED from speculative content when web search fails | §5 (D-B): degraded message split; §6 (D-C): per-item "financial-grounded" chip (Korean copy, translated) + financial block in the step-3 prompt |

## 3. Current state (KNOWN — all file:line verified on the working tree, 2026-11-13)

### KNOWN

- **Step 2 research chain** (`app/web-next/lib/company-profile-pipeline.ts:401-457`): calls `researchSourcesDetailed([...5 queries...], 12)` with NO playwright option; 0 sources + no usable analyst evidence ⇒ `noResearchDegradedReason(providerFailureCauses(researchProviders), isWebResearchConfigured())` (`:438-441`).
- **Step 3 receives no financial values** (`company-profile-pipeline.ts:465`): the qualitative prompt carries only `DART financials: <year> financials, <n> accounts` (Korean copy, translated) — an account count. SWOT items are plain strings with optional `[n]` research citations; the only per-item provenance today is user-evidence citations (`userCitationEvidence`, `:255-270`).
- **Degraded assembly** (`:486`, `:502`, `:514-516`): LLM-parse failure and no-research reasons are kept separate (`llmDegraded` vs `noResearchReason`) and merged into the single `degraded` string.
- **ADR-0132 guard** (`:819-824`): throws to protect a previously healthy profile ONLY on `llmDegraded`; `noResearchReason` never blocks a new version.
- **RAG cap** (`:740-752`): amber rationale for the degraded case already says "Disclosure-based DART + qualitative items are unverified AI estimates without search evidence" (Korean copy, translated) — unchanged by this design.
- **Payload/dataSources** (`:785-792`): `{ dart, dartYear, webResearchCount, userSourceCount?, userSources?, analystNote? }`; wrapper `{ methodology: "company-profile v3", schemaVersion: 3, profile }` (`:846`).
- **Playwright chain support already exists** (`app/web-next/lib/web-research.ts`): `ResearchOptions.playwright/playwrightQueries/deadlineAt` (`:400-407`); the playwright provider runs only when everything before it found nothing (`:425-429`) with `PLAYWRIGHT_MIN_REMAINING_MS = 8_000`; opt-out `isPlaywrightProviderEnabled()` reads `WEB_SEARCH_PLAYWRIGHT_ENABLED` and is OFF under `NODE_ENV=test` unless the test override is set (`:187-193`); one-browser-at-a-time queue (`:195-206`); circuit breaker shared with all providers; `playwrightSearchDetailed` returns statuses `ok|empty|unavailable|blocked` and uses CHROME_PATH or the platform Chrome default (`app/web-next/lib/playwright-search.ts:22-35, 81-137`).
- **The integrated precedent**: `app/web-next/lib/capability-holding-check.ts:63-77` passes `{ playwright: true, deadlineAt }` with a probe query and `allProvidersUnavailable` fail-fast — this is the pattern to follow, not the older manual pattern.
- **The older manual pattern + provenance note** (`app/web-next/app/api/brownfield/[oppId]/target-proposals/web-search/route.ts:242-273`, mirrored in `competitor-web-proposals.ts:161-180`): explicit `playwrightSearch()` after `researchSourcesDetailed`, with note "Web search quota was exceeded — evidence was secured via Playwright headless search; always verify the source URLs." (Korean copy, translated)
- **Degraded consumers** (`app/web-next/lib/profile-degraded.ts:1-25`): the no-search-evidence prefix (Korean copy, translated) checked by `showDegradedChip` (`ProfileChips.tsx:11-13` — suppressed when analyst evidence exists), `profile-analyst-edit.ts:237` (clears `degraded` when analyst adds evidence), and holding-check evidence labelling via `profileEvidence` (`capability-holding-context.ts:48-84`).
- **Downstream "researched" classification** (`capability-holding-context.ts:51`): `researched = webResearchCount > 0 || non-provided researchSources exist || user-backed` — headless sources naturally flip a profile to citable "[search-evidence-based]" (Korean copy, translated), matching the brownfield semantics (real URLs were obtained).
- **UI chips** (`ProfileChips.tsx:27-37`, `ProfileReport.tsx:22-28`, `TargetAiProfileTab.tsx:32-35`): header row already renders `DART {year}` (green) and an "external research: N items" chip (Korean copy, translated) next to `DegradedChip`; the chip wording lives in `profile-degraded.ts` (rendered verbatim in both locales, not i18n-keyed).
- **SWOT tab** (`ProfileBasicTabs.tsx:70-139`): plain bullet strings; a per-item chip precedent exists (`AnalystEditedChip` via `isEditedItem`, `:93, :107`).
- **Structural test pins** (`tests/unit/capability-ai-sources.test.ts:679-712`): exact `noResearchDegradedReason` output, source-containment assertions on the pipeline ("degraded = degraded ?? noResearchReason", "0 sources — ${noResearchReason}" (Korean copy, translated)) and the three DegradedChip render sites. `tests/unit/profile-user-evidence.test.ts` pins `degraded` starting with the no-search-evidence prefix (Korean copy, translated) in the offline path.
- **Prompt SSOT**: `app/web-next/prompts/prompts.json` (`company_profile.qualitative`, agent financial-analyst) → regenerated into `prompts.generated.ts` by `scripts/co-newbiz/generate-prompt-registry.ts`. The system prompt already instructs "Derive strengths and weaknesses from the financial data" — but the caller never supplies any values.
- **Env documentation**: root `.env.sample:100-106` documents `CHROME_PATH` / `WEB_SEARCH_PLAYWRIGHT_ENABLED`; `lib/root-env.ts:40-41` loads them from the root env.

### INFERRED (reasoned from the code above)

- Adding `playwright: true` to the step-2 call is sufficient for the fallback to engage in exactly the fully-blocked case: the chain's playwright branch runs only when `merged.length === 0` after the base chain (`web-research.ts:427`), and the existing per-provider diags/circuit-breaker machinery records the outcome with zero new plumbing.
- Headless success makes `noResearchReason` null (sources > 0) and `webResearchCount > 0`, so the profile is NOT degraded and downstream holding-check treats it as researched — the honest outcome, since real URLs were collected and are displayed in the sources tab.
- The step-2 override used by existing tests (`setWebResearchOverrideForTests`, `web-research.ts:411`) short-circuits BEFORE the provider chain, so current pipeline tests stay green after the change.

### ASSUMED

- A 30 s search deadline is acceptable for a fire-and-forget pipeline job (the holding-check uses 40 s with 4-way concurrency; the profile pipeline is sequential and background).
- Two Playwright queries (top two of the five: analyst-report KR, analyst-report EN) is a sufficient headless budget — a browser session is slow and DuckDuckGo HTML is the gentlest target.
- The user reads the profile header chips and the SWOT tab; the degraded banner shown in the Taeung case came from `DegradedChip` (title + label), which is where the rewording must land.

### UNKNOWN (explicitly open)

- Whether operators expect the headless rescue in the search-UNCONFIGURED branch (no keys + DDG off). Out of scope in v1 (see §7); if wanted later it is a one-line branch change plus test updates.
- Real-world DuckDuckGo headless success rate under sustained bot pressure — mitigated by honest statuses (`blocked`) flowing into the same provider diagnostics.

## 4. D-A — Headless fallback integration point and semantics

**Integration point**: step 2 of `runCompanyProfilePipeline` (`company-profile-pipeline.ts:404-417`).

```ts
const PROFILE_SEARCH_DEADLINE_MS = 30_000;
const PROFILE_PLAYWRIGHT_QUERIES = 2;

if (isWebResearchConfigured()) {
  const detailed = await researchSourcesDetailed(queries, 12, {
    playwright: true,
    deadlineAt: Date.now() + PROFILE_SEARCH_DEADLINE_MS,
    playwrightQueries: PROFILE_PLAYWRIGHT_QUERIES,
  });
  research = detailed.sources;
  researchProviders = detailed.providers;
}
```

**Semantics** (all inherited from the existing chain, nothing new to implement in web-research.ts):

1. **Engages only after full block**: the playwright provider runs only when the base chain produced zero merged sources (`web-research.ts:425-429`), which happens exactly when every provider is quota-exceeded, bot-blocked, errored, or empty-and-circuit-open.
2. **Opt-out respected**: `WEB_SEARCH_PLAYWRIGHT_ENABLED=false` (or test defaults) makes `isPlaywrightProviderEnabled()` false → the provider reports status `disabled` in the diags and never launches. `CHROME_PATH` / platform-default Chrome handled by `playwright-search.ts:24-35`. No Chrome → status `unavailable`, surfaces in `providerFailureCauses` as "Playwright unavailable (Chrome missing or launch failed)" (Korean copy, translated).
3. **Same flow for headless sources**: they enter `research` as ordinary `WebSource`s → stored in `researchSources` (non-provided), counted in `webResearchCount`, citable as `[n]` in step 3/4, and flip holding-check's `researched` classification. Citations and degraded logic work unchanged.
4. **Provenance (brownfield searchNote pattern, adapted)**: after the chain call, if the playwright diag has status `ok`:

   - step-2 summary gains: "Evidence was secured via Playwright headless search after the provider failures — always verify the source URLs." (Korean copy, translated; prefixed with the provider failure causes already in `researchProviders`);
   - payload gains `dataSources.webResearchPlaywright?: boolean = true` (additive);
   - the profile header chips gain one span "headless search" (Korean copy, translated; status-in-progress class) when the flag is set — the user-visible provenance, replacing the brownfield route's `note` field which the profile payload has no slot for.

5. **Deadline**: 30 s from step-2 start. The chain checks `PLAYWRIGHT_MIN_REMAINING_MS = 8 s` before starting a browser session; a session already started is bounded by its per-goto 20 s timeouts. Worst added latency ≈ 30-40 s on a fire-and-forget job — acceptable; the UI already polls job status.
6. **Degraded outcome unchanged when headless also fails**: diags gain `playwright: blocked|unavailable|empty`; `providerFailureCauses` then lists e.g. "Tavily quota exceeded (432), Brave Search quota exceeded (429), DuckDuckGo bot-blocked, Playwright bot-blocked" (Korean copy, translated) — a strictly more truthful banner than today's.

**Rejected alternative** (recorded in DEC-20261113-06): the brownfield route's manual `playwrightSearch()` after the chain — it bypasses provider diagnostics, the single-browser queue, and the circuit breaker; the holding-check (`capability-holding-check.ts:63-65`) is the newer precedent and is what we follow.

## 5. D-B — Degraded message split (DART success vs web-research failure)

**Carrier decision**: `degraded` stays `string | null`. The no-search-evidence prefix (Korean copy, translated) is load-bearing for four downstream consumers (chip suppression, analyst-edit clearing, holding-check evidence labels, structural tests) — all keep working untouched.

**Change in `app/web-next/lib/profile-degraded.ts`**:

```ts
export interface DartGroundingInfo { found: boolean; years: string; accounts: number }

export function noResearchDegradedReason(
  causes: string[],
  searchConfigured: boolean,
  dart?: DartGroundingInfo,
): string
```

- With `dart.found === true`:

  `<unchanged prefix> (Tavily quota exceeded (432), Brave Search quota exceeded (429), DuckDuckGo bot-blocked) — DART financials retrieved successfully (2019 / 2020 / 2021 / 2022 / 2023, 40 accounts): the financial analysis is disclosure-based and kept; only the qualitative items (strengths, weaknesses, SWOT, competition) are AI estimates and unverified` (Korean copy, translated — shipped literal in profile-degraded.ts)

- Without DART (`dart` absent or `found === false`): the current wording unchanged — in that world "no grounds at all" is true and the message should not soften.
- Call site (`company-profile-pipeline.ts:438-441`) passes `{ found: dart.found, years: yearsFound.join(" / "), accounts: dart.items.length }` (all three already computed in step 1). Step-2 summary and the no-DART ragCap rationale are untouched.

**Chip wording** (`degradedChip` gains an optional second parameter; `DegradedChip` an optional prop `dartGrounded`):

- dartGrounded: label "No search evidence — financial analysis is disclosure-based; qualitative items unverified (AI estimates)" (Korean copy, translated), hint unchanged ("Re-analyze and regenerate the profile once search recovers." — Korean copy, translated);
- otherwise: existing label/hint exactly.

The three render sites (`ProfileChips.tsx:34`, `ProfileReport.tsx:27`, `TargetAiProfileTab.tsx:34`) pass `profile.dataSources?.dart === true`. The full reason remains the chip's `title` tooltip, so the year/account detail is one hover away. The green `DART {year}` chip already beside it now agrees with the banner instead of contradicting it.

**Rejected alternative**: structured `degraded: { dart: {ok, years, accounts}, webResearch: {ok, causes} }` — touches the payload type, every renderer, historical-payload readers, and the analyst-edit clearing logic, for information the string already carries. Recorded in DEC-20261113-06.

**Test pins to update in the same change**: `capability-ai-sources.test.ts:681-684` (exact string) gains the dart-parameter variants; the source-containment assertions (`:692-699`) gain `noResearchDegradedReason(providerFailureCauses(researchProviders), isWebResearchConfigured(), dartGrounding)`; `profile-user-evidence.test.ts` prefix assertions are unchanged (offline path has no DART).

## 6. D-C — Per-item financial grounding labels

**Problem**: step 3 cannot ground anything in DART because it never sees DART values (`company-profile-pipeline.ts:465` passes only a count). Requirement 2 says financial-data-based content must be REFLECTED — that requires feeding the numbers first.

**Mechanism (LLM tag, not text-match heuristic)**:

1. **Compute early**: move `const financialAnalysis = deriveFinancialAnalysis(dart)` above step 3 (pure function, currently computed at `:590`; no behavioral change, reused at its existing site).
2. **Compact financial block in the step-3 user prompt** (only when `dart.found`), deterministic and bounded (~≤700 chars): per-year revenue / operating profit / net profit, plus revenue growth, operating margin, ROE, debt ratio from `financialAnalysis.ratios`, and the coverage note. Labeled "DART disclosure financials (verified raw data — the figures in this block are citable)" (Korean copy, translated).
3. **Prompt contract extension** (prompts.json `company_profile.qualitative` + regenerate `prompts.generated.ts`): items carry a basis tag —

   ```json
   {"strengths":[{"t":"…","b":"financial"}],"weaknesses":[…],"opportunities":[…],"threats":[…],
    "businessAssessment":"…","industryExposure":["…"]}
   ```

   `b` (basis): `"financial"` when the item is derived directly from the DART block's figures; `"estimate"` otherwise (research excerpt, analyst evidence, or LLM knowledge). Instructions state the rule and that items citing research excerpts keep the `[n]` citation as today.

4. **Normalization (pure function, exported for tests)**: objects with a non-empty `t` string are accepted; `b` whitelisted to `financial|estimate`, anything else → `estimate`; bare strings accepted as today with `estimate`. The payload keeps `strengths: string[]` etc. UNCHANGED (text only) and gains:

   ```ts
   /** Per-item grounding tag (additive, schemaVersion 3 compatible). Index-aligned with the item arrays. */
   itemBasis?: {
     strengths?: Array<"financial" | "estimate">;
     weaknesses?: Array<"financial" | "estimate">;
     opportunities?: Array<"financial" | "estimate">;
     threats?: Array<"financial" | "estimate">;
   }
   ```

5. **UI** (`ProfileBasicTabs.tsx` SWOT tab, strengths/weaknesses lists): when `profile.itemBasis?.<field>[i] === "financial"` AND `profile.dartFinancials?.available`, render a `status-chip status-green` span with the financial-grounded chip copy (Korean copy, translated; shipped verbatim as the ko.json value) next to the bullet (after the existing `AnalystEditedChip`). Locale keys: `financialGroundedChip` = the Korean financial-grounded copy (Korean copy, translated here) / "Financial-grounded" (en) under `components.ourCompany.profileBasicTabs`.
6. **Ledger honesty**: strengths/weaknesses verification-ledger entries (`company-profile-pipeline.ts:687-706`) keep `needs_judgement` for financial-grounded items (LLM inference from verified data is not a confirmed disclosure fact — non-negotiable #4), but the evidence text becomes "Financial-grounded — derived from the {years} DART financials (LLM inference)" (Korean copy, translated) instead of "LLM estimate — analyst confirmation needed" (Korean copy, translated).
7. **Analyst edits**: when `profile-analyst-edit.ts` saves an edit touching `strengths`/`weaknesses`, the corresponding `itemBasis` entry for an edited index is reset to `"estimate"` (a human-rewritten item is no longer machine-grounded; the edit is already flagged by `analystEdited`/`AnalystEditedChip`). Old payloads without `itemBasis` render unchanged.

**Rejected alternative**: heuristic tag by matching DART metrics in item text — impossible today (no values in the prompt) and fragile tomorrow. Recorded in DEC-20261113-06.

## 7. D-D — What does NOT change

- Step 1 DART fetch, corp-code validation, and cross-check persistence (`:352-399`).
- Step 5 disclosure/research cross-check and verdict mapping (`:568-587`).
- ADR-0132 guard semantics (`:819-824`) — only `llmDegraded` blocks a new version.
- RAG cap structure and grades (`:740-752`); the degraded-case rationale text stays as-is.
- Append-only versioning, `schemaVersion: 3`, and the stored wrapper shape — all additions are optional fields.
- Both brownfield/holding-check web-search routes and `web-research.ts`/`playwright-search.ts` (the design only consumes their existing options).
- `webResearchCount` semantics: counts headless-sourced sources like any other source (by design — they are real sources; provenance is carried by `webResearchPlaywright`).
- The search-UNCONFIGURED branch (`isWebResearchConfigured() === false`) still skips research entirely; the degraded reason keeps the unconfigured-search cause ("web search not configured" — Korean copy, translated). Extending headless-first there is explicitly deferred.

## 8. Touched files (implementation PR)

| File | Change |
|---|---|
| `app/web-next/lib/company-profile-pipeline.ts` | Step-2 chain options + deadline const; step-3 financial block + basis normalization (exported pure fn); `noResearchDegradedReason` dart arg; `itemBasis` + `dataSources.webResearchPlaywright` payload fields; ledger evidence wording; step-2 summary provenance note |
| `app/web-next/lib/profile-degraded.ts` | `DartGroundingInfo`, dart-aware `noResearchDegradedReason`, dartGrounded-aware `degradedChip` |
| `app/web-next/components/stages/our-company/ProfileChips.tsx` | `DegradedChip` optional `dartGrounded` prop; `ProfileChips` passes it; headless provenance chip |
| `app/web-next/components/stages/our-company/ProfileReport.tsx` | Pass `dartGrounded` to `DegradedChip`; provenance chip in header row |
| `app/web-next/components/brownfield-target/TargetAiProfileTab.tsx` | Pass `dartGrounded` to `DegradedChip`; provenance chip |
| `app/web-next/components/stages/our-company/ProfileBasicTabs.tsx` | Per-item "financial-grounded" chip (Korean copy, translated) in SWOT + strengths/weaknesses lists |
| `app/web-next/components/stages/our-company/types.ts` | `Profile.itemBasis?`, `dataSources.webResearchPlaywright?` |
| `app/web-next/lib/profile-analyst-edit.ts` | Reset edited indexes' `itemBasis` to `estimate` |
| `app/web-next/prompts/prompts.json` + `prompts.generated.ts` (regenerated via script) | `company_profile.qualitative` basis-tag contract |
| `app/web-next/locales/en.json`, `ko.json` | `financialGroundedChip`, headless provenance chip label (en+ko) |
| `tests/unit/capability-ai-sources.test.ts` | B5 exact-string pins updated (prefix assertions kept) |
| `tests/unit/profile-headless-fallback.test.ts` (new) | Test plan §9 cases 1-6 |
| `docs/architecture/api-spec.md` | One-line payload addition note for the company-profile GET payloads (degraded wording + additive fields), matching the ADR-0172 amendment documentation style |

No DB migration; no openapi route addition (payload-only, documented in api-spec prose).

## 9. Test plan (house patterns)

Style per `docs/context.md` project testing notes: `bun run test:unit`, one process per file; module-mock snapshot discipline; `CO_NEWBIZ_LLM_PROVIDER=none` for route suites.

1. **Pure-function reason/chip variants** (extend `capability-ai-sources.test.ts` B5): `noResearchDegradedReason(causes, true, {found:true, years:"2019 / 2023", accounts:40})` starts with the unchanged prefix, contains the DART-success clause ("DART financials retrieved successfully" — Korean copy, translated), contains the causes, ends with the qualitative-only disclaimer; `found:false` returns exactly the current string; `degradedChip(r, true).label` contains the financial-analysis-is-disclosure-based fragment (Korean copy, translated); `degradedChip(r)` (legacy call) returns the existing label — backward-compatible signature verified.
2. **Chain integration** (`web-research-diagnostics.test.ts` style): `setWebProvidersForTests([quotaFailingProvider])` + `setPlaywrightSearchOverrideForTests([source1, source2])` → `researchSourcesDetailed(qs, 12, {playwright:true, deadlineAt: Date.now()+30_000, playwrightQueries:2})` returns the headless sources with diags `[tavily quota_exceeded, playwright ok]`; with the override returning `[]` and Chrome absent simulation, diags carry `playwright: unavailable` and `providerFailureCauses` includes the Playwright label. Reset both overrides in `afterAll` (snapshot discipline).
3. **Pipeline structural assertions** (house pattern, `capability-ai-sources.test.ts:691-699`): pipeline source contains `playwright: true`, the deadline const, `webResearchPlaywright`, and the dart-grounding call shape.
4. **Basis normalization pure function**: objects `{t, b:"financial"}` → text kept + basis kept; `b:"nonsense"` → `estimate`; bare strings → `estimate`; mixed arrays stay index-aligned; >5 items truncated exactly as the existing `arr()` does.
5. **End-to-end offline pipeline** (extend `profile-user-evidence.test.ts` harness): DART blank + search override empty → degraded string is the UNCHANGED no-DART wording (regression guard); UI structural assertions: `ProfileBasicTabs.tsx` renders the grounding chip only when `itemBasis` AND `dartFinancials.available` are present; locale keys exist in en+ko.
6. **Analyst-edit interaction** (extend the seeded-profile cases): editing strength #1 clears `itemBasis.strengths[0]`; `degraded` clearing behavior unchanged (`:237`).

Acceptance criteria (testable):

- **AC-1**: With all providers failing and Chrome available + flag on, a profile run stores `webResearchCount > 0`, `webResearchPlaywright: true`, `degraded: null`, and non-provided `researchSources` whose URLs come from the headless provider. (case 2 + 3)
- **AC-2**: With all providers failing and `WEB_SEARCH_PLAYWRIGHT_ENABLED=false` (or no Chrome), the degraded reason lists the base causes plus the Playwright cause, and no browser launch is attempted (override/spy asserts zero `playwrightSearchDetailed` calls). (case 2)
- **AC-3**: With DART found + search fully blocked + headless failed/off, the degraded string contains BOTH the provider causes AND the DART-success clause (Korean copy, translated); the chip label is the dartGrounded variant. (case 1, 5)
- **AC-4**: The offline no-DART path produces the exact current degraded string (regression). (case 5)
- **AC-5**: A step-3 response tagging an item `financial` yields that item with the "financial-grounded" chip (Korean copy, translated) in the payload/UI path and `needs_judgement` + the financial-grounded evidence line (Korean copy, translated) in the verification ledger. (case 4, 5)
- **AC-6**: Analyst edit of a financial-grounded item resets its basis to `estimate`. (case 6)

## 10. Accessibility

- New chips reuse the existing `status-chip status-green` / `status-in-progress` classes — contrast already token-governed; every chip carries a TEXT label (state never by color alone) and the grounding chip is inline text inside the bullet list (screen-reader order = item then chip, matching the existing `AnalystEditedChip` precedent).
- No new interactive elements; keyboard/contrast/motion unaffected. The degraded chip's detail remains available via the existing `title` attribute plus the visible hint on the report header (`showHint`), which is also programmatically associated text.

## 11. Design-system notes

- Pattern: P2 Report (existing profile report; no new screen). Reuses `status-chip` and `report-bullet-list` only — no new tokens or components; no new icons (text chips, no glyph additions). `design-lint` rules R1-R6 unaffected (no button size overrides, no hex colors, no `window.confirm`, no delete labels).

## 12. References

- ADR-0172 (holding assessment unification — degraded-profile semantics, "[verified]/[search-evidence-based]/[unverified]" labels (Korean copy, translated)), ADR-0093 (company-profile S1-level expansion — sectionConfidence/verificationLedger/RAG cap), ADR-0092 (verification ledger standard), ADR-0005 (run versioning / append-only), ADR-0074 (Design Gate), ADR-0098 (llm-interaction-standard — conclusion-first, KNOWN/INFERRED/ASSUMED/UNKNOWN)
- DEC-20261113-06 (Row 0 ruling, this design's decision of record)
- Design precedent: `docs/designs/2026-11-13-proposal-ignore-suppression-design.md` (same-day Row 0 format), `capability-holding-check.ts` (integrated playwright fallback precedent)
