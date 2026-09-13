# Design: S1 industry list groups linked industries by relation

- Date: 2026-09-14
- Status: implemented

## Problem

With 21+ industries in the S1 list, forward/2nd-forward/backward/2nd-backward (`전방`/`전전방`/`후방`/`후후방`) linked industries were indistinguishable from independently-registered ones — the list was a flat sequence of equally-weighted rows, sorted purely by analysis status.

## Approach

Confirmed via `graft`/DB inspection that no new data was needed: `market_sizing_analysis.after_analysis_id` (the anchor analysis this row was queued after) and `linked_relation` are already recorded at registration time via the linked-industry serial queue (ADR-0130). The fix is purely a rendering change in `app/web-next/app/market/page.tsx`:

- A new `flatRows` memo builds a lookup from analysis id → owning industry, identifies which visible industries are "children" (their `linked_relation`/`after_analysis_id` resolve to another visible industry), and emits a flat list where each anchor is immediately followed by its children (sorted `전전방` → `전방` → `후방` → `후후방`).
- The existing status-priority sort (failed → in progress → stale → completed → pending) still determines each anchor's position; children move with their anchor regardless of their own individual status, since the point is grouping, not re-sorting.
- The name cell renders children with a `↳` glyph, ~1rem indent, and a `status-chip` relation badge — blue (`status-in-progress`) for demand-side (`전방`/`전전방`), amber (`status-amber`) for supply-side (`후방`/`후후방`) — reusing existing chip classes rather than inventing new colors.
- Industries with no anchor relationship render exactly as before (single row, no badge, no indent).

A visual mockup was shown and approved by the user before implementation.

## Verification

- `bunx tsc --noEmit` clean.
- Live-verified in browser: `휴머노이드 로봇`'s 6 linked industries (2 `전방`, 4 `후방`) now render indented directly beneath it with correctly colored relation badges, in `전방`-before-`후방` order; industries with no linkage render unchanged.

## Follow-up (2026-09-14): second link source + collapsible groups

**Gap found**: the initial grouping only read `market_sizing_analysis.after_analysis_id`/`linked_relation` — set exclusively when an industry is registered via the linked-industry serial queue (ADR-0130, `연계 산업 이어서 분석`). A pair of already-analyzed industries linked afterward via the separate `가치사슬 연계` registration form (`proxy_link.relation`, ADR-0129) never appeared grouped. Reported live: `연료전지` and `수소 충전소 구축 서비스업` were linked this second way and stayed flat in the list.

**Fix**: `GET /api/market-overview` now also returns `industryLinks`: all active, relation-tagged `proxy_link` rows. The frontend's grouping merges both sources into one `industryGroups` derivation. Direction is resolved per the existing `chain-links/route.ts` registration convention: for `전방`/`전전방` (downstream) the link's `from_industry_id` is the anchor; for `후방`/`후후방` (upstream) `to_industry_id` is the anchor — the `relation` value itself is already stored as "the child's relation to the anchor" regardless of direction, so it's used directly as the badge label without transformation.

**Also added**: collapsible groups. With grouping now catching more cases, the list could get visually long again — the user's own follow-up suggestion. Groups with children default to collapsed, showing a `▸`/`연계 N건` toggle on the anchor row; expanding reveals the same indented, relation-badged child rows as before. `expandedGroups` is local `Set<string>` component state, no persistence.

### Verification

- `bunx tsc --noEmit` clean.
- Live-verified in browser: `연료전지` now shows `연계 1건`; expanding it reveals `수소 충전소 구축 서비스업` indented with a `전방` badge. `휴머노이드 로봇` (`연계 8건`) still expands/collapses correctly with the previously-verified 6 linked industries plus this session's newly-registered links.
