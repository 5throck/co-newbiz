# ADR-0095: Project promotion foundation — opportunity→project transition carrier for S8–S11

- Status: Accepted
- Date: 2026-09-03
- Deciders: New Business Review Lead (PM), per approved S8–S11 implementation plan
- Design of record: `process/flow.spec.yaml` (S8–S11), `db/migrations/0063_project_promotion.sql`, `db/repositories/project.repository.ts`, `app/web-next/app/api/opportunities/[id]/promote/route.ts`
- Related: ADR-0074 (flow.spec v2.0.0, 11-stage model), ADR-0078 (S4+ web surface removal pending v2 rebuild), ADR-0094 (opportunity as S1–S7 carrier; S8+ forecast), ADR-0014 (additive migrations), ADR-0013 (classification vocabulary), ADR-0042 (opportunity + gate_decision), ADR-0062 (gate_decision rebuild), ADR-0053 (gate authority), ADR-0085 (entity establishment execution layer)

## Context

flow.spec v2.0.0 defines S8 (사업성 분석 FS, gate [fs]), S9 (실사·검증 DD, gate [dd]),
S10 (투자심사·실행, gates [entity_ic, group_ic] plus the 5-step entity establishment
execution) and S11 (사후 관리, no gate, 5-vocabulary portfolio transition decisions)
over the `project` entity lifecycle — but there is no procedure that turns a
reviewed opportunity into a project. ADR-0078 removed the old S4+ web surface
pending a v2 rebuild, and ADR-0094 established the opportunity as the S1–S7
lifecycle carrier with `gate_decision` as the sole human-confirmation ledger,
explicitly forecasting "project promotion is S8+ work".

Meanwhile the project-keyed data layer already exists richly: `md_project` is
the FK target of 40+ tables (`project_classification`, `business_case_model`
(0044), `dd_finding` (0011), `project_checklist_item_state` (0039),
`venture_scorecard` (0024)), and `gate_decision` was rebuilt in 0062 to support
gates `fs`/`dd`/`entity_ic`/`group_ic` with `entity_type IN
('opportunity','project')`. `opportunity.project_id` has existed since 0042,
nullable on purpose for exactly this transition. What is missing is only the
promotion procedure itself: `md_project` is still the 0045-era stub
(migration 0001: `id`, `project_no`, `created_at`), no repository function
performs the transition, and `evaluateProcess` handles S1–S7 only.

## Decision

### 1. Promotion is a bookkeeping transition, not a gate

Promotion creates the S8+ execution carrier; it decides nothing. The gating
gates (fs/dd/entity_ic/group_ic) remain human-authority per ADR-0053 and design
boundary #2. Promotion is analyst-triggered, with preconditions that the *prior
stage work exists* — never that a human approved an outcome: greenfield
requires S5 completion; brownfield requires an S7 Short List to exist. The API
checks facts, not judgements.

### 2. Migration `0063_project_promotion.sql` (additive, ADR-0014)

Adds to `md_project`: `origin` (values aligned with the 0013 classification
vocabulary), `source_opportunity_id` (REFERENCES `opportunity(id)`), and a
`track` snapshot column (greenfield/brownfield at promotion time — the route
decision lives on the opportunity, but S8–S11 surfaces must not have to re-derive
the track on every read). `opportunity.project_id` already exists from 0042 and
is reused, not re-created. No table is rebuilt; no destructive DDL.

### 3. `promoteOpportunity` in `db/repositories/project.repository.ts`

Signature: `promoteOpportunity(opportunityId, { promotedBy, needToKnowBasis })`
— a single transaction performing, in order:

1. `md_project` insert (ULID id, generated project_no, origin/track from the
   opportunity's classification and route decision, `source_opportunity_id`);
2. `opportunity` update — `project_id` set, `promoted_at` stamped;
3. `grantProjectMembership` granting the promoter the `lead` role with the
   mandatory `need_to_know_basis`;
4. `appendAudit` (`opportunity_promoted`).

Step 3 MUST be inside the same transaction: under the deny-by-default access
model (FR-SEC-01; `project.repository.ts` is the reference pattern) a project
with zero active members is permanently invisible — a promotion that commits
without a membership row would create a project nobody, including its promoter,
can ever read back. Membership writes stay in `db/lib/access-control.ts`, the
single write path whose `grantProjectMembership` enforces the mandatory
need-to-know basis and phantom-account rejection (FR-SEC-08); promotion calls
it, it does not inline its own membership INSERT.

### 4. API: `POST /api/opportunities/[id]/promote`

Analyst+ role required. Follows the existing route envelope pattern (authenticate
→ role check → validate → `getDb()` SQL → `appendAudit` → ok/badRequest/notFound)
as in `app/web-next/app/api/opportunities/[id]/establishment/route.ts`.
Preconditions per §1: S5 completion (greenfield) or an S7 Short List (brownfield);
an already-promoted opportunity is rejected as a bad request, not silently
idempotent — a second promotion would be a data-integrity event worth surfacing.

### 5. `process-flow.ts`: StageId extends to S8–S11

`app/web-next/lib/process-flow.ts` gains `S8`–`S11` in the `StageId` union, and
the STAGES array is extended with the flow.spec S8–S11 definitions (spec lines
~330–477): S8 gates [fs], S9 gates [dd], S10 gates [entity_ic, group_ic] plus
the 5-step establishment execution activity, S11 with no gates and the
five-vocabulary transition decisions (`next_tranche_released` /
`held_evidence_incomplete` / `graduate_to_core` / `reduce_or_divest` /
`kill_with_learning_captured`). `evaluateProcess` gains the
`entity.type === "project"` branch; per-stage completion logic for S8–S11 is
filled in by Phases 3–6 (FS, DD, IC/establishment, portfolio respectively) —
this ADR establishes the skeleton so later phases do not re-touch the type or
the spec-port step.

## Consequences

- **Positive**: S8–S11 backend surfaces can now be keyed to real projects
  (business_case_model, dd_finding, scorecards, gate decisions with
  `entity_type='project'`), and the opportunity funnel gains a forward link —
  the funnel's "selected ones are promoted to projects" comment from 0042
  finally has a mechanical realization.
- **Note**: `entity_establishment_step` (0059) stays opportunity-keyed until
  Phase 5 backfills `project_id` for promoted opportunities; until then the
  establishment execution record and the project it belongs to are joined via
  the opportunity, not directly.
- **Note**: visibility of a promoted project starts with exactly one member —
  the promoter, as `lead`. Every other reader, including admins, is added
  through normal membership grants with their own need-to-know basis.
- **Risk accepted**: gate decisions recorded pre-promotion keep
  `entity_type='opportunity'` (ADR-0094's accepted risk); migration of
  historical gate rows to project addressing remains deferred.
- **Migration**: one (0063). No flow.spec change — this ADR implements the
  spec; `docs/process-flow.md` regenerates from the StageId/STAGES extension.
