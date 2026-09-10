---
lang: en
counterpart: deal-deletion-playbook_ko.md
---

# Deal Deletion Playbook — Marking, Archive, and Audit

Status: adopted (see `docs/adr/` for the accompanying decision record)
Scope: deals (projects + opportunities) and our-company master data (company groups / members)

## Principle

**Nothing is physically deleted.** "Delete" stamps a deletion mark
(`deleted_at`, `deleted_by`, `delete_reason`) on the row. Every list and read
surface filters marked rows, so a deleted deal disappears from the active UI,
while the original data stays exactly where it was — inspectable at any time
for audit (same doctrine as the append-only `audit_log`, FR-SEC-07, and the
ADR-0056 retire convention).

Rationale: post-hoc audit must be able to reconstruct what a deal looked like
when a question arises. Snapshot-only archives are lossy reconstructions;
retained originals are not.

## Unit of deletion

The **deal chain** is the unit:

- Deleting a project marks the project **and its source opportunity**.
- Marking requires project **lead** role.
- Deleting an unpromoted opportunity marks the opportunity (analyst+).
- Master data (groups / members) is marked the same way (analyst+).

A component may NOT be removed while the deal it belongs to is alive:
a synergy analysis attached to a `selected` or promoted opportunity refuses
deletion with `409 synergy_basis_in_use`. Remove (mark) the deal first.

## Procedure

1. **Delete the deal** — `/projects` list → row action 삭제 (lead only), or the
   archive screen for already-closed/archived projects. One action covers the
   whole chain.
2. **Verify leftovers are gone from active surfaces** — pipeline, route
   decision, opportunity funnel, synergy list all filter marks automatically.
3. **Master data** — once deals referencing a group/member are marked, the
   group/member can be marked from 그룹/계열사 분석. Marked master data stays
   referenced by preserved analyses without any FK conflict.

## Which screen clears when

| Screen | Clears when |
| --- | --- |
| 프로젝트 파이프라인 (/pipeline) | project delete-mark |
| 진출방식 결정 (/route-decision) | opportunity delete-mark (chips list `selected` opportunities) |
| 브라운필드 대상 스크리닝 (/brownfield) | opportunity delete-mark |
| 기회 발굴 (/opportunities) | opportunity delete-mark |
| 시너지·전략적 적합성 (/synergy) | synergy delete-mark (refused while the deal is live) |
| 그룹/계열사 (/our-company) | group/member mark |

## Archive

`/projects/archives` (프로젝트 → 아카이브) lists:

- **보관 프로젝트** — closed/archived projects. Originals are intact; 개요 opens
  the frozen data (reads allow closed/archived access; writes stay blocked).
- **삭제된 딜** — delete-marked deals. Originals remain in place; 원본 열람 opens
  the retained data.

### Point-in-time guarantee

Project-owned data (opportunity, route decision, targets, synergy versions,
business case, gates, reports) is immutable after marking, so the live rows ARE
the as-of state. Shared assets are NOT immutable: market-sizing analyses are
industry-keyed and keep evolving. At every archive/delete action a
`deal_archive` manifest records the market-sizing **version references**
(industry → analysis → version) the deal relied on, so the as-of version stays
resolvable through the append-only version history.

### Access and audit

- Manifest rows and retained data are readable only by users who were project
  members at mark time (`member_user_ids_json` allowlist) — permanently.
- Admins are blocked from deal content (role separation, ADR-0091).
- Every archive detail view is audit-logged (`archive_view`); the list view is
  logged as `archive_list`. `deal_archive` itself is append-only at the DB
  level (triggers, FR-SEC-07 pattern).
- Retention: unlimited. A purge engine (ADR-0039 retention_policy) is a
  separate future work item and must not silently hard-delete today.

## API surface

| Endpoint | Behavior |
| --- | --- |
| `DELETE /api/projects/[id]` | lead-only; marks project + source opportunity; writes `deal_archive` |
| `DELETE /api/opportunities/[id]` | analyst+; marks unpromoted opportunity; 400 `opportunity_promoted` while promoted |
| `DELETE /api/our-company/groups/[id]` | analyst+; marks group + members |
| `DELETE /api/our-company/groups/[id]/members` | analyst+; marks member |
| `DELETE /api/synergy/analyses/[id]` | analyst+; marks; 409 `synergy_basis_in_use` while deal is live |
| `PATCH /api/projects/[id]/close` | lead-only; closes/archives; writes `deal_archive` archived manifest |
| `GET /api/projects?status=` | `open` (default) / `closed` / `archived` / `all`; deleted excluded |
| `GET /api/archive/deals` | caller's deleted manifests |
| `GET /api/archive/deals/[id]` | one manifest; member-only; audited |
