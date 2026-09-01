---
stage: S3
gate: Screening
owner_agent: pm
date: 2026-08-31
track: brownfield
---

# 00. S3 시너지·전략적 적합성 — 완료 요약 (삼성전자 × 로보틱스레인보우, Brownfield, OPP-01)

## S2 → S3 연계 확인

S2 산출물 3개(00-summary.md, 01-opportunity-registry.md, 02-business-model-sketch.md)를 정독 후 이어받았다. selected 기회 **OPP-01(액추에이터·감속기 모듈 사업 확장, 가치사슬 ② 모듈/서브시스템)**을 본 S3 평가 대상으로 확정 — S2에서 이미 "가장 낮은 실행 리스크 + 가장 높은 데이터 신뢰도 + 명시적 계열 시너지"로 selected된 근거를 S3에서 정식 검증한다. 데이터 신뢰도 Medium 캡(design 비협상 경계 #4)은 S1→S2에 이어 S3에도 그대로 승계된다.

## S3 필수 산출물 / 완료 기준 체크리스트 (`docs/process-flow.md` §S3)

| 필수 산출물·완료 기준 | 충족 | 근거 파일 |
|---|:---:|---|
| 시너지 평가 | **O** | [`02-synergy-analysis.md`](./02-synergy-analysis.md) — 시너지 후보 4건(A~D) 정성/정량 평가, synergy_score 산정 |
| 전략적 적합성 판단 | **O** | [`01-strategic-fit-checklist-result.md`](./01-strategic-fit-checklist-result.md) — knock-out(sf-01~05) 전원 PASS, 스코어카드(sf-06~12) 산정 |
| 기회에 synergy_score와 근거가 기록되었다 | **O** | `02-synergy-analysis.md` §2 — 잠정 synergy_score **6.0/10**(대안 산정 6.7/10 병기), 시너지 후보별 근거·assumption kind 명시 |
| 적합성 판단(Go/Hold/Kill 권고)이 존재한다 | **O** | 본 문서 §최종 권고 및 `01-strategic-fit-checklist-result.md` §3 |

**S3 완료 기준 종합 판정**: 필수 산출물·완료 기준 모두 충족(O). 다만 아래 "미해결 한계"는 Screening 게이트 심의 시 병기되어야 한다.

## Screening 게이트 판정기준 대비 종합 평가 (`docs/process-flow.md` Gate: Screening)

| 판정 기준 | 충족 여부 | 근거 |
|---|:---:|---|
| 시장 매력도가 수용 기준 이상이다 | **충족** | S1: 2030 Base ~USD 40–50B, CAGR 35–45%, 구조적 매력 있음(Kill 미해당) — S3에서 재확인, 변경 없음 |
| 전략적 적합성 knock-out 항목을 모두 통과했다 | **충족** | `01-strategic-fit-checklist-result.md` — sf-01~sf-05 전원 PASS(단 sf-03·sf-05는 조건부/가정 기반, DD 이전 확인 필요 후속조건 부기) |
| 시너지 점수가 합의 기준을 충족한다 | **부분 충족 / 판단 필요** | synergy_score 6.0~6.7/10 산정 — 그러나 "합의 기준"(threshold) 자체가 스키마·체크리스트 어디에도 활성화된 수치로 존재하지 않음(ADR-0051 open question (b) 미해결). **PM/process-governance-manager가 정식 임계값을 아직 활성화하지 않은 상태이므로, 이 판정기준의 "충족" 여부는 절차적으로 확정할 수 없다** — 이 갭을 아래 미해결 한계에 명시한다. |

| Kill 기준 | 해당 여부 | 근거 |
|---|:---:|---|
| 시장이 구조적으로 매력이 없다(축소+상품화) | **미해당** | S1 재확인 |
| 데이터 신뢰도가 판단 불가 수준이다 | **미해당** | Medium(top-down) — "판단 불가"보다 높은 등급, Kill 미해당. 다만 이 Medium이 최종 RAG 등급 전체의 상한으로 계속 작용함(design 비협상 경계 #4) |
| 전략적 적합성 knock-out 실패 | **미해당** | 5/5 PASS |

## 최종 권고: **Go (조건부)**

- **Knock-out**: 5/5 통과 — 실패 없음
- **synergy_score**: 6.0/10 (OPP-01 단독 재산정 시 6.7/10) — 정합 기준선(threshold) 미활성 상태이므로 절대 기준으로 판정하지 않고, 4개 시너지 후보 중 3개가 정성적 `assumed` 가정에 기반한다는 점을 감안한 **정성 판단**으로 Go를 권고한다.
- **권고 근거**: (1) knock-out 전원 통과, (2) 시너지 후보 중 최소 2건(A. 삼성전기 연계, D. 수직계열화 옵션가치)이 상대적으로 근거가 견고, (3) Kill 기준 3건 모두 미해당, (4) S2에서 이미 OPP-01이 3개 기회 중 최선으로 selected된 사전 결론과 정합.
- **조건(선행조건, Pre-FS 진입 전 이행 권고)**:
  1. sf-05 기명 임원 스폰서 실제 지정 및 seed budget 통제권 확인
  2. sf-12 대안 진출경로(완전인수 vs 지분투자/파트너십 vs 자체개발) 명시 비교표 + do-minimum baseline 작성 — S4(진출방식 결정) 착수 시 결합 처리 가능
  3. 시너지 후보 A(원가절감률)·C(캡티브 물량) 두 항목의 핵심 수치를 실사(BOM, CAPA, 내부 CAPEX 계획)로 검증 — 현재 `assumed`로 유지된 두 load-bearing 후보
  4. synergy_score 공식 임계값(threshold) 활성화를 process-governance-manager에게 요청 — ADR-0051 open question (b) 해소 전까지 이 게이트의 "시너지 점수 합의 기준 충족" 판정 기준 자체가 절차적으로 미확정 상태임을 게이트 심의 문서에 명기

## 미해결 한계 (Kill 기준 재확인용, 및 후속 세션 필요 항목)

- **synergy_score 임계값 미활성**: Screening 게이트 판정기준 "시너지 점수가 합의 기준을 충족한다"의 공식 기준선이 아직 정책으로 활성화되지 않았다(ADR-0051 open question (b)). 본 세션의 Go 권고는 임계값이 아니라 정성 판단에 근거하며, 인간 게이트 심의자는 이 점을 반드시 인지해야 한다.
- **antitrust(HHI 예비심사, step 3), forward-industry-research 정식 등록(step 3.5)**: S1·S2에서 이미 명시된 것과 동일하게 여전히 본 세션(S3) 범위 밖 — antitrust-agent, market-intelligence-agent 별도 디스패치 필요. 로보틱스레인보우는 `has_external_market_presence=true`[가정]으로 판단되어 HHI 스텝은 여전히 적용 대상이나 미수행 상태.
- **sf-03/sf-05/sf-09/sf-12** 4개 체크리스트 항목에 정보 갭 존재 — `01-strategic-fit-checklist-result.md` §4 참조.
- **시너지 후보 3/4건이 `assumed`**: 단일 출처 미삼각측량 추정치 — `02-synergy-analysis.md` §4 참조. Pre-FS 진입 전 risk-officer 재검토 권고.
- 데이터 신뢰도 Medium 캡(design 비협상 경계 #4)이 여전히 전체 RAG 등급의 상한으로 작용 — 본 게이트 통과 여부와 무관하게 이후 어떤 재무 성과도 이 캡을 넘는 등급 상향을 정당화할 수 없다.
- 본 게이트 최종 판정(Go/Hold/Kill/Recycle)은 인간 검토자의 몫이며, 본 세션은 분석·제안 등급만 제공한다(Non-Negotiable Boundary #2).

## 절차 적합성 점검 (`procedures/_shared/brownfield-screening/schema.yaml` step 2)

- step 2(strategic-fit-screening, agent: process-governance-manager, skill: strategic-fit-screening)는 본 세션에서 정식 수행됨 — `01-strategic-fit-checklist-result.md`가 해당 산출물(`strategic_fit_screening_result`).
- `docs/process-flow.md` §S3의 synergy-analysis activity(agent: risk-officer, skill: assumption-audit)도 정식 수행됨 — `02-synergy-analysis.md`.
- step 1(target_longlist), step 3(antitrust HHI), step 3.5(forward-industry-research 정식 등록), step 4(gate_pass_record, stage-gate-governance)는 본 세션 범위 밖이며 여전히 미수행 — brownfield-agent, antitrust-agent, market-intelligence-agent, process-governance-manager(step 4 게이트 확정)의 별도 디스패치가 필요하다. **본 세션은 step 4(공식 gate_pass_record 발급)를 대신하지 않았다** — 이는 인간 검토자 승인 이후 process-governance-manager가 정식 처리할 사항이다.

## 파일 목록

- `01-strategic-fit-checklist-result.md`
- `02-synergy-analysis.md`
- `00-summary.md` (본 문서)
