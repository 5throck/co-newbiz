---
lang: en
lang_reason: Row 0 design dispatched in English; docs/context.md English-only zone
---

# ADR-0200: S6 direct AI verdicts with recorded origin, and bulk evaluation as a queue of per-candidate items

**Status**: Accepted (2026-11-17, user approval of spec `2026-11-17-s6-direct-ai-verdict` with all eleven open questions accepted as recommended; implementation pending)
**Date**: 2026-11-17
**Deciders**: User (direction agreed in chat 2026-11-17: direct apply, confirm removed, per-item human review on the detail screen, origin safeguard; whole-list AI evaluation to run like the per-candidate one); PM dispatch (Row 0 non-exempt); schema designed by data-architect, to be landed by backend-engineer with a dba operational review and a security-engineer review
**Amends**: [ADR-0199](0199-s6-bulk-ai-eval-draft-versions.md). This ADR reverses ADR-0199 decision 6 (provisional-only drafts, the human-only confirm route) and the rejected alternative "count provisional scores in ranking or promotion until a human confirms". It also supersedes the §5 concurrency amendment of design `2026-11-16-s6-bulk-ai-eval-versioning` (the `bulk_block` / `concurrency_cap` refusals).
**Related**: ADR-0139 (S7 eval layer), ADR-0140/0141 (financial rubric, technical evidence draft), ADR-0171 (criteria reconcile, judgement invalidation), ADR-0005 (run versioning and attribution), ADR-0014 (reversible migrations), ADR-0012 (append-only audit), ADR-0187 D1 (data-confidence grades), ADR-0198 (no grade uplift on human acceptance), ADR-0184 (next-intl ko/en), design `2026-11-17-s6-direct-ai-verdict-design`

## Context

ADR-0199 stored AI evaluation results as immutable draft versions. A person then had to
confirm each version before it touched `brownfield_target_eval_state`, the table that
feeds the S6/S7 scores, the rank, and Short List completeness. In use, a 40-candidate
longlist needed up to 80 confirm clicks before any ranking signal appeared. Confirms were
also typically made per version, not per item, so the click added little review.

The user decided:

1. AI results are applied directly as item verdicts.
2. The provisional chip layer and the confirm feature (row button, dialog, route A6) are
   removed.
3. The final human judgement happens per item on the candidate detail screen, because AI
   cannot decide everything.
4. Every verdict records its origin, so unreviewed AI output is never mistaken for a
   human judgement.

In a second message on the same day, the user asked that the whole-list AI evaluation
run the same way as the per-candidate one: in parallel, with per-row progress, never
blocking and never blocked.

An ADR is required on three grounds:

- The house baseline requires one for any DB schema change. Migration 0197 adds columns;
  migration 0198 rebuilds a table to widen a CHECK.
- The co-newbiz trigger list covers schema and MCP tool scope. The MCP write tool
  `shortlist_candidate` is removed, and the meaning of `record_candidate_screening`
  writes changes.
- The decision reverses a recorded ADR-0199 decision and one of its rejected
  alternatives. That needs its own record rather than an edit of ADR-0199.

## Decision

1. **Origin on every verdict (migration `0197_eval_state_verdict_source.sql`, number
   tentative, purely additive):**
   - `brownfield_target_eval_state.verdict_source`: TEXT NOT NULL DEFAULT `'human'`,
     CHECK IN (`human`, `auto_rule`, `ai_draft`). Every existing row becomes `human`
     through the default; all current verdicts were entered or confirmed by people.
   - `source_version_id`: a nullable FK to `brownfield_eval_draft_version`. It is the
     version the current verdict rests on: the applied version for AI rows, or the
     reviewed version for human rows.
   - The 0194 column `confirmed_from_version_id` is copied into `source_version_id` and
     then frozen. No code writes it, it is kept for history and rollback, and readers
     switch to `source_version_id`.
   - `brownfield_eval_draft_run_item.apply_summary` (JSON, nullable) records per-category
     apply counts and skip reasons.
   - Two partial indexes: one on `source_version_id`, and one on
     `brownfield_target_id WHERE verdict_source <> 'human' AND status <> 'pending'`
     ("unreviewed verdicts of candidate T").
   - "Human-judged" means `verdict_source = 'human'` and nothing else. `assessed_by` on
     AI rows is the person who started or resumed the run, or the delegating user of an
     MCP or agent call. It records accountability, not authorship of the judgement. A
     person's save of an AI verdict, even with the same status, makes it `human`. No
     separate reviewed state or columns are added.
2. **Direct apply in the same transaction.** When a category step finishes, the engine
   writes the version **and** applies its proposals to `brownfield_target_eval_state` in
   one transaction:
   - financial proposals are written as `auto_rule` (deterministic rubric, grade A);
   - technical proposals are written as `ai_draft` (LLM, grade C).
   Only eligible items are written: no row, `pending`, or a non-human source. A human
   verdict is never overwritten; the rule is enforced in the SQL guard too. `확인 안됨`
   proposals write nothing on pending items. They reset an existing AI verdict to
   pending, so an AI verdict always reflects the latest successful evidence. Criteria
   retired or changed since the snapshot are skipped with a reason. ADR-0171 judgement
   invalidation runs as for a human save.
3. **Idempotent apply on an unchanged hash.** The human set inside `input_hash` and the
   payload counts `human` rows only. Applied AI verdicts therefore do not change the next
   hash. When the hash is unchanged, no version is created and no LLM is called, as in
   ADR-0199, but the apply step still runs against the latest version. Versions created
   under ADR-0199 that were never confirmed are applied the next time a person runs the
   evaluation. There is no deploy-time backfill.
4. **Writers and the human boundary.**
   - Only an authenticated human UI session may write `human`. This is the
     `humanOnlyDenied(...) === null` predicate.
   - Every other caller of `PUT .../eval-state/{criterionId}` writes `ai_draft`. That
     includes the MCP `record_candidate_screening` tool (in-process or stdio), bearer
     tokens, and agent accounts. The origin is derived server-side and never taken from
     the body.
   - A non-human caller cannot overwrite a human verdict (409 `human_verdict_locked`),
     cannot set `na`/`waived`, and cannot set `source_version_id` (403 `human_only`).
   - The confirm route A6 is removed, together with its `HUMAN_ONLY_ROUTES` entry, its
     mcp-coverage exclusion, its openapi path, and `lib/brownfield-eval-confirm.ts`.
     Nothing replaces it as a route. The engine applies verdicts, and the per-item human
     save reviews them.
5. **Decisions stay human.** Short List promotion becomes human-only: it is added to
   `HUMAN_ONLY_ROUTES`, and the MCP tool `shortlist_candidate` is removed. Gate
   decisions, committee recommendations, route and target selection, and IC were already
   human-only and are unchanged. Boundary #2 is held at the decision level. Item verdicts
   are evidence and carry a visible origin. Recording a decision is a human act.
6. **Score, rank, and promotion.**
   - `computeEvalScore` counts every source. It additionally returns the judged weight
     split by source and the count of unreviewed verdicts; `eval_summary` exposes both,
     plus `unreviewed_total`.
   - `complete` keeps its meaning (no pending item).
   - Promotion with unreviewed verdicts **warns** with counts in the existing
     confirmation and records `unreviewed={n}` in the audit. It does not block.
   - The committee brief marks an AI-filled reference score `(AI 미검토 {n})`.
   - No RAG, kill-criteria, gate-snapshot, or gate-brief computation reads eval scores
     (verified 2026-11-17). Any future consumer must take the minimum data confidence
     across the verdicts it uses (`auto_rule` A, `ai_draft` C, human = the grade of its
     version, no uplift), so unreviewed AI verdicts cap it at C (non-negotiable #4).
7. **UI.**
   - S6 shows one chip per category (score plus judged coverage) and one row marker line:
     `⚠ 일부 항목 미평가` when anything is pending, plus `AI 판정 {n}건 미검토` when
     unreviewed verdicts exist.
   - The row actions are `AI 평가` · `항목 검토` · `버전 비교`. Version comparison stays as
     an audit history with no confirm.
   - The detail evaluation tab shows an origin badge on each item (text plus icon) and a
     one-click `확인` that saves the same status as a human verdict. A per-category bulk
     accept exists only for `auto_rule` items; `ai_draft` items are reviewed one at a
     time.
   - The non-persisted S7 `AI 초안` button, its save-all, and the route
     `POST .../targets/{targetId}/eval-draft` are retired. The detail tab starts a
     single-candidate run instead, so there is one AI path.
8. **Bulk evaluation as a queue of per-candidate items** (migration
   `0198_eval_run_item_queue_states.sql`, number tentative):
   - Every candidate evaluation is one run item processed by a **process-wide worker
     pool** of `EVAL_WORKER_POOL_SIZE = 3`. A bulk start enqueues one item per eligible
     candidate; a single start enqueues one. Both share the slots, the per-row states,
     and the progress UI.
   - Starts are no longer refused because other work is running. Items wait in the
     queue.
   - Single-candidate items go ahead of queued bulk items, but one slot always stays
     available to bulk work while bulk items wait (starvation guard). Bulk runs share
     slots round-robin.
   - A candidate already queued or running elsewhere is skipped with the new item state
     `skipped_active`. A single start takes over a candidate that is merely queued in a
     bulk run.
   - Run cancel marks queued items with the new state `cancelled` and lets in-flight
     items finish their step. A per-row cancel exists for queued items.
   - Resume stays manual. A run is marked interrupted only when it is not registered with
     the in-process dispatcher and its heartbeat is stale. After a restart, queued items
     stay `pending` and resume through the existing manual action.
   - Abuse controls stay: the per-user and per-candidate cooldowns, a new
     `MAX_QUEUED_ITEMS_PER_OPPORTUNITY = 200` (429 `queue_full`), reuse of an identical
     active set, and the global DART budget reserve.
   - The run-item `state` CHECK gains `skipped_active` and `cancelled` through a table
     rebuild. No new table is added.

## Alternatives considered

- **Keep the provisional layer (ADR-0199 as built).** Rejected by the user. The ranking
  signal sat behind a per-version confirm wall, and confirms were made per version
  without per-item reading, so the human check added clicks but little review.
- **Apply directly without recording origin.** Rejected. AI-filled verdicts would become
  indistinguishable from human judgements in the score, the rank, the committee brief,
  and any future RAG input. That breaks attribution (ADR-0005) and the spirit of
  boundary #2.
- **Apply only the financial (deterministic) verdicts and keep technical ones
  provisional.** Rejected. Two models for one evaluation table means two review
  surfaces, and the technical half of the score would stay empty, which is the problem
  the user raised. Origin plus per-item review covers the LLM risk without a second
  model.
- **Auto-confirm as human (apply and mark `human`, or record the runner as the judge).**
  Rejected. It would fake a human judgement and violate boundary #2 outright.
  `assessed_by` records the runner for accountability only. The origin column says who
  judged.
- **Block Short List promotion while unreviewed AI verdicts exist.** Rejected. It
  rebuilds the confirm wall in a different place. A warning, plus a human-only promotion
  and an audit count, keeps the decision with a person who can see the gap.
- **Reuse `confirmed_from_version_id` for all origins.** Rejected. Its name would mislabel
  AI rows, and later saves would keep overwriting the history of the 0199 confirms. A new
  column with a one-time copy keeps both meanings clean.
- **Distinct `reviewed` state or `reviewed_by` columns.** Rejected. A person's save
  already makes the row `human` with the reviewer in `assessed_by`. "Accepted unchanged"
  is derivable from `source_version_id` plus the audit event. An extra state would change
  no behavior.
- **Keep bulk runs sequential with a bulk block (the #896 rule).** Rejected by the user.
  A whole-list run must behave like a per-candidate one.
- **A per-opportunity concurrency cap.** Rejected. The scarce resources (DART budget, LLM
  rate, the single SQLite writer) are process-wide, so the cap must be too.
- **A new queue table.** Rejected. The run item already is the work item. `pending`
  already means queued. Only two states are missing.

## Consequences

- **Additive migration 0197.** Existing behavior is unchanged until a run applies
  verdicts. Rollback is code first, then the ROLLBACK-SQL. Its first step resets every
  non-human verdict to pending **before** `verdict_source` is removed, so no AI verdict
  survives looking human. `source_version_id` takes part in an FK, so removing it needs a
  table rebuild or the pre-migration backup (ADR-0014). The dba runs backup-before and
  health-after (`foreign_key_check`, `integrity_check`, origin and copy counts).
- **Migration 0198 is a table rebuild** (not additive), so it is separate and ships with
  the queue work. Precondition: no active run. Rollback maps the new states, then
  rebuilds or restores.
- **The ranking fills at once.** Scores and ranks reflect AI verdicts as soon as a run
  finishes. Unreviewed counts are shown everywhere a score or rank is shown. Review moves
  to the detail screen, one item at a time.
- **Agent writes are now labelled and fenced.** Before this ADR, an agent's
  `record_candidate_screening` call produced a verdict indistinguishable from a person's
  and could overwrite one. After it, agent verdicts are `ai_draft` and cannot replace a
  human verdict.
- **The MCP surface shrinks.** `shortlist_candidate` is removed, and the confirm route was
  never exposed. An agent may still run AI evaluation and record findings, but it cannot
  promote.
- **Existing dev data.** ADR-0199 versions that were never confirmed are applied the next
  time a person runs `AI 평가`, at zero LLM cost (unchanged hash). That person is
  recorded as the accountable actor.
- **Capability judgements (ADR-0171).** An AI apply that changes a seeded technical status
  invalidates that candidate's judgement row, as a human change does. Accepting a verdict
  unchanged does not, because `evalStateHash` ignores the origin.
- **Queue.** A bulk run no longer locks the opportunity, and a single click runs almost at
  once. Total concurrency is fixed process-wide, so DART and LLM load is no higher than
  today's worst case. Queue state is durable in the run-item table. A restart loses only
  in-flight steps, which restart on manual resume.
- **Removed code.** `lib/brownfield-eval-confirm.ts`, the confirm route, the S7
  `eval-draft` route and its `AI 초안` button, `AiEvalRowConfirm`,
  the confirm hooks, the provisional chips, and the 409 `engine_active` reasons
  `bulk_block` and `concurrency_cap`.
- **Phasing.** Part A (origin and direct apply) and Part B (queue) are independent and
  ship as two PRs: PR-A (migration 0197, engine apply, MCP and bearer rule, confirm route
  and UI removal, human-only promotion, detail-tab changes), then PR-B (migration 0198,
  worker pool, API, UI). The design's §12 lists the files per PR.
- **Security review** of the origin derivation, the bearer → `ai_draft` rule, the
  human-verdict lock, and human-only promotion is required before the API phase merges.

## Why a new ADR rather than amending ADR-0199

ADR-0199 recorded "drafts are proposals that never enter scores, rank, or promotion until
a human confirms". It also recorded, as rejected, "count provisional scores in ranking or
promotion until a human confirms". This ADR adopts the substance of that rejected
alternative, with the origin safeguard ADR-0199 did not have, and it adds schema in two
new migrations. Editing ADR-0199 in place would rewrite the record of what was decided on
2026-11-16 and why. A superseding ADR keeps both decisions and their reasons auditable.
ADR-0199 stays Accepted for everything this ADR does not change: versions, the DART cache,
and incremental collection.
