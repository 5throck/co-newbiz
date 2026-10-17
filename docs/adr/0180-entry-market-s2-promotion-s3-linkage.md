---
lang: ko
lang_reason: proper-noun
---

# ADR-0180 - Entry-market S2 promotion: payload-shape compatibility, spec-level S2 activity, S3 linkage

- Status: Accepted (2026-10-17)
- Date: 2026-10-17
- Decider: human decider (chat 2026-10-17 — directed that 진입시장 산정 be treated in S2 at the same level as the 기회/위험 요인 and 비즈니스 모델 검토 reviews, derived from the S1 analysis via region split and ratios into refined target segments and linked into S3, and that the whole entry-market implementation be re-reviewed because it does not actually work; "실행계획을 수립한 뒤 구현을 진행해줘"). Drafted by platform-lead.
- Design-of-record: [docs/designs/2026-10-17-entry-market-s2-promotion-s3-linkage-design.md](../designs/2026-10-17-entry-market-s2-promotion-s3-linkage-design.md)
- Related: ADR-0179 (and its 2026-10-17 amendment + presentational-redesign note E), ADR-0074 (flow.spec.yaml SSOT), non-negotiables #2 (human decisions) and #4 (data confidence caps the RAG grade)

## Context (verified in code and live data, 2026-10-17)

The ADR-0179 amendment slices A/B and the entry-market flow redesign slices 1-4 are implemented and unit-green, but none of the anchor-reading code reads the payload shape the S1 pipeline actually writes. `market-sizing-pipeline.ts` persists `{methodology, matrix: {anchor, regions, …}, stepSummaries}`; every reader (`readS1AnchorYear1`, the draft route's `readLinkedDraftContext`, the sizing-link reference read, `extractSizingVersionScope`) reads the top-level `{anchor, regions, scope}` shape. All 12 `market_sizing_version` rows in `db/data/co-newbiz.sqlite` carry the nested shape; none declares a `scope`. Result: on real data the derivation card computes no anchor, `AI 배수 추천` 409s with `anchor_unavailable`, the reference strip shows nothing, `resolveDerivedEntryMarket` is always null and the S8 anchor stays the legacy bare value — the pilot opportunity (유압식 브레이커 — 유럽 Stage V) exhibits every symptom. Test fixtures use the top-level shape, so the suite is green while the feature is inert. Separately, the draft-endpoint test makes a live LLM call when `.env` carries an API key (6.3 s measured) and fails the 5 s suite timeout. And `process/flow.spec.yaml` S2 declares no entry-market-sizing activity, artifact, or S3 input — the UI card has no process-spec existence.

## Decision

1. **Read-side payload-shape compatibility (no data rewrite).** A shared `lib/sizing-payload.ts` reads `anchor.total`, declared `scope`, and `regions` from EITHER the top-level shape or the nested `matrix.*` shape, tolerantly, in one place; all four readers delegate to it. Stored payloads are never rewritten (old versions stay untouched per the ADR-0179 amendment). Tests gain nested-shape fixtures mirroring the real pipeline output; existing top-level fixtures stay (backward compatibility proof).
2. **Hermetic draft tests.** The entry-market-derivation draft tests stub `isLlmConfigured`/`completeDetailed`; no test touches the network or consumes `.env` LLM keys.
3. **S2 promotion in the process SSOT.** `flow.spec.yaml` v2.9.0 (additive): S2 gains the `entry-market-sizing` activity (market-intelligence-agent, systematic-market-sizing), the output `진입시장 산정 (기회별 — S1 링크·대상 범위·배율 도출 사슬)`, the required artifact `진입시장 산정 (S1 링크·대상 범위·도출 사슬)`, and the completion criterion `최소 1개 기회에 S1 시장규모 버전이 연결되고 대상 범위가 기록되었다`. The derivation stays decision support — an unset chain displays honestly and never blocks a gate (boundary #4); the criterion records that the surface was used, not that a number was produced.
4. **S2 page parity.** 진입시장 산정 becomes the third tab of the opportunity page (`factors | sketch | entry`), a peer of the other two reviews; the card's internal stacked 3-step layout is unchanged (the 2026-10-17 stacked decision governs the card interior, not the page placement).
5. **S3–S7 linkage, display-only.** S3 `inputs` gains `진입시장 산정 (S2 — 지역·세그먼트 도출 시장)`. A read-only `EntryMarketContextStrip` (derived value with unit, factor product, step count, scope verdict — or the honest unset state) mounts in the deals stage shell for S3, S4, S5, S6/S7 (via the deal's source-opportunity resolver) and beside the opportunity selector of the new-synergy form. S8 consumes the market numerically through the anchor replacement; S9–S12 inherit the S8 outputs. Nothing is injected into the synergy score; no gate logic changes; boundaries #2/#4 unchanged.
6. **S4 advisory reads S1 through the industry FK.** The track-advisory market signal resolves the S1 analysis via `industry_id` (migration 0126's real FK) instead of the `market_scope`-text join, keeping the string join only as an FK-null fallback — the text join silently starved the advisory whenever names drifted.
7. **The USD→KRW reference rate (decider question, 2026-10-17).** Nothing determined a rate before this ADR: `fx_policy` (migration 0011) had zero consumers and a USD-denominated derived entry market was consumed as KRW-M. Now: `bc.fx_rate` (원/USD) is a person-settable bc assumption, bounds-validated 100..5000 at write; absent it, a DOCUMENTED default (1,400, labelled `검증 전`) applies and is labelled unsourced wherever it renders (ADR-0179 sourcing discipline). Conversion fires ONLY on the derived path when the anchor's declared unit chain resolves to `usd_m_year`; the legacy `market_size_krw_m` column is never converted; krw/units anchors are bit-identical. Run-note `; entry_market_fx=<rate> (<source>)` fires only when a conversion happened. A params-panel chip rendering the rate is a registered follow-up.
8. **Human ownership unchanged.** The S1 link, target scope, factor chain, and the reference rate remain person-set (analyst+; human-only writes for link/scope/chain); AI proposes in text only; the derived market caps nothing and blocks nothing.

## Consequences

- Every ADR-0179 surface starts working on the data that actually exists: the derivation card computes, the AI draft can propose, the reference strip populates, and a saved chain reaches S8 with run-note provenance.
- Scope compatibility stays `unknown` for all current versions until a person-scoped sizing exists (ADR-0179 slice 4 remains unimplemented and out of scope here) — but `unknown` is now the honest state, not a masking artifact of the shape bug.
- S2 stage completion now references the entry-market surface; pre-existing opportunities without a link will show the honest 미연결 state on the checklist until a person links one.
- The spec generators' outputs (`docs/process-flow.md`, generated spec activities) are regenerated; `process-flow.test.ts` guards integrity.
- USD-declared anchors now produce KRW-scale case inputs: stored legacy generations are NOT recomputed (nothing rewrites stored rows), but the next generation of a USD-anchored opportunity changes its numbers by design — the fix converts what was previously misread.

## Acceptance record

- Approver: the human decider (user, account techcross), chat 2026-10-17: the three requirements quoted in the header were stated as directions and closed with "실행계획을 수립한 뒤 구현을 진행해줘"; the two mid-implementation questions ("S3~S12까지 해당 시장을 대상으로 진행되고 있을까?", "기준 환율을 어떻게 정하는지 궁금해") directed slices 5-7. Basis: chat direction; this record does not claim an item-by-item review of the written ADR.
- Implementation status (2026-10-17): IMPLEMENTED in code — slices 1-7 as specified in the design; unit suites green including the nested-shape, hermetic-draft, fx-conversion and S2-predicate tests; typecheck baseline unchanged (40 pre-existing errors, 0 new); not browser-verified (no live-server pass in this session; the route-level nested fixtures stand in for the live smoke).

## Honest limits

Read-side tolerance means a payload carrying conflicting top-level and nested anchors would silently prefer the top-level one; no such payload exists (0 of 12 rows carry a top-level anchor) and the pipeline never writes one. The completion criterion is checked by humans at the gate, not enforced by machinery. Whether the AI draft produces a well-sourced chain on the pilot opportunity depends on the live model and is not asserted by any test.
