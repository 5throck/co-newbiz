# ADR-0116: Company financial facts ingestion and project–company binding

- Status: Accepted
- Date: 2026-09-11
- Deciders: PM (dispatch), data-architect (schema), backend-engineer (writer/API), frontend-engineer (screens)
- Related: ADR-0004 (cache-first fetch), ADR-0054/0056 (judged project–industry binding), ADR-0093 (company-profile pipeline), ADR-0098 (S8 business-case generation), ADR-0115 (WACC component decomposition), approved mockups `docs/designs/mockups/2026-09-11-*.html`

## Context

`fact_financial` existed schema-only since migration 0011 with no writer in
any layer — the project financial-analysis tab (Wave B2 read model) rendered
a permanent empty state, and S8's business-case generator could not ground
growth assumptions in historical financials. Meanwhile the approved roadmap
("WACC 필요값 자동 수집") needs company facts (관측 D/E) as a feed, and the
user decisions on this workstream are:

1. Financial performance analysis lives on a **company screen**
   (`/companies/[companyId]`), not inside a project tab — reached from the
   deal flow (bridge tab, target lists), with a deterministic commentary
   layer because dense financial analysis is hard to read.
2. **WACC reference is subject-parameterized**: the same reference engine
   serves 그룹 계열사 기준 (투자 허들 관점) and 인수 대상 회사 기준
   (밸류에이션 관점). The project WACC session prefills from the track's
   primary reference; the human-confirmed value stays recorded per project
   (kind=user, FS gate) — the reference itself is never the gate record.
3. Every web UI change ships a static HTML mockup for review before
   implementation (Phase 0 gate).

## Decision

1. **Writer** — `app/web-next/lib/dart-financial-facts.ts`
   (`syncCompanyFinancialFacts`): resolve/validate the company's DART corp
   code (synergy-pipeline's validate → persist flow), pull up to 5 business
   years via `fetchFinancials` (the shared dartFetch gate — concurrency,
   backoff, daily budget; bypassing it is prohibited), then land rows in
   `fact_financial` with **append-only revisions**: unchanged values are
   skipped, changed values append `revision_no = max+1`. Nothing is ever
   overwritten. Values are stored as raw KRW as filed. md_account rows are
   seeded by migration 0083; the writer fails loudly on an unmapped account
   name instead of inventing a row. `POST /api/companies/[companyId]/sync`
   exposes it (analyst+, 503 with guidance when DART_API_KEY is missing).
2. **Binding** — `md_project.company_id` (existing column, only set by
   brownfield promotion until now) is settable via
   `POST /api/projects/[id]/financial-analysis/company` with a **mandatory
   rationale**, stored in a new `project_company.rationale` column
   (migration 0084). Role follows the track: brownfield → `target`,
   greenfield → `candidate` (분석 기준 회사). Re-binding inserts new
   `project_company` history rows; `md_project.company_id` always points at
   the current subject. Mutations are audit-logged.
3. **Screens** — `/companies/[companyId]` renders the approved mockup:
   한눈에 요약 (summary cards), threshold callouts, 재무실적 table (억원),
   지표별 해설, WACC 참조 카드, sync control. The analysis reuses
   `deriveFinancialAnalysis` (ADR-0093) by converting stored facts into its
   item shape — one analysis implementation, two entry paths. The project
   financial-analysis tab becomes a **bridge**: binding UI + summary card +
   link out (its old duplicate valuation chart and un-feedable comp
   benchmark table are removed by this decision).
4. **WACC reference card** — only facts-derived entries now (관측 D/E);
   market parameters arrive with the ECOS adapter (Phase 3) and subject beta
   with KRX (Phase 8). Absent entries render as explicit N/A with a reason —
   the screen never invents a value.
5. **Routing** — `/companies` and `/companies/[companyId]` are registered in
   `NON_MENU_ROUTES`: no top-level menu entry; companies are reached from
   deal-flow contexts (bridge tab connect flow, later target lists and
   affiliate screens).

## Consequences

- The financial-analysis tab's empty state becomes actionable (connect →
  sync → dashboard), and `fact_financial` gains its first writer with
  revision discipline identical to `fact_market_observation`.
- Phase 2 (dual-view valuation) and Phase 4 (subject-parameterized WACC
  reference) consume this layer; their schemas use migrations 0085+.
- `comp_benchmark` remains feedless by design (compensation data is not
  DART-derivable); its section is retired from the bridge tab until a real
  feed exists.
- Brownfield target-row and affiliate-screen entry links are follow-ups —
  those rows carry no `company_id` today; the bridge tab's connect flow is
  the supported path in this phase.
- Rollback: additive migrations only (ADR-0014 discipline).
