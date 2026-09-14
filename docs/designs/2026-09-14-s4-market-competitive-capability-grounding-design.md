# Design: S4 decision grounded in market, competitive, and capability evidence

- Date: 2026-09-14
- Status: implemented
- Related: flow.spec v2.4.0, ADR-0052/0104 (5criteria + track advisory), ADR-0053/0097 (human gate boundary), ADR-0094 (S3/S4 lifecycle)

## Problem

User requirement: the greenfield/brownfield decision (S4) must be made AFTER — and ON THE BASIS OF — target market selection, competitive trend analysis, and a market-requirements × group/affiliate capability gap analysis. The pipeline's stage ORDER already matched (S1 → S2 → S3 → S4), but three things broke the chain:

1. S4's declared `inputs` were only `시너지·적합성 평가` — the S1 outputs it implicitly consumed were undeclared, and S1 never REQUIRED a competitive structure artifact, so the market/competitive evidence could be absent at decision time.
2. The deterministic track advisory (ADR-0104) voted on market growth (CAGR), shortlist existence, and synergy score — ignoring competitive structure and capability evidence entirely. As the always-available fallback, its rationale trail was one-sided (high growth ⇒ greenfield, even in a locked-up oligopoly).
3. Nothing on the S4 surface rendered the evidence: the decider saw market size/CAGR but had to navigate to the S1 report for the competitive structure, and no requirements-vs-capabilities gap analysis existed anywhere (the `S1/S3 도출 필요 역량 목록` referenced by S5/S6 inputs and chk-target-screening t-05 was a dangling reference).

## Approach

### Spec (flow.spec v2.3.0 → v2.4.0)

- S1: `경쟁 구조` added to outputs and requiredArtifacts; completionCriteria gains `최신 완료 버전의 매트릭스에 경쟁 구조(집중도 요약·주요 플레이어)가 기록되었다`.
- S3: outputs gain `필요 역량 목록` and `역량 갭 분석 (그룹/계열사 보유 역량 대비; 내부(자사 단독) 역량 평가는 후속 보강)`.
- S4: inputs now declare `역량 갭 분석 (S3)` + `시장 규모·성장 추정 (S1)` + `경쟁 구조 (S1)` + `가치사슬 구조 (S1)`.
- Enforcement is SOFT by design: the S1 completion predicate (`process-flow.ts`) pushes an advisory blocker `S1 경쟁 구조 미기록 — 재분석 보강 권장` when the latest completed version lacks `matrix.competitive`, without flipping stage completion — 7 of 14 live completed analyses predate the competitive artifact (incl. `휴머노이드 로봇` v5), and a hard block would freeze them all.
- Sync edits (test-enforced): `process-flow.ts` S1 requiredArtifacts byte-identical, `spec-activities.generated.ts` SPEC_VERSION 2.4.0, `docs/process-flow.md` regenerated, `stage-handoff.ts` S4 strip updated.

### Capability-gap register (new)

- Migration 0098: `opportunity.capability_gap_json` (nullable JSON). Resolution vocabulary `build|partner|hire|invest` matches S5's `capability_gaps_json` (0056) so the register hands off to S5.
- `lib/capability-gap.ts`: pure types + `normalizeGapRows` + `summarizeGap` (coverage = (met + 0.5·partial)/evaluated over judged rows).
- `GET/PUT /api/opportunities/{id}/capability-gap`: GET returns stored rows or an in-memory seed from the S2 sketch's legacy `requiredCapabilities`; PUT is the human save (audited `capability_gap.save`).
- `POST /api/opportunities/{id}/capability-gap/llm-draft`: drafts a held-status per row from group/affiliate profile evidence (strengths·industryExposure) — proposal only, saving stays human (boundary #2). Scope prefers the opportunity's latest synergy-analysis target, falling back to the whole registry. Without an LLM it returns rows unchanged (never fabricates levels).
- Editor: `opportunities/[id]` gains a `역량 갭` tab (status select, holders, evidence, resolution hint, add/remove, LLM draft, save). Every surface carries the caveat `내부(자사 단독) 역량 평가는 추후 보강 — 현재 근거는 그룹/계열사 프로필 기준`.

### Track advisory signals (ADR-0104 extension)

- `competitive_structure` (same payload as the growth signal, no extra query): `독점/과점/독과점` keyword or leader-ratio ≥ 0.5 with ≥ 2 players → brownfield ×2; fragmented → neutral info; recorded-but-unclassified → neutral info; missing → neutral info. Deliberately one-sided: fragmentation must not cancel growth the way concentration can.
- `capability_coverage`: coverage ≥ 70% → greenfield ×2 (`요구 역량 대부분 그룹 보유`); ≤ 40% → brownfield ×2 (`보유자 결합 유리`); middle → neutral; register absent or all-unevaluated → neutral info. All notes state the group/affiliate basis and the pending internal assessment.
- Re-review trigger: completed S1 analysis without a competitive record.
- `adr-0104.test.ts` fixtures unaffected (neutral signals add no weighted votes) — full unit suite green.

### S4 surface + gate briefs

- `GET route-advisory` now also returns `s1Evidence` (industry, version, market size, CAGR, competitive structure + top players) and `capabilityGap` summary (counts, coverage, unmet rows).
- `RouteDecisionStage` decision tab: a `시장·경쟁·역량 근거` card — advisory recommendation + per-signal rationale trail (GF/BF/`중립` chips), re-review triggers, expandable competitive structure table (tier chips reusing the S1 report presentation), capability-gap summary, and empty states linking to the S1 report / opportunity gap tab.
- `gate-brief.ts`: `s1Summary()` gains a competitive line (structure + leader count); a new `S3 역량 갭 요약` block feeds both `screening` and `pre_fs` gate briefs (the S4 committee panel uses `pre_fs`); manifests updated so the LLM field of view stays auditable.

## Verification

- `bunx tsc --noEmit` (app/web-next) clean; `bun run test:unit` all 102 files pass (process-flow parity, spec-activities, adr-0104, docs `--check`, openapi drift — `capability-gap`/`llm-draft`/`rerank` routes documented).
- Migration 0098 verified applied through `runMigrations()` on the live dev DB (tracked in `schema_migrations`), column present.
- Manual: fuel-cell opportunity (has competitive) renders the structure table and a concentrated-market brownfield vote; humanoid-robot opportunity (no competitive) renders the soft blocker + empty state with report link; gap tab edits propagate to the S4 summary after save.
