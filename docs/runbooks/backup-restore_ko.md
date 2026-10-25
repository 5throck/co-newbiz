---
lang: ko
lang_reason: source-material
counterpart: backup-restore.md
---

# Runbook — 백업, 복원, 롤백

**Owner**: dba, release-engineer
**Design of record**: ADR-0014 (배포/롤백 규율), ADR-0015 (운영 리듬/SLO), `docs/security/security-baseline.md`
**Status**: Stage 5 Wave 5.9 — 오늘날 실행 가능. 실제 리허설로 검증됨(§4).

## 1. 도구

| 스크립트 | 목적 |
|---|---|
| `bun scripts/co-newbiz/backup.ts [--db-path <path>] [--backup-dir <dir>]` | WAL을 체크포인트(TRUNCATE 모드)하고, 메인 DB 파일을 복사하며, 그 옆에 행 수 매니페스트를 작성합니다. |
| `bun scripts/co-newbiz/restore.ts <backup-file> [--db-path <path>]` | 라이브 DB 위에 백업을 복원하고 모든 테이블의 행 수를 백업의 매니페스트와 대조 검증 — 불일치 시 크게 실패(0이 아닌 종료 코드). |

모든 백업은 두 개의 파일을 생성합니다: `<name>.sqlite.<timestamp>.bak`과 `<name>.sqlite.<timestamp>.bak.manifest.json`. 매니페스트는 복원에 필수입니다 — 매니페스트 없는 백업 파일은 복원할 수 없습니다(ADR-0015: "복원된 적 없는 백업은 검증되지 않은 것" — 이 원칙은 좋은 관행으로 권장되기만 하는 것이 아니라 검증 불가능한 복원의 거부로 시행됨).

## 2. 백업 — 시점

- **모든 마이그레이션 직전** (ADR-0014) — "최근에"가 아니라 "직전"에.
- **매일** (`docs/governance/ops-cadence.md`의 주기 테이블, Stage 5 자동화 행).
- 라이브 데이터에 의미 있는 영향 반경을 갖는 모든 작업 전.

## 3. 롤백 (마이그레이션) 절차

1. 실행하려는 마이그레이션의 파일 헤더에 `@reversible: true` 태그가 있는지 확인 — `db/migrations/`의 모든 마이그레이션이 이 태그를 가짐(Wave 5.9에서 마이그레이션 0001-0009에 소급 추가; `db-migration-governance`에 따라 모든 신규 마이그레이션에 필수).
2. `bun scripts/co-newbiz/backup.ts` — 이것이 곧 롤백 계획입니다; 이 코드베이스에는 마이그레이션별 DOWN 스크립트가 별도로 없습니다(SQLite + 프로젝트의 forward-only 마이그레이션 러너).
3. 마이그레이션 적용 (`bun scripts/co-newbiz/newbiz.ts db:migrate`).
4. 헬스 체크 실행(API 서버가 시작되고 `/api/health`가 응답하는지 확인, 마이그레이션된 스키마에 대해 `bun test` 통과 확인).
5. **롤백이 필요한 경우**: `bun scripts/co-newbiz/restore.ts <2단계에서 만든 백업>`. 마이그레이션 이전 상태를 복원하고 검증합니다.
6. 되돌릴 수 없는 마이그레이션(`@reversible: false`)은 3단계 이전에 release-engineer + dba 공동 서명 필요 — 기본 검토보다 높은 기준.

## 4. 리허설 로그

**2026-08-20 — Wave 5.9, 첫 실제 리허설** (`deployment-and-release`/`database-operations` 스킬 자체의 규율을 서술에 그치지 않고 실제로 실행):

- **복구 훈련**: 2개 행을 시드한 새로 마이그레이션한 스크래치 DB → 백업 → 라이브 파일 삭제(전체 데이터 손실 시뮬레이션) → 복원 → 행 수와 실제 행 내용 모두 일치 확인. **통과.**
- **롤백 리허설**: 스크래치 DB를 0009까지 마이그레이션 → 백업(마이그레이션-0010 이전 상태) → 마이그레이션 0010(`idx_audit_log_created_at`, 실제로 유용한 인덱스 — 해당 파일 참조) 적용 및 존재 확인 → 0010 이전 백업으로 복원 실행 → 인덱스가 사라지고 `schema_migrations`가 9행으로 돌아온 것 확인. **첫 시도는 실패**(§5 참조); **수정 후 두 번째 시도는 통과.**

## 5. 리허설에서 발견된 결함 (및 리허설 규율이 중요한 이유)

첫 롤백 리허설 시도는 "복원 검증됨"을 보고했지만 마이그레이션의 효과(새 인덱스)가 이후에도 여전히 존재했습니다 — `restore.ts`가 백업의 메인 `.sqlite` 파일을 라이브 경로에 복사했지만 라이브 DB 자체의 `-wal`/`-shm` 사이드카 파일을 그대로 남겨두었습니다. SQLite는 다음 열림 시 남아 있는 WAL 프레임(백업 이후의 마이그레이션-0010 쓰기를 포함)을 재생하여 복원이 되돌리려 했던 바로 그 쓰기를 조용히 다시 적용했습니다 — 행 수 검증조차 통과했는데 검증이 실제로 복사된 파일이 아니라 WAL 재생이 이미 데이터를 다시 추가한 *이후의* DB에 대해 실행되었기 때문입니다.

사이드카 파일을 복원 후에 삭제하는 방식은 피했습니다(테스트 중 Windows 파일 잠금 타이밍 문제도 있었음). 대신 닫기 전에 라이브 연결 자체의 WAL을 제자리에서 체크포인트-절단(`PRAGMA wal_checkpoint(TRUNCATE)`)하고 백업을 그 위에 복사하는 방식으로 수정했습니다. 수정 후 재리허설 — 통과. 이것이 `deployment-and-release` 스킬 파일이 "한 번도 실행된 적 없는 롤백 계획은 검증된 것이 아니라 미증명 상태"라고 말할 때 가리키는 구체적 사례입니다: 이 결함은 코드 리뷰만으로는 발견되지 않았을 것이며 실제 복원 후 검증을 통해서야 드러났습니다.

## 6. 관련 문서

- `db/migrations/0010_audit_log_created_at_index.sql` — 리허설에 사용된 마이그레이션(일회용이 아닌 실제로 유용한 인덱스)
- `tests/unit/backup-restore.test.ts` — 이 동작에 대한 인코딩된 회귀 테스트
- `skills/deployment-and-release/SKILL.md`, `skills/database-operations/SKILL.md` — 이 runbook이 구현하는 운영 규율
