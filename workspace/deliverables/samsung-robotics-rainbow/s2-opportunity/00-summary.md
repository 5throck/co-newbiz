---
stage: S2
gate: Screening
owner_agent: pm
date: 2026-08-31
track: brownfield
---

# 00. S2 기회발굴 — 완료 요약 (삼성전자 × 로보틱스레인보우, Brownfield)

## S1 → S2 연계 확인

S1 산출물 4개(00-summary.md, 01-market-sizing.md, 02-competitive-intelligence.md, 03-value-chain-analysis.md)를 정독 후 이어받았다. 이관된 결론:

- 시장 매력도: 고성장, 구조적 매력 있음(Kill 미해당), 경쟁강도 매우 높음
- 가치사슬 4단계: ① 부품/소재 → ② 모듈/서브시스템 → ③ 완제품/통합 → ④ 응용/서비스
- 데이터 신뢰도: 종합 Medium(top-down), 프록시체인 별도 Grade C — 이 캡이 S2 모든 기회 평가의 상한으로 그대로 적용됨

## S2 필수 산출물 / 완료 기준 체크리스트 (`docs/process-flow.md` §S2)

| 필수 산출물·완료 기준 | 충족 | 근거 파일 |
|---|:---:|---|
| 기회 등록(가치사슬 노드·매력도) | **O** | [`01-opportunity-registry.md`](./01-opportunity-registry.md) — 3개 기회(OPP-01/02/03) 등록, 각 가치사슬 노드·매력도 점수·근거 기재 |
| 최소 1개 기회가 selected 상태 | **O** | OPP-01(액추에이터·감속기 모듈 사업 확장)이 **selected**로 확정 |
| business-model-sketch (활동 정의상 필수) | **O** | [`02-business-model-sketch.md`](./02-business-model-sketch.md) — OPP-01에 대한 수익모델·고객·경쟁우위 스케치 |

**S2 완료 기준 종합 판정**: 필수 산출물·완료 기준 모두 충족(O). 다만 아래 "미해결 한계·절차 갭"은 Screening 게이트 심의 시 병기되어야 함.

## 절차 적합성 점검

- `docs/process-flow.md` §S2는 opportunity-discovery(agent: market-intelligence-agent, skill: insight-synthesis)와 business-model-sketch(agent: greenfield-agent, skill: scenario-planning)를 명시하며, 두 활동 모두 procedure로 `greenfield-screening`, `brownfield-screening`을 지정한다.
- **절차 파일 갭(기록)**: `procedures/_shared/brownfield-screening/schema.yaml` v1.2.0을 확인한 결과, 이 스키마는 step 1(target_longlist) ~ step 4(gate_pass_record)로 구성되며 **opportunity-discovery/business-model-sketch에 대응하는 step이 없다** — 스키마는 "타깃 스크리닝"(대상기업 롱리스트, 전략적합성, HHI 예비심사, forward-industry-research) 관점이며 "가치사슬 기회 등록·매력도 평가·사업모델 스케치"를 다루지 않는다. `docs/process-flow.md`(S2 activity 정의의 유일한 출처)와 `brownfield-screening/schema.yaml`(구조화된 step 목록) 사이에 정합성 갭이 존재함을 **명시적으로 기록**하며, process-governance-manager의 확인이 필요하다.
- **스킬 배정 불일치(기록)**: `skills/scenario-planning/SKILL.md`는 `procedure_keys: [greenfield-fs, brownfield-fs]`(FS 단계 귀속)이며 `prerequisites: investment-feasibility-modeling`을 명시 — S2(Screening) 단계에서 요구하는 정량 시나리오 모델링 전제조건이 이 단계에서 충족되지 않는다. `02-business-model-sketch.md`는 이를 인지하고 정성적 스케치로 범위를 좁혔으며, 정량 시나리오 작업은 Pre-FS로 명시적으로 이관했다.
- Step 1(target_longlist), Step 2(strategic-fit-screening), Step 3(antitrust HHI), Step 3.5(forward-industry-research 정식 등록)는 본 S2 세션 범위 밖이며 여전히 미수행(S1 요약에서 이미 명시된 것과 동일한 상태) — 별도 에이전트(brownfield-agent, process-governance-manager, antitrust-agent, market-intelligence-agent) 디스패치 필요.

## 미해결 한계

- 데이터 신뢰도 Medium 캡이 모든 기회의 RAG 상한을 지배(design 비협상 경계 #4) — OPP-01 selected 확정에도 불구하고 Screening 게이트 최종 판정(Go/Kill/Hold/Recycle)은 인간 검토자의 몫이며 본 세션은 분석·제안 등급만 제공한다.
- OPP-03(국내 협동로봇 공급)은 데이터 신뢰도가 Low~Medium으로 3개 기회 중 가장 낮음 — KOSIS 원자료 확보 전까지 candidate로만 유지.
- `industry_driver` 레지스트리 정식 등록(S1에서 미완료로 이월)이 본 S2에서도 반영되지 못함 — 후속 세션 필요.

## 파일 목록

- `01-opportunity-registry.md`
- `02-business-model-sketch.md`
- `00-summary.md` (본 문서)
