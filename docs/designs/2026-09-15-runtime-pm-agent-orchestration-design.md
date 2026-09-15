---
lang: ko
lang_reason: source-material
---

# 런타임 PM 에이전트 오케스트레이션 설계 (Runtime PM Agent Orchestration) — 2026-09-15 백필

> **근거**: ADR-0128, ADR-0118, AGENTS.md PM Gateway
> **상태**: 구현 완료(커밋 355c56eb) — 본 문서는 Design Gate(ADR-0074) 등록 누락의 사후 보완(backfill)이다.
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
