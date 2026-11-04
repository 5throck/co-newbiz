# Design: i18n-lint dynamic-key catalog coverage (validator hardening D8)

Date: 2026-11-04
Owner: backend-engineer (dispatched via PM Gateway)
Status: implemented

## Problem

`i18n-lint` (the re-liquefaction guard, design 2026-10-23-i18n-ui-adoption §3.6)
has two checks: a Korean-line baseline count and an unresolved dotted-key scan.
Neither can catch the failure class shipped this morning
(design 2026-11-04-retention-handling-i18n): a UI component builds translation
keys at runtime by interpolating an enum value into a template literal —
`t(\`handling_${e.handling}\`)` — and a value added to the enum
(`RetentionHandling` gained `delete_only`) without a matching catalog entry
renders `MISSING_MESSAGE` to the user. The linter treats template-literal keys
as plain text and never cross-checks enum values against the locale catalogs,
so `bun run lint:i18n` passed green on the broken tree.

## Evidence

- `app/web-next/components/admin/console/OpsSections.tsx:114,117,154,218,219` —
  dynamic template-literal keys `t(\`handling_${...}\`)` /
  `t(\`handlingHint_${...}\`)` over `RetentionHandling` values.
- `db/lib/retention-registry.ts:63` — `export type RetentionHandling =
  "archive_then_delete" | "archive_only" | "delete_only";` — the vocabulary of
  record (the file's own header says so).
- `app/web-next/locales/{ko,en}.json` — before this morning's fix,
  `admin.ops.handling_delete_only` / `admin.ops.handlingHint_delete_only` were
  absent.
- `scripts/co-newbiz/i18n-lint.ts` v1.1.0 — no check correlates enum unions
  with catalog keys; `tests/unit/i18n-{parity,catalog-gaps,namespace-keys}.test.ts`
  all resolve static string literals only, so the dynamic-key class was
  un-owned.

## Approach

New third check in `scripts/co-newbiz/i18n-lint.ts` (v1.2.0):
**dynamic-key catalog coverage**.

1. **Family table (in-script config)** — each entry declares a dynamic key
   family: the interpolated prefix, the locale namespace the keys live under,
   and the SSOT that owns the value domain. Two entries ship, sharing one
   source: `{ prefix: "handling_", namespace: "admin.ops" }` and
   `{ prefix: "handlingHint_", namespace: "admin.ops" }`, both sourced from
   `RetentionHandling` in `db/lib/retention-registry.ts`. Adding a future
   family is a one-line config addition, no code change.

2. **valuesSource decision: parse the type-union declaration, not the runtime
   table data.** The union literals are extracted with a regex over the
   `export type RetentionHandling = ...;` declaration (quoted string literals
   inside the declaration span, after comment/string-aware stripping so a
   quoted example in a comment cannot pollute the result).

   Chosen over deriving from `RETENTION_ELIGIBLE_TABLES` runtime data because:
   - The union is the closed vocabulary the UI must cover: OpsSections renders
     `t(\`handling_${e.handling}\`)` for any value the server can send, i.e.
     any member of the union. Table data only enumerates values *currently
     assigned* to shipped tables; a value declared but not yet assigned (or
     orphaned after a table reassignment) would silently drop out of a
     table-derived check, and the bug returns the day a table adopts it.
   - The declaration is a single line that changes exactly when the vocabulary
     changes — no drift between "what changed" and "what gets checked".
   - Regex parsing keeps the linter a static text tool like its other two
     checks: no module import of db code into the lint path (the registry
     happens to be import-free today, but that is incidental), and the parser
     is pure and trivially unit-testable with inline fixtures.

   Fail-loud trade-off: if the declaration cannot be located or yields zero
   literals (renamed type, exotic reformat), the check reports a violation
   naming the unparseable source instead of silently passing — a linter that
   stops reading its SSOT must fail, not green-light.

3. **Coverage assertion** — for each family × enum value × locale (`ko`, `en`),
   resolve the full dotted key (`admin.ops.handling_delete_only`) by walking
   the nested JSON of `app/web-next/locales/<locale>.json` and require a
   non-empty string leaf. Missing keys are hard violations appended to the
   same report as the existing checks and contribute to the same non-zero
   exit, so `bun run lint:i18n` fails.

4. **Purity for tests** — the scan function
   (`scanDynamicKeyCoverage(families?, projectRoot?, catalogs?)`) accepts
   in-memory catalogs, so the negative test deep-copies the resolved `ko`
   catalog, deletes `admin.ops.handling_delete_only`, and asserts exactly that
   violation is reported — no fixture files on disk, real locale files are
   never touched.

5. **Output/exit integration** — text mode prints one line per missing key
   (locale, full key path, values source) plus a
   `i18n-lint dynamic-keys: PASS/FAIL — N missing catalog key(s).` verdict
   line mirroring the dotted-keys verdict; `--json` adds a
   `dynamicKeyCoverage` array. Existing checks and their output format are
   unchanged.

## Enforcement wiring

Survey: `lint:i18n` (package.json:40 = i18n-lint + locale-jargon-lint) is not
invoked by any `.github/workflows/` step, `scripts/dev-sync.ts`,
`scripts/audit.ts`, or `scripts/hooks/*`. It IS enforced in CI via the unit
suite: `.github/workflows/ci.yml` (`test:unit`, two jobs) runs
`tests/unit/i18n-lint.test.ts` and `tests/unit/i18n-dotted-keys-lint.test.ts`,
which call the linter functions directly and fail the suite on violations —
the wiring model documented in the i18n-lint header since v1.0.0. No new CI
step is added: the new check is enforced the same way, by
`tests/unit/i18n-dynamic-key-lint.test.ts` (auto-discovered by
`scripts/test-runner.ts` unit suite = `tests/unit/*.test.ts`), so the same
CI job fails a PR that adds an enum value without catalog keys. A separate
`lint:i18n` step in quality.yml would re-assert the identical conditions with
a second interpreter boot and would drift from the established
unit-test-is-the-gate pattern; the package.json script stays available for
local runs (and `--json` consumers).

## Files changed

- `scripts/co-newbiz/i18n-lint.ts` — v1.2.0: family table, union parser,
  `scanDynamicKeyCoverage()`, report/exit integration, header note.
- `tests/unit/i18n-dynamic-key-lint.test.ts` — new: parser fixtures (inline +
  multi-line), positive scan against the real tree, negative in-memory
  missing-key scenario.
- `scripts/SCRIPTS.md` — i18n-lint row version bump + check description.
- `docs/designs/2026-11-04-i18n-dynamic-key-lint-design.md` — this doc.

## Verification

- `bun run lint:i18n` — PASS with the new check active (all 6 keys present:
  3 values × 2 prefixes × 2 locales).
- Negative proof — unit-test path deletes the key from an in-memory deep copy:
  exactly `ko admin.ops.handling_delete_only` is reported; real locale files
  untouched and still pass.
- `bun run test:unit` — green (new test + all existing suites).
- `bun scripts/verify-scripts.ts --verify` — green after the SCRIPTS.md edit.
- `bun scripts/audit.ts` — ALL PASS after projection regen
  (`generate-version-manifest.ts`).
- `bun scripts/validate-md-language.ts` — clean.
