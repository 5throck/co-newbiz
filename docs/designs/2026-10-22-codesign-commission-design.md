---
lang: ko
lang_reason: source-material
---

# co-design 위탁 — S1–S12 디자인 도ctrine·표 인터랙션·사용자 저니 종합 검토 및 시정 (Implemented)

- **일자**: 2026-10-22
- **상태**: Implemented (사용자 지시 — "Projects\co-design 프로젝트의 PM에게 의뢰해서 처리" — co-design PM 게이트웨이 접수: `Projects/co-design/memory/2026-10-22.md` Incoming Request)
- **관련**: `co-design/docs/design-foundation.md`(프레임워크 SSOT), `docs/design-system/*`(프로젝트 인스턴스), `docs/design/*`(신규 기계 레지스트리), `scripts/design-lint.ts`, 리뷰 보고서 `docs/reports/2026-10-22-design-journey-review.md`

## 1. 결정

| # | 과제 | 결정 |
|---|---|---|
| 1 | 도ctrine 준수 (철학·원리·가이드·칼러·아이콘·표준 컴포넌트·표준 화면) | 리뷰 슬롯 A 결과: 전반 준수, 위반은 4 클래스(임의 rem 폰트 189건·캡션 없는 표 18개·아이콘 어휘 미선언·표준 이탈 테이블 9개) + 문서-코드 드리프트 3건. 시정: ① 타입 토큰 codemod(0.9→fs-body, 0.88/0.92/0.95 접기) ② caption.sr-only 18건 ③ **아이콘 어휘 결정-of-record**(docs/design/icon-vocabulary.yaml — 유니코드 글리프 정책, tier-1 기능 글리프 23·tier-2 의미 이모지 19, 미등록 이모지는 허가셋으로 치환 또는 aria-hidden) ④ 표준 이탈 테이블 9개 → .data-table ⑤ 문서 시정(.btn-primary 표준 선언·.btn-premium 폐기 예정, ProjectSubNav→StageTabs 카탈로그, S11 내부 탭 변형의 design-screens 등록 — 영/한 쌍) ⑥ **design-lint 게이트 활성화**: 실측 436 fail(raw-px 315 + 색상 121 — styles.css 정의부 집중)을 신규 토큰 11개 추가·동일면 `design-token-exempt` 문서화로 0 fail 수선 후 schema `designLint.scanRoots`를 실제 UI 루트로 설정 ⑦ 표준 컴포넌트(23)·화면 패턴(P0–P5)·아이콘 레지스트리 3종 작성 — SKIP이던 3개 검사를 PASS로 활성화 |
| 2 | 표·테이블 눌림 항목 | 리뷰 슬롯 B: 113개 테이블 중 ~25개 인터랙티브, 허위 눌림(hover-only affordance) 0건 — 문제는 **동일 작업의 6가지 진입 패턴 공존**. 표준 채택: 진입=라벨 셀 Link, 작업=마지막 열 sizing-actions-cell + sr-only 작업(list-table), 게이트된 저장=포커스 가능 aria-disabled+힌트(S11 모델), 삭제=행 특정 aria-label. 시정: S6 LonglistSection 교칙 위반 수선(행 상태 셀 속 액션 → actions cell), S3 전체 행 클릭 제거, 행 특정 aria-label, 게이트 저장 3중 패턴 통일, 대상 비교 표 빈 셀 상태 칩, 헤더 명칭 표준화, DataTab·MasterDataSection 교칙 이탈 테이블 마이그레이션. list-table 룰의 design-lint 확장은 L0 소관로 티켓 위임 |
| 3 | 사용자 저니 (그린필드·브라운필드) | 리뷰 슬롯 C: 술어·e2e는 양 트랙 완결 증명 — 발견 전부 UI 발견성·핸드오프 문제(F1~F12, High 4). 시정: F2 deal-overview가 carrierScopeFinished를 소비해 승격 CTA 제공(커밋先行), F1/F10 핸드오프 스트립 트랙 인식 스킵, F3 미승격 S8 빈 상태에 승격 링크, F6 S9·S11 게이트 점프 beforeJump, F9 S3·S5 게이트 딥링크(?tab=decision/review), F4 진입시장 편집면의 deal 탭 도달성, F5 S4 저장 후 전진 큐, F7 S12 스코어카드 기록기 지시, F8 PMI 탭 명칭 "실행 · PMI", F11 온보딩 승격·프로젝트 단계 보강 |
| 4 | UI/UX 품평회 | 수정 파동 완료 후 co-design 로스터 7관점(design-lead·ux-researcher·visual-designer·typography-expert·service-designer·prototype-engineer·storyteller) + co-newbiz 도메인(ux-designer·frontend-engineer·i18n-specialist) 심사위원 패널로 수정된 표면을 재평가, 수용 이슈만 이번 배치에서 반영하고 나머지는 티켓화. **사후 개정(T-20261022-051)**: 판정 절차에 §5 매트릭스 프로토콜을 추가 — 표면별 격리 심사로는 교차 화면 일관성이 심사 축이 될 수 없었음 |

## 2. 위임 구성

- co-newbiz PM 총괄(이 세션), 리뷰 3슬롯(도ctrine/표/저니) + 수정 5파동(토큰·레지스트리·스테이지 컴포넌트·앱 페이지·PM 직접) 병렬, 파일 소유권 분리.

## 3. 검증 계획

- design-lint 5검사 전부 PASS(token-usage fail 0 유지) · 단위 테스트 전체 · tsc ×2 · typecheck-baseline · audit(spec 등록 후) · 품평회 결과 수용분 재검증.

## 4. 후속 (L0 소관 — 워크스페이스 티켓)

- design-lint TOKEN_SOURCE_DIRS가 app 스타일시트를 발견하지 못함 · components/icons 검사 UI 루트 하드코딩 · schema designLint.allowlist 미파싱(현재 inert) · list-table 룰의 lint 확장.

## 5. UI/UX 품평회 매트릭스 프로토콜 (T-20261022-051 — 2026-10-22 패널 사후 개정)

2026-10-22 패널은 **표면별(1화면 1심사) 격리**로 운영되었다. 그 결과 화면을
가로지르는 일관성 축 — 머리 위치·스트립 슬롯·열 폭·primary 배치 — 이 심사
축 자체가 아니었고, 실제로 그 축들의 드리프트(S2↔S11 스트립 위치 불일치,
S8~S12 머리 밀림, 단계별 제각각 머리 버튼)는 패널이 아니라 별도 사용자
리포트로 발견되었다(`docs/designs/2026-10-22-head-action-standard-design.md`).
이후 품평회는 아래 매트릭스 프로토콜을 기본 절차로 한다. **같은 슬롯을
12화면 매트릭스로 본다**가 원칙이다.

### 5.1 고정 심사 매트릭스 (행)

- 행 = 단계 화면 S1~S12, 고정 순서. 패널이 행을 임의로 줄이거나 재배열하지
  않는다 — "이번에 고친 표면만"이 아니라 전 단계를 항상 같은 매트릭스로
  본다(수정 파동의 회귀까지 같은 매트릭스에서 잡는다).
- 트랙 분기는 행 안의 하위 컬럼으로 풀다: S1~S4·S8~S12는 양 트랙 공용 행,
  S5(그린필드 진출전략)와 S6·S7(브라운필드 결합·투자·선정)은 단일 트랙 행,
  트랙별 변형이 생긴 공용 행은 그린필드/브라운필드 하위 열로 분리해 나란히
  채점한다. 트랙 미해당 셀은 빈 셀이 아니라 "미적용"으로 명기한다.
- **축 담당제(axis ownership)**: 한 심사위원이 한 축(열)을 맡아 12행 전부를
  비교하며 채점한다. 표면별로 심사위원을 나누는 것(화면 1개를 여러 관점이
  돌아보는 방식)과 축별로 나누는 것(축 1개를 한 관점이 전 화면에 적용하는
  방식)을 혼용하지 않는다 — 일관성 판정은 후자에서만 나온다.

### 5.2 슬롯별 심사 축 (열)

각 행(화면)은 아래 4개의 고정 열로 채점한다. 열의 정의는 design-screens.md의
표준 해부(`h1 스테이지명` → 목적선 → 입력·출력 스트립 → 레일/StageTabs 행 →
가이던스 → 본문, 머리 우상단 = "다음: {단계명} →")를 따른다.

| 열 | 축 | 판정 기준 |
|---|---|---|
| 머리 위치 (head position) | h1이 top bar 바로 아래 같은 깊이에 오는가 — 프로젝트 화면(S8~S12)은 railSlot 정착으로 딜 화면과 같은 위치를 유지 | 12행 동일 위치·동일 깊이 |
| 스트립 슬롯 (strip slot) | 입력·출력 스트립이 목적선 바로 다음(레일/StageTabs 행 앞)에 오는가 | 12행 동일 순서 |
| 열 폭 (column widths) | 표가 ColGroup 백분율 + `table-fixed-pct` 체계를 따르고, 동류 패턴(P1 목록·P2 보고 등) 화면 간 동류 열(후보명·상태·작업)의 폭 배분이 호환되는가 | 동류 열 폭 편차가 시각 비약을 만들지 않을 것 |
| primary 배치 (primary placement) | 머리 우상단은 다음 단계 내비게이션("다음: {단계명} →")이고 단계의 기록·생성 액션은 본문 작업 면에 있으며, 화면당 primary 버튼이 1개인가 | 12행 동일 규칙 (S12 종료 단계의 머리 버튼 숨김은 예외로 허용) |

### 5.3 교차 화면 일관성 판정 (verdict)

- 각 축(열)마다 심사위원은 개별 화면 판정과 **별개로** 축 단위 일관성
  판정을 PASS / PASS-with-notes / FAIL로 남긴다. 판정 근거는 "12행 중 몇 행이
  어긋나는가"이며, 어긋난 행·셀을 반드시 인용한다(화면명 + 슬롯).
- FAIL 판정 축은 화면 단위 수선이 아니라 **축 단위 수선 파동**(전 행 일괄,
  표준을 코드 한 곳 — 예: StageFrame — 에서 고침)으로 처리한다. 개별 화면의
  국소 수정으로 축 일관성을 다시 깨는 것을 금지한다.
- 판정 기록은 품평회 결과 보고서(`docs/reports/`)에 축별 표로 남기고, 잔여
  수선은 워크스페이스 티켓으로 번들링한다(예: T-20261022-048).
