---
lang: ko
lang_reason: source-material
---

# ADR-0120 Wave 2 — Stage Screen Integration into `/deals/[id]/[stage]`

- Spec ID: `2026-09-19-adr0120-wave2-stage-integration`
- Date: 2026-09-19
- Status: **Proposed** — 설계 승인 후 단계별 구현
- Related: ADR-0120 (deal-centric workspace IA), ADR-0074 (definition-driven UI), ADR-0086 (StageFrame), ADR-0094/0095 (carrier model)

## 1. 현황

6개 단계 화면(총 ~7,818줄)이 사이드바 개별 페이지로 존재하며,
`/deals/[id]/[stage]`는 S4를 제외한 모든 단계에서 **안내 스텁**(102줄)으로
동작합니다. S4만 RouteDecisionStage로 완전 통합되어 있습니다.

### 화면별 규모

| 단계 | 화면 | 줄 수 | 주요 컴포넌트 | 통합 난이도 |
|---|---|---|---|---|
| S1 | /market | 2,801 | 산업 목록 + SizingReport + 가치사슬 그래프 + 보정 루프 | ★★★ 높음 |
| S2 | /opportunities | 487 | 기회 퍼널 목록 + 상세 + 스케치 | ★ 낮음 |
| S3 | /synergy | 1,188 | 시너지 분석 + 연계·우선·역량 + GateDecisionPanel | ★★ 중간 |
| S3 | /our-company | 1,577 | 그룹 목록 + 프로파일(재무·SWOT·경쟁) + 경쟁사 레지스트리 | ★★ 중간 |
| S5 | /greenfield | 386 | 역량 갭 + 진출전략 + 투자비 + 게이트 | ★ 낮음 |
| S6/S7 | /brownfield | 1,379 | 목표 시장 + 후보 발굴 + 체크리스트 + 위원회 + 게이트 | ★★★ 높음 |

## 2. 설계 — 컴포넌트 추출 + 탭 래퍼 패턴

각 단계 화면에서 **페이지 크롬(sidebar·header·crumb)을 제외한 본문**을
독립 컴포넌트로 추출하고, 두 표면(기존 페이지 + deals 탭)이 동일 컴포넌트를
소비하도록 합니다.

### 컴포넌트 추출 패턴

```
// 기존 (페이지 내 인라인 로직)
app/market/page.tsx (2,801 lines) — 전체 로직 인라인

// 개선 (컴포넌트 추출 + 래퍼)
components/stages/MarketAnalysisStage.tsx  ← 본문 로직 (신규 추출)
app/market/page.tsx                        ← 래퍼 (산업 목록 + MarketAnalysisStage)
deals/[id]/[stage]/page.tsx (S1 탭)        ← 래퍼 (MarketAnalysisStage)
```

### S4 선례 (RouteDecisionStage)

S4는 이미 이 패턴으로 완료되었습니다:
- `components/stages/RouteDecisionStage.tsx` — 본문 로직
- `app/route-decision/page.tsx` — 래퍼 (기존 페이지)
- `deals/[id]/[stage]/page.tsx` S4 케이스 — 래퍼 (deals 탭)

### 단계별 추출 범위

| Phase | 단계 | 추출 컴포넌트 | 예상 줄 수 | 의존성 |
|---|---|---|---|---|
| **A** | S5 자체 진출 | GreenfieldStage | 386 → ~300 | 없음 |
| **A** | S2 기회 발굴 | OpportunityFunnelStage | 487 → ~400 | 없음 |
| **B** | S3 시너지 | SynergyStage | 1,188 → ~900 | GateDecisionPanel (기존) |
| **B** | S6/S7 브라운필드 | BrownfieldStage | 1,379 → ~1,000 | GateDecisionPanel, CommitteePanel (기존) |
| **C** | S1 시장분석 | MarketAnalysisStage | 2,801 → ~1,800 | 없음 (신규 추출) |
| **C** | S3 우리계열사 | OurCompanyStage | 1,577 → ~1,100 | 없음 |

## 3. 단계별 구현

### Phase A — S5 + S2 (패턴 확립)

**목표**: 가장 작은 2개 화면으로 컴포넌트 추출 패턴을 확립합니다.

1. S5 `/greenfield` (386줄):
   - `GreenfieldStage` 컴포넌트 추출
   - 역량 갭 확인 + 진출전략 + 투자비 + GateDecisionPanel 포함
   - deals 탭에서 `opportunityId`를 props로 전달

2. S2 `/opportunities` (487줄):
   - `OpportunityFunnelStage` 컴포넌트 추출
   - 기회 퍼널 목록 + 상세 + 매력도 평가 포함
   - deals 탭에서 `opportunityId`를 props로 전달

**산출물**: `components/stages/GreenfieldStage.tsx`, `components/stages/OpportunityFunnelStage.tsx`

### Phase B — S3 시너지 + S6/S7 브라운필드

1. S3 `/synergy` (1,188줄):
   - `SynergyStage` 컴포넌트 추출
   - 목록 + 상세 4탭 + GateDecisionPanel 포함
   - deals 탭에서 `analysisId`를 props로 전달

2. S6/S7 `/brownfield` (1,379줄):
   - `BrownfieldStage` 컴포넌트 추출
   - 목표 시장 + 후보 발굴 + 숏리스트 + 체크리스트 포함
   - deals 탭에서 `opportunityId`를 props로 전달

**산출물**: `components/stages/SynergyStage.tsx`, `components/stages/BrownfieldStage.tsx`

### Phase C — S1 시장분석 + S3 우리계열사

1. S1 `/market` (2,801줄):
   - `MarketAnalysisStage` 컴포넌트 추출
   - 산업 목록 + 리포트 8단계 + 보정 루프 포함
   - deals 탭에서 `industryId`를 props로 전달

2. S3 `/our-company` (1,577줄):
   - `OurCompanyStage` 컴포넌트 추출
   - 그룹 목록 + 프로파일 5탭 + 경쟁사 레지스트리 포함
   - deals 탭에서 `memberId`를 props로 전달

**산출물**: `components/stages/MarketAnalysisStage.tsx`, `components/stages/OurCompanyStage.tsx`

## 4. 검증

각 Phase별:
- [ ] 기존 페이지 회귀 없음 (레이아웃·기능 동일)
- [ ] deals 탭에서 동일 데이터·기능 접근 가능
- [ ] StageFrame 스텝퍼 정상 렌더링
- [ ] GateDecisionPanel 등 공유 컴포넌트 정상 동작
- [ ] `bunx tsc --noEmit` 클린
- [ ] design-lint 0 위반
- [ ] 전체 유닛 스위트 기존 실패 외 신규 없음

## 5. 명시적 한계

- 본 작업은 **기존 화면의 재배치**이지 새 기능 추가가 아닙니다.
- StageFrame은 단일 단계 셸로 유지됩니다 (ADR-0086).
- 레거시 페이지는 호환 래퍼로 유지되며 최종 sweep에서 307 리다이렉트로 전환됩니다 (ADR-0120 §3).
