---
lang: ko
lang_reason: source-material
---

# Per-target WACC and financial analysis on shortlist-scoped brownfield projects

- Date: 2026-10-09
- Status: Approved (user pre-approved in chat)
- ADR: `docs/adr/0156-per-target-wacc-financial-company-axis.md`
- Related: ADR-0115 (CAPM component layer), ADR-0116 (subject company binding),
  ADR-0143 (S8 per-target feasibility axis), design 2026-09-18-s8-business-case-evaluation

## Problem

ADR-0143 gave the S8 business-case tab a per-target axis: every shortlisted
`brownfield_target` gets its own case models. WACC and financial analysis did
not follow. Both resolve through the ONE subject company bound on
`md_project.company_id` (ADR-0116): the WACC page's reference values
(`wacc/suggestions`) and the financial-analysis tab read only that company.
On a multi-target brownfield project (e.g. PRJ-T7T81A: 로보티즈 bound,
레인보우로보틱스 shortlisted) an analyst cannot assemble a WACC or view
financials for the second target, so the S8 comparison runs on one target's
cost of capital.

## Goal

Each shortlisted target on a brownfield project can carry its own WACC input
session (direct or CAPM, beta regression context included) and its own
financial-analysis view. The project-level subject binding (ADR-0116) keeps
feeding the fs gate, S10/S11 and snapshot filling exactly as before — per
target analysis is ADDITIONAL evidence for the S8 comparison, never a change
to gate semantics.

## Storage design (ADR-0156, additive)

WACC inputs persist as `assumption` rows on a versioned `run`
(`db/lib/wacc.ts`). The minimal company axis is therefore one nullable column
on `run`:

- **Migration 0131** `run.subject_company_id TEXT REFERENCES md_company(id)`
  (+ index `idx_run_project_company(project_id, subject_company_id)`).
  NULL = project-level (today's behavior) — existing rows are grandfathered
  byte-for-byte.
- `recordWaccSession` gains optional `subjectCompanyId`; the column is set on
  the created run after `createRun` (no change to `CreateRunOptions`, so every
  other run creator is untouched). The `wacc` / `hurdle_irr` exact-key
  snapshot contract is untouched.
- Resolution splits:
  - **Project-level** (`resolveProjectWacc(db, projectId)` — gate path,
    snapshot filler, FS deliverables): now filters
    `run.subject_company_id IS NULL`. Legacy rows are NULL, so every existing
    project resolves identically.
  - **Per-target** (`resolveProjectWacc(db, projectId, { subjectCompanyId })`):
    filters `run.subject_company_id = ?`. `loadProjectComponents` gets the
    same optional scope, so CAPM components, derivation and the relevering
    reference are per company too.
- Writes are validated at the route: a `target_id` must be a shortlisted
  target of the project's source opportunity whose resolved `md_company` id
  (dart_corp_code first, name_ko fallback — same rule as ADR-0143's
  `listShortlistSubjects`) exists. Targets without a resolvable company
  cannot host a per-target WACC session (the UI shows why).

Financial analysis needs NO schema change: `fact_financial` is already keyed
by `company_id`. Per-target analysis is a read path (below).

## API

All additive, query/body optional; old payloads byte-identical:

| Route | Change |
|---|---|
| `GET /api/projects/[id]/targets` | NEW — shortlisted targets (`{ targetId, name, companyId, isBound }`) for the selector. |
| `GET /api/projects/[id]/wacc` | `?target_id=` → per-target view (same response shape). Without it: project-level, unchanged. |
| `POST /api/projects/[id]/wacc` | optional `target_id` → run is stamped with that company. Without it: project-level, unchanged. |
| `GET /api/projects/[id]/wacc/suggestions` | `?target_id=` → reference values for that company. |
| `GET /api/projects/[id]/financial-analysis` | `?target_id=` → metrics for that target's company (same shape, plus `target`). |

## UI

- New shared `components/TargetSelector.tsx`: the FilterChip pattern already
  used on the WACC panel (rounded-full border chips) — one chip per shortlisted
  target plus a "프로젝트 기준" chip; `aria-pressed`/`aria-current` on the
  active chip, group labeled "분석 대상 선택". Rendered only when the project
  has ≥2 shortlisted targets (single-target and greenfield projects see no
  change).
- Default selection: the target bound on `md_project.company_id`, else rank-1.
- **WaccPanel** and **FinancialAnalysisPanel** fetch `/targets` and scope all
  reads/writes with the selected chip. In per-target mode the WACC panel hides
  the project-level "WACC 적용 주체" decision (REQ-W4 belongs to the gate) and
  shows a note that the gate-confirmed figure is the project-level session.
- The beta regression paste flow and peer table are inherently per session —
  they submit with the selected target's id, so the stored beta context is
  per company automatically. (The "수집 데이터 불러오기" beta-series helper
  ships in the same PR — `scripts/co-newbiz/beta-series.ts` and
  `GET /api/projects/{id}/wacc/beta-series`; series registration follows the
  selected target by the same `target_id` scoping.)
- The ADR-0116 binding UI (financial-analysis "대상 회사 연결/변경") stays in
  the project-level context: it chooses which analysis feeds the gate.

## Migration / grandfathering

0131 is purely additive (one nullable column + index). In-flight projects keep
NULL runs and resolve exactly as before; no backfill. Manual rollback: drop
the index, `ALTER TABLE run DROP COLUMN subject_company_id` (SQLite ≥3.35), or
restore from backup via `scripts/co-newbiz/restore.ts`.

## Tests

- Unit (`tests/unit/wacc-target-session.test.ts`): grandfathering (legacy NULL
  runs resolve project-level identically), per-target isolation (two targets,
  two sessions, neither leaks into the other or into the gate resolution),
  route validation (non-shortlisted target_id rejected), suggestions scoping.
- E2E (`tests/scenarios/brownfield-ma.test.ts`): with a second shortlisted
  target + company facts seeded, the WACC page and financial-analysis page
  serve BOTH targets and switch via the selector.
