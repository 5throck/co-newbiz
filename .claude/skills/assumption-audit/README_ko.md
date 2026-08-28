# assumption-audit

> **`SKILL.md` 프론트매터에서 생성됨 (2026-08-28 per-skill README 표준, CONSTITUTION §6.2).** 자유롭게 보강하세요 — 이 파일은 자동 재생성되지 않습니다.

## 목적

모든 `assumption` 행의 `kind` 태그(`user`/`assumed`/`derived`)의 정확성을 감사합니다 — `kind='assumed'` 항목은 비어 있지 않은 `rationale`이 필요하며, 없으면 서버 측에서 거부됩니다. 삼각검증되지 않은 주장은 절대 조용히 `derived`로 격상되지 않습니다. 핵심 수치(WACC, 허들 IRR)는 게이트가 열리기 전에 반드시 `assumed`가 아닌 `user`여야 합니다.

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
