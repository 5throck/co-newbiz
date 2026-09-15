---
lang: ko
lang_reason: source-material
---

# 프롬프트 레지스트리 설계 (Prompt Registry) — 2026-09-15

> **근거**: ADR-0128(런 장부 agent_key·purpose), ADR-0118(제안 전용 원칙), 사용자 요청 2026-09-15
> **상태**: implemented
> **검증 게이트**: `bun scripts/test-runner.ts unit` (tests/unit/prompt-registry.test.ts) · `bun scripts/audit.ts`

---

## 1. 문제

시스템 프롬프트·소유 에이전트 키·장부 purpose가 26개 파일 30여 개 호출 지점에
문자열 리터럴로 하드코딩되어 있었다. 문구 하나 수정에도 코드 PR·빌드가 필요하고,
어떤 프롬프트가 존재하는지 전수 파악이 불가능하며, 장부 키가 flow.spec SSOT와
어긋나도(2026-09-15 M6 사례) 기계가 잡지 못했다.

## 2. 설계

에이전트 레지스트리(`agents/*.md` → `agent-registry.generated.ts`)와 동일한
생성형 패턴을 프롬프트에 적용한다.

1. **SSOT** — `app/web-next/prompts/prompts.json`. 항목: `key`(단계.표면 명명,
   예 `s6.target_proposal_web_search`), `agent`(null이면 호출 시점 지정),
   `purpose`(런 장부 문구), `system`(시스템 프롬프트 원문). JSON인 이유:
   언어 게이트가 `.md`/`.yaml`만 스캔하므로 한국어 프롬프트를 담으려면
   `.json`이어야 한다(ksic-master.json 선례).
2. **생성기** — `scripts/co-newbiz/generate-prompt-registry.ts`가 SSOT를
   `app/web-next/lib/prompts.generated.ts`(타입 리터럴 `PromptKey` 포함)로
   투영한다. 직접 수정 금지, 재생성으로만 갱신.
3. **접근 헬퍼** — `app/web-next/lib/prompts.ts`: `promptSystem(key)`,
   `systemMessage(key)`, `promptAgent(key, overrides?)`. agent=null 항목은
   오버라이드 키 없이 호출하면 즉시 예외.
4. **호출 지점** — 모든 LLM 호출 지점이 문자열 대신 키를 참조한다.
   동적 부분(사용자 메시지, pm-router의 로스터 접합, 단계별 에이전트 키)은
   코드가 SSOT 원문에 접합/오버라이드한다.
5. **무결성 테스트** — `tests/unit/prompt-registry.test.ts`: 생성물↔SSOT 동기화,
   키 유일성, 정적 agent가 로스터에 존재, 오버라이드 계약, 원문 왕복 일치.

## 3. 변경 범위

- 신규: `prompts/prompts.json`(29 항목), 생성기 스크립트(SCRIPTS.md 등록),
  `lib/prompts.ts`, `lib/prompts.generated.ts`, 무결성 테스트.
- 마이그레이션: 24개 파일 — lib 파이프라인 8개(synergy askJson은
  `PromptKey` 파라미터 시그니처로 변경, 사전 존재한 `S3 파이프라인` purpose
  오명명을 SSOT purpose로 교정) + API 라우트 16개.
- 동작 변경 없음: 프롬프트 원문은 왕복 검증으로 동일함을 보장했다.

## 4. 제약과 후속

- 프롬프트 변경은 여전히 재생성 → 테스트 → /sync PR 절차를 통과한다
  (거버넌스 유지; "배포 없는 문구 수정"은 의도하지 않는다).
- 파싱 계약("JSON만 출력")이 원문에 포함된 항목은 SSOT 편집 시 대응
  정규화기와 함께 검토해야 한다.
- 후속: 남은 인라인 agent 메타(동적 purpose를 쓰는 요약 호출 등)의 키
  정규화, `agent: { key: ... }` 인라인 패턴에 대한 린트(validator-hardening
  권고와 병행).
