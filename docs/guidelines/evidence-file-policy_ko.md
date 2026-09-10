---
lang: ko
counterpart: evidence-file-policy.md
---

# 가이드라인 — 근거 파일 업로드·보존

> **대상**: 우리회사 계열사와 딜의 근거 파일을 업로드하는 애널리스트, 보존
> 방침을 정하는 딜 리드, 백업을 수행하는 운영자.
> **강제력**: MUST로 표시된 규칙은 업로드 API가 강제하며, 나머지는 운영
> 규율입니다.

## 1. 근거 파일이란

신용평가자료, 감정평가서, 공시자료 등 회사 프로파일·시너지 분석의 근거가
되는 모든 첨부파일입니다. 근거 파일은 분석 결과물(`evidence_ref`)에서
참조되므로, 파일의 가용성은 그 분석의 감사 가능성의 일부입니다.

## 2. 업로드 규칙 (강제)

1. 역할: analyst 이상(viewer는 업로드 불가).
2. 크기: 파일당 0바이트 초과 **20MB 이하**.
3. 파일명 정리: 저장 이름은 `<ulid>-<정리된 원본 이름>`이며 원본 이름은
   응답·등록 정보에 보존됩니다.
4. 대상: 업로드는 우리회사 계열사(또는 시너지 흐름)에 귀속됩니다 — API가
   소유 엔티티의 존재를 검증합니다.

## 3. 저장 위치 (현행)

- 위치: 저장소 루트 아래 `workspace/uploads/` — SQLite DB와 함께 있으며
  백업 런북의 파일 범위에 포함됩니다.
- 업로드 디렉터리 경로는 `process.cwd()` 상대에서 저장소 루트 기준으로
  변경되고 `CO_NEWBIZ_UPLOADS_DIR` 환경변수로 설정 가능해질 예정입니다
  (이식성, ADR-0002) — `docs/designs/2026-09-10-deletion-followups-plan.md`
  Workstream C 참조.
- 서버 측 등록소(`uploaded_file` 테이블)와 인증된 다운로드 라우트도 같은
  workstream에서 제공 예정입니다. 제공 전까지는 업로드 응답의 `stored_as`
  값을 `evidence_ref` 필드에 즉시 기록하세요 — 등록되지 않은 파일은
  조회할 수 없습니다.

## 4. 보존과 삭제

- **파일은 소유자의 라이프사이클을 따릅니다.** 계열사나 딜이 삭제 표시되어도
  근거 파일은 유지됩니다 — 삭제 표시는 파일을 건드리지 않으며, 그 파일을
  참조하는 분석의 감사 가능성이 유지되어야 하기 때문입니다.
- 파일의 물리적 파기는 retention 엔진
  (`docs/designs/2026-09-10-deletion-followups-plan.md` Workstream E)을 통해
  명시적으로 등록된 정책으로만 도입될 수 있습니다. 현재 그런 정책은 없으며
  보존은 무기한입니다.
- 등록소 제공 전까지 `workspace/uploads` 아래 파일을 손으로 삭제하지
  마세요 — 다른 곳의 `evidence_ref`가 여전히 그 파일을 가리킬 수 있습니다.

## 5. 백업·이식성

- `workspace/uploads`는 `docs/runbooks/backup-restore.md`의 백업 범위에
  포함됩니다 — 업로드된 근거 파일을 데이터베이스와 동일한 릴리스 관련
  데이터로 취급하세요.
- 배포 디렉터리를 옮길 때는 `db/data/`와 함께 `workspace/uploads`도
  이전해야 합니다.

## 6. 관련 문서

- `docs/runbooks/deal-deletion-playbook_ko.md` — 삭제 표시는 파일을 유지
- `docs/designs/2026-09-10-deletion-followups-plan.md` — 등록소/다운로드
  라우트(C)와 retention 엔진(E) 계획
- `docs/runbooks/backup-restore_ko.md` — 백업 범위
