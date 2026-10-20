---
lang: ko
lang_reason: source-material
---

# S12 완결 — greenfield 실행 기준선 대비 차이 보고, kill 학습 코퍼스의 S1/S2 환류 (Implemented)

- **일자**: 2026-10-21
- **상태**: Implemented (슬라이스 3/3 — 선행: 2026-10-21-s9-s10-depth-…-design, 2026-10-21-s10-funding-certainty-s11-ic-review-steps-design)
- **원 질의**: decider — "S12 사후관리 … 제대로 구현이 안된 듯 한데, 해당 내용에 대한 설계 및 구현을 진행해줘"
- **관련**: flow.spec S12 outputs "실행 기준선 대비 차이(greenfield)"·completionCriteria(ADR-0161 — 참고 기준, 게이트 차단 아님), ADR-0150 기준 6(kill 학습 → S1/S2 기본률 환류; group-review-agent 기록·risk-officer 환류), ADR-0151(전환별 부속 기록 컬럼), `procedures/_shared/portfolio-venture-monitoring` v1.2.0, `lib/greenfield-execution.ts`(S11 실행 기준선·`GREENFIELD_MEASURE_KEYS`)

## 1. 문제

S12의 쓰기 측면(분기 스코어카드·사람 전환 결정·ADR-0150/0151 기준 1~6 부속 기록)은 라우트가 강제하고 있어 완결돼 있었다. 남은 격차 두 가지:

| # | 격차 | 근거 |
|---|---|---|
| G6 | greenfield **실행 기준선 대비 차이** 보고가 없음 — S11에서 확정한 기준선(설비투자 트랜치·채용 계획·가동 KPI·인허가/인증 마일스톤·인센티브 의무)과 분기 스코어카드를 대조하는 뷰가 어디에도 없음 | `PortfolioStage`·`PostManagementPanel`·`post-management` 라우트에 `baseline`/`variance` 참조 0건 |
| G7 | `learning_capture`는 S12에서 기록·표시만 되고 S1/S2 어느 표면도 읽지 않음 — `track-advisory.ts`의 기본률은 `gate_decision`만 사용 | 기준 6의 "환류" 데이터 경로 부재 |

## 2. 결정

### 2.1 G6 — `lib/baseline-variance.ts` (파생 전용, 테이블·쓰기 없음)
- 입력: `latestConfirmedBaseline()`의 확정 기준선 항목 + `trancheReconciliation()`의 트랜치 + 해당 분기(`review_cycle`, 기본은 최신)의 `venture_scorecard` 행.
- 행 산정 규칙(**읽는 방식을 행마다 명시** — `comparison`):
  - 설비투자: 릴리스된 트랜치 합계 vs 스코어카드 `capex_deployed_vs_tranche` 실적 (`tranche_release_progress`).
  - 채용: 분기까지 도래한 계획 인원 합 vs `headcount_vs_plan` 실적 (`count_due_by_cycle`).
  - 가동 KPI: 기한이 분기 말 이전인 목표만, `goal:<metric_key>` 또는 동일 키 실적과 비교 — 방향 정보가 없어 **높을수록 좋음으로 가정**했음을 표기 (`higher_is_better_assumed`).
  - 인허가·인증 마일스톤: 기한 도래 건수 vs `*_milestones_met` 실적.
  - 인센티브 의무: 기한 도래 건수만, 실적 소스 없음 → 항상 근거 부족·참고 (`reference_only`).
  - 스코어카드에 대응 행이 없으면 `insufficient_evidence` — 채워 넣지 않는다.
- 뷰 상태: `not_applicable`(greenfield 아님) / `no_confirmed_baseline` / `no_scorecard_cycle` / `computed`; `gate_blocking: false` 고정(ADR-0161).
- `GET post-management`에 `baseline_variance` 추가, `PostManagementPanel` 가동 지표 아래 표(계획대로/뒤처짐/앞섬/근거 부족 요약 포함).

### 2.2 G7 — `lib/learnings.ts` + `GET /api/portfolio/learnings` + `LearningCorpusPanel`
- `venture_transition_decision`의 `kill_with_learning_captured` 행을 트랙·산업으로 걸러 반환. **비멤버에게는 프로젝트 식별(이름·번호·id)을 가리고 학습 문장만** 준다(백테스트의 규칙과 동일 — 학습은 조직 수준의 교훈이다).
- `track-advisory.ts` 기본률에 `killed_with_learning`(트랙별 kill 건수) 추가 — S4 권고의 기본률 표에 표시 가능.
- S1(시장분석)·S2(기회 발굴) deal 탭 하단에 접힌 패널로 최근 학습 5건 노출. **표시 전용** — 기본률 조정 판단은 risk-officer/사람(기준 6의 데이터 소유자)에게 남는다.

## 3. 범위 밖
- 기준선 차이의 분기 간 추세·알림, KPI 방향(높을수록/낮을수록) 메타데이터의 기준선 항목 추가(현재는 가정 표기), 학습 코퍼스의 S1 산업 기본률 수치 자동 조정.

## 4. 검증
- 유닛: `s12-baseline-variance-learnings.test.ts`(분기 말 계산·채용/마일스톤 기한 도래 집계·KPI 비교·미도래 KPI 제외·근거 부족 표기·`no_confirmed_baseline` 정직 저하·post-management 전달·학습 코퍼스 반환·비멤버 식별 가림·트랙 필터), 기존 `portfolio.test.ts`·`post-management-view.test.ts`·OpenAPI 드리프트·테이블 사이징·금지 용어 가드 통과.
- 타입: `bunx tsc --noEmit -p app/web-next/tsconfig.json` 무오류.
