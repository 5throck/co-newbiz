# two-tier-approval-chain

> **`SKILL.md` 프론트매터에서 생성됨 (2026-08-28 per-skill README 표준, CONSTITUTION §6.2).** 자유롭게 보강하세요 — 이 파일은 자동 재생성되지 않습니다.

## 목적

Entity IC -> Group IC 승인 체인을 실행합니다: Entity IC 승인이 Group IC 제출 자격을 결정하고(ADR-0028의 직교하는 범위 x 레벨 축), Group IC는 경쟁하는 안건 중에서의 순위 결정이며 단순 예/아니오가 절대 아닙니다(ADR-0029). `db/lib/approval-chain.ts`와 `GET /api/projects/:id/approval-chain`이 뒷받침합니다.

- **스코프(scope)**: `co-newbiz`
- **버전**: 1.1.0

## 사용 시점

- 위 목적에 해당하는 작업을 수행할 때 로드합니다 (`SKILL.md` 설명 참조).

## 사전 조건

none

## 사용 방법

```
<SKILL.md의 지시에 따라 호출 — 또는 플랫폼 스킬 레지스트리를 통해 AI 스킬로 로드>
```

권한 지침과 프론트매터는 [SKILL.md](SKILL.md)를 참조하세요.
