# UI Specification — co-newbiz

**Owner**: frontend-engineer
**Design of record**: design v1.0 §4-10 (task 4.4), `docs/srs.md` §12
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
- Dark mode supported; layout responsive down to tablet width.
  *As-built: dark mode met via `prefers-color-scheme` CSS custom properties; tablet responsiveness not verifiable from source — no tablet breakpoints exist, the only fluid layout is the project-card grid, and tables have no narrow-width overflow handling.*

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
│   │   · ⚠️ partial (PR #65): `DataTab.tsx` built — series search (`GET /api/series?q=`), selected series' latest-revision observations (`GET /api/series/:id/observations`, unit/source per row, value wrapped in `SourceTooltip`), and the recent data-change log (`GET /api/data-changes`, icon+label+color per change_type, old→new values). Deferred: series charting/graphing (no chart library), an `all_revisions=1` toggle, and per-series staleness badges (no staleness field in the series-catalog payload today)
│   ├── 재무 분석 (Financial Analysis) — ROIC driver-tree waterfall, peer boxplot, projection with anchor markers · ❌ not built (no chart library in the SPA)
│   ├── 프록시 체인 (Proxy Chain) — chain diagram, hop-level reliability grade, error-band display · ❌ not built
│   ├── 가정 (Assumptions) — assumption registry, kind/rationale/ttl display
│   │   · ⚠️ partial (PR #65): `AssumptionsTab.tsx` built — read-only registry table for the project's latest run (`GET /api/projects/:id/runs` then `GET /api/assumptions?run_id=`): assumption_key, kind chip, value (source-tooltipped), as_of, ttl_days, and a mandatory-visible rationale column (never hover-only) for `kind='assumed'` rows. Deferred: the write form (`POST /api/assumptions`) and a run picker (always uses the newest run)
│   ├── 모델 (Model) — waterfall + tornado charts
│   │   · ⚠️ partial (PR #65 batch 3): `ModelTab.tsx` built — runs list (`GET /api/projects/:id/runs`: label, input_hash short form, input_count, created_at, newest-first), create-run form (`POST /api/projects/:id/runs`: label, from_run_id dropdown defaulting to latest, `set` key/number override rows) with a 403 rendering a clear analyst-role message and the run's honest v1 note ("버전화된 입력 스냅샷" — valuation output arrives with the model engine), and a selected run's immutable input snapshot (`GET /api/runs/:id`, values source-tooltipped by assumption_key). Deferred: waterfall + tornado charts (no chart library in the SPA) and any model-engine output view (engine does not exist yet)
│   ├── 시뮬레이션 (Simulation) — histogram + CDF, seed display
│   │   · ⚠️ partial (PR #65 batch 3): `SimulationTab.tsx` built — run dropdown (default latest), trigger form (`POST /api/simulations`: iterations/seed optional, with the deterministic-seed note — omitted seed derives from the input hash), results from `GET /api/simulations/:id/results` as a quantile table (metric, p05/p50/p95/mean/std, source-tooltipped by run_id+as_of) with seed/iterations shown in the header from the envelope meta and a no-raw-draws honesty note; 400 `simulation_rejected` shows the server's caller-fixable message verbatim, 403 shows the analyst-role message. Deferred: histogram + CDF charts (no chart library) and a simulation-history list (only the just-triggered simulation renders)
│   ├── 버전 비교 (Version Comparison) — waterfall bridge between two runs
│   │   · ⚠️ partial (PR #65 batch 3): `VersionCompareTab.tsx` built — two run selectors (A vs B, defaulting to the two most recent runs) over `GET /api/runs/:id/diff/:otherId`: changed rows (key, A → B values, signed delta with ▲ 증가/▼ 감소 icon+label+color — never color-only), B에 신규 (added) and A에서 제거됨 (removed) sections, both input_hashes displayed, and the honest v1 note that NPV-level decomposition arrives with the valuation engine. Deferred: waterfall-bridge visualization (a chart — table-only for now, explicitly; no chart library in the SPA)
│   ├── 법령·인허가 (Regulatory & Permits) — DAG with critical-path highlighting
│   │   · ⚠️ partial (PR #65): `PermitsTab.tsx` built — `GET /api/projects/:id/permits?include_dag=1`; permit and certification lists (status icon+label+color) rendered as clearly-separated parallel sections, never merged; DAG shown as a hand-rolled client-side topological layering (Kahn's algorithm, no graph library) plus a plain edge list, critical-path nodes flagged with a border + badge (not color-only). Deferred: a true node-link graph rendering (the layered-list approximation does not show cross-layer edges visually, only in the text list)
│   ├── M&A 검토 (M&A Review, BF only) — antitrust HHI, customer-attrition risk, clawback exposure; R&BD sub-panel (TRL, IP/FTO status, commercialization-path, rbd_source) when case_subtype=rbd
│   │   · ⚠️ partial (PR #65 batch 2): `MaReviewTab.tsx` built with six sections — 독과점 (`GET /api/projects/:id/antitrust`: market_definition, HHI 사전/사후/변화 source-tooltipped, remedy_type chip none/behavioral/structural/prohibited with icon+label+color, discharge_confirmed_at), 인센티브 (`GET /api/projects/:id/incentives` grouped by direction prospective/granted, amount/npv/estimated_clawback source-tooltipped, obligation_json parsed to a readable summary, clawback exposure highlighted with a bordered ⚠ note), 부채·우발채무 (`GET /api/projects/:id/liabilities` — debt_instruments / contingent_liabilities / covenant_tests sub-sections; breached covenants get a ■ 이탈 badge, icon+label, not color-only), 부지 비교 (`GET /api/projects/:id/sites` — one row per site on one table, FR-GF-04), 파트너 (`GET /api/projects/:id/partners` — cards with score figures and a compliance-risk chip High/Medium/Low, icon+label+color), and 밸류체인 연관성 (`GET /api/projects/:id/value-chain-links` — from/to industry, direction, elasticity/lag/correlation/r²/pass-through/HHI, per-row assessed_at + evidence_ref provenance). BF-only gating NOT implemented: `GET /api/projects/:id` returns only id/project_no/created_at (+classification meta) — no case-type indicator exists in the payload, so the tab renders unconditionally (backend gap). Deferred: customer-attrition risk (no endpoint — forward-design in api-spec §4), management-package / comp-benchmark views (forward-design), and the R&BD sub-panel — which this wave implemented on the 실사 tab instead, where the R&BD rows actually live
│   ├── 실사 (DD) — dd_finding list with value_impact links
│   │   · ⚠️ partial (PR #65): `DdTab.tsx` built — `GET /api/projects/:id/dd-findings`, category filter chips (derived from the returned rows), finding cards (description, value_impact source-tooltipped by assumption_key, evidence_ref), and a visually distinct R&BD sub-panel (rbd_source, trl_grade, ip_ownership_status, commercialization_path) for `category='rbd'` rows. Deferred: the write form (`POST /api/projects/:id/dd-findings`) and value_impact deep-links into other views
│   └── 용어집 (Glossary) — searchable, in-context
│       · ⚠️ partial: tooltip component built and wired to `/api/glossary/:term`; searchable view built in PR #65 batch 4 as a top-level route (`/glossary`, `Glossary.tsx`) rather than a ProjectDetail tab — the glossary is workspace reference data with no project binding, and ProjectDetail's tab bar already carries 11 project-scoped tabs (route choice recorded here; the IA tree above keeps the node under Project Detail as the design target). Search is client-side over the fields the list payload carries (key/ko/en/category); alias search is not possible — `GET /api/glossary` returns no aliases (backend gap; aliases exist only on the per-term detail endpoint, which the cards' tooltip reuses for definition/why_it_matters). In-context auto-linking built in PR #65 batch 5 (`glossary.tsx`: provider + hook + `GlossaryText` renderer, applied to DD descriptions, assumption rationales, contingent-liability descriptions, antitrust remedy details — see §1's FR-SYS-04 note); alias auto-detection gated on the same list-endpoint gap; two hand-placed example terms remain on 개요
├── 관리자 콘솔 (Admin Console) — see §5 · ⚠️ partial: 5 of 10 sections built (Users, Logs, Data Sources, Batch/Schedule, Database — the DB row is itself partial: retention-policy table + upsert form built, migration-status/backup-history have no endpoints and render an explicit "no API yet" note)
└── 보고서 (Reports) — generated deliverable list, export controls · ❌ not built (no route, no nav entry)
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
- **Structural vs. behavioral remedy distinction** (`docs/rag-framework.md` §2.5) shown explicitly on the Regulatory/Permit dimension sub-badge when applicable — "구조적 시정조치 이행완료" vs. "행태적 시정조치 이행중 (잔여 X개월)".
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
| 알림 관리 (Notifications) | `rag_rule` threshold editing (with mandatory ADR reference before save) | Editing a threshold without a linked ADR ref is a client-side hard block, not just a warning |
| 규정·절차 관리 (Governance) | `governance_doc` version list, `project_policy_pin` status, impact-analysis viewer | — |
| 용어집 관리 (Glossary) | Undefined-term queue from `glossary:lint`, registration workflow | — |
| 데이터 소스 관리 (Data Sources) | Presence + last-success timestamp **only** — no key-value field exists in this UI at all, not just hidden | FR-SYS/design §4-9 |
| 기준정보 관리 (Master Data) | `staging_unmapped` resolution queue | — |
| 거버넌스 (ADR/Stage Gate) | ADR index, stage-gate configuration | — |
| 로그 관리 (Logs) | Audit log viewer, **no delete control rendered anywhere in this screen** | FR-SEC-07 |

## 6. Accessibility

- `accessibility-audit` skill run against every screen before Stage 5 release (WCAG 2.1 AA).
- Keyboard navigation for all interactive elements, including the procedure-viewer's step-source badges and the RAG card's dimension drill-down.
- Screen-reader labels distinguish "Green" (달성) from "OK" language ambiguity — Korean labels avoid traffic-light color-name-only phrasing.

## 7. Related

- `docs/api-spec.md` — the API this UI consumes exclusively (no direct DB access from the frontend)
- `docs/rag-framework.md` — the grading logic §3 renders
- `docs/mcp-integration.md` — the parallel AI-client surface (not this UI, but the same underlying API)
