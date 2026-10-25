# S8 Target Comparison — Fade-DCF Cross-Check and Acquisition Benchmark Surfacing

- Date: 2026-10-11
- Status: Implemented (approved per user decisions 1-3, 2026-10-11; adjudicated 2026-10-25, DEC-20261025-03)
- Owner: platform-lead (technical domain)
- Related: design 2026-10-10-s8-acquisition-price-benchmark-design (fade-DCF and EV/Revenue band origin), design 2026-10-10-s8-valuation-transparency-design, ADR-0143 (cross-target comparison), ADR-0117 (dual perspective)

## Problem

The S8 brownfield target comparison (`recommendTargetsFromDb` / `flagRecommendedTarget` / `TargetComparisonRow` in `app/web-next/lib/business-case-generator.ts`, rendered in the "targets" tab of `app/web-next/components/stages/BusinessCaseStage.tsx`) ranks targets on the base-scenario p05/p50 of each target's latest `market_forward` model.

Two structural sanity signals are already computed at generation time but never reach the comparison:

1. **Fade-DCF cross-check** (`fadedExitDcf`). Written only into `valuation_simulation.note` as `xcheck=fade-dcf; xcheck_horizon=..; xcheck_terminal_growth=..; xcheck_fade_npv=..; xcheck_fade_irr=..`.
2. **Acquisition EV/Revenue multiple** (`ACQUISITION_EV_REVENUE_DEFAULT` = 3.0x, screening band 2-6x). Written only as `acq_ev=<m>x; exit_ev=<m>x`.

A reviewer comparing targets can therefore see a star on a target whose p50 relies on a growth/exit-multiple structure that the fade-DCF does not support, or whose assumed entry multiple sits outside the benchmark band, without any signal on the comparison surface.

## Decision

1. **Cross-check is display only.** The p05 ranking and the p05-survival RECOMMENDED rule are unchanged. The row gains a divergence ratio, `(fadeNpv - baseP50) / |baseP50|`. If the RECOMMENDED target's absolute divergence exceeds `XCHECK_DIVERGENCE_WARN_RATIO`, the row carries a "structure mismatch" warning. Targets without a cross-check show N/A. No value is fabricated or imputed.
2. **Acquisition benchmark is display only.** Each row shows the assumed EV/Revenue multiple and whether it lies inside the 2-6x band. Nothing is excluded from recommendation.
3. **Storage: no schema change.** A single typed parser reads the note fragments, following the `engineOfNote` / `anchorMethodOfNote` pattern. No migration is needed, so no ADR is needed (see Storage evaluation).

The recommendation stays a proposal (boundary #2). A human selects and adopts. Data-confidence caps are unchanged. No PASS or "verified" stamp is introduced. A divergence inside the threshold is shown as a number only, never as "consistent" or "OK".

## Storage evaluation

| Option | Pros | Cons |
|---|---|---|
| A. Typed parser over the `note` fragments (chosen) | Zero schema change. Fragments are already machine-readable, `;`-delimited, and written by one producer (L1168-1173). Matches the existing `engineOfNote` / `anchorMethodOfNote` precedent. Covers historical rows written since the acquisition-benchmark design. | String contract. Format drift breaks parsing silently. |
| B. Migration `0135` adding `xcheck_fade_npv`, `xcheck_fade_irr`, `acq_ev_revenue` to `valuation_simulation` | Typed columns, queryable. | Requires an ADR before merge (DB schema change). Needs a backfill from the notes anyway, so a parser is still required. Duplicates data that is already present. |

**Recommendation: A.** The drift risk is mitigated as follows:

- One exported parser, `crossCheckOfNote`, is the only reader of these fragments.
- Unit tests pin the exact producer format by round-tripping a note built the way the generator builds it.
- Any unparseable or `null` value yields `null`, which renders as N/A. It never yields 0.

Since there is no DB schema, auth, or MCP-scope change, the ADR trigger list does not fire. If a later need arises to query these values in SQL, revisit option B as `0135_*` together with an ADR. The latest migration today is `0134_valuation_unit_explicit.sql`.

## Data contract

### New constants (exported from `business-case-generator.ts`)

```ts
/** |fade-DCF NPV − base p50| / |base p50| above which the RECOMMENDED target
 *  carries a "structure mismatch" warning. Display-only; never re-ranks. */
export const XCHECK_DIVERGENCE_WARN_RATIO = 0.5;
/** Global robotics M&A EV/Revenue screening band (inclusive), same source as
 *  ACQUISITION_EV_REVENUE_DEFAULT. */
export const ACQUISITION_EV_REVENUE_BAND = { min: 2, max: 6 } as const;
```

Threshold rationale for 0.5 (50%):

- The fade-DCF and the base structure share inputs (growth start, WACC, exit multiple). Moderate gaps of 10-30% are expected from the fade alone.
- A gap above 50% means the two standard structures disagree on the order of value. That calls for a human look at the growth or multiple assumptions, while the threshold stays quiet on ordinary fade effects.
- It is a named constant, so it can be tuned without touching logic.

### New parser

```ts
export interface CrossCheckOfNote {
  fadeNpv: number | null;   // xcheck_fade_npv (KRW_M)
  fadeIrr: number | null;   // xcheck_fade_irr ("null" → null)
  acqEvRevenue: number | null; // acq_ev=<m>x
}
export function crossCheckOfNote(note: string | null): CrossCheckOfNote;
```

The parser reads the **p50** note of the latest base model, which is the same row `anchorMethodOfNote` uses. Non-finite values parse to `null`.

### New `TargetComparisonRow` fields

| Field | Type | Semantics |
|---|---|---|
| `xcheckFadeNpv` | `number \| null` | Fade-DCF NPV (KRW_M) of the latest base model. `null` = no cross-check recorded (e.g. market-capture basis). |
| `xcheckFadeIrr` | `number \| null` | Fade-DCF IRR. `null` when not recorded or not computable. |
| `xcheckDivergence` | `number \| null` | `(xcheckFadeNpv - baseP50) / abs(baseP50)`, signed. `null` if either input is null or `baseP50 === 0`. |
| `structureMismatch` | `boolean` | `true` only when `recommended && xcheckDivergence !== null && abs(xcheckDivergence) > XCHECK_DIVERGENCE_WARN_RATIO`. Set inside `flagRecommendedTarget`, after the star is chosen. It never influences which row is chosen. |
| `acqEvRevenue` | `number \| null` | Assumed entry EV/Revenue multiple from `acq_ev`. `null` = not acquisition-priced. |
| `acqEvRevenueInBand` | `boolean \| null` | `min <= acqEvRevenue <= max`. `null` when `acqEvRevenue` is null. |

Existing fields and sort order are unchanged.

## UI changes (`BusinessCaseStage.tsx`, "targets" tab)

The UI must follow Onyx 3.0 (`docs/design-system/design-guide.md`) and use tokens only, with no hardcoded colors. `design:lint` must be clean.

- **New column "Structure cross-check (fade-DCF vs p50)".** Shows the signed percentage, e.g. `+12.4%` or `−63.0%`, with fade NPV (KRW millions) in a secondary line or tooltip. Null renders as `N/A` with a tooltip explaining that no fade-DCF cross-check was recorded for this case.
- **Structure-mismatch warning.** On the starred row only, when `structureMismatch`, show the warning status component: an icon plus the text "Structure mismatch — fade-DCF diverges >50% from base p50; review growth/exit-multiple assumptions". The threshold in the copy is derived from the constant. The star and its ordering are unchanged.
- **New column "Entry EV/Revenue".** Shows `3.0×` plus a band chip, either "Within 2–6× band" or "Outside 2–6× band" (warning tone with icon and text). Null renders as `N/A`.
- **Footnote under the table.** Explains that both columns are display-only, do not change the ranking, and that the recommendation remains a proposal for human selection.
- **Narrow breakpoints.** The two new columns collapse into the row's detail/expander pattern already used by the table, or into the standard responsive table behavior of the design guide. No new component is created.

## Accessibility (WCAG 2.1 AA)

- **Color is never the only signal.** The mismatch and out-of-band states each carry an icon and explicit text (1.4.1). The divergence sign is written out (`+` or `−`).
- **Contrast.** Warning chip text and icon use design tokens meeting 4.5:1 for text and 3:1 for the icon (1.4.3, 1.4.11).
- **Accessible names.** The warning has an accessible name (`aria-label` or visible text) that includes the target name. Tooltips are reachable by keyboard focus and dismissible (1.4.13, 2.1.1).
- **N/A cells.** These carry `aria-label="Not available: no cross-check recorded"` so screen readers do not read a bare "N/A".
- **Table headers.** These remain `<th scope="col">`, and the new headers have descriptive text.

## Test plan (extend `tests/unit/business-case-targets.test.ts`)

1. `crossCheckOfNote` parses a note built in the exact generator format, including the `xcheck_fade_irr=null` case. It returns all-null for a market-capture note, for a null note, and for garbage values.
2. Divergence math. p50=1000 with fade=1300 gives +0.3 and no warning. p50=1000 with fade=400 gives −0.6. p50=0 gives a null divergence.
3. A recommended row with divergence −0.6 gets `structureMismatch=true`. A non-recommended row with −0.9 gets `structureMismatch=false`.
4. **Ranking invariance.** Given rows where the best-p05 target has a huge divergence, it is still the one recommended. The sort order is identical to the pre-change output.
5. A target without an xcheck fragment has `xcheckFadeNpv/xcheckDivergence = null` and `structureMismatch=false`. Nothing is fabricated.
6. **Band.** 1.5 gives out, 2.0 gives in (inclusive), 6.0 gives in, 6.5 gives out, and null gives null. Band status never removes a row from the recommendation pool.
7. **DB-backed `recommendTargetsFromDb`.** Seeded simulations with these notes populate the new fields from the p50 note of the latest base model only.

## Preview verification

The frontend row must verify in the browser preview against a seeded brownfield project with at least one mismatch and one out-of-band target:

- At **two or more breakpoints**: desktop (≥1280px) and mobile (375px).
- At least **one interaction**: keyboard-focus the N/A or warning tooltip, or expand a row at mobile width, and confirm the text is exposed.
- `design:lint` must be clean.

## Non-goals

- Re-ranking, filtering, or demoting targets by divergence or band.
- Adding a schema migration or new columns.
- Changing how `fadedExitDcf` or the acquisition multiple are computed.
- Surfacing the cross-check for the historical variant, or for non-base scenarios.
- Any PASS, "consistent", or "verified" stamp.

## Task split

| Row | Agent | Scope |
|---|---|---|
| 1 | backend-engineer | In `app/web-next/lib/business-case-generator.ts`: add `XCHECK_DIVERGENCE_WARN_RATIO`, `ACQUISITION_EV_REVENUE_BAND`, `crossCheckOfNote`, and the six `TargetComparisonRow` fields. Populate them in `recommendTargetsFromDb` from the p50 note. Set `structureMismatch` in `flagRecommendedTarget` after the star is chosen, without changing the selection or sort. Extend `tests/unit/business-case-targets.test.ts` per the test plan. If a route or DTO projects the rows, pass the fields through unchanged. |
| 2 | frontend-engineer | In `app/web-next/components/stages/BusinessCaseStage.tsx` (targets tab): add the two columns, the star-row warning, the N/A handling, and the footnote, per the UI and Accessibility sections, using Onyx 3.0 tokens and components only. Run `design:lint` and do the preview verification. Depends on Row 1. |

## Review amendments

Applied after cross-domain review (UI only; ranking logic unchanged):

- The multiple column is labelled, in Korean, "assumed EV/Revenue multiple (entry = exit)": the generator writes `acq_ev` and `exit_ev` from the same `exitMult`, so it is not an entry-only multiple.
- The 2-6x chip uses neutral wording (Korean for "within screening range (reference)" / "outside range, needs checking"); the band is a robotics-M&A screening range, not a price verdict.
- A starred row without a cross-check shows an amber chip, Korean for "no cross-check", (silence is never approval); non-starred rows keep plain N/A.
- The absolute gap (fade NPV minus p50) is shown beside the percentage.
- The footnote warns that divergence is not comparable across targets when valuation bases are mixed.
- Accessibility: Korean aria-labels, no tabIndex on non-interactive spans, decorative glyphs aria-hidden.
- A unit test pins the UI-mirrored constants to the generator exports.
