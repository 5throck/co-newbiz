# ADR-0069: Adopt Next.js + Prisma web stack, superseding ADR-0010

**Status**: Accepted — 2026-08-26, retroactively, after Phases 0-6 were executed and independently verified (schema fix, all 34+ endpoints ported and response-compared against the live Hono API, all pages rendering, cutover complete, old stack removed in PR #142)
**Date**: 2026-08-25 (proposed) / 2026-08-26 (accepted)
**Deciders**: Mark Park (project owner — approved after reviewing the completed, verified migration; platform-lead/architect roles are not separately staffed on this project)
**Design of record**: `docs/designs/2026-08-25-web-stack-migration-nextjs-prisma_ko.md`
**Supersedes**: ADR-0010 (Web stack: Hono + React/Vite + ECharts)

## Context

ADR-0010 fixed the web stack as Hono (REST API) + React/Vite (SPA) +
ECharts (visualization), matching the pattern used elsewhere in the
workspace (`Projects/co-architect`). A later session decision directed
co-newbiz's entire web stack to be rebuilt to match a different sibling
project, `Projects/co-price`, which uses Next.js 16 + Prisma 7 +
`better-sqlite3` + Tailwind CSS + Recharts + NextAuth.

This is a full-stack replacement, not an incremental addition: it touches
every one of the 34 REST endpoints across 9 route files, all `bun:sqlite`
data access (~30 files under `db/lib/` and `db/repositories/`), all 7 web
pages and 14 components, and the authentication/session model. See the
design doc for the full inventory and phased cutover sequence.

## Decision

Adopt Next.js (Route Handlers, App Router) + Prisma 7 +
`@prisma/adapter-better-sqlite3` + Tailwind CSS + Recharts as co-newbiz's
web stack, replacing Hono + React/Vite + plain CSS + ECharts.

- The underlying database engine choice (SQLite) is **unaffected** —
  ADR-0001 stands. Only the access pattern changes (raw `bun:sqlite` →
  Prisma's generated client).
- ADR-0002 (database portability regime) is superseded in a companion
  decision once the Prisma migration model's portability contract is
  worked out (tracked as an open question in the design doc, §7) — not
  resolved by this ADR alone.
- ECharts, named in ADR-0010, is replaced by Recharts. No chart component
  had been built against ECharts yet in this app (`app/web/src` had zero
  ECharts usages at the time of this decision), so there is no existing
  chart code to migrate — only the未-executed intent.
- Migration proceeds in the 6 phases named in the design doc
  (scaffold → route port → frontend port → shadow traffic → cutover →
  decommission). This ADR governs the *decision to migrate*; it does not
  by itself authorize skipping any phase.

## Consequences

- Every REST endpoint, every DB access path, and every web page requires a
  rewrite — not a mechanical port, since Hono's context object
  (`c.get("auth")`, `c.req.param`) and raw SQL query strings have no direct
  Next.js/Prisma equivalent.
- Onboarding cost for engineers familiar with the current Hono/Vite pattern
  (the reason ADR-0010 gave for its choice) is spent, not saved, by this
  change — the tradeoff is convergence with `Projects/co-price`'s tooling,
  not lower cost.
- ADR-0011 (MCP access is REST-only, never direct DB) is superseded by a
  companion ADR (0070), because Next.js's Server Action pattern introduces
  a second server-execution path that ADR-0011's original text does not
  anticipate — see ADR-0070 for how the "single enforcement point"
  guarantee is preserved under the new architecture. **This ADR does not
  take effect independently of ADR-0070** — the two ship together, since
  adopting Next.js without also fixing the enforcement-point question
  would silently regress ADR-0011's safety guarantee.
- Until Phase 5 (cutover) completes, the current Hono stack remains the
  system of record; this ADR does not retire `app/server/` on acceptance
  alone.

## Cross-references

Design doc (above) · ADR-0001 (SQLite, unaffected) · ADR-0002 (portability,
open question) · ADR-0010 (superseded) · ADR-0070 (companion, MCP
enforcement point)
