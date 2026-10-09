# ADR-0157 — Optional per-target DD on shortlisted targets

- Status: Accepted (2026-10-09, approved by the user in chat)
- Date: 2026-10-09
- Deciders: Human reviewer (user, approved in chat). Drafted by platform-lead. AI review alone cannot accept this ADR (DB schema change).
- Design of record: `docs/designs/2026-10-09-optional-per-target-dd-design.md`
- Amends: ADR-0143 §5 ("S9 narrows to the selected target")
- Related: ADR-0099 (S9 completion predicate), ADR-0148 (unassessed standard items), ADR-0156 (per-target WACC, `TargetSelector`), ADR-0053 (human decision records), ADR-0154 (proposal-only MCP decisions)

## Context

ADR-0143 §5 narrowed brownfield S9 to the ONE target a human selected at S8
(flow.spec v2.5.0, `선정 대상 DD`) to keep DD cost proportional to one
target. In practice reviewers sometimes want a limited DD on a runner-up
shortlisted target — to test the S8 ranking against facts, or to hedge a
close call — without moving the selection point or doubling mandatory work.

DD state today is keyed by project only: `project_checklist_item_state`
(UNIQUE `(project_id, checklist_id, item_id)`), `project_checklist_item_custom`,
`dd_finding` and `waiver` all carry `project_id` and nothing else.
`ddCompletionSummary(projectId)` feeds the S9 predicate and the `dd` gate.

## Decision

1. **The selected target stays the gate subject.** S9 completion and the
   `dd` gate verdict are judged only on the target recorded by the latest
   `process_run` `s8_target_select` row (ADR-0143 §4). The default DD scope
   is unchanged: selected target only.

2. **Additional targets are optional comparison evidence.** A human MAY open
   DD on another shortlisted target of the same project. Such targets get
   their own checklist judgements, custom items, waivers and `dd_finding`
   rows, scoped per target. Nothing recorded on a non-selected target can
   satisfy, block or waive anything for the selected target.

3. **Schema: an additive `target_id` axis (migration 0132).** A nullable
   `target_id` (FK `brownfield_target.id`) is added to
   `project_checklist_item_state`, `project_checklist_item_custom`,
   `dd_finding` and `waiver`. `NULL` means "the selected target, or the
   legacy single DD subject" — every existing row is grandfathered without
   backfill. The state table's inline UNIQUE constraint is replaced by a
   unique index on `(project_id, COALESCE(target_id, ''), checklist_id,
   item_id)`; because SQLite cannot drop an inline constraint, this table is
   rebuilt with all rows copied verbatim (no data change). Greenfield never
   writes a non-NULL `target_id`.

4. **Opening DD on a target is an explicit, logged human action.** A new
   `dd_target_open` table records `(project_id, target_id, opened_by,
   opened_at, rationale)`; it is written only by an authenticated human
   route. Writes with a non-NULL `target_id` are rejected unless an open
   row exists and the target is a shortlisted `brownfield_target` of the
   project's source opportunity. This is the cost-control point: DD work on
   a second target cannot start implicitly, from an agent, or from a bulk
   tailor call.

5. **Re-selection re-points the gate, keeps the evidence.** When S8
   selection changes from target A to B, a single transaction stamps every
   `target_id IS NULL` DD row with A's id (materialising A as an ordinary
   per-target DD), auto-records an open row for A, and the gate reads B.
   B's previously opened DD (if any) becomes the gate subject as-is; if B
   had none, S9 starts from B's empty checklist. No row is deleted.

6. **Boundary #2 holds.** Agents may draft findings and judgements for an
   opened target and may *propose* opening DD (`propose_approval`), but the
   open action, the selection, waiver approval and the `dd` gate verdict
   remain human acts. Comparison views carry no "PASS" stamp and label
   non-selected targets `비교 근거` (comparison evidence).

7. **Spec v2.6.0 is a text change.** S9 objective and outputs mention the
   optional per-target DD; completion criteria stay bound to the selected
   target. No `procedures/**` or `policies/**` change.

## Alternatives considered

- **Parallel mandatory DD on top-N** (ADR-0143's recorded alternative) —
  rejected again: doubles mandatory cost and moves selection to IC.
- **Separate per-target DD tables** — rejected: duplicates every reader and
  the waiver linkage; an additive column keeps one code path.
- **NULL always meaning "selected" with no stamping on re-selection** —
  rejected: rows would silently change subject when the selection changes.

## Consequences

- Existing projects behave identically: all rows are NULL, no target is
  opened, readers filter `target_id IS NULL` for the gate.
- `ddCompletionSummary` gains an optional target scope; the gate path always
  calls it for the selected target.
- DD cost becomes visible: every additional target has an attributable open
  record with a rationale.
- Risk accepted: reviewers may over-read a partially completed comparison
  DD; the UI shows per-target completion with explicit "could not verify"
  counts rather than a verdict.
