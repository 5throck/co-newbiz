---
lang: en
counterpart: admin-manual_ko.md
---

# Admin Manual — System Administrators

> **Language**: **English** · [한국어](admin-manual_ko.md)

**Audience**: system administrators (not the same as investment-committee "administrators" of the review process — this is technical system administration)
**Not for**: analysts (see `business-manual.md`) or operators running the batch/backup pipeline day-to-day (see `operations-manual.md`)

## What This Manual Covers

Account management, regulation-version administration, master-data administration, and notification-rule configuration — the job of the admin console at `/admin` (`app/web-next/app/admin`).

## 1. Account Management

- **Self-registration → `pending` → admin approval → `active`.** Roles: `admin` / `analyst` / `viewer`.
- **Password reset**: user requests → admin sets a temporary password → user's next login forces a password-change screen before any other action is available (`must_change_password`) → new password checked against `password_history` to block reuse.
- **The admin never sees a user's actual password** — hashing is one-way (PBKDF2-HMAC-SHA256, 210,000 iterations, per `scripts/lib/auth.ts` reused from the workspace).

## 2. Access Control — The One Rule Admins Must Internalize

**`admin` role does not grant automatic access to deal data.** System administration privilege and deal-viewing privilege are separate (design section 8.10, meeting M7-1). To view a specific project's data, an admin needs an explicit `project_member` grant like any other user — and that grant is itself audit-logged. If you find yourself wanting to "just check" a project you're not a member of, that is exactly the case this rule exists to stop.

## 3. Regulation & Procedure Version Administration

- View `project_policy_pin` status across in-flight projects.
- Review `policy_change` impact-analysis records before an amendment takes effect.
- **Never manually override a project's pinned policy version** without a recorded `policy_change` decision — this is the mechanism that stops a regulation amendment from silently flipping an in-flight project's RAG grade.

## 4. Master Data Administration

- Resolve the `staging_unmapped` queue — unmapped industry/company/unit codes are quarantined here, never auto-created.
- Region and industry profile fields require `source`/`verified_on`/`maintainer` metadata; `_validate.ts` rejects unsourced fields. An admin correcting a profile must supply this metadata, not just the value.

## 5. Notification & RAG Rule Administration

- RAG thresholds and hysteresis bands (design section 8.2, meeting M3) are configuration, not hardcoded — but changing them requires an ADR per the trigger list, not an ad hoc admin edit.
- Notification channel configuration, cooldown/hysteresis parameters (meeting M7's 24h/7-day defaults).

## 6. Data Source Administration

**API keys are never displayed** — the admin console shows presence and last-success timestamp only, never the key value. This is a hard rule, not a UI preference (design section 4.9).

## 7. Logs & Audit

- The audit log is **append-only** — not even an admin can delete an entry. Retention/archival is the only lifecycle action available.
- CSV export is available for compliance reporting.

## 8. Related

- `docs/governance/governance-operations.md` — waiver and interpretation administration (compliance-officer's domain, adjacent to but distinct from this manual's system-admin scope).

## 9. Related Screens

- `/flows` — stage-flow visualization with a dry-run lane (ADR-0183).
- UI language switch — ko/en message catalogs behind cookie-based locale negotiation (ADR-0184).
- `/wiki` — in-app viewer for the user-manual wiki.
