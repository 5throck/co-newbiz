# data-freshness-and-revision-control

> **`SKILL.md` 프론트매터에서 생성됨 (2026-08-28 per-skill README 표준, CONSTITUTION §6.2).** 자유롭게 보강하세요 — 이 파일은 자동 재생성되지 않습니다.

## 목적

ADR-0004의 캐시 우선, 리비전 보존 페치 정책을 일상적으로 운영합니다: 활성 시리즈 전반의 캐시 노후화를 모니터링하고, 실제 리비전 발생 시 `data_change_log` 항목이 기록되는지 확인하며, 어떤 코드 경로도 `revision_no` 행을 덮어쓰지 않고 새로 삽입하는지 감사합니다. `market-data-pipeline`의 구현 레벨 정책에 대응하는 플랫폼 운영 카운터파트입니다.

- **스코프(scope)**: `co-newbiz`
- **버전**: 1.0.0

## 사용 시점

- 위 목적에 해당하는 작업을 수행할 때 로드합니다 (`SKILL.md` 설명 참조).

## 사전 조건

(none)

## 사용 방법

```
<SKILL.md의 지시에 따라 호출 — 또는 플랫폼 스킬 레지스트리를 통해 AI 스킬로 로드>
```

권한 지침과 프론트매터는 [SKILL.md](SKILL.md)를 참조하세요.
