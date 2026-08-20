# UI Specification — co-newbiz

**Owner**: frontend-engineer
**Design of record**: design v1.0 §4-10 (task 4.4), `docs/srs.md` §12
**Status**: Stage 4 draft. Korean UI (design §4-1 language policy — deliverables/UI Korean, code/docs English). Not yet implemented (Stage 5).

## 1. Design Rules (Non-Negotiable)

- **Every numeric figure carries a source tooltip** (`assumption_key`, `as_of`, `source`, `anchor_ref`) sourced directly from the API response envelope's `meta` block (FR-SYS-03) — never hand-typed.
- **Color is never the sole differentiator** for RAG status — icon + label + color together (FR-SYS-05), verified by `accessibility-audit` (WCAG 2.1 AA).
- **No "PASS" stamp anywhere in the human review surface** — output is always split verified / could-not-verify / needs-judgement (FR-REV-02).
- **Glossary term tooltip** on any registered term in body text, dashed underline, click/hover popover (FR-SYS-04).
- **3-depth navigation maximum** (design §4-10).
- Dark mode supported; layout responsive down to tablet width.

## 2. Information Architecture

```
대시보드 (Dashboard)
├── 프로젝트 목록 (Project List) — RAG card grid, staleness badges, notification center
├── 프로젝트 상세 (Project Detail)
│   ├── 개요 (Overview) — RAG signal card, history sparkline, transition log
│   ├── 절차 뷰어 (Procedure Viewer) — merged shared/region/entity view with per-step source attribution
│   ├── 데이터 (Data) — series browser, staleness indicators
│   ├── 재무 분석 (Financial Analysis) — ROIC driver-tree waterfall, peer boxplot, projection with anchor markers
│   ├── 프록시 체인 (Proxy Chain) — chain diagram, hop-level reliability grade, error-band display
│   ├── 가정 (Assumptions) — assumption registry, kind/rationale/ttl display
│   ├── 모델 (Model) — waterfall + tornado charts
│   ├── 시뮬레이션 (Simulation) — histogram + CDF, seed display
│   ├── 버전 비교 (Version Comparison) — waterfall bridge between two runs
│   ├── 법령·인허가 (Regulatory & Permits) — DAG with critical-path highlighting
│   ├── M&A 검토 (M&A Review, BF only) — antitrust HHI, customer-attrition risk, clawback exposure; R&BD sub-panel (TRL, IP/FTO status, commercialization-path, rbd_source) when case_subtype=rbd
│   ├── 실사 (DD) — dd_finding list with value_impact links
│   └── 용어집 (Glossary) — searchable, in-context
├── 관리자 콘솔 (Admin Console) — see §5
└── 보고서 (Reports) — generated deliverable list, export controls
```

## 3. RAG Display Contract

- **RAG signal card**: overall badge (icon + label + color) + six dimension sub-badges.
- **Never render an overall grade without checking whether all six dimensions completed** — a partial assessment shows "평가 미완료" (assessment incomplete), never defaults to a color.
- **Rationale line is mandatory display**, not a hover-only detail — "데이터 신뢰도 B등급으로 상한" (capped at Amber by Grade-B data confidence) must be visible without an extra click.
- **Structural vs. behavioral remedy distinction** (`docs/rag-framework.md` §2.5) shown explicitly on the Regulatory/Permit dimension sub-badge when applicable — "구조적 시정조치 이행완료" vs. "행태적 시정조치 이행중 (잔여 X개월)".

## 4. Procedure Viewer

- Renders the **merged** result of `proc:resolve` (shared → region → entity precedence), with each step's source layer visually distinguished (e.g. a small badge: 공통/지역/각사).
- A step that is an entity/region **override** (`add_steps`/`replace_steps`) is visually flagged, with a link back to the shared baseline step it modifies.
- For R&BD-flagged projects, an additional inline panel surfaces `checklists/rbd-technology-checklist.yaml` alongside the base Brown Field checklist.

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
