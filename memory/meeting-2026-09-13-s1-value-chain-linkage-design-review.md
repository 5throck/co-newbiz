# Meeting — S1 가치사슬 연계 산업 분석 개선 설계 심의 (공통 meeting-facilitation 흐름)

- Date: 2026-09-13
- Facilitator: pm (AI 진행 — common meeting-facilitation 스킬 흐름, 3개 역할 패널)
- Participants: market-intelligence-agent, quant-methodologist (방법론 패널) / backend-engineer, data-architect (백엔드·데이터 패널) / ux-designer-agent, frontend-engineer, risk-officer (UX·레드팀 패널)
- Rounds: 패널별 독립 심의 1회 + PM 종합
- 비고: committee-deliberation 엔진 CLI(`committee-deliberation.ts`)는 결정론 멤버 실행기로 실질 심의가 불가하여, 공통 미팅 스킬 흐름(페르소나 기반 패널 심의)으로 대체 실행함. 엔진 기록은 별도 트랜스크립트 참조.

## Agenda and objectives

설계 초안 심의: (1) 연계 산업 분석 직렬 큐(pending + after_analysis_id, 동시성 1, 루트 실패 시 큐 취소) (2) 신규 산업 첫 분석은 대상만(모달 프리뷰 전용) (3) 1차 LLM 제안 프롬프트 사업자 관점 명시·relation 검증·대체재 제외 (4) 유압식 브레이커 링크 전방→후방 교정(은퇴 후 재등록). 아울러 PM 제안 6건(a~f)에 대한 찬반과, Value Chain 관점 산업 분석 효과화 방안 도출.

## Panel contributions (요약 — 전문은 세션 패널 산출물 기준)

### 방법론 패널 (market-intelligence-agent, quant-methodologist)

- P0: `proxy_link` 후방 링크가 사이징 홉으로 오염될 위험 → **검증 결과 이미 완화됨**: 파이프라인이 수요 목적으로 전방/전전방만 소비(`market-sizing-pipeline.ts:205` `curatedForwardDemand`). 소비자 레벨 경계 유지로 충분 — 별도 스키마 없이 문서화로 종결.
- P0: 자동 스폰된 연계 분석의 등급 처리 공백 → **설계 명시로 해결**: 스폰 분석은 연계 산업 자체 데이터의 독립 사이징(경로 i)이며 대상→연계 홉 브리징(경로 ii)이 아니므로 미보정 홉 문제 미발생. 설계 문서에 경로 명시.
- P0: 대체재 무음 drop 금지 → **수정 반영**: sanitizer가 `대체` 관계를 drop하지 않고 분리 반환 → 모달에 "대체 위협 (검토 필요)" 섹션으로 표출(6축 대체 위협 영역, 저장 링크 아님).
- P1: 큐 실행 순서 수요 우선 제안 → 채택(소규모): 0094에 `linked_relation` 추가, claim 순서 전방/전전방 → 후방/후후방 → created_at.
- P1: 프롬프트 전용 관점 규칙의 비결정론 → 부분 채택: 프롬프트에 산업명 행위자 유형(운용/제조/유통 접미) 관점 주입 규칙 추가. DB 관점 필드는 보류(열린 과제).
- P2: `evidence_ref='.'` 전수 감사 → C1 데이터 교정 시 전수 점검 병행.
- PM 제안 판정: (a) 찬성-수정(프롬프트 슬라이스만) / (b) 찬성(수요 우선 claim 순서로 부분 반영) / (c) 찬성-원칙(실행 보류) / (d) 찬성-조건부(단계적, 현재는 승인 링크 우선 소비 이미 구현됨) / (e) 찬성(대체 위협 표출로 반영) / (f) 수정-로그 우선(관계 수정률 등은 추후 계측 과제).

### 백엔드·데이터 패널 (backend-engineer, data-architect)

- P0: 재빌드 DDL 셀프 FK가 임시 테이블명이 아닌 구 테이블명을 가리키는 함정 → 채택: `REFERENCES market_sizing_analysis_rebuilt(id)`로 작성 후 RENAME, `PRAGMA foreign_key_list` 검증 체크리스트 포함.
- P0: 직렬 큐가 서버 재시작을 survive하지 못함 → 채택: watch:run에 회수 패스 추가(타임아웃 in_progress → failed + 그룹 취소, completed 루트의 pending claim). GET-kick은 폐지(P1-1 순수성 위반 — viewer가 LLM 비용 유발 가능).
- P1: claim 경합 → 단일 조건부 UPDATE로: `status='pending' AND after_analysis_id=:root AND 루트='completed' AND 그룹 내 in_progress 없음` + changes() 검증. 루트 completed 조건이 seed/rerun 우회·크래시 윈도우를 흡수.
- P1: rerun 중 pending 세대 혼선 → 채택: 루트 rerun 시작 시 기존 pending 전부 취소(사유 기록), 새 모달 선택만 대기. pending 행 rerun 요청은 reused 응답.
- P1: after_analysis_id 앵커 검증 → 채택: in_progress→pending, completed→즉시 실행, failed/pending 앵커→409.
- P2: 부분 유니크 인덱스(산업당 활성 1건), 큐 인덱스, started_at 컬럼, queue_claim/queue_cancel 감사 → 모두 채택.

### UX·레드팀 패널 (ux-designer-agent, frontend-engineer, risk-officer)

- P0: 리포트 화면에 완료 후 연계 추가 진입점 부재 → 채택: 리포트 가치사슬 섹션에 `연계 산업 이어서 분석` CTA(완료 상태 한정).
- P0: 폴링 사각지대(pending이 3초 폴링을 트리거 안 함) → 채택: 폴링 조건에 pending 포함 + 상태 문구 갱신. (큐 진행 자체는 서버 주도이므로 폴링은 관측 수단.)
- P1: 모달 제목·설명 모드 분기(프리뷰 vs 선택), `연계 대기 · N번째` 칩, `제안 (검증 전)` 칩 + 403 분기, 로딩 문구, linkNotice 문구 → 모두 채택(카피는 패널 제안안 사용).
- 레드팀 가드레일: 큐 상한 5건(모달 강제) 채택. 정체 30분 표기·행별 취소 버튼·관측 텔레메트리는 v1 보류(과제 기록). 취소된 행 복구는 재분석 모달 재선택 경로로 충족.

## Synthesized outcome (PROPOSAL — 승인된 계획에 패널 결과 반영)

설계 골격(직렬 큐·첫 분석 대상만·프롬프트 관점 강화·데이터 교정)은 유지하되, 패널이 요구한 v1 필수 조건을 반영: ① 셀프 FK 임시명 재빌드 + 검증 체크리스트 ② watch:run 회수 패스(서버 주도 큐) + GET-kick 폐지 ③ 조건부 claim SQL(루트 completed + 그룹 직렬 보장) ④ rerun 세대 정리 ⑤ 리포트 CTA ⑥ 대체재 표출 ⑦ 큐 상한·카피 전면 갱신. PM 제안 (a)~(f) 중 DB 스키마 관점 필드·등급 게이팅·품질 지표는 열린 과제로 문서화.

## Dissent (verbatim 요지 — 축약 없이 보존)

- QM: "미보정 홉을 건너는 스폰 분석은 절대 규모 수치 자체를 렌더링 금지(등급 C 확정 전에는 오차 밴드 없는 수치 = 비협상 경계 위반)." — MI 반론: "S1은 후보 스크리닝 단계, 숫자를 안 보여주면 연계 후보 판단 불가." → **타협(패널 합의)**: 스폰 분석은 연계 산업 자체 데이터의 독립 사이징이므로 홉 브리징 자체가 없음 — QM 우려의 전제(홉 경유)가 성립하지 않음을 설계에 명시하는 것으로 종결.
- MI: "(b)가 후방을 FS로 완전 연기하면 조달측 공급 리스크·경쟁자 증설 추적의 S1 신호가 사라진다." — QM 반론: "후방의 S1 노출은 proxy_link 의미론 오염과 사용자 오인을 키운다." → **타협**: 후방 링크는 등록·보관하되(마스터 데이터) 수요 사이징 소비는 전방 한정(기존 경계), 큐 실행 순서만 후방 후순위.
- risk-officer (엔진 트랜스크립트 + 패널 공통): "큐 진행의 주체와 영속성 증거가 없으면 출시 금지" → watch:run 회수 패스와 완료 훅으로 충족. "무제한 큐 = 비용 폭탄" → 상한 5건 채택.

## Action items

- 구현 반영: 위 Synthesized outcome 7항목(Phase C 소스에 반영 — 담당: backend-engineer/frontend-engineer 페르소나의 구현 에이전트, 승인: 사용자).
- 열린 과제(설계 문서 기록): 산업 관점 DB 필드, 제안-런 pinning, 등급 게이팅 기반 확장 제한, 사슬 품질 지표(관계 수정률·승인률 계측), 큐 정체 관측(30분 표기), 행별 취소 버튼.
