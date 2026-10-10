---
lang: ko
lang_reason: source-material
---

# ADR-0156 — Per-target WACC and financial analysis: a company axis on the WACC run

- Status: Accepted (2026-10-08, pre-approved by the user in chat)
- Date: 2026-10-08
- Deciders: Human reviewer (user, pre-approved in chat). Drafted by backend-engineer. AI review alone cannot accept this ADR (DB schema change).
- Design of record: `docs/designs/2026-10-09-per-target-wacc-financials-design.md`
- Related: ADR-0115 (CAPM component layer on the WACC run), ADR-0116 (project subject company binding — unchanged), ADR-0143 (S8 per-target business-case axis — the pattern this extends), ADR-0095 (1:1 project promotion — unchanged)

## Context

ADR-0143 gave brownfield S8 a per-target axis for business cases
(`business_case_model.target_id`). WACC input sessions and the
financial-analysis bridge still resolve exclusively through the ONE subject
company bound on `md_project.company_id` (ADR-0116). On a multi-target
shortlist the S8 comparison therefore borrows one target's cost of capital for
all targets, and only one target's financials are viewable.

WACC inputs persist as `assumption` rows on a versioned `run`
(db/lib/wacc.ts); the project-level resolution feeds the fs gate, kill
criteria, snapshot filling and S10/S11.

## Decision

1. **`run.subject_company_id` (nullable FK to md_company), migration 0131.**
   NULL = project-level — today's rows and behavior, grandfathered without
   backfill. Chosen over a new keyed table because the run already IS the
   WACC session unit: components, derivation provenance and the confirmed
   scalar live on one run, and the `wacc`/`hurdle_irr` exact-key snapshot
   contract stays untouched.

2. **Resolution splits by scope.** Project-level resolvers now require
   `subject_company_id IS NULL` (so per-target sessions can never hijack the
   gate figure); `{ subjectCompanyId }` scoping returns the latest session of
   that company. Gate semantics, REQ-W4 subject decision, and S10/S11
   consumption are unchanged — per-target WACC is additional S8 comparison
   evidence, not a new gate input.

3. **Writes validated to the shortlist.** A `target_id` on the WACC session
   POST must be a shortlisted `brownfield_target` of the project's source
   opportunity with a resolvable `md_company` (dart_corp_code first, name_ko
   fallback — ADR-0143's rule).

4. **Financial analysis per target is a read path only.** `fact_financial` is
   already company-keyed; `GET /financial-analysis?target_id=` returns the
   same payload shape for any shortlisted target. No schema change.

5. **UI is additive.** A shortlist target selector (FilterChip pattern,
   labeled, aria-current) appears on the WACC and financial-analysis pages
   only when ≥2 targets are shortlisted. The ADR-0116 binding UI stays: it
   chooses which analysis feeds the gate. The beta-series "수집 데이터
   불러오기" helper ships in the same PR as this ADR; its series registration
   follows the selected target by the same scoping.

## Consequences

- Existing projects and runs behave byte-identically (NULL column, IS NULL
  filter).
- Two rows of evidence per stage of the CAPM chain per target: regression
  context, components and confirmed scalar are reproducible per company from
  the registry, as ADR-0115 required for the project level.
- Risk accepted: an analyst could confirm a per-target WACC and mistake it
  for the gate figure; the UI labels per-target sessions and hides the
  project-level subject decision inside them.

## Amendment 2026-10-09

The project-level selector chip is removed on multi-target brownfield projects. The default chip is the S8-selected target (bound on `md_project.company_id`), else the first shortlisted target; the bound target keeps the `게이트 기준` marker and uses the project-level scope, so decision 2 (gate semantics) is unchanged. See design 2026-10-09-ui-units-targets-dd.

## Amendment 2026-10-10 (2) — S8 generator consumption

Decision 2's per-target sessions now feed the S8 valuation itself. The generator consumes WACC with the same scope rule the WACC page displays (amendment 1): the bound target uses the project-level (gate) scope; a non-bound shortlisted target with its own session uses `{ subjectCompanyId }`, and falls back to the project scope when no session exists — labeled `wacc_scope=project|target` in the simulation note and carried on the job-spec snapshot (`discount_rate.scope`, `subject_company_id`). Greenfield stays project-level; `wacc_subject` (REQ-W4) and every gate-path resolution (fs gate, kill criteria, snapshot filling, S10/S11) remain project-level. Design of record: `docs/designs/2026-10-10-s8-per-target-wacc-consumption-design.md`.

