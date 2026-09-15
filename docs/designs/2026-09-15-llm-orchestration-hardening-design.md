---
lang: ko
lang_reason: source-material
---

# LLM 오케스트레이션 경화 설계 (LLM Orchestration Hardening) — 2026-09-15

> **근거**: ADR-0128(런 장부), ADR-0118(analyst+ floor), scoped project review 2026-09-15
> **상태**: implemented
> **검증 게이트**: `bun scripts/test-runner.ts unit` · `bun scripts/audit.ts`

---

## 1. 문제

scoped 프로젝트 리뷰(외부 LLM API 사용의 PM 오케스트레이션 점검)에서 세 가지
계약 이탈이 발견되었다.

1. 일부 호출 지점이 `agent` 메타를 생략하거나 `complete()`를 직접 호출해
   `llm_call_log` 장부에서 보이지 않았다(ADR-0128 §1단계 위반).
2. `GET /api/synergy/web-search`가 analyst+ 검증 없이 유료 Tavily 검색을
   노출했다(ADR-0118 floor 위반).
3. S6 대상 후보 웹검색 제안의 장부 agent_key(brownfield-agent)가
   `flow.spec.yaml`의 단계 활동 소유자(market-intelligence-agent)와 불일치했다.

## 2. 변경

1. **장부 커버리지 완전화** — `lib/llm.ts`의 `complete()`가 `agent` 메타를 받아
   성공/실패를 직접 장부에 기록한다. `completeOrFallback`의 llm 경로 기록은
   `complete()`로 이관해 이중 기록을 제거한다(폴백 경로 기록은 유지).
   파이프라인 내 무기록 호출 지점 7곳(synergy 2, opportunity-factors 1,
   company-profile-crosscheck 0 — 기존 기록 확인됨, market-sizing 3 등)에
   소유 에이전트 키를 flow.spec 기준으로 부여한다. `llm-executors.ts`
   (사업성 분석·DD 테일러)와 `committee-llm.ts`의 직접 `complete()` 호출에도
   agent 메타를 추가한다.
2. ** analyst+ floor 적용** — synergy web-search 라우트에 viewer 거부 검증을
   추가한다(기존 screening-draft 라우트와 동일 패턴).
3. **장부 키 정렬** — S6 target-proposals/web-search의 agent_key를
   `market-intelligence-agent`로 변경해 flow.spec SSOT와 일치시킨다.
4. **관찰 가능성·구성 강화(부수)** — Tavily 오류 시 `console.error`로 원인을
   남긴다(침묵 `[]` 반환은 유지하되 진단 가능). `.env` 파서가 따옴표를 제거한다.
   `classifyIndustryKsic`의 LLM 선정 KSIC 기입에 `appendAudit`
   (`md_industry.ksic_llm_fill`)를 남긴다.
5. **문서 정합성** — AGENTS.md의 ADR-0078 인용을 "workspace-root"로 한정해
   동일 번호의 프로젝트 내 ADR과의 혼동을 제거한다.

## 3. 제약

- LLM 출력은 여전히 제안 전용이며, 어떤 경로도 게이트 기록을 직접 쓰지 않는다.
  유일한 DB 기입 경로(KSIC 화이트리스트 분류)는 NULL 전용 컬럼 + 큐레이티드
  마스터 제한 + 감사 기록으로 축소된 위험이다.
- 재시도 시 maxTokens 4배 증폭, 일일 예산 부재 등 비용 통제 개선은 후속
  과제로 남긴다(리포트 참조).

## 4. 검증

- `bun scripts/test-runner.ts unit` 통과, `bun scripts/audit.ts` 통과.
- 모든 `completeOrFallback`/`complete` 호출 지점이 `agent` 메타 또는 명시적
  예외로 장부에 귀속됨을 코드 스캔으로 확인.
