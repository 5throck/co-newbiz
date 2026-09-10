---
lang: ko
lang_reason: source-material
---

# 디자인 리뷰 체크리스트 (Design Review Checklist) — 2026-09-01

**용도**: 신규 화면·기능의 **설계 단계**에서 작성하는 디자인 산출물 검증 표 (ADR-0087 §2).
**판정**: design-system-agent 리뷰 → platform-lead 승인 (기존 3단계 리뷰 체계).
**게이트**: 구현 PR은 `bun scripts/design-lint.ts` (app/web-next) 통과 필수.

---

## 설계 문서 작성 시 필수 기재 항목

- [ ] **1. 사용 패턴** — P1 Registry / P2 Report / P3 Decision / P4 Execution / P5 Monitoring
      중 무엇을 사용하는지, 복합 단계인 경우 배치 순서 명시 (ADR-0086). 신규 패턴 필요 시
      설계 개정 + ADR 선행.
- [ ] **2. 토큰·컴포넌트 목록** — 사용하는 토큰(`design/design-tokens.json` 기준)과
      컴포넌트(SectionToolbar, RowActions, StageFrame, ConfirmDialog, RowEdit 등)를 열거.
      신규 토큰·컴포넌트는 이 단계에서 추가 승인 — 구현 중 암묵적 추가 금지.
- [ ] **3. CRUD 상호작용 표준 부합** — 등록 "＋ ~ 등록" 토글/인라인 폼, 수정 행 내 편집,
      삭제 `삭제` 라벨 + ConfirmDialog (ADR-0082).
- [ ] **4. 아이콘 어휘표 등재** — 신규 아이콘은 아래 어휘표에 등록 후 사용. 도메인 개념당 1개.

## F. 데이터 표현 (리포트 화면) — ADR-0088

- [ ] 시계열 수치 데이터는 **차트 + 피벗 테이블 병기** (계정/항목 = 행, 연도 = 열·최신순).
      항목×연도 장기 행 나열 표는 금지.
- [ ] 장문 나열(강약점·평가 사유 등)은 **블릿 목록**(`report-bullet-list`)으로 — 문단 뭉치 금지.
- [ ] 4열 이상·장문 셀 표는 **`table-scroll` 래퍼 + 열 최소폭**(`col-label`/`col-type`/`col-text`)으로
      눌림 방지.
- [ ] 금액 등 수치에 **단위 표기**(예: 억원)와 **출처 칩/링크** 병기.
- [ ] 합산 검증·무결성 경고는 표/차트 옆 **경고 배너**로 노출.
- [ ] 표 셀은 `word-break: keep-all` (한국어 어간·영문 단어 중간 개행 금지 — 전역 적용됨).
- [ ] 라벨/이름 열은 `col-label`(12rem 최소폭) 이상 — `w-[7rem]`류 고정 협폭 지정 금지.

## 구현 PR 게이트 (자동 검출)

```bash
cd app/web-next && bun scripts/design-lint.ts
```

| 규칙 | 내용 | 근거 |
|---|---|---|
| R1 | 버튼 크기 수식(text-[...]) 금지 — 기본/btn-sm 2종만 | ADR-0083 |
| R2 | TSX 하드코딩 hex 색상 금지 — 토큰 경유 | ADR-0087 |
| R3 | 헤더 margin-left:auto 우회 금지 — SectionToolbar 슬롯 | ADR-0083 |
| R4 | 단계 화면 `<h1>` 직접 사용 금지 — StageFrame 필수 | ADR-0086 |
| R5 | window.confirm 금지 — ConfirmDialog | ADR-0082 |
| R6 | 삭제 라벨 "제거/기각" 금지 — "삭제" 통일 | ADR-0082 |

---

## 아이콘 어휘표 (Icon Vocabulary) — lucide-react

도메인 개념당 1개. 신규 개념은 표에 추가 후 사용. 크기: 내비 18px / 행·인라인 액션 16px.

| 개념 | 아이콘 (lucide) | 사용처 |
|---|---|---|
| 대시보드 | LayoutDashboard | 내비 |
| 시장분석 (S1) | LineChart | 내비 |
| 기회 발굴 (S2) | Lightbulb | 내비 |
| 그룹/계열사 분석 | Landmark | 내비 |
| 시너지 정합성 (S3 지원) | Handshake | 내비 |
| 진출방식 결정 (S4) | GitBranch | 내비 |
| 역량 평가·진출전략 (S5) | Sprout | 내비 |
| 대상 후보 발굴 (S6) | Target | 내비 |
| 벤치마킹 사례 | Building2 | 내비 |
| 전략 | Compass | 내비 |
| 프로젝트 파이프라인 | ListChecks | 내비 |
| 관리자 | Shield | 내비 |
| 규정·체크리스트 | LibraryBig | 내비 |
| 용어집 | BookOpen | 내비 |
| 검색/조회 | Search | 폼·툴바 |
| 되돌리기 (상세→목록) | ChevronLeft | Topbar |
| 라이트/다크 모드 | Sun / Moon | Topbar |
| 로그아웃 | LogOut | Topbar |

관리 콘솔 개별 화면 아이콘 (`ADMIN_ICON_BY_HREF`): LayoutDashboard(시스템 대시보드), Users(사용자·토큰), ScrollText(감사 로그), Database(데이터 소스), CalendarClock(스케줄), HardDrive(데이터베이스), Bell(알림), BookOpen(용어집), Scale(거버넌스), Layers(마스터 데이터), FileText(ADR). 도메인 개념당 1개 원칙 유지 — 기존 내비 아이콘과 중복되지 않게 개념을 구분해 등록.
