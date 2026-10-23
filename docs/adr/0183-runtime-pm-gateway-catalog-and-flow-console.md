---
lang: ko
lang_reason: source-material
---

# ADR-0183: 런타임 LLM 호출의 필수 PM 관문 — 활동 카탈로그 + 전체 플랫폼 패리티 + 플로우 콘솔 + 드라이런 레인

- Status: Accepted (2026-10-23)
- Date: 2026-10-23
- Decider: human decider (chat 2026-10-23 — "모든 LLM 호출은 PM 에이전트팀을 통해" 원칙의 부분 구현을 지적하고, PM이 검증한 갭 보고를 받아 필수 관문·활동 카탈로그·플로우 관리 콘솔(벤치마킹 기반 UX·드라이런·AI 제안) 계획을 승인. 게이트 모드 A/B/C 비교, 콘솔 읽기 전용 vs 드라이런 레인, 벤치마크 기반 UX의 단계적 재조정을 거쳐 최종 구성 확정). Drafted by platform-lead.
- Design-of-record: docs/designs/2026-09-15-runtime-pm-agent-orchestration-design.md §6 (v2 개정, 2026-10-23)
- Gate-moment record: docs/decisions/DEC-20261023-01.md
- Related: ADR-0128 (선결 — 본 ADR이 범위를 수정), ADR-0078 (개발-시간 LLM 라우팅 — 런타임 확장과 구분), ADR-0118 (제안 전용 LLM 브리프), ADR-0094/0090 (경계 #2 — 사람 결정), ADR-0074 (Design Gate — 오버라이드의 영구 반영 경로), ADR-0105 (내비 SSOT), ADR-0146 (requireBusinessActor), ADR-0016 (데이터 신뢰도 상한 — 드라이런 경계), AGENTS.md PM Gateway, docs/context.md 지원 표면 규칙 (8 surfaces)

## Context

사용자 원칙 "모든 LLM 호출은 PM 에이전트팀을 통해"는 2026-10-23 재요청에서
부분 구현으로 판명됐다. ADR-0128은 이 원칙을 협소하게 해석했다 — 자유 질의
표면(`POST /api/agents/query` → `lib/pm-router.ts`)에만 런타임 PM 라우터를
적용하고, 단계 산출물 표면은 "각 호출 지점이 `agent` 메타를 선언"하는 것으로
충분하다고 보았다. 구현은 그 ADR에 충실하다. 문제는 세 가지다.

1. **범위 갭**: 19개 단계 산출물 API 라우트 + 약 10개 lib 파이프라인 모듈이
   `completeOrFallback`을 고정 에이전트 키와 함께 직접 호출한다 — PM
   오케스트레이션 추적이 선언(규율)에 의존할 뿐 구조(관문)로 강제되지 않는다.
2. **장부 누수**: `agent` 메타가 옵션이라 `logAgentCall`(llm.ts:576)이 메타
   부재 시 장부 기록을 조용히 생략한다 — 선언을 잊은 호출은 감사 불가능.
3. **이중 SSOT 위험**: pm-router의 11-에이전트 허용목록과 규칙이 코드에
   하드코딩되어, 로스터·flow.spec 프롬프트 SSOT과 코드가 드리프트할 수 있다.

또한 하네스(7개 플랫폼)와 런타임 사이의 에이전트 정의 패리티는 현재 검증
없이 신뢰된다 — `generate-agent-registry.ts --check`가 존재하지만 배터리에
연결되지 않았다.

이 변경은 DB 스키마 변경(인덱스 1, 열 추가 1, 테이블 1)을 수반하므로 스키마
거버넌스 트리거를 충족하며, 사용자 대면 UI(`/flows`)를 수반하므로 접근성
기록 의무가 있다.

## Decision

1. **활동 카탈로그(D1)**: `scripts/co-newbiz/generate-pm-catalog.ts` 신설
   (generate-spec-activities.ts 패턴 — 결정론 출력 + `--check` 드리프트 게이트)
   → `app/web-next/lib/pm-catalog.generated.ts`. 3 SSOT 조인: prompts.json
   (선택적 `activity` 필드 추가), `process/flow.spec.yaml` activities,
   `agents/*.md` 로스터 참조 검증. `agent: null` 프롬프트 2개
   (`s8.business_case_prose`, `committee.position`)는 동적 항목으로 분류.
   pm-router의 하드코딩 11-에이전트 허용목록·정규식 규칙을 카탈로그 데이터로 대체.
2. **관문 강제(D2)**: `lib/llm.ts` 5개 진입점(`complete`, `completeDetailed`,
   `completeStructured`, `stream`, `completeOrFallback`)에서 `agent` 메타를
   필수로 — 부재·미등록 키는 `PmGateError`. 19 라우트 + 10 lib 모듈의 서명
   강화 마이그레이션(대상 전수 열거는 design-of-record §6.3). `classifiedBy`
   를 `"catalog" | "llm" | "rules"`로 확장. 선언 강제는 LLM 구성과 무관하므로
   "LLM 없이도 완전 기능" 원칙은 유지된다.
3. **전체 플랫폼 패리티 가드(D3)**: 플랫폼 중립 SSOT 원칙 — 7개 플랫폼이
   각자의 방식(hooks: .claude/.gemini/.codex 설정, 프롬프트 부트스트랩:
   hermes/zai via AGENTS.md §0)으로 소비하는 SSOT에서 웹 런타임이 8번째
   소비자로 카탈로그를 도출. 미연결 `generate-agent-registry.ts --check`와
   신규 `generate-pm-catalog.ts --check`를 dev-sync/audit 배터리에 연결
   (audit 패턴: SSOT→기대집합→집합차이→항목별 Fail→집계 Pass, Skip≠Pass).
   `validate-model-registry.ts`에 카탈로그 tier/model 검증 확장.
   `scripts/SCRIPTS.md` + `scripts-snapshot.json` 등록.
4. **플로우 콘솔(D4)**: `/flows` 읽기 전용 콘솔 — 블루프린트 뷰(S1–S12 →
   활동 → 에이전트 → 프롬프트 키+스킬, 트랙 범위, 드릴다운) + 런 장부 뷰
   (process_run↔activity_run↔agent_run + llm_call_log, EChart 타임라인).
   `GET /api/flows`, `GET /api/flows/runs`(커서 페이지네이션 — audit-log
   limit+before 패턴), `requireBusinessActor(auth, "read")`. 내비 "분석·참조"
   섹션(navigation.test.ts 패리티). UX 설계는 외부 벤치마킹(LLM 관찰가능성
   콘솔 — LangSmith/Langfuse/Braintrust/Arize Phoenix/W&B Weave; 워크플로
   콘솔 — Dagster/Airflow/GitHub Actions; 프롬프트 실험 UI — LangSmith
   Playground/Anthropic Workbench/OpenAI Playground)에서 출발하며, 벤치마크
   노트는 UX 로우(Row 2)에서 design-of-record 부록으로 첨부된다 — 부록 전
   화면 구현 착수 금지. **접근성**: WCAG 2.1 AA — 키보드 드릴다운·가시
   포커스, 차트의 데이터 테이블 대체, 색 단독 아닌 상태 표시,
   `prefers-reduced-motion` 존중.
5. **드라이런 레인(D5)**: SSOT 불변 — 오버라이드는 세션 스코프 저장소에만;
   영구 반영은 제안 패키지 → 저장소 PR(Design Gate)로만. 드라이런은 실제
   운영 코드 경로(동일 `completeOrFallback`)를 통과하며, 결과는 비즈니스
   테이블에 절대 기록되지 않는다. 장부는 `is_dry_run` + `dry_run_group_id`
   플래그로 기록하고 운영 대시보드에서 기본 제외, 세션당 비용 표시 + 사전
   확인. v1은 단일 활동 드라이런.
6. **AI 개선 제안(D6)**: 프롬프트 개선·에이전트 재배정 제안(근거 동봉),
   제안 전용 — 수락은 드라이런 세션 오버라이드에만 적용. 제안 호출 자체가
   관문+장부 통과(신규 활동 키 `pm.flow_suggest`).
7. **경계·스키마(D7)**: 위원회석 SSOT는 `procedures/_committees.yaml` 유지.
   DB 마이그레이션 총 3: (1) `agent_run.agent_key` 인덱스,
   (2) `llm_call_log` 드라이런 플래그, (3) `dry_run_session` 테이블+TTL 정리.

## Consequences

- **강제 불변식**: 에이전트 선언 없는 LLM 호출은 컴파일 또는 런타임에서
  실패한다 — "선언을 잊어도 조용히 통과"하는 경로가 제거된다. 마이그레이션
  비용으로 29개 호출 파일(19 라우트 + 10 lib)의 서명 강화가 필요하나, 이미
  agent 메타를 전달하는 호출 지점이므로 컴파일러 주도의 기계적 변경이다.
- **단일 SSOT 강화**: 로스터·flow.spec·프롬프트가 카탈로그의 유일한 원천이
  되고, 드리프트는 sync-time 게이트(`--check` 연결)에서 실패한다. 7개
  하네스 플랫폼과 웹 런타임이 같은 SSOT을 소비하는 구조가 검증된다.
- **관찰가능성**: `/flows`에서 파이프라인 구조와 런 장부가 한 화면에서
  조회된다 — ADR-0128이 만든 런 장부가 부수 데이터에서 1급 표면으로 승격.
- **스키마 비용**: 마이그레이션 3개(인덱스 1, 열 2, 테이블 1). 모두
  additive이며 기존 열·테이블을 변경하지 않는다.
- **접근성 의무**: `/flows` UI는 WCAG 2.1 AA 검증 대상이다 — 차트의 데이터
  테이블 대체와 키보드 드릴다운이 구현 수용 기준에 포함된다.
- **실험 안전**: 드라이런이 운영 데이터와 장부 대시보드를 오염시키지 않는다
  — 비즈니스 테이블 무기록 + `is_dry_run` 필터가 불변식이며, 데이터 신뢰도
  상한(ADR-0016) 경계가 유지된다.

### 거부된 대안

- **호출 지점마다 LLM 분류기(per-call classification)**: 모든 고정 의미론
  엔드포인트(예: gate-brief는 risk-officer)를 호출 시마다 LLM으로 분류하는
  방안 — 레이턴시·비용이 호출 수에 비례하고, 의미가 고정된 엔드포인트에서
  오분류 위험만 추가된다. 결정론 카탈로그가 정답.
- **콘솔 내 SSOT 직접 편집**: /flows에서 프롬프트·에이전트 매핑을 즉시
  저장하는 방안 — 저장소 SSOT(prompts.json, flow.spec, agents/*.md)과
  콘솔 DB의 포크가 생긴다. 세션 오버라이드 + 제안 패키지(PR) 경로로 대체.
- **AdalFlow 류 런타임 에이전트 프레임워크 도입**: 사용자가 AdalFlow
  (Python) 조사를 요청한 바 있으나 — (a) 언어 불일치(런타임은 TypeScript/
  Next.js), (b) 프레임워크가 에이전트 정의를 자체 형식으로 요구하면
  agents/*.md SSOT이 우회된다. 프레임워크 도입 대신 카탈로그 투영으로
  동일 목적을 달성.

### Supersession

**Supersedes**: ADR-0128의 적용 범위 조항 — "자유 질의 표면에만 런타임 PM
적용"과 "에이전트 키 선언(옵션)으로 충분"이라는 협소 해석. ADR-0128의
의도(모든 LLM 산출물이 에이전트 귀속으로 장부화)는 그대로 승계되며, 런 장부
구조(0092)·에이전트 정의 주입(레지스트리)·체인은 유지된다. pm-router의
하드코딩 허용목록은 카탈로그 데이터로 대체된다(구현 세부 대체, 원칙 승계 —
ADR-0011→0070의 "intent carried forward" 관례 준수). ADR-0078(개발-시간
라우팅)은 영향받지 않는다.

## Acceptance record

- Approver: the human decider (user, account techcross), chat 2026-10-23 — 사용자의 2026-10-23 재요청에 대해 PM이 검증한 갭 보고와 본 설계 계획을 승인함으로써 본 결정을 결재. 구현(마이그레이션 3개, 콘솔 UI)은 후속 로우에서 착수되며 병합 후 실측 확인.
