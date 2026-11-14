# Design: S1 web-grounding quota-discarding defect fix + headless rescue wiring

- **Date**: 2026-11-14
- **Status**: implemented (spec registered — registry id `2026-11-14-s1-quota-rescue-design`, source manual, status implemented, see `docs/specs/registry.json`)
- **Decision of record**: [DEC-20261114-01](../decisions/DEC-20261114-01.md) (Row 0, non-exempt)
- **Owner**: backend-engineer (dispatched by pm under ADR-0074); no UI consumption touched
- **Scope**: one lib file (`market-sizing-pipeline.ts`), one new test file; no schema, no route, no UI

## 1. Conclusion (first)

1. **`quotaExceeded` becomes a cost/degradation signal, not an emptiness signal.** The S1 pipeline's shared search helper `quantitativeExcerpts` (app/web-next/lib/market-sizing-pipeline.ts:544-554) returned `[]` whenever `researchSourcesDetailed` reported `quotaExceeded === true` — even when the provider chain had just degraded to DuckDuckGo (or, once wired, headless Playwright) and returned perfectly good sources. Verified live on 2026-11-14: with Tavily at HTTP 432 and Brave at 429, the chain returned 5 relevant market-report sources (DDG ok, Serper no key) with `quotaExceeded: true`, and the S1 tiers threw all 5 away. The R4 CAGR-consensus tier (~:1162) and R5 forecast tier (~:1231) then saw zero excerpts, skipped their extraction calls, fell through to the honest LLM-prior tier (which correctly refuses to invent a consensus), so no `web_research` reference was ever captured and the top-down consensus stayed "not entered" (the Korean empty-value copy, translated: top-down consensus not entered) on every rerun. After this change the helper returns whatever sources the chain produced and returns `[]` only when the chain produced none. The original R7 guarantee is untouched: an empty chain still yields `[]`, the try/catch stays, and every caller degrades exactly as before (R1/R2/R9 capture paths unchanged — excerpts still feed `extractFromExcerpts`' per-item validation, so nothing unverified enters the matrix).
2. **The 2026-11-13-profile-headless-fallback §4 rescue extends to the S1 pipeline.** `quantitativeExcerpts` gains an optional `{ deadlineAt }` parameter; when present it passes `{ playwright: true, deadlineAt, playwrightQueries: 2 }` to `researchSourcesDetailed` — the same chain-integrated option object company-profile-pipeline.ts:519-533 passes (constants `PROFILE_SEARCH_DEADLINE_MS = 30_000` / `PROFILE_PLAYWRIGHT_QUERIES = 2`). The deadline is **run-scoped**: `runSteps` computes `webGroundingDeadline = Date.now() + SIZING_SEARCH_DEADLINE_MS` once and passes it to both web-grounding call sites (step 5 CAGR consensus, step 5-B forecast), so the total headless budget per analysis run is bounded to one 30 s window; `researchSourcesDetailed` enforces its internal `PLAYWRIGHT_MIN_REMAINING_MS = 8_000` guard (web-research.ts:408, 425-428), so a call that arrives with too little time left silently skips the browser session.
3. **Steps 2 and 4 benefit from fix 1 only.** The anchor (step 2, :935) and growth-context (step 4, :1052) call sites do not pass a deadline — they keep today's no-playwright behavior and simply stop discarding DDG sources. The headless browser remains reserved for the two tiers that own the top-down consensus entry.
4. **Nothing structural changes**: no renames, no signature breaks for the four call sites (the new opts parameter is optional), no payload shape change, no DB migration, no UI change. `quotaExceeded` continues to be reported truthfully by `researchSourcesDetailed` and consumed unchanged by every other caller (company-profile, brownfield routes, holding-check).

## 2. Requirement trace

| # | Requirement (PM-recorded 2026-11-14, verified by live diagnostic run) | Where satisfied |
|---|---|---|
| 1 | A paid-provider quota failure must not discard fallback-provider sources the chain actually found | §4 (D-A): consumption rule in `quantitativeExcerpts` + pure helper |
| 2 | The S1 pipeline gets the same headless-Chrome rescue the profile pipeline has, with a bounded per-run budget | §5 (D-B): run-scoped deadline + playwright options at the two R4/R5-B call sites |
| 3 | Honest provenance boundary unchanged — no unvalidated values enter the matrix, R1/R2/R9 untouched | §6 (D-C): excerpts still flow only through `extractFromExcerpts` validation |

## 3. Current state (KNOWN — all file:line verified on the worktree, 2026-11-14)

### KNOWN

- **The defect** (`market-sizing-pipeline.ts:548-549`): `const r = await researchSourcesDetailed(queries, EXCERPT_LIMIT); if (r.quotaExceeded) return [];` — the discard. The chain sets `quotaExceeded` whenever ANY provider reported quota_exceeded, including when later providers succeeded (web-research.ts:415, 422, 433 — the flag aggregates across the whole chain walk and is never cleared by subsequent success).
- **The chain already degrades correctly** (web-research.ts:410-441): Tavily → Brave → Serper → DDG walk with per-provider circuit breakers; `quotaExceeded` is carried alongside, not instead of, sources. Live diagnostic 2026-11-14 (quoted verbatim in the dispatch): `{ n: 5, quotaExceeded: true, providers: [tavily=quota_exceeded(432), brave=429, serper=no_key, ddg=ok], first: [imarcgroup/drones-market, marketresearchfuture/drones-market, technavio/drone-market…] }`.
- **Four call sites** of `quantitativeExcerpts`: step 2 anchor excerpts (:935, 3 queries), step 4 growth context (:1052, 2), step 5 CAGR consensus (:1162, 2), step 5-B forecast (:1231, 3) — 10 queries/run, the R7 cost bound pinned at `getQuantSearchQueryCountForTests() === 10` (tests/unit/market-sizing-web-grounding.test.ts).
- **The ladder behind the tiers**: step 5 — recorded CAGR-bearing reference (R1, :1158 guard) > web extraction (`webConsensus`, :1166-1183) > LLM prior (:1184-1192) > unset (0, never fabricated); step 5-B — recorded reference (R1) > web forecast extraction (:1231-1267, saved ONCE as `captured_from='web_research'` per R9 :1257-1266) > LLM prior (:1268+) > unset. With zero excerpts the web tiers are skipped and the honest LLM prior returns null on unfamiliar markets → "not entered" forever.
- **The precedent to follow** (company-profile-pipeline.ts): step 2 passes `{ playwright: true, deadlineAt: Date.now() + PROFILE_SEARCH_DEADLINE_MS, playwrightQueries: PROFILE_PLAYWRIGHT_QUERIES }` (:519-533) with `PROFILE_SEARCH_DEADLINE_MS = 30_000` (:286) and `PROFILE_PLAYWRIGHT_QUERIES = 2` (:287); provenance flagged via `webResearchPlaywright` (:538-539, :968). The S1 matrix has no per-step summary slot for such a note and its provenance model (R2 per-item validation + `sectionConfidence` notes) already states "N web-search excerpts — confirm against the original text" (Korean copy, translated) — no new provenance surface is added here.
- **Playwright chain mechanics** (web-research.ts): `ResearchOptions { playwright?, deadlineAt?, playwrightQueries? }` (:400-407); the provider runs only when `merged.length === 0` after the base chain AND `deadlineAt - now >= PLAYWRIGHT_MIN_REMAINING_MS` (8_000) (:425-428); opt-out `WEB_SEARCH_PLAYWRIGHT_ENABLED` + off under `NODE_ENV=test` unless the test override is set (:188-193); single-browser queue (:195-206); circuit breaker shared with all providers; `setPlaywrightSearchOverrideForTests` test seam (playwright-search.ts:13-20).
- **R7 header contract** (market-sizing-pipeline.ts:448-453, :541-543): the Korean header comment states that "unconfigured search, failure, quota exhaustion and empty results all collapse to empty excerpts" (translated) — the quota clause is the part this design corrects; failure and emptiness semantics are unchanged.
- **Structural test pins** (tests/unit/market-sizing-web-grounding.test.ts): the R7 degradation case asserts extraction-zero + LLM-prior wording on an EMPTY chain (`sources: []` via the web-research override) — unaffected by this change because an empty chain still returns `[]`; the 10-query cost-bound pins and the R1/R4/R9 ladder pins must stay green without edits (they exercise non-quota paths via the override, which short-circuits before the chain at web-research.ts:411 and always reports `quotaExceeded: false`).

### INFERRED (reasoned from the code above)

- The consumption-rule change is safe for every other `quotaExceeded` consumer: the flag's meaning in `researchSourcesDetailed`'s return value is untouched; only the S1 helper's reaction changes. Company-profile (:534-539) reads `sources`/`providers`, not the flag, for its research flow; the brownfield routes and holding-check predate the flag.
- With fix 1 alone, the live-diagnosis scenario already heals the consensus WITHOUT headless Chrome (DDG sources flow through); the headless wiring adds a second rescue for the fully-blocked case (Tavily 432 + DDG bot-blocked — the profile pipeline's original motivation, and the state DDG periodically enters under sustained bot pressure).
- Run-scoped deadline bounding works because the two call sites are sequential inside one `runSteps` invocation; the 8 s minimum-remaining guard means a late-arriving 5-B call skips the browser rather than overrunning the run.

### ASSUMED

- 30 s remains the right per-run headless budget (mirrors the profile pipeline's per-call 30 s; the S1 run is background/fire-and-forget like the profile job, and the deadline bounds the added worst-case latency to ~30-40 s per run, not per call).
- Two Playwright queries per engaged call (`playwrightQueries: 2`) suffices — same value as the profile pipeline; a browser session is slow and DuckDuckGo HTML is the gentlest target.

### UNKNOWN (explicitly open)

- Real-world headless success rate for the sizing query phrasing under sustained bot pressure — mitigated by the honest per-provider diagnostics that already flow into `providerFailureCauses` for any future degraded-reason work (out of scope here; the S1 matrix has no degraded banner today).
- Whether steps 2/4 should also gain the headless rescue — deferred (§7); the verified defect is the consensus-entry tiers, and widening browser exposure to every run without evidence of need violates the minimal-diff rule.

## 4. D-A — Consumption rule (the defect fix)

**Helper change** (`market-sizing-pipeline.ts:541-554`), with a new exported pure helper so the contract is unit-pinned:

```ts
/** R7 consumption rule (amendment 2026-11-14) — quotaExceeded is a cost/degradation
 *  signal, not an emptiness signal. Sources the chain found (fallback providers
 *  included) pass through as-is; [] only when the chain is truly empty — the
 *  existing guarantee that search failure never breaks the pipeline is kept.
 *  (The shipped helper carries this comment in Korean, matching file style.) */
export function excerptsFromChainResult(r: { sources: WebSource[]; quotaExceeded: boolean }): WebSource[] {
  return r.sources.length > 0 ? r.sources : [];
}

export async function quantitativeExcerpts(queries: string[], opts: { deadlineAt?: number } = {}): Promise<WebSource[]> {
  quantSearchQueryCount += queries.length; // R7 cost-cap observation seam (see the helper below)
  if (!isWebResearchConfigured()) return [];
  try {
    const r = await researchSourcesDetailed(
      queries,
      EXCERPT_LIMIT,
      opts.deadlineAt !== undefined
        ? { playwright: true, deadlineAt: opts.deadlineAt, playwrightQueries: SIZING_PLAYWRIGHT_QUERIES }
        : undefined,
    );
    return excerptsFromChainResult(r);
  } catch {
    return []; // search failure — no new failure path (R7)
  }
}
```

- The try/catch and the `quantSearchQueryCount` accounting are byte-identical in behavior.
- `quotaExceeded` stays in the pure helper's input type so the test pins the exact contract shape (quota present, ignored) — that IS the fix being pinned.
- R7 header comment (:541-543 and the file-header block :448-453) gains one amended line stating the corrected rule; the failure/empty clauses are unchanged.

**Rejected alternative**: flipping `quotaExceeded` to `false` inside `researchSourcesDetailed` when fallback providers produced sources — rewrites a truthful cost signal consumed by diagnostics/degraded-reason paths in three other pipelines, and would hide real provider outages from operators. Recorded in DEC-20261114-01.

## 5. D-B — Run-scoped headless rescue at the consensus tiers

**Constants** (next to the R7 helper block, mirroring the profile pipeline's naming and values):

```ts
// Headless-rescue budget constants — same values and rationale as
// company-profile-pipeline's PROFILE_SEARCH_DEADLINE_MS (background job, one
// browser session per cap). Computed once per run; the same deadline goes to
// the R4 and R5-B calls (§5).
const SIZING_SEARCH_DEADLINE_MS = 30_000;
const SIZING_PLAYWRIGHT_QUERIES = 2;
```

**Run-scoped deadline** in `runSteps`, immediately before the top-down consensus block (the top of the two-tier web-grounding region, after step 4's outputs are settled):

```ts
// Headless-rescue deadline (design 2026-11-14-s1-quota-rescue §5) — computed once
// per run and passed as the same deadline to the two searches below (R4
// consensus, R5-B forecast). The two calls drain one window, so the whole run's
// headless budget is bounded to this cap (30 s); researchSourcesDetailed's
// internal PLAYWRIGHT_MIN_REMAINING_MS (8 s) guard makes a late call with too
// little time left skip the browser.
const webGroundingDeadline = Date.now() + SIZING_SEARCH_DEADLINE_MS;
```

passed at both sites:

```ts
const cagrExcerpts = await quantitativeExcerpts([...], { deadlineAt: webGroundingDeadline });   // step 5 (:1162)
const forecastExcerpts = await quantitativeExcerpts([...], { deadlineAt: webGroundingDeadline }); // step 5-B (:1231)
```

- Steps 2 (:935) and 4 (:1052) call sites are untouched (no second argument → no playwright option → today's chain behavior, now with the discard removed).
- The R1 short-circuit is preserved: when a CAGR-bearing recorded reference exists, the whole step-5 block is skipped and the deadline const costs nothing; when a recorded reference exists for 5-B, likewise. No search, no browser, no budget spend.

## 6. D-C — What does NOT change

- `extractFromExcerpts` and `validateExcerptItems` — excerpts (wherever they came from) still pass the R2 per-item validation before any value reaches the matrix; headless/DDG sources earn citations through the exact same `[n]`/URL provenance path as before.
- R1 recorded-reference precedence, R9 single `web_research` persist, the LLM-prior tiers, `resolveTopDownConsensus`, section confidence grades/notes — untouched.
- `researchSourcesDetailed`, the provider chain, circuit breakers, diagnostics — untouched (this design only consumes existing options; the 2026-11-13 profile design's rejection of a manual `playwrightSearch()` call applies verbatim here).
- The four call sites' query lists, `EXCERPT_LIMIT`, and the 10-query R7 bound — untouched.
- No UI, no route, no schema, no migration, no locale key. The `sectionConfidence` notes already name the source count and carry the before-original-verification caveat (Korean copy, translated) regardless of which provider produced the sources — provenance honesty is carried by that existing mechanism.

## 7. Touched files (implementation PR)

| File | Change |
|---|---|
| `app/web-next/lib/market-sizing-pipeline.ts` | `excerptsFromChainResult` pure helper (exported), `quantitativeExcerpts` opts param + playwright forwarding + consumption rule, two budget constants, run-scoped `webGroundingDeadline` in `runSteps`, deadline passed at the step-5/5-B call sites, R7 comment amendment |
| `tests/unit/s1-quota-rescue.test.ts` (new) | Test plan §8 cases 1-6 |
| `docs/designs/2026-11-14-s1-quota-rescue-design.md` (this file) | Row 0 design of record |
| `docs/decisions/DEC-20261114-01.md` | DEC record |
| `docs/specs/registry.json` | spec-register entry (script-run) |
| `CHANGELOG.md` | [Unreleased] bullet (English) |

## 8. Test plan (house patterns)

Style per the sibling suites: `bun test`, one file = one scratch SQLite (`db/data/test-s1-quota-rescue.sqlite`), llm.ts module-mock snapshot discipline with an armed/disarmed wrapper, provider-level fakes via `setWebProvidersForTests` + `setPlaywrightSearchOverrideForTests`, blanked provider keys restored in `afterAll` (the profile-headless-fallback env discipline), `CO_NEWBIZ_QUEUE_NO_SPAWN=1`.

1. **Pure consumption helper** (`excerptsFromChainResult`): `{sources: [s1, s2], quotaExceeded: true}` → sources returned (THE defect pin — old code returned `[]` here); `{sources: [], quotaExceeded: true}` → `[]`; `{sources: [], quotaExceeded: false}` → `[]`; `{sources: [s1], quotaExceeded: false}` → `[s1]`.
2. **Chain regression (the live diagnosis)**: providers `[tavily quota_exceeded(432), ddg ok(sources)]` → `researchSourcesDetailed` returns the DDG sources with `quotaExceeded: true` — pins that the trigger condition is real and that sources accompany the flag.
3. **Plumbing — deadline provided**: quota-failing tavily fake + Playwright override → `quantitativeExcerpts(["q"], { deadlineAt: Date.now() + 30_000 })` returns the headless sources (options forwarded, chain honored them, discard gone). Deadline too short (`-30_000`) → `[]` and no headless sources (the internal 8 s guard bounds the rescue).
4. **Plumbing — no deadline**: same fakes/override, no second argument → `[]` and the override sources never appear (no playwright provider in the chain — browser reserved for the two consensus tiers).
5. **End-to-end quota path** (full `runSizingPipeline`, the acceptance case): providers `[tavily quota_exceeded(432), ddg ok]`, extraction stub validated against the DDG excerpt → step-5 consensus lands (`topDownCagr` from the DDG source, `origin: "web_research"`, the LLM-prior consensus query NOT fired), step-5-B forecast lands with one `web_research` reference row, the anchor gains its URL-grounded source, and the R7 query count stays 10.
6. **End-to-end headless rescue**: providers `[tavily quota_exceeded(432), ddg blocked]` + Playwright override → the consensus source URL is the headless source; query count still 10 (the playwright provider consumed only `playwrightQueries` of the same queries).
7. **R7 degradation preserved (regression)**: all providers quota/blocked + `WEB_SEARCH_PLAYWRIGHT_ENABLED=false` → zero excerpts, zero extraction calls, LLM-prior path, `topDownCagr: 0`, no references — the original guarantee byte-for-byte.
8. **Structural pins**: market-sizing-pipeline.ts source contains `playwright: true`, `deadlineAt: opts.deadlineAt`, `playwrightQueries: SIZING_PLAYWRIGHT_QUERIES`, `const SIZING_SEARCH_DEADLINE_MS = 30_000`, `const SIZING_PLAYWRIGHT_QUERIES = 2`, and `webGroundingDeadline` handed to both call sites.

Acceptance criteria:

- **AC-1**: In the live-diagnosis provider state (paid quota + DDG ok), an S1 run enters the top-down consensus from web extraction — `matrix.consistency.source.origin === "web_research"` and the LLM-prior consensus query is not fired. (case 5)
- **AC-2**: In the fully-blocked provider state with Chrome/flag available, the headless provider's sources become the consensus source; with the flag off, the run degrades to the LLM prior exactly as today. (cases 6, 7)
- **AC-3**: The helper never fabricates: empty chain → `[]` under every flag combination; extraction fires only on non-empty excerpts. (cases 1, 3, 4, 7)
- **AC-4**: The R7 cost bound is intact: 10 tracked queries per run; per-call playwright budget 2 queries; run-scoped deadline passes the internal 8 s guard check unchanged. (cases 5, 6)
- **AC-5**: All existing market suites stay green without edits (web-grounding, market-calibration, calibration-sweep, capability-ai-sources, web-research-ddg). (baselines)

## 9. References

- ADR-0074 (Design Gate — Row 0), ADR-0098 (llm-interaction-standard — conclusion-first, KNOWN/INFERRED/ASSUMED/UNKNOWN), ADR-0093 (S1-level analysis pipeline family)
- Design 2026-11-06-s1-quantitative-web-grounding (R1-R9 protocol owner — this document amends its R7 consumption clause only) and its amendment line in DEC-20261113-03
- Design 2026-11-13-profile-headless-fallback (§4 scope extended here; DEC-20261113-06 is that design's decision of record)
- DEC-20261114-01 (this design's decision of record)
- app/web-next/lib/web-research.ts, app/web-next/lib/market-sizing-pipeline.ts, app/web-next/lib/company-profile-pipeline.ts, app/web-next/lib/playwright-search.ts
- Live diagnostic 2026-11-14 (dispatch record): provider state `{tavily: quota_exceeded(432), brave: 429, serper: no_key, ddg: ok}` → `n:5, quotaExceeded: true`
