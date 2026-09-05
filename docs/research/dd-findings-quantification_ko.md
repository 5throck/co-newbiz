---
lang: ko
lang_reason: source-material
counterpart: dd-findings-quantification.md
---

# 리서치 노트 — 실사 발견사항의 정량화(QoE·가격조정) 표준 관행

> **언어**: [English](dd-findings-quantification.md) · **한국어**

> 🌐 외부 참고 자료. 조사일: 2026-09-05. dd_finding.value_impact 필수화 원칙의 업계 관행 비교용.

## 표준 관행

1. **정상화 EBITDA가 가격을 결정**: 매도자가 보고한 EBITDA가 아니라 QoE(Quality of Earnings)로
   조정된 EBITDA에 배수를 곱한 값이 최종 가격이다 — QoE는 매수측 재무실사 노력의 약 30%를 차지하는
   최대 워크스트림 (Anders, CT Acquisitions)
2. **조정 메커니즘은 기계적**: 보고 EBITDA를 감사/은행 장부와 라인별 대사 → 일회성·비반복 항목
   (소송합의금, 구조조정비용, 오너 개인비용) 식별 → 최근 인수·매각에 대한 pro-forma 조정
3. **가격 영향은 구체적 숫자로 이어진다**: 예) 조정 전 EBITDA 250만 달러 기준 7배 = 1,750만 달러
   제안가였으나, QoE 결과 EBITDA가 200만 달러로 조정되면 배수를 유지해도 1,400만 달러로
   재협상된다 — "환산 불가능한 발견은 사유를 기재"가 아니라 원칙적으로 모든 발견은 환산을 시도해야
   하는 이유가 여기 있다
4. **부채성 항목은 배수와 별개로 차감**: 부채·부채성 항목(debt-like items)은 EBITDA 배수 효과와
   무관하게 가격에서 달러 대 달러로 차감된다 — "발견 → 시나리오 반영"이 단순 배수 곱셈이 아니라
   항목 성격별로 다른 경로를 탈 수 있음을 시사
5. **양방향 검증이 2026년 관행**: EBITDA 500만 달러 이상 딜에서는 매도자 sell-side QoE와 매수자
   confirmatory QoE를 각각 수행해 10~15% 이내로 수렴하는지 확인 — 괴리가 크면 그 자체가 협상 대상

## co-newbiz 매핑

- `dd_finding.value_impact`(KRW 백만원, ADR-0061)를 필수화하는 원칙은 QoE의 "발견 → 숫자" 원칙과
  동일 계열. "환산 불가능 사유 기재"는 예외 처리이지 기본값이 아님을 이 리서치가 뒷받침한다.
- S8 채택 Business Case 시나리오(하방/base/상방) 반영은 QoE의 pro-forma 조정과 유사한 메커니즘.

## 출처

- Anders CPA, "Quality of Earnings (QoE) Report: What It Is (and Why It Matters in M&A)" — https://anderscpa.com/learn/blog/quality-of-earnings-report-analysis-due-diligence-guide/ (접근일 2026-09-05)
- CT Acquisitions, "Financial Due Diligence: QoE, EBITDA, Working Capital" — https://ctacquisitions.com/financial-due-diligence-business-sale-2026/ (접근일 2026-09-05)
- CT Acquisitions, "Quality of Earnings (QoE) Report: 2026 Guide" — https://ctacquisitions.com/quality-of-earnings/ (접근일 2026-09-05)
- Melcap, "How to Determine Quality of Earnings When Buying or Selling a Business" — https://melcap.com/news-and-insight/articles/determine-quality-earnings/ (접근일 2026-09-05)
