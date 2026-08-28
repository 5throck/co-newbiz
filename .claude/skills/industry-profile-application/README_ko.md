# industry-profile-application

> **`SKILL.md` 프론트매터에서 생성됨 (2026-08-28 per-skill README 표준, CONSTITUTION §6.2).** 자유롭게 보강하세요 — 이 파일은 자동 재생성되지 않습니다.

## 목적

산업 특화 프로필 데이터(ADR-0024의 프로필 우선 원칙: 단일 `industry-lead` 에이전트, `industry-profiles/*.yaml`로 표현되는 커버리지, 5개 판단 집약적 절차 성숙도 임계값을 넘어야만 전용 에이전트가 정당화됨)를 프로젝트의 대상 산업에 적용합니다. 2026-08-21 기준 `industry-profiles/_schema.yaml`과 `_validate.ts`는 존재하지만(`region-profiles/`의 계약을 그대로 미러링), 실제 프로필 `.yaml` 파일은 아직 하나도 작성되지 않은 실제 격차로 명시적으로 표시됩니다.

- **스코프(scope)**: `co-newbiz`
- **버전**: 1.0.0

## 사용 시점

- 위 목적에 해당하는 작업을 수행할 때 로드합니다 (`SKILL.md` 설명 참조).

## 사전 조건

none

## 사용 방법

```
<SKILL.md의 지시에 따라 호출 — 또는 플랫폼 스킬 레지스트리를 통해 AI 스킬로 로드>
```

권한 지침과 프론트매터는 [SKILL.md](SKILL.md)를 참조하세요.
