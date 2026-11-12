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

**The fix (single edit):** change `latestRouteDecision` (`app/web-next/lib/process-flow.ts:394-411`)
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
`latestRouteDecision` reader set (§2.2 completeness note: ADR-0135 deliberately left other
convention-query sites on the recency definition — §8 follow-up 1); no schema change. This document
is the Row 0 design of record; the Rows 1+ implementation (the one-function change and the pinned
unit suite) has since landed in the working tree — the `latestRouteDecision` SQL
(`process-flow.ts:400`) now carries the `is_current` predicate. The frontmatter status records
where the gate stands.

## 2. Findings: what exists today (verified)

Every claim below was verified against the working tree on 2026-11-11; anchors are file:line.
**Anchor note (added at review close):** the Rows 1+ implementation has since landed —
`latestRouteDecision` (:394-411, SQL at :400) now carries the `is_current` predicate, and
`process-flow.ts` anchors shifted +7 from design time. §2.1 describes the pre-fix state as found;
§3 cites current lines.

### 2.1 The defect chain

1. **Draft rows carry a fresh `decided_at`.** The ADR-0124 draft save (`app/web-next/app/api/opportunities/[id]/route-decision/draft/route.ts:64-68`)
   INSERTs with `status='draft'` in the column list and `decided_at = now` (`now` is stamped at :52
   and passed as the `decided_at` value). A draft saved after the final decision therefore has a
   newer `decided_at` than the final.
2. **`latestRouteDecision` has no currency filter (design-time state).** `app/web-next/lib/process-flow.ts:394-411`,
   SQL at :400: `SELECT id, track, sub_track, alternatives_considered FROM route_decision WHERE
   opportunity_id = ? ORDER BY decided_at DESC, id DESC LIMIT 1` — no `status` filter, no
   `is_current` filter. The newer draft sorts first.
3. **The process view publishes the poisoned track.** `evaluateProcess` (`process-flow.ts:1366-1369`)
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
| latest `decided_at`, drafts included | process engine / TrackGate — `latestRouteDecision` (`process-flow.ts:394-411`, SQL at :400) and all of its callers (§3); outside this fix's scope, three further convention-query sites verified live today (`promote/route.ts:67`, `capability-register-lead.ts:15`, `gate-aging.ts:32` — §8 follow-up 1) | **defective — this fix covers the `latestRouteDecision` reader set only** |
| `is_current = 1` (ADR-0135 authority) | S5 save guard (`greenfield/[oppId]/route.ts:91-93`), `resolveTrack` (`app/web-next/lib/project-track.ts:23-27`), `getCurrentRouteDecision` (`route-decision.repository.ts:69-75`), `routeDecisionId()` in gate-snapshot (`app/web-next/lib/gate-snapshot.ts:1062-1064`); already migrated onto the flag: the greenfield/brownfield list routes (`app/api/greenfield/route.ts:18,23`, `app/api/brownfield/route.ts:15-16,22`) and `buildProjectCharter`'s route read (`lib/project-charter.ts:46-50`) | correct (authority) |

**Completeness note (AI-2nd review):** the latest-decided-at definition is not exclusive to
`latestRouteDecision`. ADR-0135's Scope boundary paragraph (`docs/adr/0135-route-decision-current-row.md:35`)
deliberately left FIVE remaining `ORDER BY decided_at DESC, id DESC LIMIT 1` convention-query sites
unchanged — gate-brief, the greenfield/brownfield lists, project promotion, and the S5
recommendation route — on the argument that they "agree with the flag by construction" (the
backfill used their own ordering). That argument breaks under the ADR-0124 draft scenario (§8):
the backfill ran once, over final rows only, so a draft saved after the backfill outranks the
flagged final in those queries — the exact failure mode this fix removes from the process engine.
Three convention-query sites are verified live in the working tree today:
`app/web-next/app/api/opportunities/[id]/promote/route.ts:67`, `app/web-next/lib/capability-register-lead.ts:15`,
`app/web-next/lib/gate-aging.ts:32` (plus a status-filtered variant at `lib/entry-strategy-draft.ts:94`).
This fix covers the `latestRouteDecision` reader set only; the rest is §8 follow-up 1.

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
  read the authority row, "not through a fresh `ORDER BY decided_at DESC LIMIT 1`". The fix aligns
  the `latestRouteDecision` reader set with the doctrine the codebase itself ships — it does NOT
  make the codebase convention-clean: the ADR-0135 Scope boundary sites above remain on the recency
  definition by deliberate deferral (§2.2 completeness note, §8 follow-up 1).

## 3. Caller impact inventory

`latestRouteDecision` has eight code call sites (one more mention in generated documentation
content, not code). All shift from "latest `decided_at`, drafts included" to the ADR-0135 authority
row. Per ADR-0124 a draft is not a decision, so every shift is toward correct behavior. Line
anchors below are current working-tree lines (post-landing; design-time lines were −7 in
`process-flow.ts`):

| # | Caller | Today | After the fix |
|---|---|---|---|
| 1 | `process-flow.ts:600` — S4 stage-completion predicate | A newer draft satisfies the S4 completion checks (decision present, brownfield `sub_track`, ≥5 criteria scores — the draft path writes scores too, `draft/route.ts:72-87`, alternatives text) | S4 completes only off the authority row — a draft never completes a stage |
| 2 | `process-flow.ts:1366-1369` — opportunity carrier `track`/`subTrack` (consumed by `TrackGate`, stage applicability `:1378`, skipped-status logic) | The defect itself: draft track (or `?? null` → ungated) poisons the process view | TrackGate and the save guard read the same row — the rendered form and the 409 agree |
| 3 | `process-flow.ts:1108-1112` — S11 PMI-kickoff applicability (`pmiKickoffApplies("brownfield", sub_track)`) | A newer draft's `sub_track` (often null mid-draft) decides whether the S11 blocker applies | Authority row's `sub_track` decides |
| 4 | `process-flow.ts:1450-1452` — project-view `subTrack` (post-promotion carrier) | Same draft-poisoning exposure as #3 | Authority row |
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
   that instruction for the `latestRouteDecision` reader set — one of several readers ADR-0135 left
   on the convention (§2.2 completeness note); the remainder is §8 follow-up 1, not part of this
   fix's claim.
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

1. **Deferred convention-query sweep (ADR-0135's Deferred consequence — highest priority) — IN
   IMPLEMENTATION VIA §9 (approved 2026-11-12).**
   Migrate the remaining `ORDER BY decided_at DESC, id DESC LIMIT 1` convention-query sites to
   `is_current = 1`. **First: `app/web-next/app/api/opportunities/[id]/promote/route.ts:67`** — it
   feeds the S7→S8 promotion charter track (the `track` argument to `buildProjectCharter`,
   :66-68): a draft outranking the flagged final stamps the wrong track into the charter and the
   promotion-time `md_project.track` display snapshot. Contained post-promotion — `resolveTrack`
   is fail-closed (a case_type vs route disagreement resolves to track null, basis "conflict") and
   the live resolver owns post-promotion semantics (T-20261022-036) — but it is the same defect
   class, and note the intra-charter split: `buildProjectCharter` itself already reads
   `sub_track`/`rationale`/`intent`/`total_score` from the authority row (`project-charter.ts:46-50`),
   so a draft-poisoned track and an authority sub_track can coexist inside one charter version.
   Then the other two verified-live sites: `app/web-next/lib/capability-register-lead.ts:15`
   (S3 capability-register lead attribution flips greenfield-agent/brownfield-agent on a draft
   outranking the final; its header note "a route decided later never rewrites past runs" bounds
   the blast radius to runs after the draft save, but the query is the same convention) and
   `app/web-next/lib/gate-aging.ts:32` (opportunity track label in the 90-day gate-aging view).
   Finally, re-derive the residual list from a fresh grep rather than ADR-0135's historical
   five-name list: of the ADR-named sites, the greenfield/brownfield list routes
   (`app/api/greenfield/route.ts:18,23`, `app/api/brownfield/route.ts:15-16,22`) and the charter
   route read (`project-charter.ts:46-50`) have already been migrated onto the flag (verified
   live), and gate-brief carries no route_decision convention query today (:825 comment, :844
   prompt string only); a status-filtered cousin remains at `lib/entry-strategy-draft.ts:94`
   (draft-excluded, so no draft poisoning, but it still derives "current" from recency — include
   it in the sweep for definitional convergence). **Why the sweep is needed at all:** ADR-0135's
   Scope boundary argues the deferred sites "agree with the flag by construction" because the
   backfill used their own ordering — but the backfill ran ONCE, over final rows only. Under the
   ADR-0124 draft scenario, a draft saved after the backfill carries a newer `decided_at` and
   outranks the flagged final in those queries; the by-construction argument holds only while no
   draft postdates the backfill, i.e. it fails exactly when this fix's failure mode occurs.
2. **Consolidation and shape hygiene.** Point `latestRouteDecision` at `getCurrentRouteDecision`
   once the return-shape question is settled — one authority read, one implementation; as part of
   the same pass, simplify the now-redundant `gate-snapshot.ts:1062-1065` dual read (the
   `latestRouteDecision` fallback is behaviorally dead post-fix — §3 row 7), and normalize the
   bun:sqlite return-type annotation: `latestRouteDecision` returns `... | undefined` (bun:sqlite
   `.get()` semantics) while `getCurrentRouteDecision` returns `RouteDecisionRead | null` — the
   divergence is currently only by annotation, and explicit, consistent annotations keep callers
   from conflating the two shapes.
3. The `status` column's remaining role (draft upsert targeting in `getDraftRouteDecision` /
   finalize-upsert in the finalize route) stays as is; a future cleanup could derive draft
   targeting from `is_current = 0 AND superseded_by IS NULL AND status = 'draft'`, but that is
   schema-adjacent design work outside this ruling.

## 9. Implementation: deferred convention-query sweep

§8 follow-up item 1 moves to implementation (approved 2026-11-12). This section is the Row 0
record for that dispatch per the Design Gate (ADR-0074); §8 remains the follow-up register and
item 1 is marked "in implementation via §9" there — it closes only when this sweep lands. The
sweep migrates the remaining `ORDER BY decided_at DESC, id DESC LIMIT 1` convention-query sites
onto the ADR-0135 authority semantics, closing the same defect class this document already fixed
for the `latestRouteDecision` reader set: under the ADR-0124 draft scenario, a draft saved after
the backfill carries a newer `decided_at` and outranks the flagged final in any such query.

### 9.1 Site inventory and audit (verified on origin/main, 2026-11-12)

Per §8 item 1's instruction, the residual list was re-derived from a fresh grep on `origin/main`
(`FROM route_decision` across `app/web-next`, excluding tests and generated content), not from
ADR-0135's historical five-name list. Each site audited before this section was written:

| Site | Current query on origin/main | Verdict | Rationale |
|---|---|---|---|
| `app/web-next/app/api/opportunities/[id]/promote/route.ts:67` | `SELECT track FROM route_decision WHERE opportunity_id = ? ORDER BY decided_at DESC, id DESC LIMIT 1` — no filter | **migrate** | Feeds the S7→S8 promotion charter track (`buildProjectCharter`'s `track` argument, :66-68) and the origin-hint guard (:79-81). A draft outranking the flagged final stamps the wrong track into the charter and the promotion-time `md_project.track` snapshot (§9.2) |
| `app/web-next/lib/capability-register-lead.ts:15` | same convention query — `SELECT track FROM route_decision WHERE opportunity_id = ? ORDER BY decided_at DESC, id DESC LIMIT 1` | **migrate** | S3 capability-register lead attribution (`greenfield-agent`/`brownfield-agent`) flips on a draft outranking the final; the header note "a route decided later never rewrites past runs" bounds the blast radius to runs after the draft save, but the query is the same convention |
| `app/web-next/lib/gate-aging.ts:32` | correlated subquery inside the aging SQL — `(SELECT track FROM route_decision WHERE opportunity_id = g.entity_id ORDER BY decided_at DESC, id DESC LIMIT 1)` | **migrate** | The opportunity track label in the 90-day gate-aging view reads the draft; the project branch of the same `COALESCE` reads `md_project.track` and needs no change |
| `lib/gate-brief.ts` (ADR-0135-named) | no `route_decision` convention query exists — :825 is a comment, :844 a prompt string | **already-safe (no site)** | The ADR-0135-named site does not exist in the current tree; gate-brief's own route read goes through `getCurrentRouteDecision` (authority row, `gate-brief.ts:291`) |
| `app/web-next/app/api/greenfield/route.ts:18,23` | correlated subqueries with `AND rd.is_current = 1` | **already-safe** | Already reads the authority row |
| `app/web-next/app/api/brownfield/route.ts:15-16,22` | correlated subqueries with `AND rd.is_current = 1` | **already-safe** | Already reads the authority row |
| `app/web-next/lib/entry-strategy-draft.ts:94` (S5 recommendation — ADR-0135's status-filtered variant) | `... WHERE opportunity_id = ? AND status = 'final' ORDER BY decided_at DESC, id DESC LIMIT 1` | **already-safe — no change** | Draft-excluded: a `status='final'` row can never lose to a draft, so the ADR-0124 draft-poisoning scenario cannot occur. §8 item 1's "include for definitional convergence" note is deferred to the §8 item 2 consolidation pass; only genuinely-defective sites migrate in this sweep |

Three sites migrate; the rest are recorded as already-safe above.

### 9.2 The `md_project.track` poisoning scenario and its containment (promote route)

The promote route is migrated FIRST. The defect scenario: an S4 draft (ADR-0124) saved after the
flagged final carries a newer `decided_at`, so the route's unfiltered convention query returns the
**draft's** track; that track is passed as `buildProjectCharter`'s `track` argument
(`promote/route.ts:66-68`) and the guard at :79-81 evaluates the establishment-mode hint against
it — a greenfield draft on a brownfield deal lets a greenfield charter be built and can admit a
hint that the flagged final would refuse. At promotion the wrong track lands in the
promotion-time `md_project.track` display snapshot.

Containment (why this is a defect, not a catastrophe): post-promotion track semantics belong to
the live resolver `resolveTrack` (`app/web-next/lib/project-track.ts:23-27`), which is
fail-closed — a `case_type` vs route disagreement resolves to `track: null`, basis `"conflict"`,
and the PMI/S11/S12 guards treat null as unresolved (T-20261022-036). The poisoning is therefore
bounded to the charter version and the display snapshot, not to downstream gating. Note the
intra-charter split recorded in §8 item 1: `buildProjectCharter` itself already reads
`sub_track`/`rationale`/`intent`/`total_score` from the authority row
(`project-charter.ts:46-50`), so today a draft-poisoned track and an authority sub_track can
coexist inside one charter version — this sweep removes that split.

**Fix shape:** replace the raw query with `latestRouteDecision(id)?.track ?? null` — the call
site's semantics ("which decision is current for this opportunity") match `latestRouteDecision`'s
post-fix behavior exactly (§9.3 doctrine), and the import adds one line to the route handler.

### 9.3 Fix doctrine

- **Prefer reusing `latestRouteDecision`** (`app/web-next/lib/process-flow.ts:394-411`, now the
  authority-row reader) wherever the call site's semantics match exactly: the caller wants "the
  current decision" and nothing else. `promote/route.ts:67` and
  `capability-register-lead.ts:15` both meet this bar and are converted to the shared reader —
  one authority definition, reused, instead of a third and fourth copy of the predicate.
- **Keep a raw ordered query ONLY where the caller genuinely needs history semantics.** Audited
  against this sweep's sites: none does. `entry-strategy-draft.ts:94` derives the S5 form's
  baseline from the latest final, which is current-decision semantics already satisfied by its
  status filter (already-safe, no change); no site in this sweep consumes decision *history*.
- **Documented structural exception:** `gate-aging.ts:32` cannot call a TypeScript function from
  inside a SQL correlated subquery, so it keeps its raw query shape and gains the
  `AND is_current = 1` predicate instead. The exception is structural (SQL context), not
  semantic — the query still means "the current decision". Any future exception to the doctrine
  must be recorded in the design doc of the change that introduces it.

### 9.4 Test plan

Per-site unit assertions extend `tests/unit/route-decision-current-authority.test.ts` (the suite
pinned by this document, §5 pattern: scratch SQLite, `resetDb()` + `runMigrations()`, direct
INSERT fixtures driving currency through `finalizeRouteDecisionCurrency` where possible). The
shared invariant asserted at EVERY migrated site: **a draft with a newer `decided_at` must not
win** — seed a final row, then a `status='draft'` row with a later `decided_at` and a different
track, and assert the site reads the final's track:

1. **Promotion** — draft-greenfield-after-final-brownfield: the route builds the charter with the
   brownfield track, and the hint guard evaluates against brownfield (a hint that brownfield
   would refuse still 400s).
2. **Capability register lead** — same fixture: `capabilityRegisterLead` returns
   `brownfield-agent`.
3. **Gate aging** — same fixture: the opportunity row's `track` label is the final's track.

Affected suites to rerun (the implementer must run these): `project-promotion`,
`promotion-heading` (promotion charter track), `gate-aging-track` (aging view),
`process-blocker-keys` and the capability register suites (`capability-s3-simplification`,
`capability-ai-drafts`, `capability-ai-sources` — both lead-consuming routes
`capability-gap/llm-draft` and `capability-gap/holding-check`), plus the greenfield/brownfield
list route suites already covered by §5's regression watch (they are already-safe; the rerun
guards against fixture drift). No test seeds an un-flagged draft-only expectation for these three
sites today; if the rerun surfaces one, the fixture is wrong, not the migration.

- **Completion (2026-11-12)**: case 1 is pinned at the route level by
  `tests/unit/promotion-charter-track-e2e.test.ts` — the real
  `POST /api/opportunities/[id]/promote` handler dispatched end-to-end
  (next-route-dispatch with an analyst login, entry-market-derivation dispatch
  pattern; the sweep's existing case-1 assertion was expression-level): with a
  greenfield `is_current=1` final plus a newer brownfield ADR-0124 draft, the
  response track, the `md_project.track` snapshot, and the charter-track input
  inside `charter_json` all read the final; a greenfield-only establishment
  hint is accepted on that authority (positive control) and the same hint
  still 400s `mode_not_allowed` when the authority is brownfield even with a
  newer greenfield draft (3 pass). Cases 2–3 remain the lib-level assertions in
  `route-decision-current-authority.test.ts`; the route-level dispatch lives in
  its own file because it needs the login/CSRF machinery.

### 9.5 Non-goals

- **No schema change** — `is_current` exists (0101) and is maintained by
  `finalizeRouteDecisionCurrency`; no migration.
- **The S3 AI calibration fix is a separate spec** — the synergy AI calibration draft's
  live-register read is amended in
  `docs/designs/2026-10-18-synergy-4element-design.md` (Amendment 2026-11-12); it shares no code
  path with this sweep.
- **No UI changes** — gate-aging's track label and the promotion response shape are unchanged;
  only which row feeds them moves.
- No change to `resolveTrack`, the S5 save guard, or `getDraftRouteDecision` (§3.1 stands).
