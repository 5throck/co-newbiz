---
stage: S6
gate: DD
owner_agent: commercial-dd-agent
date: 2026-08-31
track: brownfield
---

# 01. Commercial DD 판정 결과 — `checklists/commercial-dd-checklist.yaml` (chk-commercial-dd v1.0.0)

> 절차 근거: `procedures/_shared/brownfield-dd/schema.yaml` **step 1** (agent: commercial-dd-agent, skill: `commercial-due-diligence`, output_type: `dd_finding`).
> 대상: 로보틱스레인보우(가상 비상장 휴머노이드·협동로봇 부품기업) 100% 지분 인수. 권고 인수가 밴드 600~700억원(S5 `04-business-case.md` §5).
> 단위: 억원(KRW 100M).

## 0. DD 실행 전제의 결정적 제약 — 먼저 읽을 것

본 S6 세션에는 **대상기업에 대한 실사 접근이 전혀 없다**. 구체적으로:

| 전제 | 상태 |
|---|---|
| VDR(가상 데이터룸) 접근 | **없음** — 고객명부, 매출원장, 계약서, 감사보고서 미제공 |
| 경영진 인터뷰 / Q&A 세션 | **미실시** |
| 전문가 인터뷰(`expert-interview`) | **미실시** — 따라서 삼각검증(cdd-07) 대상 주장 자체가 존재하지 않음 |
| 채널 체크(유통·대리점) | **미실시** |
| `CO_NEWBIZ_API_TOKEN` / MCP를 통한 `dd_finding` 레코드 생성 | **불가** — `.env` 미설정(§4 확인). 본 문서의 findings는 **파일 기반 기록**이며 DB 레코드로 등재되지 않았다 |

따라서 아래 판정에서 "미충족"은 **"검증한 결과 문제가 있다"가 아니라 "검증 자체를 수행하지 못했다"**를 뜻한다. 이 구분은 DD 게이트 심의에서 결정적이다 — 전자는 가격·SPA로 처리 가능하지만, 후자는 **DD를 아직 시작하지 않은 상태**를 의미한다.

## 1. 체크리스트 항목별 판정 (전 7항목, 원문 그대로)

| ID | 항목 원문 | 필수 | waiver 가능 | **판정** | 근거 |
|---|---|:---:|:---:|:---:|---|
| **cdd-01** | Customer concentration analyzed (top-N revenue share) | **필수** | Y | **미충족** | 고객별 매출 데이터 미제공. S5 `02-valuation-dcf-comparable.md` §1의 FY2025 매출 850억원조차 `assumed`이며 고객 분해가 존재하지 않는다. **정량화 요구(top-N revenue share)를 정성 서술로 대체할 수 없다**(SKILL.md Step 1: "quantified, not 'concentrated' as a qualitative label"). 본 건의 특수 리스크: 인수 후 삼성전자 자신이 캡티브 고객이 되면(S3 시너지 C, 매출의 10~20%) **집중도가 인수로 인해 오히려 상승**하며, 이는 인수 전 집중도 측정 없이는 델타를 계산할 수 없다 |
| **cdd-02** | Customer churn history reviewed | **필수** | Y | **미충족** | 세그먼트별 이탈률·추세 데이터 미제공. 부품사 특성상 고객 이탈은 승인(PPAP류) 재취득 비용 때문에 지연 발생하므로 **과거 이탈률의 후행성**을 감안한 시계열이 필요하나 원자료 없음 |
| **cdd-03** | Pricing power assessed (ability to pass through cost increases) | **필수** | Y | **미충족** | SKILL.md Step 3은 "historical instances로 입증, 시장지위로부터 가정 금지"를 요구한다. 원가전가 실적 사례 미확보. **본 항목은 본 딜의 최우선 항목이다** — S5 `03-monte-carlo-simulation.md` §5 토네이도에서 EBITDA 마진이 압도적 1위 드라이버(4%p 하락 시 EV 74% 증발)이고, 마진은 곧 가격전가력의 결과다. 상방 정밀감속기 공급자 과점(S1 축③ 교섭력 High)과 하방 삼성 그룹 단가정책(S5 역시너지 DS-2, PV −127억)이 양쪽에서 압박하는 구조가 식별되어 있으나 **어느 쪽도 실증되지 않았다** |
| cdd-04 | Win/loss analysis conducted against named competitors | 권고 | Y | **미충족** | 수주 win/loss 데이터 미제공. S1 `02-competitive-intelligence.md`의 경쟁사 프로파일은 시장 수준 분석이며 대상기업의 개별 수주 실적이 아니다 |
| cdd-05 | Channel checks completed with distributors/resellers where applicable | 권고 | Y | **미충족** | 채널 체크 미실시. 다만 로봇 부품은 통상 OEM 직판 비중이 높아 채널 적용범위 자체가 제한적일 수 있음 — **"where applicable" 판단조차 대상기업의 판매채널 구조 확인 후에만 가능**하므로 해당없음으로 처리하지 않고 미충족으로 둔다 |
| **cdd-06** | Every material finding tied to an assumption_key or dd_finding.value_impact — no finding left as narrative-only | **필수** | Y | **미충족** | 본 문서의 findings(§2)는 assumption_key 후보를 명시했으나, `CO_NEWBIZ_API_TOKEN` 미설정으로 **실제 `dd_finding` / `assumption` 레코드가 생성되지 않았다**. 체크리스트 문언과 SKILL.md Context는 "downstream이 실제로 계산 가능한 상태"를 요구하므로, 파일 내 서술만으로는 충족으로 볼 수 없다 |
| **cdd-07** | Expert interviews follow the triangulation guideline (2-3 independent sources per material claim) | **필수** | Y | **해당없음** | 전문가 인터뷰를 **한 건도 실시하지 않았다**. 따라서 미삼각검증 주장에 의존한 사실이 없으므로 항목 취지(단일출처 의존 금지)에 위반이 없다 → 해당없음. **단, 이는 긍정적 신호가 아니다** — cdd-01~05의 증거원이 통째로 비어 있다는 사실의 이면일 뿐이며, DD 착수 시 이 항목은 즉시 "적용"으로 전환된다 |

**Commercial DD 소계**: 필수 5항목 중 **미충족 4건**(cdd-01/02/03/06), 해당없음 1건(cdd-07). 권고 2항목 모두 미충족.

## 2. 본 세션이 실제로 산출한 Commercial 관점 findings (분석 기반, 실사 미기반)

원자료 없이도 S1~S5 산출물로부터 도출 가능한 상업적 findings를 기록한다. **전부 `assumed` 등급이며 실사 검증 대상 목록으로서만 유효**하다.

| # | Finding | RAG(제안) | assumption_key 후보 | value_impact 경로 |
|---|---|:---:|---|---|
| CDD-F1 | **가격전가력 양방향 압박 구조**: 상방(정밀감속기 과점 공급자) 원가인상 전가 불가 + 하방(삼성 그룹 표준 단가정책) 판가인하 압력이 동시 작용. 시너지 C(캡티브 물량)가 시너지 A(원가절감)를 자기잠식 | **Red** | `ebitda_margin_sustainable` | S5 `03` §5 — 마진 1%p = EV 약 284억 |
| CDD-F2 | **고객집중도가 인수로 상승**: 캡티브 물량 10~20% 유입 시 최대고객=삼성. 단일고객 의존은 통상 밸류에이션 디스카운트 요인이나 본 건은 그 고객이 인수인 자신이므로 **표준 디스카운트 로직이 적용되지 않는다** — 별도 판단 필요 | Amber | `customer_concentration_post_close` | 미정량 |
| CDD-F3 | **매출 850억·마진 13% 기준선 전량 미검증**(QoE 미실시, FS step 1 이월) | **Red** | `revenue_fy2025`, `ebitda_margin_fy2025` | 밸류에이션 전체의 선행 결함 |
| CDD-F4 | 매도자 희망가격 미확인 — S5의 가격조건부 Kill 트리거(870억 초과)가 발화 여부 미상 | Amber | `seller_ask_price` | Kill 판정 직결 |

> **`dd-to-valuation-bridge` 미연결 상태**: 위 4건은 valuation bridge에 실제로 투입되지 않았다(cdd-06 미충족 사유와 동일 원인).

## 3. S5 이월 리스크에 대한 Commercial DD의 검증 결과

| S5 리스크 | Commercial DD 검증 결과 |
|---|---|
| 그룹 내부거래 역시너지(DS-2, PV −127억) | **검증 불가** — 삼성전자 구매 단가정책 문서, 대상기업 판가 구조 모두 미확보. 다만 구조적 성립 가능성은 CDD-F1로 재확인. 정량치 1.0%p는 여전히 순수 판단치 |
| 시너지 제외 시 NPV 음수(700억에서 −68억) | **검증 불가** — 시너지 A(원가절감 2.0%p)·C(캡티브 12%)의 기초가 되는 BOM·CAPA·삼성 내부 조달계획 미확보. S3 조건 3(assumed 2건 실사 검증)이 **미이행 상태로 S6를 통과 중** |
| WACC/DART 데이터 미확인 | 본 워크스트림 범위 밖(→ `03-legal-dd-result.md` §5, `04-regulatory-antitrust-review.md` §5에서 DART 접근 불가를 재확인) |

## 4. 환경 제약 실측 기록

- `.env`는 `.env.sample` 형태만 존재하고 `DART_API_KEY` / `LAW_API_OC` / `KOSIS_API_KEY` / `CO_NEWBIZ_API_TOKEN` **모두 미설정**(환경변수 조회 결과 0건).
- `bun` 런타임이 본 device 세션 PATH에 없어 `_validate.ts` 계열 검증 스크립트를 실행할 수 없다(`bun: command not found`).
- → S1·S5에서 이미 2회 기록된 동일 인프라 결함이 **S6에서도 해소되지 않았다**. 거버넌스 차원의 조치가 필요하다(platform-lead 회부 권고).

## 5. 검증 가능성 구분 (Three-Stage Review — "PASS 도장 없음")

| 구분 | 항목 |
|---|---|
| **검증됨(verified)** | 없음 — 대상기업에 관해 본 워크스트림이 외부 검증한 사실은 **0건** |
| **검증 불가(could not verify)** | 고객집중도, 이탈률, 가격전가력, win/loss, 채널구조, 매출·마진 기준선, 매도자 희망가격 — 즉 체크리스트 전 항목 |
| **판단 필요(needs judgement)** | cdd-07을 "해당없음"으로 처리한 것의 타당성(인터뷰 미실시를 항목 비적용으로 볼 것인지 미충족으로 볼 것인지), 인수인 자신이 최대고객이 되는 구조의 집중도 디스카운트 적용 여부 |

Based on stated assumptions / Not investment advice, not a legal opinion.
