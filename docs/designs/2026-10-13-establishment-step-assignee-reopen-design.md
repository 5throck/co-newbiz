---
lang: ko
lang_reason: proper-noun
---

# S11 Establishment Steps — Status Change, Per-Step Assignee, Reopen

- Date: 2026-10-13
- Status: Draft (design only, no source changes)
- Owner: platform-lead (technical domain)
- ADR: [ADR-0165](../adr/0165-establishment-step-assignee-and-reopen.md) (Proposed)
- Related: ADR-0047 (origin applies_when), ADR-0085 (establishment record, migration 0059), ADR-0100 (project key, migration 0070), ADR-0154 §5 (human-only mutations), ADR-0014 (additive migrations), ADR-0163 (stop-on-error migration runner)

## 1. Problem

The S11 "설립 실행 — 5단계 (내부 추진·합작)" table (`app/web-next/components/stages/IcReviewStage.tsx` ~L335-420) offers a single per-row button, "증적과 함께 완료". In practice:

1. The button label implies completion only; the form actually allows other statuses but defaults to `done` and the label hides that. There is no clean "change status" action.
2. `owner` is overwritten by every writer (`upsertEstablishmentStep(..., ctx.userId)`), so "담당자" is really "last recorder". There is no way to assign a responsible person.
3. A `done` step is locked in the UI (`disabled={isDone}`), yet the API silently allows `done -> anything` through a plain PUT with no reason and no distinct audit. There is no sanctioned reopen.
4. For projects whose origin is not `internal`/`joint` the action column is hidden and only a one-line note explains it.
5. Findings while reading the code (fixed by this design):
   - The "evidence required for done" rule is enforced only in the client (`updateStep`); the API accepts `done` with no evidence.
   - The UI text claims "에이전트는 대신 완료할 수 없습니다", but `PUT /api/projects/:id/establishment` is NOT in `HUMAN_ONLY_ROUTES`, and MCP `record_establishment` (`mcp/co-newbiz/tools/stage-tools.ts` L197) can write `status: "done"`. The stated boundary is not enforced.
   - `audit_log` carries only `(actor, action, target, created_at)`; the current audit target is the project id, so the step and transition are not recoverable from audit.

## 2. Approved changes (scope)

1. Relabel the action as **상태 변경** with a status select (`in_progress | done | halted | escalated`); evidence (URL or note) is required **only** for `done`, enforced server-side.
2. A separate **assignee per step**, chosen from current project members; keep "last recorder" display.
3. **Reopen** a `done` step with a mandatory reason, audited.

Out of scope: changing step titles, the 5-step procedure, the applies_when rule (ADR-0047), the opportunity-side ledger model, or per-checklist-item rows (the UI writes `checklist_item = NULL`; the design keeps that).

## 3. Data model — migration 0140

Next free migration number: **0140** (latest is `0139_scorecard_review_cycle_key.sql`). Additive only (ADR-0014): one column, one history table, indexes. No table rebuild.

```sql
-- 0140_establishment_step_assignee_reopen.sql
-- @reversible: true (purely additive — ADD COLUMN + CREATE TABLE + CREATE INDEX;
-- no existing column or row semantics change. Rollback: DROP TABLE
-- entity_establishment_step_event; drop assignee_user_id via table rebuild of
-- entity_establishment_step or restore the pre-migration backup —
-- scripts/co-newbiz/restore.ts. ADR-0014, ADR-0165.)
--
-- S11 establishment steps (ADR-0165): per-step assignee distinct from the last
-- recorder (owner), and an append-only transition history that carries the
-- mandatory reopen reason (audit_log has no detail column).

ALTER TABLE entity_establishment_step ADD COLUMN assignee_user_id TEXT;
-- NULL = 미지정. Membership is validated in the application layer at write
-- time (project_member has a composite PK; a revoked member keeps the value
-- for history and is flagged in the UI). owner keeps its 0059 meaning in
-- practice: the last human/agent who recorded the row.
ALTER TABLE entity_establishment_step ADD COLUMN assigned_by TEXT;
ALTER TABLE entity_establishment_step ADD COLUMN assigned_at TEXT;

CREATE TABLE entity_establishment_step_event (
  id TEXT PRIMARY KEY NOT NULL,
  step_id TEXT NOT NULL REFERENCES entity_establishment_step(id),
  project_id TEXT NOT NULL REFERENCES md_project(id),
  step_no INTEGER NOT NULL CHECK (step_no BETWEEN 1 AND 5),
  kind TEXT NOT NULL CHECK (kind IN ('status_change', 'assign', 'reopen')),
  from_status TEXT CHECK (from_status IS NULL OR from_status IN ('pending','in_progress','done','halted','escalated')),
  to_status TEXT CHECK (to_status IS NULL OR to_status IN ('pending','in_progress','done','halted','escalated')),
  from_assignee TEXT,
  to_assignee TEXT,
  reason TEXT,                 -- mandatory for kind='reopen' (CHECK below)
  evidence_url TEXT,           -- snapshot of evidence at the time of the event
  actor_user_id TEXT NOT NULL,
  audit_id TEXT,               -- audit_log.id written in the same transaction
  created_at TEXT NOT NULL,
  CHECK (kind <> 'reopen' OR (reason IS NOT NULL AND length(trim(reason)) >= 10)),
  CHECK (kind <> 'reopen' OR (from_status = 'done' AND to_status = 'in_progress'))
);
CREATE INDEX idx_eese_project ON entity_establishment_step_event(project_id, step_no, created_at);
CREATE INDEX idx_ees_assignee ON entity_establishment_step(assignee_user_id);
```

Notes:
- No backfill of `assignee_user_id` (existing rows show "미지정"). Backfilling from `owner` would mislabel the last recorder as the responsible person.
- Events are append-only; the repository never UPDATEs or DELETEs them. Prior evidence of a reopened step is preserved in the `reopen` event's `evidence_url` snapshot before the row is cleared (see §5.3).
- `tests/unit/migration-0140.test.ts` covers apply, CHECKs, and the header rollback.

## 4. Status model and transitions

| From \ To | in_progress | done | halted | escalated |
|---|---|---|---|---|
| pending / (no row) | PUT | PUT + evidence | PUT | PUT |
| in_progress | no-op (note update allowed) | PUT + evidence | PUT | PUT |
| halted / escalated | PUT | PUT + evidence | PUT | PUT |
| done | **reopen route only** | no-op (evidence/note edit refused; reopen first) | reopen first | reopen first |

- `pending` is never a write target (it is the implicit "no row" state); the PUT rejects it (`invalid_request`). This matches the existing UI filter.
- `done -> *` through PUT returns `409 reopen_required`. This closes today's silent-reopen gap in `upsertEstablishmentStep` and in the opportunity route's own UPDATE.
- Reopen always lands on `in_progress` (single, predictable target; the user can change status afterwards).

### 4.1 Sequence rule interaction with reopen

Current rule (ADR-0085): step 5 `done` requires steps 1–4 `done`. Steps 1–4 have no ordering among themselves.

Decision (recommended, see Q2):
- Reopening any of steps 1–4 while step 5 is `done` is **refused** with `409 dependent_step_done` unless the request sets `cascade_step5: true`, in which case step 5 is reopened in the same transaction with the same reason (two `reopen` events, two audit entries). The UI presents this as a second confirmation, never silently.
- Reopening steps 1–4 while other steps 1–4 are done has no cascade (no ordering exists among them).
- Reopening step 5 alone is always allowed.
- Effect on S11 predicate: `establishmentProgress` counts `DISTINCT step_no WHERE status='done'`, so a reopen immediately drops progress (e.g. 5/5 -> 3/5) and `complete=false`. If the project has already passed the S11 gate, the gate decision is NOT revoked (gate decisions are human records, boundary #2); instead the IC-package/process-flow surfaces show "설립 실행 재개됨" as a post-gate observation. See Q3.

## 5. API changes

### 5.1 `PUT /api/projects/:id/establishment` (status change)

Body:

```ts
{
  step_no: 1|2|3|4|5;            // required
  status: "in_progress"|"done"|"halted"|"escalated"; // required; "pending" rejected
  origin: "internal"|"joint";    // required (unchanged); must equal md_project.origin
  evidence_url?: string;         // http(s) URL, <= 2048 chars
  note?: string;                 // <= 2000 chars
  assignee_user_id?: string|null;// optional convenience; same rules as 5.2
}
```

Validation (server, in order):
1. `authenticate`; `viewer` -> 403 `role_required` (analyst+ unchanged). `visibleProject` -> 404 for non-members.
2. Project origin must be `internal`/`joint` and equal `body.origin` -> else 400 `not_applicable` ("이 프로젝트는 내부 추진·합작이 아니어서 설립 실행이 적용되지 않습니다."). Today origin is only shape-checked.
3. `status === "done"` requires a non-empty trimmed `evidence_url` or `note` -> 400 `evidence_required` (moves the client rule to the server).
4. `evidence_url`, when given, must parse as `http:`/`https:` -> 400 `invalid_request`.
5. Existing row `done` -> 409 `reopen_required`.
6. Step 5 `done` with fewer than 4 prior done -> 400 `sequence_violation` (unchanged).
7. If `assignee_user_id` present -> rules of 5.2.

Write: one transaction — row update (owner := ctx.userId, as today) + `status_change` event (+ `assign` event if changed) + audit.

Human-only boundary: add `{ method: "PUT", pattern: "/api/projects/:id/establishment", bodyField: { field: "status", value: "done" } }` to `HUMAN_ONLY_ROUTES`. Agents may still record `in_progress | halted | escalated` and notes (kill-criteria signals are useful agent output), but cannot complete. Add a matching `route` exclusion with a body qualifier in `scripts/co-newbiz/mcp-coverage.exclusions.yaml` (same pattern as the `deal-structure complete_four_axis` rule). The opportunity route `PUT /api/opportunities/:id/establishment` gets the same bodyField rule.

### 5.2 `PUT /api/projects/:id/establishment/assignee` (new)

Body: `{ step_no: 1..5, assignee_user_id: string | null, origin }`.
- analyst+; applicability check as 5.1.
- `assignee_user_id` non-null must be an active member: `SELECT 1 FROM project_member WHERE project_id=? AND user_id=? AND revoked_at IS NULL` -> else 400 `assignee_not_member`. Any `project_role` (`lead|contributor|reviewer|observer`) is eligible; see Q4.
- Allowed on a `done` step (re-assigning responsibility for a finished step does not alter its completion).
- If no row exists yet, the row is created with status `pending` (the 0059 CHECK already permits it). This is the only sanctioned `pending` write; the PUT in 5.1 still rejects `pending` as a target. `establishmentProgress` is unaffected because it counts only `done`.
- Human-only: add `{ method: "PUT", pattern: "/api/projects/:id/establishment/assignee" }` to `HUMAN_ONLY_ROUTES` + coverage exclusion. Assigning a person is an accountability act (boundary #1/#2); an agent may propose it in chat, not record it.
- Writes `assign` event + audit `entity_establishment.assign`.

### 5.3 `POST /api/projects/:id/establishment/reopen` (new)

Body: `{ step_no: 1..5, reason: string (10..2000 chars, trimmed), cascade_step5?: boolean }`.
- analyst+, member, applicability check.
- Row must exist with `status='done'` -> else 409 `not_done`.
- §4.1 dependency rule -> 409 `dependent_step_done` (response lists the dependent step numbers).
- Transaction: insert `reopen` event (snapshotting `evidence_url`), then `UPDATE ... SET status='in_progress', evidence_url=NULL, owner=ctx.userId, updated_at=now` (note kept), then audit `entity_establishment.reopen`. Clearing evidence forces fresh evidence on re-completion; the old link survives in the event.
- Human-only: `{ method: "POST", pattern: "/api/projects/:id/establishment/reopen" }` in `HUMAN_ONLY_ROUTES`; exclusion entry; additionally the existing `closure-tools` tool_pattern already rejects any future tool named `reopen_*`.
- Opportunity route: no reopen endpoint (legacy projection). Its PUT returns `409 reopen_required` on `done` rows so the two routes cannot diverge.

### 5.4 `GET /api/projects/:id/establishment`

Each step row gains `assignee_user_id`, `assignee_name` (resolved from the account table, `null` if unresolved), `assignee_active` (false if membership revoked), `last_recorded_by` (= `owner`, renamed in the response only; `owner` kept for one release for back-compat), and `reopen_count`. Add top-level `members: Array<{ user_id, name, project_role }>` (active members only) for the assignee picker, so the UI needs no extra members call. Also add `history` (latest 20 events) for the expandable row detail. The IC-package projection (`ic-package` route + `mcp/co-newbiz/tools/ic-package.ts`) adds `assignee_user_id` only.

### 5.5 Repository (`app/web-next/lib/establishment.ts`)

- `upsertEstablishmentStep` -> `changeEstablishmentStatus(projectId, input, actor)`: adds `reopen_required`, `evidence_required`, `not_applicable` results; runs in `db.transaction`; writes the event; legacy-row ADOPT logic unchanged.
- New `assignEstablishmentStep(projectId, stepNo, assigneeUserId|null, actor)`.
- New `reopenEstablishmentStep(projectId, stepNo, reason, actor, { cascadeStep5 })`.
- `listEstablishmentSteps` selects the new columns; new `listEstablishmentEvents(projectId, limit)`.
- `appendAudit` is called inside the same transaction and its id stored in `event.audit_id`.
- Legacy backlink rows (`project_id IS NULL`): assign/reopen first ADOPT the row onto the project key (same rule as today), so events always carry `project_id`.

### 5.6 MCP `record_establishment` scope impact

- Tool stays (`kind: "write"`), path unchanged. Description becomes: "Record an entity-establishment step status (in_progress / halted / escalated) with a note. Completion (done), assignment and reopen are human-only." `bodyHint` lists the allowed statuses.
- An agent call with `status: "done"` is refused by the in-process port (`isHumanOnly` bodyField match) with the standard human-only error; the agent should tell the user to complete it in the web UI.
- No new MCP tools for assign or reopen. `tests/unit/mcp-parity.test.ts` and `mcp-stage-tools.test.ts` keep passing because every new human-only route has an exclusion and a guard.
- The MCP read (`get_project_ic_package`) exposes the assignee so an agent can say who owns a step.

## 6. Audit events

`audit_log` (no detail column) — `target` becomes `"<projectId>#step<n>"` so the step is recoverable; full details live in `entity_establishment_step_event`.

| action | when | event kind |
|---|---|---|
| `entity_establishment.update` (kept) | any status change via PUT | `status_change` |
| `entity_establishment.complete` | transition into `done` (written in addition to `update`) | `status_change` |
| `entity_establishment.assign` | assignee set/changed/cleared | `assign` |
| `entity_establishment.reopen` | done -> in_progress | `reopen` (reason mandatory) |
| `entity_establishment.reopen_cascade` | step 5 reopened by a cascade | `reopen` |

Reopen also writes a `data_change`-style notification to the project lead and the step assignee via the existing notifications pipeline if available (Q6).

## 7. UI (Onyx 3.0, `IcReviewStage.tsx`)

Follows `docs/design-system/design-guide.md`; shared components only (`ColGroup`, `status-chip`, `RowMenu`, `useConfirm`, `useToast`); `bun run design:lint` must pass.

Columns (canAct && applies): `단계 | 상태 | 담당자 | 최근 기록 | 갱신 | 작업` — `estStepColPct(6)`; read-only: 5 columns.
- 담당자: assignee name or "미지정"; revoked member shows name + caption "(구성원 아님)" with a text marker, not color only.
- 최근 기록: `last_recorded_by`; evidence link caption below as today (rendered as a link with `rel="noopener noreferrer"`, only for http(s)).
- 상태 chip: unchanged; reopened steps show a caption "재개 n회".

작업 column — one primary inline button plus a `RowMenu` for secondary actions (single primary action rule):
- Not done: primary button **상태 변경** opens the inline form row. RowMenu: **담당자 지정**.
- Done: primary button hidden; text "완료됨". RowMenu: **담당자 지정**, **완료 취소(재개)** (destructive-styled item).

Inline forms (expanding `<tr>` with `colSpan` = column count, `aria-controls` kept):
- 상태 변경: `상태` select (진행 중 / 완료 / 중단 / 에스컬레이션) defaulting to the current status (or 진행 중), `증적 URL`, `비고`. The evidence label reads "증적 URL (완료 선택 시 URL 또는 비고 필수)" and becomes `aria-required` only when 완료 is selected. Submit: **상태 저장**; confirm dialog "설립 실행 {n}단계 상태 변경".
- 담당자 지정: `담당자` select from `members` (name · project role), plus "미지정". Submit: **담당자 저장**.
- 완료 취소(재개): textarea `재개 사유 (필수, 10자 이상)`, caption "재개하면 단계가 진행 중으로 돌아가고 기존 증적은 이력에만 남습니다. 완료 처리는 다시 증적과 함께 기록해야 합니다." Submit: **재개 (확인 필요)** -> confirm. On `dependent_step_done`, a second confirm: "완료확인(5단계)도 함께 재개됩니다. 계속할까요?" which resends with `cascade_step5: true`.
- Row detail: a disclosure "이력 보기" under the step title listing events (일시 · 사람 · 종류 · 사유).

Header caption replaces the current text: "담당자는 지정된 책임자이며, 최근 기록은 마지막으로 상태를 기록한 사람입니다. 완료와 재개, 담당자 지정은 사람만 기록할 수 있고 에이전트는 진행 중·중단·에스컬레이션만 기록할 수 있습니다."

Non-internal/joint projects: keep the table read-only, but replace the inline sentence with an `info` note block: "이 프로젝트의 추진 방식({origin label})에는 설립 실행 5단계가 적용되지 않습니다 (ADR-0047). 인수·지분 투자 프로젝트는 PMI 킥오프에서 통합 계획을 기록합니다." and collapse the empty table to that note (no empty 5-row table with "미지정"). Reason: the step ledger is semantically wrong for brownfield; the PMI panel is the correct surface.

Error mapping (Korean messages): `evidence_required` -> "완료 처리에는 증적 URL 또는 비고가 필요합니다."; `reopen_required` -> "완료된 단계는 먼저 재개해야 변경할 수 있습니다."; `assignee_not_member` -> "담당자는 이 프로젝트 구성원이어야 합니다."; `dependent_step_done` -> cascade confirm; `not_applicable` -> origin note.

## 8. Tests

- `tests/unit/migration-0140.test.ts` — column/table/index presence, CHECKs (reopen needs reason >=10 and done->in_progress), rollback header.
- `tests/unit/establishment-status-assignee-reopen.test.ts` (new):
  - done requires evidence (server); pending rejected; done->X via PUT = 409 `reopen_required` (project and opportunity routes).
  - assignee: active member ok; non-member / revoked member 400; viewer 403; non-member caller 404; null clears.
  - reopen: reason missing/short 400; not-done 409; step 1 while step 5 done -> 409 then cascade succeeds with two events and two audits; progress drops from 5/5; evidence snapshot kept in event, row evidence cleared; owner updated.
  - origin `acquisition` -> 400 `not_applicable`.
  - every mutation writes exactly one event per changed dimension + audit with `#step<n>` target, in one transaction (forced failure rolls back all).
- `tests/unit/mcp-stage-tools.test.ts` / `mcp-parity.test.ts` / `scripts/co-newbiz/mcp-coverage.ts` — new HUMAN_ONLY_ROUTES entries agree with exclusions; `record_establishment` with `status:"done"` is refused in-process; with `in_progress` succeeds.
- `tests/unit/viewer-write-guard.test.ts` — the two new routes are covered.
- `tests/unit/ic-package.test.ts`, `process-flow.test.ts` — progress and S11 predicate after reopen.
- Scenario `tests/scenarios/greenfield.test.ts` + `_support/ui.ts` — UI flow: 상태 변경 -> 완료 with evidence -> RowMenu 완료 취소(재개) -> 담당자 지정.
- `bun run design:lint` and the accessibility audit on the S11 stage.

## 9. ADR trigger justification

ADR required (ADR-0165) because the change hits three items on the project ADR trigger list: (a) a DB schema change (new column and table, migration 0140 — workspace schema-governance baseline); (b) MCP tool scope / human-only boundary change (new `HUMAN_ONLY_ROUTES` entries, narrowing `record_establishment`); (c) a change to the audited status semantics of a procedure-backed record (ADR-0085 sequence rule now interacts with reopen). Procedures/policies are not modified, so no policy impact analysis or `project_policy_pin` check is needed; `procedures/**/entity-establishment-execution` remains authoritative for what the steps are.

## 10. Open questions (with recommendations)

| # | Question | Recommendation |
|---|---|---|
| Q1 | Should agents be allowed to set `halted` / `escalated`? | Yes. They mirror kill-criteria actions and are signals, not decisions; only `done`, reopen and assignment are human-only. |
| Q2 | Reopening steps 1–4 while step 5 is done: refuse, cascade, or leave step 5 done? | Refuse by default, allow explicit `cascade_step5` with a second confirmation. Leaving 5 done would violate the ADR-0085 invariant. |
| Q3 | Reopen after the S11 gate was approved? | Allow; do not touch the gate record. Show a post-gate warning in the IC package and process flow; the human decides whether a new gate decision is needed. |
| Q4 | Which project roles may be assignees? | Any active member except `observer` is preferable in practice; recommend allowing `lead`/`contributor`/`reviewer` only and rejecting `observer` (`assignee_not_member` -> `assignee_role_ineligible`). Confirm with process-governance-manager. |
| Q5 | Who may reopen: any analyst+ member, or only project lead / assignee? | Any analyst+ member for MVP, because the mandatory reason + audit + notification give accountability; revisit if misuse appears. |
| Q6 | Notify on reopen? | Yes, to project lead and assignee through the existing notifications pipeline; skip if the pipeline lacks a suitable event type (do not add one in this change). |
| Q7 | Backfill `assignee_user_id` from `owner`? | No. Leave NULL ("미지정"); the owner is the last recorder, not a responsible person. |
| Q8 | Keep `owner` field name in the API? | Keep `owner` for one release alongside `last_recorded_by`, then remove after the UI and MCP consumers migrate. |
| Q9 | Should the opportunity route gain assign/reopen? | No. It is a legacy projection; it only adopts the new refusals (`reopen_required`, done human-only). |

## 11. File impact (for implementation, not changed here)

- New: `db/migrations/0140_establishment_step_assignee_reopen.sql`, `app/web-next/app/api/projects/[id]/establishment/assignee/route.ts`, `app/web-next/app/api/projects/[id]/establishment/reopen/route.ts`, `tests/unit/migration-0140.test.ts`, `tests/unit/establishment-status-assignee-reopen.test.ts`.
- Modified: `app/web-next/lib/establishment.ts`, `app/web-next/app/api/projects/[id]/establishment/route.ts`, `app/web-next/app/api/opportunities/[id]/establishment/route.ts`, `app/web-next/lib/mcp/in-process-port.ts` (HUMAN_ONLY_ROUTES + ROUTE_TABLE if needed), `scripts/co-newbiz/mcp-coverage.exclusions.yaml`, `mcp/co-newbiz/tools/stage-tools.ts` (description/bodyHint), `app/web-next/components/stages/IcReviewStage.tsx`, `app/web-next/app/api/projects/[id]/ic-package/route.ts`, `mcp/co-newbiz/tools/ic-package.ts`, `docs/db-schema.md`, API spec/openapi, `CHANGELOG.md`.
