# UI Specification — co-newbiz

**Owner**: frontend-engineer
**Design of record**: design v1.0 §4-10 (task 4.4), `docs/srs.md` §12
**Status**: Korean UI (design §4-1 language policy — deliverables/UI Korean, code/docs English). Implemented Stage 5 Wave 5.6 (`app/web/src/pages/`: `Login.tsx`, `PasswordChange.tsx`, `ProjectList.tsx`, `ProjectDetail.tsx`, `AdminConsole.tsx`) — **partial; verified row-by-row against `app/web/src/` on 2026-08-21** (per-node markers in §2, per-rule notes in §1/§3/§4): the Project List page and Project Detail shell are built; 개요 / 절차 뷰어 / 용어집 tooltip are partial; 10 of Project Detail's 13 child views (Data, Financial Analysis, Proxy Chain, Assumptions, Model, Simulation, Version Comparison, Regulatory & Permits, M&A Review, DD) plus Reports are not built at all; and the admin console covers 3 of §5's 10 designed sections (Users, Audit Log, Data Sources; see `skills/admin-console-operations/SKILL.md` for the honest breakdown of what's still missing).

## 1. Design Rules (Non-Negotiable)

- **Every numeric figure carries a source tooltip** (`assumption_key`, `as_of`, `source`, `anchor_ref`) sourced directly from the API response envelope's `meta` block (FR-SYS-03) — never hand-typed.
  *As-built (2026-08-21, PR #63): mechanism built — `SourceTooltip.tsx` (hover/focus/click-pin popover, keyboard + `aria-expanded`/`aria-describedby`, dark-mode via the existing custom properties) plus `provenanceOf()` in `api.ts`, which reads the envelope `meta` and merges per-row provenance columns the payload already carries (the RAG endpoint puts `run_id`/`assessed_at` per dimension in rows, not meta — both sources are API-sourced, neither hand-typed; absent fields are omitted, never placeholder-filled). Applied to: the RAG card's assessed-count figure and per-dimension grade badges (`run_id`, `assessed_at`, envelope `as_of`), and procedure threshold values (envelope `as_of` only). Backend gap: no route populates `assumption_key`/`source`/`anchor_ref` in `meta` today — api-spec §9's contract is not yet realized server-side — and the endpoints carrying per-row provenance (assumptions, observations, dd-findings) have no consuming view yet, so those unwritten figures stay un-wrapped rather than wearing empty tooltips.*
- **Color is never the sole differentiator** for RAG status — icon + label + color together (FR-SYS-05), verified by `accessibility-audit` (WCAG 2.1 AA).
  *As-built: met in `RagCard.tsx` — every grade badge renders icon + label + color together. The WCAG 2.1 AA audit itself is a runtime `accessibility-audit` run; not verifiable from source.*
- **No "PASS" stamp anywhere in the human review surface** — output is always split verified / could-not-verify / needs-judgement (FR-REV-02).
  *As-built: no PASS stamp exists in any built view — but the human review surface this rule governs is itself not yet built, so the rule holds by absence, not by exercise.*
- **Glossary term tooltip** on any registered term in body text, dashed underline, click/hover popover (FR-SYS-04).
  *As-built: partial — `GlossaryTerm.tsx` implements the pattern (dashed underline, click/hover popover, keyboard-reachable button, wired to `/api/glossary/:term`), but registered terms are not auto-detected in body text; they are hand-placed, and only two example terms render (on the 개요 tab).*
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
│   ├── 데이터 (Data) — series browser, staleness indicators · ❌ not built
│   ├── 재무 분석 (Financial Analysis) — ROIC driver-tree waterfall, peer boxplot, projection with anchor markers · ❌ not built (no chart library in the SPA)
│   ├── 프록시 체인 (Proxy Chain) — chain diagram, hop-level reliability grade, error-band display · ❌ not built
│   ├── 가정 (Assumptions) — assumption registry, kind/rationale/ttl display · ❌ not built
│   ├── 모델 (Model) — waterfall + tornado charts · ❌ not built
│   ├── 시뮬레이션 (Simulation) — histogram + CDF, seed display · ❌ not built
│   ├── 버전 비교 (Version Comparison) — waterfall bridge between two runs · ❌ not built
│   ├── 법령·인허가 (Regulatory & Permits) — DAG with critical-path highlighting · ❌ not built
│   ├── M&A 검토 (M&A Review, BF only) — antitrust HHI, customer-attrition risk, clawback exposure; R&BD sub-panel (TRL, IP/FTO status, commercialization-path, rbd_source) when case_subtype=rbd · ❌ not built
│   ├── 실사 (DD) — dd_finding list with value_impact links · ❌ not built
│   └── 용어집 (Glossary) — searchable, in-context
│       · ⚠️ partial: tooltip component built and wired to `/api/glossary/:term`; standalone searchable view not built; in-context auto-linking not built (two hand-placed example terms on 개요)
├── 관리자 콘솔 (Admin Console) — see §5 · ⚠️ partial: 3 of 10 sections built (Users, Logs, Data Sources)
└── 보고서 (Reports) — generated deliverable list, export controls · ❌ not built (no route, no nav entry)
```

As-built deltas not in the tree above:

- The 대시보드 (Dashboard) root is not a separate screen — `/` redirects to `/projects`.
- Project Detail ships a fourth tab, 멤버십 (Membership: user, project role, grantor, need-to-know basis), which this tree does not list — an addition, not a substitution.

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
| 데이터베이스 관리 (Database) | Migration status, backup history | Read-heavy, links to `job_run` |
| 배치·스케줄 관리 (Batch/Schedule) | `job_run` history, retry, `schedule_job` edit | — |
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
