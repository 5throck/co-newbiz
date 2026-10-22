---
lang: ko
lang_reason: source-material
---

# Design & Journey Review — co-newbiz S1–S12 (co-design PM 위탁) — 2026-10-22

- **Date**: 2026-10-22
- **Scope**: co-newbiz `app/web-next` S1–S12 전체 (기회 캐리어 S1–S7 / 프로젝트 캐리어 S8–S12, 양 트랙) — co-design 프로젝트 PM에게 위탁된 4개 과제 (도ctrine 준수 / 표·눌림 항목 / 사용자 저니 / 전 에이전트 품평회)
- **Method**: 의뢰서 접수(`Projects/co-design/memory/2026-10-22.md`) → 읽기 전용 리뷰 3슬롯 병렬(도ctrine A / 표 B / 저니 C) → 수정 파동 5건(토큰·레지스트리·스테이지 컴포넌트·앱 페이지·PM 직접) → 품평회 2라운드 심사위원 → 수용 이슈 즉시 수정
- **Design Gate**: `docs/designs/2026-10-22-codesign-commission-design.md` (registered implemented)

## Baseline

- `audit.ts` — design-lint 게이트가 **스캔 루트 부재로 스킵 중**이었음(실 UI 루트 미설정). 실측: design-lint token-usage **436 fail**(raw-px 315 + 색상 121, styles.css 정의부 집중), components/patterns/icons 3검사는 **레지스트리 부재로 SKIP**.

## 리뷰 결과 요약

### ① 도ctrine 준수 (슬롯 A)
전반 **높은 준수도**(TSX 하드코딩 색상 0건·표준 컴포넌트 채택률 높음·HITL 경계의 화면적 구현). 위반 4 클래스 + 문서-코드 드리프트 3건:
- 임의 rem 폰트 189건(0.9×98·0.95×49·0.88×29·0.92×12) — 2단계 타입 스케일 모델 붕괴 → **codemod 완료**
- 캡션 없는 표 18개 → **caption.sr-only 추가 완료**
- 아이콘 어휘 미선언(lucide-react 사용·미등록, 이모지 배지 혼재) → **icon-vocabulary.yaml 42항목 결정-of-record**(유니코드 글리프 정책, tier-1 기능 23·tier-2 의미 19) + 미허가 이모지 정규화
- 표준 이탈 테이블 9개(wacc 4·DataTab 2·strategy·MasterDataSection 등) → **.data-table 마이그레이션 완료**
- 문서 시정: `.btn-primary` 표준 선언(.btn-premium 폐기 예정)·ProjectSubNav→StageTabs 카탈로그·S11 내부 탭 변형 등록 — 영/한 쌍
- 토큰 수선: **신규 토큰 11개 추가(radius-2xs/xs, border-width-strong/accent, touch-target, content-wide/modal, focus-ring, shadow-flyout 등), fail 436→0**, 303건은 동일면 `design-token-exempt` 문서화

### ② 표·눌림 항목 (슬롯 B)
113개 표 중 ~25개 인터랙티브. **허위 눌림(hover-only affordance) 0건** — 문제는 동일 작업의 6가지 진입 패턴 공존. 표준 채택: 진입=라벨 셀 Link / 작업=마지막 열 sizing-actions-cell + sr-only 작업(list-table) / 게이트 저장=포커스 가능 aria-disabled+힌트 / 삭제=행 특정 aria-label. 수선: S6 LonglistSection 교칙 위반(상태 셀 내 액션) 해소, S3 전체 행 클릭 제거, 행 특정 aria-label, 게이트 저장 3중 패턴 통일, 대상 비교 표 빈 셀 상태 칩, 헤더 명칭 표준화, 이탈 테이블 마이그레이션. list-table 룰 lint 확장은 **T-20261022-047**(L0)

### ③ 사용자 저니 (슬롯 C)
술어·e2e는 양 트랙 S1→S12 완결 증명 — 발견 전부 **UI 발견성·핸드오프 문제**(F1~F12, High 4). 수선:
- **F2** deal-overview가 `carrierScopeFinished`를 소비 — 승격 대기 딜의 "다음 할 일"이 불가능한 fs 게이트 요청 대신 **"프로젝트로 추진 (승격)"**(트랙별 S5/S7)
- **F1/F10** 핸드오프 스트립 트랙 인식 스킵(그린필드 S5→S8, 브라운필드 S4→S6) — TrackGate 루프 소거
- **F3** 미승격 S8 빈 상태에 "승격 화면으로 이동" 액션
- **F6** S9·S11 "결정 기록 (사람)" 점프 칩 beforeJump(무반응 소거)
- **F9** 게이트 HOLD 딥링크: screening→`s3?tab=decision`, greenfield pre_fs→`s5?tab=review`(S3·S5 화면이 파라미터로 탭 개폐)
- **F4** deal 탭 S2 진입시장 도달성, **F5** S4 저장 후 전진 큐("결정 기록됨 — 다음: …")+notFound S3 링크, **F7** S12 스코어카드 기록기 지시, **F8** PMI 탭 "실행 · PMI" 개칭, **F11** 온보딩 승격·프로젝트 단계 보강, **F12** 원본 기회 브리지 문구

### ④ 품평회 (2라운드, 심사위원 8관점)
- **1라운드**(기술·a11y 렌즈, 수정 후 표면 5곳): **5개 전부 PASS/PASS-with-notes, FAIL 0**. 잔여 5건(패널 id 매핑·행 특정 라벨·캐시 무효화·next/link·col-num) → **전부 즉시 수선**
- **2라운드**(visual-designer·typography-expert·ux-researcher·service-designer·storyteller·i18n, 12 표면): **6관점 전부 PASS/PASS-with-notes, FAIL 0**. 잔여 9건(필터 리셋 콘트롤·제외 사유 전문 접근성·title-hover 한정 안내·--lh-body 문서 드리프트 등) → **T-20261022-048** 번들 티켓, 이 중 Longlist 빈 상태 문구는 즉시 수선
- 판정: 트랙 인식 핸드오프 스트립·승격 CTA·게이트 탭 ARIA+전진 큐가 최대 개선 3위로 선정

## 기계 래칫 (이번 배치의 구조적 성과)

- **design-lint 게이트 활성화**: `docs/workspace-schema.json designLint.scanRoots`를 실 UI 루트로 설정 — 스킵→**차단 검사**(token-usage·components·patterns·icons·fonts 5/5 PASS). 이후 raw 값·이탈 컴포넌트·미등록 아이콘은 감사가 잡는다
- 레지스트리 3종(`docs/design/`)이 표준 어휘의 기계 원장이 됨
- L0 소관 후속: **T-20261022-045**(TOKEN_SOURCE_DIRS 발견 한정)·**-046**(UI 루트 하드코딩+allowlist 미파싱)·**-047**(list-table 룰)

## Verification

- tsc core/web-next 0 errors · typecheck-baseline OK(신규 0) · `procedures/_validate.ts` 0 errors · `audit.ts` 전체 통과(활성화된 design-lint 게이트 포함) · design-lint 5/5 PASS · 단위 테스트 326파일(4건의 합법적 파괴를 수정된 계약으로 갱신 후 전부 통과 — 토큰 치환·행 특정 라벨·라이브러리 투영 재동기화)
- 3단계 검토: AI 1차(머신 게이트)·AI 2차(품평회 심사위원 2라운드) 완료 — 사람 최종 승인은 PR 리뷰 시점
