---
lang: ko
lang_reason: source-material
counterpart: human-in-the-loop-ui.md
---

# 리서치 노트 — Human-in-the-Loop UI 표준 관행

> **언어**: [English](human-in-the-loop-ui.md) · **한국어**

> 🌐 외부 참고 자료. 조사일: 2026-09-05. "엔진 권고 ≠ 채택"(경계 #2) 원칙의 업계 관행 비교용.

## 표준 관행

1. **HITL의 정의**: 인간이 결정을 내리고 AI는 권고만 제공하는 모델 — AI가 실행까지 하고 인간은
   사후 감사만 하는 human-on-the-loop(HOTL)과 구조적으로 다르다. AI는 지능을, 인간은 승인 권한을
   제공한다
2. **표준 워크플로**: AI가 권고/초안 생성 → 워크플로가 지정된 검토자에게 라우팅되며 **일시정지** →
   인간이 검토/승인/수정/거부 → 그 결정에 따라 재개 — 중간 단계에서 아무것도 실행되지 않는다
3. **흔한 실패 패턴**: automation bias(틀려도 AI 권고를 신뢰), complacency(시스템이 다 알아서
   한다고 가정해 경계 저하), 과도한 에스컬레이션(저위험·정형 케이스까지 인간에게 넘겨 검토자를
   압도 — 압도되면 제대로 검토하지 않고 그냥 승인하게 됨)
4. **언제 인간을 개입시킬지 판단 기준**: 되돌릴 수 없는 행동(파일 삭제·이메일 발송)은 항상 승인
   필요, 외부 시스템·타인에게 영향을 주는 행동은 더 높은 주의, confidence가 낮으면 명확화 요청,
   비용이 큰 행동은 승인 필요
5. **경고할 만한 연구 결과**: 한 연구에서 참여자의 66%가 동등하게 정확한 인간보다 알고리즘에
   결정을 위임하는 것을 선호했고, 모니터링·조정이 가능할 때 이 선호는 더 커졌다 — 그러나
   참여자들은 정확도가 가장 낮은 권고일수록 오히려 개입을 덜 했다. 즉 HITL 설계를 넣는 것만으로
   자동으로 결과가 좋아지지 않으며, **과신을 적극적으로 방지하는 UI 설계**가 필요하다

## co-newbiz 매핑

- "엔진 권고 ≠ 채택" 원칙(경계 #2)은 HITL의 핵심 정의("AI는 권고, 인간은 결정")와 정확히 일치.
  GateDecisionPanel이 AI 제안과 시각적으로 분리되어야 한다는 규칙은 "과신 방지 UI"의 구체 구현.
- Kill Criteria가 "어느 단일 reviewer도 일방적으로 면제할 수 없다"는 규칙은 되돌릴 수 없는 행동에는
  항상 인간 승인이 필요하다는 HITL 판단 기준과 동일 원리.
- 향후 화면 설계 시 "저위험 항목까지 게이트 결정 카드로 에스컬레이션하지 않는다"는 원칙을
  명시적으로 검토할 필요 — 과도한 에스컬레이션은 검토 품질을 오히려 떨어뜨린다는 연구 결과가 있음.

## 출처

- Redis, "AI Human in the Loop: Production Oversight Patterns" — https://redis.io/blog/ai-human-in-the-loop/ (접근일 2026-09-05)
- Zapier, "Human-in-the-loop in AI workflows: Meaning and patterns" — https://zapier.com/blog/human-in-the-loop/ (접근일 2026-09-05)
- Elementum, "Human-in-the-Loop vs Human-on-the-Loop: Enterprise Guide" — https://www.elementum.ai/blog/human-in-the-loop-vs-human-on-the-loop (접근일 2026-09-05)
- NCBI, "Putting a human in the loop: Increasing uptake, but decreasing accuracy of automated decision-making" — https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10857587/ (접근일 2026-09-05)
