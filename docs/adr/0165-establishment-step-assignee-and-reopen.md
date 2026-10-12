---
lang: ko
lang_reason: proper-noun
---

# ADR-0165 — Establishment steps gain a per-step assignee, server-enforced status rules, and an audited human-only reopen

- Status: Proposed
- Decider: Human reviewer (pending)
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

## Consequences

- The S11 progress (n/5) can decrease after a reopen; process-flow and the IC package show a post-gate warning rather than altering gate records.
- The stated agent boundary ("agents cannot complete") becomes enforced; agents keep recording kill-criteria signals (halted/escalated).
- The opportunity establishment route adopts the refusals but gains no new actions (legacy projection).
- Non-internal/joint projects show an explanatory note instead of an empty table.

## Implementation notes (backend, 2026-10-13)

- Review answers adopted: agents may set `in_progress | halted | escalated` only; any analyst+ project member may reopen; no `assignee_user_id` backfill; `owner` is kept next to `last_recorded_by` for one release; the opportunity route gains only the new refusals.
- Project roles collapsed to `lead | member` in migration 0110, so the design's "exclude observer assignees" rule has no remaining case: every active member is an eligible assignee.
- Notifications on reopen (design Q6) are not implemented: the notifications pipeline has no suitable event type, and none is added by this change.

## Verification

- `bun test tests/unit/migration-0140.test.ts tests/unit/establishment-status-assignee-reopen.test.ts tests/unit/mcp-stage-tools.test.ts tests/unit/mcp-parity.test.ts tests/unit/viewer-write-guard.test.ts tests/unit/ic-package.test.ts tests/unit/process-flow.test.ts`
- `bun scripts/co-newbiz/mcp-coverage.ts`, `bun run design:lint`, greenfield scenario suite.
