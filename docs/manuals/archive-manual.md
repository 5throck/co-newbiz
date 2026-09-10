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
| 진행 (open) | /projects, /pipeline, every deal screen | — |
| 마감 (closed) | 아카이브 → 보관 프로젝트 | lead (종료/보관) |
| 보관 (archived) | 아카이브 → 보관 프로젝트 | lead (종료/보관) |
| 삭제 표시 (deleted mark) | 아카이브 → 삭제된 딜 | lead (projects) / analyst+ (opportunities, master data) |

**Deletion is a mark, not an erasure.** A delete-marked deal keeps every row —
opportunity, route decision, target list, synergy versions, business case,
gates, reports. It disappears from the active screens because every list
filters the mark, and it stays fully readable in the archive for audit.

## 2. Closing or archiving a project

1. `/projects` → row action **종료/보관** (leads only).
2. Choose 마감(closed) or 보관(archived) and enter a **required reason**.
3. The project leaves the active list and appears under
   아카이브 → 보관 프로젝트.

Archived projects are read-only. Their overview and analysis screens still
open for members so the full record stays inspectable.

## 3. Delete-marking a deal

1. `/projects` → row action **삭제** (leads only). One action marks the project
   **and** its source opportunity; the pipeline, route-decision, and
   opportunity screens clear automatically.
2. Confirm the dialog. A manifest is written recording who acted, when, the
   members at that moment, and which market-analysis version the deal relied
   on.
3. For unpromoted opportunities: `/opportunities` → 삭제. Promoted
   opportunities must go through their project first.

## 4. Using the archive screen

`프로젝트 → 아카이브` (/projects/archives):

- **보관 프로젝트** — closed/archived projects with status chip, close date,
  reason, 개요 link, and 삭제 for leads (archive → deletion completes the
  lifecycle).
- **삭제된 딜** — delete-marked deals with actor, date, and reason. 원본 열람
  opens the retained data; 상세 shows the manifest including the frozen
  market-analysis version references.

Every detail view is audit-logged. You must have been a project member at the
time the mark was made — this never expires, and admins cannot see deal
content.

## 5. FAQ

**Q. 삭제하면 데이터가 정말 지워지나요?** 아니요. 표시만 되고 원본은 전부
보존됩니다. 감사 시 아카이브에서 그대로 열람합니다.

**Q. 잘못 삭제했으면?** 삭제 표시 해제(un-delete)는 계획된 후속 과제입니다
(`docs/designs/2026-09-10-deletion-followups-plan.md` Workstream A). 그 전까지는
데이터가 보존되어 있으므로 감사 열람에는 지장이 없습니다.

**Q. 시너지 분석이 삭제 거부되는데?** 그 분석은 살아있는 딜의 전략적 근거입니다.
딜을 먼저 삭제 또는 보관한 뒤 시도하세요.

**Q. 시장분석이 갱신되면 아카이브도 바뀌나요?** 아니요. 보관/삭제 시점의
시장분석 버전이 manifest에 고정되어 당시 버전을 열람할 수 있습니다.

## 6. Related documents

- `docs/runbooks/deal-deletion-playbook.md` — operator runbook (policy and API)
- `docs/guidelines/evidence-file-policy.md` — evidence file upload/retention
- `docs/designs/2026-09-10-deletion-followups-plan.md` — planned follow-ups
