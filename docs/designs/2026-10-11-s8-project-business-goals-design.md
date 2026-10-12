# S8 Project-Level Business Goals — Set Goals Before Comparing Scenarios

- Date: 2026-10-11
- Status: Draft (Row 0 Design Gate; user decision "option C", 2026-10-11)
- Owner: platform-lead (technical domain)
- ADR: ADR-0159 (Proposed) — `docs/adr/0159-project-business-goals.md`
- Related: ADR-0114 (business-target standards, fs-gate reference evidence), ADR-0146 (admin role vs business content), ADR-0154 (human-only actions, proposal-only MCP), ADR-0158 (human-only S8 route precedent), ADR-0061 (money in KRW millions), ADR-0014 (additive-only migrations), design 2026-10-11-s8-ev-band-user-confirmed-design (human-only route precedent, PR 496/499)

## Problem

Verified on greenfield project `01M1MXQN21DP8KYHNW3GDSE4PW` (S8):

1. The standards scope resolves (group "Susan", affiliate "Susan Cebotics"), but `md_business_target` holds no rows for that scope.
2. Three scenario cases exist and one is already ADOPTED. Scenarios were compared and a case adopted with no goals at all.
3. The only hint is a small panel at the page bottom (Korean text meaning "no applicable business-target standard — register in admin console > master data").
4. The greenfield "target compare/select" tab is a dead end (Korean text meaning "use the scenario compare tab").
5. Analysts cannot fix this. `md_business_target` is written only through `app/web-next/app/api/admin/business-targets/route.ts`, which calls `requireAdmin` on every method (ADR-0114). Under ADR-0146 the `admin` role is a system role that is blocked from business (deal) content outside the admin console, and analysts and leads are not admins. So the ONLY role that can write a standard is `admin`, and only as group/affiliate master data, never per project. No business role can set a goal for a deal.

## Decision summary

Analysts set PROJECT-level business goals directly in S8, before scenario comparison. Project goals sit above the affiliate and group standards in resolution (project > affiliate > group, per metric). Goals are reference evidence (ADR-0114 boundary unchanged): a miss never blocks a gate; recommendations remain proposals; a human decides.

## A. Data model

### Choice: new table `project_business_goal` (not a nullable `project_id` on `md_business_target`)

| Criterion | Extend `md_business_target` | New `project_business_goal` (chosen) |
|---|---|---|
| Ownership / authority | Table is admin master data (ADR-0114). Mixing deal rows forces the admin route to filter them out, and admin listing would expose deal content (ADR-0146 violation risk) | Clean split: admin writes standards, analysts write goals |
| History model | Update-in-place plus tombstone; unique active index per scope | Append-only versions with `supersedes_id`; judged-act history like other human records |
| Required fields | `group_id NOT NULL`; no rationale, no source note | `rationale NOT NULL`, optional `source_note`, no group dependency (works when scope is unresolved) |
| Visibility | Admin-wide | Project visibility via `visibleProject` |
| Blast radius | Changes the unique index and every reader of an existing table | Additive; existing readers untouched |

### Migration `db/migrations/0135_project_business_goal.sql` (next free number; latest on main and all local branches is 0134; no open PR adds 0135)

```sql
-- Additive-only (ADR-0014). Background: ADR-0159.
CREATE TABLE project_business_goal (
  id TEXT PRIMARY KEY,                       -- ulid
  project_id TEXT NOT NULL REFERENCES md_project(id),
  metric_key TEXT NOT NULL,                  -- METRIC_PRESETS key or 'custom' (validated in app layer)
  label TEXT,                                -- required when metric_key = 'custom'
  direction TEXT NOT NULL CHECK (direction IN ('gte','lte')),
  target_value REAL NOT NULL,                -- stored units: KRW millions, ratio, years (ADR-0061)
  rationale TEXT NOT NULL CHECK (length(trim(rationale)) > 0),
  source_note TEXT,
  supersedes_id TEXT REFERENCES project_business_goal(id),
  superseded_at TEXT,                        -- set on the old row when a new version is written
  superseded_by TEXT,                        -- id of the new version
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  retired_at TEXT,                           -- soft delete ("retire")
  retired_by TEXT,
  retire_reason TEXT
);
CREATE INDEX idx_pbg_project ON project_business_goal(project_id, metric_key);
CREATE UNIQUE INDEX idx_pbg_project_metric_active ON project_business_goal(
  project_id, metric_key, COALESCE(label, '')
) WHERE superseded_at IS NULL AND retired_at IS NULL;
```

Row values are never overwritten. A supersede writes a new row and stamps only `superseded_at`/`superseded_by` on the old row (the same "stamp, not rewrite" convention as tombstones). Retire stamps `retired_*`. Active = `superseded_at IS NULL AND retired_at IS NULL`.

Rollback (down, manual): `DROP INDEX idx_pbg_project_metric_active; DROP INDEX idx_pbg_project; DROP TABLE project_business_goal;` No other table references it. Code rollback: revert the PR; resolution falls back to affiliate > group.

Backfill: none. No existing data represents project goals.

### Library changes (`app/web-next/lib/business-targets.ts`, new `lib/project-goals.ts`)

- `lib/project-goals.ts`: `listProjectGoals(projectId, {includeHistory})`, `createProjectGoal`, `supersedeProjectGoal`, `retireProjectGoal`. Each write runs in one transaction with an `appendAudit` entry (`project_goal.create` / `project_goal.supersede` / `project_goal.retire`, target `projectId:goalId`). Validation reuses `METRIC_PRESETS`, `CUSTOM_METRIC_KEY`, `presetFor` and the admin route's direction/value parsers (move `parseDirection`/`parseTargetValue` into `business-targets-format.ts` so both routes share them). Preset rows take the preset's default direction when omitted.
- `ResolvedTarget.source` widens to `"project" | "affiliate" | "group"`; `overridden` becomes `shadowed: Array<{ source: "affiliate" | "group"; row }>` (keep `overridden` as an alias for one release for API compatibility).
- New `resolveProjectTargets(projectId): { scope: ProjectTargetScope | null; resolved: ResolvedTarget[] }`. It reads active project goals first, then, when `projectTargetScope` resolves, calls `resolveBusinessTargets(groupId, memberId)` and merges by key `metric_key + label`: project wins, then affiliate, then group. Project goals apply even when the scope is null.
- `projectTargetScope` itself is unchanged (it still describes only the standards scope).
- `evaluateTargets` takes the merged list; `scope` becomes nullable. `TargetCheckEntry.source` widens to include `"project"`; `source_name` for project = project name; `overridden_note` is generalized to `shadowed_note` (English description of the Korean UI text: "takes precedence over the affiliate standard X / group standard Y"), and a structured `shadowed: [{source, target_value}]` is added. New optional fields `rationale` and `set_by` for project goals. Status logic is unchanged.
- New `evaluateTargetsForCase(resolved, caseView, scenario)` so the scenario comparison can evaluate EVERY case, not only the adopted one (same status logic).
- `TargetCheckResult.scope` becomes `ProjectTargetScope | null` and gains `goal_count_by_source: {project, affiliate, group}`.

### Consumers

- `app/web-next/app/api/projects/[id]/target-check/route.ts` and the fs-gate evidence builder switch to `resolveProjectTargets`. The fs-gate evidence table shows the source column (project / affiliate / group) and the shadowed note. Evidence remains reference-only (ADR-0114).
- `components/TargetCheckPanel.tsx`: source badge per row (text, not colour alone), shadowed note, project-goal rationale on expand; the empty state links to the new Goals tab instead of the admin console (the admin console hint stays only as secondary text for admins).

## B. Authority and boundaries

| Actor | Read goals | Create / supersede / retire | Notes |
|---|---|---|---|
| viewer | Yes (visible projects) | No — 403 `role_required` | |
| analyst, lead, other business roles | Yes | Yes, via the human-only route | analyst+ bar, same as ev-band |
| admin | No — blocked per ADR-0146 (`visibleProject` returns 404 for admin) | No | Admin keeps writing group/affiliate standards in the admin console only |
| Agents (MCP in-process port, bearer/OAuth-delegated principals) | Yes via `get_target_check` (read) | No — route is in `HUMAN_ONLY_ROUTES` | Agents may only propose (see below) |

- New route `POST /api/projects/{id}/business-goals` with an `action` body field (`create` | `supersede` | `retire`), plus `GET /api/projects/{id}/business-goals`. One POST path keeps the human-only registration to a single entry. Auth follows the ev-band route (PR 496/499): `authenticate` (cookie session; CSRF enforced by the existing session middleware for mutating cookie requests), reject `viewer`, `visibleProject` else 404, then reject non-session principals exactly as other human-only routes do (bearer tokens and OAuth-delegated principals get 403 `human_only`).
- Register `{ method: "POST", pattern: "/api/projects/:id/business-goals" }` in `HUMAN_ONLY_ROUTES` (`app/web-next/lib/mcp/in-process-port.ts`) and add an exclusion `project-business-goals` (kind route, `"POST /api/projects/{}/business-goals"`, reason "Human-only project goal setting, boundary #2; agents may only propose") to `scripts/co-newbiz/mcp-coverage.exclusions.yaml`. The GET is read-only and may be mapped to MCP later; out of scope now.
- Agent proposals: no existing proposal type fits goals (`propose_*` tools are decision-shaped). A `propose_project_goal` proposal type is OUT OF SCOPE for this change and listed as an open question.
- Every write appends an audit entry. ADR-0114 boundary holds: goals are reference evidence at the fs gate; a missed goal never blocks the gate, never changes RAG automatically, and never re-ranks scenarios. The adoption recommendation stays a proposal.

## C. UX flow (Onyx 3.0, `docs/design-system/design-guide.md`)

### S8 tab order

Greenfield: Goals, Scenarios (summary + scenario compare), WACC, Financial analysis, Decision (adoption); "More" keeps overview, params, target costing. Brownfield: Goals, then the current per-target tabs unchanged.

The greenfield "target compare/select" tab is HIDDEN (decision). It has no function for greenfield and its only content redirects elsewhere; hiding removes the dead end. Deep links to it redirect to the Scenarios tab.

### State banner (all S8 tabs)

A single `Banner` at the top of the stage body:

- No applicable goals: info/warning tone, text meaning "Business goals are not set. Scenarios will be compared without goals." One primary action: "Set goals" (opens the Goals tab).
- N goals applied: neutral tone, text meaning "N goals applied — project X, affiliate Y, group Z". One primary action: "Review goals" (on the Goals tab itself the action is hidden).

### Goals tab

- List (shared table component): metric, direction (symbol plus words), target value with unit, source badge (Project / Affiliate / Group, text label with icon), shadowed note, set by / date, rationale (truncated, expandable). Inherited standards show read-only with their source; a "Set project goal" row action creates a project goal for that metric (prefilled) which then shadows it.
- Editor (side panel or inline form): metric preset picker (presets plus "Custom" with required label), direction (defaulted from preset), target value with the unit label from `unitSpec` (KRW 100 millions input, % input, years), rationale (required, multiline), source note (optional). Edit = supersede: the form shows "This creates a new version; the previous value stays in history". Retire asks for a reason.
- History drawer per metric: all versions newest first with who/when/rationale/retire reason.
- Empty state: explains goals and offers starter metrics (below) as one-click prefill; nothing is saved without the analyst entering values and a rationale.

Starter metrics for greenfield (all from `METRIC_PRESETS`, nothing new): NPV p50 (`npv`, gte), IRR p50 (`irr`, gte), annual revenue in the final year (`revenue`, gte), operating margin in the final year (`operating_margin`, gte), plan period (`period`, lte). NPV p05 and payback / BEP year are NOT presets today and are not computable by `evaluateTargets`; they can be entered as custom metrics (status "manual check") and are an open question for a later preset extension.

### Scenario comparison

Each scenario card gains a goal-attainment section with one row per applicable goal: met / missed / indeterminate / not set / manual check, each as icon plus text (never colour alone). Evaluated with `evaluateTargetsForCase` per case.

- "Indeterminate" means the goal is computable but the case lacks the figure (for example no simulation run, so NPV/IRR p50 is null, or no revenue lines). It is not a miss.
- "Not set" appears only in the no-goals state as a single line per card.
- No goals at all: the comparison still renders; a callout with text meaning "Compare against goals: set goals first" and a secondary link to the Goals tab. It never blocks.

### Adoption with no goals

When no applicable goals exist (project, affiliate and group all empty), the adopt action opens a `ConfirmDialog` with text meaning "No business goals apply to this project. The case will be adopted without goal comparison." and a required acknowledgement checkbox plus an optional note. Adoption proceeds after acknowledgement (not a hard block). The existing adoption record is a `process_run` row (`stage = 's8_case_adopt'`) whose `meta_json` currently holds `{model_id}`. The acknowledgement is stored there with NO schema change: `{model_id, goals_ack: {acknowledged: true, note, goal_count: 0, at}}`. When goals exist, `meta_json` records `goal_count` and the attainment snapshot summary (`met/missed/indeterminate/manual` counts) for audit.

### Brownfield

Per-target behaviour is unchanged. Project goals apply to every target's case in the per-target comparison the same way (goal-attainment column per target). The target compare/select tab stays.

## D. API contract

### `GET /api/projects/{id}/business-goals`

Auth: any authenticated non-admin role with project visibility. Query `history=1` includes superseded and retired rows. Response `200`:

```json
{ "ok": true, "data": {
  "goals": [{ "id": "...", "metric_key": "npv", "label": null, "direction": "gte", "target_value": 50000,
              "unit": "krw_m", "rationale": "...", "source_note": null, "created_by": "...", "created_at": "...",
              "supersedes_id": null, "superseded_at": null, "retired_at": null }],
  "resolved": [{ "metric_key": "npv", "source": "project", "shadowed": [{ "source": "group", "target_value": 30000 }] }],
  "presets": [ ...METRIC_PRESETS ] } }
```

### `POST /api/projects/{id}/business-goals` (human-only)

| action | body | result |
|---|---|---|
| `create` | `metric_key`, `label?` (required if custom), `direction?`, `target_value`, `rationale`, `source_note?` | `201 {goal}` |
| `supersede` | `goal_id`, `direction?`, `target_value`, `rationale`, `source_note?` | `201 {goal, superseded_id}` |
| `retire` | `goal_id`, `reason` | `200 {goal_id, retired_at}` |

Validation and errors (standard envelope):

| HTTP | code | When |
|---|---|---|
| 400 | `invalid_request` | Unknown action, bad direction, non-finite or negative value, empty rationale/reason, custom without label, unknown preset key |
| 401 | `unauthenticated` | No session |
| 403 | `role_required` | viewer |
| 403 | `human_only` | Bearer/OAuth/agent principal (and MCP in-process port refusal) |
| 403 | CSRF failure code of the existing middleware | Missing/invalid CSRF token |
| 404 | `not_found` | Project not visible (includes admin per ADR-0146) or goal not in this project |
| 409 | `goal_exists` | `create` for a metric+label that already has an active project goal (use supersede) |
| 409 | `goal_not_active` | supersede/retire of a superseded or retired goal |

### Changed routes

- `GET /api/projects/{id}/target-check`: entries gain `source: "project"`, `shadowed`, `shadowed_note`, `rationale`, `set_by`; `scope` nullable; `goal_count_by_source`. Additive; `overridden_note` kept for one release.
- `POST /api/projects/{id}/business-case/adopt`: optional body `goals_ack: { acknowledged: boolean, note?: string }`. When no applicable goals exist and `goals_ack.acknowledged !== true`, respond `409 goals_ack_required` (the UI turns this into the confirmation dialog). This is a confirmation requirement, not a gate block.

### OpenAPI / api-spec

Add both business-goals operations, the `goals_ack` field and `409 goals_ack_required` on adopt, and the widened target-check schema to the OpenAPI source and `docs/architecture/api-spec.md`; `tests/unit/openapi.test.ts` checks the route set.

### MCP impact

- `POST business-goals`: human-only (HUMAN_ONLY_ROUTES + coverage exclusion). No new write tool.
- `get_target_check` (read tool): output now includes project-level entries and `source: "project"`; update the tool description and its output schema / Zod contract; no new tool.
- `propose_case_adoption` / `recommend_case_adoption`: the recommendation text should state when no goals apply (one sentence); no behaviour change.

## Tests

- Unit (`lib/project-goals`): create/supersede/retire, append-only (old row values unchanged after supersede), unique active per metric+label, audit entry per write, custom label rule, preset default direction.
- Unit (resolution): project > affiliate > group per metric; custom metrics keyed by label; project goals with null scope; shadowed list content.
- Unit (`evaluateTargetsForCase`): met/missed/indeterminate/manual for each preset; indeterminate when sim missing.
- Route: viewer 403, admin 404, bearer/OAuth 403 `human_only`, CSRF failure, validation codes, 409 codes, visibility 404.
- MCP: `isHumanOnly("POST", "/api/projects/x/business-goals")` true; coverage check passes with the exclusion.
- Adopt: no goals and no ack gives 409; with ack, `meta_json.goals_ack` stored; with goals, `goal_count` and summary stored.
- OpenAPI route-set test; design:lint for new UI; component tests for banner states, attainment labels (text present, not colour only), confirm dialog.

## Accessibility (WCAG 2.1 AA)

- Status and source conveyed by icon plus text (1.4.1). Contrast via Onyx tokens only (1.4.3, 1.4.11).
- Banner uses `role="status"`; validation errors linked with `aria-describedby` and announced (3.3.1, 4.1.3).
- Editor fully keyboard operable; focus moves into the side panel and returns to the trigger on close; dialog traps focus and has a labelled title (2.1.1, 2.4.3).
- Acknowledgement checkbox has a visible label; the confirm button is disabled until checked, with the reason stated in text.
- Tab order follows the new stage tab order; tabs use the shared tab component with `aria-selected`.
- Tables keep header associations; at mobile width the shared table's card layout keeps metric/source/status labels.

## Preview verification

Breakpoints: 375 (mobile), 768 (tablet), 1440 (desktop).

- Greenfield `01M1MXQN21DP8KYHNW3GDSE4PW`: banner shows "not set" with "Set goals"; target compare/select tab hidden; create NPV and IRR goals; banner shows "2 goals applied — project"; scenario cards show attainment rows; supersede one goal and see history; target-check panel lists source "Project"; adoption confirm dialog appears only when goals are retired back to zero.
- Brownfield `01M2Y2SM5TM27D5YZ3CHT7T81A`: per-target tabs unchanged; Goals tab present first; a project goal shadows a group standard (if any) with the shadowed note; per-target comparison shows attainment.
- Viewer session: read-only (no editor actions). Admin session: project not reachable (ADR-0146).

## Data migration, rollback

- Backfill: none expected; no existing data represents project goals. The already-adopted case on the greenfield project is left as is; its adoption record has no `goals_ack`, which correctly reflects history.
- Rollback: revert the PR; optionally drop the table (see SQL above). The `meta_json` additions are ignored by older code.

## Non-goals

- Changing `md_business_target`, the admin console, or who writes standards.
- Making goals block any gate, change RAG automatically, or re-rank scenarios.
- An agent proposal type for goals; new computable presets (NPV p05, payback/BEP year).
- Changing brownfield per-target behaviour beyond the attainment column.

## Open questions for the human

1. Should NPV p05 and payback/BEP year become computable presets (needs simulation fields confirmed) in a follow-up?
2. Should agents get a `propose_project_goal` proposal type, or remain read-only for goals?
3. When project goals exist but `projectTargetScope` is null, should the banner still mention that no group standards apply?
4. Should a goal superseded AFTER adoption trigger a notice that the adopted case was evaluated against an older goal version (the adoption snapshot makes this detectable)?
5. Is analyst+ the right bar, or should goal setting be lead-only?

## Task split

| Row | Task | Agent |
|---|---|---|
| 1 | Migration 0135, `lib/project-goals.ts`, resolution/evaluation changes, business-goals route, adopt `goals_ack`, target-check widening, HUMAN_ONLY_ROUTES + coverage exclusion, OpenAPI/api-spec, tests | backend-engineer |
| 2 | S8 Goals tab, stage tab order, banner, scenario attainment column, adoption confirmation, greenfield target compare tab hidden, TargetCheckPanel source badges | frontend-engineer |
| 3 | Cross review: optimism/evidence boundary (risk-officer); auth, human-only, CSRF, ADR-0146 (security-engineer) | risk-officer, security-engineer |
| 4 | `/sync` | PM |
