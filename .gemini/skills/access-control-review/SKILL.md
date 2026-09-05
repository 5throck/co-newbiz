---
name: access-control-review
scope: co-newbiz
description: >
  Runs the monthly access-permission review: every active `project_member`
  row cross-checked against continued need, stale memberships revoked (not
  left to expire passively), `wall_group` assignments reviewed for
  continued relevance, admin-role holder count reviewed quarterly and kept
  minimal by design (`docs/security/security-baseline.md` §4).

  Use when: "access permission review", "stale membership revocation",
  "wall_group relevance check", "admin role count review".
version: 1.0.0
last_reviewed: 2026-08-20
status: active
owner: security-engineer
prerequisites: none
relates_to:
  - skill: ui-information-architecture
    type: composes_with
  - skill: security-baseline-review
    type: composes_with
  - skill: vulnerability-management
    type: composes_with
  - skill: security-scan
    type: composes_with
metadata:
  type: process
  triggers:
    - access permission review
    - stale membership revocation
    - wall_group relevance check
    - admin role count review
---

## Context

"Revoked, not left to expire passively" is the operative distinction: this
system has no automatic membership expiry, so a stale membership persists
indefinitely unless someone actively revokes it — the monthly review is
the mechanism that catches what would otherwise silently accumulate.
Admin-role count staying minimal "by design, not grow by default" means
the review actively pushes back on admin-role creep, not just observes it.

## When to Use

- Monthly (`project_member` review, `wall_group` relevance)
- Quarterly (admin-role holder review)
- Following an incident that revealed a compromised or over-privileged credential

## Execution Steps

1. **Pull every active `project_member` row** across all projects, monthly
2. **For each, confirm continued need**: is this person still working on
   this project, or has their role/assignment changed since the grant?
3. **Revoke stale memberships explicitly** — `revokeProjectMembership()`,
   audited — rather than noting them as "probably fine" and moving on
4. **Review `wall_group` assignments** for continued relevance — a
   conflict-of-interest wall that's since been resolved (e.g. the person
   left the conflicting engagement) should be lifted, not left in place
   indefinitely once its original justification is gone
5. **Quarterly**: pull the full admin-role holder list and confirm each
   still needs admin — the design's expectation is a minimal, actively
   maintained list, not a monotonically growing one
6. **Record the review** — who was reviewed, what changed, so the next
   cycle has a baseline rather than starting from scratch

## Output Format

- Monthly membership review: revocations made with rationale, wall_group
  relevance confirmations
- Quarterly admin-role review: current holder list, any removals

## Related Skills

- `auth-and-account-management` — the underlying account/session mechanics this review acts on
- `security-baseline-review` — the broader cadence this fits within
