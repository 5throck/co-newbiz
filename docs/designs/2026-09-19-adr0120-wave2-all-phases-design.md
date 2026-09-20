---
lang: ko
lang_reason: source-material
---

# ADR-0120 Wave 2 — Stage Screen Integration Design (Phases A/B/C)

- Spec ID: `2026-09-19-adr0120-wave2-all-phases`
- Date: 2026-09-19
- Status: **Implemented (Phase A)** — Phase A 구현·검증 완료(2026-09-17), Phase B/C는 후속 PR
- Related: ADR-0120, ADR-0074, ADR-0086, ADR-0094/0095
- Design pattern: S4 `RouteDecisionStage` 선례 준용 — 본문을 독립 컴포넌트로
  추출하고 기존 페이지·deals 탭이 동일 컴포넌트를 소비한다.

## 1. Phase A — S5 자체 진출 + S2 기회 발굴 (패턴 확립)

> **구현 현황 (2026-09-17)**: 완료. `GreenfieldStage.tsx`(S5 본문: 진출전략 폼·
> 필요 역량 확인·투자비 검토 요건·LLM 추천·GateDecisionPanel·PromotionPanel)와
> `OpportunityFunnelStage.tsx`(S2 본문: KPI 필터·산업 발굴·퍼널 목록·직접 등록,
> `opportunityId`로 캐리어 기회 행 표시)를 추출했다. `/greenfield`는 칩 선택·URL
> 동기화 래퍼로, `/opportunities`는 StageFrame 래퍼로 축소했다. deals 탭은 S2·S4·S5
> 분기마다 별도 자식 컴포넌트로 분리해 훅 순서 위반(조기 반환으로 훅 수 갈림)을
> 해소했다. 검증: tsc·design-lint·`bun run test:unit`(120/120) 클린.

### S5 자체 진출 (`/greenfield`, 386줄)

**추출 컴포넌트**: `components/stages/GreenfieldStage.tsx`

**추출 범위**: 역량 갭 확인 + 진출전략 + 투자비 검토 + GateDecisionPanel
(page chrome·crumb 제외 본문 전체)

**props**: `opportunityId: string`

**deals 탭 연결**: `deals/[id]/[stage]/page.tsx`에서 S5 케이스로 렌더링

### S2 기회 발굴 (`/opportunities`, 487줄)

**추출 컴포넌트**: `components/stages/OpportunityFunnelStage.tsx`

**추출 범위**: 기회 퍼널 목록 + 상세 + 매력도 평가 + S3 링크

**props**: `opportunityId: string`

### 설계 결정

- 기존 페이지(`/greenfield`, `/opportunities`)는 래퍼로 유지 (호환성)
- 공유 컴포넌트는 `components/stages/` 디렉터리에 배치
- `opportunityId`는 URL 파라미터에서 추출하여 props로 전달
- API 호출 로직은 컴포넌트 내부에 유지 (별도 훅으로 분리하지 않음)

## 2. Phase B — S3 시너지 + S6/S7 브라운필드

### S3 시너지 (`/synergy`, 1,188줄)

**추출 컴포넌트**: `components/stages/SynergyStage.tsx`

**추출 범위**: 시너지 분석 목록 + 상세 4탭(개요·연계·우선·출처) +
GateDecisionPanel + 필요 역량 수준

**props**: `opportunityId: string`, `analysisId?: string`

### S6/S7 브라운필드 (`/brownfield`, 1,379줄)

**추출 컴포넌트**: `components/stages/BrownfieldStage.tsx`

**추출 범위**: 목표 시장 + 후보 발굴 + 숏리스트 + 체크리스트 + CommitteePanel
+ GateDecisionPanel + PromotionPanel

**props**: `opportunityId: string`

### 설계 결정

- GateDecisionPanel·CommitteePanel은 기존 공유 컴포넌트를 재사용 (신규 작성 X)
- S3 시너지의 4탭 구조(개요·연계·우선·출처)는 유지
- 브라운필드의 체크리스트(t-01~t-09)는 목표 시장 섹션과 통합

## 3. Phase C — S1 시장분석 + S3 우리계열사

### S1 시장분석 (`/market`, 2,801줄)

**추출 컴포넌트**: `components/stages/MarketAnalysisStage.tsx`

**추출 범위**: 산업 목록 + SizingReport 8단계 + 가치사슬 그래프 + 보정 루프
+ 외부 참조 편집 + 드라이버 스윕 패널

**props**: `analysisId: string`

### S3 우리계열사 (`/our-company`, 1,577줄)

**추출 컴포넌트**: `components/stages/OurCompanyStage.tsx`

**추출 범위**: 그룹 목록 + 프로파일 5탭(재무·SWOT·산업·경쟁·출처) +
경쟁사 레지스트리 + GateDecisionPanel

**props**: `memberId: string`, `groupId?: string`

### 설계 결정

- SizingReport의 8단계 리포트 구조(개요→구조→규모→...→규제)는 유지
- 보정 루프 패널(외부 참조·드라이버 스윕·격차 추이)은 S1의 핵심 신규 기능으로 유지
- 차트(ECharts)는 기존 `useChartTheme` 훅 재사용

## 4. 공통 설계 규칙

1. **컴포넌트 위치**: `components/stages/` 디렉터리
2. **props 인터페이스**: 각 컴포넌트는 명시적 props만 받음 (전역 상태 사용 X)
3. **API 호출**: 컴포넌트 내부에서 `api.get/post/put` 직접 호출 (훅 분리 X)
4. **상태 관리**: `useState` + `useEffect` (외부 상태 관리 라이브러리 X)
5. **스타일**: Tailwind CSS + 기존 CSS 변수 (`status-chip`, `sizing-grade-card` 등)
6. **레이아웃**: StageFrame으로 래핑하지 않음 (호출자가 StageFrame을 이미 제공)
7. **에러 처리**: `PageState` 컴포넌트 재사용

## 5. 검증

각 Phase별:
- [ ] `bunx tsc --noEmit` 클린
- [ ] design-lint 0 위반
- [ ] 기존 페이지 회귀 없음 (스크린샷 비교)
- [ ] deals 탭에서 동일 데이터·기능 접근 가능
- [ ] `bun run test:unit` 기존 실패 외 신규 없음

## 6. 보정 사이클 4 (동시 진행)

Phase A~C와 독립적으로 보정 사이클 4를 실행합니다.

- 사이클 3 결과: 연료전지 41.8% (이전 33.5%), 휴머노이드 미생성 (보호 모드)
- 사이클 4: 신규 제안 수용 → 재분석 → 격차 재측정
- 판정선 ≤15% 도달까지 반복 (사이클 단위 보고 후 사람이 계속 여부 결정)
