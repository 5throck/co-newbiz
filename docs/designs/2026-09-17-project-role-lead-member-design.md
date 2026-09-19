---
lang: ko
lang_reason: source-material
---

# Project Role Simplification — 리더/팀원 2역할

- Spec ID: `2026-09-17-project-role-lead-member`
- Date: 2026-09-17
- Status: implemented

## Problem

프로젝트 추진(PromotionPanel)의 팀원 배정 UI가 `lead(리드) / contributor(기여자) /
reviewer(리뷰어) / observer(참관자)` 4역할을 노출한다. 사용자 지적(2026-09-17):
"기여자, 리뷰어, 참관자는 매우 이상한 분류". 코드 조사로 사실 확인:

- 4값 중 **`lead`만 권한 분기가 존재**했다 — 프로젝트 삭제(`isLead`,
  project.repository)와 종료·보관(close route). `contributor / reviewer /
  observer`는 저장·검증만 되고 어느 경로에서도 차등이 없었다. 쓰기 경로
  (permits, incentives, business-case 등)는 전부 멤버십만 검사.
- 즉 분류는 **구현되지 않은 권한 차이를 약속하는 라벨**이었다. 특히
  flow.spec S11의 "사람 최종 승인(reviewer 기록)"은 게이트 권한 개념인데
  `project_role='reviewer'`와 연결된 코드는 없었다.
- 근본 원인: need-to-know 접근 모델(ADR-0038/39/40, FR-SEC-01)에서 실제로
  중요한 축은 ①접근 등급(membership=MNPI급 열람)과 ②게이트 결정 권한(경계 #2)
  인데, 일반 협업 도구 어휘(기여/검토/참관)를 멤버십 티어로 붙여 두 축 어디에도
  대응하지 않았다.

## Decision (사용자 결정, 2026-09-17)

**리더/팀원 2역할로 축소한다.** 구현된 권한 차이(lead의 관리 권한)와
분류를 일치시키는 것이 목적이며, 세분화가 필요해지면 그때 자체 축으로
새로 모델링한다.

- 스키마: `project_member.project_role` CHECK를 `('lead','member')`로 축소
  (migration 0110 — 테이블 리빌드, 기존 contributor/reviewer/observer 행은
  전부 `member`로 매핑). project_member를 참조하는 자식 테이블은 없으므로
  러너 기본 트랜잭션 안에서 안전하다.
- 타입·API: `ProjectRole = "lead" | "member"`(access-control), promote
  라우트의 ROLES 검증과 payload 타입 동기화.
- UI: PromotionPanel의 역할 select 제거 — 추가 팀원은 항상 `member`(팀원)이고
  리더는 추진자 본인뿐이라 선택지 자체가 사라진다. 배정 카드에 역할 의미를
  명시한다(팀원=열람·작성, 리더=관리 권한 추가).

## Trade-offs accepted

- 미구현 티어를 제거하는 대신, 향후 "게이트 결정 권한을 일부 멤버에게만"
  필요해지면 새 축(gate authority)으로 모델링해야 한다 — role 값을 되살리는
  길은 닫았다(CHECK 축소).
- 기존 데이터에서 contributor/reviewer/observer의 원 구분은 이관 시 소실된다
  (애초 구분이 행동 차이를 만든 적이 없으므로 정보 손실이 아니다).

## Verification

- `bun db/migrate.ts` 적용 후 `PRAGMA`/샘플 질의로 CHECK 축소·값 매핑 확인.
- `bunx tsc --noEmit` 클린, `bun run lint:design` 통과.
- 단위 테스트: 17개 파일의 project_member fixture 역할 값을 `member`로 갱신,
  project-promotion.test.ts의 역할 어설션 갱신 후 전체 unit 스위트 회귀 확인.
- 서버 컴파일(brownfield/opportunities 라우트 200) 확인.
