# incentive-clawback-assessment

> **`SKILL.md` 프론트매터에서 생성됨 (2026-08-28 per-skill README 표준, CONSTITUTION §6.2).** 자유롭게 보강하세요 — 이 파일은 자동 재생성되지 않습니다.

## 목적

예정된 이전이나 구조조정에 대한 클로백(clawback) 노출을 인센티브 인벤토리(예정 및 이미 부여된 것 모두)에서 검토합니다 — ADR-0030의 설계는 인수와 클로백을 하나의 레코드에 유지합니다(`direction: prospective|granted`, `obligation_json`, `clawback_rule`). 인센티브 수령이 곧 클로백 리스크가 되는 의무를 발생시키기 때문입니다. 필수 Brown Field DD 검증 항목입니다(ma-09).

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
