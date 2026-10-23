---
lang: ko
lang_reason: source-material
---

# 런타임 PM 에이전트 오케스트레이션 설계 (Runtime PM Agent Orchestration) — 2026-09-15 백필

> **근거**: ADR-0128, ADR-0118, AGENTS.md PM Gateway
> **상태**: 구현 완료(커밋 355c56eb) — 본 문서는 Design Gate(ADR-0074) 등록 누락의 사후 보완(backfill)이다.
> **v2 개정**: 2026-10-23 — 필수 PM 관문·활동 카탈로그·전체 플랫폼 패리티·플로우 콘솔·드라이런 레인(§6).
> 근거: 사용자 승인 계획(2026-10-23 채팅), ADR-0183, DEC-20261023-01. §1–5는 ADR-0128 협소 범위의 기록으로 보존된다.
> **검증 게이트**: `bun scripts/test-runner.ts unit` · `bun scripts/audit.ts`

---

## 1. 배경 및 목표

ADR-0128은 "LLM 질의는 에이전트팀을 통해, PM이 주관"이라는 원칙을 런타임(애플리케이션)으로
가져온다. 개발-시간 라우팅(ADR-0078)과 달리, 앱 사용자의 LLM 질의는 PM 게이트웨이를
모방한 런타임 라우터를 통과해야 하며, 모든 외부 LLM 호출은 런 장부(`llm_call_log`)에
남아야 한다. 구현은 커밋 355c56eb로 반영되었으나 설계 문서 등록이 누락되어 본 문서로
보완한다.

## 2. 구성 요소

1. **PM 라우터** — `app/web-next/lib/pm-router.ts`. 결정론적 라우팅 규칙 우선,
   매칭 실패 시 LLM 분류 폴백(자체적으로 agent `pm`로 장부 기록). 라우팅 근거
   (`classifiedBy`, `steps`)를 응답에 포함해 감사 가능성을 유지한다.
2. **에이전트 정의 주입** — `lib/agent-chains.ts` + `lib/agent-registry.generated.ts`.
   `agents/*.md` 로스터를 런타임에 주입하여, 런타임 에이전트가 별도 정의를 가지지
   않게 한다(단일 SSOT).
3. **질의 표면** — `POST /api/agents/query`(analyst+ 검증)와 `/agents` UI.
   응답은 `proposalOnly: true`이며, 산출물은 제안 전용 — 결정·기록은 기존 인간
   게이트 UI를 통해서만 이루어진다(경계 #2).
4. **런 장부** — `db/migrations/0092_llm_call_log.sql`, `lib/llm.ts`의 `logAgentCall`.
   append-only이며 agent_key·purpose·context·source·provider·ok·error·latency를
   호출 경로(성공/폴백/실패)마다 기록한다.

## 3. 단계 LLM 표면과의 관계

`flow.spec.yaml`의 단계 활동이 소유한 LLM 표면(S1~S9 초안 기능)은 ADR-0118 계약을
따르며 PM 라우터를 경유하지 않는다. 대신 각 호출 지점이 `agent` 메타를 선언해
런 장부에 단계 활동 소유 에이전트로 귀속되고, 이로써 PM 디스패치 추적성이
유지된다(ADR-0128 §1단계).

## 4. 같은 커밋으로 반영된 부수 표면

`api/market-overview/related-candidates`, `api/market-overview/industry/[industryId]/chain-links`,
기회 페이지 개편 — 모두 동일 계약(on-demand POST, analyst+, 장부 기록, 제안 전용)을
따른다.

## 5. 교훈

설계 문서 등록 없이 반영된 구조 변경은 sync-time spec-check가 우회 경로(예외 코드)로
넘어갈 때 조직 기억을 남기지 못한다. 코드와 문서가 같은 커밋에 없으면 사후 백필
비용이 발생한다 — 이후 런타임 LLM 표면 추가 시 설계 문서를 선행 등록한다.

---

## 6. v2 개정 (2026-10-23) — 필수 PM 관문 + 플로우 관리 콘솔(벤치마킹 기반 UX·드라이런·AI 제안) — 전체 플랫폼 하네스·런타임 동일 구조

> **근거**: 사용자 승인 계획(2026-10-23 채팅), ADR-0183, DEC-20261023-01
> **상태**: 설계 승인 — 런타임 코드 구현은 본 절의 후속 로우(Row 1+)에서 진행된다.
> **범위 관계**: §1–5(ADR-0128 협소 해석)를 폐기하지 않는다 — v2는 그 적용 범위를
> 자유 질의 표면에서 **모든 런타임 LLM 호출 지점**으로 확장하고, 관문 통과를
> 선언(옵션)에서 **강제(필수)**로 올린다.

### 6.1 문제 정의 (PM 검증, 2026-10-23)

사용자 원칙 "모든 LLM 호출은 PM 에이전트팀을 통해"는 부분 구현 상태다.

- 자유 질의(`POST /api/agents/query` → `lib/pm-router.ts`)만 런타임 PM을 경유한다.
- **19개 단계 산출물 API 라우트**와 **약 10개 lib 파이프라인 모듈**이
  `completeOrFallback`을 고정 에이전트 키와 함께 **직접 호출**한다. 이는
  ADR-0128 §1단계의 협소 해석("에이전트 키 선언으로 충분")의 귀결이며, 구현은
  해당 ADR에 부합한다 — 갭은 ADR의 범위와 사용자 의도 사이에 있다.
- `agent` 메타가 **옵션**이다. `lib/llm.ts`의 5개 진입점(`complete`,
  `completeDetailed`, `completeStructured`, `stream`, `completeOrFallback`)이
  `agent?: AgentCallMeta`를 받고, `logAgentCall`(llm.ts:576)은 메타 부재 시
  `if (!agent) return`으로 장부 기록을 **조용히 생략**한다.
- `pm-router.ts`의 분류 근거 `classifiedBy`는 `"llm" | "rules"`로 한정되어,
  카탈로그 기반 결정론 라우팅을 표현할 수 없다.

### 6.2 D1 — PM 활동 카탈로그 (generated SSOT 투영)

- **신규 제너레이터** `scripts/co-newbiz/generate-pm-catalog.ts` — 패턴:
  `scripts/co-newbiz/generate-spec-activities.ts`(결정론 출력 + `--check`
  드리프트 게이트, process-flow 테스트의 mirrors-spec 검증과 동일 규율).
  산출물: `app/web-next/lib/pm-catalog.generated.ts`.
- **3 SSOT 조인**:
  1. `app/web-next/prompts/prompts.json`(현재 39개 프롬프트 키·agent·purpose) —
     선택적 `activity` 필드를 추가해 프롬프트 키 ↔ flow.spec 활동을 연결한다.
  2. `process/flow.spec.yaml` activities — 활동 → 에이전트, 트랙 범위(greenfield/brownfield).
  3. `agents/*.md` 로스터 — 참조 검증(카탈로그의 모든 에이전트 키가 로스터에 존재).
- **동적 항목**: `agent: null` 프롬프트 2개(`s8.business_case_prose`,
  `committee.position`)는 카탈로그에서 "동적 항목"으로 분류된다 — 실행 시점
  활동 맥락(호출자가 선언한 agent 메타)으로 귀속되며, 카탈로그는 이를
  허용 목록에 명시적으로 표기한다.
- **pm-router 대체**: `pm-router.ts:64-66`의 하드코딩 11-에이전트 허용목록과
  정규식 규칙(pm-router.ts:30-61)을 카탈로그 데이터로 대체한다. 라우터의
  로직(규칙 우선 → LLM 폴백)은 유지하되, 허용 목록·활동 정의·에이전트 매핑은
  더 이상 코드에 두지 않는다.

### 6.3 D2 — 관문 강제 (Gateway enforcement)

- `lib/llm.ts` 5개 진입점에서 `agent: AgentCallMeta`를 **필수**로 바꾼다.
  부재 시 `PmGateError`를 throw하고, `agent.key`가 카탈로그/로스터에 존재하는지
  검증한다. 미등록 키도 `PmGateError`다.
- **서명 강화 마이그레이션 대상(전수 열거)** — 이미 agent 메타를 전달하는
  호출 지점이므로 컴파일러가 주도하는 기계적 마이그레이션이다:
  - 단계 산출물 API 라우트 19개:
    `api/brownfield/[oppId]/target-proposals/web-search`,
    `api/brownfield/[oppId]/targets/[targetId]/eval-draft`,
    `api/brownfield/[oppId]/targets/[targetId]/screening-draft`,
    `api/brownfield/[oppId]/universe-criteria-draft`,
    `api/greenfield/[oppId]/recommendation`,
    `api/market-overview/related-candidates`,
    `api/opportunities/[id]/attractiveness-recommendation`,
    `api/opportunities/[id]/gate-brief`,
    `api/opportunities/[id]/route-recommendation`,
    `api/opportunities/[id]/sketch`,
    `api/opportunities/discover`,
    `api/projects/[id]/business-case/adoption-recommendation`,
    `api/projects/[id]/deal-structure-recommendation`,
    `api/projects/[id]/gate-brief`,
    `api/projects/[id]/ic-review-steps`,
    `api/projects/[id]/milestones/suggest`,
    `api/projects/[id]/monitoring-brief`,
    `api/projects/[id]/reports/compose`,
    `api/projects/[id]/sites/regulatory-draft`
    (이상 `app/web-next/app/api/` 하위 route.ts. 제20번째 완전호출 파일인
    `api/agents/query`는 단계 산출물이 아니라 PM 라우터 표면으로서
    classifiedBy 확장만 적용한다.)
  - lib 파이프라인 모듈 10개:
    `lib/agent-chains.ts`, `lib/company-profile-crosscheck.ts`,
    `lib/company-profile-pipeline.ts`, `lib/competitor-web-proposals.ts`,
    `lib/market-sizing-pipeline.ts`, `lib/opportunity-factors.ts`,
    `lib/price-evidence.ts`, `lib/review/ai-second.ts`,
    `lib/synergy-pipeline.ts`, `lib/synergy-rescore.ts`
    (정의 지점 `lib/llm.ts`와 PM 표면 `lib/pm-router.ts`는 별도 대상.)
- **"LLM 없이도 완전 기능" 유지**: 선언 강제는 LLM 구성과 무관한
  컴파일/런타임 불변식이다. 폴백 경로도 agent 메타를 요구하며, 메타가 없어서
  장부가 생략되는 경로는 존재하지 않게 된다.
- **`classifiedBy` 확장**: `"catalog" | "llm" | "rules"`. 카탈로그 활동으로의
  결정론 귀속(`catalog`)을 신설하고 기존 두 값은 유지한다. 런 장부와
  콘솔(/flows)이 이 근거를 표시한다.

### 6.4 D3 — 전체 플랫폼 하네스↔런타임 패리티 가드

- **플랫폼 중립 SSOT 원칙**: 7개 플랫폼(claude, gemini, antigravity,
  gemini-cli, codex, hermes, zai)이 각자의 방식으로 `agents/*.md` 등 SSOT을
  소비한다 — 훅 기반(claude: `.claude/settings.json`, gemini:
  `.gemini/settings.json`, codex: `.codex/hooks.json`), 프롬프트 부트스트랩
  기반(hermes, zai: AGENTS.md §0). **웹 런타임은 같은 SSOT에서 카탈로그를
  도출하는 8번째 소비자**다 — 런타임 전용 에이전트 정의를 만들지 않는다.
- **드리프트 게이트 연결**: 현재 미연결인 `generate-agent-registry.ts --check`
  (line 54)와 신규 `generate-pm-catalog.ts --check`를 dev-sync/audit 배터리에
  연결한다. audit 검사 패턴을 따른다: SSOT → 기대 집합 → 집합 차이 → 항목별
  Fail → 집계 Pass. **Skip은 Pass가 아니다**(self-skip은 사유와 함께 가시 출력).
- **모델 레지스트리 검증 확장**: `scripts/validate-model-registry.ts`(이미
  7-플랫폼 대상, `scripts/lib/platform-delivery.ts` self-skip 패턴 사용)에
  카탈로그 tier/model 검증을 추가한다.
- **등록**: 신규 스크립트를 `scripts/SCRIPTS.md`와 `scripts-snapshot.json`에
  등록한다.

### 6.5 D4 — 플로우 콘솔 `/flows` (읽기 전용, 벤치마크 기반 UX)

- **블루프린트 뷰**: S1–S12 → 활동 → 에이전트 → 프롬프트 키 + 스킬을 생성
  프러젝션(pm-catalog.generated.ts, spec-activities.generated.ts)에서 렌더한다.
  트랙 범위(greenfield/brownfield) 표시와 활동 단위 드릴다운을 제공한다.
- **런 장부 뷰**: `process_run` ↔ `activity_run` ↔ `agent_run` 조인
  (기반: `db/migrations/0045_process_execution.sql`, 0064 entity 일반화,
  0067 meta_json) + `llm_call_log`(0092, 사용량 열 0130)의
  ok/error/latency/tokens/cost/classifiedBy. EChart 타임라인으로 표시한다.
  기존 per-deal 표면(`GET /api/projects/[id]/agent-runs`, `lib/llm-rollup.ts`)과
  집계 로직을 재사용한다.
- **API**: `GET /api/flows`, `GET /api/flows/runs`. 인증은 `authenticate` +
  `requireBusinessActor(auth, "read")`(ADR-0146). 페이지네이션은 커서 방식 —
  admin audit-log의 limit+before 패턴(`app/api/admin/audit-log/route.ts:12-24`).
- **마이그레이션**: `agent_run.agent_key` 인덱스(현행 0045 계열에 인덱스 없음;
  기존 인덱스는 `idx_llm_call_log_agent`, `idx_llm_call_log_project`뿐).
- **내비**: `lib/navigation.ts`(ADR-0105 SSOT) "분석·참조" 섹션에 추가.
  `/agents`는 기존대로 NON_MENU_ROUTES에 두고, `/flows`는 메뉴 항목으로
  navigation.test.ts가 패리티를 강제한다.
- **UI**: Onyx 3.0 토큰 + `components/ui.tsx` + EChart 래퍼
  (`components/EChart.tsx`) 재사용. 신규 시각화 컴포넌트 최소화.
- **접근성(Accessibility)**: WCAG 2.1 AA — 활동 드릴다운과 뷰 전환의 키보드
  조작·가시 포커스, EChart 타임라인에 데이터 테이블 대체 제공, 상태(ok/error)
  를 색 단독이 아닌 아이콘+텍스트로 표시, `prefers-reduced-motion` 존중.
  검증은 `accessibility-audit` 스킬(가용 시) 또는 문서화된 수동 체크리스트.
- **⏳ UX 벤치마크 노트 예약 슬롯 (Row 2 산출물 — 부록 첨부 예정)**:
  본 콘솔의 UX 설계는 **외부 벤치마킹에서 출발**해야 하며, 대상은
  (a) LLM 관찰가능성 콘솔 — LangSmith, Langfuse, Braintrust, Arize Phoenix,
  W&B Weave, (b) 워크플로/DAG 콘솔 — Dagster, Airflow, GitHub Actions,
  (c) 프롬프트 실험 UI — LangSmith Playground, Anthropic Workbench,
  OpenAI Playground다. 벤치마크 노트는 UX 로우(Row 2)에서 산출되어 본 문서에
  **부록(addendum)으로 첨부**된다. D4·D5 화면 구현은 해당 부록의 근거를
  인용해야 하며, 부록 도착 전 화면 구현을 착수하지 않는다.

### 6.6 D5 — 드라이런 실험 레인

- **SSOT 불변**: 프롬프트 교체·에이전트 재배정 등 오버라이드는 **세션 스코프
  저장소에만** 존재한다. 영구 반영의 유일한 경로는 제안 패키지 → 저장소 PR
  (Design Gate)다. 콘솔에서 SSOT을 직접 편집하는 경로를 만들지 않는다.
- **구성요소**: (1) 오버라이드 편집기 — 단일 활동 단위, 카탈로그/로스터 검증
  (존재하지 않는 에이전트 키·프롬프트 키는 저장 불가), (2) 드라이런 실행 —
  **실제 운영 코드 경로**를 통과한다(동일 `completeOrFallback` 호출 + 오버라이드
  컨텍스트; 실험 전용 복제 경로를 만들지 않는다), (3) base-vs-override A/B
  비교 + 사용자 선호 기록(골든셋 시드), (4) 제안 패키지 내보내기(diff +
  드라이런 증거 동봉).
- **장부 위생**: 드라이런 호출은 `llm_call_log`에 `is_dry_run` +
  `dry_run_group_id` 플래그로 기록된다. 운영 대시보드는 기본적으로 제외하고,
  세션당 비용을 표시하며 실행 전 확인을 요구한다.
- **경계**: 드라이런 결과는 **비즈니스 테이블에 절대 기록되지 않는다** —
  데이터 신뢰도/RAG 상한 경계(ADR-0016 계열)가 유지된다.
- **v1 범위**: 단일 활동 드라이런. 체인·위원회 전체 드라이런은 후속.

### 6.7 D6 — AI 개선 제안

- **제안 전용**: 프롬프트 개선 제안(목적 + 최근 실패/산출 근거 동봉)과 에이전트
  재배정 제안(로스터 대안 + 근거)을 생성한다. 수락은 드라이런 세션 오버라이드에만
  적용되며, 저장소 반영은 제안 패키지 경로(D5)로만 가능하다.
- **제안 호출 자체도 관문 통과**: 신규 카탈로그 활동 키 `pm.flow_suggest`를
  prompts.json에 등록하고, 제안 LLM 호출이 PM 관문 + 런 장부를 통과한다.
- **인증**: `requireBusinessActor(auth, "write")` + appendAudit.

### 6.8 D7 — 경계·마이그레이션

- 위원회석 SSOT는 `procedures/_committees.yaml`에 유지된다 — 콘솔·카탈로그는
  이를 복제하거나 대체하지 않는다.
- **DB 마이그레이션 총 3개**: (1) `agent_run.agent_key` 인덱스,
  (2) `llm_call_log` 드라이런 플래그, (3) `dry_run_session` 테이블 + TTL 정리.
  스키마 변경의 ADR 트리거 충족 — 본 개정의 근거 ADR은 ADR-0183이다.
- 제안 전용 불변식: 모든 AI 산출물은 제안이며, 게이트 결정은 사람이 기록한다
  (경계 #2, ADR-0094).

### 6.9 테스트 영향

- **기존 확장**:
  - `tests/unit/llm-structured.test.ts` — agent 메타 필수화·PmGateError.
  - `tests/unit/llm-executors.test.ts` — 동적 키 경로(llm-executors)의 필수 메타.
  - `tests/unit/admin-business-write-guard.test.ts` — /flows 읽기 게이트와
    드라이런 쓰기 경로의 비즈니스 쓰기 차단.
  - `tests/unit/navigation.test.ts` — /flows 내비 패리티.
  - `tests/unit/process-flow.test.ts:90-97` — flow.spec 활동 에이전트 vs 로스터
    교차검증을 카탈로그 검증으로 확장.
- **신규**: 게이트 강제 테스트(메타 부재·미등록 키 → PmGateError, dry-run
  컨텍스트 예외 없음), 카탈로그 드리프트 테스트(generated vs SSOT), 드라이런
  경계 테스트(비즈니스 테이블 무기록, 장부 플래그 기록, 운영 대시보드 제외).

### 6.10 비목표 (Non-goals)

- 체인·위원회 전체 드라이런(v1은 단일 활동).
- 콘솔에서의 SSOT 직접 편집.
- 런타임 에이전트 프레임워크 도입(AdalFlow 류 — 거부 근거는 ADR-0183).
- 호출 지점마다 LLM 분류기를 두는 라우팅(고정 의미론 엔드포인트의 오분류 위험).
- 결정 자동화 — 모든 게이트 결정은 사람(ADR-0053/0094).

### 6.11 구현 로우(Rows 1+)

본 §6은 설계 전용 개정이다. `lib/llm.ts`, `lib/pm-router.ts`, 라우트 파일,
테스트, 마이그레이션에 대한 런타임 변경은 승인된 계획의 후속 로우에서
수행되며, 각 로우는 본 문서의 해당 소절을 근거로 인용한다.
