---
title: "Entry-market S2 promotion and S3 linkage — payload-shape compatibility fix, spec-level S2 activity, S3 context"
status: accepted
date: 2026-10-17
owner: platform-lead
lang: ko
lang_reason: proper-noun
---

# Entry-market S2 promotion and S3 linkage — payload-shape compatibility fix, spec-level S2 activity, S3 context

Korean appears only as UI labels/product terms in backticks. All prose is English. Code paths are relative to the repo root or `app/web-next/` as stated.

- Status: **Accepted** (2026-10-17 — the human decider directed the work in chat: treat 진입시장 산정 at the same level as the 기회/위험 요인 and 비즈니스 모델 검토 reviews inside S2, derive it from the S1 market analysis via region split and ratios into refined target segments, link the resulting market into S3, and re-review the whole entry-market implementation because "지금까지 구현된 내용이 제대로 동작하지 않는다"). Drafted by platform-lead.
- ADR: [ADR-0180](../adr/0180-entry-market-s2-promotion-s3-linkage.md) — records the decision. This design does **not** touch the accepted ADR-0179 factor-ratio rules (Amendment 2026-10-17 §B): ratio-only factors, mandatory per-step source, strict S1→S2 direction, human-only writes, per-step confidence lowering all **stand unchanged**.
- Builds on: ADR-0179 slices A/B + the 2026-10-17 entry-market flow redesign (slices 1-4), the non-negotiables (#2 human decisions, #4 data confidence caps the RAG grade), and `process/flow.spec.yaml` (ADR-0074 SSOT).

## 1. Problem statement (decider direction, 2026-10-17)

1. **Same level as the other S2 reviews.** 진입시장 산정 must be handled in S2 at the same level as the 기회/위험 요인 review and the 비즈니스 모델 검토 review — a first-class S2 deliverable in the process spec, not a side card.
2. **S1 → region split → ratio → refined segments → S3.** Starting from the S1 market analysis, a region classification is applied, a ratio subdivides the target segments, and the resulting market must be visible to S3 (시너지·전략적 적합성).
3. **The implemented flow does not actually work.** A full re-review, then an execution plan, then implementation.

## 2. Verified current state (code + live database, 2026-10-17)

### 2.1 ROOT CAUSE — the payload-shape mismatch (the reason "nothing works")

The S1 sizing pipeline writes version payloads as `{methodology, matrix: {anchor, regions, segments, …}, stepSummaries}` (`lib/market-sizing-pipeline.ts:1066`). Every reader added by ADR-0179 instead reads the **top-level** shape `{anchor, regions, scope}`:

| Reader | Path it reads | Actual data lives at |
|---|---|---|
| `readS1AnchorYear1` (`lib/entry-market.ts:158`) | `payload.anchor.total` | `payload.matrix.anchor.total` |
| `readLinkedDraftContext` (`app/api/opportunities/[id]/entry-market-derivation/draft/route.ts:160`) | `payload.anchor.total`, `payload.regions`, `payload.scope` | `payload.matrix.*` |
| anchor value in `app/api/opportunities/[id]/sizing-link/route.ts:59` | `payload.anchor.total` | `payload.matrix.anchor.total` |
| `extractSizingVersionScope` (`lib/anchor-scope.ts:67`) | `payload.scope` | nothing (see 2.2) |

Live-database evidence (`db/data/co-newbiz.sqlite`, 2026-10-17): **12 of 12** `market_sizing_version` payloads carry `matrix.anchor.total`; **0** carry a top-level `anchor`; **0** declare a `scope` (top-level or nested). The test fixtures (`tests/unit/entry-market-derivation.test.ts:57`) use the top-level shape — so the whole suite is green while every real anchor read returns `null`.

Consequences on real data, for every opportunity including the pilot `01M1MVCQ2T8R32JDNM1ZTP0668` (유압식 브레이커 — 유럽 Stage V, link ✓, scope ✓, derivation never saved):

- The derivation card computes no anchor → step 3 cannot produce a value.
- `AI 배수 추천` 409s with `anchor_unavailable` ("앵커 값이 없습니다") although the link is fine.
- The S1 reference strip shows no anchor value and no declared scope.
- `resolveDerivedEntryMarket` → null → S8 keeps the legacy bare anchor; the run-note provenance never fires.
- `resolveAnchorScopeFlag` stays `unknown` forever even when a scope exists.

### 2.2 Secondary defects

1. **No declared scope is ever written.** ADR-0179 slice 4 (segment-scoped sizing, where the pipeline would declare `scope`) is not implemented; no pipeline write path sets `scope` — so `extractSizingVersionScope` can never succeed even after 2.1 is fixed, for versions produced today. Honest `unknown` stays the correct display until a person-scoped sizing exists; but the region weights (`matrix.regions[].weight`) DO exist and are usable derivation evidence.
2. **Non-hermetic draft test.** `tests/unit/entry-market-derivation.test.ts` "AI-recommendation draft endpoint" makes a **live LLM call** whenever `.env` carries `CO_NEWBIZ_LLM_API_KEY` (measured 6.3 s, glm-5.3-flash) — it fails the 5 s default timeout and costs tokens on every run. It must stub `isLlmConfigured`/`completeDetailed` like `tests/unit/entry-market-draft-reliability.test.ts` already does.
3. **Spec gap.** `process/flow.spec.yaml` S2 has only `opportunity-discovery` and `business-model-sketch` activities; there is **no entry-market-sizing activity**, no S2 required artifact for the 진입시장 산정, and S3 inputs do not declare the derived market. The UI card is therefore not backed by the process SSOT.
4. **Placement.** The S2 page renders 진입시장 산정 as an always-visible card **below** the two tab sections (`app/opportunities/[id]/page.tsx:414`) — a visually subordinate position, unlike the two reviews which own tabs.

## 3. Design

Five slices. Slice 1 is the defect fix that makes everything already built actually run; slices 3-5 are the decider's promotion and linkage requirements. No accepted ADR-0179 rule changes.

### 3.1 Slice 1 — payload-shape-compatible readers (P0, no schema change)

New `lib/sizing-payload.ts`, the single source of truth for reading a `market_sizing_version` payload:

- `readSizingAnchorTotal(payload): number | null` — tries top-level `anchor.total`, then `matrix.anchor.total`. Positive finite numbers only.
- `readSizingDeclaredScope(payload): { regions, segments, unit_basis } | null` — tries top-level `scope`, then `matrix.scope` (future-proofing for slice-4-style scoped sizings), preserving `extractSizingVersionScope`'s strict shape rules.
- `readSizingRegions(payload): Array<{code,label,weight,mix?}>` — top-level then `matrix.regions`, tolerant.

Callers rewritten to use them: `lib/entry-market.ts` (`readS1AnchorYear1` delegates), `lib/anchor-scope.ts` (`extractSizingVersionScope` delegates), `app/api/opportunities/[id]/sizing-link/route.ts`, `draft/route.ts` (`readLinkedDraftContext`). `lib/sizing-auto-link.ts` reads nothing from payloads (verified) — unchanged.

**No payload is rewritten.** Old versions are never mutated (ADR-0179 §4 of the amendment); the fix is read-side only. Existing tests keep their top-level fixtures (proving backward compatibility); a new describe adds nested-shape fixtures mirroring the real pipeline output.

Acceptance: with a `matrix.*` payload, the derivation GET computes the anchor, the draft endpoint reaches its LLM path (no more `anchor_unavailable`), the sizing-link reference shows the anchor value, and `resolveDerivedEntryMarket` returns a value once a chain is saved — all proven by unit tests with the nested fixture.

### 3.2 Slice 2 — hermetic draft test (P0)

Stub `isLlmConfigured`/`completeDetailed` in the entry-market-derivation draft tests (module-mock pattern from `entry-market-draft-reliability.test.ts`), asserting both the `draft: null` degradation path and the success path. The suite no longer touches the network and runs in well under 5 s.

### 3.3 Slice 3 — flow.spec.yaml: S2 진입시장 산정 as a first-class activity (P0)

`process/flow.spec.yaml` v2.8.0 → **v2.9.0** (additive activity + artifact + inputs/outputs; no stage/gate structure change):

- S2 `activities` gains `entry-market-sizing` (agent `market-intelligence-agent`, skills `[systematic-market-sizing]`, procedures as the other S2 activities), with a comment citing ADR-0180 and the ADR-0179 boundary that the derivation is decision support and never a gate block.
- S2 `outputs` gains `진입시장 산정 (기회별 — S1 링크·대상 범위·배율 도출 사슬)`.
- S2 `requiredArtifacts` gains `진입시장 산정 (S1 링크·대상 범위·도출 사슬)`.
- S2 `completionCriteria` gains: `최소 1개 기회에 S1 시장규모 버전이 연결되고 대상 범위가 기록되었다` — mirroring how opportunity-discovery's criterion is stage-scoped ("최소 1개 기회…"), with a comment noting unset states display honestly as 미연결/unknown and never block (boundary #4).
- S3 `inputs` gains `진입시장 산정 (S2 — 지역·세그먼트 도출 시장)`; S3 gets a matching input-driven note in its `strategic-fit-screening` activity comment.

Regenerate the two generated artifacts (`scripts/co-newbiz/generate-process-flow.ts` → `docs/process-flow.md`, `scripts/co-newbiz/generate-spec-activities.ts`); `tests/unit/process-flow.test.ts` must stay green.

### 3.4 Slice 4 — S2 tab promotion (P1)

`app/opportunities/[id]/page.tsx`: the tab union becomes `factors | sketch | entry` (URL `?tab=entry` supported, same pattern as `sketch`). `EntryMarketFlow` moves **inside** the `entry` tab as a peer section titled like the others. The card's internal stacked 3-step presentation is unchanged (2026-10-17 decider decision preserved — that decision governed the card's internal layout, not the page-level placement). ui-spec.md updated.

### 3.5 Slice 5 — S3–S7 linkage: the entry market as the subject market (P1)

New `components/EntryMarketContextStrip.tsx`: fetches `GET /api/opportunities/:id/entry-market-derivation` (tolerant of the 409 unlinked body), renders one read-only line: derived entry-market value with the unit label, factor product, chain step count and the scope verdict chip — or the honest unset state (`미연결` / `도출 사슬 미설정` with the S1 anchor when known). Two entry points:

- `<DealEntryMarketStrip routeId>` — resolves the deal's source opportunity (`useDealOpportunityId`, the same resolver the S3 body uses) and mounts in `app/deals/[id]/[stage]/page.tsx` under the StageFrame for **S3, S4, S5, S6/S7** — one integration point covering every opportunity-stage surface, so each downstream stage visibly operates on the S2-decided market.
- `<EntryMarketContextStrip opportunityId>` — inside `NewSynergyForm` when an opportunity is selected, so the standalone `/synergy` page shows the market the fit is judged against.

S8 consumes the market NUMERICALLY (the anchor replacement in `caseInputsBaseForProject`); S9–S12 inherit the S8 outputs. Display-only decision support (boundaries #2/#4): nothing is injected into the synergy score or any gate; no S3 completion criteria change.

### 3.6 Slice 6 — S4 advisory reads S1 through the industry FK (P1, found in re-review)

`lib/track-advisory.ts` resolved the S1 analysis via `i.name_ko = (SELECT market_scope …)` — a fragile string join that silently starves the S4 advisory whenever the opportunity's `market_scope` text drifts from the industry name. Resolved through `a.industry_id = (SELECT industry_id …)` (migration 0126's real FK) with the legacy join kept only as a fallback for FK-null rows.

### 3.7 Slice 7 — the USD→KRW reference rate at the S1→S8 seam (P0, found in re-review; decider question 2026-10-17)

The decider asked how the 기준 환율 is determined, observing that S1 sizes markets in USD while S4+ run in KRW. Verified: **nothing determined one** — the `fx_policy` table (migration 0011) has zero consumers, the drv-fx chain driver is labelled "환율 (미적용)", and a USD-denominated derived entry market flowed into `marketSizeKrwM` as if it were KRW-M (a ~1,400× revenue understatement). Design:

- `lib/fx.ts`: `DEFAULT_FX_RATE_KRW_PER_USD = 1400` (documented deterministic default, always labelled `검증 전` until a person confirms), `resolveFxRate(personRate)` (person-set wins; an out-of-bounds stored value degrades to the default, never applied), `resolveLinkedDeclaredUnitBasis`.
- Person-settable `bc.fx_rate` (원/USD) through the existing bc params store, bounds-validated 100..5000 at the write path (typos rejected with an explicit error).
- Conversion in `caseInputsBaseForProject` ONLY on the derived path when the anchor's unit chain (saved target scope → linked declared scope → `krw_m_year` default) resolves to `usd_m_year`; the legacy bare `market_size_krw_m` column is KRW by name and is NEVER converted; krw/units anchors pass through untouched (bit-identical notes).
- Run-note provenance `; entry_market_fx=<rate> (bc.fx_rate|기본값 — 검증 전)` fires only when a conversion happened; `BusinessCaseParams.fxRate/fxRateSource/fxRateKind` expose the rate + machine-readable provenance for the params read model.

Follow-up (registered, not in this slice): a params-panel chip rendering the rate with its source label beside the anchor.

## 4. Verification

- `bun test` over the entry-market/sizing/target-scope/anchor-scope suites + `process-flow.test.ts`.
- Live smoke: with the dev database, the pilot opportunity's derivation GET now reports the anchor (2,400 KRW-M year-1 … as stored — `matrix.anchor.total = 2.4` in the unit declared by the payload) instead of `anchor_unavailable`; assertion via a route-level unit test with a nested fixture rather than a live server.
- `bun run agent:verify` not required (no roster change); spec-check satisfied by registering this design via `bun scripts/spec-register.ts`.

## 5. Open decisions

None — all five slices follow directly from the decider's direction and the accepted ADR-0179 boundaries. The declared-scope write path (who sets `scope` on future versions) remains ADR-0179 slice 4 scope and is explicitly out of scope here.
