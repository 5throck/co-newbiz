# Optional per-target DD on shortlisted brownfield targets

- Date: 2026-10-09
- Status: Approved (user approved in chat, 2026-10-09)
- ADR: `docs/adr/0157-optional-per-target-dd.md`
- Related: ADR-0143 (S8 per-target axis, S9 selected-target rule — amended),
  ADR-0156 (per-target WACC, `TargetSelector`), ADR-0099 (S9 predicate),
  ADR-0148 (unassessed standard items), ADR-0154 (proposal-only MCP decisions)

## Context and goals

Brownfield S9 runs DD only on the target a human selected at S8 (ADR-0143 §5,
flow.spec v2.5.0). Reviewers want to optionally run DD on additional
shortlisted targets as comparison evidence, without changing what the gate
judges.

Goals:

- Default unchanged: DD scope is the selected target only.
- A human may explicitly open DD on another shortlisted target; that target
  gets its own checklist judgements, custom items, waivers and `dd_finding`.
- S9 completion and the `dd` gate verdict are computed on the selected target
  only; other targets are comparison evidence.
- Changing the S8 selection keeps all per-target DD and re-points the gate.

Non-goals: parallel mandatory DD, moving selection to IC, greenfield changes.

## Storage (additive only)

Migration `db/migrations/0132_dd_target_axis.sql`:

| Table | Change |
|---|---|
| `project_checklist_item_state` | `target_id TEXT NULL REFERENCES brownfield_target(id)`; rebuild to replace inline `UNIQUE(project_id, checklist_id, item_id)` with unique index on `(project_id, COALESCE(target_id,''), checklist_id, item_id)`; rows copied verbatim |
| `project_checklist_item_custom` | `ALTER TABLE ... ADD COLUMN target_id` (nullable FK) |
| `dd_finding` | `ADD COLUMN target_id` (nullable FK) |
| `waiver` | `ADD COLUMN target_id` (nullable FK) |
| `dd_target_open` (new) | `id, project_id, target_id, opened_by, opened_at, rationale, source ('manual' or 'reselection')`, UNIQUE `(project_id, target_id)` |

Semantics: `target_id IS NULL` = the selected target or the legacy single
subject. Non-NULL = an explicitly opened target. Indexes:
`idx_pcis_project_target(project_id, target_id, checklist_id)`,
`idx_dd_finding_project_target(project_id, target_id)`.

The state-table rebuild follows the 0033 pattern (create `_new`, copy, drop,
rename, recreate indexes) inside one transaction; row counts are asserted
equal before commit.

## API

All DD routes accept an optional `target_id` (query for GET, body for
POST/PATCH). Omitted = selected/legacy scope (`target_id IS NULL`), so every
existing caller is unchanged.

- `GET/POST /api/projects/{id}/dd-checklist/state?target_id=`
- `POST /api/projects/{id}/dd-checklist/tailor` (body `target_id`)
- `GET /api/projects/{id}/dd?target_id=` — workspace payload, plus a new
  `targets[]` summary: `{target_id, name, is_selected, opened, opened_at,
  total, unassessed, pending, mandatory_unmet}`
- findings and `waivers` POST routes accept `target_id`
- New: `POST /api/projects/{id}/dd/targets` `{target_id, rationale}` — opens
  DD for a target. Human session only (rejects agent/MCP tokens); requires a
  rationale; target must be shortlisted on the source opportunity; writes an
  audit log entry; idempotent on `(project_id, target_id)`.

Validation: a non-NULL `target_id` that is not opened returns 409 with
`DD가 열리지 않은 대상입니다`. Passing the selected target's id explicitly is
normalised to NULL.

## Process-flow S9 predicate and flow.spec

`ddCompletionSummary(projectId, opts?: { targetId?: string | null })` filters
by `target_id IS NULL` by default and by the given id otherwise;
`subTrackChecklistIds` is target-independent. The S9 predicate in
`lib/process-flow.ts` and the `dd` gate readiness call it with no target, so
they read only the selected/legacy scope. A unit test pins that rows on other
targets never change the predicate.

`process/flow.spec.yaml` v2.6.0 (text only): S9 objective appends
`선택적으로 다른 Short List 대상 DD를 비교 근거로 열 수 있다`; outputs add
`대상별 DD 비교(선택)`; completionCriteria keep `선정 대상` wording. The
mirrored string in `lib/process-flow.ts` STAGES is updated in the same PR.

Policy impact: none. No `procedures/**` or `policies/**` file changes; the
`brownfield-dd` procedure still defines one DD instance, repeated per opened
target at the dispatch layer (ADR-0143 §6 pattern).

## UI

`components/stages/DdStage.tsx`:

- Reuse `TargetSelector` (ADR-0156) above the checklist when the project has
  ≥2 shortlisted targets. Options show the selected target first with a
  `선정 대상` badge; non-opened targets are listed but disabled for editing.
- A secondary button `DD 열기` on a non-opened target opens a dialog with a
  required rationale field and a cost note, then calls the open route. The
  stage keeps one primary action (gate recording) per Onyx 3.0.
- Non-selected scopes show a banner `비교 근거 — 게이트 판정에 반영되지 않습니다`.
- Comparison view: a table, one row per opened target, columns total /
  unassessed / pending / mandatory unmet / findings with value impact. No
  PASS stamp; counts of unverified items are shown explicitly.
- Gate panel always states which target it judges.

## MCP tools

`mcp/co-newbiz/tools/stage-tools.ts`: `tailor_dd_checklist`,
`record_dd_finding`, `request_dd_waiver` and `get_project_dd_workspace` gain
an optional `target_id` passthrough. No MCP tool opens DD; an agent may file
`propose_approval` suggesting a target to open, which a human accepts in the
UI. Writes to a non-opened target fail with the API's 409.

## Re-selection handling

In the `target-selection` POST transaction, when the selected target changes
from A to B:

1. `UPDATE ... SET target_id = A WHERE project_id = ? AND target_id IS NULL`
   on all four DD tables (A's DD becomes ordinary per-target evidence).
2. Insert `dd_target_open(A, source='reselection')` if absent.
3. If B has opened DD, `UPDATE ... SET target_id = NULL WHERE target_id = B`
   so B becomes the gate scope; B's open row is kept for the audit trail.
4. Any existing `dd` gate decision is marked stale (re-judgement required).

All steps are one transaction; a unit test covers A→B→A round-trips.

## Grandfathering

Existing rows keep `target_id = NULL` and remain the gate scope; no backfill.
Projects without `dd_target_open` rows render exactly as today, and
`TargetSelector` is hidden when fewer than two targets are shortlisted.
Greenfield projects never accept a `target_id`.

## Tests

Unit (`bun test`):

- migration 0132: row counts preserved, new unique index enforced per target
- `ddCompletionSummary` scope filtering; S9 predicate ignores other targets
- open route: human-only, shortlist validation, rationale required, idempotent
- writes to non-opened target return 409
- re-selection transaction A→B, A→B→A, B without prior DD
- MCP passthrough and the absence of an open tool

E2E (`tests/scenarios/brownfield-ma.test.ts`): after S8 selection, open DD on
a second target with a rationale, record one judgement and finding, verify
the comparison table and that the S9 gate panel still judges the selected
target; axe scan on the DD workspace with the selector visible.

## Risks

- Reviewers over-reading partial comparison DD — mitigated by the banner and
  explicit unverified counts.
- Re-selection after a `dd` gate decision — gate decision marked stale.
- Rebuild migration on a large state table — copy-and-count assertion.
- Waiver cross-application — waivers are matched on `target_id` equality.

## Accessibility

`TargetSelector` keeps its labeled FilterChip group with `aria-current`.
The `DD 열기` dialog traps focus, labels the rationale field, and announces
errors via `aria-live`. Badges and the comparison banner use text plus icon,
never color alone. The comparison table has a caption and header scopes.
WCAG 2.1 AA verified with axe in the E2E scenario.

## Preview Verification

Run the web app locally, open a seeded brownfield project at S9 with three
shortlisted targets, and verify: selector hidden for single-target projects;
`DD 열기` requires a rationale and appears in the audit log; the comparison
table updates; the gate panel names the selected target; re-selecting at S8
moves the gate scope while keeping prior DD rows. Capture screenshots for
the PR and run `design:lint`.

## Implementation notes (2026-10-09)

Details settled during implementation; none change the decisions above.

- **Stale `dd` gate decision.** The gate decision row stays an immutable human
  record. Migration 0132 therefore adds a marker table
  `gate_decision_stale(decision_id, stale_at, stale_reason)` instead of
  editing `gate_decision`; the re-selection transaction inserts markers for
  the project's `dd` decisions and `latestGateDecisions` skips marked rows,
  so S9 must be re-judged on the newly selected target. History keeps every
  row and exposes `stale_at`.
- **`dd_finding` writer.** The app had no writer for `dd_finding` (the
  `record_dd_finding` MCP tool targets `partner_dd_finding`, which has no
  target axis). `POST /api/projects/{id}/dd/findings` is added so findings
  can carry `target_id`; `record_dd_finding` is unchanged.
- **Suggesting a target.** `propose_approval` gains the subject
  `dd_target_open` `{target_id, rationale}`; confirming it runs the open
  route in the confirming human's own session. No tool opens DD.
- **Other readers.** Gate brief, IC package, S10 recommendation, RAG
  snapshot and DD cross-validation read the gate scope
  (`target_id IS NULL`) only, so comparison evidence never feeds S10 or the
  IC package. `findActiveWaiver` matches the gate scope only.
- **Selection required.** Opening DD on another target requires a recorded
  S8 selection (`selection_required`), so "selected" is always defined.
