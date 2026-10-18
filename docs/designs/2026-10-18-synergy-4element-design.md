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

## As-built (2026-10-18, decider feedback slice 4 — 상한 보장·팩터 점수 기준 범례)

- **상한 질의("일치도 100점이면 합계가 100을 넘지 않나") 검증**: 가중치는 사용
  가능 팩터에 재정규화되어 합이 정확히 100%가 되고, 점수는 가중 평균(최대 팩터
  값 이하)이며 엔진이 0-100으로 잘라내므로 100 초과가 불가능하다. 회귀 테스트로
  고정 — 전 팩터 100점 포화 시 정확히 100, 표시 가중치 합 = 1.0, Σ(기여도) 반올림
  = 저장 점수(tests/unit/synergy-score.test.ts).
- **팩터 점수 산출 규칙 명시(디시더: "팩터의 점수를 매기는 방식이 명확하지 않아")**:
  `SynergyScoreEvidence`에 접힘형 `팩터 점수 기준 보기` 범례 추가 — 5개 팩터 각각의
  0-100 환산 규칙을 한 줄로 기술하고, 수치는 `lib/scoring-weights.ts` 상수에서
  가져와 범례가 엔진과 어긋나지 않는다(곡선 앵커 0/8/35%, 재무 기본 45점·부채
  40% 초과 ×180 감점·ROE ×350·마진 ×300, 충족도 보유율·필수 충족율 대반반).

## As-built (2026-10-18, decider feedback slice 5 — 구 체계 저장분의 시대 차이 명시)

디시더 리포트 "가중치가 설명과 다르게 반영되어 있고 필요 역량 충족도는 계산식에
빠져 있는 듯하다" — 유압식 브레이커 v3가 **구 4팩터 체계(35/30/20/15, 충족도
미포함)로 저장된 분석**이라 범례(현재 체계 30/25/15/10/20)와 표가 어긋나 보인
것. 계산 오류가 아니라 저장 시대의 차이였다.

- `SynergyScoreEvidence`가 저장분에 capability_coverage 팩터가 없으면 `구 4팩터
  체계 저장분` 안내 칩을 표기한다 — 저장 가중치(라벨+%)를 나열해 현재 체계와
  나란히 대조하고, "필요 역량 충족도는 이 버전의 계산에 포함되어 있지 않습니다"
  + "재분석하면 현재 5팩터 체계로 재계산됩니다"를 명시한다.
- 표 본문에도 `필요 역량 충족도 | 미포함 | — | — | 이 버전 저장 시점에는 이 팩터가
  없었습니다` 행을 추가해 표 자체가 빠짐을 설명한다. 저장 가중치는 provenance로
  그대로 표시한다(값을 덧씌우지 않는다).

## As-built (2026-10-18, decider feedback slice 6 — 구 저장분 → 현재 체계 전환)

디시더 요청 "구 4팩터 체계 저장분을 새롭게 변경된 방식으로 바꿀 수 있도록" — 전체
재분석(AI 5단계 전체 재실행) 없이 저장분의 점수 체계만 전환하는 경량 경로.

- **POST /api/synergy/analyses/[id]/rescore** (lib/synergy-rescore.ts): 최신
  저장분을 두고 현재 저장 상태(S1 완료 시장·그룹/계열사 프로파일·필요 역량
  레지스터)에서 현재 가중치로 규칙 재계산(computeSynergyScore) + 파이프라인과
  같은 ±10 경계 LLM 보정(s4.synergy_ic, 사유 기록) → **새 버전 append**
  (append-only, 기존 버전 보존) + 기회 권고 재기록(재분석과 같은 규칙 — 점수가
  바뀌면 사람 확정 무효화, 같으면 유지). analyst+ 전용, 감사 로그 기록.
- **UI**: 시너지 점수 평가 탭에 구 체계 저장분(저장 factors에 capability_coverage
  부재)일 때만 `🤖 현재 체계로 재계산 (AI)` 버튼 — useConfirm 확인 다이얼로그
  (점수 변경 시 확정 무효화 고지) → 성공 시 상세·확정 상태 재조회.
- **검증**: 유닛 4건(전환·무기록 버전 규칙·권고 재기록·확정 무효화 조건) +
  브라우저 실측 — 유압식 브레이커 v3(구 체계) → v4: 규칙 40 + LLM 보정 +2(사유
  기록) = 권고 42, 5팩터 표(충족도 31, 가중치 20%) 렌더, 구 체계 안내·미포함 행
  소멸. 재계산 후 확정 상태 재조회 보강(화면이 서버 기준 상태를 보여주도록).

## As-built (2026-10-18, decider feedback slice 7 — 투자비 연동 항목 제어성 4건)

디시더 리포트 4건: ① 외화 항목이 사실상 원화만 가능, ② S5 연동 항목의 주기가
일시불 고정, ③ 판정에서 시작 연차를 조절할 수 없음, ④ 반영 해제 후 재반영 불가.

- **② 연동 항목 주기 편집**: `StoredCapabilityEntry.period`가 `"lumpsum" |
  "yearly"`로 확장 — selectionPayload·normalize(월간 등은 400 invalid_request)·
  `capabilityYearVector`(신규 공유 헬퍼)·investmentTotals·modeCapabilityVector까지
  스레딩. 연간 선택 시 금액 = 연간 집행액이 검토 기간까지 반복되고(일시불 = 총액),
  S8 s5_plan 집계(s5-plan-pin aggregatePlanLines)는 기존 period 봉합으로 그대로
  확산된다. 투자비 표의 연동 행 주기 select가 편집 가능해졌다.
- **③ 판정 dialog 시작 연차 편집**: CapabilityJudgementDialog의 읽기 전용
  "N연차" 표시가 number input으로 바뀌고, 값은 기존 cost-entry startYear
  override(capStartYear 지도)에 실시간 반영 — 투자비 저장 시 함께 기록된다.
  종료 연차 표시도 override를 따른다. 테이블·에디터로 optional props 스레딩.
- **④ 반영 해제 후 재반영**: unifiedInvestmentRows가 "저장된 미반영" 연동 행을
  계속 나열(합계 제외 상태 표시)하고, 행에 `다시 반영` 버튼 추가 — 해제·저장·
  재로드 후에도 같은 표에서 복원 가능. (S5 역량 해소 비용 블록의 체크박스 경로도
  유효 — 발견성 문제였다.)
- **① 외화 항목**: 수동 항목의 통화 select(KRW/USD/EUR/JPY/CNY)는 이미 존재하나
  외화 항목은 합계에서 제외(환율 미반영) 상태 — FX 환산(person-set
  entry_market_fx 요율 적용)은 별도 슬라이스로 설계 중(합계·벡터 변경이 커서
  분리). 이 슬라이스에서는 제외 안내 문구가 그대로 유지된다.

## As-built (2026-10-18, decider feedback slice 8 — 연차 저장·문구 확인)

- **시작·종료 연차 저장/년도별 금액**: 브라우저 종단 재현 결과 현재 main에서 정상 —
  수동 행 시작(1→2)·종료(5→4) 저장·리로드 유지, 연동 행 집행 연차(1→3) 저장·유지,
  요약 스케줄 즉시 재분배(운영비 Y1 2,400 / Y5 1,190 등). 리포트 당시 화면이
  #637 이전 번들(연동 시작 연차가 저장 버튼을 활성화하지 않던 시점)이었을
  가능성. 재검증 절차와 결과를 이 기록으로 남긴다.
- **역량 해소 비용 블록 문구**: "투자비"가 설비투자만을 가리킨다는 오해를 풀기
  위해 블록 설명에 '"투자비"는 판정 분류(인건비·운영비·설비투자)로 구분되는 투자
  계획 항목 전체 — 운영비 항목도 이 블록에서 반영' 문구를 추가하고, 줄별 분류
  select에 aria-label·title로 카테고리 의미를 명시. 고정 문자열("투자비에 반영"
  등)은 테스트 핀을 유지하기 위해 그대로 둠.

## As-built (2026-10-18, decider feedback slice 9 — 외화 투자비 FX 환산)

디시더 리포트 "외주·용역비가 년도별 금액에 반영 안 됨 + 운영비 월 단위 환산 안 됨"
의 근본 원인: 부품 허브 행이 **USD(백만 USD)/월**로 입력되어 있었고, 투자비 합계에는
FX 환산이 없어 외화 항목이 통째로 제외되고 있었다(환율 미반영 규칙). 외주·용역
하위 행은 #637 이후 정상 렌더된다(리포트 당시 구번들 화면).

- **FX 환산 봉합**: `manualLineInKrw`(라인을 사람 설정 환율로 백만원 환산한 "계산
  전용 복사본"으로 되쓰기 — 저장 원본은 통화·금액 그대로 보존) + `FxRates`(원/통화
  지도) + `convertManualLinesToKrw`. 환율원은 검토/안건의 `entry_market_fx`
  (사람 설정, 예: USD 1,350원) — 없는 통화는 기존대로 제외되고 안내 문구가
  "환율을 설정하면 환산 반영됩니다"로 바뀐다.
- **적용 지점**: S5 투자비 표(합계·스케줄·벡터 — `bcLinesKrw` 계산 복사본), S5→S8
  승격(s5-cost-import: 환율 있으면 환산 반영, 없으면 기존대로 skip), S8 s5_plan
  집계(aggregatePlanLines — resolveS5InvestmentPlan이 프로젝트의 원본 기회
  환율을 읽어 전달).
- **행 표시**: 외화 행의 연/기간 readout에 "(환율 적용)" 표기 — 예: 200백만 USD/월
  × 1,350원 = 연 3,240,000 백만원. 금액 과대 시 기존 sanity 칩("금액이 매우
  큽니다")이 그대로 경고한다.
- **실측**: 유닛 3건 신규(fx_m 환산·무환율 미변경·승격 전환/스킵) + 브라우저에서
  통화 USD 전환 시 "(환율 적용)" readout 확인 후 원복(저장 없음).

## As-built (2026-10-18, decider feedback slice 10 — 판정·연동 항목 주기 모델 통합)

디시더 방향: "S5 연동 항목도 투자 항목과 같은 주기로 관리 + 판정도 주기 관리 방식
변경". 수동 투자 항목과 동일 규약(금액 = 주기당 금액)으로 통일했다.

- **판정에 `spendPeriod` 추가**: `CapabilityAttainability.spendPeriod`
  (monthly|quarterly|yearly|lumpsum, capability_gap_json 안 additive 필드).
  판정 dialog에 주기 select(기본 연간) 추가, 금액 라벨을 "금액(주기당, 백만원)"으로
  변경. PUT(judgementPatch.spendPeriod)로 저장. unset → 일시불 취급(기존 행 호환).
- **연동 항목 주기 우선순위 = 판정**: derive period = 판정 spendPeriod → 저장 entry
  period → 일시불. 서버 normalize는 전체 어휘(월/분기/년/일시불)를 수용하고 미지는
  lumpsum 정규화.
- **연간 벡터 = 금액 × 주기계수(월×12·분기×4·년×1)을 시작~종료 창구 매년** — 이전의
  "총액을 검토 기간까지 반복/균분" 모델을 대체. 일시불 = 총액을 시작 연차 1회. 합계
  연간 반복 = 금액 × 계수. 종료 연차는 연동 행에서 편집 가능(#641)이고 저장·승격까지
  이관된다(splitForPromotion/writeS5CostModel: end_year 저장, 연간 = 연간 집행액).
- 기존 저장분(주기 없음)은 일시불 취급으로 합계·벡터 불변 — 마이그레이션 불요.
