# Design: S1 industry list explicit curation (pinning)

- Date: 2026-09-14
- Status: implemented

## Problem

Even after grouping linked industries under their anchor (see `2026-09-14-s1-industry-list-relation-grouping-design.md`), the root-level list itself keeps growing as more industries and links accumulate. The user asked for a way to explicitly curate which industries matter, offering three options; they picked: star/pin the industries you actually care about, default the view to showing everything, and let a toggle switch to "pinned only."

## Approach

- **Migration 0097**: `md_industry.pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0,1))`. Additive, applied via `runMigrations()` (not a raw `db.run` — the earlier session hit a `schema_migrations` tracking gap from a raw-applied migration, see the `2026-09-14` `instrumentation.ts` fix; this one goes through the proper path).
- **`PATCH /api/market-overview/industry/{id}`**: extended to accept `{ pinned: boolean }` as an alternate request shape, handled by an early branch that doesn't require `name_ko` (the existing full-edit path always required a name). Kept as one route rather than a new endpoint since it's the same resource.
- **`GET /api/market-overview`**: selects and returns `pinned` per industry (already flows through via the existing `...i` spread in the response mapping — no shape change needed there).
- **Frontend** (`market/page.tsx`):
  - `IndustryRow.pinned` added.
  - A ★/☆ toggle button on each root row (not on children — pin state only makes sense for something that can appear at root) calls the PATCH and refreshes via the existing `refreshOverview()`.
  - A `pinnedOnly` boolean state plus a `전체 보기`/`★ 핵심만 보기` chip in the existing status-filter toolbar.
  - `displayedGroups = pinnedOnly ? industryGroups.filter(g => g.ind.pinned) : industryGroups` — inserted between `industryGroups` and `flatRows`, so filtering only ever removes/keeps whole groups (a linked industry's own pinned state never matters — it rides along with its anchor).
  - Defaults to `pinnedOnly = false` (show everything) since nothing is pinned on first use — an empty list would be a worse first impression than an unfiltered one.

## Verification

- `bunx tsc --noEmit` clean.
- Migration verified on a scratch DB copy, then applied via `runMigrations()` (tracked correctly in `schema_migrations`).
- Live-verified in browser: pinning `휴머노이드 로봇` shows a filled ★ that persists after refetch; toggling `★ 핵심만 보기` shows only the pinned industry (with its 8-industry linked group still available via the existing collapse/expand); toggling back to `전체 보기` restores the full list. Test pin state reset afterward via direct DB update (not through the UI, to avoid leaving stray audit-log noise from a throwaway verification click).
