---
lang: en
date: 2026-11-21
status: approved (Amendment 2 — Design Gate Row 0a passed 2026-11-21); Amendment 3 owner-requested 2026-11-21 (ReviewBuckets scope ruled by owner 2026-11-21); Amendments 2 and 3 shipped in PR #959 (merged 2026-11-21) without the S7 hint; S7 hint owner-approved 2026-11-21, being implemented in the follow-up PR after #959
owner: ux-designer-agent (design), pm (dispatch)
amendments: Amendment 1 (2026-11-21, pre_fs placement Option A — superseded in part), Amendment 2 (2026-11-21, S6-only Pre-FS at the bottom of S6, stage-scoped S6/S7 panels, new S6 blocker s6.pre_fs_go), Amendment 3 (2026-11-21, S6-only Universe and candidate-discovery authoring sections — not rendered on S7; ReviewBuckets scoped to the current stage per owner ruling 2026-11-21; shipped in PR #959, merged 2026-11-21, without the hint; S7 back-link hint owner-approved 2026-11-21, being implemented in the follow-up PR after #959), Defect Remediation 2026-11-22 (four user-reported defects on the shipped s67 gate surfaces — implemented 2026-11-22, review-passed with adjudications; see § Defect Remediation — 2026-11-22)
related: docs/designs/2026-11-08-deal-shape-to-s7-design.md (s67 screen design of record), ADR-0195, ADR-0201, ADR-0202, docs/designs/2026-11-11-target-identity-resolution-design.md (PATCH D4 single-update-path of record), docs/designs/2026-11-17-deal-shape-viability-first-design.md, docs/design-system/design-tokens.md, docs/design-system/design-components.md, docs/design-system/design-screens.md, process/flow.spec.yaml (S6 blockers — Amendment 2), app/web-next/lib/process-flow.ts (S6 predicate, gateGoPrerequisiteGaps), workspace ADR-0065 (accessibility standard), workspace ADR-0070 (UI preview verification), ADR for the S6 pre_fs blocker (pending — plan Row 1, process-governance-manager)
spec: s67-completion-visibility
---

# Design — S6 `완료기준` visibility on the s67 screen + candidate `발굴 출처` input

## Problem (verified diagnosis)

Deal `01M6JN4YGJXD0BYT7DFH9MWKQ0` is blocked from S7 because Long List candidate
`태웅` carries no Universe `적합 메모` and no discovery source → `longListCandidateGaps`
returns `["attributes", "source"]` → coverage reads 2/3 → the S6 predicate in
`lib/process-flow.ts` (`s6.longlist_attributes`, `s6.longlist_coverage`) stays
incomplete → S7 is locked → the `진출 형태 평가` panel's `AI 추천` call hits the
write guard (`lib/deal-shape-guard.ts`) and is refused with
`409 deal_shape_not_open`, whose only user-facing text is
"`진출 형태 평가는 대상 선정(S7)에 들어선 인수합병(브라운필드) 사업 기회에서만`
`기록할 수 있습니다`." — a message that never says WHAT is missing. The screen the
user is staring at shows no completion criteria at all: the S6 predicate's
blockers/missing exist only inside the engine; the s67 surface never renders them,
and no screen offers a way to cure an already-registered candidate.

Two owner-approved fixes (design only — no implementation in this dispatch):

- **Fix ① — S6 `완료기준` visibility**: render the three completion criteria
  (universe `정의` / `필수 속성·출처` / `최소 커버리지`), the coverage fraction (2/3
  form), and per-candidate unqualified chips near the Long List section, and
  upgrade the generic `notOpen` toast to surface the guard's machine reason
  (`details.reason: track_not_brownfield | stage_not_reached`).
- **Fix ② — candidate `발굴 출처` input**: the `후보 상세 개요` edit form gains the
  discovery fields the evidence contract already understands, so an unqualified
  candidate can be cured in place without delete-and-re-register.

Out of scope (owner-set / scope discipline): any change to `deal-shape-guard.ts`
or the S6 predicate itself (the guard stays the single enforcement point), the
grandfathering rule, scope-granular consent, new dependencies, and the deal-shape
panel's form/verdict model (ADR-0201 shape is untouched).

## Screen-type judgment (explicit)

Both surfaces are existing screens; no new screen is added. The s67 combined area
(`/deals/{id}/s6`·`s7`; `BrownfieldStage`'s sole caller is
`app/deals/[id]/[stage]/page.tsx`) is a **P1 Registry** composite (per
design-screens.md) that already stacks Universe (P1 write) → Long List (P1) →
Short List + gate (P3) top-to-bottom. This design adds one **criteria strip**
inside the Long List section and one **field group** inside the existing detail
edit form — no new pattern class, no StageTabs change, no head-order change
(the head's top-right action stays the StageFrame next-stage navigation).

## JTBD

**Persona**: a deal analyst (owner/analyst role) driving a brownfield opportunity
through S6→S7.

**Job**: *when I am working the s67 screen and something is blocked, let me see
which completion criterion is open and which candidate causes it, so I can cure
that candidate in place and reach S7 — without opening dev tools or guessing
from a 409.*

Sub-jobs: (a) **see the state** — the three S6 criteria and the coverage fraction
answer "why can't I record / why is S7 locked" at a glance; (b) **locate the
offender** — the Long List row that does not count toward coverage is marked, so
no name-matching against truncated blocker prose; (c) **cure in place** — from
that row, one hop to the candidate detail where `발굴 출처` and the Universe note
can be completed; (d) **fail honest** — if a guarded action is still attempted,
the refusal names the reason (track vs stage) instead of a generic sentence.

## Current state, annotated

### Surface 1 — s67 combined area (`BrownfieldStage`, `/deals/{id}/s6|s7`)

```
StageFrame (h1 S6·S7, subtitle, purpose, handoff strip, rail)
┌────────────────────────────────────────────────────────────────────┐
│ UniverseSection (목표 시장 정의 — S6 write surface)                  │
│ ── LonglistSection ──────────────────────────────────────────────  │
│ │ SectionToolbar  후보 전체 목록 n · 최종 m                          │
│ ▸ DEFECT D1: no S6 completion state anywhere — the engine's S6      │
│   blockers/missing ("Target Universe 정의가 필요합니다…",           │
│   "필수 속성·출처가 없는 Long List 후보 1건 — 태웅…",               │
│   "Long List 커버리지 부족 (2/3 …)") are computed by                 │
│   evaluateProcess but never rendered on this screen.                │
│ │ [status filter row]                                               │
│ │ data-table: 후보명 | DART | 재무·기술 | 순위 | 상태 | 작업          │
│ │   태웅  ─────────────────────  ▸ DEFECT D2: the row that fails    │
│ │   (#does not count toward coverage) is visually identical to a    │
│ │   qualified row — no unqualified chip.                            │
│ ── ShortlistSection (심사 종료 promote buttons, S7 tabs) ──        │
│ │ S7DecisionTabs: [진출 형태 평가] [의사결정 — 승인 기록]            │
│ │   DealShapePanel: [AI 추천 (ghost)] [기록]                        │
│ ▸ DEFECT D3: both buttons stay enabled while S7 is locked; the      │
│   resulting 409 shows the generic notOpen sentence that names no    │
│   missing criterion (single ko/en string, details.reason dropped).  │
└────────────────────────────────────────────────────────────────────┘
▸ DEFECT D4 (data): GET /api/opportunities/[id]/process returns
  stages[] with status only — per-stage blockers/missing are computed
  by evaluateOpportunityStage and then discarded for non-current
  stages, so the s67 page has nothing to render even if it wanted to.
▸ DEFECT D5 (data): GET /api/brownfield/[oppId]/targets returns
  screening_summary / eval_summary / eval_draft per target but no
  `gaps`, so per-candidate chips and the coverage count cannot be
  derived client-side (the discovery evidence needed for the `source`
  gap never reaches the list payload).
```

### Surface 2 — `후보 상세 개요` edit form (`TargetOverviewEditTab`)

```
┌──────────────────────────────────────────────────────────────────┐
│ [개요] [재무] [공시] [평가]         [재분석] [정보 수정] [삭제]    │
│ (정보 수정 → editing=true, overview tab)                           │
│ ┌ form ────────────────────────────────────────────────────────┐ │
│ │ 회사명 [______]  DART 고유번호 [____]  [저장] [취소]           │ │
│ ▸ DEFECT D6: universe_note is round-tripped by saveEdit          │ │
│   (editDraft carries it) but NO field renders it — the cure for  │
│   태웅's "Universe 적합 메모" has no input on this screen.        │ │
│ ▸ DEFECT D7: no 발굴 출처 fields at all. PATCH accepts only       │ │
│   company_name / dart_corp_code / universe_note; the discovery   │
│   evidence row that longListCandidateGaps requires (source_url   │
│   OR detail non-empty) can only be created at registration.      │ │
│ │ (dartCodeNote caption)                                         │ │
│ └──────────────────────────────────────────────────────────────┘ │
│ ▸ DEFECT D8: no qualification state anywhere on the detail — a    │
│   candidate whose discovery evidence is empty shows no unqualified│
│   chip here either; the person learns about the gap only from the │
│   engine's blocker prose elsewhere (if at all).                   │
└──────────────────────────────────────────────────────────────────┘
```

### Defect register

| # | Defect | Fix in this design |
|---|---|---|
| D1 | S6 completion criteria never rendered on the s67 screen | `S6CriteriaPanel` strip inside the Long List section — three criterion rows + coverage fraction (§ Fix ①-a) |
| D2 | Unqualified Long List row is indistinguishable | Per-candidate chip (icon + text, row subline under the candidate name) fed by a new server `gaps` field (§ Fix ①-b, § API C) |
| D3 | `AI 추천`/`기록` 409 with a generic sentence | Buttons pre-disabled with an adjacent reason that references the criteria strip; the 409 toast maps `details.reason` to two specific messages (§ Fix ①-c) |
| D4 | Process API drops per-stage blockers/missing | `stages[]` entries gain index-aligned `blockers`/`missing` (§ API A) |
| D5 | Targets list lacks gap data | Each `targets[]` entry gains `gaps` (§ API C) |
| D6 | Universe `적합 메모` has no edit field on the detail | `universe_note` textarea added to the overview edit form (§ Fix ②-a) |
| D7 | No discovery-source input; PATCH cannot cure `source` | `발굴 출처` fieldset + PATCH contract extension writing a discovery evidence row (§ Fix ②-b, § API B) |
| D8 | No qualification state on the detail | Qualification chip pair in the overview tab, shown open even when the form is closed (§ Fix ②-c) |

## Data contract (real, changed only where specified)

- `GET /api/opportunities/[id]/process` → `ProcessEvaluation` (top-level
  `blockers`/`requiredArtifacts` stay current-stage-only and unchanged; per-stage
  addition in § API A).
- `GET /api/brownfield/[oppId]/targets` → per-target payload gains `gaps`
  (§ API C). `universe` (parsed `target_universe_json`) is already returned —
  the client already holds `min_long_list` for the coverage fraction.
- `PATCH /api/brownfield/targets/{targetId}` → body gains the discovery fields
  (§ API B). Existing fields and the 409 `duplicate_target` collision contract
  are unchanged.
- Guard untouched: `dealShapeWriteGuard` still returns
  `{ reason: "track_not_brownfield" | "stage_not_reached", message }`; the REST
  route already carries `reason` in `details` — the UI starts reading it.

## Fix ① — S6 `완료기준` on the s67 screen

### a. Criteria strip (`S6CriteriaPanel`)

New client component `components/stages/brownfield/S6CriteriaPanel.tsx`, rendered
inside `LonglistSection` directly under its `SectionToolbar` (before the status
filter row), so the criteria and the Long List table read as one block. Anchor
`id="s6-criteria"` (`scroll-margin-top` per the `SECTION_IDS` convention).
Hidden when the process read fails (fail-quiet, the screen keeps working) and
when the stage reads `terminated` (a killed process has nothing left to complete).

One engine-state read feeds everything (the StageFrame rule "single engine-state
read for a stage"): new hook `useS6Gate(opportunityId)` fetches
`GET /api/opportunities/{id}/process` once, is called in `BrownfieldStage`, and
flows through `ctx` to the criteria panel, the Long List rows, and the
ShortlistSection → S7DecisionTabs → DealShapePanel chain. No second fetch.

```
┌ S6 완료기준 ───────────────────────────────────────── [id=s6-criteria] ┐
│ ✓ Target Universe 정의                                  [충족]          │
│ ✕ Long List 후보 필수 속성·출처                          [미충족]        │
│    필수 속성·출처가 없는 Long List 후보 1건 — 태웅 (식별자·Universe     │
│    적합 메모·발굴 출처 기록 필요)                        ← engine prose │
│ ✕ Long List 최소 커버리지                               [미충족]        │
│    커버리지 2/3 · 필수 속성·출처를 갖춘 후보 2/3건                       │
│    미충족 후보는 후보 상세에서 Universe 적합 메모·발굴 출처를 보완하세요  │
└────────────────────────────────────────────────────────────────────────┘
```

Rendering rules:

- Criterion **names** reuse the existing `processBlockers.s6_*` catalog keys via
  `localizeBlocker`/`blockerMessageKey` (single source; ko/en parity already
  test-pinned). No new label keys for the three names.
- Each row = status glyph (✓/✕, `aria-hidden`) + visually hidden state word
  (`충족`/`미충족`) + criterion name. Status is never colour-only (StageRail rule).
- Row state comes from the stage's `missing` keys: `s6.target_universe` /
  `s6.longlist_attributes` / `s6.longlist_coverage` absent → `충족`; present →
  `미충족` with the engine's own prose paired from the same index of `blockers`
  (§ API A pins the index-alignment contract).
- **Coverage fraction** is the completion bar: `커버리지 {covered}/{minLongList}`
  where `covered = targets.filter(t => t.gaps.length === 0).length` (from § API C)
  and `minLongList = universe.min_long_list ?? 3` (already in the targets
  payload). When qualified ≠ registered, append the secondary note
  `필수 속성·출처를 갖춘 후보 {qualified}/{registered}건`. When the engine
  grandfathered the opportunity (§ API C returns empty `gaps`), the fraction
  degrades to the registered count, matching the engine.
- All-met state: the strip collapses to one line
  `✓ 3가지 완료기준을 모두 충족했습니다` (mirrors StageGuidance's green
  complete chip), keeping the anchor stable for the reason links below.

### b. Per-candidate unqualified chips (Long List rows)

Inside the candidate-name cell, as a row subline under the name (the same slot
pattern `exclusion_reason` already uses — narrow widths avoid horizontal scroll):

```
│ 태웅                                    │ 8812…  │ ⚙2 ✓1 … │ #4 (67점) │ 심사 중 │ AI 평가 · 항목 검토 · … │
│ ⚠ 속성·출처 미충족  ← chip, links to detail               │        │         │          │        │                        │
```

- Chip text by gap composition: `속성 미충족` / `출처 미충족` / `속성·출처 미충족`
  (icon ⚠ `aria-hidden` + text — never color-only; `status-amber` token pair,
  the OriginBadge precedent). Excluded rows keep showing their chip (history is
  information; coverage no longer depends on them either way).
- The chip is a **link** to `/brownfield/targets/{id}?edit=1` with an
  `aria-label` naming the company and the cure ("`태웅: 필수 속성·출처 미충족 —`
  `후보 상세에서 보완`"). The detail page consumes `edit=1` by opening the overview
  tab in editing state (one query param read on mount; no new route).
- The `data-gaps="attributes,source"` attribute is set for tests and for the
  promote modal warning (below).

### c. Button states and the 409 fallback

**`AI 추천` and `기록` (DealShapePanel)** — the two actions the write guard refuses:

- When S7 is not reached (`useS6Gate` reports S6 status ≠ `complete`), both
  buttons render `disabled` with an adjacent reason line (the PrimaryAction
  contract's text-beside-the-button treatment, applied to these ghost buttons):
  `S6 완료기준 미충족 — 대상 선정(S7)에 들어와야 기록할 수 있습니다` followed by
  a visible anchor link `S6 완료기준 보기 →` (`href="#s6-criteria"`). The reason
  line id is wired to both buttons via `aria-describedby`. This is **client-side
  pre-emptive state, not a new guard** — the server guard remains the single
  enforcement point; if state is stale the next paragraph still applies.
- **Toast upgrade** (the guard still refusing, e.g. stale UI): `dealShapeErrorKind`
  gains an optional `details` parameter and maps `409 deal_shape_not_open` by
  `details.reason`:
  - `stage_not_reached` → kind `notOpenStage`:
    "`아직 대상 선정(S7)에 들어서지 않았습니다 — 위 S6 완료기준의 남은 요건을 먼저`
    `충족하세요`." plus an inline `#s6-criteria` anchor link.
  - `track_not_brownfield` → kind `notOpenTrack`:
    "`진출 형태 평가는 인수합병(브라운필드) 사업 기회에서만 기록할 수 있습니다 —`
    `이 기회의 현재 진로 결정은 그린필드입니다`."
  - Missing/unknown `reason` → falls back to the existing `notOpen` string
    (backward compatible with any stored flow that predates the reason field).
  The recommend error (`reco.error`, `role="alert"`) and the submit
  `serverError` both consume the same kinds — one mapping, two surfaces.

**`심사 종료` (PromoteButton)** — divergence, recorded: the assignment asks for a
disabled state here too, but promotion is a person's act that is *never blocked*
(ADR-0200 Q3 boundary) and no guard refuses it, so there is no blind 409 to
remove. Instead: when the row carries open gaps, the promote confirm modal gains
a warning line `필수 속성·출처가 없어 S6 커버리지에 산입되지 않습니다 — 먼저`
`후보 상세에서 보완할 수 있습니다` with the same detail link. The button stays
enabled; the reason is impossible to miss. Flagged in § Divergences for PM
sign-off.

## Fix ② — candidate `발굴 출처` input (`후보 상세 개요`)

### a. Universe `적합 메모` field (cures the `attributes` gap)

A textarea between the DART code field and the actions row, bound to
`editDraft.universe_note` (the value `saveEdit` already PATCHes — D6 closes
without any state-model change). Label `Universe 적합 메모`, placeholder naming
the expected content (segment / why it fits the Universe), 3 rows.

### b. `발굴 출처` fieldset (cures the `source` gap)

```
┌ form (editing=true) ─────────────────────────────────────────────────┐
│ S6 후보 자격   [✓ 속성 충족] [✕ 출처 미충족]                            │
│ 회사명   [태웅                    ]                                    │
│ DART 고유번호 [____________]                                           │
│ Universe 적합 메모 [________________________ 3 rows ________________]  │
│ ── 발굴 출처 (fieldset, legend) ──────────────────────────────────     │
│ 발굴 경로   [직접 등록 ▾]   (직접 등록 / 시장·기업 마스터 제안 / 웹검색 제안)│
│ 출처 URL   [https://______________________________]                    │
│ 발굴 메모   [__________________________________________ 3 rows ____]   │
│ ⓘ URL 또는 발굴 메모 중 1개 이상을 입력하면 발굴 출처 요건이 충족됩니다.  │
│                                          [저장] [취소]                 │
└──────────────────────────────────────────────────────────────────────┘
```

- **`발굴 경로`** select = the existing enum verbatim (`manual` / `master_proposal`
  / `web_proposal`), defaulting to the row's current `discovery_source`; PATCHing
  it updates the row column (provenance of record). Changing it alone never
  qualifies a candidate — `longListCandidateGaps` counts an accepted proposal
  only when `proposal_accepted_at` is set, which stays a proposal-acceptance
  action, not an edit-form action.
- **`출처 URL`** (`type="url"`, `inputMode="url"`) and **`발굴 메모`** (textarea) are
  the cure fields: on save with ≥1 non-empty value, the server appends ONE
  discovery evidence row (`brownfield_target_evidence`, kind `discovery`) via the
  existing `insertTargetEvidence` timeline-append — evidence is append-only
  history (`나중에 참고`), never mutated, so no update/delete semantics are
  invented.
- **Validation (client + server, same rule)**: a save that carries the discovery
  content fields must include at least one non-empty value after trim — both
  empty → inline error `discoveryBothEmpty` (client, `role="alert"`,
  `aria-describedby` on the fieldset) / `400 invalid_request` naming the rule
  (server). A save that omits the keys entirely (identity/name-only edit) is
  unchanged behaviour. No strict URL format check beyond non-empty trim — the
  engine only requires non-empty; free-form provenance notes are legitimate.
- Malformed URL is left to `type="url"` browser validation; the server accepts
  any non-empty string (the evidence contract never promised URL parsing).

### c. Qualification chips + empty state (D8)

- The form header carries the **S6 `후보 자격`** chip pair, computed client-side
  from data the detail payload already returns: `attributes` = company_name +
  (dart_corp_code OR company_id) + universe_note; `source` = accepted proposal
  (`discovery_source !== "manual" && proposal_accepted_at`) OR ≥1 `kind=discovery`
  evidence row with non-empty `source_url`/`detail` (the `evidence` array is
  already in `DetailResponse`; `TargetDetail` type widens with
  `discovery_source`/`proposal_accepted_at` — the server already returns them in
  `bt.*`). This client helper mirrors `longListCandidateGaps`; the server `gaps`
  field (§ API C) stays authoritative for the s67 screen (drift pinned by a unit
  test on the parity, § Handoff).
- **Empty state outside the form**: when the overview tab is NOT editing and the
  `source` (or `attributes`) gap is open, the same chip pair renders at the top
  of the overview tab body with the cure hint `미충족 항목은 [정보 수정]에서
  보완할 수 있습니다` — an existing candidate whose discovery evidence is empty
  is marked here, not only on the s67 screen. Both chips met → the pair renders
  met-state (quiet, green) and the hint is omitted.

## Components and tokens consumed (named from the doctrine)

| Piece | Source | Notes |
|---|---|---|
| `S6CriteriaPanel`, `useS6Gate` | new (`components/stages/brownfield/`) | composition only — no new tokens |
| `.card`, `.sizing-grade-card`, `SectionToolbar` | existing | strip lives inside the Long List card; toolbar unchanged |
| `status-chip status-green / status-amber / status-not-started` | existing RAG chip classes | chips carry glyph + text, never colour-only (design-tokens `--green-*`/`--amber-*` tuned pairs, both themes) |
| `btn-ghost btn-sm`, `btn-premium btn-sm` | existing | promote modal buttons unchanged; form buttons unchanged |
| `sizing-new-input`, `sizing-new-input-sm`, `sizing-new-form` | existing (Long List registration form's classes) | the new form fields reuse the exact registration-form styling so the two surfaces read as one system |
| `data-table list-table table-fixed-pct tmin-32` + `ColGroup` | existing (list-table standard) | no new column — chip is a label-cell subline like `exclusion_reason` |
| `PrimaryAction` reason contract (`disabledReason` → adjacent `.primary-reason` + `aria-describedby`) | `components/ui.tsx` | treatment pattern borrowed for the deal-shape ghost buttons (they are secondary actions; PrimaryAction itself stays the committee-review primary — one primary action per screen is preserved) |
| `localizeBlocker` / `blockerMessageKey` | `lib/labels.ts`, `lib/process-blocker-keys.ts` | criterion names + engine prose localization, reuse as-is |
| Spacing/type | `--space-1..4`, `--fs-body`/`--fs-caption` (13px floor for captions only), `--radius-md` | no ad-hoc px, no raw colours (design-tokens) |

## API contract additions (backend implements separately)

### A. `GET /api/opportunities/[id]/process` — per-stage blockers/missing

Each entry of `stages[]` gains two fields, **index-aligned** (blockers[i] is the
human-readable prose for missing[i]; the S6 predicate pushes them in pairs —
`lib/process-flow.ts` S6 branch):

```jsonc
// stages[] entry, ProcessEvaluation envelope unchanged otherwise
{
  "id": "S6",
  "status": "current",            // existing
  "blockers": [                   // NEW — Korean engine prose, in push order
    "필수 속성·출처가 없는 Long List 후보 1건 — 태웅 (식별자·Universe 적합 메모·발굴 출처 기록 필요)",
    "Long List 커버리지 부족 (2/3 — 필수 속성·출처를 갖춘 후보만 산입)"
  ],
  "missing": [                    // NEW — stable keys (lib/process-blocker-keys.ts)
    "s6.longlist_attributes",
    "s6.longlist_coverage"
  ]
}
```

- Present (as arrays, possibly empty) for stages whose predicate was evaluated
  (`status: "complete" | "current"`); `[]` for `locked` / `skipped` /
  `terminated` (the engine's sequential-entry loop does not evaluate locked
  stages — this contract does not change that).
- Top-level `blockers` / `requiredArtifacts` remain the current-stage values,
  byte-identical to today — purely additive, every existing consumer unaffected.
- No blocker-key vocabulary change: the keys already exist in
  `process-blocker-keys.ts` and `processBlockers.*` catalogs (ko/en parity is
  test-pinned); `check-engine-spec-parity` has nothing new to check.
- Implementation note (backend, recorded 2026-11-21): the predicate internals
  push LABELS into `missing` (via `blocker(key)` — those labels are also what
  top-level `requiredArtifacts` must keep carrying, byte-identical). The
  per-stage `missing` field is therefore produced by resolving each label
  through `blockerKeyForLabel(label, stageId)` at response-build time — the
  `s6.*` keys in this example are exactly what that yields. All predicates and
  delegated modules push through `blocker(key)`, so the lookup is total; a
  free-form label would pass through verbatim as a fallback. Index alignment is
  unaffected (same array positions). The enum names in § API B
  (`manual` / `master_proposal` / `web_proposal`) were verified verbatim
  against `TargetRow.discovery_source` — no correction needed.

### B. `PATCH /api/brownfield/targets/{targetId}` — discovery fields

Request body additions (all optional, absent = unchanged; existing fields and
the 409 `duplicate_target` collision contract unchanged):

```jsonc
{
  "company_name": "태웅",                    // existing
  "dart_corp_code": "00123456",             // existing
  "universe_note": "중형 건설장비 리스 — Universe 정의의 중장비 세그먼트에 적합",
  "discovery_source": "manual",             // NEW — "manual" | "master_proposal" | "web_proposal"
                                            //        updates brownfield_target.discovery_source
  "discovery_source_url": "https://news.example.co.kr/article/123",  // NEW
  "discovery_note": "2026-11 업계 기사에서 확인한 인수 후보"            // NEW
}
```

- **Validation**: if the request carries `discovery_source_url` and/or
  `discovery_note` and BOTH are empty after trim → `400 invalid_request`
  ("at least one of discovery_source_url / discovery_note must be non-empty —
  a discovery evidence row without either does not satisfy the S6 source
  criterion"). This mirrors exactly what `longListCandidateGaps` accepts.
  Requests without those keys are unaffected.
- **Effect**: one transaction = `updateTargetFields` (the D4 single update path,
  widened with the `discovery_source` column) +, when ≥1 discovery content value
  is non-empty, ONE appended `brownfield_target_evidence` row via
  `insertTargetEvidence`: `kind: "discovery"`, `title: "발굴 출처 보완 — 직접 기록"`,
  `detail: discovery_note ?? null`, `source_url: discovery_source_url ?? null`,
  `source_kind: <effective discovery_source>`. Append-only — no evidence row is
  ever updated or deleted by this route. The existing single
  `brownfield_target.update` audit shape covers the write (evidence append is an
  auxiliary record per `insertTargetEvidence`'s design).
- **Response**: the updated target row (unchanged shape) — the client re-fetches
  the detail (`loadDetail`), whose `evidence` array then carries the new row.

### C. `GET /api/brownfield/[oppId]/targets` — per-target gaps

Each entry of `targets[]` gains one field:

```jsonc
{
  "id": "01M…",
  "company_name": "태웅",
  "gaps": ["attributes", "source"],   // NEW — longListCandidateGaps output verbatim
  "screening_summary": { … },          // existing
  "eval_summary": { … },               // existing
  "eval_draft": { … }                  // existing
}
```

- Values are the `longListCandidateGaps` return verbatim
  (`Array<"attributes" | "source">`; `[]` = qualified).
- **Grandfathering parity**: when the engine's `opportunityGrandfathered(opp)` is
  true, emit `gaps: []` for every row — mirroring the S6 predicate, which skips
  the per-candidate check for grandfathered opportunities. Without this the
  chips would flag rows the engine counts as covered (a contradiction on the
  same screen).
- This is the third contract addition beyond the two named in the assignment; it
  is unavoidable: the `source` gap depends on discovery evidence rows that the
  list payload does not carry, and the engine's blocker prose truncates the
  offender list at three names, so per-row chips cannot be derived client-side.

## Accessibility checklist (WCAG 2.1 AA, both themes)

- **Not colour-only**: every state is glyph + visible text + visually hidden
  state word (✓/`충족`, ✕/`미충족`, ⚠/chip text); chip colour is a token pair
  (`--amber-*`/`--green-*`) tuned for both themes (1.4.1).
- **Criteria strip**: `<section aria-labelledby>` heading; criterion rows are a
  list; engine prose kept verbatim (no information lost); the strip is ordinary
  content — no ARIA live region needed (it changes on navigation/re-fetch, not
  asynchronously mid-task).
- **Disabled `AI 추천`/`기록`**: `disabled` + adjacent visible reason text +
  `aria-describedby` id; the anchor link (`S6 완료기준 보기 →`) is a separate,
  visible, focusable element next to the buttons — keyboard users reach the
  cure path without the disabled buttons (2.1.1, 4.1.2).
- **409 fallback**: `role="alert"` (existing pattern) so the specific reason is
  announced; the inline anchor link is tabbable.
- **Long List chips**: chip is a real link with a company-naming `aria-label`
  (4.1.2); subline sits in the existing label cell so the `tmin-32` scroll
  region keeps its documented `tabIndex={0}` keyboard-scroll handling (2.1.1);
  no new table column → the list-table standard's sr-only actions header and
  fixed widths are untouched (design-lint stays green).
- **Edit form**: every field has a bound `<label>`; `발굴 출처` group is a
  `<fieldset>` + `<legend>` with the helper line as `aria-describedby` on the
  fieldset; the both-empty error is `role="alert"` and referenced from the two
  content fields; textarea 3 rows; URL input `type="url"` (2.5.3/3.3.1/3.3.3).
- **Qualification chips**: plain chips with `title` and sr-only gap wording;
  when the form is open they sit in the form header, reading before the fields
  they describe.
- **Contrast**: caption text only at `--fs-caption` (13px floor) for metadata
  lines; all chip pairs AA in light and dark (token-only styling — no raw
  colours anywhere; 1.4.3/1.4.6).
- **Target size / focus**: chip links and buttons use the existing `btn-sm`
  scale with visible focus; no negative `tabindex`; anchor targets carry
  `scroll-margin-top` (2.4.7, 2.4.11).

## i18n — new and changed keys (ko/en catalogs, parity enforced)

Existing keys **reused** (no change): `processBlockers.s6_target_universe`,
`processBlockers.s6_longlist_attributes`, `processBlockers.s6_longlist_coverage`
(criterion names + engine prose via `localizeBlocker`), `common.save`,
`common.cancel`, `common.status`, `common.all`.

| Key (new unless marked) | ko | en |
|---|---|---|
| `stages.s67.criteriaPanel.heading` | `S6 완료기준` | S6 completion criteria |
| `stages.s67.criteriaPanel.allMet` | `3가지 완료기준을 모두 충족했습니다` | All three completion criteria are met |
| `stages.s67.criteriaPanel.metChip` | `충족` | Met |
| `stages.s67.criteriaPanel.openChip` | `미충족` | Open |
| `stages.s67.criteriaPanel.srMet` | `충족됨` | met |
| `stages.s67.criteriaPanel.srOpen` | `미충족` | not met |
| `stages.s67.criteriaPanel.coverageLine` | `커버리지 {covered}/{min}` | Coverage {covered}/{min} |
| `stages.s67.criteriaPanel.qualifiedNote` | `필수 속성·출처를 갖춘 후보 {qualified}/{registered}건` | {qualified}/{registered} candidates carry the required attributes and source |
| `stages.s67.criteriaPanel.cureHint` | `미충족 후보는 후보 상세에서 Universe 적합 메모·발굴 출처를 보완하세요` | Open candidates can be cured on their detail screen — complete the Universe-fit note and discovery source |
| `stages.s67.longlistSection.gapAttributes` | `속성 미충족` | Missing attributes |
| `stages.s67.longlistSection.gapSource` | `출처 미충족` | Missing source |
| `stages.s67.longlistSection.gapAttributesSource` | `속성·출처 미충족` | Missing attributes and source |
| `stages.s67.longlistSection.gapChipAria` | `{company}: {gap} — 후보 상세에서 보완` | {company}: {gap} — cure on the candidate detail |
| `stages.s67.dealShapePanel.blockedReasonS7` (new) | `S6 완료기준 미충족 — 대상 선정(S7)에 들어와야 기록할 수 있습니다` | S6 completion criteria unmet — recording unlocks once the deal reaches target selection (S7) |
| `stages.s67.dealShapePanel.blockedReasonLink` (new) | `S6 완료기준 보기` | View the S6 completion criteria |
| `stages.s67.dealShapePanel.serverError.notOpenStage` (new) | `아직 대상 선정(S7)에 들어서지 않았습니다 — S6 완료기준의 남은 요건을 먼저 충족하세요.` | This deal has not reached target selection (S7) yet — satisfy the remaining S6 completion criteria first. |
| `stages.s67.dealShapePanel.serverError.notOpenTrack` (new) | `진출 형태 평가는 인수합병(브라운필드) 사업 기회에서만 기록할 수 있습니다 — 이 기회의 현재 진로 결정은 그린필드입니다.` | A deal-shape evaluation is recorded only for a brownfield (M&A) opportunity — this deal's current route decision is greenfield. |
| `stages.s67.dealShapePanel.serverError.notOpen` (changed) | `진출 형태 평가는 대상 선정(S7)에 들어선 인수합병(브라운필드) 사업 기회에서만 기록할 수 있습니다.` *(unchanged string; role demoted to unknown-reason fallback)* | *(en string unchanged; fallback role)* |
| `stages.s67.aiEval.promoteQualificationWarning` (new) | `필수 속성·출처가 없어 S6 커버리지에 산입되지 않습니다 — 먼저 후보 상세에서 보완할 수 있습니다.` | This candidate lacks the required attributes or source and does not count toward S6 coverage — it can be cured on the candidate detail first. |
| `components.brownfieldTarget.overviewTabs.qualsLabel` (new) | `S6 후보 자격` | S6 candidate qualification |
| `components.brownfieldTarget.overviewTabs.qualAttributesMet` (new) | `✓ 속성 충족` | ✓ attributes met |
| `components.brownfieldTarget.overviewTabs.qualAttributesOpen` (new) | `✕ 속성 미충족` | ✕ attributes missing |
| `components.brownfieldTarget.overviewTabs.qualSourceMet` (new) | `✓ 출처 충족` | ✓ source met |
| `components.brownfieldTarget.overviewTabs.qualSourceOpen` (new) | `✕ 출처 미충족` | ✕ source missing |
| `components.brownfieldTarget.overviewTabs.qualCureHint` (new) | `미충족 항목은 정보 수정에서 보완할 수 있습니다` | Open items can be completed in the edit form |
| `components.brownfieldTarget.overviewTabs.universeNoteLabel` (new) | `Universe 적합 메모` | Universe-fit note |
| `components.brownfieldTarget.overviewTabs.universeNotePlaceholder` (new) | `이 후보가 Universe에 적합한 이유 (세그먼트·선정 근거)` | Why this candidate fits the Universe (segment, selection rationale) |
| `components.brownfieldTarget.overviewTabs.discoveryHeading` (new) | `발굴 출처` | Discovery source |
| `components.brownfieldTarget.overviewTabs.discoverySourceLabel` (new) | `발굴 경로` | Discovery channel |
| `components.brownfieldTarget.overviewTabs.discoverySourceManual` (new) | `직접 등록` | Registered directly |
| `components.brownfieldTarget.overviewTabs.discoverySourceMasterProposal` (new) | `시장·기업 마스터 제안` | Market & company master proposal |
| `components.brownfieldTarget.overviewTabs.discoverySourceWebProposal` (new) | `웹검색 제안` | Web-search proposal |
| `components.brownfieldTarget.overviewTabs.discoveryUrlLabel` (new) | `출처 URL` | Source URL |
| `components.brownfieldTarget.overviewTabs.discoveryNoteLabel` (new) | `발굴 메모` | Discovery note |
| `components.brownfieldTarget.overviewTabs.discoveryHelper` (new) | `ⓘ URL 또는 발굴 메모 중 1개 이상을 입력하면 발굴 출처 요건이 충족됩니다.` | Enter at least one of the URL or the discovery note to satisfy the discovery-source criterion. |
| `components.brownfieldTarget.overviewTabs.discoveryBothEmpty` (new) | `출처 URL 또는 발굴 메모 중 1개 이상을 입력하세요.` | Enter at least one of the source URL or the discovery note. |
| `components.brownfieldTarget.overviewTabs.discoverySaved` (new) | `발굴 출처를 기록했습니다.` | Discovery source recorded. |

## Escalation list (doctrine gaps → design-system-agent)

1. **Completion-criteria strip for deal stages** — StageFrame's "`이 단계에서`
   `남은 것`" guidance block exists only for PROJECT stages
   (`gatedProjectStage` excludes S1–S7 by construction). This design introduces
   its deal-stage counterpart as a section-local strip rather than a frame
   slot. Register the pattern ("completion-criteria strip", composite P1/P3
   screens) in design-screens.md so the next blocked deal stage reuses one
   pattern instead of inventing another.
2. **Label-cell subline pattern** — the Long List chip is a third subline use in
   the label cell (after `exclusion_reason` here and the glossary list's
   sublabels). The list-table standard codifies chips *wrapping in their own
   column* but not content sublines inside the label cell. Codify "label-cell
   subline" (max 1 interactive element per subline, caption size, muted or chip
   treatment) so design-lint can check it.
3. **Status glyph vocabulary** — ✓/✕/⚠/○/? glyphs are used ad hoc across chips
   (DealShapePanel verdicts, OriginBadge, StageRail minus-circle). This design
   needs a met/open pair that reads identically in both themes. Propose
   codifying the existing glyph set (with sr-only state words as the norm) in
   design-components.md instead of adding new chip variants.

No doctrine conflict found: single-primary-action discipline holds (the screen's
primary remains the committee review; `AI 추천`/`기록` stay ghost), tokens-only
styling, and the head-action standard is untouched.

## Divergences recorded

- **`심사 종료` stays enabled** where the assignment's wording pairs it with the
  disabled-state requirement. Reason: promotion is a person's act that ADR-0200
  Q3 binds to "never blocked", no guard refuses it (no blind 409 exists to
  remove), and adding a qualification check to promotion would be a guard-logic
  change — excluded by this design's scope. Compensating control: the row chip
  (visible before the button) plus the promote modal warning. PM to confirm or
  overrule.
- **Third API addition (§ API C)** beyond the two named in the assignment —
  justified in § API C (per-row chips and the coverage count are not derivable
  from the existing list payload).
- The coverage fraction on the strip is client-computed (from `gaps` +
  `universe.min_long_list`) rather than engine-emitted; when both agree with the
  engine's `2/3` blocker prose the screen shows one number. If backend prefers
  an engine-computed coverage object on the S6 stage entry instead, the strip's
  data source swaps without layout change — flagged for the implementing
  dispatch.

## Out of scope

Guard logic (`deal-shape-guard.ts`, S6/S7 predicates, grandfathering rule),
delete-and-re-register flows, evidence-row editing/deleting (timeline is
append-only), proposal-acceptance actions (`proposal_accepted_at`), scope
consent of any kind, new npm dependencies, the deal-shape form/verdict model,
non-brownfield stages, and the MCP `record_deal_shape_evaluation` surface (its
guard text already flows from the same guard; message keys here are UI
catalog keys).

## Handoff

**To**: PM (Design Gate approval) → `backend` (API additions §A/§B/§C, in that
order of dependency: C and A unblock the s67 UI, B unblocks the cure path) →
`frontend-engineer` (implementation), with `design-system-agent` reviewing the
escalations above.

**Reasoning in one line**: the engine already computes every fact the user needs
(three criteria, per-candidate gaps, a reason-tagged refusal); the defect is that
none of it reaches the glass — Fix ① renders exactly those facts where the work
happens, and Fix ② gives the one missing input that turns a blocked candidate
into a covered one, so the 409 stops being reachable in the normal flow.

**Real contracts**: § API A (additive `stages[].blockers`/`missing`,
index-aligned), § API B (PATCH discovery fields + append-only evidence row,
both-empty → 400), § API C (per-target `gaps`, grandfathered → `[]`). Guard,
predicate and blocker-key vocabulary byte-identical.

**Implementation notes for frontend-engineer**:

- `useS6Gate` = one fetch in `BrownfieldStage`, shared via `ctx` — do not fetch
  per section (StageFrame's single-read rule).
- Pair `blockers[i]` ↔ `missing[i]` by index for the strip's prose; never parse
  prose to find criterion state.
- `dealShapeErrorKind(status, code, details?)` — keep the old two-arg calls
  working (details optional); `notOpen` remains the fallback kind.
- Client qualification helper for the detail screen mirrors
  `longListCandidateGaps`; pin parity with a unit test feeding identical fixtures
  to both and asserting equal gap sets (the server `gaps` field stays
  authoritative for the s67 screen).
- The `?edit=1` deep link is read once on detail-page mount
  (`profileTab="overview"`, `setEditing(true)`); no router state.

**Measurable success criteria**:

1. **Name-the-blocker (primary)**: seeded with the `태웅` state (coverage 2/3), a
   moderated check (n ≥ 5, ko UI) asks "`지금 S7에 못 들어가는 이유는?`" — ≥ 90%
   name the open criterion and the offending candidate from the s67 screen alone,
   ≤ 30 s, without dev tools. (Today: 0% — the information exists nowhere on the
   screen.)
2. **Blind-409 elimination**: with S6 open, `AI 추천` renders disabled with a
   visible reason in 100% of runs; the `notOpen*` 409 toast fires only on stale
   state, and when it fires it names track vs stage (details.reason surfaced) —
   verified by render tests pinning both kinds and the fallback.
3. **Time-to-cure**: from an unqualified Long List row, curing via chip → detail
   edit form (universe note + one of URL/note) takes ≤ 2 minutes and clears the
   row chip and the criteria strip on the next s67 load — measured in the same
   moderated check; the deal from the diagnosis (`태웅`) becomes S6-complete
   without any delete-and-re-register.

## Amendment (2026-11-21): pre_fs panel placement — Option A

> **Superseded in part by Amendment 2 (2026-11-21).** The placement (pre_fs
> panel directly under the criteria strip, rendered on both `/s6` and `/s7`)
> and the "record pre_fs from the S7 screen" statement below are replaced.
> The `S7DecisionTabs` → `gates={["target_screening"]}` change stands.

**Owner decision.** The pre_fs `GateDecisionPanel` moves out of the S7 approval
tab into the S6 longlist block. Implementation landed the same day (frontend
dispatch; this section records the placement rationale).

**What changed.**

- *(Superseded by Amendment 2 — Pre-FS now renders last in the S6 body and
  never on S7.)* `LonglistSection.tsx` renders the pre_fs gate panel immediately AFTER the
  `S6CriteriaPanel` strip (`완료기준` strip → pre_fs gate panel → longlist
  table), mounted as a single-gate panel (`gates={["pre_fs"]}`) — no gate
  select, per the panel's single-gate rendering path.
- `S7DecisionTabs.tsx` reverts to `gates={["target_screening"]}` with the
  `zeroCandidatesPassed` killHint wiring unchanged — the approval tab records
  only the S7 shortlist gate.

**Rationale (`판단 시점 정립` — establishing judgment timing).** pre_fs is the
judgment made BEFORE the longlist is finalized: "`이 Universe로 선별작업을
시작할 가치가 있는가?`" plus the
stop-loss before FS resources are committed. Rendering it in the S7 approval
tab next to target_screening meant that after completing S7 the two GOs were
recorded back-to-back on one panel — pre_fs read as a redundant second
signature instead of the earlier, separate judgment it is. Placement now
matches judgment timing: the criteria strip answers whether the universe is
workable; the pre_fs panel directly below is where that judgment is recorded;
the longlist work follows under it.

**Promoted steps unaffected.** *(Superseded by Amendment 2 — the panel no
longer mounts on `/deals/{id}/s7`; a pre_fs decision is recorded only from the
S6 view, which remains reachable for any opportunity.)* The panel accepts a pre_fs decision wherever it
mounts: an owner can still record the pre_fs GO on a deal that has already
completed S7 from the same screen (the panel sits in the longlist block, which
renders on both `/deals/{id}/s6` and `/deals/{id}/s7`), and the engine treats
an S7-complete opportunity recording pre_fs fine — gate-sequence handling is
untouched by this UI reposition.

**Companion changes.** The E2E scenario driver now addresses the two panels by
index (pre_fs panel = DOM-first `의사결정` section; target_screening panel =
approval tab, mounted on demand) and `openGatePanels` checks the requested
index's panel for mount before clicking the owning tab. No i18n keys, tokens,
styles, or backend contracts changed — `common.gate.pre_fs` already existed,
and the panel is a `.market-section` card in both locations.

## Amendment 2 (2026-11-21): S6-only Pre-FS, stage-scoped S6/S7 panels, S6 gated on Pre-FS GO

**Status**: approved — Design Gate Row 0a passed 2026-11-21 (plan
`agile-jingling-pillow`); owner rulings recorded at the end of this amendment. Supersedes the Amendment 1 placement. Design only;
backend (engine/spec/keys), ADR (process-governance-manager) and frontend are
separate rows.

### Owner decisions (approved, 2026-11-21)

1. **Pre-FS is S6-only.** The `pre_fs` `GateDecisionPanel` (`gates={["pre_fs"]}`)
   renders at the very bottom of the S6 body, after the Long List table. It
   does NOT render on S7 — no recording panel, no notice.
2. **Checklist and promotion are S7-only.** The 9-item pre-check section
   (`사전 검토 · 위원회 추천`, in `ShortlistSection`) and `PromotionPanel`
   (`프로젝트로 추진`, S7→S8) render only on S7.
3. **S6 is not complete until a human records a Pre-FS GO.** S7 stays locked
   until then. New blocker key `s6.pre_fs_go`; `S6CriteriaPanel` gains a 4th
   criterion row.
4. **Circularity fix.** The brownfield `pre_fs` GO prerequisite becomes "S6 data
   blockers clear" instead of "S6 complete".
5. **Prop change.** `BrownfieldStage`'s `dealShapePanel?: boolean` becomes
   `stage: "S6" | "S7"`.
6. **Disabled-state consistency.** The S7 blocked reason keeps the
   `S6 완료기준 미충족` wording; the Pre-FS GO is named as an open criterion with
   an anchor to the Pre-FS panel on S6.

### JTBD (delta)

**Persona**: deal analyst (owner/analyst role) on a brownfield opportunity;
the **decider** who records the Pre-FS gate is a human with gate rights (the
non-negotiable: gate approval belongs to humans).

**Job**: *when I have a workable Universe and a covered Long List, let me
record the Pre-FS stop-loss judgment ("is it worth starting the screening and
committing FS resources?") as the last act of S6, so S7 opens only after a
person said GO — and when I am on S7, show me only S7 work.*

Input → output: S6 data (Universe definition, qualified Long List) → a human
`pre_fs` decision (GO / HOLD / KILL) → S6 complete → S7 opens (checklist,
committee, approval tab, promotion).

### Why bottom-of-S6 replaces Option A

Option A put the panel above the Long List table, i.e. *before* the work it
judges. With S6 completion now *depending* on the GO, the decision is the
closing act of the stage: you read the criteria, finish the Long List, then
decide. Bottom placement makes reading order = work order = focus order, and
removes the S7 copy that made the same gate recordable from two routes.

### Screen layout (after)

```
/deals/{id}/s6  — StageFrame (h1 S6, handoff strip, rail)
┌────────────────────────────────────────────────────────────────────┐
│ UniverseSection (목표 시장 정의)                                     │
│ ── LonglistSection ─────────────────────────────────────────────── │
│ │ SectionToolbar                                                   │
│ │ S6CriteriaPanel [id=s6-criteria]                                 │
│ │   ✓ Target Universe 정의                     [충족]              │
│ │   ✓ Long List 후보 필수 속성·출처             [충족]              │
│ │   ✓ Long List 최소 커버리지                   [충족]              │
│ │   ✕ Pre-FS 게이트 GO 결정                     [미충족]            │
│ │      Pre-FS 게이트 GO 결정이 필요합니다 (사람이 기록)  ← engine     │
│ │      [Pre-FS 결정 기록으로 이동 ↓]  (href=#gate-decision-pre_fs)    │
│ │ [status filter row] · data-table (Long List)                     │
│ ── Pre-FS GateDecisionPanel [id=gate-decision-pre_fs] ── LAST ──── │
│ │ 의사결정 — Pre-FS     (GO / HOLD / KILL, rationale, history)      │
└────────────────────────────────────────────────────────────────────┘
(no 사전 검토 checklist, no committee, no S7DecisionTabs, no PromotionPanel)

/deals/{id}/s7  — StageFrame (h1 S7)
┌────────────────────────────────────────────────────────────────────┐
│ UniverseSection (read context, as today)                            │
│ LonglistSection (read context; criteria strip incl. row 4 — a       │
│   criterion row, not a Pre-FS panel or notice; Owner ruling 2)    │
│ ShortlistSection: 사전 검토 · 위원회 추천 (9 items) → CommitteePanel │
│   → S7DecisionTabs [진출 형태 평가][의사결정 — target_screening]     │
│   → PromotionPanel (프로젝트로 추진)                                  │
│ NO Pre-FS GateDecisionPanel, NO Pre-FS notice                       │
└────────────────────────────────────────────────────────────────────┘
```

Component-level placement (frontend implements):

| Piece | S6 | S7 | Where it moves |
|---|---|---|---|
| `GateDecisionPanel gates={["pre_fs"]}` | yes, last child of the S6 body | **no** | out of `LonglistSection.tsx` (Amendment 1 mount) to the end of `BrownfieldStage` under `stage === "S6"` (after `LonglistSection`) |
| `S6CriteriaPanel` (4 rows) | yes | yes (read context) | unchanged location |
| `사전 검토 · 위원회 추천` section + `CommitteePanel` | **no** | yes | gated by `stage === "S7"` in `ShortlistSection.tsx` |
| `S7DecisionTabs` | no | yes | was `dealShapePanel`, now `stage === "S7"` |
| `PromotionPanel` | **no** | yes | gated by `stage === "S7"` in `ShortlistSection.tsx` |
| Shortlist helper notes (eval-incomplete note, "target selection gate above…" caption) | no | yes | travel with the S7 block they describe |

### Prop contract

```ts
// components/stages/brownfield/BrownfieldStage.tsx
export function BrownfieldStage(props: {
  opportunityId: string;
  onSaved?: () => void;
  stage: "S6" | "S7"; // replaces dealShapePanel?: boolean
}): JSX.Element;
// ShortlistSection receives the same `stage` (replaces its dealShapePanel prop).
```

Callers: `app/deals/[id]/[stage]/page.tsx:292` passes `stage={stageId}`
(`stageId` is already narrowed to S6/S7 on that branch).

`stage` is **required**, with exactly the values `"S6" | "S7"` — there is no
`"combined"` value (Owner ruling 1). `app/brownfield/page.tsx` never renders
`BrownfieldStage`; `app/deals/[id]/[stage]/page.tsx` is its sole caller.

### Engine contract notes (backend implements; ADR records)

1. **New blocker `s6.pre_fs_go`** (`lib/process-blocker-keys.ts`, catalog
   `processBlockers.s6_pre_fs_go`). Pushed when the latest `pre_fs` row for the
   opportunity (`latestGateDecisions("opportunity", id).get("pre_fs")`) is not
   `go`. **Ordering and totality**: it is always the LAST entry, and it is
   evaluated in every non-grandfathered S6 branch, including the
   "no Universe" early return — so `blockers[]`/`missing[]` stay index-aligned
   (§ API A) and row 4 never renders "met" just because an earlier branch
   returned early.
2. **Split the S6 predicate**: `s6DataComplete(opp)` (target_universe,
   longlist_attributes, longlist_coverage — today's body) and the S6 predicate
   = data + `s6.pre_fs_go`.
3. **Circularity fix — `gateGoPrerequisiteGaps` case `"pre_fs"`, brownfield**:
   replace `need(["S6"])` with "`s6DataComplete` has no missing keys" (gap text
   per open data blocker, e.g. `S6 대상 후보 발굴 데이터 미완료 — <criterion>`).
   `need(["S4"])` and `pushAiDraftReviewGap` stay unchanged. Greenfield path
   (`need(["S5"])`) unchanged. Without this, a GO can never be recorded
   (S6 needs GO; GO needs S6).
4. **Revocation — latest decision wins**: a HOLD recorded after a GO makes the
   latest row HOLD → `s6.pre_fs_go` reopens → S6 regresses to `current` → S7
   relocks (S7 work already recorded is kept, only locked). A KILL terminates
   the process (`evaluateProcess` already marks every stage `terminated`), so
   the strip hides per the existing terminated rule and the StageFrame shows
   the terminated state.
5. **Engine prose** (Korean, push order): open with no row →
   `Pre-FS 게이트 GO 결정이 필요합니다 (사람이 기록)`; latest is HOLD →
   `Pre-FS 게이트의 최근 결정이 HOLD입니다 — GO가 다시 기록되어야 S7이 열립니다`.
   Both map to the one key `s6.pre_fs_go`.
6. **Grandfathering**: opportunities with `created_at` before a NEW cut-off
   constant (in `lib/wave-f-date.ts` style) never get `s6.pre_fs_go`. The
   cut-off is the **release date of this change** — every opportunity existing
   at release is exempt; backend sets the constant to that date (Owner
   ruling 4). `WAVE_F_PREDICATE_DATE` is not reused (already past).
7. **Exempt signal for the strip (needed for honest UI)**: so that row 4 can
   say `면제` instead of a false `충족` on a grandfathered opportunity with no
   GO, each `stages[]` entry of `GET /api/opportunities/[id]/process` gains an
   additive `exempt: boolean` (Owner ruling 3). It is **server-decided**: the
   engine sets it `true` on the S6 entry when grandfathering skipped
   `s6.pre_fs_go`, `false` otherwise (and `false` on every other stage).
   Additive only — every existing consumer is unaffected. The client cannot
   tell "met" from "exempt" from `missing` alone, and it performs **no**
   client-side `created_at` vs cut-off comparison — the engine field is the
   single source of truth.
8. **flow.spec / generated files**: S6 blocker
   `{ key: s6.pre_fs_go, artifacts: [], criteria: [3] }` + completion criterion
   `pre_fs 게이트 GO 결정이 기록되었다`; `meta.version` bump; regenerate via
   `scripts/co-newbiz/generate-process-flow.ts`; `process-ssot-check` green.
   This is a policy/procedure change → ADR (plan Row 1).

### Criteria strip — 4th row (`S6CriteriaPanel`)

- `S6_CRITERIA` gains
  `{ key: "s6.pre_fs_go", catalogKey: "processBlockers.s6_pre_fs_go" }` as the
  last entry. Row state follows the existing rule (key present in `missing` →
  `미충족` with the index-paired engine prose; S6 `exempt === true` → `면제`;
  otherwise absent → `충족`).
- **Row 4 states and secondary line**:

  | State | Glyph + chip | Secondary line | Action element |
  |---|---|---|---|
  | Data criteria still open, no GO | ✕ `미충족` | `위 세 가지 기준을 먼저 충족해야 Pre-FS 결정을 기록할 수 있습니다` | none on S6 (the panel below shows its own prerequisite gaps) |
  | Data criteria met, no GO | ✕ `미충족` | engine prose | link `Pre-FS 결정 기록으로 이동 ↓` → `#gate-decision-pre_fs` |
  | Latest = HOLD (revoked) | ✕ `미충족` | engine HOLD prose | same link |
  | Latest = GO | ✓ `충족` | — | — |
  | Grandfathered | – `면제` (`status-not-started`) | `기존 사업 기회 — Pre-FS GO 요건 면제` | — |

  On S7 the link target is cross-route: `/deals/{id}/s6#gate-decision-pre_fs`
  with label `S6에서 Pre-FS 결정 기록 →`.
- **All-met copy**: `criteriaPanel.allMet` changes from `3가지` to `4가지`
  (an exempt row counts as met for the collapsed line).
- The anchor target is the panel's existing section id
  `gate-decision-pre_fs` (`GateDecisionPanel` already emits
  `id={`gate-decision-${panelKey}`}`) — no new wrapper markup; frontend adds
  `scroll-margin-top` via the existing `SECTION_IDS` convention.

### Disabled states and reasons

- **Deal-shape buttons on S7** (`AI 추천`, `기록`): unchanged rule
  (`s7Blocked` = S6 not complete), unchanged `blockedReasonS7` text. The
  adjacent link becomes specific: when `s6Missing` is exactly
  `["s6.pre_fs_go"]`, the link reads `Pre-FS GO 기록 (S6) →` and points to
  `/deals/{id}/s6#gate-decision-pre_fs`; otherwise it keeps
  `S6 완료기준 보기 →` (`#s6-criteria`). Same `aria-describedby` wiring.
- **`PromotionPanel` on S7**: no new client logic — its existing
  engine-derived readiness already reflects the S6 regression (S7 cannot be
  complete when S6 is not). No change to its copy.
- **Pre-FS panel on S6 with data criteria open**: the panel's existing
  prerequisite-gap rendering (driven by `gateGoPrerequisiteGaps`) shows the
  data gaps — after the circularity fix it never shows `S6 미완료`. No new
  copy inside the panel.
- **HOLD-after-GO UX implication**: recording HOLD is the only in-app path
  that relocks a stage that was already open. The panel's existing
  confirmation step must state the consequence. One new caption key, shown in
  the pre_fs panel's confirm step only when the latest decision is GO and the
  new choice is HOLD (`common.gate.preFsHoldRevokesGo`, exact string in the
  i18n table). KILL already carries its own learning-required
  confirm and terminates; no extra copy. This is the panel's existing
  `onRecorded` path — no new component.

### i18n — new and changed keys (Amendment 2)

| Key | ko | en |
|---|---|---|
| `processBlockers.s6_pre_fs_go` (new; backend) | `Pre-FS 게이트 GO 결정` | Pre-FS gate GO decision |
| `stages.s67.criteriaPanel.allMet` (changed) | `4가지 완료기준을 모두 충족했습니다` | All four completion criteria are met |
| `stages.s67.criteriaPanel.exemptChip` (new) | `면제` | Exempt |
| `stages.s67.criteriaPanel.srExempt` (new) | `면제됨` | exempt |
| `stages.s67.criteriaPanel.preFsExemptNote` (new) | `기존 사업 기회 — Pre-FS GO 요건 면제` | Existing opportunity — Pre-FS GO requirement waived by cut-off |
| `stages.s67.criteriaPanel.preFsPrereq` (new) | `위 세 가지 기준을 먼저 충족해야 Pre-FS 결정을 기록할 수 있습니다` | Meet the three criteria above before recording the Pre-FS decision |
| `stages.s67.criteriaPanel.preFsLink` (new) | `Pre-FS 결정 기록으로 이동` | Go to the Pre-FS decision |
| `stages.s67.criteriaPanel.preFsLinkS7` (new) | `S6에서 Pre-FS 결정 기록` | Record the Pre-FS decision on S6 |
| `stages.s67.dealShapePanel.blockedReasonPreFsLink` (new) | `Pre-FS GO 기록 (S6)` | Record the Pre-FS GO (S6) |
| `common.gate.preFsHoldRevokesGo` (new) | `HOLD를 기록하면 기존 GO가 무효가 되고 S6이 미완료로 돌아가 S7이 잠깁니다. 이미 기록된 S7 작업은 보존됩니다.` | Recording HOLD revokes the earlier GO: S6 becomes incomplete again and S7 locks. S7 work already recorded is kept. |

Reused unchanged: `blockedReasonS7`, `blockedReasonLink`, `common.gate.pre_fs`,
`criteriaPanel.metChip/openChip/srMet/srOpen`. Engine prose (Korean) is
localized through `localizeBlocker` as for the other three rows.

### Components and tokens consumed

Existing only: `GateDecisionPanel`, `S6CriteriaPanel`, `PrimaryAction`
reason-contract treatment (adjacent reason + `aria-describedby`, as in the base
design), `status-chip status-green / status-amber / status-not-started`,
`.market-section`, `SectionToolbar`, `--space-*`, `--fs-caption`. No new
component, token, pattern, or icon. Primary-action discipline: on S6 the Pre-FS
record is the stage's single decisive human act (the panel's own primary); on
S7 the committee review stays primary. No escalation to `design-system-agent`
beyond the three already listed.

### Accessibility (WCAG 2.1 AA — workspace ADR-0065)

- **Not colour-only (1.4.1)**: row 4 uses glyph (✓/✕/–, `aria-hidden`) +
  visible chip text + sr-only state word (`충족됨`/`미충족`/`면제됨`).
- **Focus/reading order (1.3.2, 2.4.3)** on S6: Universe → Long List toolbar →
  criteria strip (row 4 link) → status filters → Long List table (scroll
  region `tabIndex=0`) → **Pre-FS panel last** (decision radios → rationale →
  record button → history). DOM order = visual order; no positive `tabindex`.
- **Anchor navigation (2.4.1, 2.4.7)**: `#gate-decision-pre_fs` targets the
  panel section with `scroll-margin-top`; frontend moves focus to the panel
  heading on hash arrival (heading gets `tabIndex={-1}`) so keyboard and
  screen-reader users land on the decision, not at the top of the page.
- **Disabled reasons (4.1.2)**: the deal-shape buttons keep `disabled` +
  adjacent visible reason + `aria-describedby`; the Pre-FS link is a separate
  focusable element.
- **Consequence disclosure (3.3.4)**: the HOLD-revokes-GO caption sits in the
  confirm step before submission and is referenced by `aria-describedby` from
  the record button.
- **Stage scoping**: S7 removes the Pre-FS panel from the DOM (not
  `hidden`/`display:none`-only), so assistive tech never reaches a non-actionable
  copy. Both themes via token pairs; captions ≥ `--fs-caption` (13px).

### Preview verification (workspace ADR-0070)

Frontend must attach preview evidence for:

- **Breakpoints (≥2)**: desktop 1440 and narrow 390 (plus 768 recommended),
  both themes at 1440. S6 shows Pre-FS as the last section and no checklist/
  promotion; S7 shows checklist + committee + approval tab + `프로젝트로 추진`
  and no Pre-FS panel or notice.
- **Interactions (≥1, recommended 3)**: (a) row-4 link on S6 scrolls and
  focuses the Pre-FS panel; (b) record GO on a data-complete deal → strip
  collapses to the all-met line and S7 unlocks; (c) record HOLD after GO →
  revoke caption visible in confirm, S6 reopens, S7 deal-shape buttons show
  the `Pre-FS GO 기록 (S6)` link.

### Measurable success criteria

1. **Placement correctness (render tests, 100%)**: on `stage="S6"` the DOM
   contains exactly one `#gate-decision-pre_fs` and it is the last
   `.market-section` of the stage body; it contains no checklist section and
   no `PromotionPanel`. On `stage="S7"` the DOM contains zero pre_fs panels and
   zero elements whose text names a Pre-FS panel other than the criteria row.
2. **Gate correctness (engine tests, 100%)**: S6 incomplete without GO;
   complete with GO; HOLD after GO → incomplete; grandfathered → complete
   without GO; pre_fs GO accepted when only data blockers are clear
   (circularity regression).
3. **Name-the-blocker (moderated, n ≥ 5, ko UI)**: on a data-complete deal
   without GO, ≥ 90% answer "why is S7 locked?" with "Pre-FS GO not recorded"
   from the screen alone in ≤ 20 s, and ≥ 90% reach the Pre-FS panel from the
   S7 screen in ≤ 2 clicks.
4. **No double recording**: zero pre_fs rows recorded from a `/s7` URL
   (audit-log route field) in the first 30 days after release.

### Owner rulings (2026-11-21)

The owner approved Amendment 2 and ruled on its four open questions:

1. **`stage` prop**: `stage: "S6" | "S7"` is **required**; there is no
   `"combined"` value. `app/brownfield/page.tsx` never renders
   `BrownfieldStage`; its sole caller is `app/deals/[id]/[stage]/page.tsx`.
2. **Row 4 on S7**: the S6 criteria strip stays on S7, and its 4th row names
   the Pre-FS GO and links to `/deals/{id}/s6#gate-decision-pre_fs`. This is a
   criterion row, **not** a Pre-FS panel or notice, so it does not violate
   "no Pre-FS panel on S7" (owner decision 1).
3. **Exempt signal**: add the additive `stages[].exempt` **boolean** to the
   process API (`GET /api/opportunities/[id]/process`). It is server-decided;
   the client does no `created_at` comparison (the fallback is dropped).
4. **Grandfather cut-off**: the release date of this change — every
   opportunity existing at release is exempt. Backend sets the constant to the
   release date.

## Amendment 3 (2026-11-21): S6-only Universe and candidate-discovery authoring sections

**Status**: owner request, recorded during preview verification of Amendment 2
(2026-11-21). It extends Amendment 2's stage scoping and changes no engine,
API, or process-spec contract. The `ReviewBuckets` scope is settled by the
owner ruling at the end of this amendment. The S7 back-link hint was not in
the owner's original request; it was proposed by ux-designer and is now
**Owner-approved (2026-11-21) — being implemented in the follow-up PR after
#959**. Design only; frontend implements in a separate row.

**Shipped**: PR #959 (merged 2026-11-21) shipped Amendments 2 and 3 **without**
the S7 hint. The hint, its i18n keys, and its tests land in the follow-up PR.

### Owner request (2026-11-21)

While checking the Amendment 2 preview, the owner asked that the **S7 screen
(`stage === "S7"`) not render the S6-only authoring sections**:

1. The **`평가 대상 방향성` Target Universe card**: `UniverseSection`'s
   Universe card (read view plus the `수정` entry point) and its edit modal
   `UniverseEditModal`.
2. The **`후보 발굴 — 후보 전체 목록 채우기` discovery/registration card**: the
   second card inside `UniverseSection` (market/company master proposals,
   web search, the `후보 등록` form with filing-company lookup) and the web
   search result modal `WebDiscoveryPanel`.

S7 keeps the **Long List table** (judgment, ranking, and building the final
candidate list are S7 work), the **S6 criteria strip** (including the row-4
link to `/deals/{id}/s6#gate-decision-pre_fs`), the **9-item checklist**,
**committee**, **approval tabs**, the **deal-shape panel**, and
**`PromotionPanel`**. S6 keeps everything it has today (Amendment 2 layout).

### JTBD (delta)

*When I am on S7, I am choosing among candidates that S6 already defined and
collected. Show me the list I judge and the decisions I record, not the forms
for redefining the market or adding candidates. Those are S6 jobs, and doing
them changes the S6 completion state.*

S6 is the authoring stage for the Universe and the Long List population, and
S7 is the judging stage. Amendment 2 already applied this split to the Pre-FS
panel, the checklist, and promotion. Amendment 3 applies it to the two
remaining S6 write surfaces.

### Component-per-stage table (supersedes Amendment 2's table for these rows)

| Piece | S6 | S7 | Where it is gated |
|---|---|---|---|
| `UniverseSection`: Universe card (`평가 대상 방향성`, read view + `수정`) | yes | **no** (new) | `BrownfieldStage.tsx`: render `<UniverseSection>` only when `stage === "S6"` |
| `UniverseSection`: discovery card (`후보 발굴 — 후보 전체 목록 채우기`, master/web search, `후보 등록` form) | yes | **no** (new) | same gate (both cards live in `UniverseSection` under the `s6s7-universe` wrapper) |
| `UniverseEditModal` | yes | **no** (new) | `stage === "S6"` in `BrownfieldStage.tsx` |
| `WebDiscoveryPanel` (web search result modal) | yes | **no** (new) | `stage === "S6"` in `BrownfieldStage.tsx` |
| S7 back-link hint (`후보 추가·Universe 수정은 S6에서` + `S6로 이동 →`) | no | **yes — Owner-approved (2026-11-21) — being implemented in the follow-up PR after #959** | `BrownfieldStage.tsx`, S7 only, directly above `LonglistSection`; not in PR #959 |
| `LonglistSection` (toolbar, AI bulk eval, Long List table, judgment/ranking) | yes | yes | unchanged |
| `S6CriteriaPanel` (4 rows, row-4 cross-route link on S7) | yes | yes | unchanged (Amendment 2) |
| `GateDecisionPanel gates={["pre_fs"]}` | yes, last | no | unchanged (Amendment 2) |
| `사전 검토 · 위원회 추천` (9 items) + `CommitteePanel` | no | yes | unchanged (Amendment 2) |
| `S7DecisionTabs` (deal shape, `target_screening` approval) | no | yes | unchanged (Amendment 2) |
| `PromotionPanel` | no | yes | unchanged (Amendment 2) |
| `ReviewBuckets` (`stageArtifactTabs(stage)`) | S6 tabs only | S7 tabs only | `BrownfieldStage.tsx`: `artifacts={stageArtifactTabs(stage)}` (owner ruling 2026-11-21, see below); the S6 Universe bucket is no longer shown on S7 |

The gate removes the pieces from the S7 DOM. It is not a `hidden` attribute
or a `display:none` rule. On S7 the `useBrownfieldTargets` hooks may still
load Universe data (the criteria strip needs `min_long_list`). Only rendering
changes, not data loading. The `stage` prop contract from Amendment 2 is
unchanged.

### S7 layout (after)

```
/deals/{id}/s7  — StageFrame (h1 S7)
┌────────────────────────────────────────────────────────────────────┐
│ [disabled 위원회 추천 검토 실행 + reason]  (when applicable, as today) │
│ ReviewBuckets — stageArtifactTabs("S7") only (no S6 buckets)        │
│ [Owner-approved (2026-11-21) — being implemented in the follow-up   │
│  PR after #959: one-line hint 후보 추가·Universe 수정은 S6에서 ·      │
│  S6로 이동 →]                                                       │
│ LonglistSection: toolbar · S6CriteriaPanel · filters · Long List    │
│ ShortlistSection: 사전 검토 · 위원회 추천 (9) → CommitteePanel        │
│   → S7DecisionTabs → PromotionPanel                                 │
│ NO Universe card, NO 후보 발굴 card, NO edit/web-search modals,      │
│ NO Pre-FS panel                                                     │
└────────────────────────────────────────────────────────────────────┘
```

### No write surface for Universe and candidate registration on S7

After this change S7 has **no** way to edit the Universe definition or add a
candidate. Analysts go back to S6 for both. This is intended:

- **Both actions are S6 data.** They feed `target_universe`,
  `longlist_attributes`, and `longlist_coverage`. An edit made "from S7" is
  really an S6 edit, and it can reopen S6 (for example, a new candidate without
  its required attributes and source reopens `longlist_attributes` → S6
  regresses → S7 relocks, the same rule as Amendment 2 revocation). That
  consequence belongs on the screen that shows the S6 criteria with their
  fixes, which is S6.
- **Per-candidate fixes stay reachable.** The criteria strip on S7 keeps its
  per-candidate `수정` links to `/brownfield/targets/{id}?edit=1` (Fix ①-b,
  Fix ②). Completing a listed candidate's `발굴 출처` or attributes does not
  require S6.

**Owner-approved (2026-11-21) — being implemented in the follow-up PR after
#959: a one-line S7 hint.** The owner did not originally request this hint;
ux-designer proposed it and the owner approved it at the Design Gate on
2026-11-21. It was not part of PR #959, so the S7 screen as merged renders no
hint until the follow-up PR lands. Rationale:

1. **Stage linkage (doctrine) and orphaned jobs.** Analysts often notice a
   missing candidate during S7 ranking. Without a pointer, the place where
   they used to do this job simply disappears with nothing to tell them where
   it went. One line closes that gap at the moment it occurs.
2. **The S7 screen loses its only Universe read view.** The hint is also
   the path for *reading* the Universe definition while judging candidates.
3. **Low cost.** One caption line with a link. It adds no new component,
   modal, or action, and the primary action stays the committee review.

Spec (Owner-approved (2026-11-21) — being implemented in the follow-up PR after #959):

- Placement: S7 only, immediately above `LonglistSection` (after
  `ReviewBuckets`), as a `<p>` caption (`--fs-caption`, `--muted-fg`), not a
  card or alert.
- Copy: `후보 추가·Universe 수정은 S6에서` + link `S6로 이동 →`.
- Link: `s6#s6s7-universe` (relative, the same convention as the row-4 link in
  `S6CriteriaPanel`, because the route id may be a carrier id). Target is the
  existing `SECTION_IDS.universe` wrapper, which already has
  `scroll-margin-top`.
- Shown to every role. Viewers use it to read the Universe, and S6 then
  applies its own `canAct` rules.
- i18n (Owner-approved (2026-11-21) — being implemented in the follow-up PR
  after #959; add both keys to the ko/en catalogs in that PR, keeping ko/en
  parity):

  | Key | ko | en |
  |---|---|---|
  | `stages.s67.s7AuthoringHint.text` | `후보 추가·Universe 수정은 S6에서` | Add candidates or edit the Universe on S6 |
  | `stages.s67.s7AuthoringHint.link` | `S6로 이동` | Go to S6 |

### Accessibility (WCAG 2.1 AA, workspace ADR-0065)

- **DOM removal (4.1.2, 1.3.1)**: on S7 the DOM contains no
  `#s6s7-universe`, no `aria-label` sections for `목표 시장 정의` /
  `후보 발굴`, no `후보 등록` form controls, and no `UniverseEditModal` /
  `WebDiscoveryPanel` dialog roots. Assistive tech never reaches a write
  surface that does not belong to the stage.
- **Heading order (1.3.1, 2.4.6)** on S7: `h1` (StageFrame) → ReviewBuckets
  heading (if rendered) → Long List `SectionToolbar` `h2` → Shortlist / committee
  / decision `h2`s. The removed Universe and discovery toolbars were `h2`
  siblings of the Long List toolbar, so removing them leaves no level skip. The
  first `h2` after the stage chrome is now the Long List title. (Hint,
  Owner-approved (2026-11-21) — being implemented in the follow-up PR after
  #959: it is a paragraph, not a heading.)
- **Focus order (2.4.3)** on S7: stage chrome → ReviewBuckets (S7 tabs only) →
  Long List toolbar (AI bulk eval, criteria dialog) → criteria strip (row-4 S6
  link, per-candidate `수정` links) → filters → table → checklist → committee →
  decision tabs → promotion. DOM order matches visual order, with no positive
  `tabindex`. (Hint, Owner-approved (2026-11-21) — being implemented in the
  follow-up PR after #959: its link sits between ReviewBuckets and the Long
  List toolbar.)
- **Link purpose (2.4.4)** — Owner-approved (2026-11-21) — being implemented
  in the follow-up PR after #959: the hint link's accessible name is the sentence plus
  `S6로 이동` (one text run, not `here`).
- S6 accessibility is unchanged from Amendment 2.

### Preview verification (workspace ADR-0070), delta

Add the following to Amendment 2's preview evidence:

- **Breakpoints**: at 1440 (both themes) and 390, S7 shows no `평가 대상
  방향성` card and no `후보 발굴` card, and the first section under
  `ReviewBuckets` is the Long List. S6 still shows both cards above the Long
  List, and Pre-FS is last.
- **ReviewBuckets (owner ruling)**: S7 shows only S7 artifact tabs (no `S6
  평가 대상 방향성(Target Universe)` or `S6 대상 기업 롱리스트` bucket); S6
  shows only S6 artifact tabs.
- **DOM check (S7)**: `document.querySelector("#s6s7-universe") === null`, no
  `후보 등록` input, and no web search or Universe edit dialog in the tree.
- **Interaction** — Owner-approved (2026-11-21) — being implemented in the
  follow-up PR after #959: clicking the hint link opens `/deals/{id}/s6`
  scrolled to the Universe card. Checked in the follow-up PR (not applicable
  to the PR #959 build).
- **Render tests**: extend `tests/unit/s67-stage-scoping.test.ts` so that with
  `stage="S7"` none of the four removed pieces renders and `ReviewBuckets`
  receives only `stageArtifactTabs("S7")`, and with `stage="S6"` all four
  render and `ReviewBuckets` receives only `stageArtifactTabs("S6")`. (Hint
  assertions — Owner-approved (2026-11-21) — being implemented in the
  follow-up PR after #959: with `stage="S7"` the hint renders with a link to
  `s6#s6s7-universe`; with `stage="S6"` it does not render.)

### Measurable success criteria (delta)

1. **Scoping correctness (render tests, 100%)**: as in the render-test bullet
   above.
2. **No orphaned job (moderated, n ≥ 5, ko UI)** — measured once the
   hint ships (Owner-approved (2026-11-21) — being implemented in the
   follow-up PR after #959): given "you noticed a missing candidate while ranking
   on S7", ≥ 90% reach the S6 `후보 등록` form in ≤ 2 clicks from S7.

### Owner ruling (2026-11-21): `ReviewBuckets` scope

**Ruling**: on the s67 screen, `ReviewBuckets` shows **only the current
stage's artifact tabs**, `artifacts={stageArtifactTabs(stage)}`. The S6 screen
shows the S6 tabs (`stage:S6:1–2`) and the S7 screen shows the S7 tabs
(`stage:S7:1–4`). The `3단계 검토 — S6 평가 대상 방향성(Target Universe)`
bucket (and `S6 대상 기업 롱리스트`) is no longer shown on S7. This replaces
the earlier combined `stageArtifactTabs("S6", "S7")` call on both routes;
frontend implements it in `BrownfieldStage.tsx`.

Background (previous behavior): the combined call made S7 show the S6
Universe bucket even though, after Amendment 3, S7 no longer shows the
Universe artifact that bucket reviews. Reasons supporting the ruling:

1. **Review needs the artifact in view.** The review model asks the human to
   separate *verified* / *could not verify* / *needs judgment*. Reviewing the
   Universe from a screen that no longer shows it pushes reviewers toward
   "could not verify" or, worse, a blind pass.
2. **S6 review belongs to S6 completion.** S6 artifacts are reviewed before the
   Pre-FS GO, which is already S6-only (Amendment 2). Keeping their review
   buckets on S7 recreates the "same act from two routes" pattern that
   Amendment 2 removed for Pre-FS.
3. **Consistency.** Every other stage screen passes a single stage
   (`stageArtifactTabs("S2")`, `("S8")`). The combined S6+S7 call is a holdover
   from the old combined s67 screen.

Trade-off considered and closed by the ruling: the Long List table remains on
S7, so the `S6 대상 기업 롱리스트` bucket could arguably have stayed there too.
The owner ruled for strict per-stage scoping, so no S6 bucket is carried onto
S7.

### Owner rulings (Amendment 3, 2026-11-21)

1. **`ReviewBuckets` scope**: current stage only (see the ruling above).
2. **S7 back-link hint**: approved at the Design Gate on 2026-11-21 (owner
   answer: `"넣는다"`, i.e. include it). The spec above
   (`stages.s67.s7AuthoringHint.text` / `.link`, S7 only, above
   `LonglistSection`, link `s6#s6s7-universe`) is unchanged and is being
   implemented in the follow-up PR after #959.
3. **Delivery record**: PR #959 (merged 2026-11-21) shipped Amendments 2 and 3
   without the hint.

## Defect Remediation — 2026-11-22

**Status**: implemented 2026-11-22 — AI 1st-formal and AI 2nd-cross-domain
review passed with adjudications (recorded in the Landing record below). Four
defects in this feature area, user-reported 2026-11-21 and confirmed
reproducible, all pre-existing in the shipped surfaces. They are numbered
**U1–U4** (the doc's D1–D8 are the design-time defects, already fixed). Each
entry states the current behavior, the intended behavior traced to this doc
(no new doctrine), the fix approach at component/key level, and the
acceptance criteria a reviewer must see. Frontend implementation landed
2026-11-22; the spec registry entry
(`docs/specs/entries/2026-11-21-s67-completion-visibility-design.json`) carries
no defect-list field in the registry schema, so it stays untouched.

### U1 — Raw gate identifier `pre_fs` in the brief-mismatch caption

**Current behavior (observed)**. When the AI progress brief shown in a gate
panel was generated for a gate other than the form's currently selected gate,
the caption renders the internal gate id verbatim in visible copy:
`브리프는 pre_fs 기준입니다 — 진행을 바꾸면 재생성하세요.` — lowercase with
underscore, in the middle of a sentence. Every other gate surface on this
screen resolves the id through the catalog (`common.gate.pre_fs` =
`예비타당성 검토(Pre-FS)`; e.g. `blockedReasonPreFsLink` renders
`Pre-FS GO 기록 (S6)` correctly), so this caption is the one remaining raw-key
leak. It is also the surface whose entire job is to NAME the other gate — the
raw key renders exactly when the caption is on screen.

**Anchor**: `app/web-next/components/GateDecisionPanel.tsx:237-240` —
`GateBriefBody` renders `{t("theBrief")} {briefData.gate}
{t("isTheBasisRegenerateAfter")}` under the condition
`briefData.gate !== currentGate` (line 237). The trigger: the form's gate
select changed after the brief was generated (seq panels,
`GateDecisionPanel.tsx:1192-1205`) or the shared component is mounted with a
different `currentGate` (`AiJudgementSupport.tsx:126`). The brief block inside
the Pre-FS panel consumes it at `GateDecisionPanel.tsx:1075-1082`.

**Intended behavior (design intent)**. Internal identifiers never render;
every gate reference resolves through the label catalog — the single-source
rule this doc already pins for the criteria strip (§ Fix ①-a: "Criterion
names reuse the existing `processBlockers.s6_*` catalog keys … single
source"), applied to gate labels through `GATE_LABEL_KEY`
(`lib/label-keys.ts:13`, `pre_fs → common.gate.pre_fs`). The review surface's
own rule states it in plain words (`CommitteeSessionRow.tsx:9`): never the raw
gate id in user-visible text.

**Fix approach (component/key level)**. In `GateBriefBody`, resolve the label
with the `labelOf` pattern the panel itself already uses
(`GateDecisionPanel.tsx:405`: `tr(GATE_LABEL_KEY[g] ?? g)`; `GateBriefBody`
currently holds only the panel/common translators, `GateDecisionPanel.tsx:233-234`,
so it adds the root translator). Replace the three-node concatenation with one
keyed message carrying a `{gate}` param so both languages read naturally —
one new key, both catalogs, ko/en parity as pinned throughout this doc:

| Key | ko | en |
|---|---|---|
| `components.gateDecision.panel.briefGateMismatch` (new) | `이 브리프는 {gate} 기준입니다 — 진행을 바꾸면 재생성하세요.` | This brief targets {gate} — regenerate it after changing the gate. |

with `{gate}` = the catalog label (ko `예비타당성 검토(Pre-FS)`, en
`Preliminary feasibility study (Pre-FS)`), never the raw id. The two existing
keys (`theBrief`, `isTheBasisRegenerateAfter`) become unused and are removed
with the same change. The shared-component fix covers `AiJudgementSupport`
automatically.

**Acceptance criteria**.

1. A render test sweeps every id in `GATE_LABEL_KEY` and asserts the rendered
   caption contains the catalog label and never the raw id (no
   `pre_fs`/`target_screening`/`entity_ic` substrings), for ko and en.
2. On the Pre-FS panel: generate a brief, switch the form gate, regenerate the
   mismatch state — the caption reads
   `이 브리프는 예비타당성 검토(Pre-FS) 기준입니다 — 진행을 바꾸면 재생성하세요.`
3. i18n parity green (the new key present in both catalogs; old keys removed
   in the same change so the catalogs do not drift).

### U2 — Collapsed `3단계 검토` card ignores the recorded gate state

**Current behavior (observed)**. After a Pre-FS GO is recorded, the collapsed
`3단계 검토` card on the S6 screen still counts the Pre-FS judgment as open —
the user reads its `판단 필요 1건` (and the absence of the `✓ 종결` chip) as
`Pre-FS GO 필요` — contradicting the criteria strip's row 4 (`✓ 충족`) and the
panel's own recorded summary on the same screen. Mechanism: the collapsed
strip (`ReviewBuckets.tsx:451-479`, summary variant mounted at
`BrownfieldStage.tsx:57`) shows bucket counts; the `판단 필요` count
subtracts only manual `사람 확인` acks (`displayCounts`,
`ReviewBuckets.tsx:419-427`; `resolvedClaims` = `confirmedJudgements`,
`GateDecisionPanel.tsx:471-477`). A recorded gate decision resolves nothing:
the pre_fs gate-verdict claim (`lib/review/ai-first.ts:103-111`, "The pre_fs
gate verdict (go / hold / kill)" → `Pre-FS 게이트 판정 (진행 / 보류 / 중단)`)
and the S6-incomplete claims whose reason carries the engine's GO prose
(`Pre-FS 게이트 GO 결정이 필요합니다 (사람이 기록)`, `ai-first.ts:63-77`) stay
counted indefinitely.

**Intended behavior (design intent)**. Screen state must agree with the
recorded gate state everywhere it appears — the same rule that drives this
doc's revocation design (Amendment 2: "latest decision wins"; the strip's
row-4 GO state) and the collapse rule (§ Fix ①-a: "All-met state: the strip
collapses to one line ✓ …"). ADR-0153's three-tier review reports *review*
state; the gate decision is *human* state — once the person recorded GO, the
collapsed summary must not present that judgment as still pending.

**Fix approach (component/key level)**. Both parents already hold the gate
state — no new fetch (StageFrame single-read rule). `GateDecisionPanel`
derives per-gate decisions from `latest` (it already calls
`gateState(latest, g)` at `GateDecisionPanel.tsx:893`) and passes a new
optional prop `gateStates` to its `ReviewBuckets` (line 1035);
`BrownfieldStage` passes the existing `s6Gate` (`BrownfieldStage.tsx:37-40`)
to the stage-level `ReviewBuckets` (line 57). In `ReviewBuckets`, claims
resolved by the recorded decision leave the counts (GO and KILL are
terminal), and the collapsed strip renders a state-aware chip. Where a HOLD
state is resolvable, the count is replaced by the amber HOLD line per the
copy table below (the IC strips, `IcReviewStage`); where it is not — the S6
stage-level strip — the honest pending count renders instead: `evaluateS6`
re-emits `s6.pre_fs_go` as missing after a HOLD
(`lib/process-flow.ts:544-558`), so the count correctly reads as pending
re-decisions (D-b, Landing record). Designed collapsed copy (new keys under
`review.strip`; `{gate}` = the catalog label via the existing `gateLabelKey`
path, `ReviewBuckets.tsx:53-54`; glyph + text, never colour-only —
status-green/amber/red pairs):

| State | Key | ko | en |
|---|---|---|---|
| no decision recorded | — (unchanged) | `판단 필요 {count}건` (existing) | existing |
| latest = GO | `review.strip.gateGoRecorded` (new) | `✓ {gate} GO 기록됨` | ✓ {gate} GO recorded |
| latest = HOLD | `review.strip.gateHoldRecorded` (new) | `◐ {gate} HOLD 기록됨 — 재결정 필요` | ◐ {gate} HOLD recorded — re-decision needed |
| latest = KILL | `review.strip.gateKillRecorded` (new) | `✕ {gate} KILL 기록됨 — 프로세스가 종료되었습니다` | ✕ {gate} KILL recorded — the process is terminated |

The none-state copy is unchanged — with no decision recorded the count is
honest. KILL terminates the process (Amendment 2 revocation rule). The
criteria strip hides per the terminated rule (§ Fix ①-a —
`S6CriteriaPanel.tsx:172`); the review strip itself renders unconditionally
on terminated deals (`BrownfieldStage.tsx:71-76`), so the KILL chip is live
on the s67 screen's collapsed strip as well as on the panel's other mounts
(inbox, route decision) — see D-c in the Landing record for the
attributed-gate caveat and the recorded follow-up.

**Acceptance criteria**.

1. Record Pre-FS GO on a data-complete deal → the collapsed card shows
   `✓ 예비타당성 검토(Pre-FS) GO 기록됨`, the gate-verdict claim leaves the
   `판단 필요` count, and the card's state agrees with `S6CriteriaPanel`
   row 4 (`✓ 충족`) in the same render.
2. Record HOLD after GO → where the HOLD state is resolvable the card shows
   the amber HOLD line; on the S6 stage-level strip the count reads as
   pending re-decision (D-b). S6 regresses per Amendment 2 and the card
   stays consistent with row 4 (`✕ 미충족`).
3. No decision recorded → the collapsed card is byte-identical to today
   (regression-pinned by a render test).
4. Render tests pin all four states; the chip is glyph + text (1.4.1) and the
   state word is available to assistive tech.

### U3 — Double `현재` in the stage rail on the s67 routes

**Current behavior (observed)**. On `/deals/{id}/s6`, BOTH the S6 and the S7
step render `현재` (`stage-step-state` in the full rail, ` (현재)` in the
compact disclosure list) and both carry the filled-circle current styling;
both also carry `aria-current="step"`. The current-step marker — a singular
concept — is duplicated.

**Anchors**: the caller passes the combined array —
`app/web-next/app/deals/[id]/[stage]/page.tsx:279`
(`<StageFrame stageId={["S6", "S7"]} …>`), a holdover from the pre-Amendment-2
combined screen (Amendment 2 made the routes stage-specific but not this
prop). `StageFrame.tsx:191` (`ids = Array.isArray(stageId) ? stageId :
[stageId]`) → `StageFrame.tsx:284` (`<StageRail current={ids} …>`) →
`StageFrame.tsx:639` (`isCurrent = current.includes(s.id)`), `:656`
(`{!status && isCurrent && <span className="stage-step-state">현재</span>}`),
`:616-624` (compact list `aria-current` + `isCurrent ? " (현재)" : ""`), and
`:672` (`aria-current={isCurrent ? "step" : undefined}`).

**Intended behavior (design intent)**. Exactly one stage is `현재` — the
viewed stage. Amendment 2's split made `/s6` S6 work and `/s7` S7 work
("reading order = work order"; the same-act-from-two-routes removal), and the
rail's own contract is singular (`StageFrame.tsx:488-492`: one stepper,
`aria-current="step"`). The project-side caller already honours it —
`StageTabs.tsx:165` passes exactly one stage
(`current={[group.stage]}`) — the s67 call is the only outlier. `StageRail`
itself is correct: marking every id in `current` is its multi-stage contract
(overview pages use it legitimately); the defect is the data the s67 route
feeds it.

**Fix approach (component/key level)**. `StageFrame` already computes the
viewed stage — `pathStageId` (`StageFrame.tsx:200-204`,
`navSource = pathStageId ?? primary`, line 205). Narrow the rail's input at
line 284: `StageRail current={pathStageId ? [pathStageId] : [primary]}` (the
h1 at line 219 already narrows through `stageLabelOf(ids, pathStageId)`; the
rail is the only remaining consumer of the raw array). No `StageRail` change,
no locale change: the non-viewed stage simply shows its plain state — on
`/s6` the S7 step loses the marker (locked/pending rendering, no `현재`), on
`/s7` the S6 step loses it. Marking the completed stage `완료` (the `status`
prop) is a separate enhancement and stays out of scope here.

**Acceptance criteria**.

1. On `/deals/{id}/s6`: exactly one element with `aria-current="step"` (S6);
   zero `현재` strings attached to S7 (full rail and compact list both).
2. On `/deals/{id}/s7`: the mirror — S7 marked once, S6 unmarked.
3. Render tests pin both routes; ADR-0070 preview evidence at 1440 and 390
   shows one marker per rail.

### U4 — 390px horizontal overflow (~3px) on the Pre-FS decision form inputs

**Current behavior (observed)**. Inputs styled `.sizing-new-input` /
`.sizing-new-input-sm` in `GateDecisionPanel.tsx` — line 177 (gap-ask modal
textarea), 1198 (gate select), 1213 (decision select), 1233-1244 (rationale
input, `sizing-new-input w-full`), 1259-1265 (HOLD textarea), 1271-1277
(KILL textarea) — exceed the card's content box by ~3px at a 390px viewport
on certain deals (where the decision form renders), producing a horizontal
scroll on the stage screen.

**Mechanism**. The base layer already fixed this exact defect class for plain
controls: `input, select, textarea { min-width: 0; max-width: 100% }`
(`app/web-next/app/styles.css:279-303` — its comment documents the same
390px overflow, "OVERFLOW-390", and the axe-sweep remediation reused it at
styles.css:3231). `.sizing-new-input` re-declares
`min-width: 8rem` (styles.css:3604) and `.sizing-new-input-sm`
`min-width: 5rem` (styles.css:3613); the class rules come later in the
cascade, so these inputs lose the containment. Inside the decision-form row
(`GateDecisionPanel.tsx:1188`, `flex flex-wrap items-end gap-2`) whose
rationale wrapper carries its own `min-w-[14rem]` floor (line 1220), a
wrapped item whose floor exceeds the line width overflows by the residual
few pixels.

**Intended behavior (design intent)**. This doc consumes these classes by
name (§ Components and tokens consumed: `sizing-new-input`,
`sizing-new-input-sm`, "the new form fields reuse the exact
registration-form styling so the two surfaces read as one system") and binds
the responsive minimum (§ Accessibility checklist; workspace ADR-0065) plus
the ADR-0070 preview condition at 390 — an overflow fails that condition
before any moderated check runs. Amendment 2's preview verification already
demands a 390px pass for this exact screen.

**Fix approach (right CSS layer — the token/component rule, not per-input
hacks)**. In `app/web-next/app/styles.css`, contain the two classes where
they are defined: `.sizing-new-input` gains `max-width: 100%` and a clamped
floor `min-width: min(8rem, 100%)` (lines 3597-3605); `.sizing-new-input-sm`
likewise (`min-width: min(5rem, 100%)`, line 3613). This mirrors the
codebase's own precedents — `.form-input` (styles.css:4200:
`min-width: 0; max-width: 100%; box-sizing: border-box`) and `.invest-ctl`
(styles.css:3616: `box-sizing: border-box; width: 100%; min-width: 0`) — and
re-derives what the base layer already established for every other input.
The floors keep their desktop meaning (inputs never collapse below 8rem/5rem
where space allows) and degrade to the container at narrow widths. No TSX
change: every consumer of the two classes (this panel, the Long List
registration form, the admin KPI gate select
`GateIntegrityKpiSection.tsx:314`) is fixed at once, and the two surfaces
stay one system per this doc's token rule.

**Acceptance criteria**.

1. At a 390px viewport on `/deals/{id}/s6` with the Pre-FS decision form
   rendered — including the HOLD-textarea and KILL-textarea states and the
   gap-ask modal open — `document.documentElement.scrollWidth ===
   document.documentElement.clientWidth` (no horizontal scroll), and the
   panel section's own `scrollWidth === clientWidth`.
2. At 1440 the layout is unchanged (the floors still bind above the clamp) —
   desktop renders byte-identical.
3. ADR-0070 preview evidence at 390, both themes, attached for the panel in
   all three form states; the fix lands in `styles.css` only (no per-input
   Tailwind overrides in TSX).

### Traceability and scope

- U1 → § Fix ①-a single-source catalog rule (and the review surface's own
  no-raw-ids rule). U2 → Amendment 2 revocation ("latest decision wins") +
  § Fix ①-a collapse rule. U3 → Amendment 2 stage split + the rail's singular
  `aria-current` contract. U4 → § Components and tokens consumed (token-only
  styling, one system) + § Accessibility checklist + ADR-0070 390 preview.
  No new doctrine is introduced by this section.
- Out of scope, unchanged from § Out of scope: guard logic, predicates,
  engine prose, evidence append-only model, and the S6CriteriaPanel row
  states (U2 changes only the review card's summary, not the strip).
- Implementation order suggestion for the dispatching row: U3 and U4 are
  single-file, no-copy changes (U3 one line in `StageFrame`, U4 one rule in
  `styles.css`); U1 and U2 add keys and props (ko/en parity tests each).
  U2 touches `ReviewBuckets`' prop surface — its other callers (inbox,
  proposal confirm, other stage screens) receive the new prop as optional
  and render unchanged, which is the regression surface to test.

### Landing record — 2026-11-22

The U1–U4 implementation passed AI 1st-formal and AI 2nd-cross-domain review
on 2026-11-22 with three adjudications, recorded here as the landing
conditions of this section.

- **D-a — accepted-as-noted.** The `GateDecisionPanel` expanded review-head
  mount (`ReviewBuckets.tsx:549`) is intentionally not threaded with
  `gateStates`: it is the expanded variant with no chip slot, as are the
  inbox (`app/inbox/page.tsx:156`) and `RouteDecisionStage.tsx:116` mounts
  per this section's own rendering spec; threading there would be dead
  wiring. The chip ships on the collapsed strip only (`BrownfieldStage`,
  `IcReviewStage` parents).
- **D-b — accepted-as-noted.** On the S6 stage-level strip the amber HOLD
  line is superseded by the engine-honest count: `evaluateS6` re-emits
  `s6.pre_fs_go` as missing after a HOLD (`lib/process-flow.ts:544-558`), so
  the strip correctly shows the pending re-decision count — consistent with
  this section's "HOLD keeps the count" rule for the stage-level strip; the
  HOLD copy itself stays live on the IC strips (`IcReviewStage`).
- **D-c — accepted with caveat (non-blocking follow-up).** The review strip
  renders unconditionally on terminated deals (`BrownfieldStage.tsx:71-76`);
  the earlier sentence claiming the strip hides per the terminated rule was
  wrong for this strip (only `S6CriteriaPanel.tsx:172` hides). A deal killed
  at an earlier gate therefore shows the KILL chip attributed to Pre-FS.
  Accepted because it strictly improves the stale-count status quo and the
  process-terminated tail is factually true. Follow-up (recorded, not in
  this batch): resolve the killed gate from decision history for the chip
  label, or use gate-neutral terminated copy when the kill came from another
  gate.
