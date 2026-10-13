---
governance_doc_id: tpl-ic-memo
layer: template
title: "투자심사위원회 메모 템플릿"
scope: shared
enforceability: recommended
owner_agent: docs-writer
version: "1.1.0"
effective_from: "2026-08-20"
lang: ko
lang_reason: source-material
counterpart: ic-memo-template.md
---

<!--
  This is a TEMPLATE. Deliverables produced from it are Korean-language
  (design section 3, language policy) — this file itself stays English per
  CLAUDE.md §4, since templates/ is code-adjacent tooling, not a deliverable.
  Every field in [brackets] is populated at run time from the assumption
  registry / run record; do not hand-type a number here that isn't backed
  by an assumption_key or dd_finding.
-->

# [프로젝트명] — 투자심사위원회 메모

**Run ID**: [run_id] · **기준 시점**: [as_of] · **버전**: [document.version] · **정책 버전**: [project_policy_pin]

## 1. 요약 (Executive Summary)
[2-3문장: 딜 유형(GF/BF), 투자 논리(thesis), 권고안]

## 2. RAG 평가

| 평가 축 | 등급 | 근거 |
|---|---|---|
| 재무 | [grade] | [근거 — 등급을 단순 재진술하지 말고 발동된 규칙을 인용할 것] |
| 시장 | [grade] | [근거] |
| 데이터 신뢰도 | [grade] | [근거 — 프록시 체인 사용 시 체인 신뢰도 등급] |
| 규제/허가 | [grade] | [근거] |
| 기술/실행 | [grade] | [근거] |
| 리스크 | [grade] | [근거] |
| **종합** | **[grade]** | [발동된 규칙 — 하나라도 Red면 Red, 전부 Green일 때만 Green, 그 외 Amber] |

## 3. 재무 요약
NPV / IRR / Payback / DSCR — `run_output`([run_id])에서 가져옴. 시뮬레이션 실행 시 시나리오 비교 표 포함(seed: [seed]).

## 4. 데이터 신뢰도 및 방법론
프록시 체인을 사용한 경우: 체인, 신뢰도 등급, 그리고 **등급을 높일 수 있는 증거가 무엇인지**(설계의 actionable-confidence-dimension 규칙에 따라 — 단순히 "B 등급"이 아니라 "무엇이 A로 만드는가"를 제시).

## 5. 실사(Due Diligence) 조사 결과
`value_impact`와 연결된 `assumption_key`를 갖는 `dd_finding` 레코드 표. 서술 전용(narrative-only) 조사 결과는 허용되지 않음.

## 6. 딜 구조 및 파이낸싱 (S10 산출물 — ADR-0106)
수단(Vehicle): [direct / SPC / holdco / internal-venture spinoff / JV] · 형태: [asset / stock / mixed] · 지분: [type] · 상품 믹스: [primary / secondary / mixed]
4축 검토(네 축 모두 완료, 아티팩트 참조 필수): 세무 구조 — [note]; 책임 분리 — [note]; 파이낸싱 레버리지 — [note]; 엑시트 구조 — [note]. 아티팩트 참조: [deal_structure_review ref]
파이낸싱 계획(조달 및 사용): 조달 [total] = 사용 [total] 백만 원, 균형 확인 [yes]; 자금 확실성 증거: [commitment papers / internal approvals referenced]

## 7. M&A 특수 검토 항목 (Brown Field 전용)
Antitrust / 고객 유지 / 인센티브 / HR 통합 / 인증 이전 / 지역 노동 — 여섯 항목 모두의 상태를, 회의 M5가 고정한 평가 순서(인증은 마지막)에 따라 기재.

## 8. Kill Criteria 점검
이 게이트에 적용 가능한 모든 Kill Criteria 조건에 대한 명시적 pass/fail 판정.

## 9. 권고
[인간 검토자의 권고 — 이 섹션은 절대 자동 생성되지 않음; §2의 종합 등급은 *제안*이며, 이 섹션에서 인간이 이를 확정하거나 수정 사유와 함께 정정함.]

## 10. 검토자 서명
| 단계 | 검토자 | 날짜 | 결과 |
|---|---|---|---|
| AI 1차 (형식) | [agent_key] | [date] | [verified / could-not-verify 목록] |
| AI 2차 (교차 도메인) | [agent_key, 다른 도메인] | [date] | [verified / could-not-verify 목록] |
| 인간 최종 | [reviewer name] | [date] | [approved / rejected / conditional] |

---
*`templates/deliverables/ic-memo-template.md` v1.0.0에서 생성됨. 이 문서에 사용된 용어집 용어는 부록에 나열됨(자동 생성, 설계 섹션 7.3).*
