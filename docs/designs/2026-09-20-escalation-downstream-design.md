---
lang: ko
lang_reason: source-material
---

# 에스컬레이션 조정 CAGR의 다운스트림 반영 설계 (PROPOSED)

- Spec ID: `2026-09-20-escalation-downstream-design`
- Date: 2026-09-20
- Status: **Proposed** — 구현 전 검토 필요
- Related: `2026-09-20-calibration-escalation-design`(조정치 기록), `2026-09-18-s1-growth-gap-calibration-design`(보정 루프), ADR-0117/0137(S8 파라미터·사업 케이스)

## 1. 문제 정의

결정론 스케일링 에스컬레이션이 적용되면 조정 CAGR(외부 참조 × 0.85)이
`calibration_escalation` 행으로 기록된다. 그러나 현재 다운스트림 소비자는
모두 **버전 페이로드의 바텀업 CAGR**을 읽는다 — 에스컬레이션이 적용된 산업의
경우 보정 루프 패널의 결정 기록과 실제 모델 입력 사이에 불일치가 남는다.

예: 휴머노이드 로봇 — 바텀업 18.3% vs 조정 40.0%(잔여 격차 15%). S8 시나리오
생성이 18.3% 기준으로 NPV를 만들면, 보정 결정이 모델에 반영되지 않은 채
사업성 판단이 진행된다.

## 2. 소비자 조사 (현재 CAGR 유입 경로)

| 소비자 | 읽는 값 | 경로 | 반영 시 변경점 |
|---|---|---|---|
| S8 시나리오 생성(job-spec) | 산업 CAGR(growth) + sigma | market-sizing 최신 버전 payload → generation | job-spec 조립 시 resolver 적용 |
| S8 파라미터 스냅샷(`bc.*`) | growth 기본치 | 동일 payload 해석 | resolver 기본치로 교체, provenance 주석 |
| 밴드 몬테카를로(스윕 응답) | down/base/up 밴드 | payload CAGR ± spread | 조정치를 base로, 밴드 폭은 유지 |
| S2 인사이트(`insights`) | bottom_up_cagr_pct + 격차 | market-overview 쿼리 | 조정치 표기 + "에스컬레이션" 칩 |
| 보정 루프 패널 추이 | 버전별 gap | calibration 블록 | 이미 조정치 카드 표시(완료) |

## 3. 설계 제안

### 3.1 단일 진실 해석기 — `resolveEffectiveCagr`

`lib/market-calibration.ts`에 추가:

```
resolveEffectiveCagr(db, industryId) →
  { cagrPct, source: "bottom_up" | "escalated", escalationId?, baseCagrPct? }
```

- 최신 완료 버전의 바텀업 CAGR을 기본값으로,
- `calibration_escalation` 최신 행이 존재하면 `scaled_cagr_pct`를 대신 반환하고
  출처·원값을 함께 돌려준다(소비자가 표기를 선택할 수 있게).
- 순수 조회 — 기록은 여전히 에스컬레이션 엔드포인트만 한다.

### 3.2 소비자별 적용 (별도 PR, 각각 승인)

1. **S8 생성 job-spec**: 조립 시 resolver 호출 — growth에 조정치 사용,
   note에 `growth_source=escalated(id)` 스탬프(기존 `growth_source` 규약 확장).
   과거 기반(historical) 관점은 DART CAGR을 그대로 쓰므로 무관.
2. **S8 파라미터 스냅샷**: `bc.growth` 기본치를 resolver 값으로 — 사용자
   오버라이드(user > derived > default 계층)가 최우선이므로 기본치만 교체.
3. **밴드 MC**: base를 조정치로, down/up 밴드 폭은 기존 spread 규칙 유지.
4. **S2 인사이트**: bottom_up과 조정치를 나란히 표기하고 `에스컬레이션`
   칩 — 기회 발굴 단계에서 보수적/외부 기준 성장률을 함께 보게 함.

### 3.3 경계 원칙

- 조정치는 **사람이 기록한 결정**이므로 전파 가능하나, 모든 소비자는
  출처(escalated vs bottom_up)를 표기해야 한다 — 무표기 치환은 금지.
- 버전 페이로드는 재작성하지 않는다(append-only 유지).
- 에스컬레이션 이후 새 재분석이 더 나은 바텀업을 내면 resolver는 그 버전의
  값과 최신 escalation 중 **created_at 최신 결정**을 따른다 — 결정이 재분석
  보다 최신이면 조정치 유지(재분석이 결정을 덮지 않는다), 재분석이 최신이면
  바텀업 회귀 + 재판정. 이 규칙은 §3.1 반환에 명시한다.

## 4. 오픈 질문

- Q1: 밴드 MC의 down/up을 조정치 기준 재중심화할 때 시그마 조정 필요 여부.
- Q2: 과거 실적이 조정치와 크게 어긋나는 경우 경고 표시 기준(예: 차이 >2×sigma).
- Q3: 에스컬레이션 적용 산업을 그룹/계열사 프로파일(S3 우리계열사)에도
  표기할지 — 프로파일의 산업 연계 탭과의 정합.
