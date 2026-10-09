---
lang: ko
lang_reason: source-material
---

# Shell walkthrough — 2026-10-09 (design-system-agent)

Scope: every `page.tsx` route under `app/web-next/app` (73 URLs incl. dynamic instances) as analyst (full: light, dark, 390px), viewer and admin (light + axe). Plus anonymous login/register/404. Build = `main` @ 77aeb61e, demo seed, temp DB under the OS temp dir (`walk-shell`), offline LLM env.

Deviation: the harness (`tests/scenarios/_support/harness.ts`) only allocates a random free port (never 7749); it was not edited, so the server ran on a random port rather than 7813. It was stopped at the end. `bun run design:lint` reports no violations (static lint is clean; every issue below is runtime/IA).

Evidence: curated subset in `docs/evidence/gui-review/walkthrough-2026-10-09/curated/` (bulk route screenshots moved out of the repository).

## Top findings (ranked)

1. **Orphan/legacy routes (13)**: `/market`, `/opportunities`, `/opportunities/{id}`, `/route-decision`, `/synergy`, `/portfolio-view`, `/companies`, `/companies/{id}`, `/our-company`, `/agents`, `/pipeline`, `/process/S1`, `/projects` have no sidebar entry and zero (or only legacy-to-legacy) inbound links. `/pipeline`, `/greenfield`, `/brownfield` silently redirect to `/deals` or a deal stage. `/market`, `/opportunities`, `/route-decision`, `/synergy" render an "S1 선택" style picker with no "<h1>`, no active sidebar item and no topbar title.
2. **404 is the stock Next page**: English "This page could not be found.", no link back, no `<main>`, and it breaks dark mode (white body under a dark topbar; 13 color-contrast failures in dark, sidebar brand text invisible). Anonymous hits on unknown URLs bounce to /login.
3. **Dark-mode contrast fails on ~60 of 73 routes** (axe serious, color-contrast): `.btn-primary` and `.control-chip` on `/deals`, `/inbox`; `--primary-bg` chips on `/strategy`; the same family across all `/projects/{id}/*` pages (2-5 nodes each). Light mode is clean except 2 spots (`/companies/{id}` success-bg chip, `/projects/{id}/financial-analysis` inline-block).
4. **Same `<title>" on every page** ("신규사업 검토 AI 플랫폼"; 404 differs). Tab/history/bookmark/screen-reader page titles are indistinguishable; "<h1>` is the only title and is missing on 8 routes (the 4 pickers, `/projects/{id}`, `/projects/{id}/process`, `/opportunities/{id}`, plus `/brownfield` and `/greenfield` redirect shells for admin).
5. **390px horizontal overflow** on `/brownfield` (+380px), `/greenfield` (+225px), `/projects/{id}/dd` (+147px), `/companies` (+19px), `/projects/{id}/wacc` (+7px). Topbar collapses to icon-only buttons with no labels (hamburger, theme, bell, key, logout) — acceptable but icon meaning is unlabelled visually.
6. **Role gating is silent**: viewer and analyst opening `/admin/*` are redirected to `/deals" with no message (looks like a bug, not a permission boundary). Admin has a separate sidebar (14 items, "/admin" appears twice: brand + 시스템 대시보드) and is walled off from deals (by ADR-0091) yet "/` -> `/deals` for admin still lands on deal board with 15-item admin nav. Viewer sees the same primary buttons (`btn-primary`) as analyst on `/deals`, S4, S8, S9 — primary actions are not hidden/disabled for the read-only role in the shell (server enforcement not verified here).
7. **Duplicated navigation**: sidebar lists `/deals" twice (brand link + 검토/안건 보드) and "/admin` twice; `/projects/archives" ("아카이브") vs "/projects" ("프로젝트") are two parallel lists, only the first is in nav; "/our-company`, `/agents`, `/process/S1` are stage hubs reachable only from each other.
8. **Korean/English label mixing**: inbox filter chips show "알림 / 딜" (English loanword "딜" beside "검토/안건" used everywhere else; DB term inconsistency "deal" vs "검토/안건"); `HOLD 0` in the topbar/board, "Commercial/Technical/Legal" DD tabs, "NPV p05/p50/p95", "Run", "Hurdle IRR", "DART" untranslated; library cards show "Entity Addendum — ent-a" / "Group New Business Review Policy" with an "EN" badge but no KR counterpart in the list; `/share` heading "외부 안전 공유 security 설계 승인 전" mixes both mid-title.
9. **Component inconsistency**: 20 visible raw `<button>` without a design class (`/password-change` 1, business-case 7, dd 5, portfolio 4, deal-structure 3); primary-action absent on 40+ list/detail screens (all stage side-pages like `/projects/{id}/charter`, `/pmi`, `/timeline`, `/reports`, `/process`), and `/glossary` renders 72 buttons (term chips) with no search-first affordance count. `/projects/{id}/risk-heatmap` is the only page under the 12px floor (9 text nodes at 10px, class `note`); everything else is >=12px.
10. **Residual axe (serious) in light mode**: `aria-prohibited-attr` x33 for viewer/admin on 10 `/projects/{id}/*` pages (loading skeleton "div[aria-label="불러오는 중"]" has no role — appears while data loads), `label-content-name-mismatch` on `/projects/{id}/wacc` (`.source-figure`), `listitem` on admin `/inbox` (an `<li>` outside a list). Login, register, password-change, onboarding, OAuth consent, proposal-confirm, connected-apps, admin console: no light-mode serious issues.

## Cross-cutting checks

| Check | Result |
|---|---|
| Reach from nav | 8 analyst entries (inbox, deals, archives, benchmarks, library, glossary, strategy, connected-apps) + password-change via topbar key; deal/project sub-screens via deal/project tabs; everything else orphaned (finding 1) |
| Leave | Sidebar on every authenticated page (390px: hamburger drawer). Topbar "이전/목록" back button exists on deal and project sub-screens (seen on `/brownfield` at 390); none on the pickers, 404, `/onboarding`, `/oauth/authorize`, `/proposals/{id}/confirm` (sidebar only) |
| Login/consent | `/login`, `/register`, `/onboarding` (anon -> /login), `/oauth/authorize` (anon -> /login; authed shows "외부 앱 연결 허용" with no client param, no primary action) |
| Empty/error | `/proposals/bogus/confirm" returns 200 "결정 제안 확인" shell for a non-existent id (should be a not-found state); "/oauth/authorize` without params renders a consent page instead of an error; inbox empty state fine ("대기 중인 결정이 없습니다") |
| Typography floor | Only `/projects/{id}/risk-heatmap` <12px; minimum elsewhere 12-13px |
| Tokens/design:lint | `design:lint` clean; hardcoded colors none detected; the dark failures are token pairs (primary/chip on dark) not literals |
| Light/dark parity | Light: 3 serious nodes total. Dark: ~150 color-contrast nodes over ~60 routes; 404 unthemed |

## Route matrix (analyst; viewer / admin = does the final URL match analyst's)

Columns: status | how reached from nav | page title (h1/h2) | primary action (`.btn-primary`) | axe serious light | axe serious dark | 390px | viewer / admin.

| Route | HTTP | Reach | Title | Primary | Axe light | Axe dark | 390 | Viewer / Admin |
|---|---|---|---|---|---|---|---|---|
| `/` ->/deals | 200 | redirect->/deals | 검토/안건 보드 | Y | OK | color-contrastx2 | ok | same / same |
| `/inbox` | 200 | sidebar | 결정 대기함 | n | OK | color-contrastx1 | ok | same / same |
| `/deals` | 200 | sidebar | 검토/안건 보드 | Y | OK | color-contrastx2 | ok | same / same |
| `/deals/{opp}` | 200 | in-page link | 검토/안건 개요 | Y | OK | color-contrastx1 | ok | same / same |
| `/deals/{opp}/s1` | 200 | in-page link | S1 시장분석 | Y | OK | color-contrastx4 | ok | same / same |
| `/deals/{opp}/s4` | 200 | in-page link | S4 진출방식 결정 | Y | OK | color-contrastx2 | ok | same / same |
| `/deals/e2e-gf-opportunity` | 200 | in-page link | 검토/안건 개요 | Y | OK | color-contrastx1 | ok | same / same |
| `/projects` | 200 | ORPHAN? inbound 0 | 프로젝트 | n | OK | OK | ok | same / same |
| `/projects/archives` | 200 | sidebar | 아카이브 | n | OK | OK | ok | same / same |
| `/benchmarks` | 200 | sidebar | 벤치마킹 사례 | n | OK | OK | ok | same / same |
| `/library` | 200 | sidebar | 문서 허브 | n | OK | OK | ok | same / same |
| `/glossary` | 200 | sidebar | 용어집 | n | OK | OK | ok | same / same |
| `/strategy` | 200 | sidebar | R&BD 플랫폼화 전략 | n | OK | color-contrastx2 | ok | same / same |
| `/settings/connected-apps` | 200 | sidebar | 연결된 앱 | Y | OK | color-contrastx1 | ok | same / same |
| `/password-change` | 200 | topbar key icon | 비밀번호 변경 | n | OK | OK | ok | same / same |
| `/onboarding` | 200 | ORPHAN? inbound 0 | 시작하기 빈 워크스페이스 가이드 | n | OK | OK | ok | same / same |
| `/oauth/authorize` | 200 | ORPHAN? inbound 0 | 외부 앱 연결 허용 | n | OK | OK | ok | same / same |
| `/proposals/bogus/confirm` | 200 | ORPHAN? inbound 0 | 결정 제안 확인 | n | OK | OK | ok | same / same |
| `/admin` ->/deals | 200 | admin sidebar (admin only) | 검토/안건 보드 | Y | OK | color-contrastx2 | ok | same / redir /admin |
| `/admin/users` ->/deals | 200 | admin sidebar (admin only) | 검토/안건 보드 | Y | OK | color-contrastx2 | ok | same / redir /admin/users |
| `/admin/audit` ->/deals | 200 | admin sidebar (admin only) | 검토/안건 보드 | Y | OK | color-contrastx2 | ok | same / redir /admin/audit |
| `/admin/data-sources` ->/deals | 200 | admin sidebar (admin only) | 검토/안건 보드 | Y | OK | color-contrastx2 | ok | same / redir /admin/data-source |
| `/admin/schedule` ->/deals | 200 | admin sidebar (admin only) | 검토/안건 보드 | Y | OK | color-contrastx2 | ok | same / redir /admin/schedule |
| `/admin/database` ->/deals | 200 | admin sidebar (admin only) | 검토/안건 보드 | Y | OK | color-contrastx2 | ok | same / redir /admin/database |
| `/admin/notifications` ->/deals | 200 | admin sidebar (admin only) | 검토/안건 보드 | Y | OK | color-contrastx2 | ok | same / redir /admin/notificatio |
| `/admin/glossary` ->/deals | 200 | admin sidebar (admin only) | 검토/안건 보드 | Y | OK | color-contrastx2 | ok | same / redir /admin/glossary |
| `/admin/governance` ->/deals | 200 | admin sidebar (admin only) | 검토/안건 보드 | Y | OK | color-contrastx2 | ok | same / redir /admin/governance |
| `/admin/master-data` ->/deals | 200 | admin sidebar (admin only) | 검토/안건 보드 | Y | OK | color-contrastx2 | ok | same / redir /admin/master-data |
| `/admin/business-targets` ->/deals | 200 | admin sidebar (admin only) | 검토/안건 보드 | Y | OK | color-contrastx2 | ok | same / redir /admin/business-ta |
| `/admin/adr` ->/deals | 200 | admin sidebar (admin only) | 검토/안건 보드 | Y | OK | color-contrastx2 | ok | same / redir /admin/adr |
| `/admin/system-mode` ->/deals | 200 | admin sidebar (admin only) | 검토/안건 보드 | Y | OK | color-contrastx2 | ok | same / redir /admin/system-mode |
| `/agents` | 200 | ORPHAN? inbound 0 | S2 기회 발굴 | Y | OK | color-contrastx2 | ok | same / same |
| `/brownfield` ->/deals/demo-s1-s12-opportunity | 200 | in-page only (4) | S6/S7 대상발굴·선정 | Y | OK | color-contrastx5 | OVF 380px | same / redir /brownfield |
| `/brownfield/targets/demo-s1-s12-target-1` | 200 | in-page link | S6/S7 대상발굴·선정 — 후보 상세 | n | OK | color-contrastx4 | ok | same / same |
| `/companies` | 200 | ORPHAN? inbound 0 | 회사 | n | OK | OK | OVF 19px | same / same |
| `/companies/md-synergy-registry-sentinel` | 200 | in-page link | 회사 재무성과 분석 — (시너지 레지스트리 대상) | n | color-contrastx1 | color-contrastx1 | ok | same / same |
| `/greenfield` ->/deals/e2e-gf-opportunity/s5 | 200 | in-page only (3) | S5 자체 진출 | Y | OK | color-contrastx3 | OVF 225px | same / redir /greenfield |
| `/market` | 200 | in-page only (21) | S1 시장분석 | n | OK | OK | ok | same / same |
| `/opportunities` | 200 | in-page only (6) | S2 기회 발굴 | n | OK | OK | ok | same / same |
| `/opportunities/{opp}` | 200 | ORPHAN? inbound 0 | S1-S12 데모 Brownfield 기회 | n | OK | OK | ok | same / same |
| `/our-company` | 200 | ORPHAN? inbound 0 | S3 그룹/계열사 분석 | Y | OK | color-contrastx3 | ok | same / same |
| `/pipeline` ->/deals | 200 | ORPHAN? inbound 0 | 검토/안건 보드 | Y | OK | color-contrastx2 | ok | same / same |
| `/portfolio-view` | 200 | ORPHAN? inbound 0 | 포트폴리오 전체 뷰 | n | OK | OK | ok | same / same |
| `/process/S1` | 200 | ORPHAN? inbound 0 | S1 시장분석 | n | OK | color-contrastx2 | ok | same / same |
| `/route-decision` | 200 | in-page only (5) | S4 진출방식 결정 | n | OK | OK | ok | same / same |
| `/synergy` | 200 | in-page only (5) | S3 시너지·전략적 적합성 | n | OK | OK | ok | same / same |
| `/projects/{prj}` | 200 | in-page link | 프로젝트 개요 — S1-S12 데모 Brownfield 프로젝 | n | OK | color-contrastx2 | ok | same / same |
| `/projects/{prj}/process` | 200 | in-page link | 프로세스 현황 — DEMO-S1-S12 | n | OK | color-contrastx3 | ok | same / same |
| `/projects/{prj}/business-case` | 200 | in-page link | S8 사업성 분석 — 이중 관점 밸류에이션 비교 | Y | OK | color-contrastx3 | ok | same / same |
| `/projects/{prj}/charter` | 200 | in-page link | 프로젝트 추진계획 — 목적·범위·KPI 사전 확정 | n | OK | color-contrastx3 | ok | same / same |
| `/projects/{prj}/dd` | 200 | in-page link | S9 실사·검증 — DD 체크리스트 판정 | Y | OK | color-contrastx3 | OVF 147px | same / same |
| `/projects/{prj}/ic-review` | 200 | in-page link | S11 투자심사·실행 — IC 패키지 · Entity/Grou | Y | OK | color-contrastx3 | ok | same / same |
| `/projects/{prj}/portfolio` | 200 | in-page link | S12 사후 관리 — 포트폴리오 스코어카드 · 전환 결정 | Y | OK | color-contrastx4 | ok | same / same |
| `/projects/{prj}/reports` | 200 | in-page link | 보고서 — 스냅샷 · 렌더러 | n | OK | color-contrastx3 | ok | same / same |
| `/projects/{prj}/share` | 200 | in-page link | 외부 안전 공유 security 설계 승인 전제 | Y | OK | color-contrastx4 | ok | same / same |
| `/projects/{prj}/timeline` | 200 | in-page link | 프로세스 타임라인·SLA | n | OK | color-contrastx3 | ok | same / same |
| `/projects/{prj}/wacc` | 200 | in-page link | WACC 입력 세션 — FS 진행 할인율 확정 | n | label-content-name-mismatchx1 | color-contrastx2;label-content-name-mismatchx1 | OVF 7px | same / same |
| `/projects/{prj}/agent-runs` | 200 | in-page link | 에이전트 실행 이력 | n | OK | color-contrastx3 | ok | same / same |
| `/projects/{prj}/backtest` | 200 | in-page link | 예측-실적 백테스트 조직 집계 | n | OK | color-contrastx2 | ok | same / same |
| `/projects/{prj}/comp-parity` | 200 | in-page link | 경영진 보상·임금 형평 | n | OK | color-contrastx2 | ok | same / same |
| `/projects/{prj}/customer-coc` | 200 | in-page link | 고객 집중·CoC | Y | OK | color-contrastx3 | ok | same / same |
| `/projects/{prj}/deal-structure` | 200 | in-page link | S10 투자구조 설계 — 비히클·4축 검토·자금조달 | Y | OK | color-contrastx3 | ok | same / same |
| `/projects/{prj}/debt` | 200 | in-page link | 부채·커버넌트 | Y | OK | color-contrastx4 | ok | same / same |
| `/projects/{prj}/financial-analysis` | 200 | in-page link | 재무분석 — 대상 회사 연결 | n | color-contrastx1 | color-contrastx3 | ok | same / same |
| `/projects/{prj}/incentives` | 200 | in-page link | 인센티브·클로백 | Y | OK | color-contrastx4 | ok | same / same |
| `/projects/{prj}/interviews` | 200 | in-page link | 전문가 인터뷰·채널 체크 | Y | OK | color-contrastx3 | ok | same / same |
| `/projects/{prj}/partnership` | 200 | in-page link | 파트너 검토·JV 조건 | n | OK | color-contrastx3 | ok | same / same |
| `/projects/{prj}/permits` | 200 | in-page link | 인허가·인증 추적 | Y | OK | color-contrastx3 | ok | same / same |
| `/projects/{prj}/pmi` | 200 | in-page link | PMI 사후통합 | n | OK | color-contrastx3 | ok | same / same |
| `/projects/{prj}/proxy-chain` | 200 | in-page link | 가치사슬 연계 — 링크와 보정 근거 | n | OK | color-contrastx2 | ok | same / same |
| `/projects/{prj}/risk-heatmap` | 200 | in-page link | 검토/안건 리스크 히트맵 | n | OK | color-contrastx2 | ok | same / same |
| `/projects/{prj}/sites` | 200 | in-page link | 부지·시설 평가 | Y | OK | color-contrastx3 | ok | same / same |
| `/this-route-does-not-exist` | 404 | ORPHAN? inbound 0 | 404 | n | OK | color-contrastx13 | ok | same / same |

### Anonymous

| Route | HTTP (first hop) | Final | h1 | Primary | Axe |
|---|---|---|---|---|---|
| `/login` | 200 | -> /login | co-newbiz 로그인 | Y | OK |
| `/register` | 200 | -> /register | 계정 신청 | n | OK |
| `/onboarding` | 200 | -> /login | co-newbiz 로그인 | Y | OK |
| `/oauth/authorize` | 200 | -> /login | co-newbiz 로그인 | Y | OK |
| `/inbox` | 200 | -> /login | co-newbiz 로그인 | Y | OK |
| `/this-route-does-not-exist` | 404 | -> /login | co-newbiz 로그인 | Y | OK |

## Notes and limits
- "Primary" = visible `.btn-primary`; pages without one are read/list screens, not necessarily defects (finding 9 lists those that should have one).
- Dark mode tested by toggling `html[data-theme=dark]` after load; transitional contrast on first paint not measured.
- `/proposals/{id}/confirm` and `/oauth/authorize` real-data paths (pending proposal, valid client) were not seeded; only the empty/invalid states were exercised.
- Viewer/admin axe was captured mid-load on some pages, which is where the aria-label-on-div skeleton hits come from.
- No source edited. Screenshots: 376 files (~36 MB) in the evidence folder.
