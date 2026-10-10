---
lang: ko
lang_reason: source-material
---

# S8 브라운필드 대상별 케이스의 매출 앵커 — 대상 회사 실적 기반 (ADR-0143 정합 수정)

- Date: 2026-10-10
- Status: Implemented (사용자 보고 결함, 2026-10-10 대화)
- ADR: `docs/adr/0143-s8-per-target-feasibility-target-axis.md` (실무 정합)
- Related: ADR-0117 (이중 관점), ADR-0098 (다중 시나리오 생성), design
  2026-09-18-s8-business-case-evaluation (REQ-W1-3 포획률 파라미터),
  design 2026-10-10-s8-per-target-wacc-consumption (같은 소비층 패턴)

## 문제

사용자 보고: "매출액이 몇 백억 원 수준인데 기업가치가 몇 억 원 수준으로
나온다." 실측(휴머노이드 프로젝트 `01M2Y2SM…`): 로보티즈 FY2025 매출
389억·레인보우로보틱스 341억(DART)인데 S8 NPV p50는 3.7억(374 백만 원)
수준 — 대상 실적과 **약 100배** 괴리.

원인은 1차년도 매출 앵커다. ADR-0143의 대상별 케이스가 그린필드용
"신사업 시장 진입" 모델을 그대로 물려받아
`year-1 매출 = 시장규모 × 포획률 0.5%`를 쓴다. 게다가 이 프로젝트의
기회는 `market_size_krw_m`이 NULL이라 문서화된 폴백 50,000 백만 원(500억)
까지 내려가 → year-1 매출 2.5억이 **모든 대상에 동일하게** 적용됐다.
M&A 케이스는 인수 대상의 기존 매출 기반을 할인하는데, 그 규모가 대상
실적과 완전히 무관하니 비교표·권고·킬 크라이테리아 판정 기준이 전부
무의미해진다. 이중 관점(ADR-0117)도 깨진다 — historical 변형은 "과거
실적이 지속되면"이라는 정의인데 레벨이 가상의 2.5억이라 성장률만 다른
동일 가상 사업이 된다.

## 결정

**대상별 케이스의 1차년도 매출 앵커는 대상 회사의 DART 최신 연매출이다.**
시나리오 계수(×1.0/1.2/0.8)는 앵커 위에 그대로 적용되어 시나리오
의미를 보존한다. M&A는 인수 매출 기반을 사들이는 것이므로 이 레벨
앵커가 두 관점(market_forward·historical) 공통의 출발점이 되고, 관점
차이는 설계대로 성장률·변동성에만 둔다.

| 케이스 | year-1 매출 앵커 | 근거 라벨 |
|---|---|---|
| 브라운필드 대상, 회사 매출 계열 ≥1년 | 대상 회사 최신 연매출 (DART) | `revenue_anchor=대상 회사 최신 연매출 YYYY (DART)` |
| 브라운필드 대상, 회사 미연결/계열 없음 | 시장규모 × 포획률 (폴백, 현행) | `capture_rate=…; capture_source=…` |
| 그린필드/프로젝트 레벨 | 시장규모 × 포획률 (현행) | 기존 note 포맷 그대로 |

구현 (app/web-next/lib/business-case-generator.ts):

- `GrowthModel.companyRevenue: { krwM; year } | null` —
  `resolveGrowthModel`이 이미 만드는 DART 분석(ADR-0117)에서 최신
  연매출 포인트만 추가 추출. historical 변형의 CAGR은 ≥2년이 필요하지만
  레벨 앵커는 ≥1년이면 족하다. `deriveFinancialAnalysis`가 계열을
  억원으로 정규화(unit "KRW" → /1e8)하므로 ×100해 KRW-M로 돌린다.
- `CaseInputs.revenueAnchor?: { krwM; source }` — `caseInputsForTarget`만
  설정. `caseInputsForProject`(그린필드/프로젝트 레벨)은 설정하지
  않는다 → 기존 그린필드 숫자·시드는 바이트 단위로 불변.
- `year1RevenueOf(inputs, delta)` 통합 접근자 —
  `runSeededSimulation`·`deterministicCashflows`·`buildS8JobSpec`
  (job-spec `revenue_y1`)·`defaultExecutor`(라인 3행·성장 전망 프롬프트)가
  한 곳에서 해석한다.
- note 근거 스탬프: 앵커 케이스는 `revenue_anchor=…`를, 폴백은 기존
  `capture_rate=…`를 찍는다(REQ-W5-1 재현 계약 유지).

같은 결함의 표기 버전도 함께 수정했다: 실행 로그 프롬프트가 KRW-M
값을 "억원"으로 표기해 100배 과대 표시했다(예: 250 백만 원 → "250.0
억원"). 전부 값/100 억원 환산으로 바로잡았다.

## 거부한 대안

- **인수가격(EV)을 초기투자로 모델링하는 전면 M&A 모델** — 정합적이지만
  control premium·EV 배수·자본구조 가정을 새로 설계해야 하고
  `bc.initial_investment_ratio`(기본 0.5, 파라미터 탭에서 사용자 조정
  가능)가 이미 그 자리를 차지한다. 스케일 결함을 고치는 이번 변경과
  분리한다.
- **market_size 폴백 상향/기회 재입력** — 근본(앵커가 대상 실적과 무관)을
  고치지 못한다. 기회의 `market_size_krw_m` NULL은 별개 데이터 품질
  이슈로 남는다(대상별 케이스는 이제 이 값에 의존하지 않는다).

## 검증

- `tests/unit/business-case-revenue-anchor.test.ts` (신규 4건): 앵커
  해석(최신 연매출·원산지 라벨), 실적 없는 대상의 폴백 보존, 생성 결과
  라인·NPV 스케일(p50 ≥ 1,000억 vs 폴백 < 10억)·note 근거, 그린필드
  경로 불변.
- 기존 business-case 6개 파일 32건 + 전체 유닛 스위트 통과 (그린필드
  회귀 없음).
- 실제 DB 재생성: 로보티즈 base/시장 기반 매출 389.4억 → NPV p05
  476억 / p50 592억 / p95 730억·IRR 65.4%; 레인보우로보틱스 p50 504억.
  대상 비교표·권고(로보티즈 ★)가 실적 스케일을 반영한다.
