---
lang: ko
lang_reason: source-material
counterpart: deal-deletion-playbook.md
---

# 런북 — 딜 삭제·아카이브 (마킹, 보존, 감사)

> **언어**: **한국어** · [English](deal-deletion-playbook.md)
> **Owner**: compliance-officer (정책), deal lead (실행)
> **관련 화면**: `/projects`, `/projects/archives`, `/our-company`, `/synergy`, `/route-decision`

## 원칙

**아무것도 물리적으로 삭제하지 않습니다.** "삭제"는 행에 삭제 표시(`deleted_at`,
`deleted_by`, `delete_reason`)를 남기는 것입니다. 모든 목록·조회 화면이 표시된 행을
필터링하므로 활성 UI에서는 사라지지만, 원본 데이터는 그 자리에 그대로 남아 문제
발생 시 언제든 감사 점검이 가능합니다(append-only `audit_log`, FR-SEC-07, 그리고
ADR-0056 retire convention과 동일한 철학).

근거: 사후 감사는 "그 시점의 딜이 어떠했는지"를 재구성할 수 있어야 합니다.
스냅샷만 남기는 방식은 유실이 있지만, 원본 보존은 유실이 없습니다.

## 삭제의 단위

삭제의 단위는 **딜 체인 전체**입니다.

- 프로젝트 삭제: 프로젝트 **및 그 source opportunity**를 함께 마킹합니다.
  프로젝트 **lead** 역할만 실행할 수 있습니다(`/projects` 목록의 삭제 버튼).
- 미승격 기회 삭제: 기회만 마킹합니다(analyst+, `/opportunities` 목록).
- 마스터데이터(그룹/계열사): 표시 방식은 동일(analyst+).

구성요소는 딜이 살아 있는 동안 먼저 사라질 수 없습니다: `selected` 기회 또는
승격 프로젝트에 연결된 시너지 분석을 단독 삭제하면 `409 synergy_basis_in_use`로
거부됩니다. 딜을 먼저 정리하세요.

## 절차

1. **딜 삭제** — `/projects` 목록 → 행 액션 삭제(리드). 한 번의 액션으로
   프로젝트+기회 체인 전체가 삭제 표시되고, `deal_archive` manifest가 기록됩니다.
2. **활성 화면 확인** — 파이프라인, 진출방식 결정, 기회 발굴, 시너지 목록은
   표시를 자동 필터링하므로 별도 정리가 필요 없습니다.
3. **마스터데이터** — 해당 그룹/계열사를 참조하는 딜이 모두 표시된 뒤에
   그룹/계열사를 삭제 표시합니다(그룹/계열사 화면). 데이터는 보존됩니다.

## 화면별 정리 기준표

| 화면 | 정리 시점 |
| --- | --- |
| 프로젝트 파이프라인 (/pipeline) | 프로젝트 삭제 표시 |
| 진출방식 결정 (/route-decision) | 기회 삭제 표시 (`selected` 기회 칩 목록) |
| 브라운필드 대상 스크리닝 (/brownfield) | 기회 삭제 표시 |
| 기회 발굴 (/opportunities) | 기회 삭제 표시 |
| 시너지·전략적 적합성 (/synergy) | 시너지 삭제 표시 (딜 생존 중에는 거부) |
| 그룹/계열사 (/our-company) | 그룹/계열사 삭제 표시 |

## 아카이브

`/projects/archives`(프로젝트 → 아카이브)에서 관리합니다.

- **보관 프로젝트** — 마감/보관 상태 프로젝트. 원본이 그대로 남아 있어 개요와
  주요 화면에서 전체 자료를 열람할 수 있습니다(읽기 전용 — 쓰기는 차단).
- **삭제된 딜** — 삭제 표시된 딜. 원본 열람 링크로 보존된 데이터 전체를
  확인할 수 있습니다.

### 시점 고정(point-in-time)

딜 고유 데이터(기회, 경로결정, 대상 리스트, 시너지 버전, 사업성, 게이트,
리포트)는 마킹 이후 변경되지 않으므로 그 자체가 시점 고정 상태입니다. 반면
시장분석은 산업 단위 공유 자산으로 계속 갱신될 수 있으므로, 보관/삭제 시점의
`deal_archive` manifest가 **당시 버전 참조**(산업 → 분석 → 버전)를 기록하고,
append-only 버전 이력을 통해 당시 버전 열람이 보장됩니다.

### 접근 권한과 감사

- 열람은 **마킹 시점 프로젝트 멤버**에게만 허용되며 영구적입니다.
- 관리자는 딜 내용에 접근할 수 없습니다(역할 분리).
- 아카이브 상세 열람마다 감사 로그(`archive_view`)가 기록되고, `deal_archive`
  자체는 DB 트리거로 append-only가 강제됩니다.
- 보존 기간: 무기한. 파기 엔진(ADR-0039 retention_policy)은 별도 과제입니다.

## API 요약

| 엔드포인트 | 동작 |
| --- | --- |
| `DELETE /api/projects/[id]` | 리드 전용, 프로젝트+기회 마킹, manifest 기록, 감사 |
| `DELETE /api/opportunities/[id]` | analyst+, 미승격 기회 마킹, manifest 기록, 감사 |
| `DELETE /api/our-company/groups/[id]` | analyst+, 그룹+멤버 마킹 |
| `DELETE /api/our-company/groups/[id]/members` | analyst+, 멤버 마킹 |
| `DELETE /api/synergy/analyses/[id]` | analyst+, 마킹, 딜 생존 중 409 |
| `PATCH /api/projects/[id]/close` | 리드 전용, 마감/보관 + manifest 기록 |
| `GET /api/projects?status=` | `open`(기본) / `closed` / `archived` / `all` — 삭제 표시 제외 |
| `GET /api/archive/deals` | 내 삭제 manifest 목록 |
| `GET /api/archive/deals/[id]` | manifest 상세(멤버 전용, 열람 감사) |

## 관련 문서

- `docs/designs/2026-09-10-deletion-followups-plan.md` — 후속 과제 계획(un-delete,
  retention 엔진, 사유 입력 고도화, 문서 내보내기, 근거 파일 정책)
- `docs/runbooks/backup-restore.md` — 전체 DB 백업/복구
- `docs/security/security-model.md` §FR-SEC-07 — 감사 로그 불변 원칙
