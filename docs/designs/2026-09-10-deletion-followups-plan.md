---
lang: ko
lang_reason: source-material
---

# Deletion & Archive Follow-ups — Implementation Plan

- Date: 2026-09-10
- Status: proposed
- Relates to: `docs/runbooks/deal-deletion-playbook.md`, migration `0081_deletion_marks.sql`,
  ADR-0002 (portability), ADR-0012 (audit append-only), ADR-0039 (data minimization/retention),
  ADR-0040 (MNPI), ADR-0056 (retire convention), ADR-0091 (admin role separation)
- Decided policies carried over from stakeholder review (2026-09-10):
  archive access = members at mark time, permanently; retention = unlimited
  (no purge engine value registered for deals); unpromoted opportunities are
  delete-marked with their own manifest; deletion is a tombstone, never row
  removal.

This plan covers the five work items deferred when the deletion-mark model
shipped: (A) un-delete, (B) deletion-reason UI, (C) evidence-file policy,
(D) archive document export, (E) retention/purge engine.

---

## A. Un-delete (삭제 표시 해제)

**Current.** `deleted_at/deleted_by/delete_reason` can be stamped but never
cleared. There is no restore path for an erroneous deletion.

**Design.** Un-delete clears the marks atomically across the deal chain — the
project mark and its source-opportunity mark clear together (same unit as
deletion). `deal_archive` is append-only and is NOT rewritten; the archive
screen's "삭제된 딜" list joins live rows, so an un-deleted deal leaves that
list automatically while its manifest history remains as audit evidence.

- API (all return the restored entity; audit `*_undelete`):
  - `POST /api/projects/[id]/undelete` — lead-only; clears project + source
    opportunity marks.
  - `POST /api/opportunities/[id]/undelete` — analyst+.
  - `POST /api/our-company/groups/[id]/undelete`, and
    `POST /api/our-company/groups/[id]/members/undelete` (`{member_id}`) —
    analyst+.
- 409 `already_live` if the target is not currently marked.
- UI: 아카이브 화면 "삭제된 딜" rows get 복원 (members; lead for projects).
- Tests: mark → un-mark → lists show the deal again; audit rows written;
  permission matrix (lead vs analyst vs viewer vs admin).

## B. Deletion-reason UI (삭제 사유 입력 고도화)

**Current.** DELETE routes accept an optional `reason` (project/opportunity
derive a fallback string; group/member accept `reason` in body). No UI input
exists, so `delete_reason`/`deal_archive.reason` is nearly useless for audit.

**Design.**
- `DELETE /api/projects/[id]` accepts `{ reason }` — **required** (non-empty;
  400 `reason_required` otherwise). Stored on `md_project.delete_reason`,
  the source-opportunity mark, and `deal_archive.reason`.
- Opportunity / group / member deletes: reason optional, stored as-is.
- UI: `/projects` 삭제 button swaps `useConfirm` for a reason dialog
  (CloseDialog shape: `modal-panel` + required input + 저장). our-company
  group/member dialogs gain an optional reason field.
- Archive detail already renders `reason` — no change needed there.
- Tests: reason propagates to `delete_reason` + manifest; empty reason → 400;
  UI-level validation mirrors the server rule.

## C. Evidence-file policy (근거 파일 자체의 정책)

**Current facts (verified).**
- Uploads: `POST /api/our-company/members/[memberId]/upload` (and the synergy
  upload route) write to `join(process.cwd(), "..", "workspace", "uploads")` —
  a **cwd-relative path** (portability hazard, ADR-0002), sanitized
  `ulid()-name` filenames, 20 MB cap, analyst+ only.
- **No database registry.** The upload response returns `stored_as` and the
  linkage to a member/deal is manual. There is no download/serve route, so
  files are effectively write-only today.

**Design.**
1. **Registry** (migration 0082): `uploaded_file` — `id`, `stored_as` UNIQUE,
   `original_name`, `size`, `mime`, `sha256`, `uploaded_by`, `context_type`
   ('member' | 'synergy' | …), `context_id`, `created_at`,
   `deleted_at/deleted_by/delete_reason` (same tombstone doctrine).
   Upload routes insert a registry row; a backfill script scans
   `workspace/uploads` and registers orphans (context nullable).
2. **Path fix**: resolve the uploads directory from the repo layout
   (`DB_DIR` sibling `workspace/uploads`, overridable via
   `CO_NEWBIZ_UPLOADS_DIR` env) instead of `process.cwd()`.
3. **Authenticated download**: `GET /api/files/[id]` — membership of the
   owning group/project, or analyst+; admins blocked for deal-context files
   (role separation); every download audit-logged (logDataAccess pattern).
   Streams with `original_name`.
4. **Lifecycle**: files follow the owner's lifecycle — deletion marks keep
   files; physical purge happens only through the retention engine
   (Workstream E) once a file-retention policy is registered. Until then:
   unlimited.
5. **Limits**: keep 20 MB; add a MIME/extension allowlist
   (pdf, docx, doc, xlsx, pptx, hwpx, png, jpg) — anything else 400.
6. Runbook gains an evidence-file section (storage layout, access rule,
   lifecycle).

**Tests.** registry row written on upload; download auth matrix
(member / outsider 404 / admin 403); oversize and disallowed-type 400;
path independence via `CO_NEWBIZ_UPLOADS_DIR`.

## D. Archive document export (아카이브 문서 내보내기)

**Current.** `scripts/co-newbiz/report.ts` exports `renderReport()` —
markdown → docx/pdf/hwpx through the shared python AST with the glossary
appendix. The archive holds the manifest; the retained live rows hold the
data.

**Design.**
- `GET /api/archive/deals/[id]/export?format=docx` — member-only (allowlist),
  audited (`archive_export`), admin blocked.
- Server assembles a Markdown summary: deal identity (no/name/track/status at
  mark), deletion/archive record (who/when/reason), opportunity summary, gate
  decisions, charter purpose + KPIs, market freeze references (industry →
  analysis → version), synergy verdicts, evidence file list (from Workstream C
  registry) → renders via `renderReport()` → streams the file.
- Caching: `workspace/exports/<archiveId>-<format>.docx`; regenerated on
  request if absent; export event audit-logged regardless of cache.
- docx first; pdf follows (Korean TTF pipeline already exists).

**Tests.** auth matrix; produced file non-empty with correct content-type;
audit row; cache reuse (second call does not re-render).

## E. Retention / purge engine

**Current.** `retention_policy` (0005: `table_key`, `basis`,
`retention_months`, `action` 'archive'|'delete', `last_run_at`) has admin CRUD
but **no executing engine**. `schedule_job`/`job_run` (0007) plus the
OS-scheduler-invoked script pattern exist (`watch-run.ts`: insert running
`job_run` → work → update status).

**Design.**
1. `scripts/co-newbiz/retention-run.ts` — `JOB_KEY = 'retention-sweep'`,
   identical `job_run` bookkeeping to `watch-run.ts`. Iterates enabled
   policies and dispatches per `table_key`:
   - **Phase 1 handler — `simulation_draw`**: implements the documented
     behavior ("draws archived after N months; quantiles survive") — raw
     draws older than `retention_months` removed, quantile summary retained;
     `action='archive'` rows log-only in phase 1.
   - **Phase 2 (policy-gated, NOT enabled by default) — tombstoned-deal
     purge**: physically removes deals whose deletion mark is older than N
     months. Requires the ordered cascade revived from git history plus an
     explicit admin-confirmed policy row. Deliberately deferred: the standing
     decision is unlimited retention.
2. Per-policy `last_run_at` update + summary in `job_run.error`/log output.
3. Admin trigger: `POST /api/admin/retention/run` (admin-only) executes the
   same sweep in-process; the /admin retention UI gains a 지금 실행 button and
   shows `last_run_at`.
4. Registered default policies: **none destructive** at ship time; the
   simulation_draw archive policy is registered with `action='archive'`.

**Tests.** engine with scratch DB (policy rows → sweep → expected removals,
`last_run_at` set, `job_run` written, idempotent second run); admin-only
route; disabled policies skipped.

## Rollout order

| Phase | Workstream | Depends on | Size |
| --- | --- | --- | --- |
| 1 | B — deletion reason UI | — | S |
| 2 | A — un-delete | mark model (shipped) | S/M |
| 3 | C — evidence-file policy | — | M |
| 4 | D — archive export | C (attachment list), B (reason) | M |
| 5 | E — retention engine | C for file policies; deal purge deferred | M/L |

Every phase ships with: route/repository tests (scratch-DB +
`next-route-dispatch` pattern), openapi.yaml entries, `bun run test:unit` +
`design:lint` + `tsc` green.

## Open decisions (defaults proposed)

1. Un-delete permission: project = lead, opportunity/master data = analyst+.
2. Deletion reason: required for project delete, optional elsewhere.
3. File download: context members or analyst+; admins blocked for deal
   context.
4. Export format: docx first, pdf next.
5. Deal physical purge: no policy registered (unlimited retention stands)
   until separately decided.
