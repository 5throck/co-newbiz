---
lang: en
lang_reason: Row 0 design dispatched in English; docs/context.md English-only zone
---

# ADR-0201: S7 deal-shape evaluation asks overall viability first, and records "no shape is viable" as one overall verdict

**Status**: Accepted (2026-11-17; owner accepted the five open-question recommendations of spec `2026-11-17-deal-shape-viability-first`)
**Date**: 2026-11-17
**Deciders**: Owner (direction decided in chat 2026-11-17: overall viability `가능 여부` first; not viable asks only a rationale; viable asks the shape(s), the intent, and a rationale per selected shape; shape and intent disabled until `가능`; the AI recommendation follows the same structure; controls on one wrapping row); PM dispatch (Row 0 non-exempt); drafted by brownfield-agent. The schema is reviewed by data-architect and landed by backend-engineer, with a dba operational review and a security-engineer review.
**Amends**: [ADR-0194](0194-kill-criteria-data-sources.md) item A (the row vocabulary of `opportunity_deal_shape_evaluation`: every row a shape with an intent, one live row per shape) and [ADR-0195](0195-deal-shape-evaluation-at-s7.md) decision 1 (the content of `brownfield-target-screening` step 3.5).
**Related**: ADR-0005 (append-only, superseded_by), ADR-0011 (MCP as a REST client), ADR-0014 (reversible migrations), ADR-0053 (#9 `mark_conditional`), ADR-0118 (proposal-only AI), ADR-0184 (next-intl ko/en), ADR-0200 (migration-number neighbour), design `2026-11-17-deal-shape-viability-first-design`

## Context

ADR-0194 item A made the S7 deal-shape evaluation a human-recorded fact. One row holds one person's verdict on one
shape (`shape` and `intent` NOT NULL, `viable` 0|1). The partial unique index `idx_odse_live` allows one live row
per (opportunity, shape). Kill criterion #9 (`deal-shape-chain:no_viable_deal_shape`) reads the count of live
viable rows. When nothing is recorded, the count is `null`, so #9 is unassessed.

The owner decided on 2026-11-17 that the biggest question is whether any deal shape is viable at all, and that it
is asked first. Under the current model, "nothing is viable" can only be expressed by recording each shape as not
viable, each with its own rationale. The owner rejected that: a rationale is written only for the overall verdict
(not viable) or for each selected viable shape. The AI recommendation (`s7.deal_shape_recommend@1`) also returns a
verdict per shape.

An ADR is required on three grounds:

- The house baseline requires one for any DB schema change. Migration 0198 rebuilds the table to relax `NOT NULL`
  and widen the `CHECK`.
- The co-newbiz trigger list covers MCP tool scope. The body and the meaning of `record_deal_shape_evaluation`
  change: a write now replaces the live set.
- A procedure step changes (`brownfield-target-screening` step 3.5, v1.1.0 → v1.2.0), which also requires a policy
  impact analysis and a `project_policy_pin` check.

## Decision

1. **Two row kinds in one table (migration `0198_deal_shape_overall_verdict.sql`, table rebuild).**
   - `shape` and `intent` become nullable.
   - A table CHECK admits either a **shape row** (shape and intent set, meaning "this shape is viable"; legacy rows
     may hold `viable = 0`) or an **overall row** (shape NULL, intent NULL, `viable = 0`, meaning "no shape is
     viable").
   - There is no overall-viable row. Overall viable means one or more live shape rows exist.
   - `idx_odse_live` gains `AND shape IS NOT NULL`. A new partial unique index, `idx_odse_live_overall` on
     `(opportunity_id) WHERE superseded_by IS NULL AND shape IS NULL`, allows one live overall row. SQLite treats
     NULLs as distinct in a unique index, so the existing index cannot cover the overall row.
   - Rows are copied verbatim, with no backfill and no conversion. A legacy set of all not-viable rows is not turned
     into an overall row, because nobody recorded that overall judgement.
2. **The live set is one overall row, or one or more shape rows, never both.** Each write replaces the whole live
   set in one transaction:
   - A not-viable write supersedes every live row.
   - A viable write inserts one viable row per selected shape. It supersedes the same-shape rows, the unselected
     shapes, legacy `viable = 0` rows and any overall row.
   - Each `superseded_by` points at a newer row (many-to-one).
   - An identical resubmission writes nothing.
   - The exclusivity spans rows, so the repository enforces it under a test, not a trigger.
   - New writes never create `viable = 0` shape rows.
3. **Attribution is unchanged.** `evaluated_by` is always the session user, and the person who submits a set is
   recorded on every row of it. Nothing is deleted; history keeps earlier authors.
4. **Kill criterion #9 reads the same SQL.** Recorded is the COUNT of live rows, and viable is SUM(viable):
   - an empty set is `null` (unassessed, never zero);
   - one overall row is present `0` (triggered, RECYCLE through `mark_conditional`);
   - N viable shape rows read N.

   `gate-snapshot.ts` and `gate-kill-deal-shape.ts` do not change. Only a person's recorded verdict can make the
   count 0.
5. **The REST contract is discriminated, with optimistic concurrency.**
   - The POST body is either `{viable: false, rationale, evidence_ref?, live_token}` or
     `{viable: true, intent, shapes: [{shape, rationale, evidence_ref?}], live_token}` (1–8 unique shapes).
   - Every shape in one viable verdict gets the same intent.
   - Shape or intent on a not-viable body is rejected (400 `invalid_request`), and so is the legacy single-shape
     body.
   - A missing or stale `live_token` returns 409 `deal_shape_stale`.
   - GET adds `verdict`, `overall`, `live_token` and `unselected_shapes`.
   - The 409 `deal_shape_not_open` guard is unchanged.
6. **MCP and the boundaries.**
   - `record_deal_shape_evaluation` takes the new body. Its description requires the agent to read
     `get_deal_shape_evaluations` first and to record only the overall verdict and the shapes the user explicitly
     gave. It must state that a viable write replaces the live set.
   - Boundary 1 holds: there is no agent account. Boundary 2 holds: verdicts are a person's act, and a
     recommendation, score or route advice is never written.
7. **The AI recommendation follows the same order (`s7.deal_shape_recommend@2`).**
   - The output is `{overall: {viable, intent, rationale}, shapes: [{shape, rationale}]}`.
   - The server clamp empties `shapes` unless `overall.viable === true`. It drops unknown or duplicate shapes and
     blank rationales.
   - `viable: true` with no valid shape becomes `null`.
   - With no shortlisted target, there is no LLM call (unchanged).
   - The recommendation stays proposal-only. Applying it fills the whole form and writes nothing.
8. **UI.**
   - The viability radio, the shape checkboxes and the intent select share one wrapping row.
   - Shape and intent stay disabled until `가능`.
   - `불가능` shows one rationale. `가능` shows one rationale per checked shape.
   - The recorded list shows the overall verdict and its rows, with legacy rows labelled.
   - One `수정` action loads the recorded set.

## Alternatives considered

- **A separate `opportunity_deal_shape_verdict` table for the overall verdict.** Rejected. Two tables would make the
  live set span two tables, and keeping them exclusive would need cross-table logic. #9 would also need a second
  query and a second meaning of "recorded". One table keeps #9's SQL unchanged.
- **Record "not viable" as one `viable = 0` row per shape, generated by the server.** Rejected. It invents eight
  verdicts the person did not write and repeats one rationale eight times. That breaks the "written feedback on
  every verdict" semantics of the registry entry.
- **An overall-viable row in addition to the shape rows.** Rejected. It is redundant with "one or more live viable
  shape rows" and could disagree with them.
- **Incremental per-shape writes (keep other live shapes).** Rejected. Under the owner's model there is no per-shape
  not-viable verdict, so a shape could never leave the live set except by an overall not-viable record. Replacing
  the set with `live_token` gives add, remove and edit without a per-shape negative.
- **Triggers enforcing the overall/shape exclusivity.** Deferred (open question Q5). They complicate the rebuild and
  its rollback, and readers stay correct even if the exclusivity were violated, because SUM(viable) counts only
  viable shape rows.

## Consequences

- **#9 is clearer.** An overall not-viable verdict triggers #9 with one written rationale. A viable verdict carries
  a rationale per viable shape. Unselected shapes are simply not selected, not "unevaluated".
- **The MCP body is a breaking change.** The panel and the MCP tool change in the same PR, and remote MCP clients
  receive the new `bodyHint`. A stale or blind write returns 409 instead of dropping someone else's verdict.
- **Legacy rows** (dev DB: 2 rows, 1 live `viable = 0`; the demo seed writes one of each) read as before until the
  next write supersedes them. The seed changes to one viable shape row.
- **Procedure, registry and flow-console wording** changes. The changes are listed in design §11: step 3.5 v1.2.0,
  the #9 registry `notes`, the S7 flow.spec comment and artefact wording, generated `docs/process-flow.md` and
  catalogs, and wiki `51-브라운필드-S7-대상-선정.md`.
- **Prompt version bump** to `s7.deal_shape_recommend@2`. The eval call-site manifest is updated.

## Deployment notes

- The rebuild is tagged `@reversible: false in the general case`, following the 0185 precedent. In-place
  ROLLBACK-SQL back to the 0188 shape is valid only while
  `SELECT COUNT(*) FROM opportunity_deal_shape_evaluation WHERE shape IS NULL` returns 0. Otherwise restore the
  pre-migration backup (`scripts/co-newbiz/restore.ts`).
- dba executes the migration and release-engineer signs off (FR-OPS-02).
- Code and migration roll back together, because the 0188-era code cannot read a NULL shape.
- Rows recorded after the migration are lost on a backup restore.
- Migration number: ADR-0200 PR-B tentatively names `0198_eval_run_item_queue_states.sql`. Whichever lands second
  takes 0199.

## Why a new ADR rather than editing ADR-0194 or ADR-0195

ADR-0194 recorded the row vocabulary, and ADR-0195 recorded what step 3.5 asks. Both are Accepted and
implemented. This decision changes the vocabulary (two row kinds), the write semantics (replace the set rather than
one shape at a time) and the question order. Editing them in place would rewrite what was decided on 2026-11-07 and
2026-11-08. Both stay Accepted for everything not changed here: the opportunity scope, the S7 placement, the
brownfield-only track, the write guard, append-only history and session attribution. Each gets an "Amended by
ADR-0201" header note when this ADR is accepted.
