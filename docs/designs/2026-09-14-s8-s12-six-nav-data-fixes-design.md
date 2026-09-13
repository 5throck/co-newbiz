# Design: Six S8-S12 navigation/data fixes

- Date: 2026-09-14
- Status: implemented

## Problem

Six separate issues reported after the S8-S12 nav/tab readability work:

1. Timeline·SLA and risk-heatmap (already in `ProjectSubNav`) still didn't show in the main left sidebar — a different, hand-maintained menu (`AppShell.tsx`'s dynamic S8-S12 submenu).
2. Dashboard's `포트폴리오 전체 뷰` button needed to be removed.
3. `/projects` list: project names should be clickable links to the detail screen.
4. S8 `사업성 분석`: WACC and `재무분석` should appear as tabs inside business-case, not as separate routes.
5. S9 `실사·검증`'s `가치사슬 연계` (proxy-chain) screen had no structural link back to the S1 market analysis.
6. Site-selection tools (`부지·시설`, `인허가·인증`, `인센티브`) had no proper menu group.

## Approach

1. Added `타임라인·SLA`/`리스크 히트맵` to `AppShell.tsx`'s `projectStageChildren` array (the sidebar's dynamic S8-S12 injection, distinct from `ProjectSubNav`).
2. Removed the button in `app/page.tsx`.
3. Wrapped the project-name cell in `app/projects/page.tsx` in a `<Link>`.
4. Extracted `wacc/page.tsx`'s and `financial-analysis/page.tsx`'s inner logic into `components/wacc/WaccPanel.tsx` and `components/FinancialAnalysisPanel.tsx` (both take only `{ projectId }`, no ambient context dependency). `business-case/page.tsx`'s existing `TabNav`/URL-query-synced tab pattern gained two more tab keys (`wacc`, `financial-analysis`) rendering these panels. The original `/wacc` and `/financial-analysis` routes remain as thin wrapper pages (same `ProjectSubNav`+`StageFrame` shell + the extracted panel) so old deep links keep working; removed from `ProjectSubNav`'s `SUB_PAGES` since they're reached via tabs now.
5. `GET /api/projects/[id]/proxy-chain` resolves the project's origin industry (`md_project.source_opportunity_id → opportunity.market_scope → md_industry`) and unions active `proxy_link`/`proxy_chain` rows for that industry into its existing queries, in addition to the project-authored `value_chain_link` rows it already showed.
6. Added a new `"site"` group to `ProjectSubNav` (heading `입지·인허가`), moved `/incentives`, `/sites`, `/permits` into it from the generic `tools` group.

## Verification

- `bunx tsc --noEmit` clean.
- Live-verified in browser: business-case shows 4 working tabs including WACC (real data) and `재무분석`; standalone `/wacc` and `/financial-analysis` routes still render correctly; dashboard button removed; `ProjectSubNav` shows the new `입지·인허가` cluster and sidebar shows the two new items while a project is open.
- Verified the S9 fix via a direct authenticated API call (debug session, cleaned up after): a project with zero S9-authored `value_chain_link` rows now returns 4 `proxy_link` rows inherited from its S1 industry (`유압식 브레이커`), where it previously returned zero.
