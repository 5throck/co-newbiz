---
lang: ko
lang_reason: source-material
---

# ADR-0138 — S5 투자비 검토 요건에 정부 R&D 카테고리·기간 구분·기준 통화 추가

- Date: 2026-09-15
- Status: accepted (implemented same day)

## Context

ADR-0137로 S5 "투자비 검토 요건"이 승격 시 S8 `business_case_line`으로
자동 이관되게 됐다. 사용자가 이 항목에 세 가지를 더 요청했다: (1) 카테고리에
"정부 R&D" 추가, (2) 금액이 월/분기/년 반복인지 일시불(총액)인지 구분, (3)
기준 통화(원화/달러/유로/엔화/위안) 태그.

조사 결과 세 요구사항의 난이도가 서로 다르다는 게 드러났다:
- `business_case_line.category`는 DB `CHECK` 제약이라 5번째 값 추가는
  스키마 마이그레이션이 필요하고, 검증 화이트리스트가 3곳(승격 트랜잭션,
  S8 CRUD API, TS 유니온 타입)에 흩어져 있어 하나라도 빠지면 조용히
  걸러지거나 거부된다.
- S8의 실제 DCF/NPV 엔진(`business-case-generator.ts`)은 `business_case_line`
  을 전혀 읽지 않는 별개의 합성 모델이다 — "일시불" 구분을 스키마에 반영해도
  당장 밸류에이션 계산에는 영향이 없다.
- 이 저장소에는 FX 환율 변환 엔진이 전혀 없다(`md_currency`는 ISO 코드
  참조용 테이블일 뿐). 사용자 확인: 실제 환율 변환은 S8 사업성 분석 단계의
  후속 과제이며, 이번 변경은 통화를 기록만 하고 환산하지 않는다.

## Decision

1. **정부 R&D 카테고리**: 마이그레이션 0102로 `business_case_line.category`
   CHECK에 `gov_rnd` 추가(0049 방식 테이블 재생성). 승격 트랜잭션
   (`project.repository.ts`)과 S8 CRUD API(`business-case/route.ts`)의
   화이트리스트, S5 TS 유니온 타입·라벨 맵을 함께 갱신한다. 마진 계산
   (`business-targets.ts`)에서는 `gov_rnd`를 capex와 동일하게 매출·영업비용
   합산에서 제외한다 — 정부 지원금은 핵심 상업 매출이 아니다(ADR-0114의
   capex 제외 논리를 그대로 적용).
2. **기간 구분**: S5의 `BcLine`에 `period: monthly|quarterly|yearly|lumpsum`
   추가(기본 `yearly`). `business_case_line` 스키마는 바꾸지 않는다 — 승격
   시점에 monthly→×12, quarterly→×4로 정규화해 기존 `annual_amount_krw_m`
   (연간 반복 전제) 컬럼에 그대로 담는다. `lumpsum`은 `growth_rate=0`으로
   저장하되 `note`에 "일시불 총액 — 연반복 아님"을 명시해, DCF 엔진이 아직
   이 테이블을 소비하지 않는 현재 상태에서도 사람이 S8에서 오독하지 않게
   한다.
3. **기준 통화**: S5의 `BcLine`에 `currency: KRW|USD|EUR|JPY|CNY` 추가(기본
   `KRW`, `md_currency.iso_code` 관례를 따라 ISO 4217 코드 — 한글 라벨
   문자열을 값으로 쓰지 않는다). 승격 시 `currency !== KRW`이면 금액을
   변환 없이 그대로 옮기고 `note`에 "원문 통화: USD — 환율 미반영, S8에서
   환산 필요"를 덧붙인다. 환율 조회·변환 로직은 만들지 않는다.

## Alternatives considered

- **`business_case_line`에 `end_year`/`currency` 컬럼을 직접 추가** — 기각(이번
  범위). DCF 엔진이 아직 이 테이블을 읽지 않아 당장 효과가 없고, S8-DCF
  연결이라는 더 큰 과제의 선행 작업이 되어야 한다.
- **FX 변환 엔진 구축** — 기각. 환율 소스·갱신 주기 결정이 필요한 별도
  과제이며, 사용자가 S8 사업성 분석 단계로 명시적으로 미뤘다.

## Consequences

- S5에서 월/분기 단위로 입력해도 S8에는 항상 연간 환산 금액이 들어간다 —
  이중 입력·환산 오류 위험이 줄어든다.
- 비KRW 통화·일시불 항목은 S8에서 note를 읽어야 정확한 맥락을 알 수 있다 —
  구조화된 필드가 아니라 텍스트 플래그라는 한계가 있다(향후 DCF 연결 시
  구조화 필요).
- S8-DCF 엔진과 `business_case_line`을 실제로 연결하는 과제(현재 두 모델이
  분리되어 있다는 사실 자체)는 이번 ADR이 다루지 않는다 — 별도 후속 과제.

## Related

ADR-0137 (S5→S8 투자비 이관), ADR-0114 (capex를 마진 계산에서 제외).
