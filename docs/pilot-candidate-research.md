# Manual Pilot Candidate — Real-Case Research

**Owner**: pm (research), risk-officer (fit review pending)
**Status**: Both candidates identified below have been confirmed and promoted (2026-08-20) — HD Hyundai / STX Heavy Industries to `docs/pilots/pilot-001-hd-hyundai-stx-heavy-industries.md`, Hanwha Impact / HSD Engine to `docs/pilots/pilot-002-hanwha-impact-hsd-engine.md`. This file remains the candidate-sourcing log for future cases, per the user's instruction that more real cases are expected to follow (see `docs/pilots/README.md`).
**Design of record**: design v1.0 §10 (O-3), `docs/transition-plan.md` §5.5

> Per the O-3 resolution: since no internal deal is available yet, this document researches a real, publicly documented precedent to use as the pilot case, rather than a fabricated synthetic one. All facts below are sourced from public Korean news/regulatory reporting — see citations.

## Recommended Candidate: HD Hyundai's Acquisition of STX Heavy Industries (2024)

**Why this fits better than any synthetic case could:**

1. **Directly in the design's own worked example industry.** The design's flagship proxy-chain illustration is literally crankshaft → marine engine → ship. This deal *is* a crankshaft/marine-engine-market transaction — not an analogy, the actual industry.
2. **Region match**: Korea (KR profile, already drafted in `region-profiles/KR.yaml`) — no additional region profile work needed to run the pilot.
3. **Real regulatory outcome to test against, not just financials.** The Korea Fair Trade Commission (공정거래위원회) issued a **conditional approval** with concrete behavioral remedies — this is exactly the kind of real regulatory finding the antitrust-agent and the M&A special-topics checklist (`checklists/ma-special-topics-checklist.yaml`, items ma-01 through ma-03) are built to process, and no synthetic case would produce a realistic remedies package.
4. **Sufficient public disclosure to build a working case file**: deal structure, price, market-share findings, and remedies are all publicly reported.

### Deal Facts (from public sources)

| Field | Value |
|---|---|
| Acquirer | HD Hyundai (HD한국조선해양, HD Korea Shipbuilding & Offshore Engineering) |
| Target | STX Heavy Industries (STX중공업) |
| Stake acquired | 35.05% |
| Deal value | KRW 81.3 billion (813억원) |
| Regulatory decision | Korea Fair Trade Commission (공정거래위원회), conditional approval, decided 2024-07-15 |
| Market impact found | Combined entity reaches ~80% of the domestic marine-engine-parts (crankshaft) market and ~70% of the marine engine market |
| Remedies (3-year behavioral) | No refusal to supply crankshafts to competing engine makers (Hanwha Engine, STX Engine); minimum volume guarantee; price-increase cap; no delivery delay |
| Remedy target | KMCS (a crankshaft producer that becomes an HD Hyundai affiliate through the deal) |
| Cited precedent in the FTC's own reasoning | The 2018 case where Hanwha Engine (then HSD Engine) shifted its crankshaft sourcing from 100% Doosan Enerbility to an 80/20 Doosan/KMCS split — used by the FTC as evidence of switching risk |

### How This Maps to the co-newbiz Procedures

| Checklist / Framework | What this case exercises |
|---|---|
| `checklists/ma-special-topics-checklist.yaml` items ma-01/ma-02/ma-03 (antitrust, HHI, gun-jumping) | Real HHI-relevant market-share figures (80%/70%) and a real conditional-approval remedy package to check the checklist against |
| `docs/rag-framework.md` §3 (data confidence / Regulatory-Permit dimension) | A live example of how a Regulatory/Permit-dimension finding (conditional approval with behavioral remedies) should be graded — this deal would plausibly land at Amber on that dimension even with strong financials, exercising the "no averaging" rule |
| `docs/value-chain-linkage.md` *(forward reference, not yet written)* | The crankshaft supply concentration (HD Hyundai Heavy Industries, KMCS, Doosan Enerbility — only three domestic producers) is a real vertical-integration-pressure case study |
| `procedures/_shared/brownfield-screening` | Can be run against this deal's actual disclosed timeline and structure |

### Complementary Candidate (Secondary): Hanwha Impact's Acquisition of HSD Engine → Hanwha Engine (2023–2024)

Found during the same research pass — also real, also in the identical industry, and directly referenced *inside* the STX Heavy Industries case above (as the entity whose crankshaft supply security the FTC's remedies were designed to protect). Could be run as a second pilot deal later to test the **Green IC → Group IC** two-tier flow with two co-existing real cases, or used to backfill the "before" state (Hanwha Engine's 2018 supply-mix shift) that the STX Heavy Industries case's regulatory reasoning cites.

| Field | Value |
|---|---|
| Acquirer | Hanwha Impact (한화임팩트) |
| Target | HSD Engine (renamed Hanwha Engine on completion) |
| Stake acquired | 32.77% |
| Deal value | KRW 226.9 billion (2,269억원) |
| Completion | 2024-02-28 |
| Post-acquisition performance (public) | 9-month cumulative operating profit of KRW 82.7 billion vs. full-year 2023 operating profit of KRW 8.7 billion pre-acquisition (>9x) |

## Additional Candidates (2026-08-20) — Sourced to Address Two Specific Gaps

Pilots 001/002 (both crankshaft/marine-engine, Korea) validated the antitrust-screening path twice but could not test **Group IC ranking across sibling subsidiaries** (ADR-0029 — the two deals' acquirers are different corporate groups, not comparable) or exercise the **Pre-FS/FS/Entity-IC gates**, since neither deal had enough public paper trail on valuation/deliberation to fill those gates in. This round of research deliberately looked outside shipbuilding for cases with richer intra-group and valuation-dispute disclosure.

### Candidate A (Recommended): Doosan Bobcat / Doosan Robotics Comprehensive Share Exchange (2024)

**Why this is the strongest fit for the two open gaps:**

1. **Intra-group governance, not cross-group M&A** — Doosan Group proposed spinning off Doosan Bobcat (a profitable subsidiary) from Doosan Enerbility and merging it into Doosan Robotics (a loss-making subsidiary), making Bobcat a subsidiary of Robotics. This is exactly the design's "group vs. entity" distinction in action: a transaction between **sibling entities of the same group**, which the design's `group-review-agent` (portfolio fit, intra-group transaction compliance) is built to scrutinize — not comparable to pilots 001/002's cross-group acquisitions.
2. **Extensive real Pre-FS/FS/Entity-IC-equivalent paper trail** — unlike pilots 001/002 (regulatory-approval press coverage only), this case has: a disclosed exchange ratio (100 Bobcat shares : 63 Robotics shares initially), a regulator (Financial Supervisory Service) **rejecting the securities filing twice** over valuation-methodology transparency, a **board withdrawal** (2024-08-29, 49 days after announcement), a **revised ratio** re-proposed two months later (100:88.5 Enerbility + 4.3 Robotics, up from 100:88.5+3.2), and an activist shareholder (Align Partners) campaign with formal shareholder letters demanding specific board-composition and capital-return commitments. This is real content for exactly the gates pilots 001/002 couldn't reach.
3. **Real minority-shareholder-protection and valuation-fairness dispute** — directly exercises what a human Entity IC reviewer is supposed to catch: a swap ratio that undervalues the more profitable entity relative to the less profitable one. `docs/manuals/business-manual.md` §3's instruction that a reviewer must "correct the AI-proposed RAG grade with a reason if you correct it" has a real, checkable test case here.
4. **Real regulatory back-and-forth to test revision cycles against** — two filing rejections plus a full withdrawal-and-restart is a genuine test of how the procedure should handle a deal that fails a gate and comes back, not just a single clean pass.

**Caveat**: as of the last confirmed public reporting, the restructuring was **suspended following the December 2024 martial-law situation** (계엄 사태) and a planned extraordinary shareholder meeting was cancelled — the case's real-world outcome is unresolved/paused, not closed. This pilot would test the process up through the suspension point, not a completed cycle — itself a realistic scenario (real reviews do stall) worth exercising.

### Candidate B: SK Group Cross-Subsidiary Capital Rebalancing (2023-2025)

**Why this fits the literal ADR-0029 ranking scenario better, but with less procedural granularity:**

SK Group's semiconductor arm (SK hynix) swung from a KRW 7.73 trillion operating loss (2023) to KRW 23.5 trillion (2024) and KRW 47.2 trillion (2025) operating profit on the AI/HBM memory boom, while battery (SK On) and chemical/construction subsidiaries remained financially stressed. The group responded with cross-subsidiary capital reallocation: SK Innovation merged with SK E&S (cash-generative), SK On absorbed SK Enmove/Trading International/Entium, and SK Ecoplant received SK Materials Air Plus and SK Enscore — a real example of a group **prioritizing capital toward weaker subsidiaries using a stronger subsidiary's cash flow**, which is close to the design's "capital allocation priority" description of Group IC's job.

**Weaker fit than Candidate A**: public reporting covers the *what* (which entities merged/absorbed what) and the *why* (rebalancing away from battery/chemical weakness) at a strategic-narrative level, but not gate-level deliverables (no disclosed valuation dispute, no regulator rejection, no board withdrawal) — less useful for filling the Pre-FS/FS/Entity-IC procedural gap than Candidate A, though it is the more literal "capital competing across sibling businesses" scenario per ADR-0029's own description.

## Recommendation for Pilot 003

**Use Candidate A (Doosan Bobcat / Doosan Robotics)** as pilot 003 — it directly exercises intra-group governance (the design's `group-review-agent` scope) and, more importantly, is the only candidate found so far with a real public paper trail dense enough to walk through Pre-FS/FS/Entity-IC-equivalent content, which is exactly the procedural gap (F-3/F-5) both prior pilots flagged. Hold Candidate B (SK Group rebalancing) in reserve — it is the more literal match for ADR-0029's "capital competing across sibling businesses" description and could become pilot 004 if a ranking exercise specifically (rather than intra-group fairness/governance) is wanted next.

## Recommendation (Original — Pilots 001/002)

Use **HD Hyundai / STX Heavy Industries** as the primary Stage 3.5 pilot case — it is the stronger fit specifically because of the real antitrust remedy outcome, which a synthetic case cannot produce credibly. Hold the Hanwha Impact / HSD Engine deal in reserve as a secondary case if a two-deal group-ranking exercise (ADR-0029) is wanted later.

**This is a recommendation, not a locked decision** — confirm before the pilot procedure (`procedures/_shared/brownfield-screening`) is actually run against it, since running the pilot means treating this as the team's working case file going forward.

## Sources

- [M&A 모범 사례 된 HD현대마린엔진·한화엔진···올해도 순항 예고 — 시사저널e](https://www.sisajournal-e.com/news/articleView.html?idxno=418673)
- [HSD엔진, 한화엔진으로 새출발… 한화, 인수 완료 — 경남신문](https://www.knnews.co.kr/news/articleView.php?idxno=1426706)
- [한화, 대우조선 이어 'HSD엔진 인수' 왜? — 경남도민일보](https://www.idomin.com/news/articleView.html?idxno=817935)
- [한화임팩트의 HSD엔진 인수 추진 — 인베스트조선](https://www.investchosun.com/site/data/html_dir/2023/02/20/2023022080199.html)
- [한화엔진 출범, 토탈 선박 건조 솔루션 완성 — 한화그룹](https://www.hanwha.co.kr/newsroom/media_center/news/news_view.do?seq=13328)
- [공정위 'STX중공업 조건부 승인'에 HD현대 주가 반응 — 뉴스투데이](https://www.news2day.co.kr/article/20240716500117)
- [HD현대, STX중공업 인수 완료 — 딜사이트](https://dealsite.co.kr/articles/125405)
- [HD현대 STX중공업 인수 '조건부 승인'…"한화엔진 부품 공급 거절 안 돼" — 오피니언뉴스](https://www.opinionnews.co.kr/news/articleView.html?idxno=101923)
- [HD한국조선해양, STX중공업 인수 조건부승인…3년간 가격인상제한 등 준수해야 — 뉴스핌](https://www.newspim.com/news/view/20240715000438)
- [HD한국조선해양-STX중공업 기업결합 '조건부 승인' — 경향신문](https://www.khan.co.kr/article/202407151350001)
- [공정위, HD한국조선해양, STX 중공업 인수 '3년 조건부' 승인 — 한국일보](https://www.hankookilbo.com/News/Read/A2024071514260001235)
- [韓 크랭크샤프트, 세계 시장 51% 점유 — 한국해운신문](http://www.maritimepress.co.kr/news/articleView.html?idxno=41619)

### Candidate A/B sources (2026-08-20 addendum)

- [얼라인파트너스 "두산밥캣 포괄적 주식교환, 재검토 아닌 영구포기해야" — 뉴스1](https://www.news1.kr/finance/general-stock/5578739)
- [얼라인파트너스, 두산밥캣에 주주서한…"로보틱스와 포괄적 주식교환 재추진 포기 공표해야" — 한국금융신문](https://www.fntimes.com/html/view.php?ud=202410201726534258179ad43907_18)
- [두산, 로보틱스·밥캣 합병비율 재조정… 얼라인 공격 막아낼까 — 서울신문](https://www.seoul.co.kr/news/plan/2024/10/22/20241022020001)
- [두산 밥캣·로보틱스 주식교환 철회… 일반주주들 "꼼수 우회 합병" 반발 — 서울신문](https://www2.seoul.co.kr/news/economy/industry/2024/08/30/20240830016005)
- [두산밥캣-두산로보틱스 불공정 합병 논란 — 나무위키](https://namu.wiki/w/%EB%91%90%EC%82%B0%EB%B0%A5%EC%BA%A3-%EB%91%90%EC%82%B0%EB%A1%9C%EB%B3%B4%ED%8B%B1%EC%8A%A4%20%EB%B6%88%EA%B3%B5%EC%A0%95%20%ED%95%A9%EB%B3%91%20%EB%85%BC%EB%9E%80)
- [Doosan scraps controversial Robotics-Bobcat merger plan — The Korea Herald](https://m.koreaherald.com/article/3463890)
- [Doosan to resume Bobcat, Robotics merger with new ratio — KED Global](https://www.kedglobal.com/corporate-restructuring/newsView/ked202410210006)
- [Doosan Robotics, Bobcat stock swap called off in face of fierce opposition — Korea JoongAng Daily](https://www.koreajoongangdaily.com/business/doosan-robotics-bobcat-stock-swap-called-off-in-face-of-fierce-opposition/12417371)
- [Restructurings in Korea test the limits of CG reform — ACGA](https://www.acga-asia.org/blog-detail.php?id=89)
- [반도체로 흥한 SK, 쌈짓돈 모아 계열사 밸류업 — 아시아타임](https://www.asiatime.co.kr/article/20260507500316)
- [SK그룹, 반도체 수혜 제한...'배터리·화학' 회복 열쇠 — 블로터](https://www.bloter.net/news/articleView.html?idxno=661048)
- [\[SK 리밸런싱 그 후\] 반도체 호황 '에너지·화학' 수익성 개선 과제 — 블로터](https://www.bloter.net/news/articleView.html?idxno=661503)
