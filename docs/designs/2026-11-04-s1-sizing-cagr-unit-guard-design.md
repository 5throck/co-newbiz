# Design: S1 Sizing Zero-Baseline Guard and bottomUpCagr Unit Contract (2026-11-04)

**Status**: Proposed (Row 0 — pending user gate approval)
**Scope**: `app/web-next/lib/market-sizing-pipeline.ts` (Step 4 baseline reconciliation + Step 5 rollup), `app/web-next/lib/synergy-pipeline.ts` and `app/web-next/lib/synergy-rescore.ts` (CAGR unit conversion seams), and unit tests. The third link of the defect chain — the `synergy-score.ts` market_attractiveness fail-closed guard — is designed in the amendment appended to `docs/designs/2026-10-18-synergy-4element-design.md` (that spec's governed surface) and referenced here as §3.3.
**Gate ruling**: DEC-20261104-06 (items A+B = Spec NEW — no market-sizing spec exists in `docs/specs/registry.json`, grep-verified 2026-11-04; item C = amendment to the registered `2026-10-18-synergy-4element-design`)
**Origin**: user report 2026-11-04 — synergy factor note rendered as `"원자력 발전소 핵심 부품·장비 공급 산업 성장률 -10000.0% → 정규화 0/100"` (note format `synergy-score.ts:105`)

## 1. Problem

A verified four-link defect chain runs from the S1 market-sizing pipeline to
the S3 synergy score. Every link is independently evidenced (§2); together
they turn one bad LLM completion into a persisted garbage matrix and a
silently wrong synergy score.

**Link 1 (ROOT) — the S1 pipeline persists an all-zero baseline matrix.**
`market-sizing-pipeline.ts:658-679`: when the LLM baseline matrix parses to
`rawTotal = 0`, `scale = 0` (line 659). The per-cell fallback (line 666,
`llmBaseline[r.code]?.[seg.code] ?? anchorTotal / (REGIONS.length * segs.length)`)
fills only cells the LLM *omitted* — cells the LLM explicitly set to `0`
(or keys whose values fail `num(v, 0)` at line 649 and fold to 0) stay 0
through the `scale = 0` multiplication. The final anchor reconciliation
(line 673) is gated on `totalNow > 0` and is therefore skipped. Result:
`baseline2026` is all zeros, the run still reaches Step 8 and completes, and
the zero matrix is persisted as an analysis version.

**Link 2 (DERIVED) — a degenerate bottomUpCagr is computed and stored
unguarded.** `market-sizing-pipeline.ts:695-698` computes the bottom-up
rollup `(Σ2030 / anchorTotal)^(1/4) - 1`; with an all-zero baseline the
numerator is 0, so the value is `-1.0`, and the storage site (line 1038,
`Math.round(bottomUpCagr * 1000) / 10`) writes **-100.0 percentage points**
into `matrix.consistency.bottomUpCagr`. The structural guard
`isCompleteSizingMatrix` (`market-sizing.ts:228-244`) validates field
presence only — it never checks numeric sanity — so the degenerate payload
passes as a "complete" matrix everywhere the guard runs.

**Link 3 (AMPLIFIED) — the unit heuristic mishandles non-positive values.**
`bottomUpCagr` is ALWAYS stored ×100 (percentage points): pipeline line
1038, and the units comment at `track-advisory.ts:74` ("bottomUpCagr is
stored ×100 (percent)"). But `synergy-pipeline.ts:440` and
`synergy-rescore.ts:97` convert with
`cagrPct > 1 ? cagrPct / 100 : cagrPct` — a value of -100 (pct points,
meaning -100%) fails the `> 1` test, falls through **unconverted**, and is
interpreted as a *fraction* of -100. `synergy-score.ts:105` renders it as
`(c * 100).toFixed(1)` → **"-10000.0%"**, while the clamp at
`synergy-score.ts:40` shows `"정규화 0/100"` — masking the data defect behind
a plausible-looking normalization.

**Link 4 (DISPLAY) — non-positive CAGR silently scores 0 with a misleading
note.** `synergy-score.ts:95-105` maps any `c <= cagrMidpoint` through
`clamp((c / cagrMidpoint) * midpointScore)`, so every non-positive CAGR
yields factor value 0 at full weight, with a note repeating the nonsense
number. This contradicts the file's own stated principle (header comment
lines 10-11): *missing/invalid inputs are excluded with a note, never a
fabricated number*. Item C fixes this link — its design lives in the
`2026-10-18-synergy-4element-design` amendment.

The user-visible symptom is Link 4's note. The actual harm is Links 1–2:
a silently-completed S1 analysis whose every baseline cell is zero, which
feeds gate briefs (`gate-brief.ts:125-129` renders the -100.0% as a fact)
and S3 scoring as if the market analysis had succeeded.

## 2. Evidence

All code anchors verified by direct read, 2026-11-04. DB evidence
re-verified by read-only query, 2026-11-04.

| # | Anchor | What it shows |
|---|---|---|
| 1 | `market-sizing-pipeline.ts:649` | `num(v, 0)` folds unparseable LLM cell values to 0 |
| 2 | `market-sizing-pipeline.ts:658-659` | `rawTotal` over the parsed matrix; `scale = rawTotal > 0 ? anchorTotal / rawTotal : 0` |
| 3 | `market-sizing-pipeline.ts:666` | per-cell fallback `?? anchorTotal / (REGIONS.length * segs.length)` applies only to missing keys, then × `scale` |
| 4 | `market-sizing-pipeline.ts:672-680` | reconciliation gated on `totalNow > 0` — skipped when the matrix is all zero |
| 5 | `market-sizing-pipeline.ts:695-698` | rollup `(Σ2030/anchorTotal)^(1/4) - 1` → -1.0 on a zero baseline |
| 6 | `market-sizing-pipeline.ts:1038` | storage `Math.round(bottomUpCagr * 1000) / 10` — ×100 pct points; the only writer of the field |
| 7 | `market-sizing.ts:228-244` | `isCompleteSizingMatrix` checks field presence, not numeric sanity |
| 8 | `track-advisory.ts:74` | units comment: "bottomUpCagr is stored ×100 (percent)" |
| 9 | `synergy-pipeline.ts:353, 440` | `cagrPct` read from `matrix.consistency.bottomUpCagr`; converted with `cagrPct > 1 ? cagrPct / 100 : cagrPct` |
| 10 | `synergy-rescore.ts:97` | same heuristic on the rescore path |
| 11 | `synergy-score.ts:10-11, 40, 95-105` | fail-closed header principle; `clamp`; the `c <= cagrMidpoint` branch and the "-10000.0%" note format |
| 12 | `market-sizing-pipeline.ts:443` | existing failure mechanism: `UPDATE market_sizing_analysis SET status = 'failed', error_message = ?` |
| 13 | `db/data/co-newbiz.sqlite` (read-only query 2026-11-04) | `"원자력 발전소 핵심 부품·장비 공급 산업"` analysis `01M6JH25332WHHM23Z1WG5EXCM` v1: `bottomUpCagr = -100`, `anchor.total = 1`; sibling `"원자력 발전소"` analysis `01M6JGQEWSNFJZH90WVN7CBR41`: v1 = (-100, 1) degenerate, v2 = (6.9, 37.5) healthy re-run ~40 min later |
| 14 | git `-S 'cagrPct > 1'` | heuristic introduced at the birth of `computeSynergyScore` (commit `196b7609`, 2026-09-04) |
| 15 | git `-S 'bottomUpCagr' -- market-sizing-pipeline.ts` | storage expression identical from first storing commit `b44bef8d` (2026-08-31) through line 1038 today |

**Epistemic status of the chain's causes** (KNOWN / INFERRED / ASSUMED
separated per the interaction standard):

- **KNOWN** (verified): every code anchor in the table above; the DB
  degenerate and healthy rows; the ×100 storage contract being unbroken
  since 2026-08-31 with `market-sizing-pipeline.ts:1038` as the single
  writer; the heuristic dating to `computeSynergyScore`'s introduction.
- **INFERRED** (labeled, not verified): the *cause of the LLM returning an
  all-zero baseline* is unknown — plausible candidates (the model failed to
  ground the niche industry's size and emitted zeros rather than refuse;
  a prompt-side constraint the model satisfied degenerately; a truncated or
  malformed completion parsed cell-by-cell into zeros via anchor 1's
  `num(v, 0)`) are consistent with the evidence but unproven, and the fix
  does not depend on which is true. The intermittency evidence (row 13:
  same analysis healthy on re-run) supports an LLM-completion cause rather
  than a deterministic pipeline cause.
- **ASSUMED** (checked and believed nil, residual risk bounded in §3.2):
  that no persisted matrix ever stored `bottomUpCagr` as a raw fraction.
  The single-writer history makes this KNOWN-nil for pipeline-written
  payloads; the ASSUMED label covers only externally-injected or
  hand-edited payloads that bypass the single writer.

## 3. Proposed changes

### 3.1 Item A — zero-baseline guard in `market-sizing-pipeline.ts`

**Primary: fail-closed.** Detect the degenerate condition once, after the
Step 4 reconciliation block:

- **Condition**: `rawTotal <= 0` (line 659's `scale` guard input) **or**
  `totalNow <= 0` (line 673's guard input). Both are the same failure seen
  from parse time and post-fallback time; checking both is one `if`.
- **Action**: the analysis run terminates without persisting a matrix
  version, using the pipeline's existing failure mechanism —
  `market-sizing-pipeline.ts:443` already implements
  `UPDATE market_sizing_analysis SET status = 'failed', error_message = ?`
  with the serial-queue bookkeeping around it (a failed root cancels its
  pending dependents). The `error_message` states the cause in
  user-readable form, e.g. `"기준선 매트릭스가 전부 0으로 해석되어 분석을
  완료하지 못했습니다 — 재분석으로 재시도하세요"` (LLM baseline parsed to
  all zeros; re-run to retry).
- **Downstream effect (deliberate)**: the industry does not join the
  completed-markets list, so S3 scoring sees the market as missing —
  `synergy-score.ts:95`'s `market && market.cagr !== null` and the existing
  missing-input branch (:107-112) already handle an absent market
  fail-closed. Gate briefs and market tabs show a failed analysis instead
  of a zero matrix.
- **Why not the fallback**: filling ALL cells with
  `anchorTotal / (REGIONS.length * segs.length)` when the LLM produced no
  usable signal fabricates a uniform market structure that no source
  evidences. With non-zero `cagrBase` defaults (0.05 floor, line 668) it
  would even produce a plausible bottomUpCagr (~5%), fully masking the
  failure while persisting fabricated cells that gate briefs present as
  analysis. The pipeline's own stated rule — external-input failures are
  surfaced, `"절대 날조하지 않는다"` (`market-sizing-pipeline.ts:699-701`
  comment on the top-down CAGR path) — rules this out as primary.
  Filling all cells uniformly would also make the intermittency invisible:
  the DB evidence (row 13) shows a re-run recovers the industry, which is
  exactly the remediation path fail-closed points the user to.

**Secondary defensive note (bottomUpCagr capping/flagging)**: with the
primary in place, the degenerate rollup is unreachable on the persist path
— Step 5 never runs for a failed analysis, so `bottomUpCagr = -1.0` cannot
be computed, and no separate cap or flag on the value is needed. The
design deliberately does NOT widen `consistency.bottomUpCagr` to
`number | null` or add a clamp: that would ripple through the nine
non-scoring read sites (`gate-brief.ts`, `track-advisory.ts`,
`market-calibration.ts`, `company-profile-pipeline.ts`, three UI components)
that already interpret the ×100 contract, for zero protective gain once the
guard exists. If the uniform-fallback alternative were ever adopted
instead, a companion rule becomes mandatory: skip the rollup (store the
field as absent or flag `tolerance` with a degradation note) whenever the
reconciled total is 0 — recorded here so the pairing is not forgotten.

### 3.2 Item B — unconditional unit conversion in `synergy-pipeline.ts:440` and `synergy-rescore.ts:97`

Replace the conditional heuristic at both sites:

```ts
// before (both sites)
cagrPct === null ? null : cagrPct > 1 ? cagrPct / 100 : cagrPct
// after (both sites)
cagrPct === null ? null : cagrPct / 100
```

**Storage-contract argument.** There is exactly one writer of
`matrix.consistency.bottomUpCagr` — `market-sizing-pipeline.ts:1038` — and
it has stored fraction × 100 (percentage points) since the field's first
computed version (commit `b44bef8d`, 2026-08-31; expression byte-identical
today). The unit comment at `track-advisory.ts:74` documents the same
contract, and every other reader (`gate-brief.ts:129` renders `.toFixed(1)`
+ "%", `market-calibration.ts:255` compares it against `ourCagrPct`,
`company-profile-pipeline.ts:258` passes it through as pct) interprets it
as percentage points. The `> 1` conditional is therefore a defense against
a second unit that has never existed — introduced at `computeSynergyScore`'s
birth (commit `196b7609`, 2026-09-04) and wrong from day one for every
non-positive input: any pct-point value ≤ 1 (including -100 and 0, and a
legit 0.8%) passes through as if it were already a fraction. One stored
unit means one conversion, unconditional.

**Legacy-matrix risk.** Pipeline-written payloads: KNOWN — all carry pct
points (single writer, unbroken contract, row 15); after the change,
`6.9 → 0.069` (correct), `-100 → -1.0` (correct fraction; excluded by item
C), `0 → 0` (excluded by item C). Externally-injected or hand-edited
payloads that bypass the single writer: ASSUMED nil — and bounded by the
range sanity rule below rather than trusted. A historical-fraction payload,
if one were ever discovered, would mis-score by a factor of 100 in the
shrink direction; that would be a data repair (re-run S1), not a code
tolerance — two-unit tolerance is the defect being removed, not an
invariant to preserve.

**Defensive range sanity.** At both seams, after the unconditional
conversion, treat `|cagr| > 1` (as a fraction — i.e. stored |pct| > 100)
as invalid input: return `null` for the market's cagr instead of a number,
so the factor lands in the existing missing/excluded path rather than
being scored. **Writer-envelope argument** (AI-2nd review,
quant-methodologist, 2026-11-04): the only writer derives the value from
`cagrBase` cells clamped to [0, 0.25] (`market-sizing-pipeline.ts:682`,
`Math.min(0.25, Math.max(0, ...))`), so the rollup fraction
`(Σ2030/anchor)^(1/4) - 1` is bounded to [-1, 0.25] — the -1 floor is the
degenerate zero-baseline rollup itself — i.e. the stored pct-point value
can only lie in [-100, 25]. An earlier draft bound of |fraction| ≤ 10
(±1000 pct) was 40× looser than this envelope edge and left a laundering
band: an injected fraction in (0.25, 10] converts cleanly and saturates
the attractiveness curve at 100/100. The tightened ≤ 1 bound brackets the
entire writer envelope, so any value the writer cannot produce is rejected
as `null` instead of scored. With item C's non-positive exclusion this
bounds the positive-garbage direction; the negative side is covered
jointly — in-envelope negatives (-1, 0], including the -1 degenerate
edge, are excluded by item C, and beyond-envelope negatives (< -1
fraction, stored < -100 pct) are rejected by this rule.

**Rejected alternative** (recorded per the gate ruling): widen the
threshold (`> 100 ? /100 : value`) — keeps two live units under one
heuristic, re-opens the same misinterpretation class for values between
the thresholds, and buys nothing given the single-writer proof.

### 3.3 Item C — `synergy-score.ts` market_attractiveness fail-closed guard

Designed in full in the amendment appended to
`docs/designs/2026-10-18-synergy-4element-design.md` (that spec owns the
scoring engine's factor semantics). Interface contract with this spec:

- Item B delivers a **fraction** to `MarketSnapshot.cagr` unconditionally;
- item C then excludes the market_attractiveness factor with a
  missing-note — `"성장률 비정상/비양수 — 시장 매력도 팩터 미반영"` — when
  that fraction is null, non-finite, or ≤ 0, instead of clamping to a
  fabricated 0/100 (`synergy-score.ts:95-105`), matching the file's stated
  fail-closed principle (lines 10-11);
- the two changes are sequenced B → C in one implementation dispatch: B
  alone would turn the -10000.0% display into a -100.0% display (honest
  number, same wrong scoring); C alone leaves the unit bug armed for
  values between 0 and 1 pct points. They ship together.

## 4. Alternatives considered

1. **Item A primary = anchor-derived uniform fallback to ALL cells** —
   rejected as primary, documented as the alternative (§3.1): no-LLM-signal
   cells would be fabricated as a uniform split; a plausible bottomUpCagr
   would mask the failure; the pipeline's no-fabrication rule
   (:699-701) and the fail-closed direction of the scoring engine both
   point the other way. Kept in the design as the fallback-of-record if a
   future requirement demands always-completed analyses, with the mandatory
   companion rollup-skip rule noted in §3.1.
2. **Item B = widen the heuristic threshold** — rejected (§3.2).
3. **Item B = change the storage contract to raw fractions** — rejected:
   nine non-scoring read sites plus three UI components interpret pct
   points today; a contract migration across all of them is a cross-cutting
   change with zero consumer benefit, and `track-advisory.ts:74` already
   encodes pct points as the documented seam.
4. **Structural guard extension** — extend `isCompleteSizingMatrix`
   (`market-sizing.ts:228-244`) to reject all-zero baselines so degenerate
   payloads fail at read time too — rejected for this cycle: the guard is a
   report-rendering structural check, and read-time rejection would trade a
   crash/warning for the already-fixed write path; broader numeric-quality
   validation is explicitly out of scope (§5).
5. **Exemption under E3 (hotfix-typo)** — rejected in the gate ruling
   (DEC-20261104-06): three files across two stages with changed guard
   semantics is not a single-line trivial fix.

## 5. Out of scope

- **Remediation of the existing degenerate DB row.** The persisted v1 of
  `"원자력 발전소 핵심 부품·장비 공급 산업"` (analysis
  `01M6JH25332WHHM23Z1WG5EXCM`) is repaired by re-running its S1 analysis
  through the app — a user-run operation, evidenced as effective by the
  sibling analysis's healthy v2 re-run (row 13). This design documents the
  re-run as remediation guidance only; no backfill job, no data migration.
- **Broader matrix numeric-quality validation** beyond the zero-baseline
  case (e.g. anchor sanity, per-cell outlier bounds, CAGR distribution
  checks) — a future cycle if degenerate-input classes recur; the range
  sanity rule in §3.2 is the only numeric bound added here.
- **The LLM all-zero baseline cause** (INFERRED class, §2) — prompt or
  provider-side diagnosis is separate work; the guard is cause-independent.
- **`consistency.bottomUpCagr` type widening or clamping** — deliberately
  not done (§3.1 secondary note).

## 6. Verification

Unit tests extend the existing suites; all are written against the pure
functions and seams the current code already exposes. **Fails-before /
passes-after** is the bar, same as the fsDiv design's convention.

- **T1 — zero-baseline fails closed** (pipeline level): a stubbed LLM
  completion whose baseline parses to rawTotal 0 (all cells explicit 0, and
  a second case with all keys dropped so `num(v, 0)` folds them) must end
  with the analysis `status: 'failed'`, a non-empty `error_message`, and no
  `market_sizing_version` row persisted. Fails before the change (analysis
  completes with an all-zero `baseline2026` and `bottomUpCagr = -100`);
  passes after.
- **T2 — healthy baseline unaffected**: a baseline within ±15% of the
  anchor still completes, reconciles, and stores a sane bottomUpCagr —
  pins that the guard fires only on the degenerate condition.
- **T3 — unconditional conversion** (`synergy-pipeline.ts:440` /
  `synergy-rescore.ts:97`): stored `bottomUpCagr` values 6.9, 0.8, -100, 0
  produce fractions 0.069, 0.008, -1.0, 0 at the `markets[]` seam — no
  value passes through unconverted. Fails before (0.8 and -100 and 0 pass
  through as fractions).
- **T4 — range sanity**: stored values 250 (pct) → fraction 2.5 → seam
  returns `null` (invalid input), and the market lands in the excluded
  path; the cut is `|fraction| > 1` (stored |pct| > 100) per §3.2's
  writer-envelope argument — envelope-edge values themselves pass the
  range rule and are handled downstream (e.g. stored -100 pct → fraction
  -1.0 → item C's non-positive exclusion).
- **T5 — non-positive CAGR excludes the factor** (engine level, detailed
  in the 4element amendment): `MarketSnapshot.cagr` of -1.0 and 0 yields a
  market_attractiveness factor with `value: null`, weight 0, the
  missing-note `"성장률 비정상/비양수 — 시장 매력도 팩터 미반영"`, and the
  remaining factors renormalized; score stays null only if fewer than
  `MIN_FACTORS` usable factors remain.

Build/test gates: `bun test` on the touched suites green; web-next
typecheck green; manual check — re-running the affected industry's S1 with
a healthy LLM completion produces a normal matrix, and a deliberately
zeroed completion produces a failed analysis with the guard's
error_message.
