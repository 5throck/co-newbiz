# agents/ (한국어 README)

co-newbiz 신사업 심사 팀의 에이전트 정의 파일. 정본 로스터(수량·도메인·티어)는
[`AGENTS.md`](../AGENTS.md)에 있다 — 이 README는 구조와 디스패치 모델을 설명하며
로스터를 중복하지 않는다.

## 파일 구조

모든 에이전트 파일은 3-Section 구조를 따른다:

1. **Legal Basis** — 역할의 권한/법적 근거
2. **Role** — 책임과 범위
3. **Protocols** — 운영 절차와 디스패치 규칙

각 에이전트는 `AGENTS.md`에 등록하고 `bun run agent:verify`로 검증한다.

## 에이전트 클래스 (준비성 감사 2026-08-23)

34개 에이전트가 4개 클래스로 구성 — 개별 이름이 아니라 클래스가 안정적 계약이다:

| 클래스 | 수 | 디스패치 동작 |
|---|---|---|
| 도메인 리드 | 4 | 신사업심사 리드 산하의 설계/검토 소유자(functional `process-governance-manager`, technical `platform-lead`, industry `industry-lead`, region `region-lead`). PGM 외 리드는 **설계상 절차 스텝으로 디스패치되지 않는다** — 산업/지역 입력은 `industry-profiles/` / `region-profiles`와 리드 협의로 유입 (`process-governance-manager`는 예외적으로 ×16 스텝, `region-lead`는 EU 오버라이드 ×1 디스패치) |
| 딜심사 스페셜리스트 | ~21 | 절차 스텝의 `agent_key`로 디스패치(15개 공유 절차 + 오버라이드 레이어의 85 AI 스텝). 준비성 감사에서 이 클래스는 **완전** — 미디스패치 딜심사 에이전트 없음 |
| 빌드/런 | 8 | `data-architect`, `dba`, `backend-engineer`, `frontend-engineer`, `release-engineer`, `sre`, `infra-automation-engineer`, `security-engineer`. 런타임 경화 라운드가 `app/server` / `app/web` 작업을 시작하기 전까지 대기 |
| 비딜 지원 | 2 | `glossary-curator`, `docs-writer` — 거버넌스/문서화, 딜 심사 외부 |

## 인간 역할은 에이전트 파일이 아니다

게이트 승인과 투자 의사결정은 인간의 것이다(비협상 경계 #2). 인간 권한은
[`procedures/_human-roles.yaml`](../procedures/_human-roles.yaml)에 등록된다 —
현재 `entity-ic-reviewer`, `bau-exit-certifier`, `venture-portfolio-ic`.
이들을 위한 에이전트 파일을 만들지 않는다; 스킬-그래프 테스트가 4개 인간
권한 스텝을 고정한다.

## 디스패치 모델

에이전트는 PM이 절차 스텝을 통해 디스패치한다(스텝별 `agent_key` + `skill_key` +
`output_type`) — 임의 디스패치는 없다. what/when은 `procedures/**/schema.yaml`,
how는 `skills/`가 소유한다. 전체 디스패치/무디스패치 분석은
[`docs/audits/2026-08-23-readiness-audit.md`](../docs/audits/2026-08-23-readiness-audit.md) §3.2.

## 라이프사이클 규칙

`agents/**` 수정은 다음을 요구한다: `AGENTS.md` 로스터 갱신, 도메인 수 검증,
README 재검증(`bun run agent:verify`, `bun run validate-agents`) —
[`docs/context.md`](../docs/context.md)의 Co Newbiz 라이프사이클 규칙에 따른다.
