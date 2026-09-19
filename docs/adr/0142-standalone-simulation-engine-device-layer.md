---
lang: ko
lang_reason: source-material
---

# ADR-0142: 독립 몬테카를로 시뮬레이션 엔진 — 장치 계층과 입력 유도 시드

- Status: Accepted
- Date: 2026-09-18
- Deciders: New Business Review Lead (PM), 사용자 방향 승인(2026-09-18 3차 요구 반영)
- Design of record: [`docs/designs/2026-09-18-s8-business-case-evaluation-design.md`](../designs/2026-09-18-s8-business-case-evaluation-design.md) (§1 엔진 계약·장치 계층·병렬 처리, §4 투명성, §5 파라미터 조정)
- Related: ADR-0052 §D.4 (시드 결정론 — 계약 유지, 메커니즘 본 ADR으로 갱신), ADR-0096 (activity 체인 오케스트레이션), ADR-0098 (S8 멀티 비즈니스 케이스 생성), ADR-0115 (WACC 성분 분해), ADR-0117 (듀얼 퍼스펙티브 — 시드 공유 조항 변경), ADR-0026 (우발부채 삼각분포)

## Context

S8 시뮬레이션은 웹 프로세스 안의 TS 루프(`business-case-generator.ts`의 `runSeededSimulation`)로 돌았다. 세 가지 구조적 한계: (1) 반복 수·분포 다변화가 웹 요청 시간으로 직결되고, (2) 웹 밖(배치·분석 스크립트)에서 재사용할 수 없으며, (3) 파라미터 출처가 `valuation_simulation.note`의 `key=value;` 문자열로만 존재해 "어떤 인자로 어떻게 돌았는지"를 구조적으로 증명할 수 없었다. 복잡도·반복 수가 커지면 GPU가 필요하고, 케이스 그리드(시나리오 × 관점 × 파라미터 세트)는 병렬이 자연스럽다.

## Decision

1. **연산은 웹 밖 독립 엔진으로 옮긴다** — `python/sim_engine/` (numpy CPU 경로 기본). 언어 후보(TS/Java/C/Rust)를 평가해 Python을 채택했다: 기존 `python/monte_carlo.py` 자산과 `python/` 스택 선례, numpy 벡터화가 C급 성능을 제공, scipy 확장 여지. TS 제너레이터는 job-spec 빌더 + 엔진 스포너로 격하되고, 엔진 실패 시 기존 TS 시뮬레이터가 폴백으로 남는다(전환기 이중 경로, 노트에 `engine=` 스탬프로 구분).
2. **장치 계층** — PyTorch 단일 추상화로 네 벤더를 커버한다(CUDA=NVIDIA, ROCm 빌드=AMD/HIP, MPS=Apple Silicon, XPU=Intel oneAPI). 자동 감지 순서 `cuda > mps > xpu > rocm > cpu`. torch는 optional extra(lazy import)이고 CPU 경로는 numpy 단독 — GPU가 없으면 폴백이 경고로 기록된다. 작은 작업(반복×케이스 < 임계)은 전송 오버헤드 때문에 GPU가 있어도 CPU로 간다.
3. **시드는 입력의 순수 함수로 재정의한다** — `seed = fnv1a32(case_id + ":" + sha256(canonical_drivers))`. ADR-0052 §D.4의 계약("동일 입력 → 동일 결과")은 유지되지만 메커니즘이 구체화된다: 파라미터를 바꾸면 시드가 결정적으로 바뀌므로 조정 전후 결과가 독립·재현 가능 표본이 된다. RNG 스트림이 장치마다 다르므로 재현 계약은 "동일 job-spec + 동일 장치"로 정밀화되며, 스냅샷이 장치·빌드·정밀도를 기록한다.
4. **ADR-0117의 시드 공유 조항 변경** — 0117은 "두 variant가 시드를 공유해 차이는 성장/변동 파라미터만에서 온다"고 정의했으나, 입력 유도 시드에서는 variant별 드라이버 집합이 다르면 시드도 다르다. variant 간 비교는 시드 공유가 아니라 **동일 조건 재실행의 결정론**으로 보장하며, 이 ADR이 0117의 해당 조항을 변경한다. 기존 저장 행은 재생성 전까지 구 계약대로 유지된다.
5. **입력 스냅샷 = 실행 계약** — 엔진은 받은 job-spec을 결과에 그대로 반환하고 `business_case_model.inputs_json`에 저장된다. 노트 문자열 파싱은 레거시 행의 fallback으로만 남는다.

## Consequences

- 엔진 런타임 의존성: python3 + numpy(필수), torch(선택 — 벤더별 빌드 변형 문서화). 미구성 환경에서는 TS 폴백이 동작해 기능이 끊기지 않는다.
- `valuation_simulation`은 BEP 시점·물량·할인 페이백 컬럼을 얻고(마이그레이션 0112), 모델은 `inputs_json`을 얻는다(0113).
- CI 재현성: `runSeededSimulation`(TS)과 엔진은 RNG가 달라 분위수가 비트 단위 일치하지 않는다 — 등가성은 닫힌형 NPV·결정론 재실행·통계 허용오차 테스트로 검증한다.
