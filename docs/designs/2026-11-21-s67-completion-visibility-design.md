---
lang: en
date: 2026-11-21
status: implemented
owner: ux-designer-agent (design), pm (dispatch)
related: docs/designs/2026-11-08-deal-shape-to-s7-design.md (s67 screen design of record), ADR-0195, ADR-0201, ADR-0202, docs/designs/2026-11-11-target-identity-resolution-design.md (PATCH D4 single-update-path of record), docs/designs/2026-11-17-deal-shape-viability-first-design.md, docs/design-system/design-tokens.md, docs/design-system/design-components.md, docs/design-system/design-screens.md
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
(`/deals/{id}/s6`·`s7`, `/brownfield`) is a **P1 Registry** composite (per
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

**Owner decision.** The pre_fs `GateDecisionPanel` moves out of the S7 approval
tab into the S6 longlist block. Implementation landed the same day (frontend
dispatch; this section records the placement rationale).

**What changed.**

- `LonglistSection.tsx` renders the pre_fs gate panel immediately AFTER the
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

**Promoted steps unaffected.** The panel accepts a pre_fs decision wherever it
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
