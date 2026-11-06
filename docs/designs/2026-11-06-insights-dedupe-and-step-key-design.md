---
lang: ko
lang_reason: source-material
---

# S2 인사이트 산업 중복 제거 및 S3 단계 노트 중복 키 수정 (Insights Dedupe & Step Key)

- Spec ID: `2026-11-06-insights-dedupe-and-step-key`
- Date: 2026-11-06
- Status: implemented
- 관련: 사용자 검증 결함 2건 (S2 duplicate React key `01M6JT4P1GCPHZR20N3N81D5C9`,
  S3 출처·노트 탭 duplicate key "3")

## Problem

### 결함 1 — S2 인사이트에서 같은 산업이 두 번 노출

산업 산업·제조 전력수요 산업(`industry_id 01M6JT4P1GCPHZR20N3N81D5C9`)에
완료된 `market_sizing_analysis` 행이 두 개 존재한다
(analysis `01M6JT4P1GCPHZR20N3N81D5CA` v1 — 구버전, analysis
`01M6KW43X64QH335VW46R0KGPD` v3 — 현재). 가치사슬 연계(linked-analysis)
재분석 흐름이 **이미 분석이 있는 산업에 두 번째 analysis 행을 생성**할 수
있는데, 이때:

1. `app/web-next/app/api/market-overview/insights/route.ts` (~L18-30)의
   질의는 analysis 행 **별** 최신 version만 고르고(`v.version_no =
   MAX(version_no)`), **산업별** 최신 analysis는 고르지 않는다 —
   같은 산업이 `insights` 배열에 두 번 등장한다.
2. 클라이언트
   `app/web-next/components/stages/OpportunityFunnelStage.tsx`는 산업
   드롭다운 옵션을 `key={i.industry_id}`(~L308, ~L581)로 렌더한다 —
   중복 React key 경고 + 드롭다운 옵션/카드 중복 노출 UX.

### 결함 2 — S3 출처·노트 탭 duplicate key "3"

`app/web-next/lib/synergy-pipeline.ts`는 `step: 3` 요약을 **세 번** push한다
(~L244-249 강점/약점 확정(프로파일 재사용 경로), ~L309 재무 강/약점 분석,
~L323 외부 리서치 보강). 소비자인
`app/web-next/components/stages/synergy/SynergyResult.tsx`의 refs 탭이
`<li key={s.step}>`(~L131-133)로 렌더한다 — duplicate key "3".

## Root Causes (검증 완료)

- 결함 1: the insights route query selects the latest VERSION per ANALYSIS
  row, not the latest ANALYSIS per INDUSTRY. 재분석이 analysis 행을 추가로
  만드는 데이터 상태와, analysis-단위 중복 제거만 하는 질의의 조합이 원인.
  드롭다운 키 `industry_id`는 산업별 유일성이 깨진 데이터에서 충돌한다.
- 결함 2: pipeline step 번호는 데이터 의미(단계 진행 표시)를 갖지만,
  `stepSummaries`는 한 단계당 여러 노트를 가질 수 있다. `step` 단독은
  리스트 키로 유일하지 않다.

## Decisions

1. **서버(근본 원인)** — insights 질의에 산업별 최신 완료 analysis 조건을
   추가한다: 기존 max-version JOIN을 유지한 채
   `AND a.id = (SELECT a2.id FROM market_sizing_analysis a2
   WHERE a2.industry_id = a.industry_id AND a2.status = 'completed'
   ORDER BY a2.completed_at DESC, a2.id DESC LIMIT 1)` 를 AND로 붙인다.
   tiebreak는 `completed_at DESC` 후 `id DESC`(ULID — 생성 시점 단조)로
   결정론적이다. **응답 shape은 변경하지 않는다** — 각 산업의 최신 analysis
   한 건만 배열에 남을 뿐이다. 구버전 analysis는 인사이트에서 사라진다
   (해당 산업의 최신 분석이 대표이므로 의도된 동작).
2. **클라이언트(방어선)** — OpportunityFunnelStage.tsx의 두 드롭다운 옵션
   키를 `key={`${i.industry_id}:${i.analysis_id}`}`(value는 `industry_id`
   유지)로 바꾼다. 같은 파일에서 insights 배열을 `key={...industry_id}`로
   렌더하는 다른 지점도 동일하게 경화한다 — 서버 dedupe가 있어도 이후
   데이터가 다시 갈라져도 UI가 깨지지 않게 한다(defense-in-depth).
3. **S3 단계 키** — SynergyResult.tsx의 stepSummaries `<li>` 키를
   `key={`${s.step}-${s.title}`}` 복합키로 바꾼다(`SynergyStepSummary`의
   `title`은 모든 push 지점에 존재하는 안정 필드). **pipeline step 번호는
   재번호 하지 않는다** — step 번호는 데이터 의미(진행 단계 표시)다.
   렌더 텍스트도 변경 없음(표시 전용 수정).

## Affected Files

- `app/web-next/app/api/market-overview/insights/route.ts` — WHERE 절 1줄 추가
- `app/web-next/components/stages/OpportunityFunnelStage.tsx` — key 2(+α) 지점
- `app/web-next/components/stages/synergy/SynergyResult.tsx` — key 1 지점
- `tests/unit/market-overview-insights.test.ts` — 신규 (dedupe 회귀 테스트)

제약 준수: DB migration 없음, API shape 변경 없음, pipeline 재번호 없음.

## Verification Plan

- 신규 유닛 테스트: 한 산업에 완료 analysis 2행(서로 다른 `completed_at`)을
  시드하고 GET `/api/market-overview/insights` → 해당 산업 항목이 정확히
  1개이며 `completed_at`이 더 최신인 analysis(`analysis_id`로 확인)임을
  단언. 별도 산업(analysis 1행)은 영향 없음을 함께 단언. DB 시드 방식은
  `tests/unit/sizing-link-versions.test.ts`의 `next-route-dispatch` +
  `CO_NEWBIZ_DB_PATH` 시임재를 따른다.
- 기존 인사이트/퍼널/시너지 관련 스위트 회귀 확인(grep tests/ for insights,
  OpportunityFunnel, synergy-result 소비 스위트).
- `bun scripts/typecheck-baseline.ts` exit 0.
- `bunx biome check --write` 편집 파일 적용 후 exit 0.
