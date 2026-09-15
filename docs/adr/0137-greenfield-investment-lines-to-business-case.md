---
lang: ko
lang_reason: source-material
---

# ADR-0137 — S5 투자비 검토 요건을 S8 사업성 분석 라인으로 승계

- Date: 2026-09-15
- Status: accepted (implemented same day)

## Context

Greenfield S5("자체 진출")는 이미 "투자비 검토 요건"(`greenfield_assessment.
business_case_lines_json` — 항목명/비용·수익 구분/금액/비고)을 입력받고 있었고,
UI 헤더 자체가 "S8 사업성 분석 입력"이라고 명시하고 있었다. 그런데 실제로는
S8의 사업성 분석 테이블(`business_case_model`/`business_case_line`, project
단위)이 이 데이터를 전혀 읽지 않았다 — S5에서 입력한 내용이 프로젝트로 추진된
뒤 그대로 버려지고, S8은 매번 처음부터 다시 입력해야 했다. 사용자가 "S4→S5/
S4→S6/S7의 데이터 정합성"을 지적하면서 함께 짚은 문제다.

또한 S5의 "비용/수익"(cost/revenue) 2분류는 S8의 `business_case_line.category`
(labor/opex/capex/revenue) 4분류보다 거칠어서, 그대로 옮기면 인건비·설비
투자를 구분할 수 없었다.

## Decision

1. **S5의 항목 분류를 S8과 동일한 4종 vocabulary로 맞춘다**: `BcLine.kind:
   "cost"|"revenue"` → `BcLine.category: "labor"|"opex"|"capex"|"revenue"`.
   `greenfield_assessment.business_case_lines_json`은 그대로(컬럼 변경 없음,
   JSON 내부 필드만 확장) — 추가 마이그레이션 불필요.
2. **승격(추진) 시점에 자동 이관한다.** `promoteOpportunity()`
   (`db/repositories/project.repository.ts`)가 greenfield 트랙이고
   `business_case_lines_json`에 항목이 있으면, 프로젝트 생성과 같은 트랜잭션
   안에서 `business_case_model`(kind: `greenfield_cost`, name: "S5 투자비 검토
   요건 (자동 이관)") 1건 + 각 항목을 `business_case_line`으로 삽입한다.
   금액 단위 변환: S5는 억원 단위 입력 → `annual_amount_krw_m`(백만원)로
   ×100 환산.
3. **수동 편집 경로는 그대로 둔다.** S8의 기존 CRUD(`/api/projects/[id]/
   business-case`)는 손대지 않는다 — 이관된 모델도 똑같이 수정·삭제 가능한
   평범한 business_case_model 행일 뿐이다.
4. **LLM 투자비 항목 추천도 같은 vocabulary로 전환** — 기존엔 cost/revenue만
   제안했는데, 이제 labor/opex/capex/revenue 중 하나로 제안한다(금액은 여전히
   지어내지 않는다 — 경계 #2 불변).

## Alternatives considered

- **S8에서 S5 데이터를 즉석 조회** — 기각. 승격 이후 S5 화면 자체가 접근
  불가능해지고(오퍼튜니티 캐리어 종결), S8은 project 단위로만 동작하므로 매번
  조인하는 것보다 승격 시점 1회 이관이 이 프로젝트의 "장부 이전" 철학(ADR-0095)
  과 일치한다.
- **cost/revenue 2분류 유지 + S8에서 재분류 요청** — 기각. 사람이 두 번 입력하게
  되는 구조라 정합성 문제가 재발한다.

## Consequences

- S5에서 입력한 투자비 항목은 승격 즉시 S8 사업성 분석 화면에 나타난다(수정
  가능한 일반 business_case_model로).
- S5 화면이 이미 승격된 오퍼튜니티에서는 접근 불가(PromotionPanel 최소 정보
  표시, ADR-0095/이전 세션)이므로 이관은 승격 시점 단 1회만 일어난다.
- 이번 ADR은 S6/S7 브라운필드 재무·기술 평가 레이어(Phase C)나 롱리스트 목표
  수 근거(Phase D)는 다루지 않는다.

## Related

ADR-0136 (S3 역량 갭 레지스터 단일화 — 같은 세션에서 짚힌 S4→S5 정합성 감사의
연장), ADR-0095 (승격은 장부 이전), ADR-0104 (승격 시 차터 자동 구성 — 이번
이관도 동일 시점·동일 트랜잭션 패턴을 따른다).
