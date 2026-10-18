---
title: "Synergy 4-element relationship diagram, tab reorder, AI suggestions, capability coverage factor, and review confirmation"
status: implemented
date: 2026-10-18
owner: platform-lead
lang: ko
lang_reason: proper-noun
---

# 시너지 4요소 관계도·탭 재배열·AI 추천·필요 역량 충족도 5팩터·검토 확정

ADR-0182 구현 설계. 디시더 방향: 관계 도식화, 흐름 순서 탭 재배열, AI 추천 부재 해소, 점수 방법론 기술·팩터별 점수 표시, 필요 역량 충족도 5팩터 반영, 3단계 검토 확정 기능.

자세한 내용은 docs/adr/0182-synergy-subject-market-and-capability-factor.md 참고.

주요 산출물: SynergyFlowDiagram(관계도), SynergyCapabilityTab(독립 탭), SynergyScoreEvidence(산정 근거), POST /api/synergy/ai-areas(AI 영역 제안), capability_coverage 5팩터, GateDecisionPanel 의사결정 탭 이동, 검토 확정 스냅샷.

## As-built (2026-10-18, decider feedback slice — 시너지 점수 평가 독립 탭)

디시더 피드백 "시너지 점수 평가는 별도의 탭으로 구분" 반영. PR #625~#630에서 관계도·필요 역량 탭·산정 근거·ai-areas·5팩터가 먼저 착지했고, 이 슬라이스가 탭 구조를 완성했다.

- **탭 확정 순서**: 연계 시너지 → 주요 검토 영역(구 "우선 시너지 영역") → 필요 역량 → **시너지 점수 평가**(구 "개요", `scoreEval`) → 의사결정 → 출처·노트. 탭 키 "overview"는 완전히 제거(딥링크 파라미터 없음 — 탭 상태는 로컬 useState, 기본값 linkage).
- **시너지 점수 평가 탭** (`SynergyScoreEvaluationTab`): 연결 기회 카드 + 현재 기록(확정/권고) + 사람 확정 편집기(경계 #2, 항상 펼침) + SynergyScoreEvidence(팩터별 근거) + **🤖 AI 보정 제안** 버튼.
- **프로파일 요약은 탭에서 관계도 아래 상시 컨텍스트로**(`SynergyProfileContext`): 대상명·DART 칩·강점/약점 건수·/our-company 딥링크·사업평가 요약 — ADR-0094 역할 분리 유지.
- **번호 배지 제거**: 연계 "3"·주요 검토 "4"·필요 역량 "2.5" 배지 모두 삭제.
- **재분석 버튼**: 헤더 상시 → 연계 시너지 탭 상단(흐름 시작점)으로 이동, 재도출 범위 문구 동반.
- **POST /api/synergy/ai-score-adjustment** (신규): 저장된 근거(규칙 팩터·주요 검토 영역·필요 역량 충족도)에서 ±10 경계 보정 초안을 재제안 — 무기록(쓰기 없음), 사람이 누른 버튼의 결과로 확정 폼에만 프리필. LLM call-site 인벤토리 등록(exempt).
- **검토 확정 기록 (ADR-0153 최소주의)**: migration 0153 `gate_decision.judgement_confirmations_json` (신규 테이블 없음). ReviewBuckets 판단 필요 항목에 "사람 확인" 체크박스(onToggleJudgement 제공 시에만 렌더 — 게이트 결정 패널 한정)와 결정 폼 앵커 링크, GateDecisionPanel이 체크 목록을 결정 POST에 동봉, 결정 이력에 "사람 확인 N건" 표시. 체크는 선택 사항 — 결정을 막지 않는다.
- **검증**: 신규 유닛 10건(tests/unit/synergy-score-eval-ai.test.ts), openapi/call-sites/table-sizing 래칫 갱신, `next build` 성공, 브라우저 실측(탭 순서·배지 부재·점수 평가 탭·AI 보정 제안 +3 프리필·체크박스·앵커 포커스). 시나리오(e2e)·axe 실패는 main 사전존재(stash 기준선 확인).

## As-built (2026-10-18, decider feedback slice 2 — 확인 상태 유지·버튼 가독성)

- **판단 필요 확인 상태가 결정 기록에서 역조회된다**: `latestGateDecisions`가
  `judgement_confirmations_json`을 함께 읽고(GET `latest`에 `judgement_confirmations`로
  노출), ReviewBuckets는 기록된 확인 항목을 `✓ 사람 확인됨 — 결정 기록과 함께 저장`
  칩으로 렌더한다(미확인 항목에만 체크박스). 기록 후 체크박스가 리셋돼도 저장
  상태가 화면에 남는다(2026-10-18 사용자 리포트 "다 선택하고 저장했음에도 해당
  항목이 사라지지 않음").
- **재분석 버튼**: 라벨 `🤖 재분석 (AI)`(AI 재도출임을 라벨에 표기), 범위 문구는
  헤더 옆 인라인에서 아래 줄 캡션으로 분리, 진행 중 라벨 `재분석 진행 중...`.
- **필요 역량 탭 툴바 가독성**: AI 버튼에 🤖 아이콘(`🤖 필요 역량 제안 (AI)`·
  `🤖 보유 판정 확인 (AI)`), 바쁨 라벨 구체화(초안 생성 중/확인 중/저장 중),
  AI 초안 버리기·저장 그룹은 오른쪽 구분선 뒤로 분리, 행 추가 버튼 `＋ 역량 행 추가`.
  테스트가 고정하는 라벨 문자열은 그대로 유지(아이콘은 aria-hidden).

## As-built (2026-10-18, decider feedback slice 3 — 점수 등식 표시)

디시더 지적 "가중치 × 기여도 = 점수가 되어야 논리적으로 맞는다" 반영. 팩터 표와
표시 점수가 서로 다른 층위(규칙 가중합 45 · 미기록 보정 47 · 사람 확정 50)를 섞어
보여준 것이 원인이었다.

- `SynergyScoreEvidence` 등식 표시: 표 tfoot에 `규칙 가중합` 소계 행(기여도 합계 →
  규칙 점수), 권고 ≠ 규칙 점수이면 `LLM 보정 ±N` 행 — `scoreAdjustment` 기록분은
  사유를, 미기록 구버전은 "보정 내역이 기록되기 이전 버전 — 재분석 시 기록" 안내,
  `권고 점수`(payload)와 `사람 확정`(synState confirmed)을 별개 라벨·칩으로 분리.
  확정값이 권고와 다르면 "확정값이 최종"임을 명시.
- 호출부는 `finalScore`(현재 기록값) 하나를 넘기던 것을 `recommendedScore`(payload
  synergyScore) + `confirmed`(확정 기록)로 분리해 전달 — 확정값이 "권고"로
  표기되던 오류 제거.
