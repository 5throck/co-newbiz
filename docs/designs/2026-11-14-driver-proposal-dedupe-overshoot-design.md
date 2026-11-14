# Design: Driver-proposal duplicate treadmill stop + honest overshoot signal + single-culprit exclusion trigger

- **Date**: 2026-11-14
- **Status**: implemented (spec registered — registry id `2026-11-14-driver-proposal-dedupe-overshoot-design`, source manual, status implemented, see `docs/specs/registry.json`)
- **Decision of record**: [DEC-20261114-02](../decisions/DEC-20261114-02.md) (Row 0, non-exempt)
- **Owner**: backend-engineer (dispatched by pm under ADR-0074)
- **Scope**: five lib/component files (`market-sizing-pipeline.ts`, `market-sizing.ts` type, `calibration-sweep.ts`, `name-similarity.ts`, `CalibrationPanel.tsx`) + two locale files + two new test files; no schema, no route, no migration

> Notation: Korean user-facing copy quoted in this document is paraphrased as "(Korean copy, translated: …)" per docs/context.md. The shipped code carries the Korean originals (Korean inline comments and strings, matching file style); the code blocks below show English glosses of them, and the unit tests pin the shipped Korean literals verbatim.

## 1. Conclusion (first)

1. **The S1 attribution-proposal generator re-proposes semantic duplicates because nothing tells it not to and nothing stops it.** Observed live on 2026-11-14 (drone industry, deal 01M6ZPEZ39R78DW612ECEXY5W4): v11 end-of-run proposed three drivers that paraphrase already-accepted ones (Korean copy, translated: "regulatory environment improvement" ≈ "relaxation of flight regulations"; "technology advance and operating-cost reduction" ≈ "technology advance and adoption-cost reduction"; "commercial drone demand expansion" ≈ "expansion of commercial drone logistics and delivery"), the user accepted all three, and v12 immediately proposed three MORE paraphrases, one with a byte-identical name to an accepted driver (the v12 "commercial drone utilization expansion" equals an accepted driver's name verbatim). The attribution prompt (market-sizing-pipeline.ts:1420-1423) never sees the accepted driver names. Fix is two independent layers: (D-A) the prompt gains an advisory "already covered — do not re-propose the same or a paraphrase; propose only NEW mechanisms" block listing the accepted names, capped at a named constant exactly like the ignored-names pattern (brownfield-proposal-ignore.ts:21 `IGNORED_NAMES_PROMPT_CAP = 20`); (D-B) a post-generation hard filter drops any candidate whose normalized name equals or is a near-duplicate of an accepted driver's normalized name BEFORE the DB insert, with the drop count surfaced honestly in the step summary ("N dropped as duplicates of accepted drivers"). The prompt block is advisory; the filter is the guarantee — the same division of labor as the 2026-11-13-proposal-ignore-suppression design §3.4/§4.3.
2. **The overshoot case becomes an honest signal, not a silent feasible_ratio collapse.** With the polluted set, accepted-driver impact sum reached +12.0pp against a needed uplift of +3.9pp; the run-start Monte-Carlo sweep (`sweepCombinations`, calibration-sweep.ts:92-154) applies the v1 plausibility filter (summed impact > 2× needed uplift is excluded, :105, :121) and reported feasible_ratio 0.0 — the loop cannot converge while the set is over-cap. `matrix.calibration` gains an additive `overshoot` object `{ acceptedImpactSumPct, neededUpliftPct, plausibleCapPct, feasibleRatio, overshoot }` computed by a new exported pure helper `buildOvershootSignal` (calibration-sweep.ts, beside the sweep so the 2× multiple has one source: `PLAUSIBILITY_CAP_MULTIPLE`); CalibrationPanel renders ONE muted warning line when `overshoot === true` (accepted drivers exceed what the anchor needs — consider dismissing duplicates). No auto-removal — the exclusion decision stays human (boundary #2).
3. **The leave-one-out exclusion trigger gains a second arm for the single-culprit overshoot case.** The existing arm (amendment 2026-11-13b, market-sizing-pipeline.ts:1746-1803) fires only when the gap WORSENS beyond `EXCLUSION_NOISE_BAND_PCT` (3.0pp); the overshoot case has no path, and `rankExclusionCandidates` results are only used when `top.improvementPct > 0` — which is exactly the single-culprit signature. New arm: `baselineFeasibleRatio === 0` (the run-start-sweep value `rankExclusionCandidates` already computes and returns — calibration-sweep.ts:204 — same pure `sweepCombinations` computation over the same accepted set) AND `top.improvementPct > 0` (one removal restores SOME feasibility) AND the loop is UNCONVERGED (`calibration.triggered === true` — goal-line unification, design 2026-11-13 §3.1: converged ends the loop with no proposals, so an over-cap set inside the goal line must not churn a converged state; the existing AC-15 arm-1 contract keeps its meaning) → one exclusion proposal whose rationale states the set is over-cap and removing this one driver re-opens goal-reaching combinations (Korean copy, translated: "the accepted set is over-cap, and removing this one driver brings goal-reaching combinations back"). Multi-culprit overshoot (every removal still 0) still proposes nothing — that hole is exactly what the change-2 signal surfaces. The worsening arm's behavior is byte-identical (it takes precedence when both triggers fire); the arm selection is a new exported pure helper `selectExclusionArm` so the three-way contract is unit-pinned without spinning the pipeline.

## 2. Requirement trace

| # | Requirement (PM-recorded 2026-11-14, from the live drone-industry loop) | Where satisfied |
|---|---|---|
| 1 | Stop re-proposing accepted drivers (prompt-side advisory constraint, capped like IGNORED_NAMES_PROMPT_CAP) | §4 (D-A): prompt block in the attribution call |
| 2 | Post-generation dedupe filter with a documented named threshold — drop before insert, count honestly | §5 (D-B): `driverKey` + threshold constants + `filterDuplicateDriverProposals` in name-similarity.ts, wired at the attrs loop |
| 3 | Honest overshoot signal in matrix.calibration + one muted CalibrationPanel line, ko+en locales, no auto-removal | §6 (D-C): `buildOvershootSignal` + type field + panel line |
| 4 | Exclusion trigger extension for the single-culprit overshoot case; worsening arm unchanged; multi-culprit stays silent | §7 (D-D): `selectExclusionArm` + pipeline block restructure |

## 3. Current state (KNOWN — all file:line verified on the worktree, 2026-11-14)

### KNOWN

- **The proposal source**: `pendingDriverProposals` (market-sizing-pipeline.ts:1336-1341) is filled ONLY by the step 5-C attribution block (:1417-1441): the `attrJson` prompt (:1420-1423) asks for 2-5 drivers with direction/impact/rationale, the loop rejects empty driver/rationale and `impact <= 0`, dedupes EXACT names within the batch (`seenDrivers`, :1425-1432), caps at 5 (:1439). The accepted drivers (`acceptedDrivers`, loaded at :660 via `acceptedCalibrationDrivers`) appear in the run-start sweep injection (:680-704) and `buildCalibrationConstraints` (:705-711, which lists them for steps 2/4) — but NOT in the attribution prompt.
- **The insert**: surviving proposals replace all `status='proposed'` rows and insert as `'proposed'` (:1861-1869); the step-5-C summary (:1453-1465) reports only the surviving count today.
- **The run-start sweep**: when unconverged with accepted drivers + CAGR-bearing reference + a previous CAGR (:672-679), the pipeline runs `runCalibrationSweep` (persists to `calibration_sweep_result`, calibration-sweep.ts:254-319) and keeps `sweepInject.feasibleRatio` (:693-703). This is the sweep whose feasible_ratio 0.0 the dispatch observed.
- **The v1 plausibility rule**: `sweepCombinations` computes `needed = |ext − our|` and `plausibilityCap = needed * 2` (calibration-sweep.ts:104-105), excluding sampled combos whose positive triangular-sample total exceeds the cap (:121). The 2× multiple is inline — no named constant.
- **The exclusion block** (market-sizing-pipeline.ts:1746-1803, amendment 2026-11-13b): trigger = new gap worse than previous by > `EXCLUSION_NOISE_BAND_PCT` (:1760-1768) + reference CAGR-bearing + accepted drivers + numeric ourCagrPct; then `rankExclusionCandidates` (:1769-1778) — leave-one-out `sweepCombinations` per driver, returning `{ baselineFeasibleRatio, sampleCount, ranked }` (calibration-sweep.ts:172-205) — and a proposal only when `top.improvementPct > 0` (:1780). Overshoot without worsening never enters the block; and under overshoot every removal typically leaves feasible_ratio 0 so `improvementPct > 0` would be false anyway (multi-culprit).
- **The house similarity helpers** (name-similarity.ts): `normalizeName` (lowercase, strip whitespace/punctuation, :9-11), `companyKey` (legal-form absorbing, :35-39), `isSimilar` (exact-after-normalize OR containment OR token Jaccard ≥ 0.6 — the 0.6 literal at :58, threshold undocumented as a constant). The file header states the judgement rule (Korean copy, translated: "judged by exact-match, containment, and token Jaccard ≥ 0.6 after whitespace/punctuation normalization").
- **The advisory-prompt precedent**: brownfield-proposal-ignore.ts `IGNORED_NAMES_PROMPT_CAP = 20` (:21) — the prompt hint is capped precisely because the rule's guarantee lives in the post-extraction hard filter (:74-76 comment).
- **The panel**: CalibrationPanel.tsx reads `matrix.calibration` (:141), renders the triggered badge (:145-160), accepted-driver chips (:277-292), gap trend (:294-327); locale namespace `stages.s1.calibrationPanel` (ko.json/en.json ~:3546+); interpolation style `{p1}`/`{p2}` (e.g. `p1CagrP2ReflectedIn`).
- **The type**: `SizingMatrix["calibration"]` (app/web-next/lib/market-sizing.ts:235-242) — additive optional field is backward-compatible; persisted legacy payloads simply lack it.
- **Structural-pin conventions**: `normSrc` (tests/unit/helpers/src-normalize.ts) for format-agnostic source assertions; render tests under `renderToStaticMarkup` + `NextIntlClientProvider` (tests/unit/driver-links-panel-render.test.ts, market-growth-banner-render.test.ts); `AuthProvider` wraps render-test components that call `useAuth` (tests/unit/stage-screen-dom-contract.test.ts:70,90) because `useAuth` throws outside the provider (app/web-next/lib/auth-client.tsx:48-52).

### INFERRED (reasoned from the code above)

- The treadmill is structural, not a one-off LLM fluke: the loop's accepted set only grows (accept is the only curation action that adds), the attribution prompt is regenerated each run with no memory of accepted names, and the replacement cadence deletes prior proposals — so every rerun re-derives the same three mechanism families from the same gap analysis and re-files them under new names.
- Dropping near-duplicates BEFORE insert cannot starve the loop of new mechanisms in practice: the cap is 5 and the observed batches are 3; the filter only removes candidates that are duplicates of accepted rows, which are exactly the ones whose acceptance re-widened the gap the loop is trying to close.
- `rankExclusionCandidates`' `baselineFeasibleRatio` is the run-start-sweep value by construction (same pure function, same seed default 20260919, same driver set as :685-690) — reading it from the ranking result instead of re-querying `calibration_sweep_result` keeps the exclusion decision consistent with the ranking it proposes from (the persisted row may be from an earlier version's baseline).
- The overshoot boolean (`sum > cap`) is computable without any sweep run — it needs only the accepted impacts and the CAGR pair — so the signal exists even on first reruns where the run-start sweep trigger did not fire (`sweepInject` null → `feasibleRatio: null`, honest absence, not a fabricated 0).

### ASSUMED

- A containment + token-overlap line is the right near-duplicate judgement for driver names (the threshold itself is settled by evidence, not assumption — see §5). The observed duplicates tokenize with 29-50% shared content tokens; containment catches the byte-identical and substring cases. Synonym unification (the operating-cost/operation-cost word class, Korean copy) is explicitly out of scope per dispatch.
- 20 accepted names in the prompt block (mirror of `IGNORED_NAMES_PROMPT_CAP`) is enough headroom — the observed accepted set is 6; a longer list degrades prompt signal-to-noise and the hard filter remains the guarantee.

### UNKNOWN (explicitly open)

- The exact near-duplicate recall of containment+Jaccard against future LLM phrasings — measured over the six observed pairs, the 0.13-0.20 band survives any lexical filter that keeps distinct mechanisms (see §5); that layer is owned by the prompt block (D-A), and the overshoot signal (D-C) is the detector if residual duplicates still slip through. A synonym table is deferred until evidence shows a real missed class.
- Whether the panel line should eventually carry a per-driver dismissal shortcut — deferred; today the proposals block already carries per-driver dismiss buttons one section below.

## 4. D-A — Prompt-side do-not-repropose (advisory)

**Constant** (market-sizing-pipeline.ts, beside the imports — English gloss; the shipped constant carries a Korean comment matching file style):

```ts
// Cap on accepted driver names sent in the prompt hint — same rationale as
// brownfield-proposal-ignore's IGNORED_NAMES_PROMPT_CAP (20): this is an
// advisory block only; the rule's guarantee is owned by the post-generation
// hard filter (D-B) (design 2026-11-14-driver-proposal-dedupe-overshoot §4).
const ACCEPTED_DRIVERS_PROMPT_CAP = 20;
```

**Prompt change** (:1420-1423) — the attribution instruction gains one appended block, built before the call (English gloss; the shipped strings are Korean, translated below):

```ts
// D-A — do-not-repropose for accepted drivers (advisory; design ... §4).
// Re-accepting paraphrased duplicates over-caps the accepted set against the
// anchor's needed uplift and collapses the sweep (live observation
// 2026-11-14). The guarantee is owned by the D-B hard filter.
const acceptedNames = acceptedDrivers.map((d) => d.driver).filter((n) => n.trim().length > 0).slice(0, ACCEPTED_DRIVERS_PROMPT_CAP);
const doNotRepropose = acceptedNames.length
  ? `\n${acceptedNames}` // Korean copy, translated: "Already-accepted drivers: A / B / ... — do not re-propose these drivers or differently-worded paraphrases of them; propose only NEW mechanisms not in this list."
  : "";
```

appended to the `attrJson` instruction after the JSON contract sentence. The gap-analysis prompt (`gapJson`, :1387-1390) is NOT touched — its `newDrivers` feed the display-only `externalForecast.newDrivers` field, not the proposal table; widening the block there is scope creep (recorded in DEC-20261114-02).

**Rejected alternative**: making the constraint a hard JSON-schema field (e.g. `excludeDrivers: string[]`) — the LLM seam is a free-form JSON contract validated after the fact; a schema field the model can ignore adds no guarantee over the prose block, and the hard filter (D-B) already owns the guarantee.

## 5. D-B — Post-generation dedupe filter (the hard guarantee)

**Threshold evidence (why two named constants, not one)**: token Jaccard over the six observed live duplicate pairs is 1.00 (byte-identical), 0.50 (the operating-cost-reduction pair), 0.29 (the demand-expansion pair), 0.20/0.14/0.13 (the three loose regulatory/technology paraphrases). `isSimilar`'s 0.6 catches only the identical pair; a 0.25 driver-dedupe line catches the first three while the observed distinct mechanism pairs score 0.00-0.20. The 0.13-0.20 band is the lexical-judgement limit — that layer is owned by the prompt block (D-A) and the overshoot signal (D-C), as recorded under UNKNOWN. `isSimilar` keeps its own exported `NAME_SIMILARITY_JACCARD_THRESHOLD = 0.6` (its inline literal named; behavior identical for the S6 callers).

**name-similarity.ts additions** (English glosses; the shipped constants/comments carry Korean, matching file style):

```ts
// Token-similarity threshold for driver duplicate judgement — deliberately a
// different line from isSimilar's 0.6 (which serves within-response
// near-identical dedupe): this filter must catch cross-run paraphrases, and
// the live loop's real duplicate pairs scored Jaccard 0.50 and 0.29. 0.25
// keeps those pairs while preserving observed distinct mechanisms
// (0.00-0.20). (design 2026-11-14-driver-proposal-dedupe-overshoot §5)
export const DRIVER_DEDUPE_JACCARD_THRESHOLD = 0.25;

// Driver-name normalization key — same rule as normalizeName (lowercase,
// strip whitespace/punctuation). Unlike companyKey there is no legal-form
// absorption (driver names have none). Synonym unification
// (operating-cost/operation-cost class) is deliberately excluded —
// containment + token Jaccard suffices (design §5).
export function driverKey(raw: string): string {
  return normalizeName(raw);
}
```

plus a private `driverNameSimilar` (the `isSimilar` skeleton — normalized equality / containment / token Jaccard — with `DRIVER_DEDUPE_JACCARD_THRESHOLD`) and the exported generic filter below:

```ts
// Pre-insert hard filter (the D-B guarantee; the D-A prompt block is advisory
// only). Returns the dropped set as-is — the caller states the count honestly
// in the summary. A candidate whose normalized form is empty is an input
// defect, not a duplicate verdict — kept for the caller's existing validation.
export function filterDuplicateDriverProposals<T extends { driver: string }>(
  candidates: T[],
  acceptedDriverNames: string[],
): { survivors: T[]; dropped: T[] } {
  const survivors: T[] = [];
  const dropped: T[] = [];
  for (const c of candidates) {
    const isDup = driverKey(c.driver) !== "" && acceptedDriverNames.some((n) => driverNameSimilar(c.driver, n));
    if (!isDup) survivors.push(c);
    else dropped.push(c);
  }
  return { survivors, dropped };
}
```

- `isSimilar`'s inline `0.6` becomes `NAME_SIMILARITY_JACCARD_THRESHOLD` — byte-identical behavior for its existing callers (S6 proposal dedupe), pinned by the existing suites staying green.
- **Pipeline wiring** (:1424-1440): the existing loop first collects ALL valid candidates (empty driver/rationale and `impact <= 0` rejects, within-batch exact `seenDrivers` — unchanged), then `filterDuplicateDriverProposals` runs against the accepted names, survivors push (5-cap preserved via slice — today's `break` at 5 has the same effect since collection order is the LLM order), and a `droppedDuplicateDrivers` counter (declared beside `pendingDriverProposals`, :1336) records the drop count.
- **Honest accounting** (:1453-1465): the step-5-C summary text gains the clause (Korean copy, translated: "(N dropped as duplicates of accepted drivers)") when the counter is > 0 — the summary is the proposal surface's rationale record; per-proposal rationale text stays the LLM's own (we do not rewrite model output).

**Rejected alternative**: fuzzy-matching candidates against DISMISSED proposals too — dismissed rows were rejected by a person for any reason; treating them as "covered" would silently suppress mechanisms the person may want re-proposed in a new context. Accepted-only is the contract the dispatch names.

## 6. D-C — Honest overshoot signal (calibration block + panel)

**calibration-sweep.ts** — the 2× multiple becomes a named constant used by both `sweepCombinations` (:105 — math unchanged, existing pins stay green) and the new pure helper (English gloss; shipped comments are Korean):

```ts
// Plausibility-cap multiple — the v1 correlation approximation: combos whose
// summed impact exceeds this multiple of the needed uplift are out-of-plausible
// (sweepCombinations v1 rule, design 2026-09-19 §2). The D-C overshoot signal
// consumes the same constant — if the two 2x's diverge, the signal drifts from
// the sweep.
export const PLAUSIBILITY_CAP_MULTIPLE = 2;

// Honest overshoot signal (design ... D-C) — when the accepted-driver impact
// sum exceeds the anchor's plausibility cap (2x the needed uplift), the
// sweep's feasible_ratio collapses to 0 and the loop cannot answer. The
// signal lands in the matrix only; the exclusion decision stays human
// (boundary #2 — no auto-removal). Null without a CAGR reference — a
// size-based gap has no CAGR overshoot. feasibleRatio carries the run-start
// sweep's (runCalibrationSweep) value — null when no sweep ran (never
// fabricated).
export interface OvershootSignal {
  acceptedImpactSumPct: number;
  neededUpliftPct: number;
  plausibleCapPct: number;
  feasibleRatio: number | null;
  overshoot: boolean;
}

export function buildOvershootSignal(input: {
  ourCagrPct: number;
  externalCagrPct: number;
  acceptedImpacts: number[];
  runStartFeasibleRatio?: number | null;
}): OvershootSignal | null {
  if (!(input.externalCagrPct > 0)) return null;
  const acceptedImpactSumPct = Math.round(input.acceptedImpacts.reduce((a, v) => a + v, 0) * 10) / 10;
  const neededUpliftPct = Math.round(Math.abs(input.externalCagrPct - input.ourCagrPct) * 10) / 10;
  const plausibleCapPct = Math.round(neededUpliftPct * PLAUSIBILITY_CAP_MULTIPLE * 10) / 10;
  return {
    acceptedImpactSumPct,
    neededUpliftPct,
    plausibleCapPct,
    feasibleRatio: input.runStartFeasibleRatio ?? null,
    overshoot: acceptedImpactSumPct > plausibleCapPct,
  };
}
```

**Type** (app/web-next/lib/market-sizing.ts:235-242) — additive optional field on `calibration` (inline structural shape, NOT an import: the schema module stays import-free; the shape is structurally identical to `OvershootSignal`, which is the normative interface checked at the pipeline's assignment):

```ts
// Honest overshoot signal (design ... D-C) — whether the accepted-driver sum
// exceeds the anchor's plausibility cap (2x needed uplift); when it does, the
// run-start sweep's feasible_ratio collapses to 0. No auto-removal — display
// and the human exclusion decision only (boundary #2). Exists only with a
// CAGR reference; optional, absent from legacy payloads.
overshoot?: {
  acceptedImpactSumPct: number;
  neededUpliftPct: number;
  plausibleCapPct: number;
  feasibleRatio: number | null;
  overshoot: boolean;
};
```

**Pipeline** (:1409-1416): `calibration` gains `overshoot: buildOvershootSignal({ ourCagrPct, externalCagrPct: externalCagrPct ?? 0, acceptedImpacts: acceptedDrivers.map((d) => d.impact_pct), runStartFeasibleRatio: sweepInject ? sweepInject.feasibleRatio : null }) ?? undefined` — only reachable inside the `sourceLabel && (externalSize > 0 || externalCagrFrac)` guard, so the object exists exactly when an anchor exists.

**Panel** (CalibrationPanel.tsx, after the header row :149-164): one muted line when `cal?.overshoot?.overshoot === true`:

```tsx
{cal?.overshoot?.overshoot === true && (
  <p role="status" className="mb-2 text-[length:var(--fs-caption)] text-[color:var(--muted-fg)]">
    {t("acceptedDriverSumExceedsPlausibilityCap", {
      p1: cal.overshoot.acceptedImpactSumPct.toFixed(1),
      p2: cal.overshoot.neededUpliftPct.toFixed(1),
      p3: cal.overshoot.plausibleCapPct.toFixed(1),
    })}
  </p>
)}
```

- Locale keys (both ko.json and en.json, `stages.s1.calibrationPanel`, plain text, `{p1}`/`{p2}`/`{p3}` house style):
  - ko: the Korean value (Korean copy, translated: "Accepted driver sum +{p1}%p exceeds the plausibility cap ({p3}%p) over the anchor's needed uplift ({p2}%p) — consider dismissing duplicate proposals.")
  - en: `"Accepted driver sum +{p1}%p exceeds the plausibility cap ({p3}%p) over the anchor's needed uplift ({p2}%p) — consider dismissing duplicate proposals."`
- No auto-removal, no button, no state change — a person dismisses via the existing proposal rows (boundary #2).

## 7. D-D — Exclusion-trigger extension (single-culprit overshoot only)

**calibration-sweep.ts** — new exported pure arm selector (English gloss; shipped comments are Korean), living beside `rankExclusionCandidates`, which produces its inputs:

```ts
// Exclusion-trigger arm selection (design ... D-D) — two arms: (1) the
// existing worsening arm (amendment 2026-11-13b) — the gap worsened beyond
// the noise band; (2) the new overshoot arm — the accepted set is over-cap
// (overshoot), the run-start sweep's feasible_ratio is 0, and only
// single-culprit cases where the top removal candidate shows a meaningful
// improvement (> 0) propose. When every removal still leaves 0
// (multi-culprit), nothing proposes — that hole is covered by the overshoot
// signal (matrix.calibration.overshoot). The worsening arm takes precedence
// (existing behavior unchanged — the improvement > 0 condition stays at the
// call site).
export type ExclusionArm = "worsening" | "overshoot";

export function selectExclusionArm(input: {
  worsening: boolean;
  overshoot: boolean;
  baselineFeasibleRatio: number;
  topImprovementPct: number | null;
}): ExclusionArm | null {
  if (!input.worsening && !input.overshoot) return null;
  if (input.worsening) return "worsening";
  return input.baselineFeasibleRatio === 0 && (input.topImprovementPct ?? 0) > 0 ? "overshoot" : null;
}
```

**Pipeline block restructure** (:1746-1803) — the outer trigger widens from worsening-only to `worsening || overshoot`, where the overshoot side additionally requires `calibration.triggered === true` (unconverged only — the 2026-11-13 §3.1 rule "converged ends the loop, no proposals" is kept, so an over-cap set inside the 15% goal line never churns a converged state; the existing AC-15 arm-1 pin keeps its meaning); inside, after `rankExclusionCandidates`, `selectExclusionArm` picks the arm and the rationale head/recommendation are chosen by it:

- worsening arm: byte-identical rationale head (Korean copy, translated: "Exclusion review evidence — gap worsening: previous version X% → this version Y% (beyond the ±3.0pp allowed drift)."), table, recommendation and quality warning as today.
- overshoot arm rationale (new): head states the set is over-cap — accepted impact sum {sum}%p exceeds the plausibility cap {cap}%p over needed uplift {needed}%p, and the goal-line reachable ratio collapsed to {baseline}% (Korean copy, translated) — then the same leave-one-out table, then the recommendation (Korean copy, translated: "Recommendation: the accepted set is over-cap, and removing this one driver brings goal-reaching combinations back.") closing with the same dismiss-only sentence and the same reference-quality warning.
- Multi-culprit overshoot (all removals still 0 → no `improvementPct > 0`) still proposes nothing — the D-C signal is its only surface.
- `baselineFeasibleRatio === 0` is checked from the value `rankExclusionCandidates` already returns (calibration-sweep.ts:204) — no second sweep, no DB read of `calibration_sweep_result` (the persisted row can predate this run's driver set; the in-run value is the consistent one).

**Rejected alternatives**: (a) firing the arm on `overshoot === true` alone without the `baselineFeasibleRatio === 0` guard — a still-feasible over-cap set (ratio > 0) does not need a removal proposal and the rationale would overstate; (b) reading the persisted run-start sweep row via `latestSweep` — version skew between the persisted baseline and the current ranking inputs would let the arm fire on stale evidence; (c) skipping the `triggered` gate — a converged loop (gap < goal line) must not churn (goal-line unification §3.1), and the AC-15 arm-1 contract pins exactly that.

## 8. What does NOT change

- The worsening arm's trigger math, rationale wording, table format, quality warning and dismiss-only flow — byte-identical when it fires.
- `sweepCombinations`/`rankExclusionCandidates` sampling math — only the cap literal becomes the shared constant (same value, same behavior; the existing sweep pins stay green unedited).
- `isSimilar`'s existing callers and semantics — the 0.6 literal becomes the named constant (same value).
- The gap-analysis prompt (`gapJson`) and `externalForecast.newDrivers` — untouched.
- No migration, no route, no openapi change — the calibration block is additive optional payload, the panel line is additive render, the proposal insert path is the existing `industry_driver_calibration` flow.
- The run-start sweep injection block (:672-704) — untouched; the overshoot signal merely READS `sweepInject.feasibleRatio` when present.

## 9. Touched files (implementation PR)

| File | Change |
|---|---|
| `app/web-next/lib/name-similarity.ts` | `NAME_SIMILARITY_JACCARD_THRESHOLD` (0.6, isSimilar consumes it — behavior identical) + `DRIVER_DEDUPE_JACCARD_THRESHOLD` (0.25, evidence-based) constants, `driverKey`, private `driverNameSimilar`, `filterDuplicateDriverProposals` |
| `app/web-next/lib/calibration-sweep.ts` | `PLAUSIBILITY_CAP_MULTIPLE` (sweepCombinations consumes it), `OvershootSignal` + `buildOvershootSignal`, `ExclusionArm` + `selectExclusionArm` |
| `app/web-next/lib/market-sizing-pipeline.ts` | `ACCEPTED_DRIVERS_PROMPT_CAP` + prompt block (D-A), dedupe wiring + drop counter + summary clause (D-B), `calibration.overshoot` via `buildOvershootSignal` (D-C), exclusion block widen + arm selection + overshoot-arm rationale (D-D) |
| `app/web-next/lib/market-sizing.ts` | `calibration.overshoot?` structural type field (schema module stays import-free) |
| `app/web-next/components/stages/market/CalibrationPanel.tsx` | one muted overshoot line |
| `app/web-next/locales/ko.json`, `app/web-next/locales/en.json` | `acceptedDriverSumExceedsPlausibilityCap` (ko+en) |
| `tests/unit/driver-proposal-dedupe.test.ts` (new) | Test plan §10 cases 1-10 + static pins |
| `tests/unit/calibration-panel-render.test.ts` (new) | Test plan §10 cases 11-13 |
| `scripts/co-newbiz/i18n-lint.baseline.json` | baseline regenerated for market-sizing-pipeline.ts (171 → 175 Korean code lines — the new prompt/rationale strings; comments are stripped by the lint) |
| docs (this file, DEC-20261114-02, spec registry, CHANGELOG) | Row 0 record |

## 10. Test plan (house patterns)

Pure-function imports for the math/filter/arm cases; `normSrc` static pins for the prompt and panel wiring (the pins quote the shipped Korean literals verbatim — this document paraphrases them); render test under `renderToStaticMarkup` + `NextIntlClientProvider` + `AuthProvider` (the stage-screen-dom-contract pattern — `useAuth` throws outside the provider). No DB needed (all new units are pure); the pipeline-level pins are static-source assertions so no llm.ts mock machinery is required. Driver names are referred to below by translated glosses: "drone-utilization expansion" (the byte-identical pair), "operating-cost reduction pair" (0.50), "demand-expansion pair" (0.29), "AI autonomous-flight certification" (the distinct mechanism).

1. **driverKey / thresholds**: `driverKey` on a spaced/punctuated Korean driver name equals `normalizeName` output; `NAME_SIMILARITY_JACCARD_THRESHOLD === 0.6` and `isSimilar` still honors it (the 0.50-Jaccard observed pair is NOT similar under isSimilar); `DRIVER_DEDUPE_JACCARD_THRESHOLD === 0.25`.
2. **Dedupe filter — identical name**: the drone-utilization-expansion candidate vs the accepted set → dropped (the v12 byte-identical case).
3. **Dedupe filter — paraphrase within threshold (the observed pairs, pinned verbatim in the test)**: the operating-cost-reduction candidate (Jaccard 0.50) → dropped; the demand-expansion candidate (Jaccard 0.29) → dropped.
4. **Dedupe filter — distinct passes + lexical limit (honest)**: the AI-autonomous-flight-certification mechanism vs the accepted set → survivor; the two loose paraphrases (Jaccard 0.14 and 0.13) SURVIVE the lexical filter by design — that layer is the prompt block's (D-A) job and the overshoot signal (D-C) is the detector — the pin documents the boundary, not a failure; empty normalized candidate is never dropped by the dedupe (caller validation owns it).
5. **Dedupe filter — drop counting**: mixed batch of 4 (2 dups, 2 new) → `survivors.length === 2`, `dropped.length === 2`, and the dropped entries are exactly the duplicate candidates.
6. **Overshoot math (the live case)**: our 13.0 / external 16.9 (needed 3.9, cap 7.8) with accepted impacts summing 12.0 → `overshoot === true`, sum/cap/needed rounding at 0.1; boundary: sum exactly equal to cap → false (`>` not `>=`); sum below cap → false.
7. **Overshoot nullability**: externalCagrPct 0 or negative → null; `runStartFeasibleRatio` absent → `feasibleRatio: null` (honest absence) while `overshoot` still computes.
8. **PLAUSIBILITY_CAP_MULTIPLE pin**: the constant is 2 and is the one consumed in both `sweepCombinations`' cap and `buildOvershootSignal`'s cap (static pin); the existing calibration-sweep behavior pins stay green unedited.
9. **selectExclusionArm**: single-culprit overshoot (overshoot true, baseline 0, top +X) → `"overshoot"`; multi-culprit (overshoot true, baseline 0, top 0/null) → null; over-cap but still feasible (overshoot true, baseline > 0) → null; worsening arm unchanged (worsening true, overshoot false, any baseline/top) → `"worsening"`; both triggers → `"worsening"` (precedence); neither → null.
10. **rankExclusionCandidates-driven scenario (the dispatch case)**: our 10 / ext 20 (needed 10, cap 20), drivers 31/5/5 → baseline 0 (sample floor 0.5×41 = 20.5 > 20) and removing the 31-driver restores 0.966 → arm `"overshoot"` with `ranked[0]` the 31-driver; drivers 21/21/21 → baseline 0 and every removal still 0 (multi-culprit — arm null). Worsening-arm regression: the existing market-calibration/calibration-sweep/sizing-matrix-guard suites stay green unedited (AC-15 arm 1 = converged + over-cap → no proposal, pinning the `triggered` gate end-to-end).
11. **Prompt structural pin** (`normSrc`): market-sizing-pipeline.ts source contains `ACCEPTED_DRIVERS_PROMPT_CAP`, the `acceptedNames` construction from `acceptedDrivers`, the do-not-repropose instruction (Korean literals, quoted verbatim in the test), the block appended to the `attrJson` call site exactly once (not the gap-analysis prompt), and the summary dedupe-note wiring.
12. **Panel structural pin** (`normSrc`): CalibrationPanel.tsx renders the line only under `cal?.overshoot?.overshoot === true`, uses `role="status"` + the muted-fg caption classes, and both locale files carry the key with `{p1}`/`{p2}`/`{p3}`.
13. **Panel render** (renderToStaticMarkup): with `calibration.overshoot.overshoot = true` the muted line renders the ko and en copy with the three numbers (SSR-escaped, `&gt;`); with `overshoot` undefined or `overshoot: false` the line is absent; the unconverged badge still renders beside the line (regression — the accepted-chips block fills from the API state, not the matrix, so it is out of scope for this static seam).

Acceptance criteria:

- **AC-1**: A rerun can no longer insert a proposal whose name equals or near-duplicates an accepted driver — identical and within-threshold paraphrase candidates are dropped before insert with the count in the step summary. (cases 2-5, 11)
- **AC-2**: When the accepted impact sum exceeds 2× the needed uplift, `matrix.calibration.overshoot.overshoot` is true and CalibrationPanel shows exactly one muted warning line in ko and en; nothing is auto-removed. (cases 6-7, 12-13)
- **AC-3**: The exclusion proposal fires for the single-culprit unconverged overshoot case (one removal restores feasibility) with the over-cap rationale, and stays silent for the multi-culprit case and for converged over-cap sets; the worsening arm is byte-identical. (cases 9-10)
- **AC-4**: All existing suites stay green without edits (calibration-sweep, market-calibration, market-sizing-web-grounding, sizing-matrix-guard, calibration-decide-route, calibration-escalation, market-growth-banner-render, driver-links-panel-render). (baselines)

## 11. References

- ADR-0074 (Design Gate — Row 0), ADR-0098 (llm-interaction-standard — conclusion-first, KNOWN/INFERRED/ASSUMED/UNKNOWN)
- Design 2026-11-13-calibration-loop-convergence (amendments 2026-11-13a/b — the sweep injection, the goal-line unification whose "converged ends the loop" rule the overshoot arm keeps, and the worsening-only exclusion arm this design extends)
- Design 2026-11-13-proposal-ignore-suppression (the advisory-prompt + hard-filter division of labor and `IGNORED_NAMES_PROMPT_CAP` precedent)
- Design 2026-11-14-s1-quota-rescue / DEC-20261114-01 (same-day S1 sibling, house format reference)
- DEC-20261114-02 (this design's decision of record)
- app/web-next/lib/market-sizing-pipeline.ts, app/web-next/lib/calibration-sweep.ts, app/web-next/lib/name-similarity.ts, app/web-next/lib/market-sizing.ts, app/web-next/lib/market-calibration.ts, app/web-next/components/stages/market/CalibrationPanel.tsx, app/web-next/lib/brownfield-proposal-ignore.ts
- Live loop observation 2026-11-14 (dispatch record): drone industry deal 01M6ZPEZ39R78DW612ECEXY5W4 — v11 proposed 3 paraphrases (all accepted), v12 proposed 3 more (one byte-identical), accepted impact sum +12.0pp vs needed +3.9pp, run-start sweep feasible_ratio 0.0
