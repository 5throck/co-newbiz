# 설계 — 밸류체인 시나리오 시뮬레이션 (시장조사·전방산업 구조 분석)

**상태**: 승인됨 (사용자 확정 2026-08-24 — 드라이버 금리·환율·원자재·규제 / DART 실데이터 우선 + 폴백 / Phase A→D 전체)
**소유**: market-intelligence-agent (분석), data-architect (스키마), backend-engineer (구현)
**관련**: ADR-0025(proxy/value-chain 계수 격리 — 본 설계로 확장), ADR-0005(run 버저닝), ADR-0006(proxy chain), `docs/research/residual-decisions-best-practice.md`

---

## 1. 배경과 목표

진입 대상 산업의 연구가 산업 자체에 머무르지 않고 **전방(수요측) 산업까지를 포함**하도록 확장하고, (i) 향후 방향을 결정하는 주요 인자를 식별하며, (ii) 외부 환경 변화(금리·환율·원자재·규제)에 따라 산업 형태가 어떻게 바뀔지를 **정량 시뮬레이션**으로 검증한다. 아울러 밸류체인 전체(upstream→downstream)의 형태를 파악하고 각 단계의 **과거 5년 재무 성과 추이**를 단계별로 결합해, 동일한 드라이버 충격이 체인 어디에서 어떤 크기로 체감되는지를 추적한다.

## 2. 확정 스코프

- **외부 드라이버 1차 셋**: 금리(rate), 환율(fx), 원자재(commodity), 규제(regulation). 레지스트리는 확장형 — 신규 드라이버는 행 추가만으로 편입.
- **재무 소스**: DART OpenAPI 실테이터 수집 우선(`k-dart` 파싱 규율, `md_company.dart_corp_code` 연계 — 유니크 인덱스 이미 존재). 키 미설정·조회 불가 시 **폴백**: 사용자 제공 데이터 임포트 엔드포인트로 수용(진행 중단 없음).
- **단계**: Phase A(체인 데이터 평면) → B(드라이버·시나리오 스키마) → C(전파 엔진) → D(UI·거버넌스), 순차 전체.

## 3. 아키텍처

### 3.1 체인 토폴로지 (Phase A)

`value_chain_link` 행을 노드(`md_industry`)·유향 엣지로 해석하는 위상 정렬 해석기(`db/lib/value-chain-topology.ts`). 사이클 검출 시 오류(무향 처리 금지). 출력: upstream→end-market 레이어 배열, 노드별 선행/후속 링크. REST: `GET /api/projects/:id/value-chain/topology`.

노드별 5년 재무: `fact_financial`(회사, `md_company.industry` 롤업) + `fact_industry`(산업 집계 지표)를 조립해 단계별 매출성장·마진률·ROIC 추이 제공. 적재는 DART 수집기(`scripts/co-newbiz/dart-collect.ts`, revision_no 준수) 또는 폴백 임포트(`POST .../financial-imports`).

### 3.2 드라이버·시나리오 (Phase B)

- `industry_driver`: code(`rate`|`fx`|`commodity`|`regulation`|…), label_ko, source_series_id(`md_source`). 1차 4종 시드.
- `chain_node_sensitivity`: (project, industry, driver)별 민감도·lag — market-intelligence-agent가 6축 분석의 일부로 산출.
- 시나리오 정의는 **run 버저닝에 편입**: 드라이버 델타를 가정 키 `drv.rate_bp`·`drv.fx_pct`·`drv.commodity_pct`·`drv.regulation_severity`(0–3 서브젝티브 스케일, rationale 필수 — FR-DATA-07)로 기록. 프리셋 downside/base/upside 3종.

### 3.3 전파 엔진 (Phase C)

`python/structure_sim.py` — monte_carlo.py의 시드 규율(seeded Generator 전용, args-array spawn, shell 금지) 상속:

1. 드라이버 델타를 삼각분포 불확실성으로 샘플링
2. 수요 전파: 링크 elasticity×Δ(선행 노드 수요/가격 변화) → 후속 노드, lag 반영
3. 비용 전파: pass_through_rate × Δ원가(업스트림) → 마진률 영향
4. 노드별 산출: 수요 변화%, 마진률 변화%p, 집중도(HHI) 변화 — P05/P50/P95
5. 결과 저장: `structure_simulation_result`(run_id, scenario, industry_id, metric, p05/p50/p95)

REST/MCP는 simulation.ts 패턴 그대로(POST spawn + GET results, MCP thin wrapper).

### 3.4 UI (Phase D)

ProjectDetail "시장·체인" 탭: 체인 레이어 그래프 + 노드별 5년 테이블 + 시나리오 결과 카드(P50 중심, 범위 표기 — color-only 금지 계승).

## 4. 경계와 규율

- **ADR-0025 격리 확장**: 본 시뮬레이션은 `value_chain_link` 계수만 소비한다. proxy_link 계수와의 공유·차용은 금지 — proxy chain은 수요 참치의 *입력*으로만 인용된다.
- 계수 미비 링크는 전파에서 UNASSESSED 처리 — 기본값으로 치환하지 않는다(ADR-0049 조용한 통과 금지 계승).
- 모든 시뮬레이션은 run 스냅샷 하에서 평가되며, 동일 seed+입력 = 동일 출력(§12 계약).
- 규제 드라이버(v1): 정량 소스가 없어 서브젝티브 스케일 허용 — 단 rationale 필수이며 asserted 경로(dimension_input)를 거친다.

## 5. 데이터 정책

- DART 수집은 `dart_corp_code` 보유 회사에 한하며, 조회 실패·누락분은 폴백 임포트로 보완한다. 수집 원천(`source_id`)을 항상 기록해 사용자 제공 데이터와 구별한다.
- 개별 회사 재무는 프로젝트 멤버십 게이트 하에서만 조회된다(MNPI 프로젝트는 insider-list 절차 계승).

## 6. 마일스톤·테스트

| Phase | 핵심 테스트 |
|---|---|
| A | 토폴로지 정렬·사이클 오류·롤업 정합·폴백 임포트 |
| B | 스키마 CHECK·프리셋 스냅샷·drv.* 키 불변성 |
| C | 동일 seed 재현(byte-parity), 계수 미비 → UNASSESSED, 경계 위반 차단 |
| D | 빌드·접근성·탭 와이어링 |

## 7. 리스크

- value_chain_link 계수가 파일럿 의존적 → 미비 링크 다수 예상(UNASSESSED 명시가 정답)
- DART API 미세변동 → k-dart 파싱 규칙 단일 출처 유지
- 드라이버 세트 확장 시 하위호환: code enum은 CHECK가 아닌 레지스트리 행으로만 제약(마이그레이션 없는 확장)
