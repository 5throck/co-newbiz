# run-versioning-and-attribution

> **`SKILL.md` 프론트매터에서 생성됨 (2026-08-28 per-skill README 표준, CONSTITUTION §6.2).** 자유롭게 보강하세요 — 이 파일은 자동 재생성되지 않습니다.

## 목적

모든 분석이 불변 `run_input` 스냅샷과 `input_hash`를 가진 `run` 행을 생성하도록 보장합니다(모든 시뮬레이션은 추가로 `seed`를 기록). 동일한 시드와 입력값의 재실행은 반드시 동일한 출력을 재현해야 합니다 — 부가 기능이 아닌 검증 게이트입니다(ADR-0005, 설계 §12). 렌더링되는 모든 보고서는 run id / as_of / input_hash / version / policy_version을 자동으로 출력합니다.

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
