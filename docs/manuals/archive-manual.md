---
lang: en
counterpart: archive-manual_ko.md
---

# Archive Manual — Leads & Analysts

> **Language**: **English** · [한국어](archive-manual_ko.md)
> **Audience**: deal leads and analysts who close, archive, delete-mark, or
> inspect deals. System administrators cannot see deal content (role
> separation), so this manual is not for them.

## 1. The four states of a deal

| State | Where it appears | Who acts |
| --- | --- | --- |
| Open (진행) | /projects, /pipeline, every deal screen | — |
| Closed (마감) | Archive → Archived projects (보관 프로젝트) | lead (종료/보관 action) |
| Archived (보관) | Archive → Archived projects (보관 프로젝트) | lead (종료/보관 action) |
| Delete-marked (삭제 표시) | Archive → Deleted deals (삭제된 딜) | lead (projects) / analyst+ (opportunities, master data) |

**Deletion is a mark, not an erasure.** A delete-marked deal keeps every row —
opportunity, route decision, target list, synergy versions, business case,
gates, reports. It disappears from the active screens because every list
filters the mark, and it stays fully readable in the archive for audit.

## 2. Closing or archiving a project

1. `/projects` → row action **종료/보관** (Close/Archive; leads only).
2. Choose 마감 (closed) or 보관 (archived) and enter a **required reason**.
3. The project leaves the active list and appears under
   Archive → Archived projects (아카이브 → 보관 프로젝트).

Archived projects are read-only. Their overview and analysis screens still
open for members so the full record stays inspectable.

## 3. Delete-marking a deal

1. `/projects` → row action **삭제** (Delete; leads only). One action marks the project
   **and** its source opportunity; the pipeline, route-decision, and
   opportunity screens clear automatically.
2. Confirm the dialog. A manifest is written recording who acted, when, the
   members at that moment, and which market-analysis version the deal relied
   on.
3. For unpromoted opportunities: `/opportunities` → 삭제 (Delete). Promoted
   opportunities must go through their project first.

## 4. Using the archive screen

`Projects → Archive` (프로젝트 → 아카이브, /projects/archives):

- **Archived projects (보관 프로젝트)** — closed/archived projects with status
  chip, close date, reason, an Overview (개요) link, and Delete (삭제) for
  leads (archive → deletion completes the lifecycle).
- **Deleted deals (삭제된 딜)** — delete-marked deals with actor, date, and
  reason. View original (원본 열람) opens the retained data; Details (상세)
  shows the manifest including the frozen market-analysis version
  references.

Every detail view is audit-logged. You must have been a project member at the
time the mark was made — this never expires, and admins cannot see deal
content.

## 5. FAQ

**Q. Does deleting really erase the data?** No. The deal is only marked —
every original row is preserved. For audit, open it as-is from the archive.

**Q. What if a deal was deleted by mistake?** Un-deleting a delete-mark is a
planned follow-up (`docs/designs/2026-09-10-deletion-followups-plan.md`,
Workstream A). Until then the data is retained, so audit access is
unaffected.

**Q. The synergy analysis refuses to delete.** That analysis is the strategic
basis of a live deal. Delete or archive the deal first, then try again.

**Q. Does the archive change when the market analysis is refreshed?** No.
The market-analysis version at the moment of archiving or deletion is pinned
in the manifest, so the version current at that time stays viewable.

## 6. Related documents

- `docs/runbooks/deal-deletion-playbook.md` — operator runbook (policy and API)
- `docs/guidelines/evidence-file-policy.md` — evidence file upload/retention
- `docs/designs/2026-09-10-deletion-followups-plan.md` — planned follow-ups
