---
lang: ko
lang_reason: source-material
---

# S8 사업성 평가 고도화 — 독립 시뮬레이션 엔진과 객관적 사업계획 요소

- Spec ID: `2026-09-18-s8-business-case-evaluation`
- Date: 2026-09-18
- Status: draft — Phase 1·2 구현 완료 (feat/new-feature, 2026-09-18). Phase 1: python/sim_engine/ 엔진, TS 브리지(app/web-next/lib/sim-engine.ts + 제너레이터 격하). Phase 2: 마이그레이션 0111–0113(판매목표 컬럼·BEP 컬럼·inputs_json), 엔진 ramp_up 드라이버, bc.capture_rate/bc.ramp_up.y* 파라미터 체계, flow.spec S8 완료기준 갱신(BEP+스냅샷), greenfield/brownfield-fs target_costing 스텝 + target-costing-analysis 스킬 + target_cost_gap 출력 유형. Phase 3(WACC 주체)·4(UI+품평회)는 후속.
- Origin: 2026-09-18 사용자 요구 4건(사업계획 요소, 시뮬레이션 투명성·파라미터 조정, 독립 엔진·병렬 처리·품평회, GPU·CPU 하이브리드 연산 장치)을 S8 스택 코드 조사로 정착시킨 설계.
- Related: ADR-0052 §D.4 (시드 결정론 몬테카를로), ADR-0098 (S8 멀티 비즈니스 케이스 생성), ADR-0114 (그룹/계열사 사업목표 기준), ADR-0115 (WACC 성분 분해), ADR-0117 (듀얼 퍼스펙티브 밸류에이션), ADR-0086/0087/0088 (화면 패턴·토큰·데이터 표현), `process/flow.spec.yaml` (S8, fs 게이트), `procedures/_shared/{greenfield,brownfield}-fs/schema.yaml`

## Problem

S8(사업성 분석)의 현재 구현은 "돈이 되는가?"라는 단계 목표에 비해 다음 아홉 가지가 부족하다.

1. **연간 판매목표 부재** — 1년차 매출이 `시장규모 × 고정 포획률 0.5%`로만 결정된다(`business-case-generator.ts:169,281`의 `CAPTURE_RATE = 0.005`). 물량×가격 분해, 연도별 판매목표, 가동률 램프업 개념이 없다.
2. **타겟코스팅 전무** — 시장가격에서 역산한 허용원가와 추정원가의 격차를 다루는 절차·아티팩트가 스펙·프로시저·스킬 어디에도 없다(전수 grep 확인).
3. **BEP 계산 경로 부재** — fs 게이트 판정기준은 "NPV/IRR/BEP 또는 밸류에이션 범위"를 요구한다(`flow.spec.yaml:103`). 그러나 이를 산출하는 엔진·스킬이 없다. `investment-feasibility-modeling`은 NPV/IRR/payback까지만 다룬다.
4. **WACC 적용 주체 규칙 부재** — `wacc-input-session`은 단일 WACC만 확인한다. 그린필드 자체추진(투자주체)과 브라운필드 인수·지분참여(대상기업) 중 누구의 자본비용으로 평가하는지 기록하는 필드와 트랙별 규칙이 없다.
5. **시뮬레이션 투명성 부족** — 드라이버·출처·시드가 `valuation_simulation.note`의 `key=value;` 문자열로만 존재하고, UI가 이를 파싱해 일부만 표시한다(`page.tsx:78-86`의 `parseNote`). 구조화된 입력 스냅샷이 없어 "어떤 인자로 어떻게 돌았는지"를 신뢰할 수 있게 보여주지 못한다.
6. **파라미터 조정 불가** — 생성 POST가 본문을 받지 않고(`generate/route.ts:18-46`), 성장률·변동성·포획률·OPEX/CAPEX 비율·반복수가 DB 유도값 또는 하드코딩 상수(`business-case-generator.ts:168-184`)라서 사용자가 조정할 수 있는 것은 WACC(전용 패널)와 라인 JSON 편집기뿐이다.
7. **웹 내장 엔진의 구조적 한계** — 실제 시뮬레이션은 웹 프로세스 안 TS 루프(2,000회, `runSeededSimulation` `business-case-generator.ts:266-295`)로 돈다. 복잡도가 올라가면(분포 다변화, 반복 수 증가, 우발부채 통합) 웹 요청 시간이 직접 늘어나고, 웹 밖(Batch, 분석 스크립트)에서 재사용할 수 없다.
8. **병렬 처리 부재** — 시나리오 × 관점 × 파라미터 세트가 직렬로 실행된다. 다양한 케이스를 비교하는 S8의 본질과 달리 연산 계층에 병렬화가 없다.
9. **품평회 미경험** — S8 화면은 live GUI 리뷰(품평회)를 거친 적이 없다. 기능 적합성뿐 아니라 사용성·편의성·가독성 축의 평가와 개선 반영 루프가 절차에 없다. (선례: 2026-09-17 품평회 → `2026-09-18-s1s7-process-alignment-design.md`)

## 설계 원칙

1. **엔진과 오케스트레이션 분리** — 시뮬레이션 연산은 웹 프로세스 밖 독립 엔진이 담당하고, 웹은 job-spec 작성·실행·표시만 담당한다.
2. **입력 스냅샷 = 실행 계약** — 엔진은 받은 job-spec을 결과와 함께 그대로 반환한다. "어떤 인자로 어떻게 돌았는지"가 구조적으로 보장된다.
3. **결정론 유지** — 동일 입력은 항상 동일 결과를 낸다(ADR-0052 §D.4). 파라미터가 바뀌면 시드가 결정적으로 바뀐다.
4. **출처 등급 전면 적용** — 모든 파라미터는 `user > derived > default` 등급과 출처 라벨을 가진다(`wacc.*` 선례).
5. **게이트 판정은 인간** — 본 설계의 모든 정량 산출은 제안이며 채택·게이트 판정은 사람이 기록한다(ADR-0053/0094).

## 1. 독립 시뮬레이션 엔진 (W7·W8)

### 1.1 언어 검토 (의사결정 기록)

| 후보 | 평가 | 판정 |
|---|---|---|
| **Python (numpy)** | 기존 자산 `python/monte_carlo.py`(numpy 시드 결정론, JSON in/out, 삼각분포 우발부채 통합)과 `python/` 스택(driver_tree, kpi)이 존재. numpy 벡터화는 반복 루프를 네이티브 속도로 처리하므로 C 대비 성능 손실이 미미하고, 분포·통계 확장(scipy)과 재무 분석 생태계 정합성이 가장 큼. 병렬화는 표준 라이브러리 multiprocessing으로 충분 | **채택** |
| TypeScript (현상 유지) | 웹 프로세스와 결합되어 복잡도·반복 수 확장 시 요청 시간 직접 증가. 벡터화 한계로 순수 루프 대비 수십 배 열위, 웹 밖 재사용 불가 | 기각 |
| Java | JVM 운영·배포 부담, 수치 프로토타이핑 코드가 장황, 레포 선례 없음 | 기각 |
| C/C++ | 최고 성능이나 개발·메모리 안전성 비용이 크고, 필요한 벡터 연산은 numpy가 이미 네이티브로 수행 | 기각 |
| Rust | 성능·안전성은 우수하나 레포 선례 없음, 학습곡선 대비 이득이 벡터화로 대부분 소진 | 기각 |

**결정**: Python + numpy + multiprocessing. TS는 job-spec 작성과 결과 표시만 하는 오케스트레이터로 축소한다. 웹은 엔진을 서브프로세스로 실행한다(기존 선례 `scripts/co-newbiz/simulate.ts:23-52`).

### 1.2 엔진 위치와 실행 계약

- 신규 패키지 `python/sim_engine/`에 범용 엔진을 둔다. 기존 `python/monte_carlo.py`의 우발부채 삼각분포 계약을 흡수하고, 이관 완료 후 phase-out한다.
- 입력(job-spec JSON) — S8 전용이 아닌 **일반 드라이버 세트**:

```json
{
  "job_id": "string",
  "seed_policy": { "base": "<projectId>:<scenario>", "hash": "fnv1a" },
  "device": "auto",
  "iterations": 10000,
  "horizon_years": 5,
  "discount_rate": { "value": 0.10, "subject": "promoter", "source": "user" },
  "cases": [
    {
      "case_id": "base:market_forward",
      "drivers": {
        "volume_y1":     { "dist": "constant", "value": 200000, "unit": "EA", "source": "sales_plan" },
        "price":         { "dist": "normal", "mean": 12000, "sigma": 800, "unit": "KRW", "source": "peer_benchmark" },
        "ramp_up":       { "dist": "constant", "value": [0.4, 0.7, 0.9, 1.0, 1.0], "source": "default" },
        "opex_ratio":    { "dist": "normal", "mean": 0.60, "sigma": 0.03, "source": "default" },
        "capex_schedule":[{ "year": 0, "amount_krw_m": 25000 }],
        "contingent_liabilities": [
          { "probability": 0.3, "amount_low": 10, "amount_expected": 25, "amount_high": 60, "timing_year": 2 }
        ]
      }
    }
  ]
}
```

- 분포 어휘: `normal | triangular | uniform | constant` (최소 집합, 확장 가능).
- 출력(per case): `seed, iterations, npv {p05, p50, p95, mean, std}, irr, payback_discounted_years, bep_year, bep_volume, warnings` + **입력 job-spec 전체(스냅샷)**. p05가 위험 척도(VaR 역할)를 유지한다.

### 1.3 병렬 처리

- **케이스 간**: multiprocessing Pool로 케이스별 프로세스 병렬(코어 수 캡). 시나리오 × 관점 × 파라미터 세트 그리드가 그대로 병렬 단위가 된다. GPU가 선택된 작업은 프로세스 풀 대신 단일 프로세스에서 케이스 배치를 장치로 스트리밍한다(GPU 메모리 경합 방지 — §1.4).
- **케이스 내**: 반복 루프는 numpy 벡터화(반복 수 × 연도 행렬 연산).
- **시드 정책**: `seed = fnv1a(case_id + ":" + sha256(canonical_case_drivers))`. 같은 입력 → 같은 시드 → 같은 결과(재현성). 파라미터 조정 시에도 재현성 계약이 깨지지 않고, 조정 전후 결과는 독립 표본으로 구분된다(ADR-0117의 variant 간 시드 공유 계약은 같은 드라이버 집합 내에서 유지).
- **실행 모드**: (a) 웹 오케스트레이터의 동기 서브프로세스 실행 — 기본 크기 그리드; (b) 대량 그리드용 백그라운드 실행 — `activity_run` 진행 폴링 경로(ADR-0096 체계 재사용).

### 1.4 연산 장치 계층 (GPU·CPU 하이브리드)

- REQ-W7-1: 엔진은 실행 장치를 job-spec `device` 필드로 받는다. `auto`(기본)면 감지 순서 `cuda(NVIDIA) > mps(Apple Silicon) > xpu(Intel) > rocm/hip(AMD) > cpu`로 선택하고, 명시 지정 시 해당 장치만 사용한다. 환경변수 `SIM_ENGINE_DEVICE`가 job-spec 값을 오버라이드할 수 있다(운영 환경 강제용).
- REQ-W7-2: 연산 런타임은 **PyTorch 단일 추상화**로 통일한다 — 하나의 디바이스 인터페이스가 네 벤더를 커버한다(CUDA 빌드=NVIDIA, ROCm 빌드=AMD/HIP, MPS=Apple Silicon, XPU=Intel oneAPI). 벤더별 개별 어레이 라이브러리 조합(CuPy=NVIDIA, MLX=Apple, dpnp=Intel)은 관리 포인트만 늘어나므로 기각한다. ROCm은 torch ROCm 빌드가 별도로 필요하므로 배포 시 빌드 변형(cuda/rocm/arm64-mps/xpu)을 문서화한다.
- REQ-W7-3: CPU 경로는 numpy 단독으로 유지한다(추가 의존성 없음). torch는 optional extra로 분리하고 lazy import — torch가 없거나 호환 GPU가 없으면 자동으로 CPU로 폴백하며, 스냅샷 `warnings`에 폴백 사실을 기록한다.
- REQ-W7-4: 장치별 시드 RNG 스트림은 서로 다르므로 재현 계약을 "**동일 job-spec + 동일 장치 → 동일 결과**"로 정밀화한다. 스냅샷에 사용 장치·빌드·정밀도를 기록하고, 다른 장치로 재현하면 통계적 등가 결과임을 `warnings`로 표시한다.
- REQ-W7-5: 정밀도 — CPU float64 기본, GPU float32 기본(Metal은 fp64를 지원하지 않는다). 분위수 결과의 백분위 상대오차 허용치(기본 1e-3)를 두고, 백엔드 등가 회귀 테스트(§10-2)가 이 허용오차를 사용한다.
- REQ-W7-6: GPU 페이오프 휴리스틱 — 전송 오버헤드가 지배하는 작은 작업(반복 수 × 케이스 수 임계 이하)은 GPU가 있어도 CPU로 실행한다. 임계값은 실측으로 보정하며 `auto` 선택 근거를 스냅샷에 남긴다.

### 1.5 S8 제너레이터 격하

- `business-case-generator.ts`는 하드코딩 상수·시뮬레이션 루프를 제거하고 **job-spec 빌더 + 엔진 스포너**가 된다. 현 상수 값(CAPTURE_RATE 0.005, OPEX 0.6, CAPEX 0.1, 초기투자비 0.5, HORIZON 5, 반복 2,000)은 기본값 테이블로 이동하며, 모두 §3의 `bc.*` 오버라이드 대상이 된다.

## 2. 사업계획 요소 (W1–W3)

### 2.1 W1 — 연간 판매목표

- REQ-W1-1: `business_case_line`에 `sales_volume`(연 물량)과 `unit_price_krw`(단가) nullable 컬럼을 추가한다(마이그레이션). 두 값이 있으면 매출 = 물량 × 단가로 산정하고 `annual_amount_krw_m`은 파생값으로 일관성 검증한다.
- REQ-W1-2: 연도별 가동률 램프업(`bc.ramp_up`, 기본 `[0.4, 0.7, 0.9, 1.0, 1.0]`, 출처 라벨과 함께 조정 가능)을 물량에 곱해 연간 판매목표를 만든다.
- REQ-W1-3: 고정 포획률을 `bc.capture_rate` 파라미터로 전환한다(기본 0.005 유지). 물량 직접 입력 시 포획률은 무시되고 그 사실이 출처 라벨로 표시된다.
- REQ-W1-4: S8 화면에 판매목표를 연도×항목 피벗(물량·단가·매출, 단위 표기)으로 표시한다(ADR-0088).

### 2.2 W2 — 타겟코스팅

- REQ-W2-1: `greenfield-fs`/`brownfield-fs` 프로시저에 step `target_costing`(financial-analyst)을 추가한다. 산출: 시장가격(출처: peer benchmark 또는 proxy demand chain) → 목표마진 역산 **허용원가** vs 추정 단위원가 → **원가 격차(gap)**와 축소 방안 필드.
- REQ-W2-2: 신규 스킬 `target-costing-analysis`(owner: financial-analyst)를 skill-lifecycle-manager 절차로 등록한다.
- REQ-W2-3: 격차가 임계(기본: 허용원가 대비 +10%)를 넘으면 downside 시나리오의 opex 드라이버에 반영하고, 반영 사실을 스냅샷 `warnings`에 기록한다.

### 2.3 W3 — BEP

- REQ-W3-1: 엔진 출력에 BEP를 추가한다(§1.2 계약에 포함). `bep_volume = 연 고정비 / (단가 − 단위변동비)`, `bep_year = 누적 할인 FCF가 최초로 0 이상이 되는 연도`(미달 시 `null` — 값이 없으면 값이 없다고 표시한다).
- REQ-W3-2: `valuation_simulation`에 `bep_year`, `bep_volume`, `payback_discounted_years` 컬럼을 추가한다(마이그레이션, p50 행 기록).
- REQ-W3-3: `flow.spec.yaml` S8의 requiredArtifacts에 "BEP 시점을 포함하는 정량 평가"를 명시하고 completionCriteria를 갱신한다. fs 게이트 판정은 여전히 사람이 한다.

## 3. WACC 적용 주체 (W4)

- REQ-W4-1: `wacc.subject` assumption 키를 신설한다. 값: `promoter`(모회사) | `target`(대상기업) | `project_newco`(신설 프로젝트 법인), `kind='user'` + 근거 필수.
- REQ-W4-2: 트랙별 기본값 규칙 — greenfield 자체추진 → `promoter`, brownfield 인수 → `target`, 지분참여 → `target`. 기본값은 제안이며 세션에서 확정한다.
- REQ-W4-3: `target`/`project_newco` 선택 시 기존 성분(`beta_unlevered`, `observed_de`, `target_de`, peer 베타 — `wacc-components.ts:25-42`)으로 beta 재레버링을 수행한다. 새 연산 인프라 없이 `wacc-input-session`의 CAPM 조립 경로를 재사용한다.
- REQ-W4-4: 평가 할인율(위 규칙)과 의사결정 허들(그룹/계열사 hurdle IRR — ADR-0114)을 화면·스냅샷에서 분리 표시한다.
- REQ-W4-5: `WaccPanel`에 주체 선택·근거 입력을 추가하고, 스냅샷에 `wacc_subject`를 스탬프한다. `greenfield/brownfield-feasibility-checklist`에 subject 확인 항목을 추가한다.

## 4. 시뮬레이션 투명성 (W5)

- REQ-W5-1: 엔진이 반환한 job-spec 스냅샷을 `business_case_model.inputs_json`(마이그레이션)에 저장한다. 스냅샷이 곧 실행 계약이므로 별도 해석 계층이 없다.
- REQ-W5-2: S8 화면에 **시뮬레이션 파라미터 패널**을 만든다. 드라이버별 분포·모수·출처 칩·단위, 시드·반복 수, 할인율과 주체를 표시한다(차트 + 피벗 병기, ADR-0088). `parseNote` 파싱은 `inputs_json`이 없는 레거시 행의 fallback으로만 유지한다.
- REQ-W5-3: "어떤 드라이버가 확률 변수이고 어떤 드라이버가 상수인지"를 패널에서 즉시 구분해 보여준다.

## 5. 파라미터 조정 (W6)

- REQ-W6-1: `wacc.*` 선례를 따르는 `bc.*` assumption 어휘를 만든다: `bc.capture_rate`, `bc.ramp_up`, `bc.opex_ratio`, `bc.capex_ratio`, `bc.initial_investment_ratio`, `bc.growth_override`, `bc.sigma_override`, `bc.horizon_years`, `bc.iterations`. `kind='user'` + rationale(assumption CHECK 준수).
- REQ-W6-2: 해결 순위는 user assumption > DB 유도값(opportunity·DART) > 기본값 테이블이며, 모든 단계의 출처 라벨을 반환한다(현 `growth_source` 라벨 체계 확장).
- REQ-W6-3: S8 페이지에 파라미터 편집 폼을 둔다(WaccPanel 패턴 — 출처 라벨·근거·ADR-0082 CRUD 표준). 저장은 assumption 키로 하고 생성은 저장된 파라미터로 실행한다(게이트 가시성 보장).
- REQ-W6-4: 조정 후 재생성하면 새 job-spec·스냅샷·시드가 결정론적으로 파생되며, 이전 스냅샷 행은 보존된다(비교 가능성).

## 6. 품평회 게이트 (W9)

- REQ-W9-1: 웹 구현 완료(Phase 4) 후 PR 병합 전에 live GUI 리뷰(품평회)를 실시한다. 브라우저 라이브 조작 + 스크린샷 증적(`gui-review-screenshots/` 선례).
- REQ-W9-2: 참여 — PM 주재, design-system-agent(토큰·컴포넌트 정합), ux-designer-agent(사용성), frontend-engineer(구현 검증). 필요 시 risk-officer.
- REQ-W9-3: 평가 축 — ① 기능적 적합성(flow.spec·프로시저·체크리스트 대합) ② 사용성·편의성(생성→파라미터 조회→조정→재생성→BEP/타겟코스팅 해석 흐름의 조작 단계 수·오류 회복) ③ 가독성(단위·출처 칩·레이블, ADR-0088).
- REQ-W9-4: 도출된 개선사항은 P0/P1로 분류해 수정 배치로 반영하고 재검증한다. 선례: 2026-09-17 품평회 → `2026-09-18-s1s7-process-alignment-design.md`.

## 7. 마이그레이션·하위호환

| 마이그레이션 | 내용 |
|---|---|
| 신규 1 | `business_case_line` + `sales_volume`, `unit_price_krw` (nullable) |
| 신규 2 | `valuation_simulation` + `bep_year`, `bep_volume`, `payback_discounted_years` |
| 신규 3 | `business_case_model` + `inputs_json` |
| — | `python/requirements.txt`에 numpy 명시 확인(CPU 기본 경로). GPU는 optional extra(`requirements-gpu-<variant>.txt`: cuda / rocm / arm64-mps / xpu)로 분리하고 lazy import로 폴백 보장 |

- 레거시 행(`inputs_json` 없음): note 파싱 fallback 표시. 값 왜곡 없음.
- 레거시 시뮬레이션 결과는 재생성 전까지 그대로 유지되며, 재생성 시 스냅샷 체계로 전환된다.
- TS `runSeededSimulation`은 Phase 1에서 job-spec 빌더로 대체되고, 전환 기간 동안 엔진 결과와의 동등성 회귀 테스트(동일 job-spec → 동일 분위수, 허용오차 내)로 보호한다.

## 8. 스펙·프로시저·스킬 정합

- `process/flow.spec.yaml`: S8 outputs/requiredArtifacts/completionCriteria 갱신(BEP·판매목표·스냅샷 명시).
- `procedures/_shared/{greenfield,brownfield}-fs/schema.yaml`: `target_costing` 스텝 추가.
- 스킬: `wacc-input-session` v1.4(subject·재레버링), `investment-feasibility-modeling` v1.2(BEP·엔진 계약·job-spec), 신규 `target-costing-analysis`.
- 체크리스트: `greenfield/brownfield-feasibility-checklist.yaml`에 wacc.subject·BEP 항목.

## 9. 구현 단계

| Phase | 범위 | 비고 |
|---|---|---|
| 1 | 독립 엔진(`python/sim_engine/`, job-spec 계약, 병렬, BEP 출력) + 제너레이터 격하 + 동등성 회귀 테스트 | W5·W6·W7·W8의 기반 |
| 2 | 사업계획 요소 — 마이그레이션 3건, 판매목표·타겟코스팅·BEP 절차 반영 | W1·W2·W3 |
| 3 | WACC 주체 — `wacc.subject`, 재레버링, WaccPanel·체크리스트 확장 | W4 |
| 4 | 웹 UI(파라미터 패널·편집 폼) → **품평회** → 개선 반영 | W9 포함, 병합 전 게이트 |

## 10. 검증 기준

1. 동일 job-spec + 동일 장치 → 동일 결과(시드 결정론, REQ-W7-4). 파라미터 변경 → 결정적 시드 변경 확인. 스냅샷에 장치·빌드·정밀도가 기록됨.
2. 백엔드 등가 — 같은 job-spec을 CPU와 각 GPU 백엔드(cuda/rocm/mps/xpu, 가용한 것만)로 실행 시 분위수 상대오차가 허용치(기본 1e-3) 이내임을 확인. GPU 미탑재 환경에서는 CPU 폴백 경로만 검증하고 나머지는 타 장치 검증 기록으로 대체.
3. 3 시나리오 × 2 관점 × 10,000 반복 기준 실측: 웹 내장 TS 루프 대비 ≥10배 향상, 케이스 수에 따른 선형 확장(병렬) 확인. GPU 탑재 장치에서 대형 작업(임계 이상)이 GPU로 분기됨을 확인.
4. fs 게이트 산출물에 BEP 시점·판매목표·입력 스냅샷이 존재함을 체크리스트로 확인.
5. 품평회 3개 평가 축 전부 통과 기록이 존재함.
