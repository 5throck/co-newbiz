---
stage: S4
gate: Pre-FS
owner_agent: pm
date: 2026-08-31
track: brownfield
---

# 00. S4 진출방식 결정 — 완료 요약 (삼성전자 × 로보틱스레인보우, Brownfield, OPP-01)

## S3 → S4 연계 확인

S3 산출물 3개(00-summary.md, 01-strategic-fit-checklist-result.md, 02-synergy-analysis.md)를 정독 후 이어받았다. S3 최종 권고 **Go(조건부)**, synergy_score **6.0/10**(대안 산정 6.7/10 병기), selected 기회 **OPP-01(액추에이터·감속기 모듈 사업)**을 그대로 승계하여 S4의 진출방식 결정 대상으로 삼았다. S3 조건 2("대안 진출경로 명시 비교표 + do-minimum baseline 작성 — S4 착수 시 결합 처리 가능")를 본 S4 세션에서 이행했다.

## S4 필수 산출물 / 완료 기준 체크리스트 (`docs/process-flow.md` §S4)

| 필수 산출물·완료 기준 | 충족 | 근거 파일 |
|---|:---:|---|
| 트랙 결정(GF/BF)·근거 | **O** | [`02-route-decision-record.md`](./02-route-decision-record.md) — track=brownfield, rationale 명시 |
| 검토한 대안 | **O** | [`01-route-alternatives-comparison.md`](./01-route-alternatives-comparison.md) — Greenfield/Brownfield/JV/파트너십/R&BD/사내벤처 6개 대안, 4개 기준(기술 확보 속도·비용·리스크·시너지 실현 속도) 비교표 |
| route_decision 레코드가 존재한다 (track 필수, greenfield는 sub_track) | **O** | `02-route-decision-record.md` — track=brownfield 기록, sub_track은 스키마상 greenfield 전용이므로 NULL이 정합 |

**S4 완료 기준 종합 판정**: 필수 산출물·완료 기준 모두 충족(O).

## Gate: Pre-FS 판정기준 대비 종합 평가 (`docs/process-flow.md` Gate: Pre-FS)

| 판정 기준 | 충족 여부 | 근거 |
|---|:---:|---|
| 트랙(그린필드/브라운필드) 결정 근거가 기록되었다 | **충족** | `02-route-decision-record.md` rationale + `01-route-alternatives-comparison.md` §3 — 6개 대안 비교 후 Brownfield(완전인수) 선정 근거 명시 |
| 사업성 분석 입력이 존재한다 | **부분 충족 / S5 이관 필요** | `03-deal-shape-initial.md`가 딜 구조 초기 가정(지분율 100%, 주식양수)을 제공하나, WACC/hurdle IRR(brownfield-pre-fs step 1)이 아직 `assumed` 상태로 미확정 — S5·S6에서 valuation-agent의 wacc-input-session이 필요하다. |

| Kill 기준 | 해당 여부 | 근거 |
|---|:---:|---|
| 진출방식이 결정되지 않았다 | **미해당** | route_decision 레코드에 track=brownfield로 명확히 결정·기록됨 — Kill 미해당 |

**Pre-FS 게이트 판정 결과 (제안)**: **통과 가능 (Kill 없음)** — 단, "사업성 분석 입력" 판정기준의 WACC 확정 등 일부 하위 요건은 S5 진입 시점까지 완료가 필요하며, 이는 Pre-FS 게이트 자체의 Kill 조건이 아니라 브라운필드 Pre-FS 절차(schema.yaml step 1)의 후속 선행조건이다.

## 최종 route 결정 (요약)

- **트랙**: **Brownfield (M&A, 완전인수 100%[가정])**
- **핵심 근거**: (1) 기술 확보 속도·시너지 실현 속도 2개 기준에서 Brownfield가 유일하게 우위(상방 정밀감속기 공급자 과점 구조 하 자체개발 불리), (2) S2·S3에서 이미 확인된 "가장 낮은 실행 리스크", (3) JV·파트너십은 통제권 부재로 계열사 연계 시너지 실현이 느림, (4) R&BD·사내벤처는 실행 노하우·양산 트랙레코드를 배제해 S2 selected 근거를 상실.
- 딜 구조 초안: 주식양수, 100% 완전인수, vehicle(direct/SPC/holdco) 미확정[가정].

## 미해결 한계 (후속 세션 필요 항목)

- **decided_by(승인권자) 미확정**: route_decision의 인간 승인권자가 아직 지정되지 않음 — S3 조건 1(sf-05 기명 임원 스폰서)과 연계 해소 필요.
- **WACC/hurdle IRR 미확정**: brownfield-pre-fs step 1 미수행 — kill_criteria `wacc_hurdle_still_assumed`에 해당하므로 S5 착수 전 valuation-agent 디스패치 필요.
- **인증 이전가능성 미확인**: brownfield-pre-fs step 3, 3.5(certification-agent) 미수행 — 추론 금지 원칙상 후속 필수.
- **6-way M&A 교차검증 미착수**: antitrust, customer-retention, incentive, hr-integration, certification, region-lead — S6(DD) 단계에서 brownfield-agent가 조율.
- **synergy_score 임계값(threshold) 미활성**: S3에서 이미 명시된 갭(ADR-0051 open question b)이 본 S4의 Screening 게이트 재확인에도 그대로 남아있다.
- 데이터 신뢰도 Medium 캡(design 비협상 경계 #4)이 본 route_decision의 근거 데이터에도 동일 적용 — 상한 유지.
- 본 게이트 최종 판정(Pass/Kill)은 인간 검토자의 몫이며, 본 세션은 분석·제안만 제공한다(Non-Negotiable Boundary #2).

## 절차 적합성 점검

- route-strategy(agent: pm) — 본 세션에서 수행: `01-route-alternatives-comparison.md`, `02-route-decision-record.md`.
- deal-shape-evaluation(agent: brownfield-agent) — 본 세션에서 초기 가설 수준으로 수행: `03-deal-shape-initial.md`. 정밀 구조 확정은 brownfield-pre-fs step 2 전체 완료(S6 DD) 몫으로 남김.
- `procedures/_shared/brownfield-pre-fs/schema.yaml` step 1(wacc-input-session), step 3/3.5(certification-agent), step 4(gate_pass_record, process-governance-manager)는 본 세션 범위 밖이며 미수행.

## 파일 목록

- `01-route-alternatives-comparison.md`
- `02-route-decision-record.md`
- `03-deal-shape-initial.md`
- `00-summary.md` (본 문서)
