---
lang: ko
lang_reason: source-material
---

# agents/ (한국어 README)

co-newbiz 신사업 심사 팀의 에이전트 정의 파일. 정본 로스터(수량·도메인·티어)는
[`AGENTS.md`](../AGENTS.md)에 있다 — 이 README는 구조와 디스패치 모델을 설명하며
로스터를 중복하지 않는다.

## 파일 구조

모든 에이전트 파일은 정본 9-섹션 본문 표준(설계
[`docs/designs/2026-10-25-agent-and-context-ssot-upgrade-design.md`](../docs/designs/2026-10-25-agent-and-context-ssot-upgrade-design.md))을
순서대로 따른다:

1. **Legal Basis** — 역할의 권한/법적 근거, 형제 에이전트 소유권을 명시하는 **Boundary** 단락으로 끝난다
2. **Role**
3. **Responsibilities** — flow.spec 액티비티 / 절차 스텝에 묶인 볼드 라벨 불릿
4. **Protocols** — 고정된 4개 H3 하위 섹션: `⚠️ PM-ONLY INVOCATION`(모든 파일에서 동일한 3단계 거절 스크립트), `Dispatch Protocol`(Can Lead Stages / Can Support In / Auto-Dispatch To / Requires Prior Output From / Tier / Communication Style), `Output Format`, `Output Destination`(`process/flow.spec.yaml` 스테이지 산출물과 `docs/co-newbiz.context.md`를 가리키는 SSOT 인용 블록)
5. **Constraints** — 올바른 리다이렉트가 붙은 Do-NOT 불릿
6. **Meeting Participation** — Voice & Stance / In every turn you MUST / You do NOT
7. **Engagement Context** — 스테이지 진입/종료, 재투입 트리거, 실제 참여 방식
8. **Deliverable Standards**
9. **Special Instructions**

프론트매터 계약: 신원 키(`name`, `formal_name`, `status`, `domain`, 4개 플랫폼 `tier`, `model`, `lifecycle` 블록)에 리라이트 추가분 — `role`(한 줄), `color`, "Use when:" 디스패치 트리거로 보강된 `description`, `examples`, `phases`, `handoff_to` / `handoff_from`(비-지원종료 에이전트 이름만; `procedures/_human-roles.yaml`의 인간 역할은 금지된 대상), `required_skills`. 분량 밴드: 도메인 리드 170–200줄, 스페셜리스트 140–170줄.

각 에이전트는 `AGENTS.md`에 등록하고 `bun run agent:verify`로 검증한다.

## 에이전트 클래스 (준비성 감사 2026-08-23; 2026-09-04 확장)

41개 에이전트 — 4개 클래스와 그 밖의 2개(`pm` 조정자 자신, 공유 `i18n-specialist`)로 구성 — 개별 이름이 아니라 클래스가 안정적 계약이다:

| 클래스 | 수 | 디스패치 동작 |
|---|---|---|
| 도메인 리드 | 4 | 신사업심사 리드 산하의 설계/검토 소유자(functional `process-governance-manager`, technical `platform-lead`, industry `industry-lead`, region `region-lead`). PGM 외 리드는 **설계상 절차 스텝으로 디스패치되지 않는다** — 산업/지역 입력은 `industry-profiles/` / `region-profiles`와 리드 협의로 유입 (`process-governance-manager`는 예외적으로 ×16 스텝, `region-lead`는 EU 오버라이드 ×1 디스패치) |
| 딜심사 스페셜리스트 | ~25 | 절차 스텝의 `agent_key`로 디스패치(15개 공유 절차 + 오버라이드 레이어의 85 AI 스텝). 2026-09-04 추가된 ADR-0097 상임 위원회의 6개 기능 전문가 석(`financing-agent`, `site-facility-agent`, `legal-counsel`, `hr-integration-agent`, `ir-agent`, `ip-agent`)을 포함한다; 기술 도메인의 2개 디자인 석(`design-system-agent`, `ux-designer-agent`)은 `agent_key` 스텝 없이 빌드/런 라운드에서 PM이 디스패치하는 디자인 작업이다. 준비성 감사에서 이 클래스는 **완전** — 미디스패치 딜심사 에이전트 없음 |
| 빌드/런 | 8 | `data-architect`, `dba`, `backend-engineer`, `frontend-engineer`, `release-engineer`, `sre`, `infra-automation-engineer`, `security-engineer`. 런타임 경화 라운드가 `app/web-next` / `scripts/` 작업을 시작하기 전까지 대기 |
| 비딜 지원 | 2 | `glossary-curator`, `docs-writer` — 거버넌스/문서화, 딜 심사 외부 |

## 인간 역할은 에이전트 파일이 아니다

게이트 승인과 투자 의사결정은 인간의 것이다(비협상 경계 #2). 인간 권한은
[`procedures/_human-roles.yaml`](../procedures/_human-roles.yaml)에 등록된다 —
현재 `entity-ic-reviewer`, `bau-exit-certifier`, `venture-portfolio-ic`,
`execution-baseline-confirmer`.
이들을 위한 에이전트 파일을 만들지 않는다; 스킬-그래프 테스트가 4개 인간
권한 스텝을 고정한다.

## 디스패치 모델

에이전트는 PM이 절차 스텝을 통해 디스패치한다(스텝별 `agent_key` + `skill_key` +
`output_type`) — 임의 디스패치는 없다. what/when은 `procedures/**/schema.yaml`,
how는 `skills/`가 소유한다. 전체 디스패치/무디스패치 분석은
[`docs/audits/2026-08-23-readiness-audit.md`](../docs/audits/2026-08-23-readiness-audit.md) §3.2.

핸드오프 엣지는 참고 정보다: `handoff_to`는 이 에이전트의 1차 산출물이 다음으로 흐르는 곳을,
`handoff_from`은 그 산출물이 필요한 상대를 가리킨다 — 모든 디스패치는 PM이 중재하므로
모든 절차적 접점이 엣지를 필요로 하지는 않는다.

## 라이프사이클 규칙

`agents/**` 수정은 다음을 요구한다: `AGENTS.md` 로스터 갱신, 도메인 수 검증,
README 재검증(`bun run agent:verify`, `bun run validate-agents`) —
[`docs/context.md`](../docs/context.md)의 Co Newbiz 라이프사이클 규칙에 따른다.
