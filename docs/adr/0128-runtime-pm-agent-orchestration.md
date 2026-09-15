---
lang: ko
lang_reason: source-material
---

# ADR-0128: 런타임 LLM 호출의 에이전트팀 통합 (PM 라우터 + 런 장부 + 체인)

- Status: Accepted
- Date: 2026-09-13
- Deciders: PM (dispatch), backend-engineer (schema/API), frontend-engineer (UI)
- Related: ADR-0096 (agent-orchestrator), ADR-0097 (committee seam),
  ADR-0118 (제안 전용 LLM 브리프), ADR-0094 (경계 #2), 하네스 엔지니어링의
  PM 게이트웨이 (웹 런타임으로의 이식)

## Context

웹 서비스의 LLM 호출 중 위원회 심의·활동 체인(ADR-0096)은 에이전트 오케스트레이터를
거치지만, 17개 API 지점(브리프·추천·요인·검토·파이프라인)은 각 라우트가
`completeOrFallback`을 **직접 단발 호출**한다. 프롬프트 텍스트에 에이전트 역할을
적어두었을 뿐 런 장부 기록도, 에이전트 정의 로딩도, 상위 오케스트레이션도 없다.
하네스 엔지니어링의 PM 게이트웨이 원칙("LLM 질의는 에이전트팀을 통해, PM이 주관")을
런타임에도 적용하자는 사용자 결정.

## Decision

### 1단계 — 모든 LLM 호출의 에이전트 런 장부화
- **`llm_call_log` 테이블** (migration 0092, append-only): `id, agent_key, purpose,
  context_type, context_id, source(llm|synthesis), provider, model, ok, error,
  latency_ms, created_at`. `process_run`은 opportunity/project 엔터티 결합형이라
  직접 쓰지 않는다 — 임의 컨텍스트(산업, 시스템)의 단발 호출도 기록해야 하므로
  독립 런 장부를 둔다.
- `completeOrFallback`에 `agent?: { key, purpose, contextType?, contextId? }`
  옵션을 추가하고, 모든 호출 지점에서 에이전트 키를 선언한다. 키는 `agents/`
  로스터의 역할명을 따른다 (예: gate-brief=risk-officer, 매력도=risk-officer,
  적합성=process-governance-manager, 스케치=greenfield-agent, PM 분류=pm).

### 2단계 — 런타임 PM 라우터
- `lib/agent-registry.generated.ts`: `agents/*.md`의 name/description을 스크립트로
  투영한 정적 레지스트리 (generate-agent-registry.ts, 기존 generated 패턴 준수).
- `lib/pm-router.ts`: 사용자 질의를 분류한다. (a) 결정론 규칙(키워드·엔터티 패턴)
  우선, (b) 불명확하면 LLM 분류 — 이 분류 호출 자체도 agent_key='pm'으로 장부화.
  출력: `{ mode: 'single' | 'chain', agentKey?, chainId?, answerTarget }`.
- `POST /api/agents/query` (analyst+): 질의 수신 → PM 분류 → 단일 에이전트면
  해당 에이전트 실행(에이전트 정의를 시스템 프롬프트로 주입, completeOrFallback
  + 런 장부), 체인이면 3단계 체인 실행. 응답에 **어느 에이전트가 무엇을 근거로
  만들었는지** provenance를 명시한다. 사람의 결정 기록과 무관한 제안 전용 surface.
- `GET /api/agents/registry`: 로스터 열람.
- `/agents` 화면: 질의 박스 + 응답 + 단계별 provenance 표시. 내비 "분석·참조"에
  "에이전트" 항목 추가.

### 3단계 — 복합 작업 체인
- `lib/agent-chains.ts`: 미정의 작업 조합을 순차 체인으로 실행.
  `opportunity_evaluation` 체인: 요인 도출(market-intelligence-agent) →
  매력도 초안(risk-officer) → S3 적합성 권고(process-governance-manager) →
  PM 종합. 각 단계는 기존 lib 함수 재사용 + `agent` 옵션 장부화.
- PM 라우터가 "평가/분석 + 기회명" 형태의 복합 의도를 감지하면 체인을 선택한다.

## Consequences

- 모든 LLM 산출물이 "어느 에이전트가, 무슨 목적으로, 무엇을 근거로" 남기는지
  런 장부에서 조회된다 — 감사·디버깅·비용 관찰이 가능해진다.
- 에이전트 정의(agents/*.md)가 문서가 아니라 런타임 프롬프트의 원천이 된다 —
  로스터 수정 시 레지스트리 재생성이 필요하다(generated 패턴과 동일한 규율).
- LLM 미설정 배포에서도 PM 라우터는 결정론 규칙으로 분류하고 에이전트는
  결정론 폴백으로 동작한다 — 기존 "LLM 없이도 완전 기능" 원칙 유지.
- 산출물은 여전히 제안 전용이다 — 결정·기록은 기존 인간 게이트 UI를 통해서만.
