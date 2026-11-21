# Meeting M7-1: Information Protection — Personal Data, Need-to-Know, MNPI

**Date**: 2026-08-20
**Facilitator**: security-engineer
**Participants**: security-engineer, legal-counsel, compliance-officer, hr-integration-agent, data-architect
**Objective**: Fix personal-data minimization scope, the `project_member`/`wall_group` mechanics, and MNPI insider-enrollment mechanics at implementable detail — this is the one area the design marks non-descopable, so it needs to be unambiguous before Stage 4.

---

## Agenda
1. Personal-data minimization — exactly which fields, exactly which tables
2. Need-to-know mechanics — deny-by-default enforcement point
3. MNPI insider enrollment — concrete workflow

## Discussion

**security-engineer**: This is the one MVP item the design says cannot be descoped. I want every ambiguity closed in this room, not carried forward as an open issue.

**hr-integration-agent**: On personal-data scope from my side: `management_package.executive_ref` uses role-based placeholder keys (e.g. `TARGET-CEO-01`), never real names — already fixed at design level. What wasn't fixed: who assigns the placeholder key and where the real-name mapping (if it must exist at all, e.g. for legal-counsel's own reference during a live deal) is stored, since it clearly cannot be in the same database.

**legal-counsel**: The real-name mapping, if needed, stays entirely outside this system — in whatever secure channel legal-counsel already uses for privileged deal correspondence. This system's job is to never need that mapping to function. I'll confirm this in writing so it's not an assumption.

**compliance-officer**: On `comp_benchmark` — confirming the aggregate-only rule needs a concrete minimum cohort size, not just "aggregate": minimum 5 individuals per job-family/grade cohort, or the cohort gets rolled up to a broader grade band. A "cohort of 2" aggregate is de-anonymization with extra steps.

**data-architect**: I'll add that minimum-cohort-size check as a write-time constraint on `comp_benchmark`, not a policy note that's easy to skip.

**security-engineer**: Need-to-know mechanics — the enforcement point is the repository layer (`db/repositories/*.ts`), every query gets a mandatory `project_id` + caller-context parameter, and there is no repository method that skips it. I want this checked by a lint rule or test, not code review discipline alone, since discipline erodes.

**data-architect**: Agreed — I'll write a repository-layer test that fails the build if a new query function is added without the mandatory context parameter (static analysis on the function signature, not a runtime check that could be forgotten in a corner case).

**compliance-officer**: On `wall_group` — concrete trigger: when does a user get walled from a project? Proposal: automatically when `project_classification` flags a competing-affiliate conflict (matches group-review-agent's portfolio-overlap logic from M0/M2), and manually via compliance-officer override for case-by-case conflicts legal-counsel identifies.

**security-engineer**: MNPI enrollment workflow, concretely: (1) legal-counsel or compliance-officer flags a project `mnpi_flag=true` at classification time; (2) any user requesting access is added to `insider_list` at the moment of first access, with `reason` and `acknowledged_at` timestamp requiring an explicit click-through acknowledgment, not silent auto-enrollment; (3) MCP tokens require an explicit `mnpi` scope grant, separate from default scopes, reviewed by compliance-officer before issuance; (4) every read is logged to `data_access_log` including which fields were returned, not just that a query ran.

**hr-integration-agent**: On (4) — for `management_package` specifically, I want field-level access logging, not just row-level, since "read the compensation table" and "read the CoC trigger amount" carry different sensitivity even within one row.

**data-architect**: Field-level logging is a bigger lift than row-level. I'll implement row-level for MVP and flag field-level as a Tier 2 item rather than block Stage 5 on it — noting that as a scope decision, not silently dropping it.

## Decisions

| # | Decision |
|---|---|
| D-M7-1-1 | Real-name-to-placeholder mapping (if needed at all) lives entirely outside this system, in legal-counsel's existing privileged channels — never in the database |
| D-M7-1-2 | `comp_benchmark` minimum cohort size = 5 individuals, enforced as a write-time constraint, not a policy note |
| D-M7-1-3 | Need-to-know enforcement is a static, testable repository-layer contract (mandatory context parameter on every query function), verified by a build-time check, not code-review discipline alone |
| D-M7-1-4 | `wall_group` triggers automatically on `project_classification` competing-affiliate flags, plus manual compliance-officer override for case-by-case conflicts |
| D-M7-1-5 | MNPI enrollment is explicit and logged at every step: classification flag → click-through insider acknowledgment → separately-scoped MCP token reviewed by compliance-officer → row-level `data_access_log` on every read |
| D-M7-1-6 | Field-level access logging (vs. row-level) explicitly descoped to Tier 2, not silently dropped — row-level is the MVP bar |

## Action Items

| # | Action | Owner | Landing | Status |
|---|---|---|---|---|
| A-1 | Build the repository-layer mandatory-context static check | data-architect, backend-engineer | Stage 5.1/5.5 | Pending |
| A-2 | Add `comp_benchmark` minimum-cohort-size constraint to schema | data-architect | Stage 4 db-schema.md | Pending |
| A-3 | Design the click-through insider acknowledgment UI flow | frontend-engineer, security-engineer | Stage 5.6 | Pending |
| A-4 | Confirm in writing that no real-name mapping will ever be requested from this system | legal-counsel | Stage 2 information-protection.md | Pending |

## Open Issues
- Field-level access logging remains a Tier 2 item, not resolved to MVP — tracked, not forgotten.
