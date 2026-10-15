---
title: Required-capability check at S5 (Green Field) and S7 (Brown Field, per target)
status: proposed
date: 2026-10-14
owner: platform-lead
lang: ko
lang_reason: source-material
---

# Required-capability check at S5 (Green Field) and S7 (Brown Field)

Korean appears only as UI labels in backticks. All prose is English. Paths are relative to `app/web-next/` unless stated.

- Decider: human decider, chat 2026-10-14 (binding decisions D1-D5 below). Drafted by platform-lead.
- ADR: [ADR-0171](../adr/0171-capability-check-at-s5-s7.md) (Proposed).
- Builds on and partly supersedes: [ADR-0168](../adr/0168-s8-capability-attainability.md), [ADR-0169](../adr/0169-s8-technical-financial-lens.md), [ADR-0170](../adr/0170-s3-s8-capability-linkage.md) (including its 2026-10-14 correction), [ADR-0136](../adr/0136-unify-capability-gap-register.md), [ADR-0143](../adr/0143-s8-per-target-feasibility-target-axis.md).
- Related designs: [S8 capability attainability](2026-10-14-s8-capability-attainability-design.md), [S3-S8 capability linkage](2026-10-14-s3-s8-capability-linkage-design.md), [S8 technical/financial lens](2026-10-14-s8-technical-financial-lens-design.md).

## Implementation status (2026-10-15)

Slices 1-3 are built; details are in the ADR-0171 amendments and the as-built sections of `docs/architecture/ui-spec.md`. The frontmatter `status` is unchanged.

- **Slice 1 (Green Field).** S5 edit surface for the required-capability judgement, plus the S8 read-only summary.
- **Slice 2 (Brown Field S7).** Per-target judgements for shortlisted and selected targets in table `brownfield_target_capability_judgement` (migration 0145; also `retired_at` / `retired_reason` on `brownfield_eval_criterion`). Two-hash staleness: the S3 row hash plus an `eval_basis_hash` over the target's verdict, note and evidence ref; either change invalidates only that target. Criteria reconcile replaces seed-once and detects drift. Readiness is warning-only.
- **Slice 3 (S8 readers and tooling).** Lens T1 for Brown Field reads the selected target's S7 judgements (stale or unconfirmed counts as unjudged). The `target_screening` and `pre_fs` gate briefs carry a per-target capability-check line, labeled not an approval condition. S8 edit and confirm routes still answer 410 with `editAt`. Person-run script `scripts/co-newbiz/copy-legacy-bf-capability-judgements.ts` copies legacy register judgements to the selected target (dry-run by default, `--apply` to write). Glossary entries added.

Not done or not verified:

- Not browser-verified.
- The copy script has not been run against any real database.
- No separate capability-adjusted scenario artifact was found on S8 (section 8); it is unchanged, and the S5 investment simulation already reads the S5 judgements.
- Wiki pages (section 12) were not updated.

## 1. Problem statement

ADR-0168 put the required-capability attainability judgement (resolution, cost, months, grade, rationale, draft/confirm metadata) on S8. ADR-0170 made S3 the single definition source and added stale detection. The judgement itself still answers a question that belongs earlier in the flow:

- Green Field S5 asks `스스로 진입할 수 있는가?` (`lib/stage-meta.ts`). Whether the required capabilities can be attained on our own is the core of that question, yet S5 only fills levels (ADR-0136) and the judgement waits until S8.
- Brown Field S7 asks `어떤 대상이 유망한가?` and closes on the `target_screening` gate. Whether a target covers the required capabilities is a target-screening fact. Today S3 rows are seeded once as per-target technical rubric criteria (`lib/brownfield-eval-criteria.ts`, `listOrSeedCriteria`, `seed_ref = row id`, `hasTechnicalSeeded` guard), so rows added to S3 later never become S7 criteria and removed rows linger.
- S8 is the business-case stage. Using it as an input surface for capability judgements means the S5 and S7 gates pass without the check, and S8 re-opens questions that should already be settled.

## 2. Binding decisions (decider, chat 2026-10-14)

- **D1 - Check location.** Required-capability checking belongs to S5 for Green Field and to S7 per target for Brown Field. S8 stops being an input surface for it.
- **D2 - S3 stays the single definition source** for both tracks and is linked to S5 (GF) and S7 (BF). The ADR-0170 correction stands: S3 owns `capability`, `requiredNote`, `held.status` / `held.holders` / `held.evidence`; the 5-step levels are S5-owned and not an S3 input.
- **D3 (approved recommendation a) - S7 scope.** Per-target attainability applies only to shortlisted and selected targets (`brownfield_target.status = 'shortlisted'` plus the selected target), not the whole long list.
- **D4 (approved recommendation b) - S8 read-only summary.** The S8 technical-feasibility tab keeps a read-only table: S3 definition plus the S5 judgement (GF) or the selected target's S7 judgement (BF), with links to the edit surface. No inputs.
- **D5 (approved recommendation c/d) - Edit surface and staleness.** The existing judgement fields, including ADR-0170 stale/history/basis-hash machinery, move their edit surface to S5 (GF, stored on the S3 register row as today) and to S7 per target (BF, keyed by `targetId`). An S3 change makes the GF S5 judgement stale and only the affected target's S7 judgement stale (ADR-0170 OD-1 basis). The seed-once defect is fixed in the Brown Field slice.

Human-only confirmation of judgements (ADR-0168 D1) and the boundaries in `CLAUDE.md` (agents inherit the caller's permissions; gate approval is human) are unchanged.

## 3. What moves and what stays, per stage

| Stage | Before (ADR-0168/0170) | After (this design) |
|---|---|---|
| S3 | Definition source; read-only `S8 판정` column | Definition source (unchanged); read-only column renamed `점검 판정`, showing the S5 judgement (GF) or a per-target count summary (BF, e.g. `대상 3 중 확정 2, 재판정 1`) |
| S5 (GF) | Fills `requiredLevel` / `currentLevel` | Fills levels **and** owns the attainability judgement edit surface (resolution, cost, months, grade, rationale, AI draft, human confirm, stale re-judge) |
| S7 (BF) | Per-target rubric criteria seeded once from S3; status/note per criterion | Per-target attainability judgements for shortlisted/selected targets, edited inside the target evaluation UI, next to the seeded technical criterion; seeding becomes a reconcile |
| S8 | Editable `CapabilityAttainabilityPanel`; `PUT .../capability-attainability`, `.../confirm` | Read-only summary table in the technical-feasibility tab; routes become GET-only summaries; lens T1, banner, gate-brief line read S5/S7 |

Stays exactly as is: the register JSON location (`opportunity.capability_gap_json`), `serializeGapRegister` as the single write path (ADR-0169), the ADR-0170 row hash definition (versioned, levels included as S5-owned inputs), history caps, `removedCapabilities[]`, audit event names (extended, not renamed), and "no grade cap, no gate block" for S8.

## 4. Data model and storage

### 4.1 Green Field

No change. The judgement stays at `register.rows[i].resolution` and `register.rows[i].attainability.*` inside `opportunity.capability_gap_json`. Only the writer route changes (S5 instead of S8). No migration.

### 4.2 Brown Field - options

| Option | Shape | Pros | Cons |
|---|---|---|---|
| A. Reuse `brownfield_target_eval_state` | Encode judgement in `note` / `evidence_ref` of the seeded criterion row | No schema change | Overloads free-text columns; no room for cost/months/grade/history/basisHash; breaks rubric scoring semantics |
| B. JSON column on `brownfield_target_eval_state` | `ALTER TABLE ... ADD COLUMN attainability_json TEXT` on the seeded criterion's state row | One row per target x capability already exists; co-located with the S7 criterion status | Couples attainability lifecycle to criterion lifecycle; retired criteria need care |
| C. New table `brownfield_target_capability_judgement` | `(id, brownfield_target_id, capability_row_id, criterion_id NULL, judgement_json, basis_hash, eval_state_hash, stale_since, confirmed_by, confirmed_at, updated_by, updated_at)`, UNIQUE `(brownfield_target_id, capability_row_id)` | Clean keys by S3 row id; survives criterion retire/reseed; history kept in `judgement_json.history[]` | New table, new repository |
| D. Per-target map inside `capability_gap_json` | `rows[i].targetAttainability[targetId]` | No migration | Register JSON grows with targets; one writer contention point for many targets; target permissions not enforceable at row level |

**Recommendation: Option C.** It keys judgements by the S3 row id (the stable definition identity), keeps the ADR-0170 judgement JSON shape (`resolution`, `cost`, `months`, `grade`, `rationale`, draft/confirm metadata, `basisHash`, `history[]`, `staleSince`) so `lib/capability-attainability.ts` validation is reused, and is not disturbed by criterion reconciliation. It is a DB schema change, so per the workspace schema-governance baseline and the project ADR trigger list it needs an ADR (ADR-0171, this design) and a new numbered migration (next free after `0142`, expected `0143_brownfield_target_capability_judgement.sql`) with a rollback note and data-architect review. `criterion_id` links to the seeded criterion when one exists.

### 4.3 Brown Field stale basis (ADR-0170 OD-1, now living at S7)

`basis_hash` = ADR-0170 row hash of the S3 row at the time of the save/confirm. `eval_state_hash` = hash of the target's `brownfield_target_eval_state` row for the seeded criterion (`status`, `note`, `evidence_ref`). Stale when a judgement exists and either hash differs from the current value. Derived on read, as in ADR-0170, so every writer (S3 PUT, synergy pipeline, backfill script, criterion state edit) triggers it. Invalidation moves the prior judgement into `history[]`, clears confirmation, sets `staleSince`, keeps values pre-filled.

### 4.4 Seed-once fix (reconcile)

Replace the `hasTechnicalSeeded` once-only guard with `reconcileTechnicalCriteria(opportunityId)`:

- For each S3 row without a seeded technical criterion (`source = 'seeded'`, `seed_ref = row.id`), insert one.
- For each seeded criterion whose `seed_ref` no longer exists in S3, retire it: add a `retired_at` / `retired_by` marker (requires a column, see OD-2) instead of deleting, exclude it from scoring and from gate readiness, keep its eval states and any capability judgements readable as history.
- Label drift (S3 capability text changed) updates the criterion label and is covered by the row hash stale rule.
- Runs on criterion listing and after every register write, idempotent, audited as `brownfield_criterion.reconcile` under the calling user.

## 5. API changes

| Route | Change |
|---|---|
| `GET /api/projects/:id/capability-attainability` | Becomes a read-only summary: per S3 row, the definition plus the GF S5 judgement or the selected BF target's judgement, `editHref` pointing at S5 or S7 |
| `PUT /api/projects/:id/capability-attainability`, `POST .../confirm` | Return `410 moved` with `{ editAt: "S5" | "S7" }` for one release, then removed |
| New `PUT /api/opportunities/:id/capability-attainability` (S5, GF) | Same body and guards as the old S8 PUT (`s3_owned_field` rejection, transactional merge via `serializeGapRegister`), plus S5 may write levels |
| New `POST /api/opportunities/:id/capability-attainability/confirm` (S5) | Human-only confirm; rejects stale rows (`stale_requires_rejudge`) |
| New `GET/PUT /api/brownfield/targets/:targetId/capability-judgements` (S7) | Lists S3 rows with the target's judgement and stale state; PUT saves patches; rejects targets not shortlisted/selected with `409 target_not_in_scope` |
| New `POST /api/brownfield/targets/:targetId/capability-judgements/confirm` | Human-only confirm per row; stale rejection |
| `GET /api/projects/:id/s8-lens-summary` | T1 computed from S5 (GF) or selected target S7 judgements (BF) |
| MCP `draft_capability_gap` and AI draft helpers | Draft only; target the new routes; never confirm |

Audit: existing `capability_attainability.save` / `.confirm` / `.invalidate` / `.archive_removed` / `.history_trim` gain a `surface` field (`S5` or `S7`) and `target_id` for BF. All entries are written under the calling user (boundary #1). Confirm requires a human session; agent tokens receive 403 as today.

## 6. UI per stage

- **S3**: unchanged table (ADR-0170 correction); the read-only judgement column links to S5 or S7.
- **S5** (`components/stages/GreenfieldStage.tsx`): the capability table gains the attainability columns moved from `CapabilityAttainabilityPanel.tsx` (resolution, grade dropdown, cost, months, rationale-and-evidence modal, AI draft marker, confirm button, `S3 변경 — 재판정 필요` badge with history). Extract the panel body into a shared component used by S5 and S7 rather than duplicating it (Onyx 3.0, shared components first).
- **S7** (target evaluation UI under `components/stages/brownfield*/`): in the per-target evaluation drawer, a `필요 역량 점검` section for shortlisted/selected targets showing each S3 row, the seeded criterion status, and the shared judgement editor keyed by `targetId`. Long-list targets show a disabled note `숏리스트 후 점검`.
- **S8**: the technical-feasibility tab replaces the editable panel with a read-only summary table (S3 required content, held judgement, holders/evidence preview, levels caption, judgement grade, confirmed / not confirmed / re-judgement needed, `S5에서 수정` or `S7에서 수정` link). Banner text points to the edit stage.

## 7. Stage gates and completion

- **S5 completeness**: add a `필요 역량 점검` component: every S3 row has a confirmed, non-stale judgement. Recommendation (OD-3): warning on the completeness meter, not a hard block on `pre_fs`, consistent with ADR-0168/0170 "no gate block"; the gate brief states the gap.
- **S7 `target_screening` readiness**: the readiness summary reports, per shortlisted/selected target, confirmed / unconfirmed / stale counts. Same warning-only recommendation.
- **S8 lens T1 and banner**: read S5 (GF) or the selected target's S7 judgements (BF); stale counts as unjudged (ADR-0170 Decision 6). No target selected yet: T1 shows `미판정` with a pointer to S7.
- **Gate briefs**: the `pre_fs` brief (GF) and `target_screening` brief (BF) gain the capability line; the S8 `fs` brief keeps it as a quotation of S5/S7.

## 8. Capability-adjusted scenario (ADR-0168 slice)

The scenario adjustment (capex/opex add-ons from judgement cost and months, schedule shift) consumes confirmed, non-stale judgements from S5 (GF) or from the selected target (BF). Unconfirmed or stale judgements are shown as excluded with a reason, never silently used. Changing the selected target re-reads that target's judgements and marks the scenario stale (reuse the existing business-case staleness note).

## 9. ADR supersession and amendment plan

The earlier ADRs are not edited beyond a one-line pointer if the repo convention requires it (`docs/adr/README.md` index notes are the normal place; see OD-5).

| ADR | Superseded part | Stays |
|---|---|---|
| 0168 | S8 as the edit surface of the attainability judgement; S8 PUT/confirm routes | Judgement fields, grade scale, human-only confirm, register JSON extension |
| 0169 | T1 input source (S8 panel) | Two-lens layout, `technicalLens` single writer, warning-only |
| 0170 | Decision 4 (S8 route) and Decision 6 surfaces (`S8 판정` column name); Decision 5 now lives at S7 storage | Single source, row hash, invalidation and history, correction addendum |
| 0136 | Nothing superseded; amended: S5 also owns the GF judgement edit surface | S5 fills levels |
| 0143 | Amended: per-target capability judgement originates at S7, S8 reads it | Per-target S8 axis |

## 10. Existing-data migration

- **GF**: judgements stored today on S3 register rows remain valid as-is; only the edit route changes. No data move. Legacy rows without `basisHash` keep the ADR-0170 OD-4 treatment (not stale until stamped).
- **BF**: no per-target judgements exist today. Any judgement found on a BF register row (written through the old S8 panel) is copied, unconfirmed, to the selected target if one exists, otherwise kept on the row as read-only legacy history. One-off script `scripts/co-newbiz/migrate-bf-capability-judgements.ts`: dry run default, `--apply` with `VACUUM INTO` safety copy, single transaction, idempotent, one audit row per opportunity. No data is deleted.
- **Criteria reconcile**: first reconcile run seeds missing criteria and retires orphans; dry-run report first.

## 11. Test plan

- Unit: route guards (`s3_owned_field`, `stale_requires_rejudge`, `target_not_in_scope`, 410 on old S8 writes); stale derivation from both hashes; reconcile add/retire/idempotency; migration script dry-run vs apply.
- Integration: S3 edit stales only the affected target's judgement; criterion state edit stales that target only; selected-target change updates S8 summary and scenario staleness.
- UI (Playwright): S5 edit and confirm; S7 shortlisted vs long-list behaviour; S8 summary has no inputs and correct edit links; `design:lint`.
- Permissions: agent token cannot confirm; audit rows carry the caller and `surface`.

## 12. Wiki and glossary

Update `docs/wiki/ko/40-그린필드-S5-자체-진출.md` (new check section), `51-브라운필드-S7-대상-선정.md` (per-target check, shortlist scope), `41-`/`52-`/`30-공통-S8-사업성-분석.md` (read-only summary, edit links). Glossary: add or adjust `필요 역량 점검` and confirm `달성 가능성` points at S5/S7; rerun glossary lint.

## 13. Risks

- Reviewers used to S8 may miss the move: banner and 410 payload point to the new place.
- S7 workload grows with the shortlist size: scope limited by D3.
- Reconcile retiring criteria changes S7 scores: retired criteria are excluded with a visible note; scores are recomputed, not silently shifted.
- New table adds a second storage pattern next to the register JSON: accepted for per-target keys.

## 14. Slices

1. **Green Field**: S5 edit surface (shared editor), new S5 routes, S8 read-only summary, S8 write routes to 410, S5 completeness warning, S3 column relabel.
2. **Brown Field**: migration for Option C, repository, S7 routes and UI for shortlisted/selected targets, reconcile replacing seed-once (with retire marker), two-hash stale detection, BF migration script.
3. **S8 and docs**: capability-adjusted scenario reads S5/S7, lens T1/banner/gate-brief lines (`pre_fs`, `target_screening`, `fs`), wiki and glossary.

## 15. Open decisions (with recommendations)

- **OD-1 Storage for BF judgements. (resolved: ADR-0171 approval, 2026-10-14, as recommended)** Recommend Option C (new table), ADR-0171 covering the schema change.
- **OD-2 Retire marker for criteria. (resolved: ADR-0171 approval, 2026-10-14, as recommended)** Recommend adding `retired_at` / `retired_by` columns to `brownfield_eval_criterion` in the same migration, over a JSON flag.
- **OD-3 Gate effect. (resolved: ADR-0171 approval, 2026-10-14, as recommended)** Recommend warning only at S5 completeness and S7 readiness (no hard block), consistent with ADR-0168/0170.
- **OD-4 Old S8 write routes. (resolved: ADR-0171 approval, 2026-10-14, as recommended)** Recommend 410 with `editAt` for one release, then removal.
- **OD-5 Pointers in older ADRs. (resolved: ADR-0171 approval, 2026-10-14, as recommended)** Recommend no edit to ADR-0168/0169/0170 bodies; the README index rows note "partly superseded by ADR-0171" at acceptance.
- **OD-6 Selected target before S7 check. (resolved: ADR-0171 approval, 2026-10-14, as recommended)** If a target is selected without confirmed judgements, recommend allowing it with a gate-brief warning, not a block.

## 16. Not verified

- Exact location of the S5 completeness computation and the S7 `target_screening` readiness summary was not traced; slice owners confirm.
- The S7 per-target evaluation editor component path under `components/stages/brownfield*/` was not inspected in detail; the edit route for eval state is under `app/api/brownfield/targets/[targetId]/route.ts`.
- Whether any BF register rows carry S8 judgements in the live database was not checked (no database access by design).
