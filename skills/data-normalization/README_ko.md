# data-normalization

> **`SKILL.md` 프론트매터에서 생성됨 (2026-08-28 per-skill README 표준, CONSTITUTION §6.2).** 자유롭게 보강하세요 — 이 파일은 자동 재생성되지 않습니다.

## 목적

수집된 원본 데이터(한국 DART 계정명, 산업 코드, 법인 식별자)를 `db/mappings`/`python/mappings` 테이블 기준으로 표준 스키마에 맞게 정규화하며, 매칭되지 않는 값은 버리거나 추측하지 않고 `master-data-governance`의 `staging_unmapped` 큐로 라우팅합니다.

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
