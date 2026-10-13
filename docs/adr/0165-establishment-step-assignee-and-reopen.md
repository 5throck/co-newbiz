---
lang: ko
lang_reason: proper-noun
---

# ADR-0165 — Establishment steps gain a per-step assignee, server-enforced status rules, and an audited human-only reopen

- Status: Accepted (2026-10-13) with notes
- Decider: Human decider (chat instruction 2026-10-13)
- Date: 2026-10-13
- Design-of-record: [docs/designs/2026-10-13-establishment-step-assignee-reopen-design.md](../designs/2026-10-13-establishment-step-assignee-reopen-design.md)
- Related: ADR-0047 (origin applies_when), ADR-0085 (establishment record, migration 0059), ADR-0100 (project key, migration 0070), ADR-0154 §5 (human-only mutations), ADR-0014 (additive migrations), ADR-0163 (stop-on-error migration runner)

## Context

The S11 entity-establishment table only offers "증적과 함께 완료". `owner` is overwritten by every writer, so it records the last recorder rather than a responsible person. A done step is locked in the UI but can be silently reverted through a plain PUT, with no reason and no step-level audit. Evidence-for-done is checked only in the client. The UI claims agents cannot complete a step, but `PUT /api/projects/:id/establishment` is not in `HUMAN_ONLY_ROUTES` and MCP `record_establishment` can write `done`.

## Decision

1. Migration 0140 (additive): `entity_establishment_step` gains `assignee_user_id`, `assigned_by`, `assigned_at`; new append-only `entity_establishment_step_event` (kind `status_change | assign | reopen`, from/to status and assignee, mandatory reason for reopen enforced by CHECK, evidence snapshot, actor, audit id). No backfill; `owner` keeps meaning "last recorder".
2. `PUT /establishment` becomes a status change: targets `in_progress | done | halted | escalated`; `done` requires evidence (URL or note) server-side; a `done` row cannot be changed by PUT (`409 reopen_required`); project origin must be `internal`/`joint` and match the body.
3. New `PUT /establishment/assignee`: assignee must be an active project member (`revoked_at IS NULL`); analyst+.
4. New `POST /establishment/reopen`: done -> in_progress with a mandatory reason (>= 10 chars); row evidence is cleared and preserved in the event. Reopening steps 1–4 while step 5 is done is refused unless `cascade_step5: true`, which reopens step 5 in the same transaction. Gate decisions are never revoked automatically.
5. Human-only boundary: `HUMAN_ONLY_ROUTES` gains `PUT /api/projects/:id/establishment` (bodyField `status=done`), the same for the opportunity route, `PUT /api/projects/:id/establishment/assignee`, and `POST /api/projects/:id/establishment/reopen`, each with a matching `mcp-coverage.exclusions.yaml` entry. MCP `record_establishment` remains, narrowed to `in_progress | halted | escalated`; no new tools.
6. Audit: `entity_establishment.update | complete | assign | reopen | reopen_cascade`, target `<projectId>#step<n>`, written in the same transaction as the event row.
7. Step 5 done requires steps 1-4 done, enforced server-side in `changeEstablishmentStatus`; reopening any of steps 1-4 while step 5 is done needs `cascade_step5`.
8. A reopen notification is out of scope: the event table and the audit log cover it.
9. The post-gate reopen warning is derived from the event history (UI and the investment committee package), not from a server flag. Promote it to a server field `reopened_after_gate` only if more than one consumer needs it.
10. The `owner` column coexists with `last_recorded_by` until a named removal date. Removal target: next minor release after 2026-10-13; tracking owner: platform-lead (placeholder, the human decider may change it).
11. Known limits: the reopen audit does not record the call path (UI, API or MCP), and `HUMAN_ONLY_ROUTES` is enforced at the MCP port only, not on the HTTP API.

## Consequences

- The S11 progress (n/5) can decrease after a reopen; process-flow and the IC package show a post-gate warning rather than altering gate records.
- The stated agent boundary ("agents cannot complete") becomes enforced; agents keep recording kill-criteria signals (halted/escalated).
- The opportunity establishment route adopts the refusals but gains no new actions (legacy projection).
- Non-internal/joint projects show an explanatory note instead of an empty table.

## Implementation notes (backend, 2026-10-13)

- Review answers adopted: agents may set `in_progress | halted | escalated` only; any analyst+ project member may reopen; no `assignee_user_id` backfill; `owner` is kept next to `last_recorded_by` for one release; the opportunity route gains only the new refusals.
- Project roles collapsed to `lead | member` in migration 0110, so the design's "exclude observer assignees" rule has no remaining case: every active member is an eligible assignee.
- Notifications on reopen (design Q6) are not implemented: the notifications pipeline has no suitable event type, and none is added by this change.

## Acceptance record

- Approver: the human decider (user, account techcross), chat instruction on 2026-10-13: "ADR-0164·0165 승인해". Recorded separately from ADR-0164 (DEC-20261013-07).
- Basis: chat approval after the readiness review of the 2026-10-13 residual-items meeting (`memory/meeting-2026-10-13-residual-items.md`). Acceptance is by chat instruction; no per-item checklist was recorded. This record does not claim the approver read specific commits or ticked individual items.
- Accepted deviations and closure owners (all owner: platform-lead):
  1. Reopen notification is not implemented; follow-up, needs a notification event type.
  2. The post-gate warning is derived display only; promote it to a server field `reopened_after_gate` when a second consumer appears.
  3. The REST/MCP call path is not recorded in the actor row, and `HUMAN_ONLY_ROUTES` is enforced at the MCP port only; follow-up.
  4. Owner column removal target: the next minor release after 2026-10-13.
  5. The observer-role rule is moot after migration 0110.
- Withdrawal conditions (dissent seat): if the post-gate warning is consumed by a second surface, a server flag and a notification are required; absent them, the "with notes" acceptance for item 2 and item 1 should be withdrawn and re-decided.

## Addendum - follow-up implementation (2026-10-13)

The human decider asked platform-lead to close deviations 1-3 of the acceptance record. The status of this ADR is unchanged. Recorded in DEC-20261013-09.

- **Deviation 1 (reopen notification) - implemented.** Migration 0141 rebuilds `notification` (0072 pattern) to allow two new `trigger_type` values, `establishment_step_reopened` (severity `warning`) and `establishment_step_assigned` (severity `info`), and adds a nullable `dedupe_key` with a partial UNIQUE index on `(user_id, dedupe_key)`. A reopen notifies the project lead(s) and the assignee of each reopened step, never the actor; a cascade is one act and produces one notification per recipient. An assignment notifies the new assignee only. Both are written in the same transaction as the event and audit rows, with `INSERT OR IGNORE` keyed by `establishment:<first event id>`. They surface in `GET /api/notifications`, the MCP `list_notifications` relay, the bell and the inbox (the inbox links to the payload `href`).
- **Deviation 2 (server field) - implemented.** `reopenedAfterGate(projectId)` in `lib/establishment.ts` is the single derivation: true when a reopen event is newer than the newest valid GO among the `dd`, `entity_ic` and `group_ic` gates, where a gate counts only if its current verdict (latest decision that is not stale-marked, ADR-0157) is GO. It is returned as `reopened_after_gate` (+ `reopened_after_gate_detail`) by `GET /api/projects/:id/establishment` and the IC package `establishment` block, and as `reopenedAfterGate` on project process evaluations. `EstablishmentPanel` and `IcReviewStage` render the server field; the browser no longer derives it. The withdrawal condition recorded above (a second consumer without a server flag and a notification) is therefore met.
- **Deviation 3 (call path, human-only on REST) - implemented.** `entity_establishment_step_event.via` (`ui` cookie session, `api` bearer token, `mcp` in-process; `unknown` for rows written before 0141 and for callers that do not state it) is set from `callPathOf(ctx)` in `lib/auth.ts` for status change, assignment and reopen. `audit_log` has no detail column, so the audit target becomes `<projectId>#step<n>@<via>`. Investigation result for the second half: `HUMAN_ONLY_ROUTES` was enforced only inside `InProcessRestPort`, while `authenticate()` accepts personal bearer tokens (`validateApiToken`) on the plain REST routes, so a bearer caller could complete a step, assign and reopen directly. The three mutations now follow the existing human-only route convention (`humanOnlyDenied`: cookie session + CSRF, not the in-process principal, not an `AGENT_KEYS` account; otherwise 403 `human_only`), including `PUT /api/opportunities/:id/establishment` with `status=done`. Bearer callers can still record `in_progress`, `halted` and `escalated`.
- Deviations 4 and 5 are unchanged.
- Tests: `tests/unit/migration-0141.test.ts`, `tests/unit/establishment-followup.test.ts`, `tests/unit/establishment-view.test.ts`; `tests/unit/establishment-status-assignee-reopen.test.ts` matches the new audit target.

## Verification

- `bun test tests/unit/migration-0140.test.ts tests/unit/migration-0141.test.ts tests/unit/establishment-followup.test.ts tests/unit/establishment-status-assignee-reopen.test.ts tests/unit/mcp-stage-tools.test.ts tests/unit/mcp-parity.test.ts tests/unit/viewer-write-guard.test.ts tests/unit/ic-package.test.ts tests/unit/process-flow.test.ts`
- `bun scripts/co-newbiz/mcp-coverage.ts`, `bun run design:lint`, greenfield scenario suite.
