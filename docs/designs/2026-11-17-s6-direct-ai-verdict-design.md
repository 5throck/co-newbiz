# S6 Direct AI Verdicts with Recorded Origin, and Bulk Evaluation as a Queue of Per-Candidate Items

- Spec ID: `2026-11-17-s6-direct-ai-verdict`
- Date: 2026-11-17
- Status: approved (user approval 2026-11-17; all eleven §13 questions accepted as
  recommended). Not yet implemented.
- Author: data-architect (Row 0 design, PM dispatch)
- Registration: registered in `docs/specs/registry.json` as
  `2026-11-17-s6-direct-ai-verdict`, status `approved`. `/sync` is run by PM at delivery.
- ADR: [ADR-0200](../adr/0200-s6-direct-ai-verdicts-with-origin.md) (Accepted
  2026-11-17, implementation pending). It is
  required because this design changes the DB schema (workspace schema-governance
  baseline, `docs/context.md`) and reverses an alternative that ADR-0199 rejected.
- Amends: design `2026-11-16-s6-bulk-ai-eval-versioning` and
  [ADR-0199](../adr/0199-s6-bulk-ai-eval-draft-versions.md) (decision 6 "Human boundary",
  the confirm route A6, the provisional chip layer, and the §5 concurrency amendment).
- Builds on: ADR-0139 (S7 eval layer), ADR-0140/0141 (financial rubric, technical
  evidence draft), ADR-0171 (criteria reconcile, judgement invalidation), ADR-0005 (run
  versioning and attribution), ADR-0014 (reversible migrations), ADR-0012 (append-only
  audit), ADR-0187 D1 (data-confidence grades), ADR-0198 (no grade uplift on human
  acceptance), ADR-0184 (next-intl ko/en).

This design has two independent parts that one approval covers:

- **Part A — Direct AI verdicts with origin** (§1–§9). AI results become the candidate's
  item verdicts at once. Every verdict records where it came from.
- **Part B — Bulk evaluation as a queue of per-candidate items** (§10). The whole-list
  `AI 평가` runs exactly like the per-candidate one: in parallel, with per-row progress,
  never blocking and never blocked.

They touch different code and different migrations. They ship as two PRs: PR-A
(Part A) first, then PR-B (Part B) (§12).

---

## Part A — Direct AI verdicts with origin

## 1. Decision being designed

The user decided in chat (2026-11-17):

1. AI evaluation results are applied **directly** as the candidate's item verdicts. These
   are the `brownfield_target_eval_state` rows that feed scores and the rank. They no
   longer wait as provisional drafts for a person to confirm.
2. The provisional chip layer goes away. The confirm feature also goes away: the row
   confirm button, its dialog, and the confirm route A6.
3. The final human judgement happens **per item on the candidate detail screen**,
   because AI cannot decide everything.
4. Safeguard (from the PM proposal, accepted): every item verdict stores its **origin**,
   so unreviewed AI output is never mistaken for a human judgement.

Why the old model failed in practice: under ADR-0199 a 40-candidate longlist produced
up to 80 draft versions that each needed a confirm click before any score or rank
appeared. The real ranking signal sat behind a wall of clicks. The confirm click also
added little review value, because the person usually confirmed a whole version without
reading each item. The user prefers a ranking that fills at once, plus honest labels
showing what a person has not looked at yet.

## 2. Goals and non-goals

### Goals

- G1. A completed AI category step writes its proposals into
  `brownfield_target_eval_state` **in the same transaction** as the version row (or as
  the `unchanged` decision).
- G2. Each verdict carries `verdict_source` ∈ {`human`, `auto_rule`, `ai_draft`} and
  `source_version_id`. "Human-judged" means `verdict_source = 'human'` and nothing else.
- G3. A human verdict is never overwritten by any non-human writer: not the engine, not
  MCP, not an agent.
- G4. Scores and the rank count every source. Wherever a score or rank is shown, the
  number of unreviewed (non-human) verdicts is shown next to it.
- G5. A person reviews per item on the candidate detail evaluation tab. Saving a verdict
  as a person makes it `human`, whether or not the status changed.
- G6. Short List promotion and every gate decision stay human acts.

### Non-goals

- Changing rubric thresholds, criteria seeding, or the `computeEvalScore` arithmetic.
- Raising any evidence grade on human review (ADR-0198 stays).
- A longlist-wide "accept all AI verdicts" action (the ADR-0199 Q6 decision stands), and
  any bulk accept of `ai_draft` verdicts (Q1: bulk accept exists only for `auto_rule`
  items of one category on the detail screen, §7.2).
- Retention of versions (still the ADR-0199 Q7 follow-up).

## 3. Data model

### 3.1 Layer placement

| Object | Layer | Change |
|---|---|---|
| `brownfield_target_eval_state.verdict_source` (new) | fact | Origin of the current verdict. Closed enumeration enforced by CHECK. |
| `brownfield_target_eval_state.source_version_id` (new) | fact | FK to the immutable draft version that the current verdict rests on. |
| `brownfield_target_eval_state.confirmed_from_version_id` (0194) | fact | **Frozen legacy column.** It gets no new writes after 0197. Its values are copied into `source_version_id` and kept for history and rollback. |
| `brownfield_eval_draft_run_item.apply_summary` (new) | fact (operational) | Per-category apply counts and skip reasons for the progress panel and tests. |
| `brownfield_eval_draft_version` (0194) | fact (immutable) | Unchanged. It remains the attribution unit (ADR-0005). |

No `md_*` change. `verdict_source` is a closed, three-value code system. It is enforced by
CHECK like the status column in 0104, so no free-text code column is introduced
(FR-DATA-02/04).

### 3.2 Column semantics

**`verdict_source`**

| Value | Written by | Meaning |
|---|---|---|
| `human` | An authenticated human UI session (cookie session, not an agent account, not the in-process MCP principal: the `humanOnlyDenied(...) === null` predicate in `lib/auth.ts`) | A person recorded or reviewed this verdict. |
| `auto_rule` | The run engine, financial category | A deterministic rubric over filed DART facts (`draftFinancialVerdict`). The version has evidence grade `A`. |
| `ai_draft` | The run engine, technical category; **any** non-human caller of `PUT .../eval-state/{criterionId}` (MCP `record_candidate_screening`, the stdio MCP REST client, bearer tokens, agent accounts) | An LLM or agent proposal that no person has reviewed. Technical versions have grade `C`. |

- **`status = 'pending'` rows.** For these rows `verdict_source` only records who last
  touched the row. Every counter in §5 counts **non-pending** rows only.
- **"Unreviewed verdict"** means `status <> 'pending' AND verdict_source <> 'human'`.

**`source_version_id`.** This is the draft version that the current verdict rests on:

- `auto_rule` and `ai_draft` rows written by the engine: the version whose proposal was
  applied. It is always non-null for `auto_rule`. It is null for `ai_draft` only when an
  MCP or agent caller wrote the verdict directly (there is no version to point at).
- `human` rows: the version that the person reviewed, if any. This replaces the 0199 A7
  semantics of `confirmed_from_version_id`. A person who reviews an AI verdict keeps the
  link. A person who enters a verdict with no draft basis writes null.

**`assessed_by` / `assessed_at`.**

- For `auto_rule` and `ai_draft` rows written by the engine, `assessed_by` is the person
  who started the run, or the person who resumed it. That is the engine's existing
  `actor = resumed_by ?? started_by` (`lib/brownfield-eval-bulk.ts`).
- For an MCP or agent write, it is the delegating user (`auth.userId`). Agents have no
  accounts (boundary #1).
- This keeps accountability: a person caused every row. `verdict_source` tells the
  origin. `assessed_by` alone never means "a person judged this item".

**Review without a status change.** No separate `reviewed_by` / `reviewed_at` columns are
added. When a person saves a verdict, the row becomes `human` with `assessed_by` = that
person and `assessed_at` = now. This holds even when the status equals the AI proposal.
"Reviewed and accepted unchanged" can still be read from the data:
`verdict_source = 'human'`, `source_version_id` is non-null, and the status equals that
version's proposal. The audit event `target_eval.ai_verdict.review` (§4.4) also records
it. A distinct state would add a fourth origin value that changes no behavior, so it is
rejected.

**`confirmed_from_version_id` (0194).** It is superseded by `source_version_id`, not
reused. Its name says "confirmed", which would mislabel `ai_draft` rows. The migration
copies its values into `source_version_id`. After that the column is frozen: no code
writes it, and readers switch to `source_version_id`. It stays in place for three
reasons:

1. SQLite cannot drop a column that takes part in a foreign key without rebuilding the
   table.
2. It is the historical record of the 0199 confirms.
3. It keeps a rollback to the 0199 code readable.

`upsertEvalState` stops touching it, so later saves no longer clear it.

### 3.3 Migration `0197_eval_state_verdict_source.sql` (number tentative)

The next free number on `main` is `0197` (last applied:
`0196_brownfield_eval_run_concurrency.sql`). Renumber at implementation if another
branch lands first.

```sql
-- @reversible: true (additive: three nullable/defaulted columns, two partial indexes; the
-- only row write is the copy of confirmed_from_version_id into the new source_version_id.
-- Every existing verdict becomes 'human' through the column DEFAULT: all current verdicts
-- were entered or confirmed by people (ADR-0199 confirm was human-only).
-- Rollback (ADR-0014): take the pre-migration backup, then run the ROLLBACK-SQL block.
-- Step 1 is mandatory and runs BEFORE the column is removed: once verdict_source is gone,
-- an AI verdict would read as a human one. Non-human verdicts are reset to pending; they
-- remain reproducible from their immutable versions and the audit log.)
-- ROLLBACK-SQL-BEGIN
--   UPDATE brownfield_target_eval_state
--      SET status = 'pending', note = NULL, evidence_ref = NULL
--    WHERE verdict_source <> 'human' AND status <> 'pending';
--   DROP INDEX idx_bf_target_eval_state_unreviewed;
--   DROP INDEX idx_bf_target_eval_state_source_version;
--   ALTER TABLE brownfield_eval_draft_run_item DROP COLUMN apply_summary;
--   ALTER TABLE brownfield_target_eval_state DROP COLUMN verdict_source;
--   (source_version_id takes part in a FOREIGN KEY, so SQLite cannot DROP COLUMN it:
--    rebuild brownfield_target_eval_state without it (0104 create-copy-rename pattern)
--    or restore the pre-migration backup.)
-- ROLLBACK-SQL-END
--
-- ADR-0200 (spec 2026-11-17-s6-direct-ai-verdict): AI evaluation results are applied
-- directly as item verdicts; every verdict records its origin.

ALTER TABLE brownfield_target_eval_state
  ADD COLUMN verdict_source TEXT NOT NULL DEFAULT 'human'
  CHECK (verdict_source IN ('human', 'auto_rule', 'ai_draft'));

ALTER TABLE brownfield_target_eval_state
  ADD COLUMN source_version_id TEXT REFERENCES brownfield_eval_draft_version(id);

-- Backfill: one forward link for every origin; the 0194 column is frozen from here on.
UPDATE brownfield_target_eval_state
   SET source_version_id = confirmed_from_version_id
 WHERE confirmed_from_version_id IS NOT NULL;

-- Pattern: "verdicts resting on version V" (version history panel `적용 {k}건`,
-- audit lookup). Replaces idx_bf_target_eval_state_from_version for new reads; the 0194
-- index stays for the frozen column.
CREATE INDEX idx_bf_target_eval_state_source_version
  ON brownfield_target_eval_state(source_version_id)
  WHERE source_version_id IS NOT NULL;

-- Pattern: "unreviewed AI verdicts of candidate T" (longlist marker, promote warning,
-- committee brief). Partial, so it holds only the rows a person still has to look at.
CREATE INDEX idx_bf_target_eval_state_unreviewed
  ON brownfield_target_eval_state(brownfield_target_id)
  WHERE verdict_source <> 'human' AND status <> 'pending';

ALTER TABLE brownfield_eval_draft_run_item
  ADD COLUMN apply_summary TEXT
  CHECK (apply_summary IS NULL OR json_valid(apply_summary) = 1);
  -- {"financial": {"applied": 4, "kept_human": 2, "cleared": 0,
  --                "skipped": [{"criterion_id": "...", "reason": "criterion_changed"}]},
  --  "technical": {...}}
```

Notes:

- **Portability (ADR-0002).** `ADD COLUMN` with a constant default plus a self-referencing
  CHECK, a nullable FK column, and partial indexes are all portable. `json_valid` follows
  the 0150/0193/0194 precedent.
- **Money (ADR-0061).** No monetary column.
- **Invariant not expressible by `ALTER`.** "`auto_rule` ⇒ `source_version_id` NOT NULL"
  would need a table CHECK, and that needs a table rebuild. It is enforced in the single
  write path (`applyVersionToEvalState`, §4.2) and asserted by test TA3.
- **Health-after (dba).** Run `PRAGMA foreign_key_check` (0 rows) and
  `PRAGMA integrity_check` (ok). Then check:
  - `SELECT COUNT(*) FROM brownfield_target_eval_state WHERE verdict_source <> 'human'` = 0;
  - `SELECT COUNT(*) ... WHERE confirmed_from_version_id IS NOT source_version_id` = 0.

## 4. Writing rules

### 4.1 Who may write which origin

| Writer | Path | Origin written | May overwrite a `human` verdict? |
|---|---|---|---|
| Run engine, financial step | `applyVersionToEvalState` inside `commitCategoryDraft` | `auto_rule` | **Never** |
| Run engine, technical step | same | `ai_draft` | **Never** |
| Human UI session | `PUT .../eval-state/{criterionId}` with `humanOnlyDenied(auth) === null` | `human` | Yes (a person may revise a person) |
| MCP `record_candidate_screening`, stdio MCP REST client, bearer token, agent account | same `PUT`, any caller for which `humanOnlyDenied` returns a response | `ai_draft` | **Never**: 409 `human_verdict_locked` |

Rules for non-human callers of the `PUT`:

1. The stored origin is always `ai_draft`. The server derives it from the caller; it is
   never taken from the request body. A body field `verdict_source` is rejected with 400.
2. If the current row is `human` and non-pending, the write is refused with
   409 `human_verdict_locked`. Today an agent can silently replace a person's verdict.
   That gap closes here.
3. `na` and `waived` are refused with 403 `human_only`. Excluding a criterion from the
   score changes the denominator. That is a judgement, not a finding.
4. `source_version_id` (and the deprecated alias `confirmed_from_version_id`) stays
   refused with 403 `human_only`. This is the 0199 A7 rule, unchanged.

**Bearer tokens.** A personal API token used by a person's own script is also stored as
`ai_draft`. The server cannot tell a script from the stdio MCP server, which uses the same
bearer path (`callPathOf` returns `api` for both). The conservative reading is the safe
one: the person can review the item in the UI in one save (Q5, accepted 2026-11-17).

### 4.2 Engine apply step

There is one function, `applyVersionToEvalState(db, { version, actor, now })`, in
`lib/brownfield-eval-apply.ts`. The logic moves out of the retired
`lib/brownfield-eval-confirm.ts`, which is deleted. It runs **inside the same
transaction** as the version insert or the `unchanged` decision in `commitCategoryDraft`
(`db/repositories/brownfield-eval-draft.repository.ts`). Either the version and its
verdicts both land, or neither does.

For each item in `version.payload.items`:

| Current state of the criterion | Proposal | Action | Recorded as |
|---|---|---|---|
| Criterion deleted or retired (ADR-0171) since the snapshot | any | skip | `criterion_retired` |
| Criterion `rubric_json` (financial) or label (technical) differs from `criteria_snapshot` | any | skip | `criterion_changed` |
| `human`, non-pending | any | **skip, never written** | `kept_human` count |
| no row, or `pending` (any source) | `pass` / `partial` / `fail` | write | `applied` |
| no row, or `pending` | `null` (`확인 안됨`) | not written; stays pending | `unverified` count |
| `auto_rule` / `ai_draft`, non-pending | `pass` / `partial` / `fail` | overwrite with the new proposal | `applied` |
| `auto_rule` / `ai_draft`, non-pending | `null` | **reset to `pending`** (source and `source_version_id` = this version; note = the `확인 안됨` reason) | `cleared` (Q2) |

The write is:

```sql
UPDATE brownfield_target_eval_state
   SET status = ?, note = ?, evidence_ref = ?, assessed_by = ?, assessed_at = ?,
       verdict_source = ?, source_version_id = ?
 WHERE brownfield_target_id = ? AND criterion_id = ?
   AND (status = 'pending' OR verdict_source <> 'human')
```

or an `INSERT` when no row exists. Field values:

- `note` = the proposal note.
- `evidence_ref` = the version id (the A6 precedent).
- `verdict_source` = `auto_rule` for the financial category, `ai_draft` for technical.
- `assessed_by` = the run actor.

The guard is repeated in SQL even though the rows were read in the same transaction, so a
future refactor that splits the read cannot break the rule.

After the writes, `invalidateTargetJudgements` runs once for the candidate under the run
actor. A changed verdict on a seeded technical criterion invalidates only this
candidate's capability judgement for that row, the same as the single `PUT` path
(ADR-0171).

`apply_summary` on the run item records `applied`, `kept_human`, `unverified`, `cleared`,
and the skip list for each category.

**Why the "reset to pending" row.** An AI verdict always mirrors the latest version that
wrote it. If newer evidence can no longer support a proposal, keeping the old AI verdict
would show a score that no current version backs. Replace-on-success (ADR-0199 decision 2)
already guarantees that a failed LLM call writes no version. So a `null` here is the
model's actual answer on fresh evidence, not a glitch. A human verdict is never cleared.

### 4.3 The "eligible set", the input hash, and idempotent apply with an unchanged hash

The engine drafts only **eligible** criteria. This replaces "pending" in `needsOf`,
`humanItems`, and `provisionalScore` (`lib/brownfield-eval-bulk.ts`):

- **eligible** = no row, or `status = 'pending'`, or `verdict_source <> 'human'`;
- **human set** (payload `human_items`, and the `human` component of `input_hash`) = rows
  with `verdict_source = 'human'` and `status <> 'pending'`. Nothing else.

This matters. If applied AI verdicts counted as "judged", every apply would change the
human set. The next run would then see a new `input_hash`, mint a new version, and pay
for an LLM call over identical evidence. That is exactly the noise ADR-0199 removed. With
the human-only set, a re-run over the same evidence keeps the same hash.

The hash structure stays at `v: 1`. On existing data no `ai_draft` or `auto_rule` rows
exist, so the human set is identical to today's "non-pending" set and existing hashes
remain valid. Payload `schema` stays `1`. Its `items` now means "eligible at snapshot
time", which equals "pending" for every version written before 0197.

**Unchanged hash → apply anyway.** When `input_hash` equals the latest version's hash, no
version is created and no LLM call is made (unchanged from ADR-0199). The apply step
**still runs against that latest version**, in the same transaction that records the
`unchanged` outcome. It is idempotent:

- Applying the same proposals to rows that already hold them rewrites identical status,
  note, and `evidence_ref` (`assessed_at` refreshes; that is acceptable and auditable).
- Rows a person has judged since are skipped by the guard.

This covers the existing dev data. Versions created under ADR-0199 whose proposals were
never confirmed get applied the first time a person runs `AI 평가` again, at zero LLM
cost. No automatic backfill runs at deploy (Q6): the apply is attributed to the person
who starts the run.

**Criteria changes between version and apply.** On the `versioned` path the snapshot and
the apply are minutes apart (the LLM call). On the `unchanged` path they can be weeks
apart, although a criteria change would normally change the hash. Both paths compare each
item against the live criterion and skip it with `criterion_changed` or
`criterion_retired` (§4.2). They never write a verdict against a criterion definition
that the version did not see.

**`nothing_pending` outcome.** It is renamed in meaning to "nothing eligible": every
criterion of the category is human-judged. The stored value stays `nothing_pending` to
avoid a CHECK rebuild of the run-item table in this migration. The UI label is
`사람 판정 완료`.

### 4.4 Audit events (append-only, ADR-0012)

| Action | Target | When |
|---|---|---|
| `target_eval.ai_verdict.apply` | `{oppId}:{targetId}:{category}:v{n}:run={runId}:applied={a}:kept_human={h}:cleared={c}:skipped={s}` | Every apply, both the `versioned` and the `unchanged` path |
| `target_eval.ai_verdict.review` | `{oppId}:{targetId}:{criterionId}:from={source}:version={id}:changed={0\|1}` | A human save over a non-human verdict |
| `target_eval.agent_verdict` | `{oppId}:{targetId}:{criterionId}:via={callPath}` | A non-human `PUT` (stored as `ai_draft`) |
| `target_eval.agent_verdict.refused` | `{oppId}:{targetId}:{criterionId}:reason=human_verdict_locked` | A refused non-human write |

`target_eval.confirm_from_version` is no longer emitted. Its history stays in the log.
`target_eval.edit_from_version` is replaced by `.ai_verdict.review`.

## 5. Score, rank, and promotion

### 5.1 Arithmetic

`computeEvalScore` keeps its arithmetic and counts **every** source. An AI verdict is
evidence, and the user wants the rank to fill at once. Two things are added to the
per-category result:

- `byWeight: { human, auto_rule, ai_draft }`: the judged weight split by source. The three
  values sum to `scoredWeight`.
- `unreviewed`: the count of non-pending, non-human verdicts.

`eval_summary` on the targets list gains, per category, `judged_by_source` and
`unreviewed`, plus a top-level `unreviewed_total`. `complete` keeps its meaning: no
pending item in either category, whatever the sources. `combined` is unchanged.

### 5.2 Short List promotion: warn, never block

Promotion stays a human action. It is made **human-only** (Q3, accepted): `POST
.../targets/{targetId}/shortlist` is added to `HUMAN_ONLY_ROUTES`, the route calls
`humanOnlyDenied`, the MCP tool `shortlist_candidate` is removed from the registry, and an
mcp-coverage exclusion is added. Today an agent could run `AI 평가` and then promote a
candidate that no person has looked at. This change closes that path, and the boundary
then holds where it matters (§6).

When the candidate has unreviewed verdicts, the existing promote confirmation shows the
warning `AI 판정 {n}건 미검토 — 그대로 승격할 수 있습니다` with the per-category counts and a
link `항목 검토`. Promotion goes ahead on the person's click. The route response and the
audit target `brownfield_target.shortlist` gain `unreviewed={n}`, so later readers can see
that a candidate was promoted with unreviewed AI verdicts.

Why warn and not block:

1. A hard block would rebuild the confirm wall the user just removed. A person would
   have to open each candidate and save every AI item before promoting.
2. Promotion is itself the human decision. The promoting person sees the count and
   accepts it, and the audit records that.
3. The Short List is not final. S8/S9 DD re-examines every shortlisted target, and the
   gate decisions after it are human-only.

### 5.3 Rank

The rank (`#1 (57점)`) is computed from `combined` as today. It shows the same partial
marker as the chips (§7). It is a display order; the human rank order at promotion stays
as it is.

## 6. Boundary #2 and access control

The project boundary says that LLM output is a proposal and only a person records the
decision. Under this design it holds at the level of **decisions**, not at the level of
individual evidence items:

| Surface | Who records it | How origin stays visible |
|---|---|---|
| Item verdicts (`brownfield_target_eval_state`) | AI or a person; **evidence**, not a decision | `verdict_source` on every row; an origin badge on every item; unreviewed counts next to every score and rank |
| Short List promotion | **Human only** (made human-only by this design, §5.2) | Promote warning plus `unreviewed={n}` in the audit |
| Gate decisions, committee recommendations, route and target selection, IC | **Human only** (unchanged `HUMAN_ONLY_ROUTES`) | n/a |
| Kill criteria, RAG grade, gate snapshot | Not fed by eval scores (verified below) | n/a |

**Removal of A6.** The route
`POST /api/brownfield/{oppId}/targets/{targetId}/eval-draft-versions/{versionId}/confirm`
is deleted. Also removed:

- its `HUMAN_ONLY_ROUTES` entry in `lib/mcp/in-process-port.ts`;
- the mcp-coverage exclusion `eval-draft-version-confirm` in
  `scripts/co-newbiz/mcp-coverage.exclusions.yaml`;
- its path in `docs/architecture/openapi.yaml`;
- `lib/brownfield-eval-confirm.ts`.

Nothing replaces it as a route. Its job is split two ways: the engine's apply step
(§4.2) writes the verdicts, and the existing per-item `PUT` from a human UI session
reviews them.

**Consumers of eval scores (checked 2026-11-17):**

- `lib/gate-brief.ts`: reads `brownfield_target.screening_json` (pre-check items) and
  target counts. It never reads eval scores. **No impact.**
- `lib/gate-snapshot.ts`, `db/lib/snapshot-filler.ts`: count candidates and shortlisted
  targets only. **No impact.** The shortlisted count is driven by a human-only promotion.
- `run_rag_recompute`, kill criteria: no read of `brownfield_target_eval_state` or of
  `computeEvalScore`. **No impact today.** The ADR-0199 rule is tightened for any future
  consumer: the data confidence of an eval-derived input is the **minimum** across the
  verdicts used. `auto_rule` counts as `A`. `ai_draft` counts as `C`. A `human` verdict
  keeps the grade of its `source_version_id` (ADR-0198: no uplift). A human verdict with
  no version gets the grade that the consuming design assigns to direct human entry. Unreviewed `ai_draft` verdicts therefore cap such an input at `C`, which cannot
  support Green (non-negotiable #4).
- Committee brief `buildEvalBriefMd`
  (`components/stages/brownfield/evalBrief.ts`): shows `eval_summary.combined` as a
  reference column. It gains a suffix `(AI 미검토 {n})` when `unreviewed_total > 0`, so
  the committee never reads an AI-filled score as a human one.
- Capability judgement (`lib/brownfield-capability-judgement.ts`, ADR-0171): reads the
  statuses of seeded technical criteria. An AI apply that changes such a status
  invalidates this candidate's judgement for that row, as a human change does. The
  judgement's eval hash (`evalStateHash`) does **not** include `verdict_source`. A person
  accepting an AI verdict unchanged changes no content, so it must not invalidate a
  judgement. The drafting surface shows the origin badge next to each input status.
- `eval_summary` consumers in the UI (`LonglistSection`, `ShortlistSection`,
  `AiEvalCoverage`, `useBrownfieldTargets`): updated in §7.

**MCP tool text.** The `record_candidate_screening` description changes to: "Record one
criterion finding for a target. Stored as an unreviewed AI verdict (`ai_draft`); it never
overwrites a person's verdict. A person reviews it on the candidate detail screen."

## 7. UI (described, not implemented)

Owned by ux-designer-agent (handoff) and frontend-engineer (implementation), within Onyx
3.0 and `lint:design`. Text and icon, never color alone. All strings go in next-intl
catalogs (ko master, en parity, ADR-0184). Korean labels appear here only as quoted code
spans; see the glossary in §7.4.

### 7.1 S6 longlist row

- **Score chips collapse to one chip per category**, showing the score and judged
  coverage only: `재무 72 · 평가 40/100` and `기술 50 · 평가 30/100`. The provisional
  chips (`AI 잠정 v{n}`), `v{n} 유지`, and the per-category partial markers are removed.
- **One row-level marker line**, shown once and never repeated per category:
  - `⚠ 일부 항목 미평가` when any item in either category is pending;
  - `AI 판정 {n}건 미검토` (a separate line, with an icon and `aria-label`) only when
    `unreviewed_total > 0`. It covers `auto_rule` and `ai_draft`; the tooltip splits them
    as `자동 규칙 {a}건 · AI {b}건`;
  - `AI 평가 갱신 권장` when the latest version's `checked_at` is older than 90 days
    (kept from ADR-0199, moved out of the removed chip).
- **Rank cell** `#1 (57점)` gets the same partial marker `⚠` with the tooltip
  `일부 항목 미평가`.
- **Row buttons** become `AI 평가` · `항목 검토` · `버전 비교`.
  - `항목 검토` opens the candidate detail evaluation tab. It is the place for per-item
    human review and replaces the removed confirm button. It is emphasized (secondary
    style) when `unreviewed_total > 0`.
  - `버전 비교` opens the existing expansion as an **audit history only**. It shows
    per-version score, coverage, and per-item verdict changes (`변경` marker), plus a
    column header `적용 {k}건 · 사람 검토 {r}건` built from `source_version_id`. It has
    no confirm control.
- **Removed:** `AiEvalRowConfirm.tsx`, the confirm dialog, the confirm hooks in
  `useBrownfieldTargets` / `useBrownfieldBase`, the confirm part of
  `AiEvalVersionPanel.tsx`, and the provisional-chip code in `AiEvalCoverage.tsx`.
- The `AI 평가` start dialog text changes from `판정 확정은 사람이 합니다` to
  `AI 결과는 바로 판정에 반영되며, 사람이 항목별로 검토합니다`.

### 7.2 Candidate detail evaluation tab (`components/brownfield-target/TargetEvalTab.tsx`)

- Each item shows an **origin badge** with text and icon: `자동 규칙` (rule icon),
  `AI` (spark icon), or `사람` (person icon). The badge tooltip shows the version, the
  evidence grade, and `assessed_by` (for example `v3 · 근거 C · 실행 김OO`).
- **Easy review.** Today the category save sends only rows whose status changed
  (`saveCategory`, line 33), so accepting an AI verdict as is would send nothing. For
  non-human items a `확인` toggle is added. It stages a pending edit with the same status
  plus the item's `source_version_id`. The category `저장` button then saves it, and the
  row becomes `사람`. Changing the select also makes it `사람`, as today.
- The category header shows `AI 판정 {n}건 미검토` next to the score.
- **Per-category bulk accept, `auto_rule` only (Q1).** When a category has unreviewed
  `auto_rule` items, its header offers `자동 규칙 판정 {n}건 모두 확인`. It opens a dialog
  listing those items with their statuses. Confirming stages a `확인` for each and saves
  them through the existing per-item `PUT` (no new route), so each becomes `human` with
  its own `.ai_verdict.review` audit event. `ai_draft` (`AI`) items are never included;
  they are reviewed one at a time.
- **The non-persisted S7 `AI 초안` button is retired (Q7).** The button, its
  `saveDraftVerdicts` save-all (`components/brownfield-target/TargetEvalTab.tsx`,
  `useTargetActions.ts`), and the route `POST .../targets/{targetId}/eval-draft` (with its
  openapi path) are removed. The tab gets an `AI 평가` button that starts a
  single-candidate run, the same engine as the row button (direct apply, versioned). The
  drafting library functions shared with the engine stay.

### 7.3 Short List section

The `ShortlistSection` score display gets the same single chip and marker line. The
promote confirmation shows the warning from §5.2.

### 7.4 UI label glossary

The ko master strings, with their English meaning and the proposed locale key. The
frontend-engineer finalizes the keys under ADR-0184.

| English meaning | Korean label (ko master) | Locale key (proposed) |
|---|---|---|
| Category score with judged coverage | `기술 50 · 평가 30/100` | `stages.s67.longlistSection.scoreCoverage` |
| Some items not yet evaluated (row marker) | `⚠ 일부 항목 미평가` | `stages.s67.aiEval.partialMarker` |
| n AI verdicts not yet reviewed | `AI 판정 {n}건 미검토` | `stages.s67.aiEval.unreviewed` |
| Split tooltip | `자동 규칙 {a}건 · AI {b}건` | `stages.s67.aiEval.unreviewedSplit` |
| AI evaluation refresh recommended | `AI 평가 갱신 권장` | `stages.s67.aiEval.stale` |
| Row button: start AI evaluation | `AI 평가` | `stages.s67.aiEval.action` |
| Row button: review items | `항목 검토` | `stages.s67.aiEval.reviewItems` |
| Row button: compare versions | `버전 비교` | `stages.s67.aiEval.compareVersions` |
| Version column header | `적용 {k}건 · 사람 검토 {r}건` | `stages.s67.aiEval.appliedReviewed` |
| Changed (comparison marker) | `변경` | `stages.s67.aiEval.changed` |
| Origin badge: deterministic rule | `자동 규칙` | `stages.s67.aiEval.originRule` |
| Origin badge: AI | `AI` | `stages.s67.aiEval.originAi` |
| Origin badge: person | `사람` | `stages.s67.aiEval.originHuman` |
| Accept this AI verdict as is | `확인` | `stages.s67.aiEval.acceptOne` |
| Accept all rule verdicts in category (Q1, `auto_rule` only) | `자동 규칙 판정 {n}건 모두 확인` | `stages.s67.aiEval.acceptAllRule` |
| All items judged by a person | `사람 판정 완료` | `stages.s67.aiEval.allHuman` |
| Start dialog: results apply directly | `AI 결과는 바로 판정에 반영되며, 사람이 항목별로 검토합니다` | `stages.s67.aiEval.appliesDirectly` |
| Promote warning | `AI 판정 {n}건 미검토 — 그대로 승격할 수 있습니다` | `stages.s67.longlistSection.promoteUnreviewed` |
| Committee brief suffix | `(AI 미검토 {n})` | `stages.s67.evalBrief.unreviewedSuffix` |
| Unverified (unchanged) | `확인 안됨` | `stages.s67.aiEval.unverified` |
| Removed: provisional chip | `AI 잠정 v{n} · {date}` | removed |
| Removed: confirm version | `v{n} 제안 확정 (미판정 {k}건)` | removed |
| Removed: human confirms | `판정 확정은 사람이 합니다` | removed |
| Queue: waiting (Part B) | `대기 중` | `stages.s67.aiEval.queued` |
| Queue: already running elsewhere (Part B) | `이미 진행 중` | `stages.s67.aiEval.skippedActive` |
| Queue: cancelled (Part B) | `취소됨` | `stages.s67.aiEval.itemCancelled` |
| Queue: run summary (Part B) | `{done}/{total} 완료 · {running}건 진행 중 · {queued}건 대기` | `stages.s67.aiEval.queueSummary` |
| Queue: row step (Part B) | `기술 초안 작성 중` | existing step keys |
| Queue: cancel a waiting row (Part B) | `대기 취소` | `stages.s67.aiEval.cancelQueued` |

## 8. API changes (Part A)

| # | Route | Change |
|---|---|---|
| A1–A4 | `eval-draft-runs` start / latest / active / resume / cancel | Unchanged by Part A. Part B changes them (§10.7). A2 run items gain `apply_summary`. |
| A5 | `GET .../targets/{targetId}/eval-draft-versions` | Stays as history. `confirmed_count` is replaced by `applied_count` (verdicts with `source_version_id` = this version and a non-human source) and `reviewed_count` (human verdicts with `source_version_id` = this version). |
| A6 | `POST .../eval-draft-versions/{versionId}/confirm` | **Removed** (route, `HUMAN_ONLY_ROUTES` entry, mcp-coverage exclusion, openapi path). Callers get 404. |
| A7 | `PUT .../eval-state/{criterionId}` | Origin is derived from the caller (§4.1). New error codes 409 `human_verdict_locked`, and 403 `human_only` for `na`/`waived` from non-human callers. Body field `source_version_id` (human only). `confirmed_from_version_id` is accepted as a deprecated alias for one release, then rejected. The response row gains `verdict_source` and `source_version_id`. |
| — | `GET .../targets/{targetId}/eval-state` | Each item's `state` gains `verdict_source` and `source_version_id`; the response gains `unreviewed` per category. |
| A8 | `GET /api/brownfield/{oppId}/targets` | `eval_summary` gains per category `judged_by_source: { human, auto_rule, ai_draft }` (weights) and `unreviewed`, plus `unreviewed_total`. `eval_draft` is reduced to `{ financial?: { version_no, checked_at, stale, evidence_grade }, technical?: {...}, run_item?: { run_id, state, error } }`: version history and run state only. `provisional_score`, `proposed_count`, and `unverified_count` are removed from it. |
| — | `POST .../targets/{targetId}/shortlist` | Human-only (§5.2). The response gains `unreviewed`. The MCP tool `shortlist_candidate` is removed. |
| — | `POST .../targets/{targetId}/eval-draft` | **Removed** (Q7): the non-persisted S7 draft route and its openapi path. It was never MCP-exposed. Callers get 404; the detail tab starts a single-candidate run instead. |

`openapi.yaml` is updated for every row above.

## 9. Test plan (Part A)

| ID | Area | Assertion |
|---|---|---|
| TA1 | Migration backfill | After 0197 on a dev DB copy: every row is `human`; `source_version_id` equals `confirmed_from_version_id` on every row; `foreign_key_check` returns 0 rows; `integrity_check` returns ok. The rollback rehearsal resets non-human rows to pending **before** dropping the column. |
| TA2 | Origin by writer | A financial apply writes `auto_rule`. A technical apply writes `ai_draft`. A cookie-session `PUT` writes `human`. An MCP in-process `PUT`, a bearer `PUT`, and an agent-account `PUT` write `ai_draft`. A body `verdict_source` gets 400. |
| TA3 | `auto_rule` invariant | Every `auto_rule` row has a non-null `source_version_id` that points at a financial version of the same candidate. |
| TA4 | Never overwrite a human verdict | Engine apply over a `human` non-pending row leaves it byte-equal (`kept_human`). A non-human `PUT` over it gets 409 `human_verdict_locked` plus the refusal audit. A human save that lands between the version read and the apply wins (the SQL guard). |
| TA5 | Re-run replaces non-human verdicts | Run 1 applies `pass`. Run 2 with new evidence proposes `fail` → the row is `fail`, `source_version_id` = v2. Run 3 proposes `null` → the row is `pending` (`cleared`). |
| TA6 | Unverified not written | A `null` proposal on a pending item writes nothing; the item stays pending. |
| TA7 | Idempotent apply on unchanged hash | A pre-0197 version with never-applied proposals: a re-run computes the same `input_hash`, creates no version, makes no LLM call, and **applies** the latest version. A second re-run changes no status (idempotent). Applied AI verdicts do not change the next `input_hash` (human-only set). |
| TA8 | Criteria change before apply | A criterion retired, or its rubric changed between snapshot and apply, is skipped with `criterion_retired` / `criterion_changed` and recorded in `apply_summary`. |
| TA9 | Atomicity | A forced error inside apply rolls back the version insert too (no version without its verdicts, no verdicts without a version). |
| TA10 | Concurrency | Two parallel runs on different candidates of one opportunity: version numbers stay gap-free per candidate and category (the #896 tests stay green); each candidate's verdicts carry its own run's version. |
| TA11 | Score math, mixed sources | Fixture with human `pass` 10, `auto_rule` `partial` 10, `ai_draft` `fail` 10, `pending` 10: score 50, `scoredWeight` 30, `totalWeight` 40, `byWeight` {10,10,10}, `unreviewed` 2, `complete` false. |
| TA12 | Review flips origin | A human save of the same status turns `ai_draft` into `human`, keeps `source_version_id`, sets `assessed_by` to the reviewer, and emits `.ai_verdict.review changed=0`. |
| TA13 | Human-only promotion | `POST .../shortlist` via MCP, bearer, or agent → 403 `human_only`. The route is in `HUMAN_ONLY_ROUTES`, mcp-coverage passes, and `shortlist_candidate` is gone from the registry. A human promotion with unreviewed verdicts succeeds and records `unreviewed={n}`. |
| TA14 | A6 removed | The confirm path returns 404. `HUMAN_ONLY_ROUTES`, the mcp-coverage exclusions, and openapi have no confirm entry. The route-table scan finds no reference. |
| TA15 | Non-human exclusions | A non-human `PUT` with `na`/`waived` → 403 `human_only`. |
| TA16 | Committee brief | `buildEvalBriefMd` adds `(AI 미검토 {n})` when `unreviewed_total > 0` and nothing otherwise. |
| TA17 | UI | One chip per category; one row marker line; `AI 판정 n건 미검토` only when `n > 0`; origin badges carry text; the `확인` toggle saves the same status as `human`; `lint:design` has 0 violations; i18n parity holds. |
| TA18 | ADR-0171 parity | An AI apply that changes a seeded technical status invalidates only this candidate's judgement row. Accepting a verdict unchanged does not invalidate it (`evalStateHash` unchanged). |
| TA19 | Rule-only bulk accept (Q1) | `자동 규칙 판정 n건 모두 확인` saves only `auto_rule` items of the category as `human` (one `PUT` and one review audit each); `ai_draft` items are untouched and the action is absent when no `auto_rule` item is unreviewed. |
| TA20 | S7 draft retired (Q7) | `POST .../targets/{targetId}/eval-draft` returns 404; the detail tab has no `AI 초안` button or save-all; its `AI 평가` button starts a single-candidate run that applies and versions like the row button. |

---

## Part B — Bulk evaluation as a queue of per-candidate items

## 10. Bulk evaluation as a queue of per-candidate items

### 10.1 Requirement

The user added (2026-11-17) that the whole-list AI evaluation must behave exactly like the
per-candidate one. It must run in parallel, show per-row progress, and never block or be
blocked. It must not be a special sequential run that refuses to start while anything
else runs.

Current state (PR #896):

- A single-candidate run may run beside others, up to `MAX_CONCURRENT_EVAL_ENGINES = 3`
  per opportunity.
- A bulk start is refused with 409 `engine_active` `reason: "bulk_block"` while any engine
  is active. A single start is refused at the cap with `reason: "concurrency_cap"`.
- A bulk run processes its items strictly one after another inside one engine
  (`runBulkEval` loop).

This section supersedes that §5 concurrency amendment of the 0199 design.

### 10.2 Uniform execution model

- **Work item = one run item** (`brownfield_eval_draft_run_item`, one candidate). Bulk and
  single starts both create a run header plus run items in the existing tables. A bulk
  start creates one item per eligible candidate; a single start creates one item. No new
  table is needed: the run item already has `seq`, `state`, and per-category outcomes,
  and its `pending` state already means "not started".
- **One process-wide worker pool**: `EVAL_WORKER_POOL_SIZE = 3`. It replaces
  `MAX_CONCURRENT_EVAL_ENGINES`. The limit is process-wide, not per opportunity, because
  the scarce resources are process-wide: the DART daily budget counter, the LLM provider
  rate, and the single SQLite writer. A per-opportunity cap would let three busy
  opportunities run nine engines at once.
- **A dispatcher** (`lib/brownfield-eval-queue.ts`) replaces the per-run engine loop. When
  a slot frees, or a start or resume enqueues work, it picks the next item (§10.3), marks
  it in flight in memory, and runs the existing `processItem(c, item)` for that one item.
  When the item finishes, it bumps the run heartbeat and, if the run has no pending or
  in-flight items left, finishes the run (`completed`, or `cancelled` per §10.5). The
  per-item code (DART steps, drafting, version insert, the Part A apply) is unchanged.
- **Queue state lives in the database.** "Queued" = run status `running` and item state
  `pending`. The dispatcher's memory holds only the in-flight set and the scheduling
  cursor, so a restart loses nothing durable (§10.5).
- **The DART budget reserve stays global** (ADR-0199 §6.3). Before dispatching an item
  that needs DART calls, the dispatcher checks
  `budget − calls ≥ max(40, 10 % of budget)`. If the reserve is unmet, that item's run
  moves to `paused_budget` and its pending items stay pending. Resume stays manual. A
  fully cached item proceeds even below the reserve (as today).

### 10.3 Priority and fairness

Selection order when a slot frees:

1. **Single-candidate items first.** These are runs with `total_targets = 1`, started by a
   person from the row `AI 평가` or from the detail tab. A single click should not wait
   behind a 50-candidate bulk run. Priority is derived from the run, so no column is
   needed.
2. **Bulk items**, round-robin across active bulk runs. The run with the fewest in-flight
   items goes first; ties go to the oldest `started_at`, then `seq`. Two opportunities'
   bulk runs therefore share the pool instead of the first run monopolizing it.

**Starvation guard.** Whenever any bulk item is queued, at most
`EVAL_WORKER_POOL_SIZE − 1` slots (that is, 2) may hold single items. One slot is always
available to bulk work. Bulk therefore always progresses even under a steady stream of
single clicks. Singles still start almost at once, because two of three slots favor them.
Singles cannot starve each other either: they are FIFO, and the per-user, per-candidate
cooldown (30 s) limits how fast any one person can add them.

### 10.4 De-duplication

At start, inside the start transaction, each requested candidate is checked against
non-terminal items (`pending` or a step state) in **other** active runs:

| Candidate state elsewhere | New run is single | New run is bulk |
|---|---|---|
| Running (a step state) | new item `skipped_active` (`이미 진행 중`) | new item `skipped_active` |
| Queued in a **bulk** run | **take-over:** the bulk run's item becomes `skipped_active` (`taken_over_by` run id in `error_message`); the new single item is queued with priority | new item `skipped_active` |
| Queued in a single run | new item `skipped_active` | new item `skipped_active` |

No candidate is ever evaluated twice at the same time. Version numbering is already safe:
the repository allocates `MAX(version_no)+1` inside the insert transaction, and #896 tests
cover parallel engines. The take-over keeps the promise of §10.3 when a person clicks a
candidate that is waiting deep in a bulk queue. The single run uses the row defaults
(`categories: both`, no web evidence, no force refresh); the dialog says so when the
bulk run had other options.

"Reuse an identical active set" stays. A start whose candidate set equals an active run's
set returns that run (`meta.reused: true`).

### 10.5 Cancel, resume, restart

- **Run cancel** (A4): every `pending` item of the run becomes `cancelled`. In-flight
  items finish their current step (no partial version, as today), then stop. The run
  becomes `cancelled` when its last in-flight item returns. Versions already written,
  and verdicts already applied under Part A, stay.
- **Per-row cancel of a queued item** (Q11, new A4b):
  `POST .../eval-draft-runs/{runId}/items/{itemId}/cancel`. It is allowed only while the
  item is `pending` (409 `item_running` otherwise) and sets the item to `cancelled`. The
  row shows `대기 취소`. An in-flight item is cancelled only through the run cancel.
- **Resume** after a budget pause or an interruption stays manual (A3, ADR-0199
  decision 4). It re-enqueues the run's `pending` items and restarts any item left in a
  step state at the start of that step (the existing idempotent steps). Resume reuses the
  run's stored `web_evidence` and `force_refresh`.
- **Interrupted detection.** A run is marked `interrupted` lazily, on A2/active reads, only
  when **all three** hold: status `running`, the run is not registered with the
  in-process dispatcher, and `heartbeat_at` is older than 10 minutes. Queued runs waiting
  for a slot are registered, so a long queue is never mistaken for a dead run. The
  dispatcher also bumps the heartbeat of every registered run once a minute.
- **Server restart.** The in-memory dispatcher is empty after a restart. Every `running`
  run is therefore unregistered and, after 10 minutes without a heartbeat, shows
  `중단됨 — 이어서 실행`. Its queued items stay `pending`. Items that were in a step state
  restart that step on resume. The scheduler never auto-resumes (ADR-0199 Q2 stands), so
  all work after a restart is attributable to the person who presses resume.

### 10.6 Abuse controls

| Control | Rule |
|---|---|
| Cooldown | Unchanged: per user for bulk starts, per user + candidate for single starts (30 s, 429 `start_cooldown`). |
| Queue length | `MAX_QUEUED_ITEMS_PER_OPPORTUNITY = 200`: pending items across the opportunity's active runs. A start that would exceed it is refused with **429 `queue_full`** (`details: { queued, limit }`). 429 is chosen over 409 because the remedy is "retry later", the same family as the cooldown. 200 covers about three full 60-candidate longlists in flight. |
| Identical set | Reused, never duplicated (§10.4). |
| DART budget | The global reserve (§10.2). |
| Pool size | A code constant, not a request parameter. |

### 10.7 Schema: migration `0199_eval_run_item_queue_states.sql`

Two item states are needed: `skipped_active` and `cancelled`. The run-item `state` CHECK
cannot be altered in SQLite, so this is a table rebuild (the 0104 create-copy-rename
pattern). Rebuilding a table is not purely additive, which is why it is a separate
migration from 0197. It ships with Part B, so Part A stays purely additive.

```sql
-- @reversible: true (table rebuild to widen the run-item state CHECK with
-- 'skipped_active' and 'cancelled'; every existing row is copied unchanged.
-- Rollback (ADR-0014): pre-migration backup; or, after mapping the new states
-- (UPDATE ... SET state = 'pending' WHERE state = 'cancelled';
--  UPDATE ... SET state = 'failed', error_message = 'skipped_active' WHERE state = 'skipped_active'),
-- rebuild with the 0194 CHECK. Precondition: no active run (drain or cancel first).)
-- Rebuild steps, in one transaction with foreign_keys deferred:
--   CREATE TABLE brownfield_eval_draft_run_item_new (... identical to 0194 + 0197 columns,
--     state CHECK adds 'skipped_active', 'cancelled' ...);
--   INSERT INTO ..._new SELECT * FROM brownfield_eval_draft_run_item;
--   DROP TABLE brownfield_eval_draft_run_item;
--   ALTER TABLE ..._new RENAME TO brownfield_eval_draft_run_item;
--   CREATE INDEX idx_bedri_run_state ON brownfield_eval_draft_run_item(run_id, state, seq);
--   -- Pattern: start-time dedupe "is candidate T non-terminal in any active run?"
--   CREATE INDEX idx_bedri_target_state ON brownfield_eval_draft_run_item(brownfield_target_id, state);
```

PR-A lands first, so 0197 is already applied and the rebuilt table keeps the
`apply_summary` column.

### 10.8 API changes (Part B)

| Route | Change |
|---|---|
| `POST .../eval-draft-runs` (A1) | Always 202 when accepted, never 409 for running work. Response: `{ run_id, status, queued: n, skipped: [{ target_id, reason: "already_active" \| "taken_over" \| "not_dart" \| "no_company" }], taken_over: [{ target_id, from_run_id }] }`, with `meta.reused`. **Removed:** 409 `engine_active` with `reason: "bulk_block"` and with `reason: "concurrency_cap"`. **Added:** 429 `queue_full`. Kept: 429 `start_cooldown`. |
| `GET .../eval-draft-runs/active` | Every run registered with the dispatcher for the opportunity (running or queued), oldest first. Each has `counts: { done, running, queued, skipped, failed, cancelled, total }` plus its items with state. |
| `GET .../eval-draft-runs/latest` / `/{runId}` (A2) | Same `counts` block; item states include `skipped_active` and `cancelled`. |
| `POST .../eval-draft-runs/{runId}/cancel` (A4) | Semantics from §10.5; the response gains `cancelled_items`. |
| `POST .../eval-draft-runs/{runId}/items/{itemId}/cancel` (A4b, new) | Cancel one queued item; 409 `item_running`. Not human-only: cancelling is not a judgement. |
| `openapi.yaml` | Updated for all of the above. |

### 10.9 UI contract (Part B, described only)

- **One progress panel** lists every active run for the opportunity. Each line reads
  `{done}/{total} 완료 · {running}건 진행 중 · {queued}건 대기` in full wording, with no
  truncation. A run line for a single-candidate run names the company.
- **Each candidate row** shows its own state, the same way for bulk and single:
  `대기 중`, then the step text (for example `기술 초안 작성 중`), then the result. A
  skipped row shows `이미 진행 중`; a cancelled row shows `취소됨`. A queued row offers
  `대기 취소` (A4b).
- **The row `AI 평가` button** is disabled only while that candidate is queued or
  running.
- **The toolbar bulk `AI 평가` button** is no longer disabled while other runs exist. It
  skips candidates that are already active, and the start dialog states how many will be
  queued and how many skipped.
- Polling every 3 s while any run is active (unchanged); `aria-live="polite"` on the
  panel.

### 10.10 Test plan (Part B)

| ID | Area | Assertion |
|---|---|---|
| TB1 | Pool bound | With 3 bulk runs over 20 candidates each and 5 single starts, the in-flight count never exceeds `EVAL_WORKER_POOL_SIZE` (sampled on every dispatch). |
| TB2 | Single priority | With a 50-item bulk queue running, a single start begins within one item completion. |
| TB3 | Starvation guard | Under a continuous stream of single starts, at least one slot keeps serving bulk items while bulk items are queued. |
| TB4 | Dedupe | A candidate running in run A becomes `skipped_active` in a new bulk run B. A candidate queued in bulk run A is taken over by a single start (A's item `skipped_active`, the single item queued). No candidate has two in-flight items at once. |
| TB5 | `queue_full` | A start that would exceed 200 pending items → 429 `queue_full` with `queued` and `limit`. |
| TB6 | No 409 for running work | A bulk start while singles run → 202 with queued counts; a single start at a full pool → 202, queued. |
| TB7 | Cancel | Run cancel turns pending items into `cancelled`; an in-flight item finishes its step; the run ends `cancelled`; versions and applied verdicts stay. A4b on a pending item → `cancelled`; on a running item → 409 `item_running`. |
| TB8 | Restart | Simulated restart (dispatcher reset): the run is not marked interrupted before 10 minutes; after that A2 marks it `interrupted`; pending items stay pending; resume re-enqueues them and restarts a mid-step item at the start of that step; no auto-resume. |
| TB9 | Version numbering | Parallel items over different candidates and repeated runs over one candidate keep gap-free version numbers (the #896 tests stay green). |
| TB10 | Budget | Reserve unmet → the item's run becomes `paused_budget`; fully cached items still run; other runs' cached items are unaffected. |
| TB11 | UI | Panel line wording in full; row states for bulk and single are identical; the bulk button is enabled while other runs exist; `lint:design` has 0 violations; i18n parity holds. |

## 11. Rollout and rollback

**Part A.**

1. dba: backup before; apply 0197; health checks (§3.3).
2. Deploy the code with the engine apply, origin rules, A6 removal, human-only promotion,
   and the UI.
3. Existing unapplied versions are applied when a person next runs `AI 평가` (TA7). There
   is no deploy-time backfill (Q6).

Rollback order: code first (the 0199 code ignores the new columns), then the 0197
ROLLBACK-SQL, whose step 1 resets non-human verdicts to pending so that no AI verdict
survives looking human. Without the code rollback the new columns are harmless. The
reverse order is forbidden: dropping `verdict_source` while the new code runs fails
every write.

**Part B.**

1. Drain or cancel active runs.
2. Apply 0199 (backup before, health after).
3. Deploy the dispatcher.

Rollback: drain, map the new states, then rebuild or restore (§10.7). The 0196 state
(no unique index) is unaffected either way.

## 12. Work breakdown and PR phasing

Two PRs, in this order. Each opens only after the previous one merges (Sequential Branch
Dependency Rule). They meet only at `processItem` in `lib/brownfield-eval-bulk.ts`, whose
signature does not change. Paths below are relative to `app/web-next/` unless they start
with `db/`, `mcp/`, `scripts/`, `docs/`, or `tests/`.

### 12.1 PR-A — verdict origin and direct apply (Part A)

| Row | Work | Files | Agent (tier / model) | Exit |
|---|---|---|---|---|
| A1 | Migration `0197_eval_state_verdict_source.sql` exactly as §3.3 (two columns, backfill copy, two partial indexes, `apply_summary`, ROLLBACK-SQL with the reset step first) | `db/migrations/0197_eval_state_verdict_source.sql` (new) | data-architect reviews → backend-engineer (High / opus); dba operational review: backup before, health after (§3.3 checks), rollback rehearsal including the reset step | TA1 |
| A2 | Engine apply: new `applyVersionToEvalState` (§4.2) called inside `commitCategoryDraft` on both the `versioned` and the `unchanged` path; eligible set and human-only set in `needsOf`, `humanItems`, `provisionalScore` (§4.3); `apply_summary` written per category; `.ai_verdict.apply` audit; `upsertEvalState` writes `verdict_source` / `source_version_id` and stops touching `confirmed_from_version_id`; `computeEvalScore` gains `byWeight` and `unreviewed` | `lib/brownfield-eval-apply.ts` (new), `lib/brownfield-eval-bulk.ts`, `db/repositories/brownfield-eval-draft.repository.ts`, `lib/brownfield-eval-criteria.ts` | backend-engineer (High / opus) | TA2 (engine part), TA3, TA5–TA11, TA18 |
| A3 | Writer rules on `PUT eval-state` (§4.1): origin from `humanOnlyDenied`, 409 `human_verdict_locked`, 403 for `na`/`waived` and `source_version_id` from non-human callers, body `verdict_source` rejected, `confirmed_from_version_id` as a deprecated alias for `source_version_id`; `.agent_verdict`, `.agent_verdict.refused`, `.ai_verdict.review` audits; eval-state GET gains origin fields and `unreviewed` | `app/api/brownfield/[oppId]/targets/[targetId]/eval-state/[criterionId]/route.ts`, `app/api/brownfield/[oppId]/targets/[targetId]/eval-state/route.ts` | backend-engineer (High / opus) | TA2 (route part), TA4, TA12, TA15 |
| A4 | Remove the confirm route A6 and the S7 draft route (Q7): delete the route files and `lib/brownfield-eval-confirm.ts`; remove the A6 `HUMAN_ONLY_ROUTES` entry; remove the mcp-coverage exclusion `eval-draft-version-confirm`; remove both openapi paths | `app/api/brownfield/[oppId]/targets/[targetId]/eval-draft-versions/[versionId]/confirm/route.ts` (delete), `app/api/brownfield/[oppId]/targets/[targetId]/eval-draft/route.ts` (delete), `lib/brownfield-eval-confirm.ts` (delete), `lib/mcp/in-process-port.ts`, `scripts/co-newbiz/mcp-coverage.exclusions.yaml`, `docs/architecture/openapi.yaml` | backend-engineer (High / opus) | TA14, TA20 (API part) |
| A5 | Promotion human-only (Q3): `humanOnlyDenied` in the shortlist route, `HUMAN_ONLY_ROUTES` entry, mcp-coverage exclusion with reason, remove the `shortlist_candidate` tool; response and audit gain `unreviewed`; `record_candidate_screening` description (§6) | `app/api/brownfield/[oppId]/targets/[targetId]/shortlist/route.ts`, `lib/mcp/in-process-port.ts`, `scripts/co-newbiz/mcp-coverage.exclusions.yaml`, `mcp/co-newbiz/tools/stage-tools.ts`, `docs/architecture/openapi.yaml` | backend-engineer (High / opus) | TA13 |
| A6 | Read models: `eval_summary` gains `judged_by_source`, `unreviewed`, `unreviewed_total`; `eval_draft` reduced (§8 A8); A5 version list `applied_count` / `reviewed_count`; committee brief suffix | `app/api/brownfield/[oppId]/targets/route.ts`, `lib/brownfield-eval-draft-view.ts`, `app/api/brownfield/[oppId]/targets/[targetId]/eval-draft-versions/route.ts`, `components/stages/brownfield/evalBrief.ts` | backend-engineer (High / opus) | TA16 |
| A7 | S6 UI (§7.1, §7.3): one chip per category, one row marker line, rank marker, row buttons `AI 평가` · `항목 검토` · `버전 비교`, version panel as history only, start-dialog text, promote warning; delete `AiEvalRowConfirm.tsx` and the confirm hooks; remove provisional chips | `components/stages/brownfield/LonglistSection.tsx`, `ShortlistSection.tsx`, `AiEvalCoverage.tsx`, `AiEvalChips.tsx`, `AiEvalVersionPanel.tsx`, `AiEvalRowConfirm.tsx` (delete), `aiEvalActive.ts`, `aiEvalTypes.ts`, `types.ts`, `useBrownfieldTargets.ts`, `useBrownfieldBase.ts`; `locales/ko.json`, `locales/en.json` | ux-designer-agent handoff → frontend-engineer (Medium / sonnet); design-system-agent lint ruling | TA17 |
| A8 | Detail tab (§7.2): origin badges, `확인` toggle, category `AI 판정 {n}건 미검토`, rule-only bulk accept (Q1), retire `AI 초안` and save-all, add the single-run `AI 평가` button (Q7) | `components/brownfield-target/TargetEvalTab.tsx`, `components/brownfield-target/useTargetActions.ts`; `locales/ko.json`, `locales/en.json` | frontend-engineer (Medium / sonnet) | TA17, TA19, TA20 (UI part) |
| A9 | Tests: update `tests/unit/brownfield-eval-bulk.test.ts`, `brownfield-eval-criteria.test.ts`, `brownfield-eval-draft-repository.test.ts`, `mcp-stage-tools.test.ts`, `s6-ai-eval-coverage.test.ts`, `s6-ai-eval-render.test.ts`, `s6-ai-eval-row-render.test.ts`, `s7-eval-save-and-gate-hint.test.ts`; add `tests/unit/brownfield-eval-apply.test.ts` (TA2–TA12, TA18) and `tests/unit/eval-verdict-origin-boundary.test.ts` (TA4, TA13–TA15) | as listed | backend-engineer + frontend-engineer | TA1–TA20 green |
| A10 | Security review of the origin and boundary rules: `humanOnlyDenied` derivation, bearer → `ai_draft`, `human_verdict_locked`, human-only promotion, no body-supplied origin | — | security-engineer (High / opus) | Review verdict before PR-A merges |

### 12.2 PR-B — queue of per-candidate items (Part B)

| Row | Work | Files | Agent (tier / model) | Exit |
|---|---|---|---|---|
| B1 | Migration `0199_eval_run_item_queue_states.sql` (§10.7): rebuild with `skipped_active` and `cancelled`, keep the 0197 `apply_summary` column, add `idx_bedri_target_state` | `db/migrations/0199_eval_run_item_queue_states.sql` (new), `db/repositories/brownfield-eval-draft.repository.ts` (state type, dedupe query, counts query) | data-architect reviews → backend-engineer (High / opus); dba review (rebuild, drain precondition, rollback rehearsal) | migration checks |
| B2 | Dispatcher: `EVAL_WORKER_POOL_SIZE = 3` process-wide, single-first selection with one bulk slot reserved, round-robin across bulk runs, per-minute heartbeat of registered runs, interrupted rule (§10.5), global DART reserve check per item; `runBulkEval` loop replaced by the dispatcher calling `processItem`; `MAX_CONCURRENT_EVAL_ENGINES` removed | `lib/brownfield-eval-queue.ts` (new), `lib/brownfield-eval-bulk.ts` | backend-engineer (High / opus) | TB1–TB3, TB8–TB10 |
| B3 | API: start returns 202 with `queued`, `skipped`, `taken_over`; dedupe and take-over (§10.4); `MAX_QUEUED_ITEMS_PER_OPPORTUNITY = 200` → 429 `queue_full`; remove 409 `engine_active` (`bulk_block`, `concurrency_cap`); `counts` on active / latest / run; run cancel semantics; new A4b item cancel route | `app/api/brownfield/[oppId]/eval-draft-runs/route.ts`, `.../eval-draft-runs/active/route.ts`, `.../eval-draft-runs/latest/route.ts`, `.../eval-draft-runs/[runId]/route.ts`, `.../eval-draft-runs/[runId]/cancel/route.ts`, `.../eval-draft-runs/[runId]/resume/route.ts`, `.../eval-draft-runs/[runId]/items/[itemId]/cancel/route.ts` (new), `docs/architecture/openapi.yaml` | backend-engineer (High / opus) | TB4–TB7 |
| B4 | UI (§10.9): multi-run panel with the full summary line, per-row queue states, `대기 취소`, row button disabled only while that candidate is queued or running, bulk button always enabled with queued and skipped counts in the dialog | `components/stages/brownfield/LonglistSection.tsx`, `aiEvalActive.ts`, `aiEvalTypes.ts`, `useBrownfieldTargets.ts`; `locales/ko.json`, `locales/en.json` | frontend-engineer (Medium / sonnet) | TB11 |
| B5 | Tests: update `tests/unit/s6-ai-eval-parallel.test.ts` and `brownfield-eval-bulk.test.ts` (the `bulk_block` / `concurrency_cap` cases become queue cases); add `tests/unit/brownfield-eval-queue.test.ts` (TB1–TB10) | as listed | backend-engineer | TB1–TB11 green |

### 12.3 Close

ADR-0200 implementation note, handbook S6 section, registry status `implemented` per PR
scope, and CHANGELOG through `/sync`, by docs-writer (Medium / sonnet) at the end of
each PR.

## 13. Open questions — resolved

The user approved this design on 2026-11-17 and accepted all eleven recommendations
unchanged. The body of this design and ADR-0200 reflect these decisions.

| # | Question | Decision | Where it applies |
|---|---|---|---|
| Q1 | Bulk accept on the detail screen | **Only for `자동 규칙` (`auto_rule`) items** of one category, through per-item saves. `AI` (`ai_draft`) items are reviewed one at a time. Accepted as recommended, user approval 2026-11-17. | §2, §7.2, TA19, PR-A A8 |
| Q2 | Re-run cannot verify an item holding an AI verdict | **Clear it to pending.** Accepted as recommended, user approval 2026-11-17. | §4.2, TA5 |
| Q3 | Short List promotion | **Human-only**; MCP tool `shortlist_candidate` removed. Accepted as recommended, user approval 2026-11-17. | §5.2, §6, TA13, PR-A A5 |
| Q4 | Promotion with unreviewed AI verdicts | **Warn** with counts and record `unreviewed={n}` in the audit; no block. Accepted as recommended, user approval 2026-11-17. | §5.2 |
| Q5 | Personal API token (bearer) writes | **Stored as `ai_draft`.** Accepted as recommended, user approval 2026-11-17. | §4.1, TA2 |
| Q6 | Existing never-confirmed versions | **No deploy-time backfill**; applied when a person next runs `AI 평가`. Accepted as recommended, user approval 2026-11-17. | §4.3, §11, TA7 |
| Q7 | S7 detail `AI 초안` button and save-all | **Retired**, together with `POST .../eval-draft`; replaced by a single-candidate run. Accepted as recommended, user approval 2026-11-17. | §7.2, §8, TA20, PR-A A4/A8 |
| Q8 | Non-human `na`/`waived` and the human-verdict lock | **Refused (403) and locked (409).** Accepted as recommended, user approval 2026-11-17. | §4.1, TA4, TA15 |
| Q9 | Queue constants | **Pool 3 process-wide, queue cap 200 per opportunity, one slot reserved for bulk.** Accepted as recommended, user approval 2026-11-17. | §10.2, §10.3, §10.6 |
| Q10 | Single start on a candidate queued in a bulk run | **Take over.** Accepted as recommended, user approval 2026-11-17. | §10.4, TB4 |
| Q11 | Per-row cancel of a queued item | **Added (A4b).** Accepted as recommended, user approval 2026-11-17. | §10.5, §10.8, TB7 |
