---
stage: S4
gate: Pre-FS
owner_agent: brownfield-agent
date: 2026-08-31
track: brownfield
---

# 03. 딜 구조 초안 (deal-shape-evaluation)

`docs/process-flow.md` §S4 activity "deal-shape-evaluation"(agent: brownfield-agent, skill: deal-execution-playbook, procedure: brownfield-pre-fs)에 대응하는 초기 평가. `procedures/_shared/brownfield-pre-fs/schema.yaml` step 2(agent: brownfield-agent, skill: brownfield-feasibility, output: `deal_structure_hypothesis`)의 착수 단계 산출물이며, 본 세션은 이를 초기 가설 수준으로만 기록한다 — 정밀 구조 확정은 S6(DD) 단계 브라운필드 6-way 교차검증 이후다.

## 1. 인수방식 가정

| 항목 | 값 | 근거/가정 |
|---|---|---|
| 인수방식 | **주식양수 (Stock Acquisition)** [가정] | 로보틱스레인보우가 별도 법인으로 존재한다고 전제(S1-S3 전제 승계). 자산양수(asset deal)는 사업부 carve-out 케이스에 주로 쓰이며, 본 케이스는 회사 전체 인수이므로 주식양수가 기본 가정이다. |
| 지분율 | **100% (완전인수)** [가정] | 사용자 시나리오 명시 전제. 실제 협상 결과에 따라 조정 가능하나, S4 초기 평가는 완전인수를 기준선으로 삼는다. |
| 인수 주체(vehicle) | 삼성전자 직접 인수 또는 특수목적법인(SPC) [가정 — 미확정] | `procedures/_shared/brownfield-pre-fs/schema.yaml` step 2는 "acquisition vehicle — direct / SPC / holdco"를 구조가설의 필수 요소로 명시(pilot-009 사례 참조). 본 세션에서는 확정하지 않으며 S6 DD 단계에서 세무·법무 검토 후 결정 필요. |
| 대가 지급수단 | 현금 인수 [가정] | 삼성전자의 재무 여력을 감안한 기본 가정. Primary(신주 발행을 통한 자금조달) 요소 결합 여부는 로보틱스레인보우의 자금 수요에 따라 S5-S6에서 재검토. |

## 2. 구조 가설 메모 (초기, 미확정)

- **Primary vs Secondary 혼합 여부**: 본 세션에서는 100% Secondary(기존 주주 지분 전량 인수)로 단순 가정한다. 로보틱스레인보우에 별도 자금조달 니즈(설비투자 등)가 있다면 Primary(신주) 요소 결합이 pilot-002(한화임팩트-HSD엔진 사례)처럼 필요할 수 있음 — DD 단계 확인 필요.
- **Carve-out 해당 여부**: 로보틱스레인보우가 독립 법인 전체 인수 대상이라는 전제 하에 carve-out 메커니즘(사업부만 분리 인수)은 **해당 없음**[가정]. 만약 실제로는 로보틱스레인보우가 특정 대기업의 사업부라면 이 가정은 무효이며 carve-out 평가가 별도로 필요하다.
- **R&BD 대비**: 본 케이스는 회사 전체(조직·인력·양산능력 포함) 인수이므로 `checklists/rbd-technology-checklist.yaml`의 build/license/spin-off/minority-invest 4갈래 중 어디에도 해당하지 않는 **표준 브라운필드 완전인수**다 — R&BD 기술 트랙이 아니다.

## 3. 딜 구조 관련 선행 확인 필요 항목 (S6 DD 이전)

`procedures/_shared/brownfield-pre-fs/schema.yaml` steps 1, 3, 3.5에 따라 아래는 본 세션 범위 밖이며 후속 디스패치가 필요하다:

1. **WACC/hurdle IRR 확정** (step 1, agent: valuation-agent, skill: wacc-input-session) — 현재 미수행. `assumption.kind='assumed'`에서 `'user'`로 전환되지 않으면 Pre-FS kill_criteria `wacc_hurdle_still_assumed`에 해당해 Pre-FS 게이트를 통과할 수 없다.
2. **인증 이전가능성(certification transferability) 확인** (step 3, agent: certification-agent) — change of control 시 로보틱스레인보우 보유 인증(해당 시)의 이전 가능 여부. 추론 금지(Non-Negotiable Boundary #5) — 인증기관에 직접 확인 필요. 본 세션은 미수행.
3. **인증 로드맵/갭 맵** (step 3.5, agent: certification-agent) — 미수행.
4. **6-way M&A 교차검증** (`agents/brownfield-agent.md`) — antitrust, customer-retention, incentive, hr-integration, certification, region-lead 6개 검증자 필수 실행. 본 세션(S4)은 딜 구조 초안만 다루며 6-way 검증은 S6(DD) 단계 몫이다 — 아직 미착수.

## 4. Deal-shape-presigning-checklist 적용 여부

`checklists/deal-shape-presigning-checklist.yaml`은 license-in/co-development/minority/JV 4개 딜형태에 대한 체크리스트만 정의하며, "Full M&A(완전인수)는 이 체크리스트에 항목 세트가 없다 — 그 결과는 brownfield 체인으로 그대로 라우팅되어 그 체인 고유의 게이트가 관할한다"(`procedures/_shared/deal-shape-chain/schema.yaml` step 4 설명, 해당 checklist 헤더 명시)는 설계를 그대로 따른다. 즉 본 완전인수 케이스는 파트너십 프리사이닝 체크리스트 대상이 아니며, 대신 `procedures/_shared/brownfield-pre-fs/schema.yaml`의 표준 브라운필드 Pre-FS 절차(step 1-4)가 적용된다.

## 5. 한계

- 지분율(100%)과 인수방식(주식양수)은 모두 [가정]이며 실제 협상·DD 결과로 변경될 수 있다.
- 밸류에이션(가격)은 본 문서의 범위 밖이다 — S5(사업성 분석)·S6(DD)의 valuation-agent, dd-to-valuation-bridge 몫이다.
- 인수 vehicle(direct/SPC/holdco)은 미확정 — 법무·세무 검토(legal-counsel) 필요.
