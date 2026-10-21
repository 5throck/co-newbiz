---
lang: ko
lang_reason: source-material
---

# S9·S10 깊이 보완 — 경영진 보상 입력, 인터뷰 삼각검증, 리스크 원장·IC 첨부, 백테스트 편향·등급 조정 제안, 커버넌트 여력 (Implemented)

- **일자**: 2026-10-21
- **상태**: Implemented (슬라이스 1/3 — 후속 슬라이스: S10 자금 확정성 증빙·S11 IC 절차 표면화, S12 완결)
- **원 질의**: decider — "S9 인터뷰, 보상, 고객 CoC, 리스크 히트맵, 백테스트 … 제대로 구현이 안된 듯 한데, 해당 내용에 대한 설계 및 구현을 진행해줘", "S10 투자구조 설계도 제대로 구현이 되어있는지 점검해 줘"
- **관련**: ADR-0122 #2(리스크 히트맵·리스크 원장·IC 첨부), ADR-0123 #3(백테스트 편향·등급 조정 제안), ADR-0058(증적 참조 필수), 2026-10-19-s9-heatmap-assessment-domain-adopt-design(§6 완화조치 보류 해제), `procedures/_shared/brownfield-dd` step 7·8, `procedures/_shared/deal-structuring` step 3(fin-03), `checklists/commercial-dd-checklist.yaml` cdd-07

## 1. 문제 — 기능은 있으나 스펙·ADR이 요구하는 깊이에 못 미침

점검 결과 S9 5개 기능·S10·S11·S12는 모두 페이지·API·DB·테스트가 존재했다. 그러나 코드를 직접 읽어 확정한 격차는 다음과 같다.

| # | 격차 | 근거 |
|---|---|---|
| G1 | `management_package`는 GET만 — 주석 "batch-fed". brownfield-dd step 7(ma-04~06 경영진 CoC 보상)을 워크스페이스에서 수행할 수 없음 | `comp-parity/route.ts` |
| G2 | `dd_interview`는 평면 CRUD. cdd-07(필수)이 요구하는 "주장당 독립 출처 2~3개" 구조가 없고 판정 근거 연결도 없음 | `interviews/route.ts`, `checklists/commercial-dd-checklist.yaml:36` |
| G3 | 히트맵 집계가 **브라우저에서만** 수행 → 서버가 IC 패키지·브리핑에 첨부할 스냅샷이 없음. 0156 사이드카는 덮어쓰기(원장 아님), 완화조치 보류 | `risk-heatmap/page.tsx`, ADR-0122 #2 |
| G4 | 백테스트는 ±20% 밴드 집계만. 편향 방향 없음, 등급 조정 제안 원장 없음, `closed_at IS NULL`로 kill 학습 딜 제외 | `portfolio/backtest/route.ts`, ADR-0123 #3 |
| S10-4 | 커버넌트 여력(fin-03, ADR-0122 히트맵 입력)이 어디에도 표면화되지 않음 — `covenant_test`는 snapshot-filler의 위반 건수에만 소비 | `debt/route.ts` 자기 주석 "Wave-3 refinement" |

## 2. 결정

공통 원칙: flow.spec·게이트·절차 불변(신규 ADR 없음). 모든 기록은 사람(analyst+)·감사 로그·append-only. 자동 산정값은 제안이지 결정이 아니다(경계 #2). 근거 부족은 `insufficient_evidence`로 정직하게 표기하고 값을 발명하지 않는다.

### 2.1 G1 — 경영진 보상 패키지 사람 입력
- `POST /api/projects/{id}/comp-parity/packages`. 0033 CHECK 그대로: `executive_ref`는 `CEO-01` 형식 익명 참조만(실명 거부, SEC-05), `coc_trigger`면 `coc_payout_estimate` 필수(ma-04). 감사 `management_package.recorded`.
- 보상·형평 화면에 입력 폼과, CoC 트리거 패키지의 **"→ 조사내역"** 버튼(고객 CoC 화면과 같은 패턴 — `dd_finding` 카테고리 "경영진 보상", `value_impact = −추정 지급액(백만원)`).

### 2.2 G2 — 인터뷰 삼각검증
- 마이그레이션 0159: `dd_interview.claim TEXT`(핵심 주장). 인터뷰 한 건 = 그 주장의 출처 하나.
- `lib/interview-triangulation.ts`: 주장별 **독립 출처 = 서로 다른 인터뷰 대상 수**(같은 사람 두 번은 한 출처), `triangulated = ≥2`. GET이 요약을 파생 반환. 주장 미지정 인터뷰는 `unclaimed`로 따로 센다.
- 화면 상단에 삼각검증 요약 + 삼각검증된 주장의 "→ 조사내역"(카테고리 "인터뷰 삼각검증"). **cdd-07 판정 자체는 체크리스트에서 사람이 한다** — 이것은 근거다.

### 2.3 G3 + S10-4 — 서버 집계 히트맵, 리스크 원장, 완화조치, IC·브리핑 첨부, 커버넌트 소스
- `lib/risk-heatmap.ts`: `dd_finding`(target 없는 발견)·`contract_coc`(≥30% 또는 이탈 손실)·`incentive`(클로백 규칙)·**커버넌트 여력**(`cov:<key>`)을 같은 규칙으로 집계. 심각도 = 유효 가능성×영향(≥6 높음, ≥3 중간) — 기존 화면 규칙과 동치. `snapshot_hash`(항목 키·판정·완화조치의 sha256 앞 16자)로 어느 스냅샷을 읽었는지 식별.
- 마이그레이션 0160 `risk_assessment_ledger`(append-only, `mitigation` 포함). `PUT risk-assessment`는 원장 행 추가 + 0156 사이드카를 "키별 최신값" 투영으로 갱신(기존 독자 호환). GET은 최신값 + 이력.
- `GET /api/projects/{id}/risk-heatmap` 신설, 화면은 이를 소비(클라이언트 집계 제거). `ic-package`에 `risk_heatmap`(상위 10·건수·그리드·해시), `monitoring-brief`에 요약 첨부 — ADR-0122 #2 "snapshots auto-attach to the IC package and quarterly briefings" 충족.
- `lib/covenant-headroom.ts`: 최신 시뮬레이션의 `covenant_test`를 키별로 묶어 최소 여력 `(threshold−projected)/|threshold|`(상한) 또는 `(projected−threshold)/|threshold|`(하한). 방향은 `debt_instrument.covenant_json`에서 해석(`{DSCR_min:1.3}`·`"DSCR >= 1.3"`·`{key:{direction}}` 모두 수용); 방향을 모르면 여력 null + 위반 플래그만. 시뮬레이션 없음 → `insufficient_evidence`. `/debt` GET·IC `deal_structure.covenant_headroom`·히트맵(위반 3×3, 빠듯<10% 3×2, 여력 1×2)에 전달.

### 2.4 G4 — 백테스트 편향·코퍼스·등급 조정 제안
- `lib/backtest.ts`로 집계 추출(라우트 2개 공유). 코퍼스에 `kill_with_learning_captured` 결정이 있는 종료 프로젝트 포함(`corpus: killed`).
- `lib/backtest-bias.ts`: 부호 평균·중앙값 괴리, 과대/과소 건수, 방향(|평균|≥10pp), 표본 <3은 `insufficient_evidence`. `suggested_grade`(과대 ≥20pp → C, 10~20 → B)는 **제안 힌트일 뿐**.
- 마이그레이션 0161 `confidence_grade_adjustment_proposal`. `POST /api/portfolio/backtest/proposals` `propose|approve|reject`(모두 analyst+ 사람, 근거 필수, 감사). 승인된 조정은 `rag-service.approvedConfidenceAdjustment`가 읽어 **파생 등급과 승인 등급 중 나쁜 쪽**을 캡으로 쓴다 — 캡은 낮아지기만 한다(경계 #4; 범위별 최신 승인이 이전 승인을 대체).

## 3. 범위 밖
- S10 자금 확정성 증빙 구조화(S10-1)·4축 노트 검사(S10-2)·아티팩트 참조 파생(S10-3)·S11 IC 절차 8단계 표면화(G5) → 슬라이스 2.
- S12 greenfield 기준선 차이 보고(G6)·kill 학습 코퍼스의 S1/S2 환류(G7) → 슬라이스 3.
- 승인된 신뢰도 조정의 **상향** 반영, 제안자≠승인자 2인 규칙, 0156 사이드카 제거 마이그레이션 — 별도 결정.

## 4. 검증
- 유닛: `s9-depth-routes.test.ts`(패키지 입력·실명 거부·삼각검증·원장 2행·사이드카 투영·IC 스냅샷 해시 일치·커버넌트 위반/빠듯 판정·제안→승인→캡 C·프로젝트 B로 완화 불가·kill 코퍼스), `covenant-headroom.test.ts`, `interview-triangulation.test.ts`, `backtest-bias.test.ts`; 기존 `risk-assessment.test.ts`·`wave0-data-contract.test.ts`·`ic-package.test.ts` 통과 유지.
- 타입: `bunx tsc --noEmit -p app/web-next/tsconfig.json` 무오류.
