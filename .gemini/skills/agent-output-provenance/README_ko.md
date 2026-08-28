# agent-output-provenance

> **`SKILL.md` 프론트매터에서 생성됨 (2026-08-28 per-skill README 표준, CONSTITUTION §6.2).** 자유롭게 보강하세요 — 이 파일은 자동 재생성되지 않습니다.

## 목적

에이전트가 생성한 모든 산출물에 생성 에이전트, 신뢰도 등급, 인간 검토 기록을 각인한 뒤에야 완료로 간주합니다 — `docs/process-map.md`의 `analysis_task.reviewed_by` 필드가 그 구체적인 메커니즘입니다(NULL 값은 Entity IC를 차단). 2026-08-28 기준으로 쓰기/UI 경로가 구현되어 있습니다: `GET/POST /api/projects/:id/analysis-tasks`(Entity IC/Group IC에서 필요한 산출물을 지연 생성)와 `POST /api/projects/:id/analysis-tasks/:taskId/review`(`reviewed_by`의 유일한 쓰기 경로, 인간의 최종 승인) 및 'Review Status' 탭(`ReviewStatusTab.tsx`)이 있습니다. kill-criteria 점검(`db/lib/snapshot-filler.ts`)은 이제 이전의 항상 비어 있던 테이블 대신 실제 검토 상태를 반영합니다.

- **스코프(scope)**: `co-newbiz`
- **버전**: 1.2.0

## 사용 시점

- 위 목적에 해당하는 작업을 수행할 때 로드합니다 (`SKILL.md` 설명 참조).

## 사전 조건

(none)

## 사용 방법

```
<SKILL.md의 지시에 따라 호출 — 또는 플랫폼 스킬 레지스트리를 통해 AI 스킬로 로드>
```

권한 지침과 프론트매터는 [SKILL.md](SKILL.md)를 참조하세요.
