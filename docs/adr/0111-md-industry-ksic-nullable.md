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
   search endpoint. The picker follows the app's established explicit
   search-button pattern (the DART picker precedent): input + "검색" button,
   results presented in a `sizing-note-list` listbox on the create form only —
   the table's inline row editor keeps its plain ADR-0082 RowEdit-style input.
   No new CSS component classes are introduced. The dataset is explicitly a
   curated subset (source and revision recorded in the file); it is extended
   from KOSTAT's official 11th-revision list as new profiles are added — it
   is not presented as the full ~10k-code master.

## Revision 2026-09-09 (design-conformance amendment)

The first implementation used a debounced auto-suggest combobox (query per
keystroke, list on focus) plus a bespoke `.ksic-suggest-list` CSS component.
Design review against the design guide (§6 Component Standard), the design
review checklist (no implicit new components/tokens), and the standard screen
patterns rejected that interaction: it was reworked to the explicit
search-button pattern above in the same working day. The API, dataset,
validation, and nullable-migration decisions in this ADR are unchanged.

## Revision 2026-09-10 (official-name verification amendment)

`name_ko` in the curated dataset now carries the **official KSIC 11th-revision
name** for every code; profile-internal labels ("발전소 O&M 서비스업" for
74100, "신재생에너지 발전업" for 35114, "수소 연료전지 발전업" for 35119,
"정보보안 서비스업" for 63999) moved to the detail field as explicit aliases,
after a user report showed 74100 rendered under its alias. Verification source:
the categoryofbusiness.com KSIC-11 database, cross-checked against official
11th-revision renumbering examples (10801 → 10901/10902; the 282 rename).
Four profile anchors were found to conflict with the 11th revision and are
**excluded from the dataset pending profile correction**: 264 (semiconductors;
11차 264 = 통신·방송장비, 반도체 = 261/26111/26112), 29192 (robots; 11차 29192 =
분사기·소화기, 산업용 로봇 = 29280), 30111 (shipbuilding; 11차 강선 = 31111),
30303 (space; no such 11차 code, 우주선 under 3131). Correcting those profile
anchors is owner-approved content and follows the normal profile-governance
path — the picker must not assert code↔industry mappings it cannot verify.

### Anchor correction (approved same day, 2026-09-10)

The owner approved the anchor corrections. The in-force classification was
pinned with a second, independent evidence line before rewriting: DART-
registered induty codes of pure-play companies (두산로보틱스 = 2928, 한화오션 =
3111, SFA반도체/DB하이텍 = 2611 전자집적회로) agree with the KSIC-11 database
and rule out the "2차 조정안" crosswalk the profiles had originally cited.
Applied: `KSIC264.yaml`→`KSIC261.yaml` (code 261), `KSIC29192.yaml`→
`KSIC29280.yaml` (code 29280), `KSIC30111.yaml`→`KSIC31111.yaml` (code 31111),
`KSIC30303.yaml`→`KSIC3131.yaml` (code 3131, 소분류 — no dedicated 우주선
5-digit code exists). The four codes re-joined the picker dataset with their
official names; `migration 0079` remaps any `md_industry.ksic_code` rows
written under the stale anchors (collision-guarded; the HYD-BRK sentinel is
untouched). The research doc records a dated correction of the rejected
crosswalk claims.

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
