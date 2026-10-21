---
lang: ko
lang_reason: source-material
---

# S9–S12 IA 정비 + 오류 하드닝 + 3단계 검토 확인 저장 (Implemented)

- **일자**: 2026-10-21
- **상태**: Implemented (decider 검토 7건 — "다음의 내용에 대해 검토해서 의견을 주세요" + 확인 질의 답변 + "확인한 내용을 저장할 방안이 없는 듯 해")
- **관련**: ADR-0122 #2(히트맵), ADR-0123 #3 + addendum(백테스트 배치), ADR-0161(PMI 범위), ADR-0182 §5 + addendum(검토 확인 저장), `lib/stage-tabs.ts`(Wave U-1), `lib/route.ts`, `lib/api.ts`(invalid_response 문구), flow.spec `charter-baseline`(S11)

## 1. 문제 — decider 검토 7건

1. 백테스트 조직 집계가 S9에 있다 → S12가 맞다.
2. S9 히트맵에서 "서버 응답이 비어 있거나 손상되었습니다" 오류 + 판정 대상을 알려주는 기능이 없다.
3. 고객 CoC·경영진 보상·인터뷰는 실사 사안이다.
4. S10 투자구조·S11 투자심사에서 같은 서버 응답 오류.
5. S12 PMI는 범위 밖이다.
6. S12 추진계획(차터)은 프로젝트 시작부터 관리해야 한다.
7. 3단계 검토 "사람 확인" 체크를 저장할 방안이 없다.

## 2. 결정 (decider 확인 질의 답변 반영)

### 2.1 오류 2건(1·4) — 원인 진단 + 하드닝
- **원인**: 앱은 부트 시에만 자동 마이그레이션(`instrumentation.ts`, 기본 `auto`). 장기 실행 dev 서버는 0159~0164가 없어 신규 테이블·컬럼을 읽는 화면(S9 히트맵 0160, S10 0162, S11 0163)이 SQL 예외 → Next HTML 500 → `lib/api.ts`가 본문 비-JSON 시 일반 문구로 대체. **즉시 조치는 서버 재시작(또는 `bun run db:migrate`).**
- **하드닝**: `lib/route.ts`가 `no such table/column`을 `503 migration_pending`(재시작·migrate 안내 + 원문 포함)으로 변환. 이전 슬라이스에서 `route()` 없이 쓴 12개 라우트를 래퍼로 감싸 예외가 JSON으로 노출.

### 2.2 백테스트 → S12 더보기 (질의 1)
- ADR-0123 #3 학습 루프(S8 예측 vs S12 실측)이므로 실사 산물이 아니다. 탭만 S9 더보기 → S12 더보기(API·페이지 불변), ADR-0123 addendum 기록.

### 2.3 히트맵 — 판정 대기 + 리스크 등록 (질의 2)
- `sources_status`(소스별 기록/플로팅 건수·기록 위치·부재 사유)를 집계에 추가하고 페이지 상단 **판정 대기 스트립**으로 노출.
- **리스크 항목 등록 폼**: `dd_finding`(카테고리 `리스크`)으로 저장 → 히트맵·조사내역·투자심의 자료 자동 반영. 신규 테이블 없음(ADR-0122 #2 유지). dd 항목에 카테고리 칩.

### 2.4 실사 도구 → 실사 워크스페이스 (질의 3)
- CoC·보상·인터뷰는 스펙상 S9 실사 산물(brownfield-dd step 7·8, cdd-07) — 배치만 고친다. `GET /dd`에 `tool_counts`(계약·보상·인터뷰·히트맵 기록 건수), `DdStage`에 **실사 조사 도구** 카드 4장(체크리스트 항목 id 병기). 세 페이지는 `hidden: true`로 S9 그룹에 잔류(세그먼트 해석·탭 바 유지, 더보기 메뉴에서 제외).

### 2.5 PMI 유지 (질의 5)
- PMI는 brownfield M&A 트랙의 명시 활동(flow.spec S11 `pmi-kickoff`·S12 `integration-monitoring`, 절차·kill criterion·ADR-0161)이며 비해당 프로젝트에선 탭이 이미 제거된다. 제외 시 flow.spec·절차·로스터 ADR이 필요 — **유지** 결정. greenfield에서 탭이 보이면 적용성 버그로 별도 조사. 핀 테스트 추가.

### 2.6 차터 → 프로젝트 공통 (질의 6)
- flow.spec `charter-baseline`은 **S11 활동·완료 기준**이지만 S8 승격 시점부터 쓰인다. `PROJECT_COMMON_TABS`로 모든 단계 바에 **추진계획(차터)** 링크를 상시 노출하고, 차터 페이지의 홈 그룹은 S12 → **S11**. S12 탭 목록에서는 제거(공통 링크로 도달).

### 2.7 3단계 검토 확인 저장 + 프로젝트 게이트 버그 (질의 7)
- 마이그레이션 **0165** `review_claim_ack`(append-only, entity·gate·claim별 최신 행이 현재 상태). `GET/POST /api/{projects|opportunities}/[id]/review-acks`(analyst+ 쓰기·감사). `GateDecisionPanel`이 마운트 시 acks로 체크를 복원하고 토글 즉시 저장(저장 실패 토스트), `ReviewBuckets`에 `확인 저장됨 · by · 날짜` 칩과 문구 갱신. 결정 기록은 기존대로 자체 스냅샷을 유지(양쪽 다 남음).
- **버그 수정**: 프로젝트 게이트 라우트가 `judgement_confirmations`를 저장하지 않던 누락(기회 라우트와 동일하게 저장·조회 파싱).
- ADR-0182 §5 addendum: "신규 테이블 없음" 조항 수정(신규 테이블 1개, 사유: 검토 작업 유실 방지).

## 3. 범위 밖
- 트랙별 표준 리스크 범주 체크리스트, PMI 적용성 버그(관찰 시), 차터를 S8 승격 시점부터 강제하는 완료 기준 변경(flow.spec 필요), 히트맵 사람 항목의 승격(리스크→조사내역 분리 원장).

## 4. 검증
- 유닛: `route-migration-pending.test.ts`(503 매핑), `stage-tabs.test.ts`(백테스트 S12·hidden 실사 도구·공통 차터 S11 홈·PMI 핀), `s9-depth-routes.test.ts`(sources_status·review-acks 토글/최신 승계/감사·프로젝트 게이트 confirmations 저장·조회), 기존 `brownfield-dd-view`·`greenfield-workspace-view`·`ic-package`·`wave0` 회귀 통과.
- 타입 `tsc --noEmit` 무오류, `validate:language` 통과, dev 서버 재시작 후 스모크(오류 소실·스트립·섹션·공통 링크·체크 저장 유지).
