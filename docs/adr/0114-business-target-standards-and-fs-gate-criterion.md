---
lang: ko
lang_reason: source-material
---

# ADR-0114: Business-target standards as group/affiliate master data, with a non-blocking fs-gate evidence panel

- Status: Accepted (amended by ADR-0191 — ownership and permissions moved to the group screen, 2026-10-29)
- Date: 2026-09-10
- Deciders: New Business Review Lead (PM)
- Related: ADR-0008 (kill criteria are policy, not code), ADR-0037 (gate blocking rule), ADR-0053/0094 (gate verdicts are human decisions), ADR-0061 (money = INTEGER KRW millions), ADR-0074 (flow.spec.yaml is the SSOT), migration 0081 (tombstone deletion convention), ADR-0098 (S8 business case)

## Context

New business proposals had no pre-defined, auditable definition of success. The
reviewer wants each group (and, where needed, each affiliate) to set business
target standards up front — e.g. "revenue ≥ 500억, operating margin ≥ 7%,
plan horizon ≤ 5 years" — manage them as master data, and see them used at the
review gates. Per-opportunity overrides were discussed and consciously deferred:
the group/affiliate standard is the asset to manage first. Two boundary rules
constrain any gate integration: kill criteria are policy content (ADR-0008), and
gate verdicts are recorded by humans only (ADR-0053/0094) — a numeric miss can
inform a decision but must never auto-record or auto-block one.

## Decision

1. **Master data** — `md_business_target` (migration 0082): one active row per
   (group, scope, metric). `member_id IS NULL` means group-common; a specific
   `member_id` is an affiliate-specific standard. Deletion is a tombstone
   (0081 convention); a partial unique index (`WHERE deleted_at IS NULL`)
   allows re-registering a metric after tombstoning. Metric presets
   (`revenue`, `operating_margin`, `period`, `npv`, `irr`) live in
   `lib/business-targets-format.ts`; anything else is `metric_key='custom'`
   with a label, so the metric list is extensible without migrations. Storage
   units follow ADR-0061 (money = KRW millions INTEGER, ratios for %, years as
   numbers); the admin UI inputs 억원/% and converts.
2. **Resolution** — affiliate-specific rows shadow the group-common row of the
   same metric; the shadowed group row is surfaced as display context
   ("그룹 기준보다 우선"). A project's scope resolves by matching
   `md_project.company_id` (an md_company — for brownfield it can be the
   acquisition target, per ADR-0104 company-linkage) against the registry:
   `dart_corp_code` first, then `company_name = name_ko` (the promotion-link
   precedent). When nothing matches and the deployment has exactly one active
   group, that group's common standards apply — the typical single-group
   workspace — so greenfield projects are covered without a company link.
   Otherwise the scope is unresolved and every surface says so honestly.
3. **fs-gate evidence, not enforcement** — `evaluateTargets`
   (`lib/business-targets.ts`) compares the resolved standards against the
   adopted Business Case: final-year revenue (line amounts compound at
   `growth_rate` from their `start_year`, matching the S8 line rendering),
   final-year operating margin ((revenue − labor − opex) / revenue — capex is
   investment and stays out of the margin), `horizon_years` for the period
   target, and recommended-scenario p50 NPV/IRR from `valuation_simulation`.
   Statuses are `met` / `missed` / `indeterminate` (no adopted case or no
   simulation) / `manual` (custom KPIs). `flow.spec.yaml` v2.3.0 adds one
   `decisionCriteria` line to the fs gate asking the human to check this
   evidence in the base scenario. The evidence panel is display-only: no
   blocker, no automatic gate_decision, ever.
4. **Surfaces** — admin CRUD at `app/api/admin/business-targets` (admin-only,
   audited) rendered in the admin console's Master-data section; read-only
   evidence at `app/api/projects/[id]/target-check` (project-visible users,
   deny-by-default) rendered by `TargetCheckPanel` above the fs
   `GateDecisionPanel` on the S8 business-case page.

## Alternatives considered

- **Per-opportunity target rows** — rejected for v1: the user asked for
  group/affiliate-level management first; per-deal overrides remain a future
  extension that can layer on top of this table.
- **Kill criteria entry in `procedures/_kill-criteria/`** — rejected: a target
  miss is judgement-informing, not a halting fact; making it binding would be
  group policy (ADR-0008) requiring documented thresholds, not per-group
  master data.
- **A new dedicated gate** — rejected: the fs gate already owns quantitative
  viability; a separate gate would multiply human checkpoints for the same
  decision moment (flow.spec change would also be structural, not semantic).

## Consequences

- Standards are editable in place (value/direction) with `updated_at` shown as
  the "기준 시점" in the evidence table; the audit log records every change.
  Historical gate rationales stay append-only in `gate_decision`.
- Custom KPIs display "수동 확인" until a future evidence variable exists for
  them — the kill-criteria README rule (never invent predicates without vars)
  applied to evidence display.
- S11 scorecard / S12 actual-vs-target tracking is NOT in scope; the charter
  KPI pre-commit remains the S11 bridge.
