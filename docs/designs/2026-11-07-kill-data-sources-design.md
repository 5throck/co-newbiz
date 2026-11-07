---
title: Kill-criteria data sources — opportunity-scope deal shapes (#9) and point-in-time site announcement (#5, C-6)
date: 2026-11-07
status: Accepted (owner, 2026-11-07; risk-officer confirmed 2026-11-07 with amendments A-1..C-1)
owner: data-architect (schema); functional review by process-governance-manager
reviewers_required: risk-officer (kill-criteria authority), platform-lead (technical AI-2nd), dba (migration operations), owner (human approval)
adr: docs/adr/0194-kill-criteria-data-sources.md
related: ADR-0005, ADR-0014, ADR-0060, ADR-0063, ADR-0193 (incl. 2026-11-07 amendment note), design 2026-11-07-kill-criteria-stage-scoping-design §13-§14
---

# Kill-criteria data sources

## 1. Scope and inputs

Two data sources are still missing after the ADR-0193 §14 re-scope:

| Item | Criterion | Variable | Gate | Risk-officer ruling |
|---|---|---|---|---|
| A | #9 `deal-shape-chain:no_viable_deal_shape` | `dealshape.viable_shapes` | opportunity `pre_fs` | §14.2: a direct count of S4 deal shapes recorded at opportunity scope with status viable. Not derived from scores, route recommendations or LLM drafts. Absent means `unassessed`. |
| B | #5 `greenfield-screening:infrastructure_plan_not_finalized_at_site_announcement` | `infra.plan_finalized` (point in time) | project `fs` | §14.3: a human-recorded, project-scoped site-announcement event (date plus evidence reference) and an effective date on the plan-finalization record. Predicate `plan_finalized_on <= site_announced_on`. A missing date means `unassessed`. Inferred dates are rejected. |

Goal: `carriedWithoutDataSource()` (`app/web-next/lib/gate-snapshot.ts` ~595-630) returns an empty list against the real registry, the #5 `kill.caveats` text is dropped, and the C-6 `test.todo` in `tests/unit/kill-criteria-carry.test.ts` is resolved.

## 2. Findings: what exists today (verified)

### 2.1 Item A

- `deal_shape_evaluation` (0026, rebuilt in 0033) has `project_id TEXT NOT NULL REFERENCES md_project(id)`, plus `shape` (8-value CHECK), `intent`, `viable 0|1`, `evaluated_by` and `evaluated_at`. It is **project-scoped only**. The filler `fillViableShapesVar` (`db/lib/snapshot-filler.ts:732-743`) counts rows `WHERE project_id = ? AND viable = 1`.
- No REST route, repository or MCP tool writes `deal_shape_evaluation`. Only seeds populate it. So the human write surface is also missing.
- `route_decision` (0088/0101) is opportunity-keyed (`opportunity_id NOT NULL`). It records the **single chosen** track/sub_track plus scores (`route_decision_score`, `total_score`). It does not record an enumerated set of shapes, each with a viable verdict. Counting it would derive "viable" from a decision or from scores. §14.2 forbids that.
- `OPPORTUNITY_SCOPE_VARS = ["screening.viable_targets"]` (`gate-snapshot.ts:241`).

**Conclusion A: no existing human-recorded, opportunity-scoped record suffices. A schema change is required.**

### 2.2 Item B

- `infra.plan_finalized` is an asserted var (`evidence_var`, 0029). It fills from live, reviewed `dimension_input` rows (`snapshot-filler.ts` Family C, ~311-345). `dimension_input` has `observed_at TEXT NOT NULL`, but its meaning is "when the assertion was observed/recorded". It is not the legal effective date of the plan. Reading it as `plan_finalized_on` is the document-timestamp proxy that §14.3 rejects.
- There is no site-announcement record. `site` (0087) and `site_candidate` (0011/0033) are assessment rows with `created_at`/`updated_at` only.

**Conclusion B: a schema change is required. It adds a new event table and one new effective-date column.**

## 3. Item A design: opportunity-scope deal-shape evaluation

### 3.1 ERD delta

Option A1 (recommended) adds a **new table**, `opportunity_deal_shape_evaluation`. The project table stays as it is.

```sql
CREATE TABLE opportunity_deal_shape_evaluation (
  id TEXT PRIMARY KEY NOT NULL,
  opportunity_id TEXT NOT NULL REFERENCES opportunity(id),
  shape TEXT NOT NULL CHECK (shape IN ('full_acquisition','majority_stake','spv','holdco_route',
                                       'joint_venture','minority_stake','license_in','co_development')),
  intent TEXT NOT NULL CHECK (intent IN ('integration','capability_access')),
  viable INTEGER NOT NULL CHECK (viable IN (0,1)),
  rationale TEXT NOT NULL,              -- written feedback (RECYCLE semantics, registry note)
  evidence_ref TEXT,                    -- optional pointer to the S4 screen record
  evaluated_by TEXT NOT NULL,           -- md_user id of the calling human (never an agent account)
  evaluated_at TEXT NOT NULL,
  superseded_by TEXT REFERENCES opportunity_deal_shape_evaluation(id)
);
CREATE UNIQUE INDEX idx_odse_live ON opportunity_deal_shape_evaluation(opportunity_id, shape)
  WHERE superseded_by IS NULL;
CREATE INDEX idx_odse_opp ON opportunity_deal_shape_evaluation(opportunity_id, evaluated_at DESC);
```

- Layer: `fact_*`-equivalent normalized fact (human judgement record). `shape` and `intent` keep the existing CHECK vocabularies, which are byte-identical to `deal_shape_evaluation`. Promoting `shape` to an `md_deal_shape` code table is out of scope. It is flagged as debt in §8 (O-A3).
- Append-only with `superseded_by`. One live verdict per (opportunity, shape). A re-evaluation inserts a new row and supersedes the old one, so the history stays attributable.
- Index plan: `idx_odse_live` serves the filler count (`opportunity_id = ? AND superseded_by IS NULL AND viable = 1`) and enforces one live verdict per shape. `idx_odse_opp` serves the UI history list.

Option A2 rebuilds `deal_shape_evaluation` with a nullable `project_id`, a new `opportunity_id`, and a CHECK that exactly one is set. Rejected as the default: it needs a table rebuild (with a higher operational risk) and mixes two scopes in one fact. A1 keeps the project-scope reader untouched.

Project lineage: at the first project gate, the project-scope `dealshape.viable_shapes` (if ever needed at project scope) keeps reading `deal_shape_evaluation`. A1 does **not** copy rows forward. Opportunity evidence is reachable through `md_project.source_opportunity_id` (C-3 lineage), which is enough for audit.

### 3.2 Master data / run versioning (ADR-0005)

- No new `md_*` domain. `evidence_var` already has `dealshape.viable_shapes` (0026). The var needs its `md_var`/`evidence_var` provenance row updated so that its source is `opportunity_deal_shape_evaluation` at opportunity scope (§14.2 "still needs md_var provenance").
- The evaluation rows are human records, not run outputs. They carry no `run_id`. Attribution reaches the gate through the snapshot: the filler writes `evidence_ref = "opportunity_deal_shape_evaluation"` and `observed_at = MAX(evaluated_at)` into the gate-evaluation run's snapshot row. The snapshot is immutable once written (ADR-0005), so a later re-evaluation does not rewrite what a past gate saw.

### 3.3 Migration design (ADR-0014)

`db/migrations/0188_opportunity_deal_shape_evaluation.sql` (the number is assigned at implementation time):

- Header `-- @reversible: true (purely additive: one new table and two indexes; no backfill; no existing table altered)`.
- `ROLLBACK-SQL-BEGIN / DROP TABLE opportunity_deal_shape_evaluation; / ROLLBACK-SQL-END`. Rows recorded after the migration are lost on rollback. This is stated in the header, in the same way as 0187.
- Pre hook: a backup before the migration (the standard dba pairing). Post hook: `PRAGMA foreign_key_check`, then the health check, then a schema-parity check against `prisma/schema.prisma` (typegen regenerated).
- No backfill. Existing project-scoped rows are not opportunity evidence, and copying them would invent opportunity-scope records.

### 3.4 Write surface (human only)

- REST: `POST /api/opportunities/{id}/deal-shapes` (body: shape, intent, viable, rationale, evidence_ref?). `GET` the same path returns the live rows plus history. A re-post of the same shape supersedes the live row in one transaction.
- The permission is the caller's own opportunity permission (the same check as the route-decision draft). `evaluated_by` comes from the session, never from the body.
- MCP: `record_deal_shape_evaluation` in the shared registry as a REST client (ADR-0011). An agent call runs under the calling user's identity and permissions, which is Boundary 1. The tool is a **record** tool. It is not a `propose_*` tool, because the decision is the human's. Its description must state that the agent may record only a verdict the user has explicitly given. An LLM drafting helper, if one is wanted, must write to a separate draft surface and never into this table (O-A2).
- Refusals: 409 on an unknown opportunity. 422 on a CHECK violation (the API also pre-validates the enum).

### 3.5 Filler / predicate / guard

- Add `dealshape.viable_shapes` to `OPPORTUNITY_SCOPE_VARS`. The opportunity-scope filler reads the live rows for the opportunity. If no live rows exist, the status is `missing`, which makes #9 `unassessed` with the reason "no S4 deal-shape evaluation recorded at opportunity scope". If live rows exist, the filler writes `value_num = COUNT(viable=1)`, `status = present`. The predicate is unchanged (`count lt 1`).
- A recorded zero (every shape evaluated non-viable) is `present 0`, which triggers #9 (`mark_conditional`). That is the intended RECYCLE signal. It is not a missing value.
- Enforce guard: once the var is in `OPPORTUNITY_SCOPE_VARS`, #9's `reached_at_own_gate` entry clears. With item A landed, `carriedWithoutDataSource()` is empty against the real registry. Item B does not affect the guard, because #5 is evaluated at `fs`, a project gate.

### 3.6 UI capture point

S4 route-strategy screen (opportunity): a "deal-shape screen" panel. It lists the 8 shapes, each with an intent, a viable/not viable toggle and a required rationale. It follows Onyx 3.0 (existing table and form components, one primary action "record evaluation"). The gate-snapshot acknowledgement view for #9 shows the count and links to the panel when it is missing.

### 3.7 Tests

- Unit (filler): no rows gives missing/unassessed. Two viable rows give 2. All non-viable gives present 0, which triggers. A superseded row is ignored. Rows of another opportunity are ignored.
- Unit (guard): the real registry plus the new `OPPORTUNITY_SCOPE_VARS` give `carriedWithoutDataSource()` = `[]`. This replaces the current expectation of exactly #9.
- API: a human post creates a row, and a re-post supersedes it. `evaluated_by` comes from the session and the body cannot spoof it. Without opportunity permission the call is refused.
- Migration: apply, rollback and re-apply on a scratch DB. FK check clean.
- Negative: no code path derives the count from `route_decision`, `route_decision_score` or draft tables (grep-based assertion in the filler test).

## 4. Item B design: point-in-time site announcement

### 4.1 ERD delta

New project-scoped event table:

```sql
CREATE TABLE site_announcement (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES md_project(id),
  site_id TEXT REFERENCES site(id),          -- nullable: announcement may precede a chosen site row
  announced_on TEXT NOT NULL CHECK (announced_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  announcement_kind TEXT NOT NULL CHECK (announcement_kind IN ('board_resolution','public_announcement','mou_signing','regulatory_filing')),
  evidence_ref TEXT NOT NULL,                -- document id / URL of the announcement itself
  recorded_by TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  superseded_by TEXT REFERENCES site_announcement(id)
);
CREATE UNIQUE INDEX idx_site_announcement_live ON site_announcement(project_id, announcement_kind) WHERE superseded_by IS NULL;
```

The plan-finalization effective date has two options:

- **B1 (recommended)**: `ALTER TABLE dimension_input ADD COLUMN effective_on TEXT` (nullable, ISO date, a GLOB CHECK is not possible on ADD COLUMN in SQLite, so validation sits in the repository). `effective_on` is the date on which the asserted fact became true in the world. It is distinct from `observed_at` (when it was recorded). For `infra.plan_finalized = 'yes'`, the repository requires `effective_on` and an `evidence_ref` to the finalized plan document. For other vars, `effective_on` stays optional and is ignored. The change is additive, needs no rebuild, and reuses the reviewed-assertion discipline (the `reviewed_by` gate).
- B2: a dedicated `infra_plan_finalization (project_id, finalized_on, evidence_ref, ...)` table, with `infra.plan_finalized` re-pointed to it. Cleaner semantics, but it forks the asserted-fact path and leaves two writers for one var. Rejected as the default (O-B1).

Layer: both are normalized fact records. `announcement_kind` is a closed CHECK vocabulary. It could later become an `md_*` code if more kinds appear.

"Live single announcement": the first public commitment is what pilot 005 F-1 tests. If several events exist (board resolution, then public announcement), the **earliest live** `announced_on` is the relevant date (O-B2, confirmed by risk-officer). Per C-1 the unique live index allows one live row per (project, announcement_kind), and the filler takes `MIN(announced_on)` over all live rows of the project. Supersession is only for correcting the same event (same kind, with evidence); it must never replace one event with a different, later event.

### 4.2 Master data / run versioning

- New evidence vars (an `evidence_var` insert in the same migration): `infra.site_announced_on` (string date, source_kind `recorded`) and `infra.plan_finalized_on` (string date, source_kind `asserted`, read from `dimension_input.effective_on` of the live reviewed `infra.plan_finalized` row). Optionally, a derived boolean var `infra.plan_finalized_by_announcement`.
- Snapshot rows record both dates with `evidence_ref`, so the gate's immutable snapshot (ADR-0005) records exactly which announcement and which plan record were compared.

### 4.3 Migration design (ADR-0014)

`db/migrations/0189_site_announcement_and_effective_on.sql`:

- `-- @reversible: true (additive: one new table, one nullable column on dimension_input, two evidence_var rows; no backfill)`.
- Rollback: `DROP TABLE site_announcement; DELETE FROM evidence_var WHERE var_key IN ('infra.site_announced_on','infra.plan_finalized_on'); ALTER TABLE dimension_input DROP COLUMN effective_on;`. `DROP COLUMN` needs SQLite 3.35 or later and fails if the column is indexed. No index is added on it. dba confirms the engine version in the pre hook. Within the ADR-0002 portability regime, the column is plain TEXT ISO-8601, with no engine date type.
- No backfill. Existing `infra.plan_finalized` assertions get `effective_on = NULL`, so those projects read `unassessed` until a human records the date. Inferring it from `observed_at` is forbidden.
- Pre hook: backup. Post hook: FK check, health check, prisma typegen parity.

### 4.4 Write surface (human only)

- `POST /api/projects/{id}/site-announcement` (announced_on, announcement_kind, evidence_ref, site_id?). `GET` returns the live rows (one per kind) and history. A re-post supersedes only the live row of the same kind (correction, with evidence). MCP `record_site_announcement` (REST client, caller's identity).
- The existing dimension-input assertion route (`db/repositories/dimension-input.repository.ts`) gains `effective_on`. When `var_key = 'infra.plan_finalized'` and `value_text = 'yes'`, it is mandatory. `'no'` needs no date.
- Reviewer gate unchanged: an unreviewed assertion fills nothing. Neither tool can be called on an agent's own initiative to fill in dates. The tool descriptions forbid recording a date not supplied by the user or read verbatim from the cited evidence document by the user.

### 4.5 Filler / predicate

#5's predicate changes from a current-state check on `infra.plan_finalized` to:

```
triggered   if site_announced_on present AND (plan not finalized OR plan_finalized_on > site_announced_on)
clean       if site_announced_on present AND plan_finalized = yes AND plan_finalized_on <= site_announced_on
unassessed  if site_announced_on missing, OR plan_finalized = yes with effective_on missing,
            OR no reviewed infra.plan_finalized assertion
```

"Plan not finalized" at fs (a reviewed `'no'`, with an announcement on record) is triggered, because a plan that is still unfinalized cannot have been finalized before the announcement. Every other gap is `unassessed` and never `false`. The registry predicate needs a date-comparison form. If the predicate DSL has no `date_lte` operator, the filler computes the derived boolean `infra.plan_finalized_by_announcement` (`yes`/`no`/missing) and the predicate stays a simple `eq 'no'`. Recommended: the derived var, so no DSL change (O-B3). The `kill.caveats` C-6 text and the `test.todo` are removed in the same PR.

### 4.6 UI capture point

S5 greenfield site screen (project): an "announcement" card. It shows the date, the kind, an evidence link and a record/correct action. The infra-plan assertion form gets an "effective date of finalization" date field, required when the answer is yes. The #5 row in the snapshot view shows both dates side by side.

### 4.7 Tests

- Filler truth table: announced plus finalized-before or same day gives clean. Finalized-after gives triggered. A reviewed `'no'` gives triggered. A missing announcement gives unassessed. Yes without `effective_on` gives unassessed. An unreviewed assertion gives unassessed. A superseded announcement is ignored. Two live kinds (board resolution, then public announcement) use the earlier date (C-1).
- Proxy rejection: a project with only `observed_at`, gate dates and document timestamps reads unassessed.
- Repository: yes without `effective_on` is refused (422).
- Migration apply, rollback and re-apply. Caveat absent from the snapshot after the change. The `test.todo` becomes a real test.

## 5. Enforce-guard effect (summary)

| State | `carriedWithoutDataSource()` |
|---|---|
| Today (post-§14.5) | `[#9 reached_at_own_gate]` |
| After item A | `[]`, so enforce can start (owner decision to flip `kill_binding`) |
| Item B | no guard effect (fs is project-scope). It removes the #5 caveat, so #5 becomes clean evidence. |

## 6. Rollout

1. ADR-0194 accepted by the owner (schema ADR trigger). Risk-officer confirms §3.5 and §4.5 semantics.
2. PR-1 (item A): migration 0188, repository, API, MCP tool, filler and `OPPORTUNITY_SCOPE_VARS`, S4 panel, tests. dba executes the migration with backup and health hooks.
3. PR-2 (item B): migration 0189, repository change, API, MCP tool, filler-derived var, registry predicate and `evaluable_from_evidence` update, caveat removal, S5 card, tests.
4. In-flight deals: both items start `unassessed` until humans record data. That is fail-closed, never a silent pass. Before switching `kill_binding=enforce`, the owner checks in-flight opportunities at `pre_fs` for missing deal-shape records, because #9 being unassessed forces a `kill_unassessed` acknowledgement, and a carried halt blocks.
5. Demo seed (`seed-s1-s12-demo.ts`) adds opportunity deal-shape rows and an announcement plus effective date, so the demo passes.

## 7. FR-DATA rows checked

FR-DATA-01 (normalized facts, no mutation of raw payloads). FR-DATA-02 (closed code vocabularies, no free-text codes). FR-DATA-04 (no silent auto-creation: missing means unassessed, nothing inferred). FR-DATA-10/ADR-0005 (superseded_by chains, immutable snapshots). ADR-0061 n/a (no money columns).

## 8. Decisions (accepted by owner, 2026-11-07)

Resolution: O-A1 new table `opportunity_deal_shape_evaluation`; O-A2 no LLM drafting helper; O-A3 `md_deal_shape` promotion recorded as debt; O-B1 `dimension_input.effective_on`; O-B2 earliest live announcement of any kind (confirmed by risk-officer with C-1: per-kind live index, filler `MIN(announced_on)`); O-B3 derived boolean var; O-4 `kill_binding` enforce may be switched on after #9 lands (operational change, separate owner confirmation).

Original options:

- O-A1: new table (A1, recommended) vs rebuild `deal_shape_evaluation` with dual scope (A2).
- O-A2: whether an LLM drafting helper for deal-shape screening is wanted (separate draft surface) or the panel stays human-entry only.
- O-A3: promote `shape` to an `md_deal_shape` code table now, or keep the CHECK vocabulary and flag it as debt.
- O-B1: `dimension_input.effective_on` (B1, recommended) vs a dedicated plan-finalization table (B2).
- O-B2: which announcement is "the" announcement: earliest live event of any kind (recommended), or a specific kind (for example the public announcement only). Risk-officer call.
- O-B3: derived boolean var (recommended, no DSL change) vs adding a date comparison operator to the predicate DSL.
- O-4 (owner): flip `kill_binding` to enforce after item A, or wait for item B as well.

## Risk-officer confirmation (2026-11-07)

Reviewer: `risk-officer`, against ADR-0193 design §14.2 and §14.3. This is decision support; the owner records the decision.

**(a) #9 deal-shape predicate (§3.5): confirmed.** No live opportunity-scope rows means `missing`, so the outcome is `unassessed` with the stated reason. A recorded set with zero `viable` is `present 0`, which is `triggered` (`mark_conditional`). Rows are human-recorded facts only. Amendments:
- A-1: The filler counts only live (non-superseded) rows. Rows from LLM drafts, route recommendations or scores never enter the count, including through a "draft accepted" path. A draft becomes a fact only when a human writes the row through the §3.4 surface.
- A-2: A shape recorded as not yet evaluated (if the status vocabulary allows it) is neither viable nor non-viable. If every live row is in that state, the result is `unassessed`, not `present 0`.

**(b) #5 point-in-time predicate (§4.5): confirmed, with the derived boolean (O-B3).** `plan_finalized_on <= site_announced_on` gives clean. A missing date or an unreviewed assertion gives `unassessed`. A reviewed `'no'` with an announcement on record gives `triggered`. Amendments:
- B-1: The derived `infra.plan_finalized_by_announcement` must be **missing** (never `'yes'`) in every unassessed case, so that `eq 'no'` cannot read a gap as clean. Unit tests must cover all three outcomes plus the same-day boundary (equal dates count as clean).
- B-2: `announced_on` and `effective_on` dates later than the evaluation date are rejected at write time. `effective_on` must come from the finalized plan document (`evidence_ref`), never from `observed_at`, `recorded_at` or a gate date.
- B-3: Remove the C-6 `kill.caveats` text and the `test.todo` only in the PR that lands the source, the filler and these tests together.

**(c) O-B2 reference point: confirmed, the earliest live announcement of any kind.** The first public or binding commitment is what pilot 005 F-1 tests. Choosing a later, specific kind would let an earlier board resolution or MOU slip past the check, which is optimism by selection. Amendment:
- C-1 (schema conflict): the §4.1 unique index `idx_site_announcement_live ON (project_id) WHERE superseded_by IS NULL` allows only one live row per project. Under that index, "earliest of several" can never be evaluated, and recording a later public announcement would supersede the earlier board resolution and move the reference date **later**. Change the index to `(project_id, announcement_kind) WHERE superseded_by IS NULL`, and have the filler take `MIN(announced_on)` over all live rows. Supersession is for corrections of the same event only (same kind, with evidence), and it must not be used to replace one event with a different, later event.

Kill-criteria evaluation status: no deal is evaluated here (design ruling only). Unassessed: n/a.
