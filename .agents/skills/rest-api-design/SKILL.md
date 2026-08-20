---
name: rest-api-design
scope: co-newbiz
description: >
  Designs and reviews REST endpoints against `docs/api-spec.md`'s
  non-negotiable rules: membership filtering at the repository layer on
  every endpoint, session cookie + Bearer token auth, MNPI excluded from
  default list/search responses, non-member project detail is 404 not 403,
  write endpoints audited, the `{data, meta, error}` envelope everywhere.

  Use when: "new REST endpoint", "API design review", "envelope shape",
  "404 vs 403 for non-members".
version: 1.0.0
last_reviewed: 2026-08-20
status: active
owner: backend-engineer
prerequisites: none
metadata:
  type: implementation
  triggers:
    - new REST endpoint
    - API design review
    - envelope shape
    - 404 vs 403 for non-members
---

## Context

Wave 5.6A already implements this discipline for the endpoints it covers
(`app/server/`) — this skill is the design/review standard any new
endpoint must meet, whether extending the existing server or (per Wave
5.6A's own deferred-scope note) implementing the still-missing api-spec §4
(analysis runs) and §6 (M&A topic reads) endpoints. Non-negotiable, per
`app/server/projects.ts`'s own module comment: a non-member's project
fetch is 404, identical to "does not exist" — never 403, which would leak
existence.

## When to Use

- Designing a new REST endpoint
- Reviewing an existing or proposed endpoint for compliance

## Execution Steps

1. **Every project-scoped read goes through repository-layer membership
   filtering** — `getProjectIfVisible`/`listVisibleProjects`, never a
   route-level ad hoc check that could be bypassed by a different call site
2. **MNPI excluded from list/search by default** — `excludeMnpi: true`
   unless an explicit `include_mnpi=1` opt-in is present, matching the
   already-implemented pattern
3. **Non-member detail is 404, not 403** — always; a 403 would confirm the
   project exists to someone who shouldn't know that
4. **Auth**: session cookie (web) or Bearer token (MCP/CLI, scope-limited,
   hashed at rest) — `requireAuth` middleware, never a route reimplementing
   its own auth check
5. **Write endpoints are audit-logged** — `appendAudit()` on every mutation
6. **Response envelope**: `{data, meta: {as_of, ...}, error}` — never a
   bare object or array at the top level
7. **Rate limiting**: apply per api-spec §10's rules, distinct budgets for
   read vs. write per `mcp-integration.md` §5's parallel rule for the MCP layer

## Output Format

- Endpoint design/review: route, auth requirement, membership-filtering
  confirmation, MNPI-default confirmation, envelope shape, audit-logging confirmation

## Related Skills

- `mcp-server-integration` — the parallel MCP tool surface consuming the same REST endpoints
- `auth-and-account-management` — the auth layer this design relies on
