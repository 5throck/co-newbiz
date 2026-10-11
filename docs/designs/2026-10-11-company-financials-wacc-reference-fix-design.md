---
title: Company financials WACC reference fix (reuse computeWaccReference) and DART sync error surfacing
status: approved
date: 2026-10-11
owner: platform-lead
domain: technical
---

# Company financials WACC reference fix

## 1. Problem

`GET /api/companies/[companyId]/financials`
(`app/web-next/app/api/companies/[companyId]/financials/route.ts`, ~L35-60) builds its own
`wacc_reference` block:

- `risk_free` and `credit_spread` are hardcoded `value: null` with a "ECOS source to be connected" reason.
- `beta_levered` is hardcoded `value: null` with a "KRX source to be connected" reason.
- `observed_de` is computed from the facts rows with `as_of = debt.created_at` (an ingestion timestamp,
  not the fiscal period) and ignores fiscal year (the `byAccount` map keeps whichever row was last).

Meanwhile `db/lib/wacc-reference.ts` `computeWaccReference(db, subjectCompanyId)` already derives
`risk_free` (series `ecos:721Y001:5020000`), `credit_spread` (`ecos:721Y001:7020000` minus Rf, same
month required) and `observed_de` (latest fiscal year, `as_of = YYYY-12-31`) with `source_label`,
`anchor_ref` and reasons. It is already consumed by
`app/web-next/app/api/projects/[id]/wacc/suggestions/route.ts`. It does **not** produce beta.

Result: the company page (`app/web-next/app/companies/[companyId]/page.tsx`, WACC reference card
~L150-160) shows N/A for Rf and spread although ECOS data exists, and two D/E implementations
disagree.

Second item: the DART sync button failure on the same page is written into the generic `message`
paragraph (L83, accent color, no `role`, top of page, far from the button) and shows the raw
server message. 409/503 failures are not clearly visible or actionable.

## 2. Decision

### 2.1 Single source of truth

The route calls `computeWaccReference(db, companyId)` and maps its result through a new pure
mapper `toCompanyWaccReferencePayload(ref, opts)` (location:
`app/web-next/lib/company-wacc-reference.ts`). The route no longer computes D/E itself.
`computeWaccReference` is not changed except as noted in 2.3 (no behaviour change for the
suggestions route).

If `computeWaccReference` throws (company missing) the route has already returned 404 from
`getCompanyFinancialFacts`; any other throw is caught and yields the all-N/A payload with reason
"reference could not be computed" (Korean UI string), never a 500 for the whole page.

### 2.2 Units

ECOS 721Y001 market rates are stored as **percent points** (e.g. 2.85 = 2.85%). The page formats
`pct(v) = v*100`, which expects a **ratio**. The mapper converts rate entries to ratio
(`value / 100`) and adds `unit: "ratio"` for rates and `unit: "multiple"` for D/E, so the page never
has to guess. The suggestions route keeps its current (percent) contract unchanged; the conversion
lives only in the company mapper. Backend-engineer must confirm the stored unit against a real
row (`SELECT value FROM fact_market_observation WHERE series_id='ecos:721Y001:5020000' LIMIT 1`)
before fixing the divisor; if values are already ratios the divisor is 1. A unit test pins it.

### 2.3 Beta

Beta stays N/A in this fix. The mapper appends a `beta_levered` entry with `value: null` and an
honest reason (Korean UI string meaning "KRX price data not yet collected (data-use approval
pending); enter manually in the WACC session"). No beta computation is added. If a later change
makes `computeWaccReference` emit `beta_levered` (e.g. from collected `krx:stock` series via
`db/lib/beta-regression.ts`), the mapper passes it through instead of the placeholder — the
mapper only fills the placeholder when the key is absent. This keeps the hook for Phase 8 with no
new computation now.

### 2.4 Stale-data honesty

- `as_of` for rates is the observation month `YYYY-MM` (e.g. `2026-09`); for D/E `YYYY-12-31`.
- The page renders `as_of` verbatim as a month/fiscal-year label (not `new Date(...)`, which turns
  `2026-09` into a locale date and hides that it is monthly). Format: "ECOS monthly, 2026-09" /
  "DART consolidated, FY2025".
- Spread with mismatched months (Rf 2026-09, corp bond 2026-08): value null, reason states the
  months differ and names both (Korean UI string "Rf and corporate-bond months differ (2026-09 vs
  2026-08) — spread not computed"). This requires a small reason refinement in the mapper (it has
  both months via a new optional `debug_as_of` — see 2.5) or in `computeWaccReference` (preferred:
  add the mismatched-month reason there; the suggestions route benefits identically and its
  contract shape is unchanged).
- Missing series: value null, reason from `computeWaccReference` ("ECOS series not collected").
- The approximation caveat on a computed spread (not company-rating specific) moves to a separate
  `note` field so `reason` is reserved for "why N/A". The page shows `note` under the value.

### 2.5 Payload contract (backward compatible)

`wacc_reference` keeps `entries[]` and `latest_year`; all existing entry keys remain.

```ts
interface CompanyWaccReference {
  subject: { id: string; name_ko: string | null };   // unchanged key names
  entries: Array<{
    key: "risk_free" | "credit_spread" | "observed_de" | "beta_levered";
    label: string;            // Korean UI label
    value: number | null;     // ratio for rates, multiple for D/E
    unit: "ratio" | "multiple";        // NEW
    as_of: string | null;     // "YYYY-MM" for rates, "YYYY-12-31" for D/E
    anchor_ref: string | null;          // "src:ecos" | "src:dart" | null
    source_label: string | null;        // NEW (passed through)
    reason: string | null;    // only when value is null
    note: string | null;      // NEW, caveat when value is present
  }>;
  latest_year: string | null;  // unchanged (analysis.years last)
  missing: string[];           // NEW, keys with value null
  disclaimer: string;          // NEW, Korean: proposal only, a person confirms in the WACC session
}
```

Order: risk_free, credit_spread, observed_de, beta_levered (unchanged). `openapi.yaml` schema for
this endpoint is updated with the additive fields.

### 2.6 Wording, writes

The card keeps the "proposal only; a person confirms values in the WACC input session" wording
(now also in `disclaimer`). The endpoint performs no writes.

## 3. DART sync error surfacing (item 2)

Error path: sync route returns `fail(409, code, message)` or `fail(503, "dart_not_configured", ...)`;
`lib/api.ts` throws `ApiError(status, code, message)` (L71). The page catch currently uses only
`e.message`.

Change (page only):

- Separate state `syncError: { code: string; text: string } | null` from the success `message`.
- Render it directly below/next to the sync button(s) (both L114 and L168 locations) as
  `<p role="alert">` using the existing red error style (`--red-fg`), with a visible icon and text
  (not color only).
- Persistent until the next sync attempt or navigation; cleared at the start of `runSync`.
- Map `ApiError.code` to actionable Korean guidance (English meaning shown):
  - `dart_not_configured` - "DART API key is not configured; ask the operator to set DART_API_KEY in the root .env."
  - `corp_code_unresolved` - "This company has no DART corp code; link the correct listed company and retry."
  - `DART_RATE_LIMITED` - "DART call limit reached; retry in a few minutes (daily quota may be exhausted)."
  - `DART_HTML_BLOCKED` - "DART returned a block page instead of data; retry later or from an allowed network."
  - `dart_retrieval_failed` - "DART retrieval failed; retry, and if it repeats check the server log."
  - unknown code - generic failure plus the server message.
  The server message is appended in smaller text for diagnosis. Codes are matched case-sensitively
  as emitted; backend-engineer confirms the exact codes the sync route can surface from
  `lib/dart-client.ts` (whether `DART_HTML_BLOCKED` / `DART_RATE_LIMITED` reach the envelope as
  their own code or are wrapped into `dart_retrieval_failed`). If wrapped, Row 1 passes the inner
  code through unchanged in the envelope `code` (no status change).

## 4. Tests

Unit (bun test, seeded temp DB via `CO_NEWBIZ_DB_PATH`), new `tests/unit/company-wacc-reference.test.ts`:

1. Both ECOS series present, same month: risk_free and credit_spread non-null, values in ratio,
   `as_of` = `YYYY-MM`, `source_label` set, `note` set on spread, `reason` null.
2. Corp bond series missing: risk_free present, credit_spread null with not-collected reason.
3. Mismatched months (Rf 2026-09, corp 2026-08): spread null, reason names both months.
4. No ECOS rows at all: both null, `missing` includes both.
5. No financial facts: observed_de null with reason, `latest_year` null.
6. Facts for two fiscal years: observed_de uses the latest year, `as_of` = `YYYY-12-31` (not created_at).
7. beta_levered always present, value null, KRX-pending reason; passthrough when ref supplies it.
8. Route test: GET returns 200 with the shape above; suggestions route output unchanged (regression).

Frontend: component/unit test of the error-code mapper (all five codes + unknown), and that the
alert renders with `role="alert"` near the button.

## 5. Accessibility

- Sync error: `role="alert"` (assertive announcement), text plus icon, not color-only, placed
  adjacent to the triggering button, persists until next action.
- WACC card: N/A values keep the reason as visible text; `as_of` is plain text, not a tooltip.
- Onyx 3.0 tokens only; `design:lint` must pass.

## 6. Preview verification

Frontend row verifies in the preview: open a company with ECOS data in DB; Rf and spread show
percentages with "ECOS monthly, 2026-09"-style dating (or spread N/A with the month-mismatch
reason, which is the expected state with Rf 2026-09 / corp 2026-08 as currently loaded); beta N/A
with KRX-pending reason. Trigger sync with DART key unset to see the 503 alert next to the button.
Screenshot both.

## 7. ADR assessment

No ADR required: no DB schema change, no auth/permission change, no MCP tool scope change. The
API change is additive on an existing read endpoint and reuses an existing library. If
`computeWaccReference` gains the mismatched-month reason (2.4), it is a string change only.

## 8. Non-goals

- No beta computation, no KRX collection changes.
- No change to the WACC session, `record_wacc`, or any write path.
- No company-specific credit rating lookup.
- No change to the suggestions route contract.

## 9. Task split

| Row | Agent | Scope |
|---|---|---|
| 1 | backend-engineer | `lib/company-wacc-reference.ts` mapper; route reuse; unit conversion confirmation; mismatched-month reason in `computeWaccReference`; sync error code passthrough check; openapi update; tests 1-8 |
| 2 | frontend-engineer | page: `unit`/`as_of`/`note`/`disclaimer` rendering; sync `syncError` alert near button with code mapping; tests; preview verification |

## 10. Open questions

1. Confirm ECOS stored unit (percent vs ratio) on a real row - drives the divisor.
2. Do `DART_HTML_BLOCKED` / `DART_RATE_LIMITED` currently reach the envelope `code`, or are they wrapped?
3. With the current data (Rf 2026-09, corp 2026-08), spread will show N/A. Should spread instead fall
   back to the latest common month (2026-08) with that month shown? Default in this design: strict
   same-month as today; fallback deferred to a human decision.

## 11. Amendments (Row 1 backend, 2026-10-11)

1. ECOS stored unit resolved from code (no DB read): `scripts/co-newbiz/source-adapters.ts` stores the ECOS `DATA_VALUE` via `Number()` and declares `unitCode: "percent"` for both 721Y001 series, so values are percent points (2.85 = 2.85%). The mapper divides rates by 100 (`ECOS_PERCENT_DIVISOR`); a unit test pins it. The suggestions route keeps percent points.
2. DART error codes: `fetchFinancials` swallows dart-client errors into a `lastError` string, and `syncCompanyFinancialFacts` wraps it as code `dart_retrieval_failed` with message `DART 조회 실패 — <lastError>`. `DART_HTML_BLOCKED` / `DART_RATE_LIMITED` therefore reach the client only as substrings of the message, never as the envelope `code`. The sync route returns `err.message` intact (409; 503 for `dart_not_configured`). dart-client semantics are unchanged; the frontend maps by code first, then by message substring.
3. Human-decision default (open question 3): the credit spread is computed from the latest month in which BOTH the risk-free and corporate-bond series have an observation, `as_of` = that month, and `note` states the period and that the Rf latest month may be newer. It is N/A only when there is no common month, with a reason naming both latest months. This supersedes the strict same-month rule in 2.4 and changes `computeWaccReference` spread selection (suggestions route shape unchanged; with same-month data its output is identical). Reversible by a human decision.
4. `ReferenceEntry` gained an optional `note`; for a present value `reason` is null and the approximation caveat lives in `note`.
