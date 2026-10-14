---
title: S3-S8 required-capability linkage (single source, stale judgements, S8 read-only levels)
status: accepted
date: 2026-10-14
owner: platform-lead
lang: ko
lang_reason: source-material
---

# S3-S8 required-capability linkage

Korean appears only as UI labels in backticks. All prose is English.

- Decider: human decider, chat 2026-10-14 (binding decisions D1-D3 below). Drafted by platform-lead.
- ADR: [ADR-0170](../adr/0170-s3-s8-capability-linkage.md) (Accepted 2026-10-14).
- Builds on: ADR-0168 (S8 attainability, register JSON extension), ADR-0169 (technical lens, `serializeGapRegister` single write path), ADR-0136 (S5 fills levels on the S3 register), ADR-0143 (Brown Field per-target judgements).

## 1. Problem statement

The S8 attainability judgement (ADR-0168) lives on the same S3 register row it judges (`opportunity.capability_gap_json`). Two defects follow from the current code (paths relative to `app/web-next/`):

1. **S8 writes S3-owned facts.** `applyAttainabilityPatches` accepts `requiredLevel`, `currentLevel` and `resolution` and writes them back into the shared row (`lib/capability-attainability.ts`, `AttainabilityPatch` and the `"requiredLevel" in raw` / `"currentLevel" in raw` branches). The S8 panel renders both levels as editable `LevelSelect` controls (`components/stages/CapabilityAttainabilityPanel.tsx:200-201`). S8 can therefore silently redefine the requirement it is judging.
2. **An S3 change does not reach S8.** The S3 save (`PUT /api/opportunities/[id]/capability-gap`) carries the stored judgement over by row id (`carryOverAttainability`, `lib/capability-gap.ts`) regardless of what changed. A row whose capability, required level or held status changed keeps its confirmed `높음` grade. A row deleted in S3 loses its judgement without trace, because `carryOverAttainability` only maps surviving ids.

Other register writers that change S3 content without going through S3 PUT: `lib/synergy-pipeline.ts:524-540` (appends `synergy_area` rows) and `scripts/co-newbiz/backfill-capability-gap.ts:95`. Any detection must therefore be computed from content, not hooked into one route.

## 2. Binding decisions (decider, chat 2026-10-14)

- **D1 - S3 is the single source; S3 change invalidates S8.** When S3 content of a row changes, its S8 judgement is invalidated: confirmation cleared, flagged `S3 변경 — 재판정 필요`, the prior judgement kept visible as history (never deleted), and a person must re-judge and re-confirm.
- **D2 - S8 must not change S3-owned items.** `capability`, `requiredNote`, held status/holders/evidence, `requiredLevel`, `currentLevel` are read-only in S8 (editable only in S3/S5). S8 owns only attainability: `resolution`, cost, months, grade, rationale (legacy `evidence`), draft/confirm metadata.
- **D3 - Brown Field uses a different change detection** (per target). The exact basis is the one open decision (section 9, OD-1).

## 3. Field ownership

| Field | Owner | Edited in | In S3 row hash |
|---|---|---|:-:|
| `id` | system | - | no (key) |
| `capability` | S3 | S3 | yes |
| `requiredNote` | S3 | S3 | yes |
| `held.status` | S3 | S3 | yes |
| `held.holders` (sorted) | S3 | S3 | yes |
| `held.evidence` | S3 | S3 | yes |
| `requiredLevel` | S3 (filled by S5, ADR-0136) | S3 / S5 | yes |
| `currentLevel` | S3 (filled by S5) | S3 / S5 | yes |
| `source` | S3 | - | no (provenance only, does not change the requirement) |
| `note` | S3 | S3 | no (free memo; see OD-3) |
| `resolution` | S8 (D2) | S8 | no |
| `attainability.*` | S8 | S8 | no |
| `technicalLens` (register-level key) | S8 | S8 | no |

`resolution` is currently also edited on the S3/S5 screens. D2 makes S8 the owner; S3/S5 keep showing it read-only after slice 1 (OD-2 covers the transition).

## 4. Design

### 4.1 Row revision hash (Green Field and the opportunity-level judgement)

- `capabilityRowHash(row)`: SHA-256 (first 16 hex chars) over a canonical JSON of the hashed fields in section 3, in fixed key order, strings trimmed, `holders` sorted, empty and missing treated alike. Pure function in `lib/capability-gap.ts`; versioned with a prefix (`v1:`) so a later field change is a deliberate migration of meaning, not a silent mass invalidation.
- **Stamp at judgement time.** `attainability.basisHash` (new optional field) is set to the current row hash whenever S8 saves a judgement change or confirms. It is computed server-side; any client-sent `basisHash` is ignored (same carry-over rule as ADR-0168 D3).
- **Stale is derived, not stored.** `stale = attainability exists AND basisHash !== capabilityRowHash(row)`. Computed on read in `rowView` / `attainabilitySummary`. Because it is derived, every writer (S3 PUT, S5, synergy pipeline, backfill script, a future MCP writer) triggers it without any change to those writers.
- **Invalidation is materialised on the next S3-side write.** Derived staleness is enough for display, but D1 requires the confirmation to be cleared. On every register write, a shared helper `invalidateStaleJudgements(rows, at)` (called from `serializeGapRegister`'s callers via one wrapper, so the single write path from ADR-0169 stays single) moves each stale row's current judgement into `attainability.history[]` (`{grade, closingCostKrwM, monthsToAttain, rationale, evidence, resolution, confirmedBy, confirmedAt, basisHash, invalidatedAt, reason: "s3_changed", s3Snapshot: {capability, requiredNote, heldStatus, requiredLevel, currentLevel}}`, where `s3Snapshot` holds the S3-owned values the judgement was based on (captured at judgement time alongside `basisHash` and copied into the entry), so the UI can show what changed; cap 5 entries, oldest dropped and the drop audited), clears `confirmedBy` / `confirmedAt`, sets `staleSince`, and **keeps** grade, cost, months and rationale as the pre-filled prior value for the re-judge. The person re-judges (may keep the same values) and re-confirms; a confirm on a stale row without a fresh save is rejected (`stale_requires_rejudge`).
- **Legacy judgements** (ADR-0168 rows without `basisHash`): treated as stale-unknown on first read after slice 1. Recommendation (OD-4): stamp them with the current hash in a one-off idempotent script run, so existing confirmations survive the deploy and only later S3 edits invalidate them.

### 4.2 S8 read-only S3 fields (D2)

- **Route validation.** `PUT /api/projects/[id]/capability-attainability` rejects any patch containing `capability`, `requiredNote`, `held`, `requiredLevel`, `currentLevel` (or `source`, `note`) with 400 `s3_owned_field` naming the field and pointing at S3/S5. Rejection, not silent drop, so a stale client or an agent learns the rule. `AttainabilityPatch` loses `requiredLevel` / `currentLevel`; `levelValue` moves to the S3/S5 path. `resolution` stays on the S8 route.
- **Change test.** The `changed` check in `applyAttainabilityPatches` drops the two level comparisons; it compares attainability content plus `resolution`.
- **UI.** The S8 panel shows `필요 수준` / `보유 수준` / `보유 판정` as read-only text with a link `S3에서 수정` (deep link to the S3 register, or S5 for levels on Green Field). Design-system: reuse the existing read-only cell pattern, no new component.
- **Existing data: no migration.** Levels already written by S8 are valid scale values in the same string fields S3/S5 use; they simply become S3 values. Nothing to move or rewrite. The audit trail of the earlier S8 level edits stays in `audit_log` (`capability_attainability.save`).

### 4.3 Brown Field per-target detection (D3)

Per ADR-0143 Brown Field judgements are per target (`targetId`), stored as `bc.capability.<rowId>.*` assumptions (ADR-0168 slice 5, not yet built). The target's current level is its coverage from the S6/S7 rubric: criterion `brownfield_eval_criterion` with `category = 'technical'`, `source = 'seeded'`, `seed_ref = <S3 row id>` (`lib/brownfield-eval-criteria.ts:106-111`), and the target's state in `brownfield_target_eval_state` (`status` pending | pass | partial | fail | na | waived, `note`, `evidence_ref`).

**Recommended basis (OD-1):** `targetBasisHash = H(capabilityRowHash(row), criterionId, state.status, state.note, state.evidence_ref)` for that target and that criterion only. `assessed_by` / `assessed_at` are excluded (re-saving the same score must not invalidate). A change invalidates only that target's judgement for that row; other targets and the opportunity-level (Green Field) judgement are untouched. An S3 row change (first hash component) invalidates the row for every target, which is the D1 rule applied per target.

Edge cases: criterion soft-deleted or never seeded for a row -> the per-target judgement shows `평가 기준 없음` and counts as unjudged; S3 rows added after the catalog was first seeded are never seeded today (`hasTechnicalSeeded` guard) - flagged as risk R3, fix belongs to the BF slice.

### 4.4 Rows deleted in S3 (orphaned judgements)

`carryOverAttainability` gains a second output: judgements whose row id no longer exists are appended to a register-level key `removedCapabilities[]` (`{rowId, capability, requiredLevel, currentLevel, attainability, removedAt, removedBy}`, cap 30, oldest dropped with audit). `serializeGapRegister` carries the key over exactly as it carries `technicalLens`, so no writer can drop it. If S3 re-adds a row with the same id, the entry stays in history and the new row starts unjudged (no automatic resurrection). The S8 panel shows a collapsed `삭제된 역량 (판정 이력)` section, read-only. No hard delete path is offered.

### 4.5 Stale-state UX

- **S8 panel row:** status chip `S3 변경 — 재판정 필요` (icon + text, not colour alone), the prior judgement shown as `이전 판정: 높음 (확정 김OO, 2026-10-10)` caption, a `변경 내용` disclosure listing old and new values, computed by diffing the latest history entry's `s3Snapshot` against the current row (holders and held evidence are covered by the hash but not snapshotted, so they show only as "changed").
- **S8 header counts:** add `재판정 필요 N` beside `미판정`.
- **S3 register screen:** a read-only column `S8 판정` showing the grade label plus `확정` / `확정 전` / `재판정 필요`, and a caption that S3 edits will require S8 re-judgement for rows that already have a judgement (shown before save, not as a blocking dialog). No S8 editing from S3.
- **S5 table:** same read-only column (shares the S3 component).

### 4.6 Banner, gate brief, grade

- `attainabilitySummary`: a stale row counts as `unjudged` for the banner and for ADR-0169 T1 (`충족` requires every row confirmed and not stale). New `bannerReasons` value `"stale"` and a count `stale`.
- Gate brief: the existing S8 informational line gains `재판정 필요 N건`. Decision support only.
- **No grade cap, no gate block** (ADR-0168 D4 and ADR-0169 D2 unchanged).

### 4.7 Audit (boundary #1)

All writes go through `appendAudit` under the calling user; agents inherit the caller's permissions and have no account of their own.

| Event | Action | Target |
|---|---|---|
| S3 save that invalidates judgements | `capability_attainability.invalidate` (one entry per save, row ids in target suffix) | `<oppId>#capability-stale:<rowIds>` |
| Row deleted with a judgement | `capability_attainability.archive_removed` | `<oppId>#capability-removed:<rowIds>` |
| History entry dropped by cap | `capability_attainability.history_trim` | `<oppId>#capability@<rowId>` |
| S8 save / confirm | unchanged (`.save` / `.confirm`) | unchanged |

Invalidation is attributed to the user whose S3 write caused it (not to a system account). Confirmation stays human-only (ADR-0168 D1, `HUMAN_ONLY_ROUTES` in `lib/mcp/in-process-port.ts`); re-confirmation after invalidation follows the same rule.

### 4.8 API / MCP read surfaces

- `GET /api/projects/[id]/capability-attainability`: per row adds `stale`, `stale_since`, `basis_hash`, `prior` (latest history entry), `history_count`; top level adds `removed_capabilities` and `summary.stale`.
- `GET /api/opportunities/[id]/capability-gap`: per row adds read-only `s8: { grade, confirmed, stale }` for the S3 column. Client-sent `s8` is ignored.
- `GET /api/projects/[id]/s8-lens-summary`: T1 reflects stale rows.
- MCP: no new tool. `get_business_case` (if it surfaces the summary) and any later attainability read tool expose `stale` counts. No confirm or invalidate tool (by design).

## 5. Test plan

- Unit `capabilityRowHash`: stable across key order, whitespace and holder order; changes on each hashed field; unchanged on `source`, `note`, `resolution`, `attainability`.
- Unit invalidation: S3 save changing `requiredLevel` clears confirmation, writes history, keeps prior values pre-filled; save without content change keeps confirmation; synergy-pipeline append does not invalidate existing rows.
- Unit removed rows: deleting a judged row moves it to `removedCapabilities`; serializer round-trips the key from every writer (S3 PUT, attainability write, synergy merge, backfill script).
- API: S8 PUT with `requiredLevel` / `currentLevel` / `capability` -> 400 `s3_owned_field`; confirm on stale row without re-save -> 400 `stale_requires_rejudge`; confirm by bearer/MCP -> 403 `human_only` (regression); audit rows for invalidate/archive under the caller.
- BF (slice 3): changing one target's criterion status invalidates only that target's judgement for that row; `assessed_at`-only re-save does not.
- Summary/banner: stale counts as unjudged; T1 not `충족` with a stale row.
- UI: S8 level cells are not inputs; S3 column renders three states with icon + text; `design:lint` and a11y pass.
- Legacy: register without `basisHash` behaves per OD-4 decision.

## 6. Slices

| Slice | Content | Est. |
|---|---|---|
| 1 | Row hash, `basisHash` stamping, derived stale flag, invalidation + history on write, `removedCapabilities`, S8 route rejects S3-owned fields, S8 level cells read-only, banner/T1/gate-brief counts, audit events, ADR-0170 | 2 d |
| 2 | S3 (and S5) read-only `S8 판정` column, pre-save caption, `s8` read field on the S3 GET | 1 d |
| 3 | Brown Field per-target basis hash and invalidation (with ADR-0168 slice 5 per-target storage), late-row criterion seeding fix | 2 d |
| 4 | Wiki 30/41/52, glossary (`재판정 필요`, `판정 이력`), manual screenshots | 0.5 d |

## 7. Risks

- **R1 Over-invalidation.** Fixing a typo in `requiredNote` invalidates a confirmed judgement. Accepted by D1 (S3 is the source); mitigated by keeping prior values pre-filled so re-confirming is one click after review.
- **R2 Mass invalidation on hash-definition change.** Any change to the hashed field set re-stales every row. Mitigated by the version prefix and an explicit re-stamp script per version change, under its own ADR amendment.
- **R3 BF criteria are seeded once.** S3 rows added after the first seed never become criteria, so per-target detection has nothing to read. Fix in slice 3.
- **R4 JSON growth.** History (5 per row) and removed entries (30) are capped; row cap stays 30. Each history entry also carries `s3Snapshot` (capability up to 200 chars, requiredNote up to 300, two levels up to 120 each, held status), roughly 0.8 KB worst case per entry, so worst case about 30 x 5 x 0.8 KB = 120 KB extra per register. Acceptable for a TEXT column; revisit the cap if registers grow.
- **R5 Writers bypassing the wrapper.** A future writer calling `UPDATE opportunity SET capability_gap_json` directly would skip materialised invalidation (derived stale still shows). Mitigation: a lint/grep test that only the wrapper writes the column.

## 8. Existing-project impact

- No DB migration: all new data is optional keys in the existing TEXT JSON column (`attainability.basisHash`, `.history`, `.staleSince`; register-level `removedCapabilities`). Readers that ignore them keep working.
- Levels previously written from S8 stay as S3 values; nothing is rewritten.
- Judgements without `basisHash`: per OD-4.
- Stored business-case numbers, runs and grades are untouched.

## 9. Open decisions (recommendations)

1. **OD-1 (resolved: confirmed by the decider's approval of ADR-0170, 2026-10-14) - Brown Field detection basis.** Recommendation: S3 row hash plus the target's evaluation state for the seeded criterion (`status`, `note`, `evidence_ref`; not `assessed_by/at`); invalidate only that target's judgement for that row.
2. **OD-2 (resolved: ADR-0170 approval, 2026-10-14) - `resolution` on S3/S5 screens.** Recommendation: read-only there from slice 2, edited only in S8 (D2); until slice 2 ships, S3 edits of `resolution` are allowed but excluded from the hash.
3. **OD-3 (resolved: ADR-0170 approval, 2026-10-14) - `note` in the hash.** Recommendation: exclude (free memo, not a requirement fact); the decider's list does not name it.
4. **OD-4 (resolved: ADR-0170 approval, 2026-10-14) - Legacy judgements without `basisHash`.** Recommendation: one-off idempotent stamp with the current hash at deploy (audited as `capability_attainability.basis_stamp` under the operator who runs it), so existing confirmations survive; alternative is to treat all as stale.
5. **OD-5 (resolved: ADR-0170 approval, 2026-10-14) - History depth.** Recommendation: 5 entries per row (each with an `s3Snapshot`, see R4), 30 removed capabilities per register.


## Correction 2026-10-14

The 5-step levels (`requiredLevel` / `currentLevel`, `LevelSelect`) are S5-owned (ADR-0136) and are not an S3 input; slice 1 wrongly added level columns to the S3 table and surfaced them in S8. S3-owned definitions are `capability`, `requiredNote` (required content), and `held.status` / `held.holders` / `held.evidence`. The S3 table is restored to its original columns (required capability, held judgement, holders/evidence with the modal button, resolution hint) and S8 reflects the S3 definitions read-only (required note and held judgement). The slice 1 row hash fields are unchanged (levels stay in the hash as S5-owned inputs), and the S8 route still rejects S3-owned fields and the levels.
