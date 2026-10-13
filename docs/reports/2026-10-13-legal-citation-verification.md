---
title: Legal citation verification — entity-formation, legal-regulatory, M&A special topics, brownfield overlay
date: 2026-10-13
owner_agent: legal-counsel
lang: ko
lang_reason: source-material
---

# Legal citation verification (2026-10-13)

Method: k-law skill. `lawSearch.do` (target=law, display=100, exact `법령명한글` match) to resolve MST, then `lawService.do` by MST for article text; target=prec for case law. No edits were made to checklist files.

## Statutes resolved

| 법령명 | MST | 시행일자 (list) | 시행일자 (body returned) |
|---|---|---|---|
| 상법 | 273629 | 2026-09-10 | 2026-09-10 |
| 독점규제 및 공정거래에 관한 법률 | 290153 | 2026-10-02 | 2026-10-02 |
| 독점규제 및 공정거래에 관한 법률 시행령 | 284737 | 2026-03-24 | 2026-03-24 |
| 외국인투자 촉진법 | 276565 | 2026-01-02 | 2025-10-01 (mismatch; use target=eflaw before citing a date) |
| 외국인투자 촉진법 시행령 | 284815 | 2026-03-24 | 2026-03-24 |
| 산업기술의 유출방지 및 보호에 관한 법률 | 280043 | 2026-06-03 | 2026-06-03 |
| 국가첨단전략산업 경쟁력 강화 및 보호에 관한 특별조치법 | 286519 | 2026-06-02 | 2026-06-02 |
| 근로기준법 | 285279 | 2026-10-08 | 2026-10-08 |
| 파견근로자 보호 등에 관한 법률 | 286257 | 2026-05-26 | 2026-05-26 |

## Findings

| file:item | claim | k-law result | verdict | proposed wording |
|---|---|---|---|---|
| entity-formation:ef-04 | Parent board or shareholder resolution approving formation/funding/IP contribution | No single statute; 상법 제374조 requires 제434조 special resolution only for transfer of all or an important part of the business ("영업의 전부 또는 중요한 일부의 양도"). | matches (no wrong cite); add pointer | Append: "(한국: IP·사업 출연이 영업의 중요한 일부 양도에 해당하면 상법 제374조제1항제1호에 따른 주주총회 특별결의 필요 — 해당 여부는 법률 자문으로 확인)" |
| entity-formation:ef-05 | Articles notarised where required | 상법 제292조: "정관은 공증인의 인증을 받음으로써 효력이 생긴다. 다만, 자본금 총액이 10억원 미만인 회사를 … 발기설립하는 경우" signature suffices. | matches | Optional: "(한국: 상법 제292조 — 자본금 10억원 미만 발기설립은 공증 면제)" |
| entity-formation:ef-06 | bylaws, incorporator resolution, D&O indemnification | US-style documents; no Korean statutory claim made. | cannot find (not a Korean claim) | Keep; mark as US/common-law practice in legal_basis. |
| entity-formation:ef-07 | IP assignment + PIIA | No Korean statutory claim. Korean employee inventions fall under 발명진흥법 (not queried). | could not verify | Needs counsel: Korean 직무발명 succession (발명진흥법) should be named for KR entities. |
| entity-formation:ef-08 | "영업양도에 따른 근로관계 승계는 판례 법리 … 개별 동의를 받는 것이 안전한 경로" | No statute governs succession (근로기준법 has none; 제24조제1항 only treats business transfer to prevent deterioration as 긴박한 경영상 필요). Precedent 대법원 2018두54705 (2020-11-05): transferee of the whole business "근로관계를 원칙적으로 승계한다"; an exclusion clause is "실질적으로 또 다른 해고" requiring 제23조제1항 just cause. 전적 consent precedent not retrieved via API. 파견법 제2조제1호 defines 근로자파견 as employer-retained employment under the user's 지휘·명령. | partly matches; wording garbled ("판례 법리 — 영업양도 —") and incomplete | "한국: 영업양도 시 근로관계는 판례상 원칙적으로 양수인에게 승계되며(대법원 2020. 11. 5. 선고 2018두54705), 승계 배제 특약은 해고와 같이 정당한 이유가 필요함(근로기준법 제23조제1항). 영업양도가 아닌 인력 이동은 전적(근로자 개별 동의 필요)·전출로 처리하고, 전출이 모회사의 업(業)으로서 사용사업주 지휘·명령 아래 근로하는 형태이면 근로자파견(파견법 제2조제1호)으로 볼 위험이 있으므로 법률 자문으로 확인" |
| entity-formation:ef-13..ef-18 | JV board, reserved matters, deadlock, exit, single-channel, firewall | Contract design, no statutory citation. ef-18 firewall relates to 공정거래법 제40조제1항제9호 (정보 교환 담합). | matches (no cite); optional add | ef-18 append: "(한국: 공정거래법 제40조제1항제9호 정보 교환 규제)" |
| entity-formation:ef-19 | 분할 needs 주총 특별결의 (상법 제530조의3); creditor protection for 분할합병 (제530조의11제2항) and 연대책임 배제 단순분할 (제530조의9제2항·제4항), both via 제527조의5; individual notice + public notice ≥1 month | 제530조의3②: "제1항의 승인결의는 제434조의 규정에 의하여야 한다." 제530조의9④: "제2항의 경우에는 제439조제3항 및 제527조의5를 준용한다." 제530조의11②: lists 제527조의5 for 분할합병. 제527조의5①: "1월이상의 기간내에 이를 제출할 것을 공고하고 알고 있는 채권자에 대하여는 따로따로 이를 최고". MST 273629 matches. | matches | Keep. Optionally add 제530조의3⑥ (주주 부담 가중 시 전원 동의). |
| legal-regulatory:lr-01, lr-02 | permit DAG; certification separate from permits | Methodology; no statute cited. | not a statutory claim | Keep. |
| legal-regulatory:lr-03, lr-05, lr-06 | region profile, sanctions, data transfer | No Korean statute cited. | not a statutory claim | Keep. |
| legal-regulatory:lr-04 | FDI screening per region-profile triggers | 외국인투자 촉진법 제5조①: invest "미리 산업통상부장관에게 신고"; 제6조①: 방위산업체 "미리 산업통상부장관의 허가"; 시행령 제2조②: ≥1억원 and "100분의 10 이상" voting shares or 임원 파견·선임; 시행령 제5조①제2호: 국가안보위해 review where foreigner acquires "경영상 지배권을 실질적으로" of existing domestic company. 산업기술보호법 제11조의2①·⑤ (국가핵심기술 approval/prior report); 첨단전략산업법 제13조① (전략기술보유자 approval). | matches (generic); KR specifics missing | Append: "(한국: 외국인투자 촉진법 제5조 사전신고·제6조 방산 허가·시행령 제5조 안보심사, 산업기술보호법 제11조의2, 국가첨단전략산업법 제13조를 점검)" |
| legal-regulatory:lr-07 | NDA review before DD upload | Contractual; 산업기술보호법/첨단전략법 제15조 confidentiality duties exist but no specific citation in item. | not a statutory claim | Keep; counsel judgement per NDA. |
| legal-regulatory:legal_basis | only internal docs | No statute listed. | n/a | Consider adding statutes above. |
| ma-special-topics:ma-01 | HHI incl. common ownership | 공정거래법 제9조③ uses market-share presumptions (top share, 25% gap; 대규모회사 SME-market ≥5%); HHI thresholds are in KFTC 고시 (기업결합 심사기준), not retrieved. 제11조⑤ aggregates 특수관계인 shares. | matches in principle; HHI source could not verify | Add: "(한국: 공정거래법 제9조제3항 추정 요건 및 기업결합 심사기준 고시 병행)" |
| ma-special-topics:ma-02 | multi-jurisdiction filing check | 공정거래법 제11조①: 신고대상회사 자산·매출 3천억원 이상, 상대회사 300억원 이상 (시행령 제18조①②); 제1호 "100분의 20[…상장법인의 경우에는 100분의 15…] 이상"; 제11조②·시행령 제19조: 소규모피취득 거래금액 6천억원 + 국내 활동; 제11조③ VC/신기술금융 exemptions. | matches (generic) | Optional KR note: "(한국: 3천억/300억원, 20%(상장 15%) 이상·최다출자자, 거래금액 6천억원 기준 — 공정거래법 제11조, 시행령 제18·19조)" |
| ma-special-topics:ma-03 | no share-acquisition completion or integration before review result ("승인") | 제11조⑧: those under prior-filing "심사결과를 통지받기 전까지 각각 주식소유, 합병등기, 영업양수계약의 이행행위 또는 주식인수행위를 하여서는 아니 된다." 제11조⑥: prior filing only where a party is 대규모회사 (자산·매출 2조원 이상, 시행령 제15조③) or 제11조② deal; otherwise post-filing "기업결합일부터 30일 이내". 제11조⑦: review 30 days, extendable 90 days. | partly differs: KFTC issues 심사결과 통지, not "승인"; 통합 조치 is broader than statute | "승인 전 이행 금지(gun-jumping): 사전신고 대상(한국: 당사회사 중 대규모회사(2조원 이상) 포함 또는 소규모피취득 거래)이면 공정위 심사결과 통지 전까지 주식소유·합병등기·영업양수계약 이행·주식인수를 하지 않음(공정거래법 제11조제8항); 통합 조치·정보 교환 제한은 신중 관행 및 해외 관할 기준으로 병행" |
| ma-special-topics:ma-05 | non-compete enforceability per jurisdiction | Precedent 2024나10738 (대전고법 경업금지) exists; not analysed. | could not verify | Counsel judgement. |
| ma-special-topics:ma-04, ma-06..ma-12 | comp, CoC, contingent liabilities, certification | No statutory citation. | not a statutory claim | Keep. |
| overlay:ma-01 readings (strategic/minority/CVC) | info exchange with competitor = 부당한 공동행위 risk | 공정거래법 제40조①제9호: "가격, 생산량, 그 밖에 대통령령으로 정하는 정보를 주고받음으로써 일정한 거래분야에서 경쟁을 실질적으로 제한하는 행위". | matches | Optionally cite 제40조제1항제9호. |
| overlay:ma-03 readings | before approval: no completion (payment/title), no board-nomination/veto exercise, no CSI exchange, no integration; post-filing cases cite ma-02 | 제11조⑧ (above) bars 주식소유/이행행위 only; director nomination/veto and CSI not in Korean text; post-filing (제11조⑥ 본문) has no standstill. | partly differs (scope beyond KR statute presented as one rule) | Prefix list with: "한국 법정 금지(공정거래법 제11조제8항): 주식소유·이행행위·주식인수. 그 밖에 이사 지명권·거부권 행사, 경쟁상 민감한 정보 교환 제한은 해외 관할 및 공정거래법 제40조 위험에 대한 신중 관행" |
| overlay:line 921 | 공정거래법 제40조 (부당한 공동행위, 정보 교환 포함) | 제40조①제9호 and ⑤제2호 confirm information-exchange coverage. | matches | Keep. |
| overlay:min-05 reading | minority/non-controlling investment can be screened for 국가핵심기술·첨단기술, defense, infra, sensitive data, or board/observer rights | KR: 시행령 제2조② 10% or 임원 파견 defines FDI (신고); 시행령 제5조①제2호 안보심사 targets acquisition of "경영상 지배권을 실질적으로" (control), with listed sectors (방위산업물자 등); 산업기술보호법 제11조의2 and 첨단전략법 제13조 cover "합작투자 등 외국인투자" scoped by 대통령령. "옵서버" and "대량 민감 개인정보" not found in KR text (CFIUS-style). | matches generically ("관할에 따라"); KR minority-stake security review is control-based | Add KR note: "(한국: 외국인투자 신고는 10% 이상 또는 임원 파견(외국인투자 촉진법 시행령 제2조), 안보심사는 경영상 지배권 실질 취득 시(시행령 제5조); 국가핵심기술·전략기술 보유 대상은 산업기술보호법 제11조의2, 국가첨단전략산업법 제13조로 별도 승인·신고)" |
| deal-shape:min-04 | standstill + information barrier (MNPI) | No statute; MNPI ties to 자본시장법 (not queried). | could not verify | Counsel judgement. |

## Summary groups

**Verified** — ef-05 (상법 제292조), ef-19 (상법 제530조의3·제530조의9·제530조의11·제527조의5, MST 273629), 공정거래법 제11조 thresholds and timing (①②⑥⑦⑧, 시행령 제15·18·19·20조), 제40조 information exchange (overlay ma-01 readings, line 921), 외국인투자 촉진법 제5·6조 and 시행령 제2·5조, 산업기술보호법 제11조의2, 국가첨단전략산업법 제12·13조, 대법원 2018두54705 succession principle.

**Could not verify** — Korean consent requirement for 전적 (no precedent retrieved in this run), KFTC HHI thresholds (고시 not queried), 발명진흥법 직무발명 for ef-07, non-compete enforceability (ma-05), MNPI basis for min-04, 외국인투자 촉진법 effective-date discrepancy (list 2026-01-02 vs body 2025-10-01; re-check with target=eflaw), 시행령 제18조③ foreign-to-foreign domestic-turnover rule (truncated in output).

**Needs counsel judgement** — ef-08 wording and whether any secondment structure is 근로자파견; whether IP/business contribution in ef-04 triggers 상법 제374조; ma-03 and overlay ma-03 scope beyond 제11조⑧; min-05 applicability for non-controlling stakes in 국가핵심기술/전략기술 holders; NDA upload determination (lr-07).

법제처 국가법령정보 공동활용 자료 기준 / 법적 자문 아님

## Addendum 2026-10-13: decree art. 18(3) verified

The PM verified the Enforcement Decree of the Monopoly Regulation and Fair Trade Act (공정거래법 시행령, MST 284737, effective 2026-03-24) against the 법제처 Open API on 2026-10-13. Verbatim substance of art. 18:

- (1) the party company (including affiliates) with total assets or revenue of 3천억원 or more (and (2) the counterparty 300억원 or more, or the reverse) is a filing subject;
- (2) the other party company threshold is 300억원;
- (3) where a foreign company is a party, the case is a filing subject only when each such foreign company's domestic sales are 300억원 or more;
- (4) share acquisition of 20% or more (15% or more for listed companies).

The earlier conflict between legal-counsel (truncated response, about 5.8k characters, art. 18(3) not accepted) and antitrust (successful re-query) is resolved: the truncation was an API response limitation, and a fresh query returned the full text. The "Could not verify" entry for 시행령 제18조③ above is superseded. Applied in `checklists/ma-special-topics-checklist.yaml` ma-02 (v1.4.3). Still decision support, not legal opinion; counsel sign-off remains pending.
