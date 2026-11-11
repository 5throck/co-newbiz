---
title: Route-decision current authority — latestRouteDecision reads the ADR-0135 is_current row
date: 2026-11-11
status: Implemented (Row 0 — Design Gate ADR-0074; Rows 1+ code and tests landed in the working tree; AI-2nd cross-domain review passed, its documentation corrections applied in this revision — pending human final approval)
owner: platform-lead (design); implementation by backend-engineer (PM dispatch)
reviewers_required: process-governance-manager (AI-2nd, functional domain — stage/track semantics; author is technical domain), owner (human approval)
decision_record: docs/decisions/DEC-20261111-04.md
related: ADR-0124 (S4 draft/final split), ADR-0135 (route-decision authority row, migration 0101), ADR-0069 (Next.js stack), ADR-0074 (Design Gate), ADR-0161 (resolveTrack — the ONE shared track resolver), ADR-0186 (gate ladder), T-20261022-007 (server stays authoritative on S5 write), db/migrations/0088_route_decision_draft.sql, db/migrations/0101_route_decision_current.sql
---

# Route-decision current authority — latestRouteDecision reads the ADR-0135 is_current row

## 1. Scope and inputs

One defect, one fix. The S5 page on a brownfield deal rendered the Greenfield entry-strategy form
and its save failed with 409 `not_applicable_track`, while S4 showed the current decision as
brownfield. Root cause verified in code (§2): `latestRouteDecision` — the process engine's track
source — has no status/is_current filter, so an ADR-0124 draft row saved after the final decision
sorts first and its track poisons the process view that `TrackGate` consumes, while the S5 save
guard reads the ADR-0135 authority row and (correctly) refuses.

**The fix (single edit):** change `latestRouteDecision` (`app/web-next/lib/process-flow.ts:387-404`)
to read the ADR-0135 authority row:

```sql
SELECT id, track, sub_track, alternatives_considered
FROM route_decision
WHERE opportunity_id = ? AND is_current = 1
LIMIT 1
```

Function signature, return type, and export stay unchanged. No schema migration — `is_current`
already exists (0101), is backfilled, and is unique-per-opportunity by partial index.

**Out of scope (non-goals):** no change to the S4 draft UX (`getDraftRouteDecision`); no change to
the S5 save guard; no data migration; no change to any other reader of `route_decision` beyond the
one function; no schema change. Implementation (code + tests) lands in a separate dispatch — this
document is Row 0 only.

## 2. Findings: what exists today (verified)

Every claim below was verified against the working tree on 2026-11-11; anchors are file:line.

**Anchor note:** the implementation has since landed in the working tree with a **+7 line shift**; the anchors in §2.1 (and in the §3 table) document the pre-fix state.

### 2.1 The defect chain

1. **Draft rows carry a fresh `decided_at`.** The ADR-0124 draft save (`app/web-next/app/api/opportunities/[id]/route-decision/draft/route.ts:64-68`)
   INSERTs with `status='draft'` in the column list and `decided_at = now` (`now` is stamped at :52
   and passed as the `decided_at` value). A draft saved after the final decision therefore has a
   newer `decided_at` than the final.
2. **`latestRouteDecision` has no currency filter.** `app/web-next/lib/process-flow.ts:394`:
   `SELECT id, track, sub_track, alternatives_considered FROM route_decision WHERE opportunity_id = ?
   ORDER BY decided_at DESC, id DESC LIMIT 1` — no `status` filter, no `is_current` filter. The
   newer draft sorts first.
3. **The process view publishes the poisoned track.** `evaluateProcess` (`process-flow.ts:1359-1362`)
   sets the opportunity carrier's `track`/`subTrack` from `latestRouteDecision(entity.id)` with the
   `?? null` fallback. The stage page's `CarrierStageBody` reads `proc.track` (`app/web-next/app/deals/[id]/[stage]/page.tsx:117`),
   and `TrackGate` (:51-90) skips gating entirely when `track` is null (:67 `if (track && track !== only)`).
   So a greenfield draft supplies the wrong non-null track (Greenfield form renders on a brownfield
   deal), and the `?? null` fallback is the second path to the same failure on carrier data with no
   readable decision (null track → S5 renders ungated).
4. **The save guard reads a different row.** The S5 write surface
   (`app/web-next/app/api/greenfield/[oppId]/route.ts:91-96`) reads
   `SELECT track FROM route_decision WHERE opportunity_id = ? AND is_current = 1 LIMIT 1`
   (T-20261022-007: the server must not trust the client's TrackGate), sees the brownfield
   authority row, and returns 409 `not_applicable_track` (:94-96). Render gate and save guard
   disagree because they read two different definitions of "current decision".

### 2.2 Three definitions of "current decision" are live today

| Definition | Readers | Verdict |
|---|---|---|
| `ORDER BY is_current DESC` first | S4 history list — `listRouteDecisionsWithScores` (`db/repositories/route-decision.repository.ts:60`: `ORDER BY is_current DESC, decided_at DESC, id DESC`, status='final' only per ADR-0124 :50-54) | correct |
| latest `decided_at`, drafts included | process engine / TrackGate — `latestRouteDecision` (`process-flow.ts:394`) and all of its callers (§3) | **defective — this fix** |
| `is_current = 1` (ADR-0135 authority) | S5 save guard (`greenfield/[oppId]/route.ts:91-93`), `resolveTrack` (`app/web-next/lib/project-track.ts:23-27`), `getCurrentRouteDecision` (`route-decision.repository.ts:69-75`), `routeDecisionId()` in gate-snapshot (`app/web-next/lib/gate-snapshot.ts:1062-1064`), plus the four sites already migrated onto the flag (greenfield/brownfield lists, project-charter) | correct (authority) |

**Completeness note (reader-set scope).** This fix covers the `latestRouteDecision` reader set
only — it is not a claim that every convention-query reader of `route_decision` is now fixed.
ADR-0135's Scope boundary paragraph (`docs/adr/0135-route-decision-current-row.md`, :35 anchor)
deliberately left **FIVE** remaining `ORDER BY decided_at DESC, id DESC LIMIT 1` convention-query
sites unchanged (gate-brief, greenfield/brownfield lists, project promotion, S5 recommendation);
the verified-live sites in the current working tree are
`app/web-next/app/api/opportunities/[id]/promote/route.ts:67`, `app/web-next/lib/capability-register-lead.ts:15`,
and `app/web-next/lib/gate-aging.ts:32`. Note explicitly: ADR-0135's "agree with the flag by
construction" argument breaks under the ADR-0124 draft scenario — a draft saved after the backfill
outranks the flagged final in those queries.

### 2.3 The authority infrastructure already exists (ADR-0135)

- Migration `db/migrations/0101_route_decision_current.sql` adds `is_current` + `superseded_by`,
  backfills `is_current = 1` for **exactly one latest-final row per opportunity** (backfill ①,
  :28-34), chains superseded finals via `superseded_by` (backfill ②, :38-46), and enforces
  at-most-one current row with the partial unique index `idx_route_decision_current` (:50). Drafts
  never carry `is_current = 1` (:48-49 comment).
- Its header comment (:11-13) states the failure mode in so many words: opportunity-level
  `ORDER BY decided_at DESC, id DESC LIMIT 1` convention queries that do not follow the flag
  "can quietly read a stale decision" (`조용히 낡은 결정을 읽을 수 있었다`), and (:19) that
  **gate/stage logic must read the `is_current=1` row as authority** (`게이트/스테이지 로직만
  is_current=1 행을 권위로 읽는다`). `latestRouteDecision` is precisely such a leftover convention
  query — it predates 0101 and was never migrated onto the flag.
- `finalizeRouteDecisionCurrency` (`route-decision.repository.ts:81-95`) is called in the same
  write path as every finalize (`app/web-next/app/api/opportunities/[id]/route-decision/route.ts:165`),
  so a finalized decision — including a draft promoted through the finalize-upsert path (:136-151) —
  always becomes the `is_current = 1` row.
- Migration 0088 (`db/migrations/0088_route_decision_draft.sql`, header :7-10) rebuilt the table
  with `status='final'` on all legacy rows, so a `status='final'` filter would also work
  functionally — see §4 for why `is_current = 1` is nonetheless the ruling.
- The generated doctrine already prescribes the convention: the S4 Route Decision Currency shared
  note (generated content at `app/web-next/lib/library.generated.ts:2375`) tells implementers to
  read the authority row, "not through a fresh `ORDER BY decided_at DESC LIMIT 1`". This fix
  covers the `latestRouteDecision` reader set only — it aligns that reader set with the doctrine
  the codebase itself ships; it does not claim to be the last defective reader or to fix every
  convention-query site (see the §2.2 completeness note).

## 3. Caller impact inventory

`latestRouteDecision` has eight code call sites (one more mention in generated documentation
content, not code) — in the current working tree: `process-flow.ts:600`, `process-flow.ts:1108-1112`,
`process-flow.ts:1366-1369`, `process-flow.ts:1450-1452`, `gate-ladder.ts:36`,
`gate-snapshot.ts:1015`, `gate-snapshot.ts:1065`, `ic-package/route.ts:305` — matching the table
below (whose anchors document the pre-fix state; see the §2 anchor note). All shift from "latest
`decided_at`, drafts included" to the ADR-0135 authority
row. Per ADR-0124 a draft is not a decision, so every shift is toward correct behavior:

| # | Caller | Today | After the fix |
|---|---|---|---|
| 1 | `process-flow.ts:593` — S4 stage-completion predicate | A newer draft satisfies the S4 completion checks (decision present, brownfield `sub_track`, ≥5 criteria scores — the draft path writes scores too, `draft/route.ts:72-87`, alternatives text) | S4 completes only off the authority row — a draft never completes a stage |
| 2 | `process-flow.ts:1360-1362` — opportunity carrier `track`/`subTrack` (consumed by `TrackGate`, stage applicability `:1371`, skipped-status logic) | The defect itself: draft track (or `?? null` → ungated) poisons the process view | TrackGate and the save guard read the same row — the rendered form and the 409 agree |
| 3 | `process-flow.ts:1102-1104` — S11 PMI-kickoff applicability (`pmiKickoffApplies("brownfield", sub_track)`) | A newer draft's `sub_track` (often null mid-draft) decides whether the S11 blocker applies | Authority row's `sub_track` decides |
| 4 | `process-flow.ts:1443-1445` — project-view `subTrack` (post-promotion carrier) | Same draft-poisoning exposure as #3 | Authority row |
| 5 | `gate-ladder.ts:36` — `ladderFor(track)` for opportunity gates | A newer draft selects the wrong ladder (e.g. `pre_fs` vs `target_screening` predecessor requirements) | Authority row selects the ladder |
| 6 | `gate-snapshot.ts:1013-1015` — `buildGateSnapshot` track for **opportunity** snapshots, which selects the kill-procedure set (`OPPORTUNITY_PROCEDURES[o.gate](track)`, :1038) and the `outOfTrack` filters (:1033, :1041) | A newer draft silently re-points gate kill-procedures to the wrong track's set | Authority row. **Implementer note (§6):** surrounding context read confirms nothing intentionally relied on draft visibility — `track` here is used only to pick procedure lists and filter out-of-track outcomes; no branch, label, or stored artifact keys on "the draft's track". The project branch of the same function (:1013-1014) already resolves via `resolveTrack` (authority), so the two carrier types converge |
| 7 | `gate-snapshot.ts:1065` — `routeDecisionId()` fallback | `current?.id ?? latestRouteDecision(opp)?.id ?? null` — belt-and-suspenders over two definitions | The fallback becomes behaviorally dead: after the fix, `latestRouteDecision` returns a row exactly when the `is_current = 1` read at :1062-1064 does. Simplify to the single `is_current` read (optional; keeping it is harmless). **Confirm no fixture depends on the fallback before removing** — after 0101's backfill a final-without-flag row cannot exist on a migrated DB |
| 8 | `ic-package/route.ts:305` — S11 IC-package `pmi_kickoff.sub_track` | A newer draft's `sub_track` shows in the IC package and feeds `pmiKickoffApplies` | Authority row |
| — | `library.generated.ts:2375` | Generated documentation content (the shared-note text), not code | No change; ignore |

### 3.1 Readers intentionally NOT changed

- `getDraftRouteDecision` (`route-decision.repository.ts:99-107`) — the S4 draft UI's upsert read; drafts are its subject.
- `listRouteDecisionsWithScores` (`route-decision.repository.ts:55-64`) — already `is_current DESC`-first.
- The S5 save guard (`greenfield/[oppId]/route.ts:91-96`) — already the authority definition; it is the half of the disagreement that was right.
- `resolveTrack` (`project-track.ts:23-27`) and `getCurrentRouteDecision` (`route-decision.repository.ts:69-75`) — already the authority definition.

## 4. Why `is_current = 1` and not `status = 'final'`

1. **0101's header is the direction of record.** The migration that introduced the flag explicitly
   warns that convention queries like `latestRouteDecision` "can quietly read a stale decision" and
   states gate/stage logic must read the `is_current=1` row as authority (§2.3). This fix executes
   that instruction for the `latestRouteDecision` reader set only — it is not a claim that this was
   the one reader left behind; the sites ADR-0135's scope boundary deliberately left unchanged are
   recorded in §2.2's completeness note.
2. **It converges the readers that must agree.** `is_current = 1` aligns `latestRouteDecision` with
   the two readers already on the authority definition (S5 save guard, `resolveTrack`). That makes
   the TrackGate and the save guard read the SAME row — which is exactly the failure mode being
   fixed (render gate says greenfield, save guard says brownfield).
3. **`status='final'` would also work but keeps two definitions.** Migration 0088 stamped
   `status='final'` on all legacy rows, so a status filter would be correct today by construction —
   but only coincidentally: it would remain a second, parallel way of deriving "current" that
   `finalizeRouteDecisionCurrency` happens to keep in sync, and the codebase would still carry two
   definitions of the same concept. `is_current` is the established authority marker with a partial
   unique index guaranteeing at most one row; the fix reduces the system to one definition.

## 5. Test plan (documented here; implementation is a separate dispatch)

New unit test file `tests/unit/route-decision-current-authority.test.ts`, following the existing
db-backed unit-test pattern of `tests/unit/process-predicate-alignment.test.ts` (:22-33): scratch
SQLite via `process.env.CO_NEWBIZ_DB_PATH`, `resetDb()` + `runMigrations()` before dynamic imports,
seed rows with direct INSERTs on the migrated schema.

Cases:

1. **Draft newer than the final** — insert a final row, then a `status='draft'` row with a later
   `decided_at` and a different track; `latestRouteDecision` returns the **final's** track, not the
   draft's.
2. **Only a draft exists** — returns `undefined`.
3. **Older superseded final** — an older `is_current = 0` final (with the authority row present)
   — returns the current row; an opportunity whose only final is superseded (no `is_current = 1`
   row) returns `undefined`.
4. **Fixture hygiene** — prefer driving currency through `finalizeRouteDecisionCurrency`
   (`route-decision.repository.ts:81`) in fixtures rather than hand-setting `is_current`, unless
   the helper cannot be used in the test setup (it is a plain function on the db handle, so it
   should be usable in all cases here); hand-set flags only where the test specifically exercises
   a non-currency row shape.

Regression watch (the implementer must run these suites): the process/route/gate/greenfield/
brownfield families — at minimum `process-flow`, `process-predicate-alignment`, `process-blocker-keys`,
`process-ssot-check`, `gate-sequence-view`, `gate-decisions-ic-sequence`, `gate-snapshot-p2`,
`gate-effective-consumers`, `greenfield-route-track-guard`, `greenfield-scorecard-route`,
`greenfield-subtrack`, `greenfield-execution`, `greenfield-investment-save`, `brownfield-route-track-guard`,
`brownfield-capability-judgement`, `route-decision-history-view`, `route-migration-pending`,
`route-recommendation`, `s7-eval-save-and-gate-hint`, `s9-depth-routes`. Rationale: fixtures that
INSERT `route_decision` rows **without** `is_current` will now read as "no decision" and may need
repair. A pre-implementation audit found 78 test files seeding `route_decision`; 76 already set
`is_current` explicitly. The two that do not:
- `tests/unit/migration-0073.test.ts:45` — seeds raw rows to test migration mechanics; not expected
  to touch `latestRouteDecision`, but confirm.
- `tests/unit/project-delete.test.ts:69` — seeds a brownfield decision for delete-cascade testing;
  confirm no assertion depends on track resolution through the un-flagged row.

## 6. Accessibility

No user-facing interaction surface changes. The S5/S6/S7 screens, `TrackGate`, forms, and the S4
draft UI render exactly as designed — the fix changes only which row feeds the gate, so the
already-implemented accessibility behavior (keyboard, focus, ARIA, contrast) is untouched. The
user-visible change is corrective: the correct track's form appears and saves succeed, removing a
failure state (409 after filling a form) that is itself an error-recovery burden (Universal Design:
tolerance for error).

## 7. Alternatives considered

1. **`status = 'final'` filter instead of `is_current = 1`** — rejected; §4 item 3. Correct today
   by construction, but it preserves two parallel definitions of "current" and ignores the explicit
   ADR-0135 instruction to treat the flag as authority.
2. **Client-side TrackGate hardening only** (cross-check the S4 decision in the page before
   rendering) — rejected. T-20261022-007 already established the principle for this exact surface:
   the server stays authoritative; the client gate is convenience, not the control. A client-only
   fix would leave every other consumer of the poisoned process view (ladder, snapshot, S4/S11
   predicates, IC package) reading drafts as decisions.
3. **Backfilling `decided_at` on drafts** (e.g. stamp drafts with a sentinel past timestamp or
   exclude drafts by `ORDER BY` trickery) — rejected. It masks the definition split instead of
   removing it: the query would still mean "newest row, whatever that is", drafts would still be
   candidates, and every future convention query would inherit the same trap. Also touches stored
   data timestamps, which the non-goals exclude.
4. **Delegating to `getCurrentRouteDecision`** (repository, `route-decision.repository.ts:69`) —
   noted, not taken. The repository helper already reads the authority row, and the generated
   shared note names it as the canonical read; but the ruling fix keeps `latestRouteDecision`'s
   inline query shape so the function's signature, return type, and import graph stay byte-stable
   for its eight callers. The delegation remains a reasonable later consolidation (its richer
   `RouteDecisionRead` shape with scores would change the return surface), recorded as a follow-up,
   not part of this fix.

## 8. Follow-ups

1. **Deferred convention-query sweep** — migrate the remaining `ORDER BY decided_at DESC, id DESC
   LIMIT 1` convention-query sites named in §2.2's completeness note. Migrate
   `app/web-next/app/api/opportunities/[id]/promote/route.ts:67` FIRST: it feeds the S7→S8
   promotion charter track and the origin hint — a draft outranking the flagged final can poison
   `md_project.track` at promotion; contained post-promotion by `resolveTrack`'s fail-closed
   conflict basis, but the same defect class. Then `app/web-next/lib/capability-register-lead.ts:15`
   and `app/web-next/lib/gate-aging.ts:32`, plus the ADR-0135-named residual re-derivation sites
   (four of five already migrated; the `entry-strategy-draft.ts:94` status-filtered variant
   included) — remembering that ADR-0135's "agree with the flag by construction" argument breaks
   under the ADR-0124 draft scenario: a draft saved after the backfill outranks the flagged final
   in those queries.
2. **Known follow-ups from this fix:** (a) gate-snapshot `routeDecisionId` fallback
   simplification — after the fix, the `:1062-1064` `is_current` read makes the `:1065`
   `latestRouteDecision` fallback behaviorally dead; (b) the bun:sqlite `| undefined` vs `| null`
   return-type annotation on `latestRouteDecision` — bun:sqlite `.get()` returns `null`; all
   callers are nullish-safe; tests assert via `toBeFalsy()`.
3. Optional consolidation: point `latestRouteDecision` (and the `gate-snapshot.ts:1062-1065` dual
   read) at `getCurrentRouteDecision` once the return-shape question is settled — one authority
   read, one implementation.
4. The `status` column's remaining role (draft upsert targeting in `getDraftRouteDecision` /
   finalize-upsert in the finalize route) stays as is; a future cleanup could derive draft
   targeting from `is_current = 0 AND superseded_by IS NULL AND status = 'draft'`, but that is
   schema-adjacent design work outside this ruling.
