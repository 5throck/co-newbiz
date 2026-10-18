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
