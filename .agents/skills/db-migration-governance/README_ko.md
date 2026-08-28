# db-migration-governance

> **`SKILL.md` 프론트매터에서 생성됨 (2026-08-28 per-skill README 표준, CONSTITUTION §6.2).** 자유롭게 보강하세요 — 이 파일은 자동 재생성되지 않습니다.

## 목적

ADR-0001/0002 규약에 따라 `db/migrations/*.sql`을 작성하고 검토합니다 — SQLite 엔진, ULID 기본키, ISO-8601 TEXT 날짜, CHECK 제약 열거형, 정수 최소 단위 화폐, AUTOINCREMENT/INSERT OR REPLACE 금지, PRAGMA foreign_keys=ON — 그리고 설계 §7의 ADR 트리거 목록에 해당하는 모든 스키마 변경이 병합 전 ADR을 갖추었는지 확인합니다.

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
