# Design: Retention `delete_only` handling — i18n and UI completeness

Date: 2026-11-04
Owner: frontend-engineer (dispatched via PM Gateway)
Status: implemented

## Problem

The admin Ops screen renders retention `handling` labels through dynamic keys,
`t(\`handling_${e.handling}\`)` and `t(\`handlingHint_${e.handling}\`)`. The
server-side registry (`db/lib/retention-registry.ts:63`) defines three handling
values — `archive_then_delete`, `archive_only`, `delete_only` — but the locale
catalogs only defined the two archive variants. Any table using `delete_only`
(job_run, execution_job, and one more) rendered the next-i18next fallback
`MISSING_MESSAGE: Could not resolve 'admin.ops.handling_delete_only' ... locale 'ko'`.

## Evidence

- `db/lib/retention-registry.ts:63` — `RetentionHandling = "archive_then_delete" | "archive_only" | "delete_only"`.
- `app/web-next/components/admin/console/OpsSections.tsx:114,117,218,219` — dynamic template-literal keys.
- `app/web-next/locales/{ko,en}.json` (~line 185) — only `handling_archive_*` / `handlingHint_archive_*` present.
- `app/web-next/lib/api.ts:620` — client type narrowed to `"archive_then_delete" | "archive_only"`.

## Change

1. `app/web-next/locales/ko.json` + `en.json` — add `handling_delete_only` and
   `handlingHint_delete_only` after `handlingHint_archive_only`, matching sibling tone.
2. `app/web-next/lib/api.ts` — widen `DatabaseOverviewTable.handling` to include `"delete_only"`.
3. `app/web-next/components/admin/console/OpsSections.tsx` (retention policy table,
   "Action" column) — prefer the registry entry's `handling` for the label
   (`entry ? t(\`handling_${entry.handling}\`) : ...`); the previous mapping from the
   lossy stored `retention_policy.action` (`delete_only → "delete"`, identical to
   `archive_then_delete`) rendered "Archive, then delete" for delete-only policies.
4. `app/web-next/components/admin/console/useAdminActions.ts` (`saveRetention`) —
   the irreversible-delete confirmation gate now also fires for `handling === "delete_only"`
   (previously only `archive_then_delete`), since delete-only also destroys data outright.

Server side (`db/lib/retention-registry.ts`, `scripts/co-newbiz/jobs/retention-cleanup.ts`)
was already correct and is unchanged.

## Verification

- `bun run lint:i18n` — PASS before and after (0 violations); the linter does not
  statically resolve template-literal keys, so it cannot catch this class (noted for
  validator hardening, not implemented here).
- `typecheck:web` (`tsc --noEmit` in app/web-next) — 0 errors.
- Unit tests `i18n-parity`, `i18n-catalog-gaps`, `admin-password-reset-login-flow`,
  `admin-schedule-panel` — 68 pass, 0 fail.
- `bun scripts/validate-md-language.ts` — no language violations.
