# S8 Entry EV/Revenue Band — Global Reference Relabel and Human-Confirmed Project Band

- Date: 2026-10-11
- Status: Draft (Row 0 Design Gate; user decision "a+c", 2026-10-11)
- Owner: platform-lead (technical domain)
- Related: design 2026-10-11-s8-target-comparison-crosscheck-design (introduced `acqEvRevenueInBand`), design 2026-10-10-s8-acquisition-price-benchmark-design (origin of the 2-6x band and `bc.acquisition_ev_revenue`), ADR-0143, ADR-0117

## Problem

The project is a service / elder-care / hospitality humanoid solution business. The S8 target comparison judges each target's assumed entry EV/Revenue multiple against `ACQUISITION_EV_REVENUE_BAND = {min: 2, max: 6}` (`app/web-next/lib/business-case-generator.ts` ~L1387), a global robotics/automation M&A screening band. industry-lead found no sourced humanoid EV/Revenue benchmark in the repository. Presenting "Within 2-6x band" as a verdict therefore implies a domain fit that has no evidence behind it. Numbers must not be invented, and the industry-profile schema is not changed in this work.

## Decision (user-approved a+c)

**(a) Relabel the global band as unsourced reference.** The 2-6x band stays in code, unchanged in value, but every surface that shows it states that it has no source for this domain and is reference only:

- UI chip and tooltip in the targets tab (`BusinessCaseStage.tsx` ~L565-580).
- Generator rationale text for the entry multiple (`business-case-generator.ts` ~L874-878), which today reads, in Korean, "comp default 3.0x — global robotics M&A band 2-6x (conservative screening)". The new text says, in Korean, "comp default 3.0x — global robotics/automation M&A band 2-6x; no source for this domain, reference only".
- Table footnote.

**(c) Add a per-project, human-confirmed band** `bc.acquisition_ev_revenue_band` `{min, max}` with a mandatory rationale and a mandatory source note.

- When a confirmed band exists, it replaces the global band in `acqEvRevenueInBand` and in the chip label. The chip shows the confirmed range, and the tooltip shows the rationale, source, confirming user, and date.
- When no band is confirmed, `acqEvRevenueInBand` is `null`. The UI shows text meaning "Band not confirmed". The global band appears only as a labelled reference ("Reference: global robotics/automation 2-6x, no source for this domain"). No in-band or out-of-band verdict is shown.

The band remains display-only. It never re-ranks targets, never changes the RECOMMENDED rule, and never feeds valuation. Boundary #2 is unchanged: the recommendation is a proposal and a person selects.

## Storage decision — reuse `assumption`, no new column

Two `assumption` rows, `kind = 'user'`, written in one fresh run:

| assumption_key | value | rationale | anchor_ref |
|---|---|---|---|
| `bc.acquisition_ev_revenue_band.min` | min multiple | rationale text (mandatory) | source note (mandatory) |
| `bc.acquisition_ev_revenue_band.max` | max multiple | same rationale | same source note |

- `rationale` and `anchor_ref` already exist on `assumption` (migration 0003 / 0033). `anchor_ref` carries the source note (citation, document, URL, or "management judgement: <who>"). No migration is needed.
- **Audit trail:** the run row (`run.created_by` = confirming user id, `run.created_at`, label "EV/Revenue band confirmation") plus the assumption rows (`as_of`, rationale, anchor_ref) form an append-only history. Re-confirmation writes a new run; the latest wins, mirroring the `scalar()` resolution (`ORDER BY a.as_of DESC, r.created_at DESC, a.id DESC`). The route also writes the standard `audit_log` entry if the existing write path does so for params (backend-engineer to confirm and match).
- **Pair integrity:** the resolver reads min and max from the **same run** (the latest run that has both keys). A run with only one key is ignored. This prevents mixing a new min with an old max.
- **Clearing:** out of scope for v1 (see Open questions). A human can only overwrite with a new band.

### ADR determination

**No ADR required.** The ADR trigger list fires on DB schema change, auth change, and MCP tool scope change. This design adds no table or column (reuses `assumption.rationale` / `anchor_ref`), and adds one route to `HUMAN_ONLY_ROUTES`, which narrows agent capability rather than widening it; it adds no MCP tool. If review concludes a dedicated column (for example a typed `source` column) is needed, that is a DB schema change and requires an ADR before merge.

## Agent-vs-human rules (boundary #2)

Current state: `POST /api/projects/:id/business-case/params` is agent-reachable through the MCP tool `set_business_case_params` (`mcp/co-newbiz/tools/stage-tools.ts` L135) and is **not** in `HUMAN_ONLY_ROUTES` (`app/web-next/lib/mcp/in-process-port.ts` L137). Putting the band into that route would let an agent "confirm" a band. Therefore:

1. **Dedicated route** `POST /api/projects/:id/business-case/ev-band` (body `{min, max, rationale, source}`), added to `HUMAN_ONLY_ROUTES`. Role: analyst or higher (same as params). The in-process port refuses it for agent callers.
2. The general params route and `recordBusinessCaseParams` **reject** any `acquisition_ev_revenue_band*` key with 400 (`invalid_request`, message "use the human-only ev-band route"), so the MCP params tool cannot write it.
3. `GET /api/projects/:id/business-case/params` returns the resolved band (read-only), so agents can see it.
4. **Agents may only propose.** An agent may cite candidate multiples with sources in its analysis text or advisory output; it has no write path. No new MCP write tool is added. `mcp-coverage` must classify the new POST route as human-only (add to `scripts/co-newbiz/mcp-coverage.exclusions.yaml` with reason "human-only band confirmation, boundary #2"), matching how `business-case/adopt` and `target-selection` are handled.

## Validation (server-side, in route and in the record function)

- `min`, `max`: finite numbers, `0 < min < max`.
- Bounds sanity: `max <= 50` (an EV/Revenue above 50x is treated as an input error, not a band); `max / min <= 10` is **not** enforced (wide bands are legitimate, only flagged visually).
- `rationale`: trimmed, non-empty, at least 10 characters.
- `source`: trimmed, non-empty, at least 3 characters. "Management judgement" is an acceptable source string but must be explicit.
- Errors return 400 `invalid_request` with a field-specific message. Viewer role returns 403 `role_required`.
- The client form mirrors these checks for inline errors but the server is authoritative.

## Optimism-bias safeguard (risk-officer base-rate)

- The confirmed band is always shown next to the global reference band, never alone.
- **Flag factor: 1.5.** When `confirmed.max > 1.5 × ACQUISITION_EV_REVENUE_BAND.max` (that is, above 9x), the chip carries a warning: text meaning "Confirmed upper bound exceeds 1.5x the global reference upper bound (9x); check for optimism bias". New exported constant `EV_BAND_OPTIMISM_FLAG_FACTOR = 1.5`.
- Justification: the global band is already a wide screening band whose upper end covers high-growth robotics deals. Exceeding it by half again moves into the territory of peak-cycle, growth-premium multiples where reference-class evidence shows acquirers most often overpay. A factor of 2 (12x) would rarely fire before the damage is done; a factor near 1 would fire on any modest premium and be ignored. 1.5 is a named constant and can be tuned by an ADR-free code change with risk-officer sign-off.
- The flag is informational. It does not block saving and does not change ranking. It is also shown in the confirmation form before submit, so the human sees it at decision time.
- No RAG cap change: the band is not a data-confidence input.

## Data contract changes

### Constants and types (`business-case-generator.ts`)

```ts
export const EV_BAND_OPTIMISM_FLAG_FACTOR = 1.5;
export const EV_BAND_MAX_SANE = 50;
export interface ConfirmedEvBand {
  min: number; max: number;
  rationale: string; source: string;
  confirmedBy: string; confirmedAt: string; // run.created_by / run.created_at
  runId: string;
}
```

- `BusinessCaseParams` gains `acquisitionEvRevenueBand: ConfirmedEvBand | null`, resolved by a new `resolveConfirmedEvBand(db, projectId)` (same-run pair rule).
- New `recordEvRevenueBand(db, {projectId, min, max, rationale, source, actor, now?})`.

### `TargetComparisonRow`

| Field | Type | Semantics |
|---|---|---|
| `acqEvRevenueInBand` | `boolean \| null` | **Changed:** computed only against the confirmed band. `null` when no band is confirmed or `acqEvRevenue` is null. Never computed against the global band. |
| `acqEvBandSource` | `"confirmed" \| "none"` | New. Which band (if any) the verdict uses. |

The band itself is project-level, so it is carried once on the comparison payload, not per row.

### `listBusinessCases` / target comparison payload

New top-level object `evRevenueBand`:

```ts
{
  confirmed: ConfirmedEvBand | null,
  reference: { min: 2, max: 6, label: "global robotics/automation M&A screening band", sourced: false },
  optimismFlag: boolean // confirmed && confirmed.max > factor * reference.max
}
```

### `docs/architecture/openapi.yaml`

- New path `/api/projects/{id}/business-case/ev-band` (POST): request schema, 201 response with the resolved band, 400/403/404. Description states it is human-only.
- `getProjectBusinessCaseParams` response: add `acquisitionEvRevenueBand` (nullable).
- Business-case list / comparison response: add `evRevenueBand`, `acqEvBandSource`, and the changed nullability note on `acqEvRevenueInBand`.

### MCP parity

- No new MCP tool. `set_business_case_params` description gains "the EV/Revenue band is human-only and cannot be set here".
- `mcp-coverage` exclusion entry for the new POST route (human-only). `bun scripts/co-newbiz/mcp-coverage.ts` must pass.
- Read parity is automatic through `get_business_case` / params GET.

## UI changes

Onyx 3.0 tokens and existing components only; `design:lint` clean.

1. **Targets tab, "Entry EV/Revenue" column** (`BusinessCaseStage.tsx`).
   - Confirmed band: chip "Within confirmed X-Y× band" or "Outside confirmed X-Y× band" (warning tone, icon plus text). Tooltip: rationale, source, confirmed by, date.
   - Not confirmed: neutral chip meaning "Band not confirmed", and a secondary line "Reference: 2-6× (global, no source for this domain)". No in/out verdict.
   - Optimism flag: warning status component under the table header area when `optimismFlag` is true.
2. **Footnote** rewritten: the global band is an unsourced reference; the verdict appears only against a human-confirmed project band; display-only, no re-ranking, recommendation remains a proposal.
3. **ParamsPanel** (`components/business-case/ParamsPanel.tsx`): new section "Entry EV/Revenue band (human confirmation)" with fields min, max, rationale (textarea), source (text), a read-only display of the current confirmed band with who/when, the global reference shown beside the inputs, and the live optimism warning. It submits to the new ev-band route, separate from the general params submit (one primary action per section). Korean UI copy follows the existing panel style and the native-word preference.
4. Generator rationale text relabel at ~L874-878 (see Decision a).

## Accessibility (WCAG 2.1 AA)

- Verdict, "not confirmed", and optimism states each carry an icon and explicit text; color is never the only signal (1.4.1).
- Token-based contrast: text 4.5:1, icons and chip borders 3:1 (1.4.3, 1.4.11).
- Form inputs have visible `<label>`s; errors are linked with `aria-describedby` and announced via `role="alert"` (3.3.1, 3.3.2, 4.1.3). Required fields marked in text, not only with an asterisk.
- Tooltips with rationale/source are keyboard-focusable, dismissible with Escape, and persistent on hover (1.4.13, 2.1.1).
- "Band not confirmed" chip has an accessible name including the reference band text so screen readers do not hear a bare chip.
- Table headers stay `<th scope="col">`.

## Preview Verification

frontend-engineer verifies in the running app (preview tools) before handing back:

- Breakpoints: desktop (>= 1280px) and mobile (375px); tablet 768px recommended.
- Interaction: in ParamsPanel, enter min=2, max=10, rationale, source, observe the live optimism warning, submit, then confirm the targets tab chip switches from "Band not confirmed" to the confirmed verdict with tooltip who/when. Also submit min >= max and confirm the inline error.
- Console clean; screenshots of both breakpoints attached to the handback.

## Tests

Backend (`tests/unit/business-case-targets.test.ts`, plus a params/ev-band route test):

1. `recordEvRevenueBand` + `resolveConfirmedEvBand` round trip; latest run wins; a run with only `.min` is ignored (pair rule).
2. Validation: min=0, min=max, min>max, NaN, Infinity, max=51, empty rationale, empty source each rejected.
3. `acqEvRevenueInBand` is `null` with no confirmed band even when `acqEvRevenue` is 3.0 (regression on the old global verdict).
4. With confirmed band 4-8: 3.0 gives false, 5.0 gives true, boundaries inclusive.
5. `optimismFlag` true at max=9.01, false at max=9.
6. General params route rejects `acquisition_ev_revenue_band` keys with 400.
7. `isHumanOnly("POST", "/api/projects/x/business-case/ev-band")` is true; in-process port refuses it.
8. Ranking and RECOMMENDED unchanged across band states (display-only invariant).
9. Generator rationale string contains the "no source for this domain" relabel.
10. `mcp-coverage.ts` passes.

Frontend: component tests for chip states (confirmed in, confirmed out, not confirmed, optimism), and ParamsPanel form validation.

## Non-goals

- No industry-profile schema change and no humanoid benchmark entry (option b is a later follow-up owned by industry-lead).
- No invented multiples; the 2-6x values are not changed, only relabelled.
- No change to valuation, `bc.acquisition_ev_revenue`, ranking, RECOMMENDED rule, or RAG caps.
- No agent write path, no new MCP write tool.
- No band clearing / deletion UI in v1.

## Task split

**Row 1 — backend-engineer**

- Constants, `ConfirmedEvBand`, `resolveConfirmedEvBand`, `recordEvRevenueBand`, `BusinessCaseParams.acquisitionEvRevenueBand` in `business-case-generator.ts`.
- `acqEvRevenueInBand` against confirmed band only; `acqEvBandSource`; `evRevenueBand` payload with `optimismFlag`.
- Rationale relabel at ~L874-878.
- New route `app/web-next/app/api/projects/[id]/business-case/ev-band/route.ts` (POST; GET optional via params GET); `HUMAN_ONLY_ROUTES` entry; params route and `recordBusinessCaseParams` reject band keys.
- `openapi.yaml`, `set_business_case_params` description, `mcp-coverage.exclusions.yaml`.
- Backend tests 1-10.

**Row 2 — frontend-engineer** (after Row 1 contract is merged or stubbed)

- Targets tab chip/tooltip/footnote/optimism warning in `BusinessCaseStage.tsx` (update the mirrored constants comment at ~L91).
- ParamsPanel band section posting to the ev-band route.
- Component tests, `design:lint`, Accessibility checks, Preview Verification.

## Open questions for the human

1. Is 1.5x (flag above 9x) the right optimism threshold, or does the risk-officer prefer 2x?
2. Should a confirmed band be clearable (revert to "not confirmed") in v1, or is overwrite-only acceptable?
3. Is analyst role sufficient to confirm the band, or should it require a reviewer/lead role?
4. Should the 50x sanity ceiling be lower for this domain?

## Review amendments (risk-officer + security-engineer)

- Length caps: rationale <= 2000 chars, source <= 500 chars after trim; field-specific 400. Exported `EV_BAND_RATIONALE_MAX`, `EV_BAND_SOURCE_MAX`.
- Error hygiene: the ev-band route returns validation messages only for `EvBandValidationError`; any other failure returns 500 `internal_error` with a generic message and is logged server-side.
- Spread safeguard: `EV_BAND_SPREAD_FLAG_RATIO = 4.5` (1.5 x the global band max/min ratio of 3). Payload `spreadFlag = confirmed.max / confirmed.min > 4.5`. Warning only; never blocks, never changes rank.
- Staleness: `EV_BAND_STALE_DAYS = 90`. Payload `stale` (age >= 90 days) and `ageDays`, derived from `confirmedAt`; `evRevenueBandPayload` takes an injectable `now`. Warning only.
- Mixed basis: `listBusinessCases` returns `methodsMixed` alongside `evRevenueBand`; no change needed.
- Audit: `recordAssumption` appends one `assumption_set` audit_log row per key with target `<run_id>:<key>:user` and the actor. The values, rationale, source and project id are not in the audit row (they live in the assumption/run rows).
- Invariant: a test proves the ranking and RECOMMENDED flag are identical with no band, a confirmed band, and an optimism/spread-flagged band.

### Deferred (needs human policy)

- Require session-cookie auth for the ev-band write: PAT/bearer tokens with write scope can currently bypass `HUMAN_ONLY_ROUTES`, same as the existing human-only routes.
- Admin role separation for band confirmation.
- Reviewer approval step for band confirmation.
- Source-format validation (structured citation).
- Concurrent-overwrite warning (last writer wins today).
