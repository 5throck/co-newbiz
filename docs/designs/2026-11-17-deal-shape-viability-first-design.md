# S7 Deal-Shape Evaluation: Overall Viability First

- Spec ID: `2026-11-17-deal-shape-viability-first`
- Date: 2026-11-17
- Status: proposed
- Author: brownfield-agent (S7 `deal-shape-evaluation` owner). Row 0 design, PM dispatch.
- ADR: [ADR-0201](../adr/0201-deal-shape-viability-first.md) (amends ADR-0194 item A and ADR-0195). This change rebuilds a
  table (migration 0198), changes the MCP write tool schema, and changes the wording of procedure
  `brownfield-target-screening` step 3.5.
- Related: ADR-0005 (append-only, superseded_by), ADR-0011 (MCP as a REST client), ADR-0014 (migration discipline),
  ADR-0053 (#9 `mark_conditional`), ADR-0118 (proposal-only AI), ADR-0184 (next-intl), boundaries 1, 2 and 4.

## 1. Problem

The owner decided on 2026-11-17 that the first question of the S7 deal-shape evaluation is overall viability
(`가능 여부`). Today the data model and the form are per shape. Every row needs a shape and an intent
(`NOT NULL` plus `CHECK` in migration 0188), and a person records one shape at a time with a viable flag. So
"nothing is viable" can only be expressed as one not-viable row per shape. The AI recommendation
(`s7.deal_shape_recommend@1`) also returns a verdict per shape. The owner wants:

1. Overall viability is asked first. `불가능` asks for one rationale only, with no shape and no intent.
2. `가능` asks for the shape(s) and the intent, plus one rationale per selected shape only. Unselected shapes are
   never asked about. The intent is required for a viable shape.
3. The shape and intent controls stay disabled until `가능` is chosen.
4. The AI recommendation uses the same structure: overall verdict first, shapes only when viable.
5. The viability, shape and intent controls sit on one wrapping row. The table is already gone, and the recorded
   verdicts list stays.

## 2. Decisions

| # | Decision |
|---|----------|
| D1 | One table, two row kinds. A **shape row** (shape and intent set) means "this shape is viable". An **overall row** (shape NULL, intent NULL, viable 0) means "no shape is viable". There is no overall-viable row: overall viable means at least one live shape row exists. |
| D2 | The live set is either exactly one overall row or one or more shape rows, never both. Every write replaces the whole live set in one transaction. |
| D3 | New writes create viable shape rows only (`viable = 1`). Legacy `viable = 0` shape rows stay readable until the next write supersedes them. Nothing is backfilled or converted. |
| D4 | #9 reads unchanged SQL: COUNT of live rows (recorded) and SUM(viable) (viable). An overall row counts as recorded with zero viable, so it triggers. An empty live set stays `null` (unassessed). |
| D5 | POST takes a discriminated body (`viable: false` or `viable: true`) plus a `live_token` for optimistic concurrency. The legacy single-shape body is rejected. |
| D6 | One intent per viable verdict, stored on every shape row (no schema change; open question Q1). |
| D7 | The recommendation returns `{overall, shapes}` at `s7.deal_shape_recommend@2`. It stays a proposal and never writes. |

## 3. Data model: migration `0198_deal_shape_overall_verdict.sql`

### 3.1 Rebuilt table

SQLite cannot relax `NOT NULL` or change a `CHECK` in place, so the table is rebuilt (copy, drop, rename) inside
the `PRAGMA foreign_keys = OFF` wrapper that `db/migrate.ts` supports.

```sql
CREATE TABLE opportunity_deal_shape_evaluation_new (
  id TEXT PRIMARY KEY NOT NULL,
  opportunity_id TEXT NOT NULL REFERENCES opportunity(id),
  shape TEXT CHECK (shape IS NULL OR shape IN ('full_acquisition','majority_stake','spv','holdco_route',
                                               'joint_venture','minority_stake','license_in','co_development')),
  intent TEXT CHECK (intent IS NULL OR intent IN ('integration','capability_access')),
  viable INTEGER NOT NULL CHECK (viable IN (0,1)),
  rationale TEXT NOT NULL CHECK (length(trim(rationale)) > 0),
  evidence_ref TEXT,
  evaluated_by TEXT NOT NULL,
  evaluated_at TEXT NOT NULL,
  superseded_by TEXT REFERENCES opportunity_deal_shape_evaluation(id),
  CHECK ((shape IS NULL AND intent IS NULL AND viable = 0)        -- overall "no shape is viable"
      OR (shape IS NOT NULL AND intent IS NOT NULL))              -- shape row (legacy rows may hold viable = 0)
);
-- copy every row verbatim, DROP the old table, RENAME _new, then recreate:
CREATE UNIQUE INDEX idx_odse_live ON opportunity_deal_shape_evaluation(opportunity_id, shape)
  WHERE superseded_by IS NULL AND shape IS NOT NULL;
CREATE UNIQUE INDEX idx_odse_live_overall ON opportunity_deal_shape_evaluation(opportunity_id)
  WHERE superseded_by IS NULL AND shape IS NULL;
CREATE INDEX idx_odse_opp ON opportunity_deal_shape_evaluation(opportunity_id, evaluated_at DESC);
```

A second index is needed because SQLite treats NULLs as distinct in a unique index. Without it, two live overall
rows would be allowed.

### 3.2 Write semantics (repository, one transaction, `defer_foreign_keys = ON` as today)

| Write | Effect on the live set |
|-------|------------------------|
| `recordOverallNotViable` | Insert one overall row. Every live row of the opportunity (shape rows of either viable value, and a previous overall row) gets `superseded_by` = the new row id. |
| `recordViableShapes` | Insert one shape row per selected shape, in canonical shape order, all with the same intent. A live row of the same shape points at its new row. Live rows of unselected shapes, legacy `viable = 0` rows and a live overall row all point at the first new row. |
| No-op | If the submitted viable set is identical to the live set (same shapes, intent, rationale and evidence, and no overall row), nothing is written. The response is `200` with `changed: false`. |

- Any change re-inserts the whole set under the submitter, because the person who submits the set takes
  accountability for all of it. Earlier authors stay in history.
- `superseded_by` is many-to-one, which the self-FK already allows. Every chain points at a newer row. Nothing is
  deleted.
- `evaluated_by` is always `ctx.userId` from the session. Any body field naming an evaluator is ignored.
- The mutual exclusivity in D2 spans rows, so no `CHECK` or index can express it. The repository enforces it, and a
  unit test pins it (§8). If both kinds were ever live, the readers stay sound: SUM(viable) counts only viable shape
  rows, so #9 reads the real viable count.
- `live_token` is the sorted live row ids joined and hashed with sha256 (the first 16 hex characters). The
  repository recomputes it inside the transaction. A mismatch throws `DealShapeError("stale")`, which the route
  maps to 409.

### 3.3 Migration header and data-architect review points

- `@reversible: false in the general case`, following the 0185 rebuild precedent. In-place rollback works only while
  no `shape IS NULL` row exists. The ROLLBACK-SQL block rebuilds the 0188 shape and starts with a commented guard
  query, `SELECT COUNT(*) FROM opportunity_deal_shape_evaluation WHERE shape IS NULL` (must be 0). Otherwise the
  rollback is a pre-migration backup restore (`scripts/co-newbiz/restore.ts`). dba runs it and release-engineer
  signs off (FR-OPS-02).
- Review points: (a) verbatim copy with a row-count parity check; (b) after the rename, `PRAGMA foreign_key_check`
  passes and the self-FK text names the final table; (c) both partial unique indexes; (d) the table CHECK accepts
  every legacy row (dev DB today: 2 rows, 1 live `viable = 0`); (e) Prisma typegen parity (shape and intent become
  nullable); (f) the number: ADR-0200 PR-B tentatively claims 0198 (`0198_eval_run_item_queue_states.sql`), so
  whichever lands second renumbers to 0199.
- No backfill. Legacy all-not-viable sets are not converted into an overall row, because that would invent an
  overall judgement nobody recorded.

## 4. Kill criterion #9 and the `viable_count` contract

| Live set | `recorded` | `viable_count` (= `dealshape.viable_shapes`) | #9 |
|----------|-----------|-----------------------------------------------|----|
| empty | 0 | `null` (variable missing) | unassessed |
| one overall row | 1 | `0` | triggered (`mark_conditional`, RECYCLE) |
| N viable shape rows | N | N | false |
| legacy rows only, all `viable = 0` | N | 0 | triggered (unchanged from today) |
| legacy mixed | N | count of `viable = 1` | false when ≥1 |

`summarizeLiveDealShapes` keeps its SQL. It gains `overallNotViable: boolean` (a live overall row exists) for the
UI and the gate brief. `opportunityVarRows` in `gate-snapshot.ts` and `gate-kill-deal-shape.ts` need no change.
Nothing recorded never reads as zero, and only a person's write can make the count 0.

## 5. REST, OpenAPI and MCP

### 5.1 `GET /api/opportunities/{id}/deal-shapes`

New fields: `verdict` (`"unassessed" | "not_viable" | "viable"`), `overall` (the live overall row or `null`),
`live_token` and `unselected_shapes`. Existing fields: `live` holds shape rows only; `history` holds both row kinds,
newest first (overall rows carry `shape: null`, `intent: null`); `viable_count` follows §4; `unevaluated_shapes`
stays one release as an alias of `unselected_shapes`.

### 5.2 `POST /api/opportunities/{id}/deal-shapes`

```jsonc
// not viable
{ "viable": false, "rationale": "…", "evidence_ref": "…?", "live_token": "…" }
// viable
{ "viable": true, "intent": "integration|capability_access", "live_token": "…",
  "shapes": [ { "shape": "joint_venture", "rationale": "…", "evidence_ref": "…?" } ] }
```

| Condition | Response |
|-----------|----------|
| `viable` missing or not a boolean | 400 `invalid_request` |
| `viable: false` with `shapes`, `shape` or `intent` present | 400 `invalid_request` ("no shape or intent when not viable") |
| `viable: true` with `shapes` missing or empty, more than 8 entries, a duplicate or unknown shape, a missing or invalid intent, or a blank or over-2000-character rationale on any shape | 400 `invalid_request` (`details.field`, `details.shape`) |
| legacy body (top-level `shape`) | 400 `invalid_request` ("use the overall-first contract") |
| `live_token` missing or stale | 409 `deal_shape_stale` (`details.live_token` = current) |
| before S7 or not brownfield | 409 `deal_shape_not_open` (guard unchanged) |
| success | 201 `{verdict, rows: [...], superseded: [...ids]}`, or 200 `{changed: false}` |

The audit actions are `opportunity.deal_shape.record_not_viable` and `opportunity.deal_shape.record_viable_set`,
with target `"{opp}:{newIds}"`. `docs/architecture/openapi.yaml` and `api-spec.md` must be updated to the same
contract.

### 5.3 MCP and boundary 2

- `record_deal_shape_evaluation` gets the new `bodyHint`. Its description says to record only the overall verdict
  the user explicitly gave. For viable, that is only the shapes the user named, with the intent and rationale as
  stated. The agent must call `get_deal_shape_evaluations` first for `live_token`, and a viable write replaces the
  live set. The agent must never turn a recommendation, score or route advice into a write.
- `get_deal_shape_evaluations` gets an updated description. The recommend route stays a REST-only proposal with no
  MCP write path.
- Boundary 1 stays: there is no agent account, and the route takes the session user. Boundary 2 also stays: the
  recorded verdict is a person's act. `mcp-coverage` artefacts (`stage:S7:4`) are unchanged.

## 6. UI (`DealShapePanel.tsx`, `lib/deal-shape-view.ts`)

### 6.1 Form

The panel uses P3 Decision inside the S7 tab, with ghost buttons only. The page's single primary action is
unchanged.

- **Row 1** is one `flex flex-wrap` row: a `가능 여부` radio group (`가능` / `불가능`, no default), a `진출 형태`
  checkbox group (8 vocabulary shapes) and an `의도` select.
- **Disabled state.** Until `가능` is chosen, the checkbox group and the select carry `disabled`. They also carry
  `aria-describedby` pointing at a hint: `가능을 선택하면 형태와 의도를 고를 수 있습니다`.
- **`불가능`.** One `근거 (필수)` textarea and one optional evidence field appear below row 1. Shape and intent stay
  disabled and are not sent.
- **`가능`.** For each checked shape, in vocabulary order, a rationale block (`{형태} 근거 (필수)` plus optional
  evidence) appears below row 1. Unchecking a shape hides its block. The typed text stays in local state until the
  record succeeds and is never sent while the shape is unchecked.
- **Switching** between `가능` and `불가능` keeps drafts in memory but submits only the active branch.
- **Validation** (`validateDealShapeForm`, in field order): `viable`; `rationale` / `rationaleTooLong` (not-viable
  branch); `shapes` (none checked); `intent`; `shapeRationale:{shape}` / `shapeRationaleTooLong:{shape}`;
  `evidenceTooLong`. The server stays authoritative.
- **`buildDealShapeBody`** emits the §5.2 union and the `live_token` from the last GET. On a 409 `deal_shape_stale`,
  the panel reloads and shows a message: someone else recorded first, so review the current verdict and record
  again. The form is kept.

### 6.2 Recorded list and history

- The status line reads `unassessed` (○, `#9 미평가`), `not_viable` (⚠ amber, `불가능: 가능한 진출 형태 없음 (중단
  조건 #9 해당)`) or `viable` (✓, `가능 형태 {n}건`).
- `not_viable` shows one entry: the rationale, evidence, recorder and time.
- `viable` shows one entry per live shape row, with shape, intent, rationale, evidence, recorder and time.
- Legacy `viable = 0` live rows show with the label `형태별 불가 (이전 방식)` until the next write.
- One `수정` ghost button above the list loads the whole live set into the form. That is the recorded verdict, not
  an AI value: `가능` with its shapes, intent and rationales, or `불가능` with its rationale. Mixed legacy intents
  leave the intent empty. The per-row edit buttons are removed, because a write replaces the set.
- The history `<details>` lists superseded rows of both kinds, with overall rows labelled `전체 불가능`.
- Read-only roles see the list without the form, as today. Tokens and components come from the existing
  `status-chip`, `btn-ghost btn-sm`, `sizing-new-input` and fieldset/legend patterns, so `design:lint` should pass
  with no new component. New strings go to `stages.s67.dealShapePanel` in ko and en.

### 6.3 AI recommendation in the panel

- When `overall.viable` is `null`, the panel shows `판단 보류` with the missing data and no apply button.
- Otherwise the panel shows one card with the overall verdict, its rationale and, when viable, the proposed shapes
  with their rationales.
- **`양식에 채우기`** fills the whole form (viability, shapes, intent, per-shape rationales) and saves nothing.

## 7. Recommend route and prompt (`s7.deal_shape_recommend@2`)

- Output contract:

  ```json
  {"overall":{"viable":true,"intent":"integration","rationale":""},"shapes":[{"shape":"","rationale":""}]}
  ```

- `parseDealShapeRecommendation` replaces `parseShapeRecommendations` and clamps the output as follows:
  1. If `overall` is missing or has a blank rationale, the result is `null`, with note `parse_failed`.
  2. A non-boolean `overall.viable` becomes `null`.
  3. When `viable` is `false` or `null`, `shapes` is forced to `[]` and `intent` to `""`.
  4. When `viable` is `true`, unknown or duplicate shapes and shapes with a blank rationale are dropped. An invalid
     intent becomes `""`, and the person must choose one.
  5. If `viable` is `true` and no valid shape remains, `viable` becomes `null` and the rationale is kept.
  6. Strings are trimmed: rationales to 500 characters, codes to 40.
- Response: `{recommendation: {overall_viable, intent, rationale, shapes[]} | null, note, manifest, prompt_version}`.
- No grounding: with no shortlisted target there is no LLM call, `recommendation: null` and `note: no_shortlist`
  (unchanged). An LLM failure gives `llm_unavailable`.
- The recorded-verdict lines in the user content include the overall row (`전체 불가능 — …`).
- The prompt (`app/web-next/prompts/prompts.json`) changes in three ways. The task is restated as "decide
  overall viability first; list shapes only when viable". The "skip recorded shapes" sentence is dropped, so a
  proposal is always a complete verdict. The output contract changes as above. The boundary and Korean-language
  sections are unchanged. Regenerate `prompts.generated.ts`, and update `tests/eval/call-sites.yaml` for the version
  bump.

## 8. Tests (`tests/unit/`, temp SQLite via `CO_NEWBIZ_DB_PATH`)

- `opportunity-deal-shape.test.ts` (repository and REST): the overall row inserts with NULL shape and intent; a
  second live overall row is rejected by the index; not-viable supersedes all live rows, legacy included; viable
  supersedes the overall row and unselected shapes; an identical set is a no-op; a stale `live_token` returns 409;
  the legacy body, `viable: false` with shapes, and a duplicate or unknown shape each return 400; a body
  `evaluated_by` is ignored; no row is ever deleted; the guard 409 is unchanged.
- Migration test: rebuild a 0188-shaped DB with legacy rows; check row parity, the CHECK on mixed rows, both
  indexes and `foreign_key_check`; run the rollback guard with and without an overall row.
- `kill-criteria-carry.test.ts` and the gate-snapshot tests: one overall row gives present 0 (triggered); an empty
  set gives missing (unassessed); shape rows give N.
- `deal-shape-panel-render.test.ts`: shape and intent disabled before `가능`; the `불가능` branch shows one
  rationale; the `가능` branch shows one rationale per checked shape; the not-viable status; the legacy label;
  `수정` loads the set; the AI card apply fills the whole form; aria-describedby on the disabled groups.
- `deal-shape-view` pure tests: the validation order and the body union.
- `deal-shape-recommend.test.ts`: clamp rules 1 to 6; `no_shortlist` makes no LLM call.
- `mcp-stage-tools.test.ts`: the bodyHint and description text.

## 9. Work breakdown

| Row | Task | Agent (tier / model) | Files |
|-----|------|----------------------|-------|
| 1 | Migration 0198 design review (§3.3 a–f), rollback rehearsal | data-architect (Medium / sonnet), then dba | `db/migrations/0198_deal_shape_overall_verdict.sql` |
| 2 | Repository, routes, recommend parse, openapi/api-spec, MCP spec, seed (one viable shape, no `viable = 0` row) | backend-engineer (High / opus) | `db/repositories/opportunity-deal-shape.repository.ts`, both route files, `mcp/co-newbiz/tools/stage-tools.ts`, `docs/architecture/openapi.yaml`, `api-spec.md`, `scripts/co-newbiz/seed-s1-s12-demo.ts`, prompts + generated |
| 3 | Panel, view lib, i18n ko/en, design-lint | frontend-engineer (Medium / sonnet) | `DealShapePanel.tsx`, `lib/deal-shape-view.ts`, `locales/{ko,en}.json` |
| 4 | Security review: session-only `evaluated_by`, the stale-token path, MCP description, recommend never writes, body size cap | security-engineer (Medium / sonnet) | review only |
| 5 | Procedure and registry wording, flow.spec comment, generated docs, wiki (§11) | process-governance-manager → docs-writer | see §11 |
| 6 | `/sync` | release-engineer | — |

## 10. Risks and rollback

- **Lost update.** Replacing the set could silently drop a colleague's shapes. `live_token` turns this into a 409.
- **Agent wipes the set through MCP.** The token is required and the tool description says a write replaces the set.
  The security review checks both.
- **Legacy rows** read as before until the next write. The one-time listing (`gate-kill-deal-shape.ts`) is
  unaffected.
- **Migration number collision** with ADR-0200 PR-B (§3.3 f).
- **Rollback.** Code and migration roll back together, because old code cannot read NULL shapes. Use the in-place
  ROLLBACK-SQL only when no overall row exists; otherwise restore the backup. Rows recorded after the migration are
  lost on a backup restore (state this in the header).

## 11. Documentation and flow-console checklist

- [ ] `procedures/_shared/brownfield-target-screening/schema.yaml` step 3.5 and completion criterion: "overall
      viability first; when viable, the viable shapes with intent and rationale; an overall not-viable verdict
      (or a legacy set with zero viable shapes) triggers #9". Version 1.1.0 → 1.2.0. Run the policy impact analysis
      and the `project_policy_pin` check (procedure change).
- [ ] `procedures/_kill-criteria/deal-shape-chain__no_viable_deal_shape.json` `notes`: data source sentence (overall
      row = present 0).
- [ ] `process/flow.spec.yaml`:
  - [ ] the S7 `deal-shape-evaluation` comment (overall-first, `@2` recommendation);
  - [ ] the S7 `requiredArtifacts` item 4 wording (`Deal Shape Evaluation (overall viability; viable shapes with
        intent and rationale)`);
  - [ ] a recorded meta version bump with a changelog line.
- [ ] Regenerate: `docs/process-flow.md` (`generate-process-flow.ts`), `lib/pm-catalog.generated.ts`,
      `lib/library.generated.ts` (`sync-library-projection.ts`), `lib/prompts.generated.ts`.
- [ ] `docs/wiki/ko/51-브라운필드-S7-대상-선정.md` §`진출 형태 평가 기록하기` steps 1–4, the result table row and the
      summary bullet: `가능 여부` first, disabled controls, per-shape rationale, `수정`, and AI `전체 판단` first.
- [ ] `docs/adr/README.md` index row for ADR-0201; ADR-0194 and ADR-0195 header "Amended by ADR-0201" notes.

## 12. Open questions (each with a recommendation)

1. **Q1. One intent per viable verdict, or one per shape?** Recommendation: one, as the owner worded it ("the
   intent"). The column stays per row, so a later per-shape intent needs no migration.
2. **Q2. Accept the legacy single-shape POST body for one release?** Recommendation: no. It cannot express set
   semantics, and the only clients (panel, MCP tool) change in the same PR.
3. **Q3. Should the first write after the migration auto-supersede legacy `viable = 0` rows?** Recommendation:
   yes, as in §3.2. They are not part of the new set, and they stay in history.
4. **Q4. Make `live_token` required or optional?** Recommendation: required on both branches. It is the only guard
   against a replace-set write dropping someone else's verdict.
5. **Q5. Enforce the overall/shape mutual exclusivity with triggers in 0198?** Recommendation: no. Enforce it in the
   repository with a test. Triggers complicate the rebuild and rollback, and readers stay correct even if it is
   violated (§3.2).
