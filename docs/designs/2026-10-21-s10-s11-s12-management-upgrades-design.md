---
lang: ko
lang_reason: source-material
---

# S10 등록 화면 생애주기 · S11 보고서 고도화 · S12 마일스톤 일정관리 (Implemented)

- **일자**: 2026-10-21
- **상태**: Implemented (decider "진행해줘" — 확인 질의 무응답으로 추천안 적용)
- **원 질의**: decider — "S10 투자구조 설계에서 인센티브, 부지/시설, 인허가/인증의 경우 다수의 항목을 등록할 수 있도록 되어야 하지 않을까?", "S11 투자심사·실행의 보고서 작성 기능이 매우 부실하다… 삭제 기능이 추가될 필요", "S12 사후관리에 프로세스의 일정관리가 매우 약하다 — 주요 마일스톤 일정관리 + 필요하면 사이드바에서 관리"
- **관련**: `procedures/_shared/deal-structuring` step 5·7, ADR-0116 Phase 6(보고서 스냅샷·렌더러), ADR-0122 #1(stage SLA — 계산값 전용 유지), Wave 0 B3/B4/B5, 2026-10-21-s9-s12-ia-review-hardening-design(공통 탭 패턴)

## 1. 문제

- S10 세 등록 화면(인센티브·부지·인허가/인증)은 다중 등록 자체는 지원했지만 **수정·삭제·상태 변경이 전무**했다(DELETE 0개, 삭제 버튼 0개, status 컬럼을 바꾸는 UI 없음).
- S11 보고서는 초안 생성·스냅샷 저장·렌더링이 있으나 **저장 스냅샷의 본문을 다시 열 수 없고**, 잘못 만든 스냅샷을 치울 **삭제/보관도 불가**했으며 미리보기가 없었다.
- S12는 단계 SLA 경과(계산값)만 있고 사람이 관리하는 **일정(마일스톤) 개념이 없었다**. 인허가/인증 기한은 greenfield 실행 기준선 안에만 존재.

## 2. 결정

### 2.1 S10 — 삭제 + 상태 변경 (다중 등록은 현행 유지)
- `DELETE /incentives?id=`·`DELETE /sites?id=`·`DELETE /permits?kind=&id=` — 하드 삭제 + 감사(`incentive.deleted`·`site.deleted`·`{kind}.deleted`), analyst+. 인허가/인증 삭제 시 중요경로 엣지(`{kind}_edge`)를 먼저 정리한다.
- `PUT /incentives`(`set direction` prospec­tive↔granted), `PUT /permits`(`{kind, id, status}` — CHECK 허용값 not_started·in_progress·granted·denied·withdrawn만, 위반 시 400). 화면 행에 상태 select·방향 select·삭제 버튼(모두 analyst+, confirm 다이얼로그).

### 2.2 S11 — 본문 재개·보관·미리보기
- 마이그레이션 **0166**: `report_snapshot.archived_at`. **보관 = 소프트 삭제**("불변 이력" 원칙 유지 — 행·렌더 파일은 감사로 남기고 목록에서만 숨김). 목록 GET은 기본 보관본 제외, `?archived=1`로 노출.
- `GET/DELETE /api/projects/[id]/reports/[snapshotId]`(GET은 보관본도 읽음; DELETE는 archived_at 세팅 + 감사 `report_snapshot.archived`).
- 페이지: 이력 행 **"본문 열기"**(단건 조회 → 제목·본문을 편집기에 적재, 저장은 항상 새 스냅샷), **보관** 버튼(confirm), **보관본 보기** 토글, **미리보기** 패널 — `lib/markdown-preview.ts`(이스케이프 선행 후 화이트리스트 구문만 태그 변환: 제목·목록·강조·인용·수평선·단락;注入 HTML 무력화).

### 2.3 S12 — 마일스톤 원장 + 공통 화면 + 사이드바 배지
- 마이그레이션 **0167** `project_milestone`(title·category[permit/certification/capex/contract/custom]·due_date·owner·source[manual/execution_baseline]·done_at·notes). **상태는 항상 계산값**(done / overdue / 7일 내 due_soon / planned) — 저장하지 않는다.
- `lib/milestones.ts`: 목록·요약(배지용)·생성·부분 갱신(done 토글 포함)·삭제·`importBaselineMilestones`(확정 기준선의 인허가/인증 마일스톤 → 제목 일치 시 스킵, source=execution_baseline). 라우트: `GET/POST /milestones`(`?summary=1`은 배지 카운트만), `PUT/DELETE /milestones/[milestoneId]`, `POST /milestones/import-baseline`.
- **공통 화면** `/projects/[id]/milestones`: `PROJECT_COMMON_TABS`에 추가(차터 방식 재사용 — 모든 단계 바에서 도달, 홈은 S12). 상태별 섹션(D-day 표기·기한 지연 하이라이트)·등록 폼·완료 토글·삭제·기준선 가져오기 버튼(확정 기준선 존재 시).
- **사이드바 배지**: `StageTabs` 공통 링크에 `지연 N · 임박 M` 칩(`?summary=1` 저용량 fetch, 실패 시 배지 숨김).
- 참고 표시 원칙 유지: 지연 마일스톤은 게이트를 막지 않는다(S12 게이트 없음, ADR-0161).

## 3. 범위 밖
- S10 행 인라인 편집, 보고서 템플릿/섹션 선택(compose API 확장), 마일스톤 리마인더·캘린더 연동, stage_sla 정책 관리 UI.

## 4. 검증
- 유닛: `s9-depth-routes.test.ts`(S10 삭제·상태·감사, 보고서 본문 열기·보관·?archived=1, 마일스톤 CRUD·derived 상태·요약·기준선 미확정 400), `markdown-preview.test.ts`(이스케이프 우선 — 주입 HTML 무력화), `stage-tabs.test.ts`(공통 탭 2건·마일스톤 S12 홈·PMI 핀), `navigation.test.ts`(비메뉴 라우트 등록), openapi·테이블 사이징 가드.
- 타입 `tsc --noEmit` 무오류, `validate:language` 통과.
