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
| 4 | UI/UX 품평회 | 수정 파동 완료 후 co-design 로스터 7관점(design-lead·ux-researcher·visual-designer·typography-expert·service-designer·prototype-engineer·storyteller) + co-newbiz 도메인(ux-designer·frontend-engineer·i18n-specialist) 심사위원 패널로 수정된 표면을 재평가, 수용 이슈만 이번 배치에서 반영하고 나머지는 티켓화 |

## 2. 위임 구성

- co-newbiz PM 총괄(이 세션), 리뷰 3슬롯(도ctrine/표/저니) + 수정 5파동(토큰·레지스트리·스테이지 컴포넌트·앱 페이지·PM 직접) 병렬, 파일 소유권 분리.

## 3. 검증 계획

- design-lint 5검사 전부 PASS(token-usage fail 0 유지) · 단위 테스트 전체 · tsc ×2 · typecheck-baseline · audit(spec 등록 후) · 품평회 결과 수용분 재검증.

## 4. 후속 (L0 소관 — 워크스페이스 티켓)

- design-lint TOKEN_SOURCE_DIRS가 app 스타일시트를 발견하지 못함 · components/icons 검사 UI 루트 하드코딩 · schema designLint.allowlist 미파싱(현재 inert) · list-table 룰의 lint 확장.
