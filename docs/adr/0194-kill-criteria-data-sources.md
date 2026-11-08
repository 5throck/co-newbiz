# ADR-0194: Kill-criteria data sources — opportunity-scope deal-shape evaluation and point-in-time site announcement

**Status**: Accepted (owner decision, 2026-11-07; recommended options adopted)

> **Amended by ADR-0195 (2026-11-08)**: item A placement — #9 and the deal-shape evaluation move from the opportunity `pre_fs` gate (S4) to the end of S7 (`brownfield-target-screening` step 3.5, `reevaluate_at: target_screening`, brownfield-only).

Risk-officer confirmation: confirmed 2026-11-07 with amendments A-1..C-1 (design doc)
**Date**: 2026-11-07
**Deciders**: Owner (decision); risk-officer (kill-criteria authority); drafted by data-architect
**Related**: ADR-0002 (portability), ADR-0005 (run versioning), ADR-0011 (MCP as REST client), ADR-0014 (migration discipline), ADR-0063, ADR-0193 and its 2026-11-07 amendment note, design `2026-11-07-kill-data-sources-design`, design `2026-11-07-kill-criteria-stage-scoping-design` §13-§14

## Context

After the ADR-0193 §14 re-scope, two kill criteria still lack an acceptable data source:

1. **#9 `deal-shape-chain:no_viable_deal_shape`** is evaluated at the opportunity `pre_fs` gate. Its variable
   `dealshape.viable_shapes` is filled only from `deal_shape_evaluation`, which is `project_id NOT NULL`. No
   human-recorded, opportunity-scoped record of deal shapes and viable verdicts exists. `route_decision`
   records one chosen track with scores. Counting it would be a proxy, and the risk-officer ruled proxies out
   (§14.2). As a result, the enforce guard (`carriedWithoutDataSource()`) still lists #9, and
   `kill_binding=enforce` stays refused.
2. **#5 `infrastructure_plan_not_finalized_at_site_announcement`** (re-evaluated at `fs`) reads the current
   state of `infra.plan_finalized`, not the state on the site-announcement date (pilot 005 F-1, C-6). No
   site-announcement record exists. `dimension_input.observed_at` is a recording timestamp, not an effective
   date, so it is a rejected proxy.

Both fixes need new tables or columns. Under the schema-governance baseline, a DB schema change needs an ADR.

## Decision

1. **New table `opportunity_deal_shape_evaluation`** (opportunity_id FK, shape and intent using the existing
   CHECK vocabularies, `viable 0|1`, required rationale, `evaluated_by` from the session, `superseded_by`
   chain, one live row per (opportunity, shape)). `dealshape.viable_shapes` joins `OPPORTUNITY_SCOPE_VARS` and
   is filled as the count of live viable rows. No rows means `missing`, so #9 is `unassessed`. It is never
   derived from scores, route decisions or LLM drafts. The existing project table is unchanged.
2. **New table `site_announcement`** (project-scoped, `announced_on` ISO date, closed `announcement_kind`,
   required `evidence_ref`, `superseded_by`, one live row per (project, announcement_kind) per C-1; the filler uses `MIN(announced_on)` over all live rows; supersession only corrects the same event, same kind, with evidence), and a **nullable
   `dimension_input.effective_on`** column. The column is required by the repository when
   `infra.plan_finalized = 'yes'`. New evidence vars are `infra.site_announced_on` and `infra.plan_finalized_on`. #5 evaluates
   `plan_finalized_on <= site_announced_on` through a filler-derived boolean. A missing date or an unreviewed
   assertion means `unassessed`, never `false`. Inferred dates are rejected. The C-6 caveat and `test.todo`
   are removed when this lands.
3. **Human-only write surfaces**: REST `POST /api/opportunities/{id}/deal-shapes` and
   `POST /api/projects/{id}/site-announcement`, plus `effective_on` on the dimension-input assertion route.
   The MCP record tools are REST clients that run under the calling user's identity and permissions, with no agent
   account. They are record tools, not proposal tools, and may store only values the user supplied.
4. **Migrations** are purely additive with `@reversible: true`, a `ROLLBACK-SQL` block (DROP TABLE / DROP
   COLUMN / DELETE evidence_var rows), backup before, and FK check, health check and Prisma typegen parity after.
   There is no backfill. Existing data reads `unassessed` until a human records it.

## Consequences

- With (1) landed, `carriedWithoutDataSource()` is empty against the real registry. Enforcing kill binding
  then becomes an owner choice and is no longer structurally blocked.
- With (2) landed, #5 becomes clean point-in-time evidence and no longer carries a caveat.
- In-flight opportunities at `pre_fs` and projects at `fs` will show #9/#5 as `unassessed` until data is
  recorded. That is fail-closed by design.
- Two more human data-entry points (S4 deal-shape panel, S5 announcement card plus effective-date field).
- Rows recorded after the migration are lost on rollback (stated in the migration headers).

## Alternatives considered

- Rebuild `deal_shape_evaluation` with dual scope (nullable project_id plus opportunity_id): rejected as the
  default because of the rebuild risk and mixed scopes in one fact. This remains an open decision.
- Count `route_decision` / `route_decision_score` rows: rejected as a proxy (§14.2).
- Use `dimension_input.observed_at` or gate dates as the plan or announcement date: rejected as a proxy (§14.3).
- A dedicated plan-finalization table instead of `effective_on`: cleaner, but it would give one var two
  writers. This remains an open decision.

## Owner decisions (2026-11-07)

Accepted by the owner on 2026-11-07 with the recommended options:

- O-A1: new table `opportunity_deal_shape_evaluation` (A1); `deal_shape_evaluation` is not rebuilt.
- O-A2: no LLM drafting helper; the deal-shape panel stays human-entry only.
- O-A3: `md_deal_shape` code-table promotion is recorded as schema debt; the CHECK vocabulary stays for now.
- O-B1: `dimension_input.effective_on` column (B1); no dedicated plan-finalization table.
- O-B2: the earliest live announcement of any kind counts; confirmed by the risk-officer with C-1 (unique live index on `(project_id, announcement_kind) WHERE superseded_by IS NULL`, filler `MIN(announced_on)` over all live rows, supersession only for same-event corrections of the same kind with evidence).
- Risk-officer amendments also bind the implementation: A-1 (count only live human-written rows; no draft, recommendation or score path), A-2 (all-unevaluated live rows give `unassessed`, not `present 0`), B-1 (derived var is missing, never `'yes'`, in every unassessed case; tests cover three outcomes plus same-day boundary), B-2 (future `announced_on`/`effective_on` rejected at write; `effective_on` only from the finalized plan evidence), B-3 (remove C-6 caveat and `test.todo` only in the PR landing source, filler and tests together).
- O-B3: derived boolean var `infra.plan_finalized_by_announcement`; no predicate-DSL change.
- O-4: `kill_binding=enforce` may be switched on after item A (#9) lands; this is an operational change requiring a separate owner confirmation.
