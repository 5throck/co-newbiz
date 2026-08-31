---
stage: S6
gate: DD
owner_agent: legal-counsel
date: 2026-08-31
track: brownfield
---

## 갱신 이력 (2026-08-31, 2차 — K-LAW 원문 대조 반영)

> "LAW_API_OC 미설정"이라는 1차 판단(아래 §0)은 **오판이었다.** `.env`에 실제로 설정되어 있으며, device_bash가 매 호출마다 새 셸이라 자동 로드되지 않고 `.env`가 CRLF라 `\r` 오염으로 무응답했던 것이 원인이었다(`set -a; source <(tr -d '\r' < .env); set +a`로 해결). 국가법령정보센터 Open API로 관련 법령 조문 원문을 실제 대조했다 — 전체 내역은 `04-regulatory-antitrust-review.md` §0-1~§0-9 참고. 핵심 변동만 이 문서에 반영한다:

- **lr-04 판정 확정**: "절차 충족·결론 미대조"였던 이원 판정을 **충족(확정)**으로 정리한다. 외국인투자촉진법 제2조제1항제1호(외국인 정의)·제5조·제6조, 국가첨단전략산업법 제13조·시행령 제19조, 산업기술보호법 제11조의2 원문 대조 결과 국내법인 간 거래인 본 건은 해당 승인·신고 의무가 없음이 조문상 확정됐다. 단, 비히클을 외국법인으로 바꾸면 판정이 뒤집힌다(조건부 유지).
- **[신규 Red] REG-F1 — 지능형로봇전문기업 지정 상실 리스크**: 지능형 로봇 개발 및 보급 촉진법 제42조의2제1항제2호(상호출자제한기업집단 소속 기업 배제)·제42조의3제1항제2호(지정취소)에 따라, 대상기업이 현재 이 지정을 보유·지원금을 수령 중이라면 삼성 계열 편입 즉시 지정취소 사유가 발생한다. ldd-13 등 기존 인증/계약 체크리스트로는 발견되지 않는 축이며, DD 질의항목으로 신규 추가 필요(지정 보유 여부·수령 지원금 내역).
- **[정정] 인증 이전가능성(ma-12/lr-02) 조회 방향**: 지능형로봇법상 "로봇 품질인증" 조항(구 제10~16조, 제4장)은 각각 2016년·2023년에 전부 삭제되어 현재 존재하지 않는다. 실제 인증 근거는 「산업표준화법」 제15조(KS인증)이므로, 인증 이전가능성 확인은 지능형로봇법이 아니라 산업표준화법·산업안전보건법 인증기관 쪽으로 재조준해야 한다. 결론(미충족)은 불변.
- **[정정] gun-jumping 제재 성격**: 법 제130조제1항제1호에 따라 법인 과태료(1억원 이하)뿐 아니라 담당 임직원 개인에게도 과태료(1천만원 이하)가 부과됨을 조문으로 확인 — clean team 프로토콜을 개인 책임 사안으로 격상.
- 남은 미충족 항목(lr-01/02/03/05/07 등)은 법령 미확인이 아니라 **대상기업에 관한 사실(VDR·현장·인증기관 확인) 미확보**가 원인으로, 이번 갱신으로도 해소되지 않는다 — 판정은 유지.

---


# 03. Legal DD 판정 결과 — `checklists/legal-dd-checklist.yaml` (chk-legal-dd v1.0.0) + `checklists/legal-regulatory-checklist.yaml` (chk-legal-regulatory v1.0.0)

> 절차 근거: `procedures/_shared/brownfield-dd/schema.yaml` **step 5** (agent: legal-counsel, skill: `legal-due-diligence`, output_type: `dd_finding`). 규제 축은 `regulatory-screening`.
> 기업결합신고·전략기술 규제는 **`04-regulatory-antitrust-review.md`**에서 별도 상세 검토한다(중복 서술 회피).
> 딜 구조 전제: S4 `02-route-decision-record.md` — **주식양수(share deal), 지분 100%, 현금대가**. 로보틱스레인보우는 **국내법인·국내 주주 100%로 가정**(시나리오 설정상 지분구조가 가상이므로 국내기업으로 취급).

## 0. 법령 조회 방법론 및 그 한계 — 먼저 읽을 것

`skills/k-law/SKILL.md` Execution Step 1은 `LAW_API_OC` 환경변수를 전제조건으로 규정한다. **본 device 세션에는 `LAW_API_OC`가 설정되어 있지 않다**(환경변수 조회 결과 0건, `.env.sample`만 존재). 따라서 국가법령정보센터 Open API(`lawSearch.do` / `lawService.do`)를 통한 **조문 원문 축조 인용 경로가 봉쇄**되었다.

대체 경로로 **공개 웹 조회**를 사용해 소관기관·법무법인 공개자료·법령정보센터 페이지를 확인했으며, 아래 인용은 그 결과다. 이는 SKILL.md가 요구하는 `조문번호 + 조문제목 + 원문 verbatim` 수준에 **미달**한다.

> **legal-counsel의 명시적 경고**: 아래 법령 검토는 **적용 가능성 식별(issue spotting)** 수준이며, 조문 원문 대조를 마친 법률의견이 아니다. `legal-counsel.md` Responsibilities는 "패러프레이즈가 아니라 조문을 인용할 것"을 요구하는데 본 세션은 이를 완전히 충족하지 못했다. **집행·계약 목적으로 사용하기 전 반드시 한국 변호사의 조문 원문 확인이 필요하다.**

## 1. `legal-dd-checklist.yaml` 항목별 판정 (전 22항목, 원문 그대로)

| ID | 항목 원문 | 필수 | **판정** | 근거 |
|---|---|:---:|:---:|---|
| **ldd-01** | Good standing of the target and every subsidiary confirmed — certificates of incorporation, bylaws, and board minutes for the last 3 years obtained and reviewed | **필수** | **미충족** | 법인등기부등본·정관·3년치 이사회의사록 미입수. 자회사 존재 여부조차 미확인 |
| **ldd-02** | Capitalization table reconstructed — authorized vs. outstanding by class; all options, warrants, convertibles listed with vesting/expiry | **필수** | **미충족** | 주주명부·발행주식 종류별 내역·스톡옵션/워런트/전환사채 미확인. **100% 완전인수 구조에서 잠재주식(dilutive) 미확인은 인수 지분율 자체를 불확정하게 만든다** |
| **ldd-03** | Equity-holder votes/consents required to approve the deal identified, with transfer restrictions, preemptive rights, and ROFR/tag-along/drag-along mapped | **필수** | **미충족** | 주주간계약(SHA) 미입수. 비상장 부품사는 통상 VC·전략투자자 지분과 ROFR/동반매도청구권이 존재하며, **drag-along 부재 시 100% 인수가 소수주주 1인의 거부로 좌초**될 수 있다 — 거래 실행가능성(deal certainty)의 핵심 미확인 항목 |
| **ldd-04** | Signing authority verified — who can bind the target and each subsidiary, stated explicitly | **필수** | **미충족** | 대표이사 등기사항·내부 위임전결 미확인 |
| **ldd-05** | Restrictions on borrowing, refinancing, and guarantees mapped; anti-takeover defenses (staggered board, poison pill) identified where present | **필수** | **미충족** | 차입약정 미입수. **S5 `03-monte-carlo-simulation.md` §6이 "커버넌트 breach 판정 UNASSESSED"로 남긴 항목이 본 항목이며, S6에서도 해소되지 않았다.** 참고: 한국 상법상 포이즌필 제도는 도입되어 있지 않아 해당 방어수단의 존재 가능성은 낮으나, 정관상 초다수결의·이사 시차임기 조항은 확인 필요 |
| **ldd-06** | Change-of-control / anti-assignment clause scan completed across the top-20 customer and supplier contracts by revenue/cost — for each, counterparty notice period, consent requirement, and termination/payment consequences recorded; exclusivity, MFN, and minimum-volume commitments captured | **필수** | **미충족** | 계약서 미입수. **본 건 최대 리스크 항목 중 하나** — 대상기업의 상방 정밀감속기 공급자는 과점 구조(S1 축③)로 교섭력이 높아, CoC 조항에 의한 공급계약 해지·재협상 위험이 실재한다. 공급 중단은 마진(민감도 1위 변수)을 직격한다 |
| **ldd-07** | Asset-deal vs. share-deal assignment split determined — which contracts require consent to assign in an asset deal vs. pass automatically in a share deal | **필수** | **미충족** | **법리 수준의 결론은 제시 가능**: 본 건은 주식양수이므로 계약 당사자인 법인의 동일성이 유지되어 계약은 원칙적으로 자동 승계되며 개별 양도동의가 불요하다. **그러나 이 원칙은 CoC 조항에 의해 계약별로 파괴되므로, ldd-06의 계약 스캔 없이는 항목이 요구하는 "split 확정"이 불가능**하다 → 미충족 |
| **ldd-08** | Loan and security documents needing consent or refinancing at close flagged | **필수** | **미충족** | 여신약정·담보설정서류 미입수. **S5가 "change-of-control 가속조항의 존재 여부는 100% 완전인수 구조에서 반드시 확인해야 한다"고 명시 이관한 항목**이며, 미해소 상태로 유지된다. 순차입금 60억 [가정]의 조건이 전혀 알려져 있지 않다 |
| **ldd-09** | Pending/threatened litigation, arbitration, and regulatory investigations listed with exposure estimate and provision adequacy; judgment-lien, enforcement, and bankruptcy searches run against the target and key subsidiaries | **필수** | **미충족** | 소송·중재·규제조사 목록 미입수, 등기부 가압류/강제집행/회생파산 조회 미실시. S5 우발채무 CL-1(특허침해 소송, 확률 25%)은 **실제 계류 사건이 아니라 가정된 확률**이다 |
| **ldd-10** | IP inventory complete (patents, trademarks, copyrights, domains, trade secrets) with the inventor-to-company assignment chain verified for title gaps | **필수** | **미충족** | 특허·상표 목록 및 **발명자→법인 승계 체인** 미검증. SKILL.md Step 3은 "체인의 갭은 개별 문서가 깨끗해 보여도 red finding"이라 규정. 로봇 부품사의 가치는 상당 부분이 감속기 치형·제어 알고리즘 IP에 있으므로 **권리 귀속 갭은 밸류에이션 전제를 직접 파괴**한다 |
| **ldd-11** | Inbound and outbound licenses reviewed for exclusivity, sublicensing, assignability, and CoC triggers | **필수** | **미충족** | 라이선스 계약 미입수. 정밀감속기 분야는 해외 원천특허 라이선스 인바운드 의존 가능성이 있으며, **CoC 트리거로 라이선스가 종료되면 제품 생산 자체가 중단**될 수 있다 |
| **ldd-12** | IP security interests/encumbrances searched; maintenance/renewal fee compliance confirmed; ongoing or threatened IP disputes listed | **필수** | **미충족** | 특허권 질권·연차료 납부현황·분쟁 목록 미확인 |
| **ldd-13** | Employee and contractor PIIA coverage confirmed — every employee and contractor has executed IP assignment + confidentiality agreements | **필수** | **미충족** | 직무발명 승계 및 비밀유지 약정 체결률 미확인. 한국은 「발명진흥법」상 **직무발명은 사용자 승계 약정 또는 근무규정이 있어야 승계**되고 정당한 보상의무가 따르므로, 약정 부재 시 핵심 특허의 귀속 다툼과 보상금 청구 리스크가 동시에 발생한다 (조문 원문 미대조 — §0 한계) |
| **ldd-14** | Where a unionized workforce or pension plan exists: CBA successorship clauses, grievance backlog, and CBA expiry vs. deal timeline checked; pension/benefits exposure quantified (mark not-applicable with rationale where none exists) | **필수** | **미충족** | 노조 존재 여부·단체협약·퇴직급여충당 현황 **모두 미확인**. 항목은 "존재하지 않으면 사유와 함께 해당없음으로 표기"를 허용하나, **부존재를 확인한 바가 없으므로 해당없음으로 처리할 수 없다**. 참고: 주식양수이므로 근로관계는 법인 동일성 유지로 그대로 존속하며, `region-profiles/KR.yaml`은 한국에 works council 사전협의 의무가 없다(`works_council_consultation: false`)고 기록 |
| **ldd-15** | Permit/licence transfer classification stated for every business licence — transfers automatically / requires consent / must be re-issued (legal basis for the certification-transferability determination at brownfield-dd step 11; does not restate that step) | **필수** | **미충족** | 대상기업 보유 인허가 목록 자체가 미확보. **다만 분류 법리는 §4에 제시**했다. 비협상 경계 #5(허가=운영, 인증=판매 분리)에 따라 인증 축은 `04-regulatory-antitrust-review.md` §4로 분리 |
| **ldd-16** | Environmental notices, prior site assessments, and contamination history obtained | **필수** | **미충족** | 환경 행정처분 이력·토양정밀조사·오염이력 미입수. `02-technical-dd-result.md` TDD-F1과 동일 리스크의 법률 축 — 「토양환경보전법」상 **양수인 정화책임 승계 가능성**(선의·무과실 항변 여지 있음, `region-profiles/KR.yaml`)이 있으므로 주식양수 구조에서 그대로 이전된다 |
| **ldd-17** | Real-estate title/leasehold verified for owned and leased sites; CoC clauses in leases checked | **필수** | **미충족** | 부동산 등기부·임대차계약 미확인. 공장 부지가 임차인 경우 임대차계약 CoC 조항이 사업 계속성에 직결 |
| **ldd-18** | Data-protection review — privacy notices, breach/incident records, lawful basis for cross-border data transfers | **필수** | **미충족** | B2B 부품사로 개인정보 처리 규모는 제한적일 것으로 **추정**되나 확인된 바 없다. 국외이전은 국내 거래 전제상 현재 미해당으로 보이나(`region-profiles/KR.yaml` `data_transfer`), **로봇 제품의 원격 모니터링·센서 로그 수집이 있다면 「개인정보보호법」 적용 여지가 발생**하므로 추정으로 종결하지 않는다 |
| **ldd-19** | Anti-bribery controls tested and sanctions screening run on counterparties AND beneficial owners | **필수** | **미충족** | 반부패 통제 테스트·제재 스크리닝 미실시. lr-05와 동일 원인(§2) |
| **ldd-20** | Tax filings confirmed current; open audits and assessments identified | **필수** | **미충족** | 세무신고 현황·진행 중 세무조사 미확인. **주식양수 구조에서는 과거 조세채무가 법인에 그대로 잔존**하므로 특별손해배상(specific indemnity) 설계의 전제 정보다 |
| **ldd-21** | Findings register produced with RAG severity — red = deal-structural/remediation required, amber = warranty/indemnity protection, green = acceptable — feeding SPA protections (specific indemnities, escrow sizing, conditions precedent) and valuation adjustments via dd-to-valuation-bridge | **필수** | **충족(형식)** | §3에 RAG 등급·SPA 매핑을 포함한 findings register를 생성했다. **단서**: 등재된 findings는 실사 사실이 아니라 **미확인 리스크**이며, `dd_finding` DB 레코드는 `CO_NEWBIZ_API_TOKEN` 미설정으로 생성되지 않았다. 항목 문언("register produced")은 충족하나 실질적 유용성은 §2·§3의 미확인 상태에 종속된다 |
| ldd-22 | Korea note (where the target has Korean employees and an asset/business-transfer route is contemplated): employment succession on business transfer is judicial doctrine (영업양도, Supreme Court decision 2000다8448 line) — the individual-consent path is the safe practice. Verify against current statute and with Korean counsel before enforcement use. | 권고 | **해당없음** | 본 건은 **영업양수가 아니라 주식양수**다(S4 route decision). 주식양수에서는 법인의 동일성이 유지되어 근로관계가 자동 존속하므로 영업양도 법리(근로관계 포괄승계 + 개별 동의 문제)가 적용되지 않는다 → 해당없음. **단, 딜 구조가 영업양수·자산양수로 변경되면 즉시 적용으로 전환**되며, 그 경우 항목 문언대로 개별 동의 경로가 안전하고 조문·판례 원문 확인이 선행되어야 한다 |

**Legal DD 소계**: 필수 21항목 중 **미충족 20건**, 충족 1건(ldd-21, 형식 충족). 권고 1항목 해당없음(ldd-22).

## 2. `legal-regulatory-checklist.yaml` 항목별 판정 (전 7항목, 원문 그대로)

> chk-legal-dd 주석대로 lr-* 항목은 ldd-*와 중복되지 않는 **스크리닝 등급 규제 축**이다.

| ID | 항목 원문 | 필수 | **판정** | 근거 |
|---|---|:---:|:---:|---|
| **lr-01** | Applicable permit pathway identified and mapped as a DAG with critical-path lead time (permit-pathway-mapping) | **필수** | **미충족** | 인허가 경로 DAG 미작성. 본 건은 **신규 설립이 아니라 가동 중 법인의 주식 인수**이므로 신규 인허가 취득 경로 자체가 원칙적으로 발생하지 않는 구조이나, 인수에 수반해 **변경신고 의무가 발생하는 인허가**가 있는지 확인되지 않았다 → 해당없음으로 처리할 근거 부족 |
| **lr-02** | Certification requirements identified separately from permits, with transferability-on-change-of-control assessed for Brown Field (design's permit/certification separation rule) | **필수** | **미충족** | §4 및 `04-regulatory-antitrust-review.md` §4 참조. **비협상 경계 #5상 추론이 명시적으로 금지된 항목**이며, 인증기관(예: 한국로봇산업진흥원 등) 직접 확인이 이루어지지 않았다. S5 우발채무 CL-3(확률 15%)이 이 항목에 종속되어 있으며 확인 결과에 따라 0% 또는 100%로 붕괴한다 |
| **lr-03** | Applicable region profile(s) confirmed present and validated (region-profiles/_validate.ts) for every jurisdiction the deal touches | **필수** | **미충족** | `region-profiles/KR.yaml`은 **존재**하며 `merger_control`·`foreign_investment_screening`·`labor`·`environmental_liability_succession` 등 전 필드에 `source`/`verified_on: 2026-08-19`/`maintainer`가 기재되어 있음을 확인했다. 그러나 **`_validate.ts` 실행이 불가**했다(`bun: command not found` — 본 device 세션에 bun 런타임 부재). 항목 문언이 "present **and validated**"를 요구하므로 존재 확인만으로는 충족 불가 → 미충족. 이는 **대상기업의 결함이 아니라 본 세션의 도구 결함**이며 waiver가 아니라 인프라 조치로 해소되어야 한다 |
| **lr-04** | Foreign investment screening trigger checked against the region profile's mandatory_filing_triggers | **필수** | **충족** | `region-profiles/KR.yaml` `foreign_investment_screening.data.mandatory_filing_triggers` 2건에 대조: ① "외국인투자 신고 대상 지분율(통상 10%) 이상 취득" → **미해당**. 인수인 삼성전자(국내법인)·대상 국내법인 간 거래로 「외국인투자촉진법」상 외국인투자에 해당하지 않는다. ② "국가핵심기술 보유기업의 지분 인수, 합병, 영업양수" → **트리거 검토 결과 별도 규제축이 식별됨** — 다만 「산업기술의 유출방지 및 보호에 관한 법률」의 사전승인 규율은 **외국인에 의한 인수·합병**을 대상으로 하므로 국내기업 간 인수인 본 건은 원칙적으로 미해당. **그러나 국가연구개발자금 지원을 받아 개발된 국가핵심기술 보유기업의 경우 국내 M&A에도 신고의무가 규정되어 있는지 여부는 조문 원문 확인이 필요**하며, 로봇 구동부는 국가첨단전략기술로 지정된 영역이다 → 상세는 `04-regulatory-antitrust-review.md` §3. **(2차 갱신) 조문 원문 대조 완료 — 결론 확정됨. 상세는 위 갱신 이력 참고.** |
| **lr-05** | Sanctions and anti-corruption screening run against all counterparties, not just the primary target | **필수** | **미충족** | 제재·반부패 스크리닝 미실시. 대상기업, 매도주주, 주요 고객·공급자, 실질소유자(beneficial owner) 어느 것도 스크리닝되지 않았다. SKILL.md Step 3–4는 "주변적으로 보이는 상대방도 예외 없음"을 명시 |
| lr-06 | Data transfer mechanism confirmed for any cross-border data flow the deal requires | 권고 | **해당없음(잠정)** | 국내 인수인·국내 대상기업 간 거래로 딜 자체가 요구하는 국외 데이터 이전이 식별되지 않았다. **잠정 판정 사유**: 대상기업이 해외 고객·해외 생산거점을 보유하는지 미확인이며, VDR을 해외 소재 서버에 두는 경우에도 이전이 발생한다 → 확인 후 재판정 필요 |
| **lr-07** | NDA/confidentiality review completed before any DD material is loaded into the system (design §4-9-1 rule: loading itself can be an NDA violation) | **필수** | **미충족** | 본 세션은 **DD 자료를 시스템에 적재한 사실이 없으므로 실질적 위반은 발생하지 않았다.** 그러나 항목이 요구하는 것은 "적재 전 NDA 검토가 완료되었을 것"이며, `legal-counsel.md`가 규정한 **project_classification에의 NDA 판정 기록이 생성되지 않았다.** 실사 착수와 동시에 즉시 발화하는 항목이므로 미충족으로 둔다 — 이 판정이 미기록인 상태로 VDR을 여는 것 자체가 위반이 된다 |

**Legal-Regulatory 소계**: 필수 6항목(lr-01/02/03/04/05/07) 중 **충족 1건(lr-04), 미충족 5건(lr-01, lr-02, lr-03, lr-05, lr-07)**. 권고 1항목(lr-06)은 해당없음(잠정).

## 3. Legal Findings Register (ldd-21 산출물) — RAG · SPA 매핑

| # | Finding | RAG | SPA 보호장치 매핑 | 밸류에이션 영향 경로 |
|---|---|:---:|---|---|
| LDD-F1 | **차입약정 CoC 가속조항 미확인** — 100% 주식양수는 전형적 CoC 트리거. 가속 시 순차입금 60억[가정]이 클로징 시점에 즉시 상환의무로 전환 | **Red** | 선행조건(CP): 대주 동의서 또는 리파이낸싱 확약 | S5 `03` §6 커버넌트 테스트 UNASSESSED 해소 필요 |
| LDD-F2 | **상방 공급계약 CoC 조항 미확인** — 정밀감속기 과점 공급자가 CoC로 계약 해지·단가 재협상 시 마진(민감도 1위) 직격 | **Red** | CP: 주요 공급자 동의서 / 특별손해배상 | `ebitda_margin_sustainable` |
| LDD-F3 | **IP 권리귀속 체인 미검증**(직무발명 승계 약정 포함) — 핵심 감속기·제어 IP의 귀속 갭은 밸류에이션 전제를 파괴 | **Red** | 특별손해배상 + 에스크로 | EV 전액 위험 |
| LDD-F4 | **소수주주 drag-along/ROFR 미확인** — 100% 인수 실행가능성 자체가 불확정 | **Red** | CP: 전 주주 동의 확보 | 딜 성립 여부 |
| LDD-F5 | **환경 정화책임 승계 노출**(토양환경보전법) — 정밀가공·열처리 공정 + 주식양수 구조 | **Red** | 특별손해배상 + 에스크로, 토양정밀조사 CP | 신규 우발채무 CL-5 (S5 모델 미반영) |
| LDD-F6 | **인증 이전가능성 미확인**(비협상 경계 #5) — 확인 전까지 CL-3 분포 15%는 무근거 | **Red** | CP: 인증기관 확인서 | 인수 프리미엄 전액 잠식 가능 |
| LDD-F7 | 조세 우발채무 미확인(주식양수로 법인에 잔존) | Amber | 조세 특별손해배상 | 미정량 |
| LDD-F8 | 소송·규제조사 미확인 — CL-1(25%)은 가정치 | Amber | 진술보장 + 에스크로 | CL-1 분포 |
| LDD-F9 | 노조·퇴직급여 노출 미확인 | Amber | 진술보장 | HR 통합비용(DS-1) |
| LDD-F10 | NDA 판정 미기록 상태에서의 VDR 개설 위험 | Amber | 절차 — DD 착수 전 즉시 해소 | 해당없음(절차 리스크) |

> **Red 6건은 전부 "위반을 발견한 것"이 아니라 "확인하지 못한 것"이다.** 그러나 DD 게이트 관점에서 두 상태의 취급은 동일하다 — 어느 쪽도 미해소 필수 미충족이다.

## 4. 인허가 이전 분류 법리 (ldd-15의 법적 기준 — 목록은 미확보)

주식양수(share deal)와 영업·자산양수(asset deal)의 인허가 취급은 근본적으로 다르다.

| 구조 | 인허가 취급 원칙 |
|---|---|
| **주식양수 (본 건)** | 인허가 명의자인 법인의 **법인격이 동일하게 유지**되므로 인허가는 원칙적으로 **그대로 존속**한다. 다만 개별 법령이 **대표자·최대주주 변경 시 변경신고**를 요구하는 경우가 있고, 결격사유 심사가 붙는 인허가에서는 새 지배주주에 대한 심사가 재개될 수 있다 |
| 영업·자산양수 | 인허가는 원칙적으로 **자동 승계되지 않으며**, 법령이 지위승계를 명시한 경우에만 신고로 승계, 그 외에는 **신규 취득** 필요 |

**본 건에 대한 잠정 결론**: 주식양수 구조이므로 인허가 리스크는 자산양수 대비 현저히 낮다. **그러나 이는 "인허가"에 대한 결론이며 "인증"에는 그대로 적용되지 않는다.** 비협상 경계 #5가 두 축을 분리하는 이유가 바로 이것이다 — 인증은 발급기관의 자체 규정이 지배하고, 지배주주 변경을 인증 유지의 결격·재심사 사유로 정한 스킴이 존재할 수 있다. **인증 축은 추론이 금지되며**(`legal-counsel.md` Constraints, brownfield-dd step 11), 확인 전까지 어떤 결론도 기재하지 않는다.

## 5. S5 이월 리스크에 대한 Legal DD의 검증 결과

| S5 리스크 | Legal DD 검증 결과 |
|---|---|
| 커버넌트/CoC 가속조항 UNASSESSED | **미해소** — ldd-05/08 미충족. LDD-F1로 Red 등재 |
| 인증 이전가능성(CL-3) | **미해소** — lr-02, brownfield-dd step 11 미수행. LDD-F6으로 Red 등재. 비협상 경계 #5상 추론 금지 |
| DART 데이터 미확인 | **미해소** — `DART_API_KEY` 여전히 미설정. `k-dart` 스킬의 전제조건 미충족(3개 스테이지 연속) |
| 그룹 내부거래 역시너지(DS-2) | **법률 축 신규 발견** — 인수 후 삼성전자·로보틱스레인보우 간 거래는 「독점규제 및 공정거래에 관한 법률」상 **부당지원행위 및 특수관계인 부당이익제공** 규율의 적용 대상 영역에 들어간다. 즉 DS-2(그룹 단가정책에 의한 마진 잠식)는 **단순한 상업적 리스크가 아니라 규제 리스크와 결합**되어 있다 — 내부거래 단가를 정상가격에서 이탈시키는 방향의 시너지 설계는 그 자체로 법적 노출을 만든다. 워크스페이스에 `skills/intra-group-transaction-compliance`가 존재하나 본 세션에서 실행되지 않았다 → **후속 필수** |

## 6. 검증 가능성 구분 (Three-Stage Review)

| 구분 | 항목 |
|---|---|
| **검증됨(verified)** | `region-profiles/KR.yaml`의 존재 및 필수 메타(source/verified_on/maintainer) 기재 사실; 본 건이 「외국인투자촉진법」상 외국인투자에 해당하지 않는다는 구조적 판단(국내법인 간 거래 전제); 딜 구조가 주식양수라는 사실(S4 문서) |
| **검증 불가(could not verify)** | 대상기업에 관한 **모든 법률 사실** — 등기, 정관, 주주간계약, 계약서, 소송, IP, 노무, 환경, 부동산, 세무. 및 `_validate.ts` 통과 여부, 인증 이전가능성 |
| **판단 필요(needs judgement)** | ldd-22를 해당없음으로 처리한 것(딜 구조 변경 시 즉시 전환), lr-06 잠정 해당없음, lr-04를 "절차 충족·결론 미대조"로 이원 판정한 것의 타당성 |

## Sources (공개 웹 조회 — 조문 원문 미대조, §0 한계 참조)

- [경쟁제한적 기업결합 심사 — 공정거래위원회](https://www.ftc.go.kr/www/contents.do?key=691)
- [산업기술의 유출방지 및 보호에 관한 법률 — 국가법령정보센터](https://www.law.go.kr/%EB%B2%95%EB%A0%B9/%EC%82%B0%EC%97%85%EA%B8%B0%EC%88%A0%EC%9D%98%EC%9C%A0%EC%B6%9C%EB%B0%A9%EC%A7%80%EB%B0%8F%EB%B3%B4%ED%98%B8%EC%97%90%EA%B4%80%ED%95%9C%EB%B2%95%EB%A5%A0)
- [지능형 로봇 개발 및 보급 촉진법 — 국가법령정보센터](https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=251027)
- [국가첨단전략산업 보호 및 육성을 위한 특별법 제정 — 김·장 법률사무소](https://www.kimchang.com/ko/insights/detail.kc?sch_section=4&idx=24638)
- [해외인수합병 승인 — 산업보안 행정지원시스템](https://is-support.or.kr/advancetech/advancetech03)
- `region-profiles/KR.yaml` (verified_on 2026-08-19, maintainer: legal-counsel)

`법제처 국가법령정보 공동활용 자료 기준 / 법적 자문 아님` — Not legal advice. 본 문서의 법령 검토는 조문 원문 대조를 마치지 않았으며, 집행 목적 사용 전 한국 변호사의 확인이 필요하다.
