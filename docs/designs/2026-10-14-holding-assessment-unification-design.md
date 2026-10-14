---
title: Holding assessment unification (one held scale relative to the industry, plus a separate required-level scale)
status: proposed
date: 2026-10-14
owner: platform-lead
lang: ko
lang_reason: source-material
---

# Holding assessment unification

Korean appears only as UI labels in backticks. All prose is English. Paths are relative to `app/web-next/` unless stated.

- Decider: human decider, chat 2026-10-14 (binding decisions D1-D3 below). Drafted by platform-lead.
- ADR: [ADR-0172](../adr/0172-holding-assessment-unification.md) (Proposed).
- Builds on: [ADR-0136](../adr/0136-unify-capability-gap-register.md), [ADR-0168](../adr/0168-s8-capability-attainability.md), [ADR-0170](../adr/0170-s3-s8-capability-linkage.md) (including its 2026-10-14 correction), [ADR-0171](../adr/0171-capability-check-at-s5-s7.md) (Proposed).
- Related designs: [S3-S8 capability linkage](2026-10-14-s3-s8-capability-linkage-design.md), [capability check at S5/S7](2026-10-14-capability-check-at-s5-s7-design.md), [S8 capability attainability](2026-10-14-s8-capability-attainability-design.md).

Items marked **Recommendation** are proposals for the decider to confirm. Everything else restates a binding decision or describes current code.

## 1. Problem statement

A required-capability row (`CapabilityGapRow`, `lib/capability-gap.ts`, stored in `opportunity.capability_gap_json`) carries two overlapping notions of "how much do we have":

- `held.status` (`보유 판정`): `met` / `partial` / `unmet` / `unevaluated`, labelled `충족` / `부분 충족` / `미보유` / `미판정`, S3-owned.
- `currentLevel` (`보유 수준`): free text, expected to be one of the 5-step `LEVEL_SCALE` labels `없음` / `기초` / `실무` / `숙련` / `선도`, S5-owned (ADR-0136; ADR-0170 correction).

Users read these as the same question answered twice, with two vocabularies that can contradict each other (for example `충족` with `기초`). `requiredLevel` (`필요 수준`) shares the same 5-step scale, which mixes "how essential is it" with "how good must we be". The `충족률` coverage figure is derived only from `held.status`, and the S5 level pair feeds `levelGap` in S8 (`lib/capability-attainability.ts`).

## 2. Binding decisions (decider, chat 2026-10-14)

- **D1 One held field.** `보유 판정` and `보유 수준` are the same thing. They are unified into one field named `보유 판정` with ordered values `업계 리딩` / `업계 평균` / `부분 보유` / `미보유`, plus unset `미판정`. The meaning is relative to the industry. The 5-step `보유 수준` (`currentLevel`) is removed from UI, API and the row hash.
- **D2 Separate required level.** `필요 수준` (`requiredLevel`) stays a separate field with values `필수` / `부분 필수` / `선택` (plus unset). It expresses how essential the capability is.
- **D3 Decision support only.** No gate block and no grade cap is introduced. Humans confirm every judgement; AI output is a draft.
- **D4 `필요 수준` is S3-owned** (follow-up decision, chat 2026-10-14). Defined and edited only in S3, next to `보유 판정` in the S3 required-capability table (compact), read-only in S5/S7/S8, and included in row hash v2.
- **D5 `기대 수준` added** (follow-up decision, chat 2026-10-14). A per-judgement field, stored with the S5 judgement (Green Field) or the S7 per-target judgement (Brown Field, ADR-0171), not in S3. Same scale as `보유 판정` minus `미보유`: `업계 리딩` / `업계 평균` / `부분 보유` / `미판정`. Entered together with `해소 방식`, cost, months, `달성 가능성` grade and rationale. Section 6A.

## 3. Target model

### 3.1 Held scale (`held.status`)

**Recommendation** for stored keys (English keys, Korean labels, ordered):

| Order | Key | Label | Meaning | Chip |
|---|---|---|---|---|
| 4 | `leading` | `업계 리딩` | Group/affiliates are above the industry norm; a source of advantage | `status-green` |
| 3 | `average` | `업계 평균` | On par with the industry norm | `status-green` |
| 2 | `partial` | `부분 보유` | Some of the capability exists (part of scope, one affiliate, pilot scale) | `status-amber` |
| 1 | `none` | `미보유` | Not held | `status-red` |
| - | `unevaluated` | `미판정` | Not yet judged | `status-not-started` |

`GapHeldStatus` becomes `"leading" | "average" | "partial" | "none" | "unevaluated"`. A shared `HELD_ORDER` gives the ordinal (4..1, `unevaluated` = null) so no consumer hard-codes the order. Chip colour is never the only cue (label always shown, Onyx 3.0 rule).

### 3.2 Backward-compatible reader (no mass rewrite)

`normalizeGapRows` maps legacy stored keys on read:

| Stored | Read as | Flag |
|---|---|---|
| `met` | `average` | `held.legacyStatus = "met"` and a `재판정 권장` hint, because `충족` does not say whether the group is average or above |
| `partial` | `partial` | none (key unchanged) |
| `unmet` | `none` | `held.legacyStatus = "unmet"`, no hint (meaning is identical) |
| `unevaluated` | `unevaluated` | none |
| anything else | `unevaluated` | existing behaviour |

`legacyStatus` is an optional, read-only field kept in JSON until a person saves that row's held status, at which point it is dropped. The hint only shows when `legacyStatus === "met"`. **Recommendation:** write-back happens only on a normal human save of the register (lazy migration); no batch rewrite.

### 3.3 Required level (`requiredLevel`)

**Recommendation** for keys: `essential` (`필수`), `partial_essential` (`부분 필수`), `optional` (`선택`), `""` (unset, shown as `미정`). The field stays a string in JSON.

Legacy text in `requiredLevel` (5-step labels or free text written by S5 or the earlier S8 panel) is **never dropped**. On read, a value outside the new key set is moved into `legacy.requiredLevel` and the live field becomes `""`; the UI shows it as `기존 입력(척도 밖)` with the original text, read-only, beside the new selector. Saving a new value does not erase `legacy`.

**Recommendation:** an optional one-line `requiredScopeNote` (`필수 범위`, max 120 chars) is offered only when `requiredLevel = partial_essential`, to say which part is essential. Optional, never required for completion.

### 3.4 Legacy `currentLevel`

`currentLevel` stops being written, edited or hashed. Stored values are preserved untouched under `legacy.currentLevel` (same read-time move as above) and shown read-only as `기존 보유 수준(참고)` in the row's detail/evidence dialog only, so a reviewer can use it when re-judging `보유 판정`. It is never silently dropped and never mapped automatically to the new held scale (a 5-step skill grade does not translate to an industry-relative position). The restore script `scripts/co-newbiz/restore-capability-levels.ts` keeps working because it writes the raw JSON fields; after this ADR, values it restores land in `legacy` on next read.

### 3.5 Ownership

Decided (D4): `필요 수준` is part of the requirement definition and is **S3-owned**. S3 input UI: one compact select column `필요 수준` placed directly beside `보유 판정` in the S3 required-capability table (`SynergyLinkageTab.tsx`); the optional `필수 범위` line, if adopted, appears under the select only when `부분 필수` is chosen, clamped like the required note. S5, S7 and S8 show both fields read-only with edit links to S3. `보유 판정` stays S3-owned as today. This removes S5 as an editor of either level. Under ADR-0171, S5/S7 own the attainability judgement, including `기대 수준` (section 6A).

## 4. Scoring and gap flags

### 4.1 Coverage (`충족률` replacement)

`summarizeGap` returns counts per new key and a weighted coverage. **Recommendation:** weights `leading` 1, `average` 1, `partial` 0.5, `none` 0; `unevaluated` excluded from the denominator (as today). Rows read from legacy `met` count as `average` (1), so existing coverage numbers do not move. **Recommendation:** rename the label from `충족률` to `보유율` to match the new vocabulary; keep the API property `coveragePct` unchanged.

**Recommendation:** add `essentialCoveragePct` (same weights, rows with `requiredLevel = essential` only) so advisory text can say "essential capabilities covered N%". `optional` rows still count in the overall figure.

### 4.2 Gap-flag matrix (decision-support caution only)

`gapFlag(requiredLevel, heldStatus)` returns one of `large_gap` / `gap` / `check` / `met` / `low_impact` / `unjudged`. It never blocks a gate, never caps a grade, and is labelled as a caution.

| `필요 수준` \ `보유 판정` | `업계 리딩` | `업계 평균` | `부분 보유` | `미보유` | `미판정` |
|---|---|---|---|---|---|
| `필수` | met | met | **large gap** | **large gap** | unjudged |
| `부분 필수` | met | met | check | gap | unjudged |
| `선택` | low impact | low impact | low impact | low impact | unjudged |
| unset / `기존 입력(척도 밖)` | no flag | no flag | no flag | no flag | unjudged |

This matrix is an open decision (OD-3). Labels: `큰 격차 주의`, `격차`, `확인 필요`, `충족`, `영향 낮음`. This is the **current gap** (required vs held today). Section 6A adds the **residual gap** (required vs expected after resolution).

## 5. Row hash v2 (ADR-0170)

Current v1 (`lib/capability-linkage.ts`, `ROW_HASH_VERSION = "v1"`) hashes `capability`, `requiredNote`, `heldStatus`, `holders`, `heldEvidence`, `requiredLevel`, `currentLevel`.

v2 hashes: `capability`, `requiredNote`, `requiredLevel` (new keys only; legacy text excluded), `requiredScopeNote` (if adopted), `heldStatus` (normalized new key), `holders`, `heldEvidence`. `currentLevel` is removed. Prefix `v2:`.

**Problem:** every stamped `basisHash` is `v1:...`, so a naive switch marks every judgement stale. **Recommendation: recompute-on-read compatibility.** When the stored `basisHash` starts with `v1:`, the stale check recomputes the v1 hash of the *current* row using the stored raw (pre-normalization) values, exactly as v1 did. If it matches, the judgement is not stale and the server re-stamps `v2:` on the next write of that row (lazy). If it does not match, it was stale under v1 anyway. This keeps both functions in code until a later cleanup slice; no batch stamping is needed. Alternative: a one-time audited stamping script that writes `v2:` for every v1 match (OD-4).

The legacy-key read mapping (`met` -> `average`) is not itself a change: v1 recomputation uses the raw stored key, and v2 is only stamped from the normalized row. A person changing `met` to `leading` is a real change and invalidates, as intended. `S3Snapshot` drops `currentLevel` and gains `requiredLevel` new-key semantics; old snapshots keep their fields and the diff renderer shows `currentLevel` only as historical.

## 6. Interaction with ADR-0171

- Placement follows 6A.2a: S5 owns resolution and `기대 수준`; S7 owns the target's `보유 판정` and `기대 수준` with `해소 방식` fixed to `인수 통합`; column order follows 5A.
- S5 (Green Field) and S7 (Brown Field, per target) attainability inputs read the unified `held.status` and the S3-owned `requiredLevel`. The S5 5-step `LevelSelect` columns (`필요 수준`, `보유 수준` in `GreenfieldStage.tsx`) are removed; S5 shows both fields read-only with an S3 link.
- `lib/capability-attainability.ts` replaces `levelGap`/`levelStep` (`required_step`, `current_step`) with `gapFlag` and the held ordinal. The S8 read-only summary and technical lens T1 read the same.
- If ADR-0171 is not accepted, this design still applies to the current S8 panel the same way.

## 5A. Display order (decided, chat 2026-10-14)

Evaluation order everywhere is `필요 수준` first, then `보유 판정`. Canonical order per surface:

| Surface | Column / field order |
|---|---|
| S3 required-capability table | `필요 역량` - `필요 수준` - `보유 판정` - `보유 주체·근거` - `해소 힌트` - action |
| S5 (GF) table | read-only `필요 역량` - `필요 수준` - `보유 판정`, then inputs `해소 방식` - `기대 수준` - `비용` - `기간` - `달성 가능성` - `근거·증빙` |
| S7 (BF, per target) table | read-only `필요 역량` - `필요 수준` - `보유 판정` (group, S3), then inputs `대상 보유 판정` - `해소 방식` (fixed `인수 통합`) - `기대 수준` - `비용` - `기간` - `달성 가능성` - `근거·증빙` |
| S8 read-only summary | same as S5 or S7, all read-only |
| S4 evaluation tab (`EvalTab`) | capability, `필요 수준`, `보유 판정`, flag |
| Gate-brief capability line | `역량(필요 수준 / 보유 판정 → 기대 수준, 해소 방식, 개월)` |
| Charter text | capability, `필요 수준`, `보유 판정`, resolution |
| API / OpenAPI schemas, MCP read views | `capability`, `requiredNote`, `requiredLevel`, `requiredScopeNote`, `held`, then judgement fields `resolution`, `expectedLevel`, `closingCostKrwM`, `monthsToAttain`, `grade`, `rationale`, `evidence` |
| AI draft output (holding draft, attainability draft) | same key order as the API |
| Wiki tables | same as the surface they describe |

A shared constant (`CAPABILITY_COLUMN_ORDER` in `lib/capability-gap.ts`) carries the order so surfaces do not hard-code it.

## 6A. `기대 수준` (expected holding level after resolution)

### 6A.1 Semantics

`기대 수준` is the industry-relative level the group expects to hold **once the chosen `해소 방식` is complete, within the stated `달성 기간` (months)**. It is a target, not a fact. It sits in the judgement, next to `해소 방식`, cost, months, `달성 가능성` grade and rationale. Proposed key `expectedLevel` with values `leading` / `average` / `partial` / `unevaluated` (`미판정`); `none` is not offered because a resolution that ends with nothing held is expressed by a low `달성 가능성` grade, not by an expected level.

Three levels per row then read: `필요 수준` (S3, how essential), `보유 판정` (S3, current), `기대 수준` (S5/S7, target).

### 6A.2 Storage and ownership

- Green Field: on the judgement object of the S3 register row (`attainability.expectedLevel`), edited at S5 per ADR-0171.
- Brown Field: on the per-target judgement JSON (`brownfield_target_capability_judgement`, ADR-0171), meaning the expected level **for that target after PMI and key-talent retention**. A target that already holds the capability at `업계 평균` may still be expected to reach only `부분 보유` if retention is weak; the rationale should say so.

### 6A.2a Stage placement (recommendation awaiting decider's final confirmation)

| Stage | Owns |
|---|---|
| S3 | `필요 수준`, `보유 판정` (group/affiliates) |
| S5 (Green Field) | `해소 방식`, `기대 수준`, cost, months, `달성 가능성` grade, rationale |
| S7 (Brown Field, per shortlisted target) | the **target's** `보유 판정` (`targetHeldStatus`, the per-target technical criterion evaluation expressed on the same 4-level scale as S3 so the two are comparable), `기대 수준` (after acquisition, integration and key-talent retention), cost, months, grade, rationale; `해소 방식` fixed to `인수 통합` (shown, not selectable; other complements go in the note) |
| S8 | read-only |

UI text and glossary explain the two meanings separately: S5 `기대 수준` = level after our own resolution completes; S7 `기대 수준` = level the group holds through this target after integration. `targetHeldStatus` is part of the S7 judgement (not hashed in S3) and is invalidated with it.
- The judgement fields formerly called S8-owned in ADR-0170 become S5/S7-owned under ADR-0171; `expectedLevel` joins that set. The S8 route keeps rejecting S3-owned fields and also rejects `expectedLevel` (read-only in S8).

### 6A.3 Guidance by `해소 방식` (suggestion only)

**Recommendation (OD-10):** show a hint next to the select, never restrict the options. Applies to S5; in S7 `해소 방식` is fixed (OD-13), so the hint compares `기대 수준` with `대상 보유 판정` instead.

| `해소 방식` | Typical reachable `기대 수준` within the plan period | Hint text basis |
|---|---|---|
| `직접 구축` (build) | `부분 보유` to `업계 평균` | Organic build is slow; `업계 리딩` needs strong evidence |
| `영입` (hire) | `업계 평균` | Key hires bring proven practice; scale takes time |
| `전략 제휴` (partner) | `업계 평균` to `업계 리딩` (via partner) | Access, not ownership; depends on the agreement |
| `지분 투자` (invest: acquire/licence) | `업계 평균` to `업계 리딩` | Fastest path to an existing leader; Brown Field PMI risk applies |
| none chosen | no hint | |

If the selected `기대 수준` is above the hint for that resolution, the UI shows `근거 확인 권장` (caution only) and the rationale field is highlighted. The hint text is configuration in `lib/capability-gap.ts`, not a rule.

### 6A.4 Gap logic

- **Current gap:** `gapFlag(requiredLevel, held.status)` (section 4.2), shown in S3 and S4.
- **Residual gap:** `residualGapFlag(requiredLevel, expectedLevel)` uses the same matrix with `expectedLevel` in place of the held status. When the residual flag is `large_gap` or `gap`, the row shows `기대 수준이 필요 수준에 못 미침` (decision-support caution). `미판정` gives `unjudged`.
- **Uplift check:** if `expectedLevel` ordinal is below `held.status` ordinal, show `기대 수준이 현재 보유보다 낮음` (likely input error or deliberate divestment; caution only).

### 6A.5 Downstream use

- **`달성 가능성` grade suggestion.** The AI draft (proposal only) considers the uplift from `held.status` to `expectedLevel`, the resolution hint fit (6A.3), cost and months: a large uplift beyond the hint pushes the suggested grade down. A person confirms the grade.
- **Capability-adjusted scenario (ADR-0168 slice).** Reads confirmed, non-stale judgements only. Rows with a residual gap on `필수` remain as a scenario risk (delay or cost uplift) even when the grade is high; rows with no residual gap contribute only their cost and months.
- **Gate brief.** The capability line quotes, per row, `필요 / 보유 → 기대 (해소 방식, 개월)`, and counts rows with `기대 수준이 필요 수준에 못 미침`.
- **S8 read-only summary and technical lens T1.** Show the residual flag next to the grade.

### 6A.6 Staleness

`expectedLevel` is a judgement field. An S3 change to any hashed field (including `필요 수준` and `보유 판정`) invalidates the judgement as in ADR-0170/0171: confirmation cleared, prior values including `expectedLevel` moved to history. `expectedLevel` is not in the S3 row hash (it is not S3-owned). `AttainabilityHistoryEntry` gains `expectedLevel`.

### 6A.7 Is `기대 수준` mandatory?

**Recommendation (OD-11):** optional while drafting; when `해소 방식` is set, confirmation of the judgement requires a `기대 수준` other than `미판정` (a confirm-time validation, 400 `expected_level_required`), mirroring how `rationale_required` works for high/low grades. This is a completeness rule for the judgement record only, not a gate block.

### 6A.8 API, tests, docs

- S5 (GF) and S7 (BF per target) judgement save routes from ADR-0171 accept `expectedLevel` (`leading|average|partial|unevaluated`; else 400 `invalid_expected_level`) and enforce 6A.7 at confirm. Responses include `expectedLevel`, `residualGapFlag`, and `resolutionHint`. OpenAPI updated for those operations.
- Tests: residual matrix, uplift-below-current caution, hint-exceeded caution, confirm-time rule, invalidation moves `expectedLevel` into history, S8 rejects `expectedLevel`.
- Wiki: S5 and S7 pages describe the three levels; glossary entry `기대 수준` added with `보유 판정` and `필요 수준`.

## 7. Consumers to update (found by search; complete for `lib/`, `app/api/`, `components/`, `scripts/`, `tests/`)

| File | Today | Change |
|---|---|---|
| `lib/capability-gap.ts` | `GapHeldStatus`, labels, chips, `LEVEL_SCALE`, `levelStep`, `levelGap`, `normalizeGapRows`, `summarizeGap`, `RemovedCapability`, `S3Snapshot` | New scale, `HELD_ORDER`, compat reader, `REQUIRED_LEVEL_*`, `gapFlag`, weights; `LEVEL_SCALE` kept only for legacy display |
| `lib/capability-linkage.ts` | v1 hash with `currentLevel`, snapshot, diff labels | v2 hash, v1 recompute, snapshot/diff update |
| `lib/capability-attainability.ts` | `levelGap`, `required_step`/`current_step`, held counts | Held ordinal, `gapFlag`, new count keys |
| `lib/gate-brief.ts` | `충족·부분·미보유` counts, `미보유` list, `S5 수준` | New labels, `큰 격차 주의` list, drop S5 level text |
| `lib/track-advisory.ts` | `역량 충족률` thresholds 70/40 | Label `보유율`; optionally prefer `essentialCoveragePct` (OD-6) |
| `lib/project-charter.ts` | gaps = rows not `met` | Gaps = rows with flag `large_gap` / `gap` / `check`, or not `leading`/`average` when `requiredLevel` unset |
| `lib/synergy-pipeline.ts`, `components/stages/synergy/useSynergyResult.ts` | seed `requiredLevel: ""`, `currentLevel: ""` | Stop writing `currentLevel` |
| `app/api/opportunities/[id]/capability-gap/route.ts` | seeds `currentLevel` | Accept new keys, `requiredLevel` new keys, reject `currentLevel` writes (400 `retired_field`) |
| `app/api/opportunities/[id]/capability-gap/llm-draft/route.ts` | prompt and validator use `met|partial|unmet|unevaluated` | New scale and industry-relative wording (section 8) |
| `app/api/opportunities/[id]/route-advisory/route.ts` | `unmet`, `coveragePct`, `unmetRows` | Add `none`/`leading`/`average` counts, `essentialCoveragePct`, `largeGapRows`; keep `unmet` as deprecated alias of `none` for one release |
| `app/api/brownfield/[oppId]/targets/[targetId]/screening-draft/route.ts` | prompt uses `요구 수준` text and held label | Use `필요 수준` label and new held label |
| `app/api/brownfield/[oppId]/target-proposals/web-search/route.ts` | filters rows not `met` | Filter rows not `leading`/`average` |
| `app/api/projects/[id]/capability-attainability/route.ts` | rejects S3-owned fields incl. `currentLevel` | Keep rejecting; error lists `requiredLevel` as S3-owned, `currentLevel` as retired |
| `components/stages/synergy/SynergyLinkageTab.tsx` | S3 held select | New 5-option held select, `필요 수준` select, optional `필수 범위`, legacy hints |
| `components/stages/GreenfieldStage.tsx` | `LevelSelect` x2 | Remove; read-only fields plus S3 link |
| `components/stages/LevelSelect.tsx` | 5-step select | Delete after slice 2 (no other importer found) |
| `components/stages/CapabilityAttainabilityPanel.tsx` | held chip, S5 level caption | New labels, drop level caption, show `gapFlag` |
| `components/stages/route-decision/EvalTab.tsx` | hard-coded `met`/`충족` chips, `미충족`, `충족률` | Use shared label/chip maps, `미보유`, `보유율`, `큰 격차 주의` |
| `components/stages/brownfield/useBrownfieldUniverse.tsx` | `미보유 N건 · 부분충족 N건` | `미보유 N건 · 부분 보유 N건` |
| `scripts/bootstrap-stages.ts`, `scripts/co-newbiz/backfill-capability-gap.ts` | write old keys | Write new keys |
| `scripts/co-newbiz/restore-capability-levels.ts` | restores levels | Unchanged; document that restored values surface as legacy |
| `docs/architecture/openapi.yaml` | `s3_owned_field` list includes `currentLevel` | Section 9 |
| `tests/unit/capability-gap.test.ts`, `capability-linkage.test.ts`, `capability-attainability.test.ts`, `technical-lens.test.ts`, `project-promotion.test.ts`, `restore-capability-levels.test.ts` | old keys | Section 11 |

Every surface in this table also adopts the display order of section 5A (S3 table, S5/S7/S8 tables, `EvalTab`, gate brief, charter, OpenAPI schemas, LLM draft outputs, wiki tables).

MCP tools `draft_capability_gap` and `record_capability_list` were not traced; they likely pass through the same routes (see section 15).

## 8. AI holding-assessment draft

`capability-gap/llm-draft` asks for `leading|average|partial|none|unevaluated`, defines each value relative to the industry, and requires `evidence` to name the profile fact used. Because group/affiliate profiles rarely contain industry benchmarks, the prompt instructs: choose `leading` only with explicit comparative evidence; when the profile shows the capability exists but gives no comparison, use `average` and say "업계 대비 근거 없음" in evidence; when unsure, `unevaluated`. Output remains a draft (`draftedBy: ai`); a person confirms. The validator rejects legacy keys from the model (they are read-compat only, not write-compat). Optional: the draft may also propose `requiredLevel` (**Recommendation:** no, keep it human-only in slice 3; OD-7).

## 9. API and OpenAPI

- Capability-gap PUT accepts `held.status` in the new set; for one release it also accepts legacy keys and maps them (logged), then rejects with 400 `invalid_held_status`.
- `requiredLevel` accepts `essential|partial_essential|optional|""`; other values 400 `invalid_required_level`. `currentLevel` in a body returns 400 `retired_field`.
- Responses include `held.legacyStatus` and `legacy.{requiredLevel,currentLevel}` when present.
- Route-advisory response gains `capabilityGap.{leading,average,none,essentialCoveragePct,largeGapRows}`; `unmet`/`unmetRows` stay as deprecated aliases for one release.
- `openapi.yaml`: update the capability-gap, route-advisory and capability-attainability operation summaries/schemas; `tests/unit/openapi.test.ts` must pass.

## 10. Migration

No schema change: all fields live in JSON columns (`capability_gap_json`, and the ADR-0171 BF judgement JSON if adopted). No migration script in the recommended path (lazy read-mapping plus lazy hash re-stamp). Data is never deleted. Optional later: an audited, dry-run-by-default script that rewrites legacy keys and stamps v2 hashes, run only with decider approval.

## 11. Tests

- Compat reader: each legacy key maps as in 3.2; `legacyStatus` set and cleared on save; unknown keys -> `unevaluated`.
- Legacy level text moves to `legacy.*` and is preserved through a save round-trip.
- `summarizeGap` weights and `essentialCoveragePct`; legacy `met` keeps the same coverage number.
- `gapFlag` full matrix (all 4x5 cells plus unset).
- Hash: v2 excludes `currentLevel`; v1 recompute path says not-stale for an untouched legacy row and stale for a changed one; re-stamp to `v2:` on write.
- Routes: `retired_field`, `invalid_required_level`, legacy-key acceptance window; attainability route still rejects S3-owned fields.
- LLM draft validator rejects legacy keys and `leading` without evidence text.
- UI: labels never colour-only; `design:lint` passes.
- Display order (5A): source-structure tests per surface (S3 table, S5, S7, S8 summary, `EvalTab`) assert `필요 수준` precedes `보유 판정` and the full column order; unit tests assert the gate-brief and charter strings and the LLM draft/API key order.
- S7: `해소 방식` rendered fixed as `인수 통합`; `targetHeldStatus` validation and invalidation.

## 12. Wiki and glossary

- Wiki `docs/wiki/ko/22-공통-S3-*.md` (new held options, `필요 수준`, `필수 범위`, legacy hints), `23-공통-S4-*.md` (`보유율`, `큰 격차 주의`), `40-그린필드-S5-*.md` (remove `보유 수준` instruction at step 4; fields read-only from S3), `51-브라운필드-S7-*.md` (read-only fields per ADR-0171), `30/41/52-*S8-*.md` (summary labels).
- Glossary: no entry for `보유 판정`, `보유 수준` or `필요 수준` was found in `glossary/*.yaml`. **Recommendation:** add `보유 판정` and `필요 수준` to `glossary/business.yaml` with `보유 수준` as a retired alias pointing to `보유 판정`; re-run glossary lint and check the four tooling integrations.

## 13. Risks

- **Silent upgrade of `met`.** Mapping `met` to `average` could understate a leading capability or overstate a weak one. Mitigated by the `재판정 권장` hint and by counting both at weight 1.
- **Loss of granularity.** Four industry-relative levels are coarser than five skill steps. Mitigated by keeping legacy level text visible.
- **Hash compatibility code** must stay correct until cleanup; a bug would mass-invalidate judgements. Covered by tests on real fixtures.
- **Ownership move of `필요 수준` to S3** changes who can edit it; S5 users lose an input they had. Confirm with decider (OD-2).
- **Profiles lack industry benchmarks**, so AI drafts will cluster on `average`. Stated in the prompt and UI caveat.
- Parallel work: ADR-0171 slices touch the same files; sequence slices to avoid conflicts.

## 14. Slices

1. **Scale and S3 input.** New types/labels/order, compat reader, legacy preservation, `gapFlag`, weights, S3 input UI (`SynergyLinkageTab`), capability-gap route validation, hash v2 with v1 recompute, tests.
2. **Consumers, removal and `기대 수준`.** S4 route advisory and track advisory, `EvalTab`, gate brief, charter, BF universe hint, screening-draft and web-search routes, S5/S7/S8 read-only display, attainability lib; remove `currentLevel` UI and `LevelSelect`; display order (5A) on every surface; S5 resolution + `expectedLevel`; S7 `targetHeldStatus` + `expectedLevel` with fixed `인수 통합`; resolution hints, residual flag, confirm rule and history; OpenAPI. Depends on ADR-0171 slices 1-2 for the S5/S7 surfaces.
3. **AI draft and docs.** LLM holding-assessment draft, `달성 가능성` draft using `기대 수준`, capability-adjusted scenario and gate-brief residual line, wiki pages, glossary entries (`보유 판정`, `필요 수준`, `기대 수준`).

## 15. Open decisions (with recommendations)

| ID | Question | Recommendation |
|---|---|---|
| OD-1 | Stored keys for the held scale | `leading` / `average` / `partial` / `none` / `unevaluated`, legacy `met`->`average` (with `재판정 권장`), `unmet`->`none` |
| OD-2 | Is `필요 수준` S3-owned? | Decided (D4): S3-owned, read-only in S5/S7/S8, in hash v2 |
| OD-3 | Gap-flag matrix | As in 4.2; caution only |
| OD-4 | v1 hash handling | Recompute-on-read with lazy v2 re-stamp; no batch script |
| OD-5 | Coverage weights and label | `leading` 1, `average` 1, `partial` 0.5, `none` 0; label `보유율` |
| OD-6 | S4 track-advisory signal basis | Keep overall `coveragePct` thresholds (70/40) and add a separate caution when any `필수` row is `large_gap` |
| OD-7 | Should AI propose `필요 수준`? | No, human-only for now |
| OD-8 | `필수 범위` note for `부분 필수` | Yes, optional one line |
| OD-9 | Legacy `requiredLevel`/`currentLevel` | Preserve read-only under `legacy`, shown as `기존 입력(척도 밖)` / `기존 보유 수준(참고)`; never auto-mapped |
| OD-10 | `기대 수준` guidance by `해소 방식` | Table 6A.3 as hints only; `근거 확인 권장` when exceeded; no restriction |
| OD-11 | Is `기대 수준` mandatory when `해소 방식` is set? | Optional in drafts; required (not `미판정`) to confirm a judgement that has a `해소 방식` |
| OD-13 | S7 `해소 방식`: fixed or selectable? | Fixed `인수 통합` (shown, not selectable); other complements in the note |
| OD-14 | Stage placement (6A.2a) | As in 6A.2a; awaiting decider's final confirmation |
| OD-12 | Brown Field `기대 수준` meaning | Per target, after PMI and key-talent retention; rationale should cite retention assumptions |

## 16. Not verified

- MCP tool handlers (`draft_capability_gap`, `record_capability_list`, `get_route_advisory`) and the analysis-engine CLI were not traced for held-status literals.
- `SynergyLinkageTab.tsx` and `CapabilityAttainabilityPanel.tsx` were not read line by line (they have uncommitted edits from other work).
- The actual distribution of stored `held.status` and level text in the live database was not inspected (no database access by design), so the share of rows that will show `재판정 권장` or `기존 입력(척도 밖)` is unknown.
- Whether S5 `capability_gaps_json` (migration 0056) still carries level fields independent of the S3 register was not confirmed.
- Outputs are decision support, not investment advice.
