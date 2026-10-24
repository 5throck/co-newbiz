---
lang: ko
lang_reason: source-material
---

# 디자인 커미션 후속 — 품평회 잔여 9항목 시정 + DOM 계약 테스트 + 시각 스모크 + 매트릭스 프로토콜 (Implemented)

- **일자**: 2026-10-24
- **상태**: Implemented (워크스페이스 거버넌스 티켓 T-20261022-048/049/050/051 — 2026-10-22 디자인 저니 리뷰 `docs/reports/2026-10-22-design-journey-review.md` 품평회 섹션과 커미션 후속 P1/P2/P4의 일괄 처리)
- **관련**: docs/design-system/design-components.md(list-table 표준), design-guide/design-tokens(±_ko), docs/designs/2026-10-22-codesign-commission-design.md(§5 신설), StageFrame/LonglistSection/onboarding

## 1. 결정

| # | 티켓 | 결정 |
|---|---|---|
| 1 | 048 (1) | LonglistSection에 `상태` 필터(전체/심사 중/최종 후보 목록/제외)와 `필터 초기화` 버튼을 구현 — 빈 상태 안내가 가리키던 컨트롤의 부재를 해소. 필터 로직은 순수 헬퍼(longlist-filter.ts)로 추출해 테스트. |
| 2 | 048 (2) | exclusion_reason 잘림 텍스트를 hover 전용에서 `.cell-reason-toggle` 버튼(aria-expanded, focus/click 시 전체 텍스트 전개)으로 교체 — 키보드·터치 접근. |
| 3 | 048 (3) | StageFrame 차단(승격 전) 단계에 `tabIndex={0}` + 포커스 시 이유 버블(`.stage-step-reason`, aria-hidden로 이중 안내 회피) 제공. |
| 4 | 048 (4) | `--lh-body` 1.5 → **1.55로 토큰 상향**(문서가 코드를 따름; 표는 --lh-table 1.35 유지). design-tokens ±_ko 갱신. |
| 5 | 048 (5) | 서브라벨 범위를 `--fs-caption` 0.8125–0.875rem으로 재고정(기존 0.72–0.8rem은 13px 바닥 위반 — 코드는 이미 준수, 문서만 드리프트). 재무 수치는 **sans + `tabular-nums` of-record**(JetBrains Mono는 코드/ID로 범위 한정). 양 가이드에 조정 노트, library.generated.ts 재생성. |
| 6 | 048 (6) | 핸드오프 스트립 `<details ... open>` — 기본 펼침(읽기 기본) + 접기 토글 유지. 공유 스트립 일괄 적용으로 12화면 동일 기본값. |
| 7 | 048 (7) | 온보딩 1단계 CTA를 `btn-primary` + 신규 로케일 키 `pages.onboarding.startHere`(여기서 시작)로 승격 — 2~4단계는 ghost 유지, 위계 형성. |
| 8 | 048 (8) | radius-lg 1rem → **0.875rem**(xl 1rem 불변) — 0.625/0.75/0.875/1/1.25/1.5 단조 스케일 회복. lg 소비자 2px 이동. |
| 9 | 048 (9) | group-card-name: title 유지 + `.group-card:focus(-visible) .group-card-name { white-space: normal }`로 키보드 포커스 시 전체 이름 노출. |
| 10 | 049 | `tests/unit/stage-screen-dom-contract.test.ts`(9 테스트) — 양 트랙 시드 픽스처에서 전 단계 화면의 DOM 순서 계약 고정: 첫 h1 = stage-head 선두 자식, objective 인접, 스트립(details.handoff-panel) 3번째 프레임 자식(화면 기준 4/5번째), 레일 인접, 프로젝트 화면 StageTabs 레일 슬롯 고정, S8–S12 진입 컴포넌트의 railSlot 정확 1회 배선 잠금. "4th/5th" 티켓 문구는 프레임 자식 3 = 화면 요소 4–5로 정합 해석. |
| 11 | 050 | `tests/e2e-visual/` 시각 스모크 — 실제 로그인(하네스 생성 자격증명, 하드코딩 없음)으로 양 트랙 12 스테이지 경로(24 방문)를 프로덕션 Next 서버 + 스크래치 SQLite(양 데모 시드)에서 걷고 지오메트리 불변식(h1 위치/크기, head→objective→strip→rail 수직 순서, 스트립 좌정렬, primary 우측 정렬·수직 중앙, S12 종단 시 부재)을 단정. 스크린샷 24장 + 지오메트리 스냅샷은 gitignore 대상, aHash 기반 diff는 `E2E_VISUAL_DIFF=update/check` 옵트인(±12/64 비트 허용). 신규 워크플로 `visual-smoke.yml`: workflow_dispatch + 주간 schedule 전용(PR/push 트리거 없음 → 병합 불가 차단), continue-on-error, 브라우저 설치 단계 포함. playwright-core 기존 의존 재사용(@playwright/test 신규 도입 회피). |
| 12 | 051 | 커미션 설계 문서에 **§5 UI/UX 품평회 매트릭스 프로토콜** 신설 — S1–S12 고정 행 매트릭스(트랙 분기는 서브 컬럼, 미적용 셀 명시, 축 소유 규칙), 4개 고정 검토 축(head 위치/스트립 슬롯/컬럼 폭/primary 배치)에 화면당 축 기준 부여, 축별 교차-화면 일관성 판정(PASS/PASS-with-notes/FAIL — FAIL은 축 단위 수정 웨이브로 처리). §1 4행에 개정 참조 추가. |

## 2. 검증

- `bunx tsc -p tsconfig.core.json --noEmit` — clean. `app/web-next` `tsc -p tsconfig.json --noEmit` — 0 errors.
- `bun scripts/co-newbiz/design-lint.ts` — no violations.
- `bun test tests/unit/longlist-review-fixes.test.ts` 14/0, `stage-screen-dom-contract.test.ts` 9/0, 관련 스위트(table-sizing, company-competitor, library-projection-sync, our-company-ui-refinement, i18n-lint, s9-depth-routes, s1-s12-demo-e2e, seed-s1-s12-demo) — 전부 pass.
- `bun run test:visual` — 1 pass (272 expects; `update`→`check` 사이클 검증).
- 전체 스위트 4,177 pass / 2 flaky(web-research-diagnostics 네트워크 프로브, seed-s1-s12-demo 공유-싱글턴 병렬 간섭 — 둘 다 단독 실행 시 green, 본 배치 파일과 무관).

## 3. 알려진 후속

- `db/client.ts getDb`의 프로세스 전역 싱글턴은 병렬 테스트 파일 간 DB 공유 간섭(본 검증에서 확인된 seed 테스트 간섭의 근원)의 근원 — 경로별 캐시 전환이 올바른 해이나, 346개 파일의 병렬 가정(env 임포트 시 고정 + 싱글턴) 재검증이 필요해 별도 과제로 분리.
- 시각 스모크의 aHash 베이스라인은 미커밋(macOS 렌더 해시가 ubuntu와 이격) — 베이스라인 커밋 시 diff 게이트가 활성화(워크플로 헤더에 절차 문서화).
