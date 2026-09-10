---
lang: en
counterpart: evidence-file-policy_ko.md
---

# Guideline — Evidence File Upload & Retention

> **Audience**: analysts uploading evidence files for our-company members and
> deals; deal leads deciding retention; operators running backups.
> **Enforceability**: rules marked MUST are enforced by the upload API; the
> rest is operating discipline.

## 1. What counts as an evidence file

Credit reports, appraisal documents, public filings, and any attachment that
grounds a company-profile or synergy analysis. Evidence files are referenced
from analysis outputs (`evidence_ref`), so a file's availability is part of
the analysis's auditability.

## 2. Upload rules (enforced)

1. Role: analyst or above (viewers cannot upload).
2. Size: 0 bytes < size ≤ **20 MB** per file.
3. Name sanitization: the stored filename is `<ulid>-<sanitized original>`;
   the original name is preserved in the response/registry.
4. Target: uploads attach to a 우리회사 member (or the synergy flow) — the
   API validates the owning entity exists.

## 3. Storage (current state)

- Location: `workspace/uploads/` under the repository root — alongside the
  SQLite database, included in the backup runbook's file scope.
- The uploads directory path is planned to become configurable
  (`CO_NEWBIZ_UPLOADS_DIR`) and repo-root-anchored instead of
  `process.cwd()`-relative (portability, ADR-0002) — see
  `docs/designs/2026-09-10-deletion-followups-plan.md` Workstream C.
- A server-side registry (`uploaded_file` table) and an authenticated download
  route are planned in the same workstream. Until they ship, the upload
  response's `stored_as` value is the reference to record in `evidence_ref`
  fields — record it immediately; unregistered files cannot be looked up.

## 4. Retention & deletion

- **Files follow the owner's lifecycle.** When a member or deal is
  delete-marked, its evidence files are kept — deletion marks never touch
  files, because analyses referencing them must stay auditable.
- Physical file purge can only be introduced through the retention engine
  (`docs/designs/2026-09-10-deletion-followups-plan.md` Workstream E) with an
  explicitly registered policy. No such policy exists today: retention is
  unlimited.
- Until the registry ships, do NOT delete files under `workspace/uploads` by
  hand — `evidence_ref` values elsewhere may still point at them.

## 5. Backup & portability

- `workspace/uploads` is inside the backup scope of
  `docs/runbooks/backup-restore.md` — treat uploaded evidence as
  release-relevant data, exactly like the database.
- When moving the deployment directory, migrate `workspace/uploads` together
  with `db/data/`.

## 6. Related documents

- `docs/runbooks/deal-deletion-playbook.md` — deletion marks keep files
- `docs/designs/2026-09-10-deletion-followups-plan.md` — registry/download
  route workstream (C) and retention engine (E)
- `docs/runbooks/backup-restore.md` — backup scope
