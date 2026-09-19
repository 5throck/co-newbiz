---
lang: ko
lang_reason: source-material
---

# Sim Engine Runtime Separation — GPU/CPU Device Layer as a Shared Service

- Spec ID: `2026-09-19-sim-engine-runtime-separation`
- Date: 2026-09-19
- Status: **Proposed** — 초안. 구현은 본 문서 검토·승인 후 별도 승인으로 착수한다.
- Origin: 성장율 격차 보정 루프(2026-09-18-s1-growth-gap-calibration)의 반복
  작업 효율화 논의에서 사용자가 제안 — 몬테카를로 시뮬레이션의 GPU 분산처리
  엔진을 분리해 산업 분석에 활용하는 방안.

## 배경과 병목의 정확한 위치

보정 루프의 1사이클은 (수용 → 재실행 → 격차 비교)이고, 재실행의 비용은
**LLM 호출 체인**(리서치 → 8단계 추론)에 있다. GPU는 이 체인을 가속하지
못한다. GPU가 직접 기여하는 영역은 수치 연산이고, 산업 분석에는 두 가지가
있다:

1. **드라이버 impact 조합의 확률론적 탐색** — 수용된 드라이버의 impact_pct는
   점 추정이 아니라 ±범위다. 조합 공간(드라이버 k개 × 범위 샘플 N)을 몬테카를로
   표집해 "외부 참조치에 수렴하는 조합 분포"와 각 드라이버의 기여도 분위수를
   제시하면, 다음 사이클의 제약 주입이 점이 아니라 분포가 된다. 수백만 조합 —
   `sim_engine/device.py`의 GPU 경로 적합.
2. **보정 후 CAGR 밴드의 불확실성 구간** — 캘리브레이션된 cagrBase에 밴드
   시뮬레이션을 돌려 2030 전망의 P10/P50/P90을 산출(기존 밴드 산식의 확장).

## 분리 설계

### 경계

- `python/sim_engine/`을 독립 패키지(작업 런타임)로 승격: `device.py`
  (디바이스 추상화 — CUDA/MPS/XPU/ROCm 자동감지, CPU numpy 폴백,
  GPU_WORK_THRESHOLD 200k), 실행 큐, 결과 직렬화.
- 웹앱(app/web-next)은 런타임을 **서브프로세스로 호출**(기존
  `structure-simulation.ts` → `structure_sim.py` 패턴 준용). 앱 번들에
  torch를 넣지 않는다 — CPU 폴백으로 항상 동작, GPU는 선택 설치.

### 산업 분석 연결점 (신규)

- `POST /api/market-overview/industry/[industryId]/calibration-sweep`:
  수용된 드라이버 세트의 impact 범위를 표본으로 조합 시뮬레이션을 실행하고,
  참조 CAGR에 수렴하는 조합의 분포(드라이버별 기여 분위수·수렴 신뢰구간)를
  반환한다. 결과는 `industry_driver_calibration` 행에 보조 근거로 첨부.
- 보정 사이클 오케스트레이터(별도 항목)가 sweep 결과를 다음 재분석 제약의
  입력으로 사용한다.

### 보정 사이클 오케스트레이션 (이 배치의 수동 절차 자동화)

수용 → 재실행 → 격차 비교를 하나의 명령으로: 제안 수용(사람 확인) → 대상
산업 일괄 재분석 → 버전 간 격차 비교표 갱신. 무한 자동반복은 하지 않는다 —
사이클마다 격차와 제안을 보고하고 사람이 계속 여부를 결정한다(경계 #2).

### 단계별 도입

1. sim_engine 패키지화(기존 device.py·큐 이동, 인터페이스 유지)
2. calibration-sweep API + 산업 리포트 패널 연결
3. (검토 후) 오케스트레이터 — 수용→재분석 일괄 실행

## 명시적 한계

- 루프 병목은 LLM 호출 체인 — 본 분리는 반복 "가속"이 아니라 수치 탐색·
  불확실성 정량화의 "품질·표현력" 향상이다. 반복 실행 시간 단축이 목적이면
  프로세스 수준 병렬화(산업별 동시 재분석)를 먼저 검토한다.
- GPU가 없는 배포에서는 CPU numpy로 열화 없이 동작한다(device.py 계약).
