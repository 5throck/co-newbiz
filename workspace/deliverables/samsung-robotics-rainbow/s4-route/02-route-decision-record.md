---
stage: S4
gate: Pre-FS
owner_agent: pm
date: 2026-08-31
track: brownfield
---

# 02. route_decision 레코드 (진출방식 결정)

`db/migrations/0043_route_decision.sql`의 스키마에 따른 route_decision 레코드 초안. project_id는 opportunity가 아직 deal로 promote되지 않았으므로 NULL[가정] — 인간 승인 후 deal 생성 시점에 채워진다.

## route_decision 레코드

| 필드 | 값 |
|---|---|
| `id` | `route-decision-samsung-robotics-rainbow-opp01` [가정 — 실제 ID는 DB insert 시 생성] |
| `opportunity_id` | OPP-01 (액추에이터·감속기 모듈 사업 확장) — `deliverables/.../s2-opportunity/01-opportunity-registry.md` |
| `project_id` | NULL (opportunity가 아직 deal로 promote되지 않음, ADR-0074) |
| `track` | **`brownfield`** |
| `sub_track` | NULL (sub_track은 greenfield 트랙에만 적용 — track=brownfield이므로 해당 없음) |
| `rationale` | "01-route-alternatives-comparison.md §3 참조: 기술 확보 속도·비용·시너지 실현 속도 3개 기준에서 Brownfield(완전인수)가 유일하게 우위이며, 리스크 기준에서도 S2·S3이 이미 확인한 '가장 낮은 실행 리스크'가 유지됨. 정밀감속기 등 상방 공급자 과점 구조(S1 §4, 축③ 교섭력 High) 하에서 Greenfield 자체개발은 시간·리스크 모두 불리. JV·파트너십은 통제권 부재로 계열사 연계형 시너지(원가절감·캡티브 물량, S3 시너지 후보 A·C) 실현이 구조적으로 느림. R&BD(IP만 확보)·사내벤처는 로보틱스레인보우의 실행 노하우·양산 트랙레코드를 배제해 S2 selected 근거(낮은 실행 리스크)를 상실." |
| `alternatives_considered` | "Greenfield(자체개발), JV(합작법인, 예 60:40[가정]), 파트너십/제휴(지분無), R&BD(IP 라이선스/인수), 사내벤처 — 5개 대안 전부 `01-route-alternatives-comparison.md` §2 비교표에서 검토됨" |
| `decision_factors_json` | 아래 JSON 참조 |
| `decided_by` | **인간 검토자 확정 대기 [가정 — 승인권자: 삼성전자 신사업 투자심의 담당 임원, 직책명 미정]** — 본 세션(AI)은 *제안* 트랙만 기록하며 최종 결정자는 인간이다(Non-Negotiable Boundary #2). |
| `decided_at` | 2026-08-31 (본 세션 제안 시점 — 인간 승인 시점으로 갱신 필요) |

### decision_factors_json (초안)

```json
{
  "criteria": ["tech_acquisition_speed", "cost", "risk", "synergy_realization_speed"],
  "alternatives_scored": {
    "greenfield": {"tech_acquisition_speed": "low", "cost": "high_cumulative", "risk": "high", "synergy_realization_speed": "low"},
    "brownfield_full_acquisition": {"tech_acquisition_speed": "high", "cost": "high_upfront_low_cumulative", "risk": "medium_manageable_via_dd", "synergy_realization_speed": "high"},
    "jv": {"tech_acquisition_speed": "medium", "cost": "medium", "risk": "medium_governance", "synergy_realization_speed": "medium"},
    "partnership_no_equity": {"tech_acquisition_speed": "medium_low", "cost": "low", "risk": "medium_contract_dependency", "synergy_realization_speed": "low"},
    "rbd_ip_only": {"tech_acquisition_speed": "medium", "cost": "medium", "risk": "medium_ip_title", "synergy_realization_speed": "low"},
    "intra_venture": {"tech_acquisition_speed": "very_low", "cost": "low_upfront_sunk_cost_risk", "risk": "medium_org_political", "synergy_realization_speed": "low"}
  },
  "selected": "brownfield_full_acquisition",
  "data_confidence_cap": "Medium",
  "confidence_cap_note": "S1-S3에서 승계된 Medium 캡(design 비협상 경계 #4)이 본 route_decision의 근거 데이터에도 동일하게 적용됨 — 어떤 재무 성과도 이 캡을 넘는 등급 상향을 정당화하지 않음",
  "prior_stage_inputs": {
    "s2_selected_opportunity": "OPP-01",
    "s3_go_recommendation": "Go (조건부)",
    "s3_synergy_score": 6.0
  }
}
```

## S4 필수 산출물 대비 확인

| S4 필수 산출물 | 충족 | 근거 |
|---|:---:|---|
| 트랙 결정(GF/BF)·근거 | **O** | 본 표 `track`=brownfield, `rationale` |
| 검토한 대안 | **O** | `alternatives_considered` + `01-route-alternatives-comparison.md` §1-2 |

## S4 완료 기준 대비 확인 (`docs/process-flow.md` §S4)

- **"route_decision 레코드가 존재한다 (track 필수, greenfield는 sub_track)"**: **충족** — track=brownfield 기록됨. sub_track은 스키마상 greenfield 전용 필드이므로 본 브라운필드 레코드에는 NULL이 올바른 값이다(`db/migrations/0043_route_decision.sql` CHECK 제약: sub_track은 'existing_business_rbd'/'intra_venture' 두 값뿐이며 이는 greenfield 트랙 개념이다).

## 미해결 사항 / 인간 승인 필요

- **decided_by 미확정**: 실제 승인권자(임원 직책)가 아직 지정되지 않았다[가정] — S3 조건 1(sf-05 기명 임원 스폰서 지정)과 연계해 해소 필요.
- 본 레코드는 아직 DB에 실제 insert되지 않은 **문서 형태의 초안**이다. 인간 승인 후 process-governance-manager 또는 시스템 담당자가 정식 DB insert를 수행해야 한다.
- 이 결정은 인간 게이트 심의자의 최종 승인 없이는 구속력이 없다(Non-Negotiable Boundary #2 — 게이트 승인과 투자 결정은 인간의 몫).
