# ADR-0070: MCP enforcement point under Next.js, superseding ADR-0011's implementation

**Status**: Accepted — 2026-08-26. The *intent* was upheld throughout the migration (no Server Action was written anywhere in `app/web-next`; every one of the 40+ ported endpoints is a Route Handler under `app/api/**`; `mcp/co-newbiz/` continues calling only those Route Handlers, verified via `list_projects` etc. after cutover). **Lint-rule gap closed 2026-08-26 (same day, follow-up commit)**: `scripts/co-newbiz/lint-server-boundary.ts` implements the mechanical guard this ADR's Decision §2 calls for — rejects a `"use server"` file that also imports data access, and rejects any `app/web-next/app/**` page/layout (outside `app/api/**`) that imports data access. Verified against both the real (clean) codebase and a synthetic violation file (both rules fire correctly, then confirmed clean again after removing it). Standalone script for now, not yet wired into `scripts/audit.ts`/CI — see the script's own header for why (no ESLint toolchain exists in `app/web-next` yet; CI wiring is a smaller follow-up now that the check itself is proven, not a new gap).
**Date**: 2026-08-25 (proposed) / 2026-08-26 (accepted)
**Deciders**: Mark Park (project owner — approved after reviewing the completed, verified migration; accepted the lint-rule gap as tracked follow-up rather than a blocker)
**Design of record**: `docs/designs/2026-08-25-web-stack-migration-nextjs-prisma_ko.md` §5
**Supersedes**: ADR-0011 (MCP access is REST-only, never direct DB) — implementation detail only; the *intent* is carried forward unchanged, see Decision

## Context

ADR-0011 fixed a specific mechanism — "the MCP server calls the REST API
exclusively, it never opens a direct database connection" — to guarantee a
property: every MCP call is subject to the same scope and audit-log
enforcement as a web-session call, with no client-specific bypass
architecturally possible.

ADR-0069 replaces the REST layer (Hono) with Next.js. Next.js offers two
distinct server-execution paths:

1. **Route Handlers** (`app/api/**/route.ts`) — the direct equivalent of a
   Hono route; a genuine REST-shaped boundary `mcp/co-newbiz/` can call
   exactly as it calls the current Hono API.
2. **Server Actions** (`"use server"` functions invoked directly from
   client components) — these can call Prisma directly, with no obligation
   to route through anything REST-shaped. If any part of the application
   uses Server Actions for data mutations, a second, un-enforced data path
   opens next to Route Handlers — exactly the bypass ADR-0011 was written
   to make architecturally impossible.

Losing ADR-0011's guarantee silently — by adopting a framework that offers
a bypass path, without an explicit decision about it — is the specific
risk this ADR closes off.

## Decision

1. **Server Actions are prohibited** anywhere Prisma (or any DB access) is
   involved. All data reads and writes — from the web UI *and* from
   `mcp/co-newbiz/` — go through Route Handlers under `app/api/**`. Route
   Handlers are the direct successor to ADR-0011's "REST API" term; the
   MCP server continues to call them exclusively, never importing Prisma
   or any `db/`-equivalent module directly (the same file-boundary rule
   ADR-0011 and `mcp/co-newbiz/shared/rest-client.ts`'s header comment
   currently enforce, ported unchanged).
2. **Mechanical enforcement, not convention**: a lint rule (ESLint, custom
   or via `eslint-plugin-next`) must reject any `"use server"` directive
   in a file that also imports the Prisma client, and must reject any
   Prisma import from outside `app/api/**`. Code-review discipline alone
   reproduces ADR-0011's guarantee only until someone forgets — the
   original ADR's whole point was making the bypass *impossible*, not
   *discouraged*.
3. Permission checks, audit-log appends (`appendAudit`), and MNPI/PII
   exclusion logic currently living in Hono middleware
   (`requireAuth`/`requireAdmin` in `app/server/middleware.ts`) must have a
   Next.js Route Handler equivalent applied uniformly — this is Phase 2
   work (design doc §6), but the shape of that equivalent (Next.js
   middleware vs. a shared handler wrapper) is decided here: **a shared
   wrapper function**, not framework-level `middleware.ts` matchers, since
   Next.js's `middleware.ts` cannot access the Prisma client (edge runtime
   restriction) and the permission check needs DB access (role,
   membership, MNPI flag lookups).

## Consequences

- Every Route Handler under `app/api/**` must call the shared
  auth/audit wrapper — a missed call is a silent, undetected gap, so
  Phase 2's test suite (design doc §6) must assert 100% route coverage of
  the wrapper, not just port existing tests.
- Server Actions remain available for genuinely stateless UI concerns
  (e.g., a client-side form validation helper) — the prohibition is scoped
  to DB/Prisma access, not the feature entirely.
- This ADR does not resolve ADR-0038 (need-to-know access control) or
  ADR-0040 (MNPI handling)'s implementation details under the new stack —
  those are Phase 2 execution items that must demonstrate compliance with
  this ADR's Route-Handler-only rule, not separate decisions.
- Until Phase 5 (cutover, design doc §6) completes, ADR-0011's original
  mechanism (Hono REST-only) remains in force for the live system; this
  ADR governs the target state only.

## Cross-references

Design doc §5 (above) · ADR-0011 (superseded implementation, intent
carried forward) · ADR-0069 (companion, ships together) · ADR-0038 · ADR-0040
