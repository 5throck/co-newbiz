---
lang: ko
lang_reason: source-material
---

# 데모 이중 트랙 — 그린필드 S1–S12 체인 추가 (bun run demo)

- Date: 2026-10-10
- Status: Implemented (사용자 요청, 2026-10-10 대화)
- Related: `scripts/co-newbiz/demo.ts`, `scripts/co-newbiz/seed-s1-s12-demo.ts`,
  `tests/scenarios/_support/deals.ts`, ADR-0094/0095 (승격), ADR-0085 (설립
  5단계), ADR-0143 (대상 축 — brownfield 전용), flow.spec v2.5.0 applicableTracks

## 문제

`bun run demo`는 브라운필드 M&A 체인만 완전한 S1→S12를 시연했다. 그린필드는
E2E 최소 픽스처(`seedGreenfieldDeal`)가 딜 보드에만 존재했고 — 풀 S1
매트릭스·사람 게이트·설립 실행·S12 전환이 없어 프로세스 레일이 끊긴
상태였다. 캡처 워크스루(`--capture`)도 브라운필드 10컷뿐이었고 시작 URL
안내도 브라운필드 하나였다. 트랙 분기(S5 vs S6/S7, PMI vs 설립 5단계)가
데모에서 전혀 보이지 않았다.

## 결정

**데모는 두 트랙의 완전한 S1→S12 체인을 각각 시연한다.**

### 1. `seedGreenfieldS1ToS12Demo` (seed-s1-s12-demo.ts, 브라운필드 쌍둥이)

브라운필드 시드와 같은 수명주기 구조를 트랙에 맞는 분기로:

| 단계 | 브라운필드 시드 | 그린필드 시드(신규) |
|---|---|---|
| S1 | 풀 SizingMatrix | 풀 SizingMatrix(GF_MATRIX — E2E 픽스처의 압축 payload로는 S1 리포트가 렌더링되지 않음) |
| S4 | route m_and_a + 5개 평가 | route greenfield('integration') + 5개 평가 |
| S5 | — (스킵) | greenfield_assessment: 진출전략(Build+Hire)·대안·격차 해소 |
| S6/S7 | 후보 3(1 shortlist)+선정 기록 | — (스킵 판정 확인) |
| S8 | 팹리케이션 행 + 선정+채택 | **실제 generateBusinessCases 실행**(그린필드 경로: 프로젝트 레벨 subject, 시장 포획 앵커, 대상 축 없음) → 채택은 base 첫 모델 |
| S9 | 표준+M&A 서브트랙 DD | 표준 DD(서브트랙 없음) + 커스텀 항목 |
| S11 | s11_pmi_kickoff | **설립 실행 5단계**(entity_establishment_step, origin internal, 전 단계 done) |
| 게이트 | screening·pre_fs·**target_screening**·fs·dd·entity_ic·group_ic | screening·pre_fs·fs·dd·entity_ic·group_ic (target_screening 제외) |
| S12 | 스코어카드+전환 결정 | 스코어카드+전환 결정 |

S8을 팹리케이션이 아닌 실제 생성기로 실행하는 이유: 데모 화면에 진짜
잡스펙·노트(포획률·시드·엔진 근거)가 남는다. 멱등성은 "프로젝트에 모델이
없을 때만 실행" 가드로 유지(재실행해도 3모델 불변 확인).

### 2. demo.ts 이중 트랙화

- 시드: 양 체인 + 각 프로젝트에 analyst lead 부여
- 시작 콘솔: 브라운필드/그린필드 딜·프로젝트 URL 각각 출력
- `--capture`: 19컷 — 브라운필드 10컷(S1–S12) + 그린필드 9컷(S1·S2·S4·**S5**·S8·S9·S10·S11·S12). `docs/evidence/demo/`에 `11-gf-*`~`19-gf-*` 파일명.

### 3. 발견·수정한 잠복 결함 (시드 계열 공통)

- **채택 meta 키**: 정식 작성자(`adoptBusinessCase`)와 판독자
  (`latestAdoption`)는 `model_id`를 쓰는데 세 시드 픽스처가 전부
  `adopted_model_id`를 썼다 — `INSERT OR IGNORE` + JSON이라 조용히 무효.
  시드된 데모의 "채택됨" 배지가 지금까지 표시되지 않았다. 세 곳(브라운필드
  데모 시드, 그린필드 E2E 픽스처, 신규 시드) 모두 `model_id`로 수정.
- **stake_type enum**: 그린필드 구조의 'wholly_owned'는 CHECK
  ('full','majority','minority','joint_control')에 없어 OR IGNORE로
  조용히 누락 → 'full'로 수정. OR IGNORE 시드의 실패 조용함은 본 건으로
  입증됐다 — 시드 검증은 evaluateProcess 전 단계 판정으로 한다(아래).

## 검증

- 임시 DB 시드 후 `evaluateProcess` 전 단계 판정: **양 트랙 모두
  S1–S12 전 단계 complete** (브라운필드 S5· 그린필드 S6/S7 스킵 판정),
  게이트 전부 기록, 채택 해석 ✓, 그린필드 S8 읽기모델 3 케이스(시장
  기반)·targets 0·권고 upside ✓, 재실행 멱등 ✓.
- 전체 유닛 스위트 통과.
- `bun run demo -- --capture` 실측: 19컷 생성, 그린필드 S5(진출전략·역량
  격차 표)·S8(실제 생성기 수치: base p05 572 / p50 613 / p95 657 백만원,
  IRR 41.6%, 성장 11%=시드값) 화면 정상 렌더링 확인.
- 그린필드 E2E 시나리오(greenfield.test.ts) 6건 통과(수정된 픽스처로).
