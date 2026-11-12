---
lang: ko
lang_reason: source-material
---

# S1 Growth-Gap Calibration Loop

- Spec ID: `2026-09-18-s1-growth-gap-calibration`
- Date: 2026-09-18
- Status: implemented — amendment 2026-11-12 implemented (staleness surface, CTA decoupling, CAGR-gated fallback); amendment 2026-11-12c implemented-pending-review (external reference supersede)

## Problem

The S1 headline growth rate (`consistency.bottomUpCagr`) is a deterministic
rollup of LLM-produced per-cell CAGRs. External reference figures
(`consistency.topDownCagr`, `externalForecast`) come from one-shot LLM
prior-knowledge queries: they are not persisted, not sourced, and not
reproducible. A gap computation exists (step 5-B `gapPct` + narrative
`gapAnalysis`/`newDrivers`) but has no threshold, no numeric driver
attribution, and no feedback into the next run — a rerun replays the same
prompts with fresh sampling noise, so the gap never converges. The user
requirement: when our growth rate differs from an external-report-based rate
by 20% or more, identify and analyze the key drivers and CALIBRATE, with the
difference actually shrinking across reruns.

## Requirements (ASD-STE100)

- R1: An analyst can record the external reference (source label required,
  URL optional, target year, external CAGR %, optional external size) per
  industry. A recorded reference is reused verbatim on reruns — the LLM prior
  is a fallback only, and a prior-based forecast is persisted once
  (`captured_from='llm_prior'`) so later runs stop re-rolling the dice.
- R2: When `|our CAGR − external CAGR| / external CAGR ≥ 20%` (constant,
  relative basis), the version records `calibration.triggered = true`, the
  report shows a 보정 필요 badge, and the pipeline runs driver attribution.
- R3: Driver attribution (step 5-C) produces NUMERIC proposals per driver —
  direction, estimated CAGR contribution (percentage points), rationale —
  stored as `status='proposed'`. Nothing is auto-applied.
- R4: A person accepts or dismisses each proposal. Accepted drivers form the
  industry's calibration set and are injected as constraints into the next
  rerun's step-2/step-4 prompts, together with the previous gap and the
  external reference; the run must state its remaining gap.
- R5: Each calibrated version records `calibration {triggered, ourCagrPct,
  externalCagrPct, gapPct, previousGapPct, appliedDrivers}` so the report can
  show the gap trend across versions (convergence is visible).
- R6: Gate semantics unchanged — calibration is advisory for S1 completion
  (the kill criteria stay human decisions).

## Design

### Storage (migration `0113_s1_calibration.sql`)

- `market_external_reference`: id, industry_id UNIQUE-ish (latest wins via
  version_no), source_label NOT NULL, source_url, target_year,
  external_cagr_pct REAL NOT NULL, external_size_b REAL, captured_from CHECK
  IN ('user','web_research','llm_prior'), created_by, created_at. Reads take
  the newest row; writes append (audit-friendly history).
- `industry_driver_calibration`: id, industry_id, version_id (proposal origin),
  driver TEXT NOT NULL, direction CHECK IN ('upside','downside'), impact_pct
  REAL (percentage points of CAGR), rationale TEXT NOT NULL, status CHECK IN
  ('proposed','accepted','dismissed'), proposed_by, decided_by, decided_at,
  created_at.

### Pipeline (`lib/market-sizing-pipeline.ts`)

- Startup (alongside the existing `prev` read): parse the previous payload's
  `consistency.bottomUpCagr`, `externalForecast.gapPct`, and `calibration`;
  load the newest external reference and the accepted calibration drivers.
- Step 2/step 4 prompts: append `buildCalibrationConstraints(...)` when there
  is anything to inject (external reference CAGR, previous gap, accepted
  drivers). The step-4 prompt additionally instructs the model to justify any
  remaining gap.
- Step 5-B: resolve the external forecast — recorded reference first
  (captured_from='user'/'web_research'), else the existing LLM prior query;
  when the prior produces a usable forecast and no user reference exists, the
  result is persisted as a `llm_prior` reference so it stabilizes.
- Gap trigger on the CAGR basis (relative, 20%); when triggered, step 5-C asks
  the LLM for 2-5 numeric driver attributions grounded in the run's research
  and qualitative factors, deletes this industry's previous un-decided
  proposals, and inserts fresh `proposed` rows.
- Payload: `matrix.calibration` per R5; step summaries gain a 5-C entry when
  the loop runs.

### API + UI

- `GET/PUT /api/market-overview/industry/[industryId]/external-reference`
  (PUT analyst+; source_label and external_cagr_pct required).
- `GET /api/market-overview/industry/[industryId]/calibration` — proposals,
  accepted set, and the per-version gap trend. `POST .../calibration/[rowId]`
  with `{action:'accept'|'dismiss'}` (analyst+, audited).
- Market report 5-B section: trigger badge (보정 필요 ≥20%), driver proposal
  cards with 수용/기각, external-reference editor, version gap trend list, and
  a 보정 반영 재분석 button (existing rerun).
- `insights` route exposes `calibration` so S2 keeps the linkage.

### Methodology doc

`.agents/skills/systematic-market-sizing/SKILL.md`: step 5-B gains the
recorded-reference preference and the 20% trigger; a new 5-C documents the
attribution + accept loop (schemaVersion stays; pipeline methodology string
bumps to v1.2.0).

## Test plan

- `tests/unit/market-calibration.test.ts`: trigger math (relative basis,
  boundary at 20%), constraint builder contents, external-reference
  resolution order (user > llm_prior > none), proposal accept/dismiss flow and
  audit — lib-level against scratch SQLite.
- Full gates: `bun run test:unit`, design-lint, migrate + integrity.

## Out of scope

- Automatic (no-human) application of driver adjustments — the accept step is
  deliberately a person's action (boundary #2).
- Deterministic scaling of cell CAGRs (methodology stays LLM-constraint
  based); escalation is a future decision.

---

## Addendum (2026-11-06): 기록된 외부 참조의 step-5 탑다운 컨센서스 연동

- Status: approved fix design (구현 대기 — 본 문서에 설계만 기록)
- Scope: `lib/market-sizing-pipeline.ts` step 5 의 `topDownCagr` 산출 경로 확장.
  저장소·API·UI 변경 없음 — 기존 `market_external_reference` 기록을 재사용한다.

### 문제

- step 5 (`lib/market-sizing-pipeline.ts` ~L711-733) 의 탑다운 컨센서스
  CAGR(`topDownCagr`)은 one-shot LLM 선험 질의(`askJsonTracked`)에서만 온다.
  LLM이 `{"cagr":null}`을 반환하면 `topDownCagr=0`이 되고, 리포트는
  "탑다운 컨센서스 미입력 — 입력 후 재확인 필요…"(~L1055-1061)를 영구 표시한다.
- 보정 루프(v1.2.0)는 사람이 외부 참조(출처 라벨, 대상 연도, 외부 CAGR%)를
  CalibrationPanel → `PUT /api/market-overview/industry/[industryId]/external-reference`
  로 기록하고, `resolveExternalReference`(`lib/market-calibration.ts`)로
  해석한다. R1 원칙: "기록된 참조는 재분석에서 그대로 재사용 — LLM 선험은
  폴백일 뿐이다."
- 결함: 이 기록 참조는 현재 step 5-B `externalForecast`(~L744)에만 먹히고,
  step 5 `topDownCagr`에는 먹히지 않는다. step 5 `pendingInputs`는
  "탑다운 컨센서스 CAGR 수동 입력"이라 쓰지만 수동 경로는 step 5에 닿지 않는다.

### 결정 (요구사항, ASD-STE100)

- D1: `resolveExternalReference`가 참조를 반환하면 파이프라인은 그
  `external_cagr_pct`를 step 5 탑다운 컨센서스(`consistency.topDownCagr`)로
  사용한다. step 5에서 LLM 선험 질의를 하지 않는다.
- D2: 우선순위는 기록 참조 > LLM 선험 > 0(미입력)이다. R1과 같은 순서다.
- D3: 기록 참조를 쓸 때 `consistency.tolerance` 노트는 이 값이 사람이 기록한
  출처 확인된 참조임을 명시한다(`captured_from` 표기 포함). 기존
  "LLM 지식 기반 추정" 노트 문구는 LLM 선험 경로에만 유지한다.
- D4: 기록 참조가 없으면 현재 동작을 유지한다 — LLM 선험 질의 후, 실패 시
  기존 "탑다운 컨센서스 미입력" 메시지에 보정 루프 기록 경로 안내를 덧붙인다
  (보정 루프에서 외부 참조를 기록하면 재분석 시 이 값이 탑다운 컨센서스로
  반영됨).
- D5: 게이트·RAG·스키마(`schemaVersion`) 변경 없음. `topDownCagr`의 산출
  근거만 달라진다.

### 영향 파일

- `app/web-next/lib/market-sizing-pipeline.ts` — step 5 산출 경로와
  `consistency.tolerance` 노트 문구만. 이 문서는 설계 기록이며 코드 변경은
  별도 실행 태스크로 진행한다.

---

## Amendment 2026-11-12 — external references surface and flow into top-down consensus

- Spec ID: `2026-09-18-s1-growth-gap-calibration` (this amendment)
- Date: 2026-11-12
- Status: implemented 2026-11-12 (staleness surface C1, rerun CTA decoupling C2, CAGR-gated fallback C3; non-goals C4 kept)
- Owner of the consensus priority ladder: `docs/designs/2026-11-06-s1-quantitative-web-grounding-design.md`
  (recorded reference > web-search extraction > LLM prior > unset). This amendment narrows
  "recorded reference" to CAGR-bearing references for CONSENSUS purposes only — see C3.

### Problem (verified against origin/main @ b32023b4; all file:line below are that tree)

- Contract today: a recorded external reference becomes the top-down consensus only at the
  NEXT re-analysis. The pipeline loads the reference at startup
  (`app/web-next/lib/market-sizing-pipeline.ts:568` → `resolveExternalReference`,
  `app/web-next/lib/market-calibration.ts:57-65`) and resolves the consensus in
  `resolveTopDownConsensus` (`market-sizing-pipeline.ts:362-406`), with the
  `external_cagr_pct > 0` guard at `:368`; the result persists as
  `matrix.consistency.topDownCagr` (`market-sizing-pipeline.ts:1379-1384`).
- Reported deal `01M6ZPEZ39R78DW612ECEXY5W4` (industry 원전 운영·정비(MRO)) has 2 user
  references (4.7% CAGR; recorded 2026-11-09 08:46 and 2026-11-11 13:37) but its analysis
  versions v1/v2 were produced 2026-11-09 08:10/08:18 — a stale pre-reference payload with
  `topDownCagr 0` and no `externalForecast`. The growth tab shows no re-analysis CTA
  (`SizingGrowthTabs.tsx:82-113` gates the rerun button on `matrix.externalForecast &&
  |gap| >= 20`) and no staleness warning anywhere. CalibrationPanel live-GETs the reference
  (`CalibrationPanel.tsx:38-39`, displayed at `:99-107`) — hence "recorded reference" and
  "미입력" appear side by side with no bridge between them.
- Latent dead-end (code-verified): the pipeline auto-saves size-only references with
  `external_cagr_pct = 0` (`market-sizing-pipeline.ts:1053-1062` for `web_research`,
  `:1078-1086` for `llm_prior` when no CAGR was extracted). At `:959` the pipeline skips
  the web/LLM consensus fallback whenever a reference EXISTS — regardless of CAGR — while
  the `:368` guard rejects CAGR 0. Result: for industries whose latest reference is
  size-only, the consensus stays "미입력" permanently, even after re-analysis.

### Changes

- C1 — Staleness surface. Compute `referenceNewerThanVersion`: latest
  `market_external_reference.created_at` vs the latest displayed version's `created_at`
  (`detail.versions[0].created_at` — already client-side, `components/stages/market/types.ts:34`
  and `:61`). Payload plumbing (smallest change wins): `SizingGrowthTab` performs its own
  live GET of `/api/market-overview/industry/{industryId}/external-reference` — the same
  endpoint CalibrationPanel uses (`CalibrationPanel.tsx:38-39`); the route returns the raw
  row (`SELECT *`, `market-calibration.ts:57-65`), so `created_at` is already in the
  payload — add `created_at: string` to the local `RefRow` type. No prop drilling, no
  change to CalibrationPanel or to `SizingScenarioCharts.tsx` (ConsistencyChart stays
  mounted by `SizingGrowthTabs.tsx:75`; the banner lives in `SizingGrowthTab`). When
  `referenceNewerThanVersion` is true, render a status banner:
  "기록된 외부 참조가 최신 분석보다 최신 — 재분석 시 컨센서스로 반영됩니다".
  Locale key naming convention (english key, korean value): add one key under
  `stages.s1.sizingGrowthTabs` in `locales/en.json` (english value) and `locales/ko.json`
  (korean value).
- C2 — Re-analysis CTA decoupling. The growth tab's rerun button must also appear when
  `referenceNewerThanVersion` is true, independent of `externalForecast && |gap| >= 20`.
  Keep the existing gap-gated CTA unchanged otherwise. The rerun route needs NO change —
  verified: `POST /api/market-overview/analyses/[id]/rerun`
  (`app/web-next/app/api/market-overview/analyses/[id]/rerun/route.ts`) re-invokes
  `runSizingPipeline`, which re-reads `resolveExternalReference` at startup
  (`market-sizing-pipeline.ts:568`), so the next version already picks up the reference.
- C3 — Fallback fix. `market-sizing-pipeline.ts:959` — change
  `if (!externalReference)` to
  `if (!externalReference || externalReference.external_cagr_pct <= 0)` so a size-only
  auto-saved reference no longer suppresses the web/LLM consensus fallback. The `:368`
  guard stays. Cross-reference: `2026-11-06-s1-quantitative-web-grounding-design.md` owns
  the priority ladder; this amendment narrows "기록 참조" to CAGR-bearing references for
  CONSENSUS purposes only — calibration constraints keep their own guard semantics.
- C4 — Non-goals. No auto-triggered re-analysis (the proposal is LLM/UX; the action is the
  person's — doctrine). No change to `resolveEffectiveCagr` / the ×0.85 escalation path.
  No schema change (`created_at` already exists on `market_external_reference`,
  migration 0113).

### Design note

- The C1 banner wording ("반영됩니다") is literally accurate for CAGR-bearing references.
  For auto-saved size-only references (CAGR 0), the CTA is still valid (re-analysis
  refreshes the whole report and, after C3, the consensus falls through to web/LLM), but
  the consensus will not equal the reference's CAGR. Banner renders for any newer
  reference; reviewers may scope the wording variant later — recorded here as a judgement
  call, not a blocker.

### Test plan

- Unit tests (new `tests/unit/market-growth-staleness.test.ts`, lib-level against scratch
  SQLite):
  - staleness comparator — reference newer / older / equal timestamps;
  - CTA visibility conditions — gap-gated only, staleness-gated only, both, neither;
  - pipeline fallback with a size-only reference — web/LLM fallback runs, consensus is
    not permanently zero;
  - CAGR-bearing reference path unchanged (consensus still equals the reference).
- Full regression of the market suites: `tests/unit/market-calibration.test.ts`,
  `tests/unit/market-sizing-web-grounding.test.ts`, and the market route suites under
  `tests/unit/`; plus the standard gates (`bun run test:unit`, design-lint).

### Touched files

- `app/web-next/lib/market-sizing-pipeline.ts` — fallback gate at `:959` only (C3).
- `app/web-next/components/stages/market/SizingGrowthTabs.tsx` — reference live GET,
  `referenceNewerThanVersion` comparator, staleness banner, CTA decoupling (C1, C2).
- `app/web-next/locales/en.json`, `app/web-next/locales/ko.json` — one banner key (C1).
- `tests/unit/market-growth-staleness.test.ts` — new (test plan above).

## Addendum 2026-11-12b — banner follow-ups A1–A3

Closes the review advisories on the Amendment 2026-11-12 banner (landed in #874).

- A1 — same-mount refresh: the banner's reference live-GET in `SizingGrowthTab`
  ran once per mount, so a reference saved in `CalibrationPanel` during the same
  mount did not raise it. `CalibrationPanel` gains an optional
  `onReferenceSaved` callback fired only on a successful save PUT; the parent
  bumps a `referenceRefresh` counter into the live-GET deps. The comparator and
  its inputs are unchanged (`referenceNewerThanVersion(reference.created_at,
  version.created_at)`), so a refresh re-runs the same GET and the banner cannot
  false-positive.
- A2 — wording: the banner no longer promises the consensus outcome. ko
  "재분석 시 컨센서스로 반영됩니다" → "재분석 시 이 참조가 반영됩니다"; en aligned
  to "it will be applied on re-analysis" (the amendment's Design note already
  flagged the wording judgement call — this resolves it).
- A3 — rendering seam pinned: `RerunAction` / `GrowthStalenessCard` are exported
  pure views (`GrowthBannerViews.tsx`, imported by `SizingGrowthTabs.tsx`; the
  split keeps every `components/stages/market` file under the 400-line
  decomposition cap), rendered under `NextIntlClientProvider` in
  `tests/unit/market-growth-banner-render.test.ts` (house
  renderToStaticMarkup pattern); the mount-level facts (refresh deps, save
  signal wiring, unchanged comparator) are pinned by source assertion. The full
  `SizingGrowthTab` mount (api client, charts) remains unpinned — documented in
  the test header. Cap-driven moves in the same pass: the calibration row
  interfaces moved to `market/types.ts` and the escalation section to
  `CalibrationEscalation.tsx` (markup and locale keys unchanged).

## Amendment 2026-11-12c — external reference supersede

- Spec ID: `2026-09-18-s1-growth-gap-calibration` (this amendment)
- Date: 2026-11-12
- Status: implemented-pending-review (soft, record-preserving supersede; three-stage review pending at PR time)

### Problem

A recorded external reference pins every future re-analysis baseline forever.
The resolver takes the newest non-retired row (`resolveExternalReference`),
`PUT` only appends a new version, and there is no way to retire a wrong or
stale reference: the web-search / LLM-prior fallback ladder (amendment
2026-11-12, CAGR-gated) never resumes because the retired row still wins the
resolution order. A person needs a retirement action that does NOT rewrite
history — completed analyses must keep the reference they were run with.

### Changes

- S1 — Migration `db/migrations/0191_external_reference_supersede.sql`
  (`@reversible`, purely additive): `market_external_reference` gains nullable
  `superseded_at TEXT` and `superseded_by TEXT REFERENCES
  market_external_reference(id)`. No existing rows are touched.
- S2 — Resolver filter: `resolveExternalReference` gains
  `AND superseded_at IS NULL`. Superseding never rewrites completed analyses —
  only the NEXT re-analysis baseline changes: with no live reference the
  fallback ladder resumes (web-search extraction > LLM prior > unset, per the
  priority ladder owned by `2026-11-06-s1-quantitative-web-grounding`).
- S3 — `supersedeExternalReference(db, industryId, id, actor)` in
  `market-calibration.ts`: the row must exist and match `industry_id`
  (otherwise null → route-level 404, 404-not-403); an already-superseded row
  is an **idempotent no-op** (returns the row, no re-write, no second audit —
  chosen over 409 and documented: repeat DELETE converges to the same state);
  first supersede stamps `superseded_at = now` and keeps `superseded_by NULL`
  (plain supersede — no successor recorded) and writes one
  `market_external_reference.supersede` audit row. The row itself is never
  deleted (append-only preservation, ADR-0012 family).
- S4 — Route: `DELETE` export added to the existing
  `app/api/market-overview/industry/[industryId]/external-reference/route.ts`,
  mirroring the PUT's structure exactly (authenticate →
  `requireBusinessActor(auth.auth, "write", { viewerMessage })` → body
  `{ id }` → `md_industry` existence check). Registered in
  `docs/architecture/openapi.yaml` as `supersedeMarketExternalReference`
  (drift gate).
- S5 — UI: `CalibrationPanel` gains a supersede button next to `edit` under
  the same `canCurate` gate, with the house destructive-action confirm
  (`useConfirm` + `ConfirmDialog`). The confirm copy states the consequence
  explicitly: completed analyses keep their recorded baseline; from the NEXT
  re-analysis the reference stops pinning the baseline and web-search /
  LLM-prior fallbacks resume. After success the panel refetches and naturally
  shows the no-reference state.

### Test plan

- `tests/unit/external-reference-supersede.test.ts` (new, route-level through
  the next-route-dispatch helper): superseding the latest makes the resolver
  return the previous row; wrong industry → 404; already-superseded →
  idempotent no-op with no second audit; unknown id → 404; viewer → 403
  role_required and unauthenticated → 401; audit row written exactly once.
- Pipeline case in `tests/unit/market-sizing-web-grounding.test.ts`: a
  superseded CAGR-bearing reference no longer becomes the consensus on
  re-analysis — the ladder resumes at web extraction and the retired row stays
  preserved.
- Full market-suite regression + standard gates (`bun run test:unit`,
  `typecheck:web`, `biome ci --changed`, `lint:i18n`).

### Touched files

- `db/migrations/0191_external_reference_supersede.sql` — new (S1).
- `app/web-next/lib/market-calibration.ts` — row type, resolver filter,
  `supersedeExternalReference` (S2, S3).
- `app/web-next/app/api/market-overview/industry/[industryId]/external-reference/route.ts`
  — DELETE export (S4). `docs/architecture/openapi.yaml` — delete operation.
- `app/web-next/components/stages/market/CalibrationPanel.tsx` — supersede
  button + confirm + refetch (S5); `locales/ko.json`, `locales/en.json` —
  supersede copy keys.
