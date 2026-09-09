# ADR-0111: `md_industry.ksic_code` becomes nullable — retiring the fabricated `NEW-*` placeholder codes and adding a KSIC code picker

- Status: Accepted
- Date: 2026-09-09
- Deciders: New Business Review Lead (PM)
- Deciders note: bug-fix driven — the /market list rendered internal ULID fragments (`NEW-FXENCH`-style) in the KSIC 코드 column, and new analyses could not actually pick a code
- Related: ADR-0002 (portability, pure-SQL migrations), ADR-0014 (pre-migration backup), 0033/0061 (`@notransaction` table-rebuild precedent), `docs/architecture/db-schema.md` §2, ADR-0109 (route error wrapper)

## Context

`POST /api/market-overview/analyses` created `md_industry` rows with
`ksic_code ?? \`NEW-${id.slice(-6)}\`` — a fabricated placeholder built from
the last six characters of the row's ULID — because `ksic_code` was
`TEXT NOT NULL` with a UNIQUE index and the create form treats the code as
optional. Consequences:

1. The /market list and detail views rendered those placeholders verbatim in
   the KSIC 코드 column, so users saw codes like `NEW-FXENCH` that look like
   corrupted data (they are internal ID fragments, not KSIC codes).
2. There was no way to actually choose a code: the KSIC input is a bare
   free-text field with no code list or suggestions anywhere in the app.
3. When the 산업명 matched an existing industry (name-based dedup), a newly
   typed KSIC code was silently discarded.

The nullability fix requires a table rebuild (SQLite cannot drop a NOT NULL
constraint in place). Separately, `ksic_code = 'HYD-BRK'` is **not** a
placeholder: it is a load-bearing freeze sentinel for the seeded hydraulic
breaker matrix (`app/api/market-overview/insights/route.ts` supplements its
bottom-up CAGR; the /market detail uses it for the frozen-analysis banner).
A blanket "NULL out everything non-numeric" would break those two surfaces.

## Decision

1. **`md_industry.ksic_code` becomes nullable TEXT** (migration 0078,
   `@notransaction` rebuild per the 0061 pattern). `NULL` means
   "KSIC 미지정" and renders as `—`. The UNIQUE index is recreated — SQLite
   unique indexes treat NULLs as distinct, so any number of unspecified
   industries may coexist. Existing values matching `GLOB 'NEW-*'` are nulled
   in the same pass (this covers both runtime-generated `NEW-<ulid6>` rows
   and the `NEW-HR` row written by a scratch script). Prisma
   `schema.prisma` is aligned by hand (`String?`) to match the pulled schema.
2. **The create flow stores what the user typed — or NULL.** The
   `NEW-${id.slice(-6)}` fabrication is removed. When the name-based dedup
   finds an existing industry and the caller supplied a code, the supplied
   code is applied (fill-if-null, update-if-different) instead of being
   dropped. KSIC unique-index collisions surface as a friendly
   `code_in_use` 409-style error instead of a raw 500.
3. **Validation**: user-supplied codes must be 2–6 digits (`^\d{2,6}$`, KSIC
   중분류…세세분류 levels) or the exact `HYD-BRK` sentinel (kept valid so the
   seeded freeze row stays editable). Shared helper `lib/ksic.ts`
   (`parseKsicInput`) is used by both the create and PATCH routes.
4. **KSIC code picker**: a curated KSIC reference dataset
   (`app/web-next/lib/ksic-master.json` — KSIC 11th revision section/division
   entries plus every code anchored by an `industry-profiles/KSIC*.yaml`
   profile) backs a new authenticated `GET /api/market-overview/ksic?q=`
   search endpoint and a suggestion listbox on the create form and the
   inline row editor. The dataset is explicitly a curated subset (source and
   revision recorded in the file); it is extended from KOSTAT's official
   11th-revision list as new profiles are added — it is not presented as the
   full ~10k-code master.

## Consequences

- No new fabricated identity codes are ever written; existing ones disappear
  from the UI on next server boot (migration runs in `instrumentation.ts`).
- The KSIC column honestly shows `—` for unspecified industries, and the
  existing inline editor (PATCH) remains the correction path.
- `HYD-BRK` keeps its special-cased behavior; it is now the only sanctioned
  non-numeric value and is allowed explicitly, not by accident.
- Migration 0078 is `@notransaction` and `@reversible` only via the
  pre-migration backup (ADR-0014) or a manual rebuild; the data change
  (NEW-* → NULL) is not information-preserving by design — those strings
  carried no information.
