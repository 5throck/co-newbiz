# UI Specification — co-newbiz

> **⚠ Status note (2026-09-08)**: this spec's as-built markers were recorded
> against the decommissioned `app/web/src/` stack (Hono/React-Vite, removed by
> ADR-0069's cutover, PR #142). The current and only web surface is
> **`app/web-next`** (Next.js App Router, Route Handlers, Bun + `bun:sqlite`).
> The design system is **Onyx 3.0 — light default + dark** (`[data-theme="dark"]`),
> not the Onyx 2.0 dark-only setup described below. For current design rules
> and screen patterns, `docs/design-system/design-guide.md` (gov-des-00) and
> `docs/design-system/design-screens.md` (gov-des-04) are the design policy of
> record; this file remains as the FR-mapped as-built history and its rule
> rationale (§1) still applies.


**Owner**: frontend-engineer
**Design of record**: design v1.0 §4-10 (task 4.4), `docs/architecture/srs.md` §12
**Status**: Korean UI (design §4-1 language policy — deliverables/UI Korean, code/docs English). Implemented Stage 5 Wave 5.6 (`app/web/src/pages/`: `Login.tsx`, `PasswordChange.tsx`, `ProjectList.tsx`, `ProjectDetail.tsx`, `AdminConsole.tsx`) plus PR #65's eight Project Detail tabs (`app/web/src/components/`: `DataTab.tsx`, `AssumptionsTab.tsx`, `ModelTab.tsx`, `SimulationTab.tsx`, `VersionCompareTab.tsx`, `DdTab.tsx`, `PermitsTab.tsx`, `MaReviewTab.tsx`) — **partial; verified row-by-row against `app/web/src/` on 2026-08-21** (per-node markers in §2, per-rule notes in §1/§3/§4): the Project List page and Project Detail shell are built; 개요 / 절차 뷰어 / 용어집 (tooltip + standalone searchable view at `/glossary` + in-context auto-linking over key/en/ko — alias auto-detection gated on the list endpoint) are partial; Data / Assumptions / Model / Simulation / Version Comparison / DD / Regulatory & Permits / M&A Review are partial (read views built, write forms and charting deferred, see §2); 2 of Project Detail's 13 child views (Financial Analysis, Proxy Chain) plus Reports are not built at all; and the admin console covers 5 of §5's 10 designed sections (Users, Audit Log, Data Sources, Batch/Schedule, Database — the last one partial: retention only; see `skills/admin-console-operations/SKILL.md` for the section-by-section breakdown, which predates batch 4's two additions).

## 1. Design Rules (Non-Negotiable)

- **Every numeric figure carries a source tooltip** (`assumption_key`, `as_of`, `source`, `anchor_ref`) sourced directly from the API response envelope's `meta` block (FR-SYS-03) — never hand-typed.
  *As-built (2026-08-21, PR #63): mechanism built — `SourceTooltip.tsx` (hover/focus/click-pin popover, keyboard + `aria-expanded`/`aria-describedby`, dark-mode via the existing custom properties) plus `provenanceOf()` in `api.ts`, which reads the envelope `meta` and merges per-row provenance columns the payload already carries (the RAG endpoint puts `run_id`/`assessed_at` per dimension in rows, not meta — both sources are API-sourced, neither hand-typed; absent fields are omitted, never placeholder-filled). Applied to: the RAG card's assessed-count figure and per-dimension grade badges (`run_id`, `assessed_at`, envelope `as_of`), and procedure threshold values (envelope `as_of` only). Backend gap: no route populates `assumption_key`/`source`/`anchor_ref` in `meta` today — api-spec §9's contract is not yet realized server-side — and the endpoints carrying per-row provenance (assumptions, observations, dd-findings) have no consuming view yet, so those unwritten figures stay un-wrapped rather than wearing empty tooltips.*
- **Color is never the sole differentiator** for RAG status — icon + label + color together (FR-SYS-05), verified by `accessibility-audit` (WCAG 2.1 AA).
  *As-built: met in `RagCard.tsx` — every grade badge renders icon + label + color together. The WCAG 2.1 AA audit itself is a runtime `accessibility-audit` run; not verifiable from source.*
- **No "PASS" stamp anywhere in the human review surface** — output is always split verified / could-not-verify / needs-judgement (FR-REV-02).
  *As-built: no PASS stamp exists in any built view — but the human review surface this rule governs is itself not yet built, so the rule holds by absence, not by exercise.*
- **Glossary term tooltip** on any registered term in body text, dashed underline, click/hover popover (FR-SYS-04).
  *As-built: built — `GlossaryTerm.tsx` implements the pattern (dashed underline, click/hover popover, keyboard-reachable button, wired to `/api/glossary/:term`), and since PR #65 batch 5 registered terms are auto-detected in body text: `glossary.tsx` provides `GlossaryProvider` (session-once `GET /api/glossary` fetch, authenticated mounts only), `useGlossaryTerms()` (lookup map built from key/en/ko), and the `GlossaryText` renderer (longest-match-first alternation; word-boundary + case-insensitive for Latin forms; exact-string for Korean forms — Hangul has no `\b` in JS regex; per-text segmentation memoized in a bounded module cache + React.memo). Applied to the free-text prose fields rendered today: DD finding descriptions, assumption rationales, contingent-liability descriptions, antitrust remedy details. Alias auto-detection stays gated — `GET /api/glossary` returns no aliases (they exist only on the per-term detail endpoint; no N+1 fetching to work around it). The two hand-placed example terms on 개요 remain as harmless explicit examples.*
- **3-depth navigation maximum** (design §4-10).
  *As-built: met — the deepest route is `/projects/:id` (depth 2); within-page sections are client-side tab state, not nested routes.*
- Light default + dark theme (Onyx 3.0 design system, `[data-theme="dark"]`); layout responsive down to tablet width.
  *As-built (superseding the 2026-08-27 Onyx 2.0 dark-only note): Onyx 3.0 in `app/web-next/app/styles.css` — light default, dark via `[data-theme="dark"]`. Tablet responsiveness: sidebar collapses at ≤880px via AppShell media query.*

## 2. Information Architecture

As-built markers, verified against `app/web/src/` on 2026-08-21: ✅ built · ⚠️ partial (reason given) · ❌ not built. The spec text stays the target; markers record what exists.

```
대시보드 (Dashboard)
├── 프로젝트 목록 (Project List) — RAG card grid, staleness badges, notification center
│   · ⚠️ partial: page, card grid, and create-form built; a notification-center entry (`NotificationBell.tsx` — one-shot `GET /api/notifications`, popover listing recent items with severity chips) added in PR #63, honestly counting recent-total because the notification table has no read/unread state (backend gap: no `read_at` column, no mark-read endpoint). RAG and staleness badges are implemented client-side but gated on optional list-payload fields (`rag_overall`, `rag_assessed_at`, `stale`) that `GET /api/projects` does not return yet (backend gap; no per-card `/rag` fetch was added to avoid an N+1 storm), so against today's backend cards still render project_no + created date only
├── 프로젝트 상세 (Project Detail) · ✅ shell built (MNPI banner, tab navigation; see deltas below)
│   ├── 개요 (Overview) — RAG signal card, history sparkline, transition log
│   │   · ⚠️ partial: RAG signal card built per §3; history sparkline and transition log not built
│   ├── 절차 뷰어 (Procedure Viewer) — merged shared/region/entity view with per-step source attribution
│   │   · ⚠️ partial: merged view, per-step source badges, and thresholds built (§4); override flag + baseline link and R&BD checklist panel not built
│   ├── 데이터 (Data) — series browser, staleness indicators
│   │   · ⚠️ partial (PR #65): `DataTab.tsx` built — series search (`GET /api/series?q=`), selected series' latest-revision observations (`GET /api/series/:id/observations`, unit/source per row, value wrapped in `SourceTooltip`), and the recent data-change log (`GET /api/data-changes`, icon+label+color per change_type, old→new values). series charting built (ECharts time-series line chart via `EChart.tsx`, SSR-safe `next/dynamic` ssr:false). an `all_revisions=1` toggle added (checkbox on the observations section; the chart always plots per-period latest revisions while the table shows every revision). per-series staleness badges added (`GET /api/series` now carries the real `last_fetched_at`/`days_since_fetch`/`stale` with a 90-day threshold echoed in meta; the series table renders ● 수집 N일 전 / ■ 갱신 지연 — icon+label, never color-only). Deferred: none remaining for this view
│   ├── 재무 분석 (Financial Analysis) — ROIC driver-tree waterfall, peer boxplot, projection with anchor markers · ⚠️ partial (2026-08-27 web-implementation-plan): ROIC driver-tree + margin-bridge waterfall built (`GET /api/projects/:id/roic-tree`, `RoicTree.tsx` on the 모델 tab) — computes ROIC/NOPAT margin from present fact_industry metrics, degrades to an honest "insufficient data" note when base metrics are absent; ECharts waterfall chart added (`RoicWaterfallChart.tsx`, `next/dynamic` ssr:false). Deferred: peer boxplot. Projection with anchor markers — engine-dependent, added an honest `EnginePendingPanel` placeholder (growth-projection endpoint is forward-design, not yet built).
│   ├── 프록시 체인 (Proxy Chain) — chain diagram, hop-level reliability grade, error-band display · ⚠️ partial (2026-08-27 web-implementation-plan): hop-level reliability grade view built (`GET /api/projects/:id/proxy-chain-grade`, `ProxyChainGrade.tsx` on the 시장·체인 tab) — stored vs recomputed grade (db/lib/chain-grading.ts) with per-hop type/R²/CI table and mismatch warning. chain diagram (topology-based) and compounded-CI error-band display added. Deferred: none remaining for this view.
│   ├── 가정 (Assumptions) — assumption registry, kind/rationale/ttl display
│   │   · ⚠️ partial (PR #65): `AssumptionsTab.tsx` built — read-only registry table for the project's latest run (`GET /api/projects/:id/runs` then `GET /api/assumptions?run_id=`): assumption_key, kind chip, value (source-tooltipped), as_of, ttl_days, and a mandatory-visible rationale column (never hover-only) for `kind='assumed'` rows. a run picker added (defaults to the newest run, selectable from `GET /api/projects/:id/runs`). the write form (`POST /api/assumptions`) added (UI form in `AssumptionsTab.tsx`, posts to the existing endpoint). Deferred: none remaining for this view
│   ├── 모델 (Model) — waterfall + tornado charts
│   │   · ⚠️ partial (PR #65 batch 3): `ModelTab.tsx` built — runs list (`GET /api/projects/:id/runs`: label, input_hash short form, input_count, created_at, newest-first), create-run form (`POST /api/projects/:id/runs`: label, from_run_id dropdown defaulting to latest, `set` key/number override rows) with a 403 rendering a clear analyst-role message and the run's honest v1 note ("버전화된 입력 스냅샷" — valuation output arrives with the model engine), and a selected run's immutable input snapshot (`GET /api/runs/:id`, values source-tooltipped by assumption_key). Model waterfall + tornado — honest `EnginePendingPanel` placeholders added (valuation engine does not exist yet; no output to chart). Deferred: model-engine output view.
│   ├── 시뮬레이션 (Simulation) — histogram + CDF, seed display
│   │   · ⚠️ partial (PR #65 batch 3): `SimulationTab.tsx` built — run dropdown (default latest), trigger form (`POST /api/simulations`: iterations/seed optional, with the deterministic-seed note — omitted seed derives from the input hash), results from `GET /api/simulations/:id/results` as a quantile table (metric, p05/p50/p95/mean/std, source-tooltipped by run_id+as_of) with seed/iterations shown in the header from the envelope meta and a no-raw-draws honesty note; 400 `simulation_rejected` shows the server's caller-fixable message verbatim, 403 shows the analyst-role message. Histogram + CDF — (2026-08-28) REAL distribution built: the simulation bridge (`db/lib/simulation.ts` 1.1.0) now requests and persists the engine's per-iteration draws into `simulation_draw` (retention-purgeable per migration 0005), and `GET /api/simulations/:id/results` serves a server-side 40-bin histogram + 100-point CDF aggregate (raw draw rows are still never exposed — api.test.ts pins the absence of a `draws` property); `SimulationDistChart.tsx` renders the real distribution when present and keeps the clearly-labelled illustrative quantile reconstruction only as the fallback for pre-draw simulations. Deferred: simulation-history list (only the just-triggered simulation renders).
│   ├── 버전 비교 (Version Comparison) — waterfall bridge between two runs
│   │   · ⚠️ partial (PR #65 batch 3): `VersionCompareTab.tsx` built — two run selectors (A vs B, defaulting to the two most recent runs) over `GET /api/runs/:id/diff/:otherId`: changed rows (key, A → B values, signed delta with ▲ 증가/▼ 감소 icon+label+color — never color-only), B에 신규 (added) and A에서 제거됨 (removed) sections, both input_hashes displayed, and the honest v1 note that NPV-level decomposition arrives with the valuation engine. Waterfall-bridge — honest `EnginePendingPanel` placeholder added (NPV-level decomposition arrives with the valuation engine).
│   ├── 법령·인허가 (Regulatory & Permits) — DAG with critical-path highlighting
│   │   · ⚠️ partial (PR #65): `PermitsTab.tsx` built — `GET /api/projects/:id/permits?include_dag=1`; permit and certification lists (status icon+label+color) rendered as clearly-separated parallel sections, never merged; DAG shown as a hand-rolled client-side topological layering (Kahn's algorithm, no graph library) plus a plain edge list, critical-path nodes flagged with a border + badge (not color-only). a true node-link graph rendering added (hand-rolled SVG, client-side Kahn layering, cross-layer edges drawn, critical path highlighted red). Deferred: none remaining for this view
│   ├── M&A 검토 (M&A Review, BF only) — antitrust HHI, customer-attrition risk, clawback exposure; R&BD sub-panel (TRL, IP/FTO status, commercialization-path, rbd_source) when technology_track=rbd
│   │   · ⚠️ partial (PR #65 batch 2): `MaReviewTab.tsx` built with six sections — 독과점 (`GET /api/projects/:id/antitrust`: market_definition, HHI 사전/사후/변화 source-tooltipped, remedy_type chip none/behavioral/structural/prohibited with icon+label+color, discharge_confirmed_at), 인센티브 (`GET /api/projects/:id/incentives` grouped by direction prospective/granted, amount/npv/estimated_clawback source-tooltipped, obligation_json parsed to a readable summary, clawback exposure highlighted with a bordered ⚠ note), 부채·우발채무 (`GET /api/projects/:id/liabilities` — debt_instruments / contingent_liabilities / covenant_tests sub-sections; breached covenants get a ■ 이탈 badge, icon+label, not color-only), 부지 비교 (`GET /api/projects/:id/sites` — one row per site on one table, FR-GF-04), 파트너 (`GET /api/projects/:id/partners` — cards with score figures and a compliance-risk chip High/Medium/Low, icon+label+color), and 밸류체인 연관성 (`GET /api/projects/:id/value-chain-links` — from/to industry, direction, elasticity/lag/correlation/r²/pass-through/HHI, per-row assessed_at + evidence_ref provenance). BF-only gating NOT implemented: `GET /api/projects/:id` returns only id/project_no/created_at (+classification meta) — no case-type indicator exists in the payload, so the tab renders unconditionally (backend gap). (2026-08-28) 경영진 보상 (`GET /api/projects/:id/management-package` — executive_ref 역할 기반 식별자만, 실명 컬럼은 스키마에 없음 FR-MA-06/SEC-05; viewer 403 시 서버 메시지 그대로 표시) and 보수 벤치마크 (`GET /api/projects/:id/comp-benchmark` — 직군×등급 집계 전용) sections added (api-spec §4 as-built). Deferred: customer-attrition risk (no storage table exists — forward-design; findings today would live as dd_finding rows), and the R&BD sub-panel — which this wave implemented on the 실사 tab instead, where the R&BD rows actually live
│   ├── 실사 (DD) — dd_finding list with value_impact links
│   │   · ⚠️ partial (PR #65): `DdTab.tsx` built — `GET /api/projects/:id/dd-findings`, category filter chips (derived from the returned rows), finding cards (description, value_impact source-tooltipped by assumption_key, evidence_ref), and a visually distinct R&BD sub-panel (rbd_source, trl_grade, ip_ownership_status, commercialization_path) for `category='rbd'` rows. the write form (`POST /api/projects/:id/dd-findings`) added (UI form in `DdTab.tsx`, posts to the existing endpoint). value_impact deep-links added — a finding's assumption_key renders as an in-page link that switches to the 가정 tab with the whole-key lookup (`GET /api/assumptions?key=`, all runs) and an explicit return-to-run view control. Deferred: none remaining for this view
│   ├── /market (S1 워크스페이스) — systematic-market-sizing 8단계 리포트 (2026-08-31 as-built): 산업 테이블 랜딩(분석 상태·분석일·재분석 액션, 신규 산업 분석 폼, LLM 구성 상태 표시) → 8단계 리치 리포트(기준 시장규모 삼각검증, 권역·세그먼트 배분 도넛/적층, 셀별 CAGR·시나리오 밴드 레인지 차트, 권역별 시나리오 2030, 4-A 연도별 점유율 적층 영역, 성장률 정합성, 외부 전망 대비 격차 분석(5-B — 입수 시), 기업 공시 교차검증 판정 표, 분석 한계 목록, 가정 레지스트리 등록 상태 라이브 뷰) + 버전 이력 바. 신규 분석은 lib/market-sizing-pipeline.ts가 LLM으로 SizingMatrix를 생성(버전 append-only, 수동 확정 항목 명시), 시장분석 인사이트는 /opportunities 상단 패널로 S2에 연동.
│   ├── 시장·체인 (Market & Chain) — ADR-0066 Phase D
│   │   · ⚠️ partial (PR #126): `MarketChainTab.tsx` built — 체인 구조 레이어 뷰 (`GET /api/projects/:id/value-chain/topology`, 링크 계수 테이블 포함), 노드별 5년 재무 테이블 + 폴백 임포트 미니폼 (`GET .../industries/:id/financials`, `POST .../financial-imports`), 구조 시뮬레이션 러너 (런/시나리오 선택 → `POST .../structure-simulations` → P05/P50/P95 결과 테이블; 미기록 드라이버·UNASSESSED 노드 배너 공개)
│   ├── PMI·증거 (PMI & Evidence) — ADR-0063 write surfaces
│   │   · ⚠️ partial (PR #119): `PmiEvidenceTab.tsx` built — 네 증거 테이블의 목록+입력 폼 (핵심인력 명부 `GET/POST /api/projects/:id/pmi/key-talent`, 시너지 인증 `.../pmi/synergy-certifications` — ≥9,000bp·2분기 규칙 힌트 표기, 딜 쉐이프 평가 `.../deal-shape-evaluations` — 8종 enum 셀렉트, 인센티브 마감일 `.../incentive-deadlines` — 최조 마감 선두 정렬) + 판단 변수 어설션 루프 (`GET/POST .../dimension-inputs`, 교차 검토 버튼; 검토 전 행은 "검토 대기" 명시). 금액 필드는 KRW 백만원 단위 라벨링 (ADR-0061)
│   └── 용어집 (Glossary) — searchable, in-context
│       · ⚠️ partial: tooltip component built and wired to `/api/glossary/:term`; searchable view built in PR #65 batch 4 as a top-level route (`/glossary`, `Glossary.tsx`) rather than a ProjectDetail tab — the glossary is workspace reference data with no project binding, and ProjectDetail's tab bar already carries 11 project-scoped tabs (route choice recorded here; the IA tree above keeps the node under Project Detail as the design target). Search is client-side over the fields the list payload carries (key/ko/en/category); alias search is not possible — `GET /api/glossary` returns no aliases (backend gap; aliases exist only on the per-term detail endpoint, which the cards' tooltip reuses for definition/why_it_matters). In-context auto-linking built in PR #65 batch 5 (`glossary.tsx`: provider + hook + `GlossaryText` renderer, applied to DD descriptions, assumption rationales, contingent-liability descriptions, antitrust remedy details — see §1's FR-SYS-04 note); alias auto-detection gated on the same list-endpoint gap; two hand-placed example terms remain on 개요
├── 관리자 콘솔 (Admin Console) — see §5 · ⚠️ partial: all 10 of 10 sections built (Users, Logs, Data Sources, Batch/Schedule, Database retention, Notifications, Glossary — the last three render explicit read-only views; Governance docs, Master data, ADR index now render real read endpoints, see §5)
└── 보고서 (Reports) — generated deliverable list, export controls · ⚠️ partial (2026-08-27 web-implementation-plan): document list + superseded chain built (`GET /api/reports`, `/reports` page, nav entry in `AppShell.tsx`); browser-print/PDF export wired, DOCX/HWPX/PDF export built (`GET /api/reports/:id/export?format=docx|hwpx|pdf` via `scripts/co-newbiz/report.ts` -> `python/report/render_*.py`)
```

As-built deltas not in the tree above:

- The 대시보드 (Dashboard) root is not a separate screen — `/` redirects to `/projects`.
- Project Detail ships a 멤버십 (Membership: user, project role, grantor, need-to-know basis) tab which this tree does not list — an addition, not a substitution.
- 용어집's searchable view is a top-level route (`/glossary`), not a ProjectDetail child tab — the glossary is workspace reference data with no project binding (route choice rationale in the 용어집 node marker above).

## 3. RAG Display Contract

- **RAG signal card**: overall badge (icon + label + color) + six dimension sub-badges.
  *As-built: built in `RagCard.tsx` — overall badge plus six hardcoded dimension sub-badges; since PR #63 each sub-badge and the assessed-count figure carry a source tooltip rendering the payload's `run_id`/`assessed_at` plus the envelope's `as_of`/`assessed_at` (FR-SYS-03).*
- **Never render an overall grade without checking whether all six dimensions completed** — a partial assessment shows "평가 미완료" (assessment incomplete), never defaults to a color.
  *As-built: built — an incomplete set renders 평가 미완료 for the overall grade and 미평가 per missing dimension; there is no default-color path.*
- **Rationale line is mandatory display**, not a hover-only detail — "데이터 신뢰도 B등급으로 상한" (capped at Amber by Grade-B data confidence) must be visible without an extra click.
  *As-built: built — rationale renders as an always-visible paragraph under each assessed dimension, not a hover detail.*
- **Structural vs. behavioral remedy distinction** (`docs/governance/rag-framework.md` §2.5) shown explicitly on the Regulatory/Permit dimension sub-badge when applicable — "구조적 시정조치 이행완료" vs. "행태적 시정조치 이행중 (잔여 X개월)".
  *As-built: not implemented — `RagDimension` carries no remedy-kind field, and the Regulatory/Permit sub-badge renders identically to every other dimension.*

## 4. Procedure Viewer

- Renders the **merged** result of `proc:resolve` (shared → region → entity precedence), with each step's source layer visually distinguished (e.g. a small badge: 공통/지역/각사).
  *As-built: built in `ProcedureViewer.tsx` — merged `proc:resolve` output with 공통/지역/각사 source badges, an applied-layers line, and a thresholds block.*
- A step that is an entity/region **override** (`add_steps`/`replace_steps`) is visually flagged, with a link back to the shared baseline step it modifies.
  *As-built: not implemented — the `_source` badge shows which layer a step came from, but there is no override flag and no link back to the shared baseline step.*
- For R&BD-flagged projects, an additional inline panel surfaces `checklists/rbd-technology-checklist.yaml` alongside the base Brown Field checklist.
  *As-built: not implemented — no R&BD checklist panel exists; the viewer also resolves whatever procedure key the user types rather than binding to project context.*

## 5. Admin Console

| Section | Contents | Notes |
|---|---|---|
| 사용자 관리 (User Management) | Approve/suspend, role assignment | Does not grant project visibility (FR-SEC-02) |
| 데이터베이스 관리 (Database) | Migration status, backup history | Read-heavy, links to `job_run` — *As-built (PR #65 batch 4): partial — the retention-policy half is built (table from `GET /api/admin/retention` + audited upsert form `POST /api/admin/retention`); migration status and backup history have no endpoints and render an explicit "아직 API가 없습니다" note, never placeholders* |
| 배치·스케줄 관리 (Batch/Schedule) | `job_run` history, retry, `schedule_job` edit | — *As-built (PR #65 batch 4): job registry + last-run status/time + enable/disable toggle (optimistic, revert-on-error) built; `job_run` history beyond the latest run and the retry action are not built* |
| 알림 관리 (Notifications) | `rag_rule` threshold editing (with mandatory ADR reference before save) | *As-built (2026-08-28): 알림 목록 + 감시 규칙 추가 form (`POST /api/watch`, `watch_rule.adr_ref` migration 0036). ADR reference is a client-side hard block — empty ref disables submission (FR-GOV/ui-spec §5), stored per rule.* |
| 규정·절차 관리 (Governance) | `governance_doc` version list, `project_policy_pin` status, impact-analysis viewer | *As-built (2026-08-27): governance document list built (`GET /api/admin/governance` from `governance_doc`)* |
| 용어집 관리 (Glossary) | Undefined-term queue from `glossary:lint`, registration workflow | *As-built (2026-08-28): 용어 목록 (`GET /api/glossary`) + registration workflow built (`POST /api/glossary`, admin-only; appends to the category YAML SSOT via `lib/glossary-write.ts`, `why_it_matters_ko` mandatory, duplicates rejected in favor of merging) + the undefined-term queue built (`GET /api/admin/glossary-lint` — the report-only scanner over skills/+docs/ prose, top-200 frequency-first findings with the total echoed in meta, curator-triage table above the registration form). Deferred: none remaining for this view* |
| 데이터 소스 관리 (Data Sources) | Presence + last-success timestamp **only** — no key-value field exists in this UI at all, not just hidden | FR-SYS/design §4-9 |
| 기준정보 관리 (Master Data) | `staging_unmapped` resolution queue | *As-built (2026-08-27): master-data queue built (`GET /api/admin/master-data` from `staging_unmapped`)* |
| 거버넌스 (ADR/Stage Gate) | ADR index, stage-gate configuration | *As-built (2026-08-27): ADR index built (`GET /api/admin/adr` scanning `docs/adr/*.md`); Master data built (`GET /api/admin/master-data` from `staging_unmapped`)* |
| 로그 관리 (Logs) | Audit log viewer, **no delete control rendered anywhere in this screen** | FR-SEC-07 |

## 6. Accessibility

- `accessibility-audit` skill run against every screen before Stage 5 release (WCAG 2.1 AA).
- Keyboard navigation for all interactive elements, including the procedure-viewer's step-source badges and the RAG card's dimension drill-down.
- Screen-reader labels distinguish "Green" (달성) from "OK" language ambiguity — Korean labels avoid traffic-light color-name-only phrasing.

## 7. Related

- `docs/architecture/api-spec.md` — the API this UI consumes exclusively (no direct DB access from the frontend)
- `docs/governance/rag-framework.md` — the grading logic §3 renders
- `docs/architecture/mcp-integration.md` — the parallel AI-client surface (not this UI, but the same underlying API)

## As-built 2026-09-05 — 금액 표기 통일 + 용어 개선

- 모든 금액 표기는 정수 + 콤마 (소수점 제외) — `fmt()` 헬퍼가
  `Math.round(n).toLocaleString("ko-KR")`을 반환.
- "프로젝트 차터" → "프로젝트 추진계획"으로 라벨 변경 (사용자 이해도 개선).
- 사후관리(S12) 진입 조건 확인 완료: entity_ic+group_ic GO 및 설립 5단계 완료 필요.

## As-built 2026-09-05 — 추진 전략 하위 메뉴 + 위원회 레지스트리 경로 수정

- 탐색 섹션의 S4~S7 구간을 "추진 전략" 하위 메뉴로 재편: 진출방식 결정(/route-decision) ·
  그린필드 — 자체 신설 진출(/greenfield) · 브라운필드 — 결합·투자(/brownfield).
  부모 href는 첫 자식과 동일한 /our-company 패턴.
- 위원회 레지스트리(procedures/_committees.yaml) 로딩 경로를 상위 탐색(walk-up)으로
  수정 — 서버가 app/web-next에서 구동될 때 import.meta.dirname 소실 시
  app/web-next/procedures를 참조하던 ENOENT 해소.
- 용어 규약: "Long List/Short List"는 브라운필드 S6/S7의 대상 후보 회사 목록에만
  사용한다. S3 시너지 화면의 동일 개념은 "시너지 영역 후보/우선 시너지 영역"으로
  표기한다(용어 충돌 제거).

## As-built 2026-09-05 — 로그인 배경 롤링 (ADR-0106)

/login 히어로 영역이 신규사업 모티프 배경 3장(항만·가치사슬 / 도시·인프라 / 스마트
제조·로봇)을 7초 간격 크로스페이드한다. 에셋은 저장소 내 자체 SVG(public/login-bg*.svg),
텍스트 가독성은 베일 그라디언트, 모션은 prefers-reduced-motion 존중. 사이즈는
cover + hero max-width 34rem 제한으로 텍스트 길이·패널 높이와 무관하게 안정.

## As-built 2026-09-05 — S4 결정 근거 패널 + 결정 플로우 가이드

/route-decision에 선택된 기회의 결정 근거 패널과 결정 플로우 가이드를 추가한다.
- 결정 근거 패널(#evidence): 시장(scope·규모·CAGR), 발굴 근거(S2 rationale),
  적합성 판정(fit_verdict/fit_rationale), 시너지 권고(synergy_score + 근거).
- 위원회 심의 이력(#committee): 세션 상태·모드·생성일 + 회의록(markdown) 링크.
- 결정 플로우 가이드(ol): 근거 확인 → 트랙 권고 검토 → 위원회 심의(선택) → 결정 기록.

## As-built 2026-09-05 — 테이블 정렬 정합 + 목록 복귀 단일 패턴

- 목록 테이블: th·td 정렬 일치(텍스트 좌측), 식별 컬럼 첫 열 배치(프로젝트 목록에
  프로젝트명 컬럼 추가 — 0074 charter backfill 데이터 연동).
- 목록 복귀: components/ListBackButton.tsx 단일 컴포넌트(시너지 상세·그룹/계열사
  상세 적용), URL 기반 상세는 Topbar back-link. 화면별 자체 구현 금지.

## As-built 2026-09-04 — StageFrame 단계 설명 문구 표준화

단계 화면 설명 문구는 StageFrame children으로만 전달한다(프레임 밖 `<p>` 분리 금지).
프레임이 0.9rem·muted-fg·leading-relaxed·mb-4로 서식을 표준화하고, 문장은 "~합니다."
종결 1~3문장, 절차·ADR 참조는 문미 괄호로 통일한다(S1/S2/S3/S4/S5/S6·S7 화면 일괄 정정).

## As-built 2026-09-04 — 내비게이션 SSOT + 프로젝트 하위 화면 등록 (ADR-0105)

- 사이드바 메뉴의 SSOT는 `app/web-next/lib/navigation.ts`다(NAV_SECTIONS/ADMIN_NAV/NON_MENU_ROUTES/menuHrefs). AppShell은 이 파일만 렌더링하며 아이콘 매핑(ICON_BY_HREF)만 로컬로 보유한다. 새 표준 화면은 반드시 여기에 등록한다 — 누락·순서 드리프트는 `tests/unit/navigation.test.ts`(페이지↔메뉴 패리티, 탐색 섹션 순서, 중복 href, AppShell SSOT 사용)가 잡는다.
- 프로젝트 하위 화면(/projects/[id]/business-case·dd·ic-review·portfolio·process·charter)은 전역 메뉴 대신 `ProjectSubNav` 상호 링크로 연동된다(상세 화면은 /projects 목록에서 진입).
- 전역 파이프라인 대시보드는 `/pipeline`(모든 프로젝트의 S8~S12 단계·게이트 스냅샷 + HOLD 에이징).
- 탐색 섹션 순서는 flow.spec 단계 순서를 따른다: 대시보드 → 시장분석(S1) → 기회 발굴(S2) → 시너지 정합성(S3) → 진출방식 결정(S4) → 역량 평가·진출전략(S5, greenfield) → 대상 후보 발굴(S6~S7, brownfield) → 프로젝트(S8~S12) → 프로젝트 파이프라인.
- S8 `필요 역량 달성 가능성` panel (ADR-0168, placement amended by ADR-0169): the full table lives at the bottom of the S8 `기술적 타당성` tab (T1 anchor `#capability-attainability`), and a compact link opens it from the 시나리오 sub-tab. Per S3 register row: required/current level (read-only text from S3, `미정` when empty, each with a `S3에서 수정` link to `/deals/{opportunityId}/s3`; ADR-0170), an S3 held summary in the capability cell (holders and a ~40-char evidence preview plus a `보기` button opening a read-only dialog with the full holders list and evidence), resolution route, closing cost (KRW million), months to attain, attainability `높음/중간/낮음/미판정` (text chip, not colour-only) with a grade dropdown (`<select>` 미판정/높음/중간/낮음) (no separate status chip; only an `AI 초안` marker beneath it when the grade is AI-drafted) and ONE `근거·증빙` field (bound to rationale; the table cell shows a ~60-char read-only preview plus an `입력`/`수정` button (`보기` when read-only) that opens a modal with one textarea, a character counter and 저장/취소; legacy stored evidence lines show read-only as `기존 증빙`, and saves omit the evidence key), and a human-only "판정 확정" button. A warning banner shows when any row is `미판정` or `낮음` or the register is empty/unevaluated. The S5 capability table uses the same 5-step select for required and current level.

## As-built 2026-10-14 — S8 IA cleanup (one home per fact, decider-approved)

- Goal attainment (ADR-0159) has ONE home: the `사업 목표` tab renders a single `GoalAttainmentTable` whose columns are all filtered cases (header `시나리오 · 관점`); the scenario sections keep only the one-line link `목표 달성 판정은 사업 목표 탭 →`.
- `TargetCheckPanel` (fs 진행 근거, ADR-0114) renders only on the `결정` tab, above `GateDecisionPanel` — it was on every tab.
- Required-capability notes (S3 table, S5 capability table, S8 `필요 내용 (S3)` column) render through the shared `ClampedText` component: clamped to 2 lines with an ellipsis at every length and no toggle (the full text is the native `title` tooltip on a focusable clamped element, plus a visually hidden full-text span for screen readers); the capability name always shows in full and the S3 first column is width-capped. Row origin text comes from `gapSourceLabel` (`lib/capability-gap.ts`): `S2 스케치에서 도출` / `S1 요인에서 도출` / `시너지 영역에서 도출` / `직접 입력`; inside the S3 screen it never names S3 (the S4 evaluation tab shows `S3 시너지 영역에서 도출`); it replaces the old `출처:` prefix.
- Capability content lives only in the `기술적 타당성` tab; the 시나리오 tab keeps a one-line pointer `필요 역량 달성 가능성 판정은 기술적 타당성 탭 →` (the compact panel copy is gone).
- Generation has ONE primary entry: the overview (`설명·생성·권고`) tab's `이중 관점 자동 생성` button (one row, with the helper `결정 기록은 '결정' 탭에서 합니다.`); the global `밸류에이션 재계산 (재생성)` row is removed. When the idempotency guard reports an already-run generation, the same button escalates to `regenerate: true` so one entry serves both first-run and regeneration. The legacy-model notice keeps its own `대상별 재생성` only while legacy models exist.
- The strip (`S8LensStrip`) no longer renders the `TECHNICAL_CAUTION_WARNING` sentence — the technical chip line already carries `주의 N` (the field stays in the view model for gate-brief consumers).
- Green Field (no target company) shows a single market-based perspective: heading `S8 사업성 분석 — 시장 기반 밸류에이션`, overview section `평가 관점의 의미` (one row + a note that the past-based comparison is Brown Field only), generate button `자동 생성 (시장 기반 × 3 시나리오)`, and no `과거 기반 N/A` row or `두 관점` explanation in `ValuationMethodology`. Brown Field keeps the dual-perspective wording below.
- The `두 관점 차이` explanation lives once in the overview (`기업가치 계산 방법`); the p50-gap hint and the scenario footer became short links `설명: 개요 탭 →`. The EV/매출 밴드 keep their status home on the `대상 비교·선정` tab; `ParamsPanel` keeps the confirm form and points there (`밴드 상태는 대상 비교·선정 탭 →`). `GateDecisionJump` is hidden on the `결정` tab. The overview adoption-recommendation section is labelled `채택 권고 (결정 탭의 게이트 판단과 별개)`; `GateDecisionPanel`'s AI brief (a gate-progression brief, not a case recommendation) is untouched. Dead code removed: `NoGoalsCallout`, `financialSubtabKeys`, the outdated sr-only tab note; the embedded `/deals/[id]/s8` tab surface is unchanged.
- S8 `결정` tab (AI proposals consolidated, decider-approved): one `AI 판단 지원` section (`AiJudgementSupport`) sits below `TargetCheckPanel` and above the gate decision form, with two ordered blocks - `채택할 케이스` (adoption recommendation, requires write access) and `게이트 판단` (gate brief, `GateBriefBody`) - and ONE generate button (`AI 판단 지원 생성`, then `재생성`) that runs both requests in order with per-block loading/error. Both are proposals only; the person records adoption and the gate decision. `근거에 반영` prefills the gate rationale through `GateDecisionPanel`'s `rationalePrefill` prop; the S8 panel passes `hideBrief`, while other gates keep the standalone `AI 진행 브리프`. The overview tab keeps one pointer line to the decision tab instead of the former adoption-recommendation section. No API or storage change.

## As-built 2026-10-14 — S8 two-lens three-part layout (ADR-0169)

- The S8 screen is organised into three major parts with one-line purposes (`S8PartHeader`): `사업 목표` (무엇을 달성하려는가, `?tab=goals`), `기술적 타당성` (실현할 수 있는가, `?tab=technical`), `재무적 타당성` (돈이 되는가, `?tab=financial` → default 설명·생성·권고); Brown Field adds `대상 비교·선정` (`?tab=targets`) and `결정` closes the row — 5 primary tabs BF / 4 GF, within the 5-tab limit. The 재무적 타당성 sub-tab row holds the financial content: 설명·생성·권고 (`?tab=overview`, first and default) / 시나리오 비교 / WACC / 재무분석 / 파라미터·스냅샷 (`?tab=params`) / 타겟코스팅 (`?tab=target-costing`); the more-menu keeps only 요약 and 리스크 히트맵. The three moved `?tab=` deep links still resolve, highlight 재무적 타당성 and show the financial part header. Business-goal setting and status live only in the 사업 목표 tab (the all-tab goals banner was removed). No content is duplicated across parts.
- The 기술적 타당성 tab lists six lens items T1..T6 (`충족/주의/미판정` chips, icon + text): T1 derives read-only from the capability register (clicking it jumps to the panel anchor), T2-T5 and T6 show `미판정` placeholders with a 다음 릴리스 notice (no input UI yet).
- A summary strip (`S8LensStrip`, fed by `GET /api/projects/:id/s8-lens-summary`) renders only on the 결정 tab (above the target check and gate decision; not on other tabs or the WACC / 재무분석 pages): both lens cards side by side, a goals line (목표 N개 중 달성 M개), and the caption 판단 보조 — 최종 판단과 게이트 승인은 사람이 합니다 (warning only, never a grade cap). (The standalone technical-warning sentence was removed on 2026-10-14 — the technical chip itself carries the `주의` count.)
- Deep-link compatibility (`resolveS8Tab`): `?tab=capability` → 기술적 타당성, `?tab=financial` → 시나리오, `#anchor` fragments stripped, unknown values and Green Field `targets` fall back to 시나리오.

## As-built 2026-09-02 — 시너지 정합성 하위 메뉴

- 사이드바 탐색의 시너지 정합성은 하위 메뉴를 갖는다: 그룹/계열사 분석(/our-company) · 시너지·전략적 적합성(/synergy). NavItem.children 지원(AppShell), 자식은 들여쓰기 링크, 부모는 활성 그룹 라벨.
- 그룹/계열사 분석 화면 제목은 "S3 그룹/계열사 분석"(StageFrame heading override — S3 지원 도구 표기, ADR-0089).
- 시너지 정합성 신규 분석 폼: 대상(그룹/계열사 레지스트리, 프로파일 게이팅) + 기회 연결(선택) — 별도 회사 등록 없음(ADR-0090).

## As-built 2026-09-03 — 관리자 콘솔 분할 (ADR-0091)

- 역할-화면 분리: admin 계정은 관리 그룹(시스템 대시보드·사용자·토큰·로그·데이터소스·스케줄·데이터베이스·알림·용어집·거버넌스·마스터데이터·ADR)만 사용. 비관리자는 관리자 진입 불가(layout 게이트 + 기존 requireAdmin).
- 라우트: /admin(시스템 대시보드), /admin/users|audit|data-sources|schedule|database|notifications|glossary|governance|master-data|adr — 섹션 상태는 URL 기반.
- 시스템 대시보드: 감사 로그 30일 추이(라인), 사용자 역할 분포(도넛), 기오퍼널(바), 스케줄 성공/실패(바) — GET /api/admin/system-stats.
- CRUD 보강: 사용자 역할 변경·비활성화/활성화 UI, 마스터데이터 DELETE, 발급 토큰/임시 비밀번호 1회 확인 모달.
- 미구현(명시): 용어집 용어 수정/삭제(YAML 파일 기반 — 쓰기 API 설계 선행), 데이터베이스 백업 이력/마이그레이션 상태 API, 스케줄 수동 트리거, RAG 규칙 편집기.

## 투자구조 설계 (S10, ADR-0106 as-built)

- `/projects/[id]/deal-structure` — ProjectSubNav "투자구조" 탭. StageFrame S10 프레임 안에 두 섹션: (1) 투자구조 가설 카드(투자 주체 칩: direct/SPC/holdco/내부 스핀오프/JV, 자산·주식·지분·수표 믹스, 4축 노트 표, 근거, 아티팩트 참조 입력 + 4축 검토 완료 버튼), (2) 자금조달 sources & uses 표(조달/사용 합계·차액·균형 배지, 행 추가/삭제).
- API: `GET/POST /api/projects/{id}/deal-structure` (action: hypothesize | complete_four_axis | add_financing_entry | remove_financing_entry). 4축 완료는 deal_structure_review 아티팩트 참조 필수, 재완료 불가.
- S10 완료 술어: 최신 가설 4축 완료 AND sources == uses > 0 (최신 가설 미완료 시 재블록).
- 투자심의 자료(S11)에 deal_structure 섹션 포함(최신 가설 + 균형 상태).

## As-built 2026-09-13 — 런타임 에이전트팀 표면 + S2/S3 재구성 (ADR-0125/0126/0127/0128)

### /agents — PM 에이전트 질의 (ADR-0128)

- 사이드바 "분석·참조" 그룹에 "에이전트" 항목(/agents). PM 에이전트가 질의를 분류해
  단일 에이전트 또는 에이전트 체인을 배정하고, 단계별 provenance(에이전트·수행·요약·
  출처)와 함께 **제안 전용** 응답을 표시한다("제안 전용" 배지 상시).
- 연결 기회 선택 시 `opportunity_evaluation` 체인(요인→매력도→적합성→PM 종합)이
  실행된다. 배정 가능 로스터(agents/*.md 투영)를 접이식 표로 제공.
- 런타임 아키텍처: 모든 LLM 호출이 `llm_call_log` 런 장부에 에이전트 키와 함께 기록
  된다(migration 0092). LLM 미설정 시 결정론 규칙 분류 + 폴백 답변으로 정상 동작.

### S2 기회 발굴 — 상세 화면 분리 + 경량 퍼널 (ADR-0127)

- 행 액션은 선별·제외(S3 완료 시 활성)·비즈니스 모델 검토·삭제만 남긴다. 발굴 단계는
  "매력도 평가" 버튼(미평가 시 상세 안내), 상세에서 매력도 기록 시 자동으로 평가 단계
  진행. 기회명 클릭은 `/opportunities/[id]` 상세 화면으로 이동(하단 펼침 폐지).
- 상세 화면: 기회/위험 요인(도출·추가·삭제), 매력도 평가(LLM 초안), 비즈니스 모델
  검토(생성·재생성 — 새 버전 추가, 과거 버전 열람 이력), 승격 패널. S3 시너지·전략적
  적합성은 인라인 실행 없이 S3 화면(/synergy) 이동 링크로 안내.
- "스케치"→"비즈니스 모델 검토" 전면 명칭 변경. 시너지 점수는 S3 화면 분석에서만
  기록 가능(S2 인라인 시너지는 400 synergy_requires_s3로 거부).

### S1 시장분석 — 가치사슬 연계 + 분석 범위 모달 (ADR-0126)

- "가치사슬 구조 — 프록시 체인 링크" → "가치사슬 연계" 명칭 변경(프로젝트 서브내비
  동반). 승인 대기 제안(연계 링크·과거 분석 출처 배지), 직접 등록 폼, 미매칭 후보 안내.
- 분석·재분석 시 "가치사슬 연계" 모달(ADR-0130): 신규 분석은 프리뷰 전용("가치사슬 연계
  산업 미리보기", 버튼 `이 산업만 분석`) — 첫 분석은 대상 산업만 진행. 재분석 모달에서만
  후보 선택 가능(상한 5건), 선택한 연계는 `연계 대기 · N번째` 행으로 등록되어 재분석
  완료 후 한 건씩 자동 시작(직렬 큐, 전방 우선). 리포트 가치사슬 연계 섹션의 CTA
  `연계 산업 이어서 분석`이 완료 후 진입점. 대체/보완 관계는 사슬 후보와 분리된
  "대체 위협 (검토 필요)" 섹션으로 표출. 실패·취소 상태 칩과 linkNotice 문구는
  큐 계약(대기 등록 → 완료 후 자동 시작)을 정확히 서술한다.

### S3 시너지 — 회사 묶음 목록 (ADR-0125/0126)

- 목록은 회사를 하나의 묶음(rowSpan)으로 표시하고 기회가 행마다 나열된다. 연결 기회
  클릭이 해당 분석 리포트의 진입점(회사 셀은 분석 1건일 때만 클릭 가능). DART 고유번호
  컬럼 제거, "구분"(계열사/그룹/legacy) 컬럼 신설.

### As-built 2026-10-13 - S11 establishment table and merged committee decision (ADR-0165)

- Establishment table (`EstablishmentPanel.tsx`, view model `lib/establishment-view.ts`): columns step, status, assignee, last recorded, updated, actions (read-only viewers see five columns). The primary button is "change status" (hidden for done steps); the row menu holds assign and, for done steps, reopen. Brownfield/unclassified origins show an info note (ADR-0047) instead of the table. Server error codes (`evidence_required`, `reopen_required`, `assignee_not_member`, `dependent_step_done`) map to Korean text; `dependent_step_done` opens a second confirmation and resends with `cascade_step5`.
- Decision section: one `GateDecisionPanel` with `gates=[entity_ic, group_ic]` and `sequence`. Step indicator (pending/GO/HOLD/KILL per committee), target committee shown above the form and defaulted to the current turn (`lib/gate-sequence-view.ts`), group committee opens only after the entity committee GO, history grouped per committee. Anchor: `#gate-decision-entity_ic-group_ic`; `focusGateDecision(gate)` matches either gate through `data-gate-form~=`.

### As-built 2026-10-13 - establishment reopen warning and call path (ADR-0165 addendum)

- The post-approval reopen warning in `EstablishmentPanel` is no longer derived in the browser from the event history and the gate history. It renders the server field `reopened_after_gate` (+ `reopened_after_gate_detail`) from `GET /api/projects/:id/establishment`; `IcReviewStage` passes the IC package's copy as `fallbackReopen` until the establishment read loads. `reopenWarning()` in `lib/establishment-view.ts` only maps the field to text.
- Each history row ends with the call path (`화면` / `API` / `MCP`) taken from the event's `via`; rows written before migration 0141 (`unknown`) show nothing extra.
- Reopen and assignment notifications reach the inbox and the top-bar bell like any other notification; the inbox item links to the payload's `href` (`/deals/:id/s11`) when it is a same-origin path.

### As-built 2026-10-13 - checklist item review status badge

Every checklist item row in the S9 DD workspace and the checklist library shows a small `status-chip` badge (component `components/ReviewBadge.tsx`, logic in `lib/checklist-review-status.ts`): draft-AI (amber, "AI 작성·검토 전", tooltip and aria text "AI 작성 · 법령 원문 일부 확인 · 변호사 검토 전 — 확정 아님"), counsel-reviewed ("법무 검토됨(이름·일자)") and confirmed ("확정(이름·일자)"). A missing status reads as draft-AI. The badge pairs an icon and text with the tone, never color alone, and is informational: it does not gate. The S11 IC review screen (`IcReviewStage`) adds a one-line "could not verify" count of in-scope checklist items still draft-AI, fed by `dd.review_status` of the ic-package route.

### As-built 2026-10-13 - S4 decision history row detail

The "진출방식 결정 이력" table (`DecisionTab.tsx`) stays compact (cell-truncate on rationale and alternatives, plus a last "상세" column, `DECISION_COL_PCT` now 8 columns). Each row has a "더보기"/"접기" button (`aria-expanded`, `aria-controls`) that opens a full-width detail row: full rationale and alternatives (`white-space: pre-wrap`, wrapped, never truncated), score evidence list, staging recommendation and full timestamp. Empty alternatives read "기록된 대안 없음". Content comes from `lib/route-decision-history-view.ts` (`buildDecisionDetail`). One row is open at a time.

## As-built 2026-10-13 — User-manual wording sweep (UI strings only)

- Track-aware stage rail and tabs: StageFrame fetches the carrier's track from
  the process API and renders the other track's stages with the existing
  skipped/not-applicable state (W3-09/W1-12); stage screens for the other
  track show an explanatory notice with a jump link instead of the stage body
  (D-03/W2-02). Status derivation is untouched (backend-owned).
- "원본 기회 보기" links: promoted-project cards, the project header and the
  project stage tabs resolve the source opportunity from
  `source_opportunity_id` / `GET /api/projects/:id/process` and link to its
  S4 screen (W1-04/D-18).
- Enum values stay raw in data and API; all user-visible tokens go through
  label maps (`lib/labels.ts`, UI-local maps for scenario/percentile in
  `IcReviewStage`). Agreement: partnership term is 전략 제휴 (glossary 1.3.0);
  no "RAG" wording on decision surfaces.

### As-built 2026-10-14 - establishment mode in S10 and S11 (ADR-0167)

- S10 Green Field structure view: `EstablishmentModePanel.tsx` (above the tabs) shows the `설립 방식` choice as two radio cards, `신규 법인 설립` and `신규 사업부 추진`. No default; the confirm button and the change form are human actions in the user's own session. `신규 사업부 추진` is disabled with a reason unless `allowed_modes` from `GET /api/projects/:id/establishment-mode` lists it (origin internal). Changing a stored mode requires a reason of 10 to 2000 characters, warns that old-mode steps stay as read-only history, and the mode history list sits in a collapsed details block. The non-binding S5 suggestion is shown as a note only.
- Structure form: `new_entity` keeps `설립 법인 형태`. `business_unit` replaces it with `사업부 신설 형태` (독립 사업부 / 기존 사업부 내 팀 / 사내 독립 기업(CIC)). There is no database field for it, so the label is stored as a prefix in the existing free-text 책임 격리 note; no legal-entity form is sent. The no-liability-isolation notice is shown with the form.
- S11 `EstablishmentPanel.tsx`: the section title and step names follow the active mode (`step_titles` from `GET /api/projects/:id/establishment`; no hard-coded table in the render path). With no mode chosen the panel shows the notice and a link to S10 and no table actions. `history_steps` (previous mode, non-pending rows) render as a collapsed read-only list, not a table. `IcReviewStage` shows a mode badge next to the progress chip.
- View model and Korean error text: `lib/establishment-mode-view.ts` (`modeErrorText`, `validateModeChange`, `modeOptions`, `withBusinessUnitForm`).

## As-built 2026-10-14 — S3 to S8 capability linkage, slice 1 (ADR-0170)

- Flow is strictly S3 to S8. The S3 required-capability table (`SynergyLinkageTab`, columns `필요 역량` (source and required note under the name), `필요도`, `필요 수준`, `보유 판정`, `보유 수준`, `보유 근거`, row action; no `해소 힌트` column — `resolution` is owned by S5/S7, amendment 2026-10-14 (2)) owns the requirement; it has NO 5-step level columns (correction 2026-10-14: `requiredLevel`/`currentLevel` with `LevelSelect` belong to S5, ADR-0136). `보유 근거` is not an inline input: the cell shows ONLY a button, with no preview text and no `미입력` marker: label `입력` when empty, `수정` with a `✓` icon when filled (icon + text, never colour alone), `보기` for read-only users (S3 viewers, S5, S8); aria-label `<capability> 보유 근거 입력` (or `보기`) with ` (입력됨)` appended when filled; a filled button carries a `title` with the first ~60 characters of the evidence; the button that opens `CapabilityHeldDialog` (portal, `role=dialog`, `aria-modal`, `useModalFocus`, Esc/backdrop close; one evidence textarea of 8 rows with a counter against the 400-char cap; 저장 updates the draft row, the page-level 저장 persists). There is no 보유 주체 field: rows that still carry legacy holders show a read-only caption `기존 보유 주체: …` under the button (S3, S5, S8 views); it is never auto-merged into the evidence. A caption states that required content, held judgement and holders/evidence are defined in S3 and shown read-only in S8, whose attainability table columns `필요 내용 (S3)` (required note, `미입력` when empty) and `보유 판정 (S3)` (status chip, `보유 근거` button only, legacy holders caption, read-only `보기` dialog, `S3에서 수정` link) replace the former level columns; an S5 level caption appears only when an S5 level is non-empty. The S3 table no longer uses a disabled `<fieldset>`; each control is disabled individually so `보기` stays usable.
- S8 `필요 역량 달성 가능성` panel: level cells are plain text (no `LevelSelect`), `S3 보유 판정` summary with a read-only `보기` dialog, `S3에서 수정` links. A row whose S3 content changed after the judgement shows the chip `! S3 변경 — 재판정 필요` (icon + text), a `변경 내용` list (old to new from the stored S3 snapshot), the prior judgement text, and a button `이전 판정 그대로 재판정` that marks the row dirty so `초안 저장` re-judges it; prior grade, cost, months and rationale stay pre-filled. A fresh save stamps the judgement on the S3 hash the page showed (`s3Hash`), so an S3 edit made after the page loaded keeps the row stale. `판정 확정` skips stale rows (400 `stale_requires_rejudge` when a stale row is confirmed explicitly). Non-stale rows that carry a superseded judgement show `이전 판정: ...` as a caption. A collapsed read-only `삭제된 역량 (판정 이력)` list shows judgements whose S3 row was deleted. The summary strip adds `재판정 필요 N`; stale rows count as `미판정`. The S8 lens strip adds ` · 재판정 필요 N`; the FS gate brief line adds `재판정 필요 N건`. No grade cap, no gate block.

## As-built 2026-10-14 - S3 required-capability section tidy-up and AI actions (ADR-0172 amendment)

- Section header: title with a row count, an unsaved-changes chip (`●` + `저장 전 변경 있음`), and three actions: `필요 역량 제안 (AI)` (requirement side: extra rows plus empty 필요도/필요 수준), `보유 판정 확인 (AI)` (holding side: 보유 판정/보유 수준/근거 from profiles plus external search with cited sources, busy text while running) and `저장`. Exactly one is primary: `필요 역량 제안 (AI)` when there are no rows, `저장` when dirty; `보유 판정 확인` is always secondary. A two-sentence note replaces the earlier long paragraph.
- Table: `table-fixed-pct tmin-80` with `ColGroup` (20/11/21/11/21/12/4) in the canonical order `필요 역량 | 필요도 | 필요 수준 | 보유 판정 | 보유 수준 | 보유 근거 | action`; horizontal scroll region on narrow screens. Caution chips (icon + text) are grouped on one line under the capability name. Row delete is an icon-style ghost button (`✕`, aria-label `<capability> 행 삭제`).
- `필요 수준` and `보유 수준` are edited inline as two-row textareas (vertical resize, auto-grow, `maxLength` 400, counter on focus or near the cap, aria-labels `<capability> 필요 수준` / `<capability> 보유 수준`); read-only users see the clamped text. The 입력/수정/보기 modal pattern is kept only for `보유 근거` (and in S5/S8).
- S3 section header: chip `필요도·필요 수준 누락 N건` (icon + text, hidden at 0); each cell that is still unset/empty shows a small `누락` marker (icon + text), so rows the proposal could not fill stay visible. Unsaved AI drafts live in the hook state and are MERGED with every refetch (`mergeServerRows`), never overwritten; the chip `저장하지 않은 AI 초안 N건` and the button `AI 초안 버리기` (reverts marked cells to stored values, removes unsaved proposed rows) appear while drafts exist, and the result note stays until the next action or its `닫기` button.
- AI drafts: a filled field shows an `AI 초안` chip (`✦` + text) with a 2-line basis and, for holding drafts, source links, until the human edits that field or saves. The batch `보유 판정 확인 (AI)` fills empty fields only; there is no per-row re-check (removed 2026-10-14 (2)) — a person refreshes a non-empty row by editing it by hand. The result note names why search failed when it did (for example `외부 검색 불가 — Tavily 쿼터 초과(432), DuckDuckGo 봇 차단`) with the action to take, and counts sources as `프로필 n건 / 공시 d건 / 웹 m건`.
- Amendment 2026-10-14 (3): next to `보유 판정 확인 (AI)` a checkbox `그룹 내 다른 계열사 프로필도 참고` (default off) adds the other members of the same group as evidence; a row that came back unevaluated from the check shows its reason on the `보유 판정` cell (visible small text, `title`, and `aria-describedby`) until the person changes the judgement - transient state, not stored. `필요 역량 제안 (AI)` works from synergy areas, the S2 sketch or the S1 factors (the origin line of each new row names its source). Profile headers (our-company profile report and chips, brown-field target AI profile) show a warning chip (`!` icon + text `검색 근거 없음 — 정성 항목 미검증(AI 추정)`) with the hint to regenerate once search works when the profile was generated without search evidence; other degraded profiles keep `부분 분석(폴백)`. Stored historical profiles are not changed.
- Amendment 2026-10-15 (4) (analyst-provided profile evidence, our-company profile screen): above the report a collapsible panel `분석가 제공 근거 (선택)` holds a textarea `회사 소개 메모(직접 입력)` (2000 chars) and a textarea `근거 주소(URL, 한 줄에 하나)` with the helper text that provided sources and notes are treated as verified-by-analyst evidence and stored with the profile; both are prefilled from the last stored version and sent with `재분석`/regeneration; per-URL status chips (icon + text: `✓ 수집됨`, `! 본문 부족(출처로만 기록)`, `× 실패(사유)`) show the last run. The `분석가 제공 근거` chip appears in the header when a note or a readable source was used, and the `검색 근거 없음` warning chip is hidden then. The `출처·데이터` tab lists provided sources as links (`rel="noopener noreferrer"`), has a `출처 추가` form (URL optional, title, pasted excerpt up to 4000 chars), edit/remove only for hand-entered entries, a `이 출처로 프로필 다시 생성` button (adding or removing never rewrites the profile text) and a version history with `분석가 수정`/`출처 변경` chips. The `개요` tab has a `분석가 수정` editor (산업 노출, 강점, 약점 one per line; 사업 평가 text; required reason; optional source number) that saves a new version; edited items carry a `분석가 수정` chip.
- Not verified in a browser.
