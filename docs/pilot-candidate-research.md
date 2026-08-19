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

## Recommendation

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
