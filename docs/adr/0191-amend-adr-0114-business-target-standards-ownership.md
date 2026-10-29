# ADR-0191: Amend ADR-0114 — business-target standards move from the admin console to the group screen

**Status**: Accepted (owner decision, 2026-10-29)
**Date**: 2026-10-29
**Deciders**: Owner (decision); implemented by frontend-engineer; reviewers security-engineer, backend-engineer
**Amends**: ADR-0114 (ownership and permission of `md_business_target` management only)
**Related**: ADR-0146 (admin role and business content are separated), ADR-0159 (project business goals), ADR-0120 (group and affiliate analysis screen)

## Context

ADR-0114 placed the group-common and affiliate-specific business-target standards in the admin console (`/admin/business-targets`, `/api/admin/business-targets*`, admin-only writes). The standards are business content: they are the criteria a deal is judged against at the fs gate. ADR-0146 already states that the admin role administers the system and does not read or write business content. The admin placement forced a mirror of the group list and detail reads under `/api/admin/business-targets/groups*` only to feed that one screen.

## Decision

1. **Ownership**: managing group and affiliate standards belongs to the group screen `/our-company`, as a panel on each selected group. The panel covers group-common rows and affiliate rows, the preset metrics, directions and custom KPIs of ADR-0114, unchanged.
2. **API**: `GET/POST/PUT/DELETE /api/our-company/groups/{id}/business-targets`. The group comes from the path; PUT and DELETE reject a row that does not belong to the path group.
3. **Permission**: the same model as the sibling `/api/our-company/groups*` routes. Reads need a business actor; writes need the analyst role or higher; the admin role is rejected (`role_forbidden`, ADR-0146). Viewer writes are rejected (`role_required`). Audit actions `business_target_add`, `business_target_update` and `business_target_delete` are kept; deletes stay tombstones (0081 convention).
4. **Removed**: `/api/admin/business-targets`, `/api/admin/business-targets/groups` and `/api/admin/business-targets/groups/{id}` (the admin mirror reads), the admin console nav entry, and the admin component. `/admin/business-targets` stays only as a redirect to `/our-company`.
5. **Resolution order is unchanged**: project goals (`project_business_goal`, ADR-0159) resolve above affiliate standards, which resolve above group-common standards. The S8 goals panel labels each row's source ("project goal" / "affiliate standard" / "group standard") and links inherited rows to `/our-company`.

## Consequences

- No schema change and no migration; `md_business_target` and its unique index are untouched.
- Administrators lose access to these standards. Their management now requires the analyst role.
- Any caller of the removed `/api/admin/business-targets*` routes must use the new path. No MCP tool or script called them (verified by search).
