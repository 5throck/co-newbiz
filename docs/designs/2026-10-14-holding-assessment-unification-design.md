---
title: Holding assessment unification (simple held category, narrative levels, separate need category)
status: proposed
date: 2026-10-14
owner: platform-lead
lang: ko
lang_reason: source-material
---

# Holding assessment unification

Korean appears only as UI labels in backticks. All prose is English. Paths are relative to `app/web-next/` unless stated.

- Decider: human decider, chat 2026-10-14 (binding decisions D1-D8 below). Drafted by platform-lead.
- ADR: [ADR-0172](../adr/0172-holding-assessment-unification.md) (Proposed).
- Builds on: [ADR-0136](../adr/0136-unify-capability-gap-register.md), [ADR-0168](../adr/0168-s8-capability-attainability.md), [ADR-0170](../adr/0170-s3-s8-capability-linkage.md) (including its 2026-10-14 correction), [ADR-0171](../adr/0171-capability-check-at-s5-s7.md) (Proposed).
- Related designs: [S3-S8 capability linkage](2026-10-14-s3-s8-capability-linkage-design.md), [capability check at S5/S7](2026-10-14-capability-check-at-s5-s7-design.md), [S8 capability attainability](2026-10-14-s8-capability-attainability-design.md).

Items marked **Recommendation** are proposals for the decider to confirm. Revision note: an earlier draft of this design proposed 5-step and 3-step level scales with a legacy "out-of-scale" treatment; the decider rejected that on 2026-10-14 and it is removed.

## 1. Problem statement

A required-capability row (`CapabilityGapRow`, `lib/capability-gap.ts`, stored in `opportunity.capability_gap_json`) carries `held.status` (`충족` / `부분 충족` / `미보유` / `미판정`) plus `requiredLevel` and `currentLevel`. The level fields were meant as qualitative narrative but ADR-0168 put a 5-step dropdown (`LevelSelect`, `LEVEL_SCALE`: `없음`..`선도`) on them in S5/S8. Real data is narrative (for example a required level describing an in-house EU certification capability, and a held level describing export experience that relies on importing dealers for certification), so the dropdown hides it behind a legacy option. `충족` also does not say whether the group is average or above the industry, and nothing records how essential a capability is.

## 2. Binding decisions (decider, chat 2026-10-14)

- **D1 `보유 판정` is a simple category**, relative to the industry: `업계 리딩` / `업계 평균` / `부분 보유` / `미보유` / `미판정`.
- **D2 `필요 수준` and `보유 수준` are qualitative narrative text** (the state that must be reached; the current state). The 5-step scale is retired from the UI. Existing `requiredLevel` / `currentLevel` text is the real data: no migration, no legacy treatment.
- **D3 New `필요도`** item: `필수` / `부분 필수` / `선택` (+ unset), placed right after `필요 역량`.
- **D4 Ownership.** S3 owns `필요 역량`, `필요도`, `필요 수준`, `보유 판정`, `보유 수준`, `보유 주체·근거`. S5/S7/S8 read them.
- **D5 Narrative entry** via a modal with a two-line preview and an `입력` / `수정` / `보기` button, same pattern as `보유 주체·근거` (shared dialog component).
- **D6 `기대 수준`** is a narrative judgement field: S5 (Green Field) and S7 (Brown Field, per target). S8 read-only.
- **D7 No automatic comparison between narrative fields.** The only computed caution is `필요도` x `보유 판정` plus empty narrative on `필수` rows.
- **D8 Decision support only.** No gate block, no grade cap; humans confirm; AI output is a draft.

## 3. Field model

### 3.1 S3-owned fields

| Field | Key | Type | Notes |
|---|---|---|---|
| `필요 역량` | `capability`, `requiredNote` | text | unchanged |
| `필요도` | `necessity` | `essential` / `partial_essential` / `optional` / `""` | new; `""` shown as `미정` |
| `필수 범위` | `necessityScopeNote` | text, 120 | **Recommendation**, optional, only when `partial_essential` |
| `필요 수준` | `requiredLevel` | narrative text | existing field, meaning restored |
| `보유 판정` | `held.status` | `leading` / `average` / `partial` / `none` / `unevaluated` | new keys |
| `보유 수준` | `currentLevel` | narrative text | existing field, meaning restored |
| `보유 주체·근거` | `held.holders`, `held.evidence` | list, text | unchanged (`보유 수준` = what we hold now; `근거` = source of the judgement) |

**Recommendation** for the key name `necessity` (OD-1). The `필요도` key and `필수 범위` are new optional JSON fields; absent reads as `""`.

### 3.2 `보유 판정` keys and compatible read

| Order | Key | Label | Chip |
|---|---|---|---|
| 4 | `leading` | `업계 리딩` | `status-green` |
| 3 | `average` | `업계 평균` | `status-green` |
| 2 | `partial` | `부분 보유` | `status-amber` |
| 1 | `none` | `미보유` | `status-red` |
| - | `unevaluated` | `미판정` | `status-not-started` |

`normalizeGapRows` maps legacy keys on read: `met` -> `average` with `held.legacyStatus = "met"` and a `재판정 권장` hint (because `충족` does not say average vs above); `unmet` -> `none`; `partial` and `unevaluated` unchanged; anything else -> `unevaluated`. Keys are rewritten only when a person saves the row (lazy); no batch rewrite. Labels always accompany chip colour.

### 3.3 Narrative caps

`normalizeGapRows` caps `requiredLevel` and `currentLevel` at 120 characters today. **Recommendation:** raise both to 400, and use 400 for `expectedLevel`; existing values are below the old cap so nothing is truncated. Empty shows the single `미입력` marker; long previews use `ClampedText` (two lines).

## 4. Display order (section 5A in the earlier draft)

Canonical order everywhere: `필요 역량` -> `필요도` -> `필요 수준` -> `보유 판정` -> `보유 수준` -> `보유 주체·근거` -> [S5/S7] `해소 방식` -> `기대 수준` -> `비용` -> `기간` -> `달성 가능성` -> `근거·증빙`. This keeps the decider's earlier rule (`필요 수준` before `보유 판정`); placing `보유 수준` right after `보유 판정` is a **Recommendation** to confirm (OD-2).

| Surface | Order |
|---|---|
| S3 table | `필요 역량` - `필요도` - `필요 수준` - `보유 판정` - `보유 수준` - `보유 주체·근거` - `해소 힌트` - action |
| S5 (GF) | read-only S3 columns, then inputs `해소 방식` - `기대 수준` - `비용` - `기간` - `달성 가능성` - `근거·증빙` |
| S7 (BF, per target) | read-only S3 columns, then inputs `대상 보유 판정` - `대상 보유 수준` - `해소 방식` (fixed `인수 통합`) - `기대 수준` - `비용` - `기간` - `달성 가능성` - `근거·증빙` |
| S8 summary | as S5 or S7, all read-only |
| S4 `EvalTab` | capability, `필요도`, `보유 판정`, caution |
| Gate-brief line | `역량(필요도, 보유 판정; 해소 방식, 개월, 달성 가능성)` with narrative excerpts only when short |
| Charter text | capability, `필요도`, `보유 판정`, resolution |
| API / OpenAPI / MCP read views | `capability`, `requiredNote`, `necessity`, `necessityScopeNote`, `requiredLevel`, `held.status`, `currentLevel`, `held.holders`, `held.evidence`, then `resolution`, `expectedLevel`, `closingCostKrwM`, `monthsToAttain`, `grade`, `rationale`, `evidence` |
| AI draft outputs | same key order as the API |
| Wiki tables | same as the surface described |

A shared `CAPABILITY_COLUMN_ORDER` constant in `lib/capability-gap.ts` carries the order.

The S3 table must stay compact: `필요도` and `보유 판정` are narrow selects; `필요 수준` and `보유 수준` are two-line previews with a modal button.

## 5. Narrative modal

One shared dialog component (generalising the existing `보유 주체·근거` modal) with: field title, the row's `필요 역량` as context, a textarea with a live counter (cap 400), and read-only mode (`보기`) for S5/S7/S8. Button text: `입력` when empty, `수정` when filled in S3, `보기` where read-only. Keyboard accessible, focus returns to the button, Onyx 3.0 tokens.

## 6. Decision-support caution

`necessityFlag(necessity, held.status)` -> caution only; never blocks, never caps a grade.

| `필요도` \ `보유 판정` | `업계 리딩` | `업계 평균` | `부분 보유` | `미보유` | `미판정` |
|---|---|---|---|---|---|
| `필수` | none | none | `큰 격차 주의` | `큰 격차 주의` | `미판정` |
| `부분 필수` | none | none | `확인 필요` | `격차` | `미판정` |
| `선택` | `영향 낮음` | `영향 낮음` | `영향 낮음` | `영향 낮음` | `미판정` |
| `미정` | none | none | none | none | `미판정` |

Additional caution: a `필수` row with empty `필요 수준` shows `필요 수준 미기술`; empty `보유 수준` with a judged `보유 판정` shows `보유 수준 미기술`. There is no level-difference computation; `기대 수준` vs `필요 수준` is a human reading, optionally with an AI-drafted comparison sentence (proposal only, OD-8). The matrix is OD-3.

## 7. Coverage (`보유율`)

`summarizeGap` returns counts per new key and `coveragePct` with weights `leading` 1, `average` 1, `partial` 0.5, `none` 0, `unevaluated` excluded. Legacy `met` counts as `average`, so existing numbers do not move. Label changes from `충족률` to `보유율`; API property `coveragePct` unchanged. **Recommendation:** add `essentialCoveragePct` over `필수` rows (OD-5).

## 8. Row hash v2 (ADR-0170)

v1 (`lib/capability-linkage.ts`) hashes `capability`, `requiredNote`, `heldStatus`, `holders`, `heldEvidence`, `requiredLevel`, `currentLevel`.

v2 hashes, in display order: `capability`, `requiredNote`, `necessity`, `necessityScopeNote` (if adopted), `requiredLevel` (text), `heldStatus` (normalized key), `currentLevel` (text), `holders`, `heldEvidence`. Prefix `v2:`. All are S3-owned now.

v1 compatibility: when a stored `basisHash` starts with `v1:`, the stale check recomputes v1 over the current raw row. Match = not stale, and the server re-stamps `v2:` on the next write of that judgement (lazy). Because the legacy key mapping is read-only and v1 uses the raw stored key, untouched rows do not go stale; setting `필요도` on a row for the first time is a real change and invalidates its judgement (OD-4 asks whether first-time `필요도` entry should be exempt; recommendation: no exemption, it is a definition change). `S3Snapshot` gains `necessity`; the diff renderer shows text fields as before/after excerpts.

## 9. Stage placement and ADR-0171 interaction

| Stage | Owns |
|---|---|
| S3 | `필요 역량`, `필요도`, `필요 수준`, `보유 판정`, `보유 수준`, `보유 주체·근거` |
| S5 (Green Field) | `해소 방식`, `기대 수준` (state expected once the resolution is done), `비용`, `기간`, `달성 가능성` (`높음` / `중간` / `낮음`), `근거·증빙` |
| S7 (Brown Field, shortlisted targets) | target's `보유 판정` (same 4-level scale, `targetHeldStatus`), target's `보유 수준` narrative (`targetCurrentLevel`), `기대 수준` after acquisition, integration and key-talent retention, cost, months, grade, rationale; `해소 방식` fixed to `인수 통합` (shown, not selectable; other complements in the note) - **Recommendation** (OD-6) |
| S8 | read-only |

- Storage per ADR-0171: GF judgement on the S3 register row (`attainability.*`), BF per-target in `brownfield_target_capability_judgement`. `expectedLevel`, `targetHeldStatus`, `targetCurrentLevel` are judgement fields, not hashed in S3, and are moved to history when an S3 change invalidates the judgement.
- UI text and glossary explain S5 `기대 수준` (after our own resolution) and S7 `기대 수준` (what the group holds through this target after integration) separately.
- S5 `GreenfieldStage.tsx` loses its own `필요 수준` / `보유 수준` inputs and shows them read-only from S3. ADR-0136's "S5 fills the levels" is superseded; ADR-0168's 5-step scale is superseded; ADR-0170's correction (levels are S5-owned) is reversed (levels are S3-owned narrative).
- S8 attainability route keeps rejecting S3-owned fields (now including `necessity`) and rejects `expectedLevel`/`target*` (read-only in S8).
- **`기대 수준` mandatory?** **Recommendation (OD-7):** optional in drafts; required (non-empty) to confirm a judgement that has a `해소 방식`, 400 `expected_level_required`. Record completeness only, not a gate block.

## 10. Retirement of the 5-step scale

| Item | Action |
|---|---|
| `components/stages/LevelSelect.tsx` | delete (only importer `GreenfieldStage.tsx`) |
| `LEVEL_SCALE`, `LEVEL_LABELS`, `levelStep`, `isLegacyLevelText`, `levelGap` in `lib/capability-gap.ts` | remove after `capability-attainability.ts` stops using them |
| `required_step` / `current_step` in `lib/capability-attainability.ts` | remove; pass narrative text instead |
| S8 `S5 수준` caption, gate-brief `S5 수준 x/y` | remove |
| `scripts/co-newbiz/restore-capability-levels.ts` | keep; it restores text fields, which are again the real data |

## 11. Consumers to update

| File | Change |
|---|---|
| `lib/capability-gap.ts` | new held keys, compat reader, `necessity`, caps 400, `necessityFlag`, weights, column order, retire 5-step helpers |
| `lib/capability-linkage.ts` | hash v2, v1 recompute, snapshot `necessity` |
| `lib/capability-attainability.ts` | drop level steps; use `necessityFlag`, held ordinal, narrative text |
| `lib/gate-brief.ts` | new labels, `큰 격차 주의` list, order per section 4, drop `S5 수준` |
| `lib/track-advisory.ts` | `보유율` label; caution when any `필수` row is `큰 격차 주의` |
| `lib/project-charter.ts` | gaps = rows with a caution, ordered per section 4 |
| `lib/synergy-pipeline.ts`, `components/stages/synergy/useSynergyResult.ts` | seed `necessity: ""` |
| `app/api/opportunities/[id]/capability-gap/route.ts` | accept new keys and `necessity`; legacy held keys accepted and mapped for one release, then 400 `invalid_held_status` |
| `app/api/opportunities/[id]/capability-gap/llm-draft/route.ts` | section 12 |
| `app/api/opportunities/[id]/route-advisory/route.ts` | counts per new key, `essentialCoveragePct`, `largeGapRows`; `unmet`/`unmetRows` kept as deprecated aliases one release |
| `app/api/brownfield/[oppId]/targets/[targetId]/screening-draft/route.ts` | prompt uses `필요도`, `필요 수준` text, new held label |
| `app/api/brownfield/[oppId]/target-proposals/web-search/route.ts` | filter rows not `leading`/`average` |
| `app/api/projects/[id]/capability-attainability/route.ts` | reject `necessity`, `expectedLevel`, `target*` |
| `components/stages/synergy/SynergyLinkageTab.tsx` | S3 columns per section 4, `필요도` select, narrative modals, held select |
| `components/stages/GreenfieldStage.tsx` | remove level inputs; read-only S3 columns; `기대 수준` modal |
| `components/stages/CapabilityAttainabilityPanel.tsx` | read-only order, new labels, caution |
| `components/stages/route-decision/EvalTab.tsx` | shared label/chip maps, `보유율`, `큰 격차 주의`, order |
| `components/stages/brownfield/useBrownfieldUniverse.tsx` | `미보유 N건 · 부분 보유 N건` |
| S7 target judgement surface (ADR-0171 slice 2) | target held/current/expected inputs, fixed `인수 통합` |
| `scripts/bootstrap-stages.ts`, `scripts/co-newbiz/backfill-capability-gap.ts` | write new keys |
| `docs/architecture/openapi.yaml` | section 13 |
| tests (`capability-gap`, `capability-linkage`, `capability-attainability`, `technical-lens`, `project-promotion`, `restore-capability-levels`) | section 14 |

Every surface above adopts the order of section 4.

## 12. AI drafts

- **Holding draft** (`capability-gap/llm-draft`): proposes `보유 판정` (new keys), `보유 수준` narrative and `근거` from group/affiliate profiles; `필요도` and `필요 수준` only as empty-field drafts (see Amendment 2026-10-14 below). `leading` only with explicit comparative evidence; otherwise `average` with "업계 대비 근거 없음", or `unevaluated`. Output key order per section 4. Validator rejects legacy keys. Draft only; a person confirms.
- **Attainability draft** (S5/S7): may propose `기대 수준` narrative and a grade, and optionally a one-sentence comparison of `기대 수준` against `필요 수준` (OD-8). Proposal only.

## 13. API and OpenAPI

- Capability-gap PUT: `necessity` enum, `necessityScopeNote`, narrative caps 400, new held keys (legacy accepted one release). Errors `invalid_necessity`, `invalid_held_status`, `text_too_long`.
- Responses include `held.legacyStatus` when present.
- Route-advisory adds `leading`, `average`, `none`, `essentialCoveragePct`, `largeGapRows`.
- S5/S7 judgement routes (ADR-0171) accept `expectedLevel` (and S7 `targetHeldStatus`, `targetCurrentLevel`); confirm rule per OD-7.
- `openapi.yaml` schemas list fields in section 4 order; `tests/unit/openapi.test.ts` passes.

## 14. Tests

- Compat reader (`met`/`unmet`/unknown), `legacyStatus` set and cleared on save.
- Narrative caps 400; existing 120-char values untouched; empty -> `미입력`.
- `necessityFlag` full matrix and `미기술` cautions; no level arithmetic remains (`levelGap` removed).
- `summarizeGap` weights, `essentialCoveragePct`, legacy `met` keeps coverage.
- Hash v2 field set; v1 recompute not-stale for untouched rows, stale for changed; lazy re-stamp; first `필요도` entry invalidates.
- Routes: S8 rejects S3-owned and S5/S7-owned fields; `expected_level_required` at confirm; S7 `해소 방식` fixed.
- Display order: source-structure tests per surface (S3 table, S5, S7, S8 summary, `EvalTab`) assert the section 4 order; unit tests for gate-brief and charter strings and API/AI key order.
- Modal: open/close, focus return, read-only mode; `design:lint` passes.

## 15. Wiki and glossary

- Wiki `docs/wiki/ko/22-*S3*` (new columns, modals), `23-*S4*` (`보유율`, cautions), `40-*S5*` (step 4 no longer edits `보유 수준`; inputs are `해소 방식` and `기대 수준`), `51-*S7*` (target fields, fixed `인수 통합`), S8 pages (read-only order).
- Glossary (`glossary/business.yaml`, none exist today): `필요도`, `필요 수준`, `보유 판정`, `보유 수준`, `기대 수준` (with separate S5 and S7 meanings). Re-run glossary lint and check the four tooling integrations.

## 16. Migration

None. All fields are JSON; existing narrative text is valid as is; held keys are read-mapped; hashes re-stamp lazily. No data is deleted.

## 17. Risks

- `met` read as `average` may hide a leading capability; mitigated by `재판정 권장`.
- First `필요도` entry invalidates confirmed judgements on that row (by design); communicate in release notes.
- Narrative quality varies; `미기술` cautions only catch empty text.
- v1 compatibility code must stay correct until cleanup.
- Overlap with ADR-0171 slices in the same files; sequence the slices.

## 18. Slices

1. **S3 UI and model.** `필요도`, narrative modals (shared dialog), `보유 판정` scale with compat reader, caps, column order, hash v2, capability-gap route, tests.
2. **S5/S7 and consumers.** S5/S7 read-only S3 columns, `기대 수준` (S5) and target fields (S7), consumers in section 11, retire the 5-step UI and helpers, OpenAPI. Depends on ADR-0171 slices 1-2.
3. **AI and docs.** Holding draft and attainability draft, wiki, glossary.

## 19. Open decisions (with recommendations)

| ID | Question | Resolution (ADR-0172 approval, 2026-10-14, as recommended) |
|---|---|---|
| OD-1 | Stored keys | `necessity`: `essential` / `partial_essential` / `optional`; held: `leading` / `average` / `partial` / `none` / `unevaluated` with `met`->`average` (`재판정 권장`), `unmet`->`none` |
| OD-2 | `보유 수준` position | Right after `보유 판정` |
| OD-3 | Caution matrix | As in section 6 |
| OD-4 | Does first `필요도` entry invalidate judgements? | Yes |
| OD-5 | Coverage | Weights 1/1/0.5/0, label `보유율`, plus `essentialCoveragePct` |
| OD-6 | S7 `해소 방식` fixed or selectable | Fixed `인수 통합` |
| OD-7 | `기대 수준` mandatory when `해소 방식` set | Required at confirm, optional in drafts |
| OD-8 | AI comparison sentence `기대 수준` vs `필요 수준` | Yes, proposal only, in the attainability draft |
| OD-9 | Narrative cap | 400 characters for `필요 수준`, `보유 수준`, `기대 수준` |
| OD-10 | `필수 범위` note for `부분 필수` | Yes, optional, 120 characters |
| OD-11 | v1 hash handling | Recompute on read, lazy re-stamp; no batch script |

## 20. Not verified

- MCP tool handlers (`draft_capability_gap`, `record_capability_list`, `get_route_advisory`) and the analysis-engine CLI were not traced.
- `SynergyLinkageTab.tsx`, `CapabilityAttainabilityPanel.tsx` and `GreenfieldStage.tsx` were not read line by line; the shared modal's current component name was not confirmed.
- Live data (how many rows hold `met`, narrative length distribution) was not inspected; no database access.
- Whether S5 `capability_gaps_json` (migration 0056) still carries its own level text was not confirmed.
- Outputs are decision support, not investment advice.

## Amendment 2026-10-14 - AI drafts of necessity, required level and holding status

The holding draft route previously never proposed `필요도` or `필요 수준`. The decider reversed this on 2026-10-14 and split the AI into two actions: the requirement proposal (extra rows plus empty `필요도`/`필요 수준`, no holding fields) and a holding check (`보유 판정`/`보유 수준`/`보유 주체·근거` from profiles plus bounded external web search with required citations, per-row re-check applied only by a human). Common rules: drafts for empty fields only, short basis per field, "AI 초안" chip until edited or saved, no database write by the routes, unsupported values stay empty or `미판정`, web text untrusted, search failure degrades to profile-only. `필요 수준`/`보유 수준` are edited inline in the table (the modal remains for `보유 주체·근거`). Humans decide; saving is the human act. See ADR-0172, Amendment 2026-10-14.
