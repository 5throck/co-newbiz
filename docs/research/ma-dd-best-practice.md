> Provenance: researched by the ma-research agent, 2026-08-22 (18 web searches + 6 primary-source fetches; 62 sources). Committed copy of .git/research/ma-dd-best-practice.md for ADR-0051 citation; the untracked original is the working input.

# M&A Due Diligence Best-Practice Research Report (2026-08)

> Source: ma-research agent (18 web searches + 6 primary-source fetches, 62 sources cited).
> Received 2026-08-22. Input for the workflow-concretization docs-writer dispatch.
> Caveats from the researcher are reproduced verbatim at the end — treat exact KRW
> threshold figures and the Korean labor-doctrine summary as "verify before codifying".

Method: 18 web searches + 6 primary-source page fetches (Thomson Reuters Practical Law, datarooms.org, dealroom.net, Goodwin, userintuition.ai, Lee & Ko). Sources cited per section; full URL list at end. Checklist items are written as short imperatives with evidence expectations so they can be lifted verbatim into governance docs.

---

## Area 1 — Legal Due Diligence

### Standard workstreams (Thomson Reuters Practical Law DD guide; datarooms.org legal DD checklist)
Corporate standing & capitalization; material contracts & change-of-control; litigation/disputes; IP; employment & labor; regulatory compliance & permits; environmental; real estate; data protection/privacy; anti-bribery & sanctions; tax legal exposure.

### Checklist items by workstream

**Corporate standing & capitalization**
- Confirm good standing of the target and every subsidiary; obtain certificates of incorporation, bylaws, and board minutes for the last 3 years (TR guide requests "governing documents… and records of business such as minutes of board meetings").
- Reconstruct the cap table: authorized vs outstanding by class; list all options, warrants, convertibles, and their vesting/expiry.
- Identify equity-holder votes or consents required to approve the deal; list transfer restrictions, preemptive rights, ROFR/tag-along/drag-along (TR guide).
- Verify signing authority: state who can bind the target and each subsidiary.
- Map restrictions on borrowing, refinancing, and guarantees (TR guide).
- Identify anti-takeover defenses and any staggered board or poison pill (TR guide).

**Material contracts & change-of-control**
- List contracts with CoC/anti-assignment clauses triggered by the transaction; for each, record counterparty notice period, consent requirement, and termination/payment consequences (TR guide defines CoC rights as "consent, payment, or termination"; KMGS Law flags assignment/CoC/termination as the most consequential provisions).
- Rank customer and supplier contracts by revenue/cost; for each top-20 contract capture term, exclusivity, MFN, termination-for-convenience, and minimum-volume commitments.
- Identify contracts requiring consent to assign in an asset deal vs those that pass automatically in a share deal.
- Flag loan and security documents needing consent or refinancing at close.

**Litigation/disputes**
- List all pending/threatened litigation, arbitration, and regulatory investigations; for each, estimate exposure and adequacy of provisions.
- Search judgment liens, enforcement actions, and bankruptcy filings against the target and key subsidiaries.

**IP**
- Inventory all patents, trademarks, copyrights, domains, and trade secrets; verify the inventor-to-company assignment chain has no title gaps (Lumenci 10-step IP DD checklist; Martensen IP).
- Review inbound and outbound licenses: exclusivity, sublicensing, assignability and CoC triggers (SmartRoom IP DD guide; Lumenci).
- Search for security interests/encumbrances filed against IP; confirm maintenance/renewal fee compliance (Lumenci).
- Confirm every employee and contractor has executed IP assignment + confidentiality agreements (Lumenci).
- List ongoing or threatened IP disputes.

**Employment & labor**
- Collect executive agreements, equity plans, restrictive covenants, and contractor terms; test contractor misclassification exposure (datarooms.org).
- If unionized: obtain CBAs and check successorship clauses, grievance backlogs, CBA expiry vs deal timeline, strike risk (Horton PLLC; Axial).
- Quantify pension exposure: unfunded single-employer status and multiemployer withdrawal liability (USI Consulting buyer's checklist; Acquisition Stars on MPPAA).
- For asset deals: determine which jurisdiction's employment-succession regime applies (see Area 4 for TUPE/Korea).

**Regulatory compliance & permits**
- Inventory all business licenses and permits; for each, state whether it transfers automatically, requires consent, or must be re-issued in an asset deal.
- Determine merger-control filings: for Korea, KFTC notification is required when one party has assets/turnover ≥ KRW 300bn and the other ≥ KRW 30bn (worldwide, group-aggregated); foreign targets additionally need ≥ KRW 30bn Korean turnover for local nexus; a "killer acquisition" trigger applies to R&D-heavy targets (budget ≥ KRW 30bn) even without revenue (ICLG Korea 2026; Kim & Chang; Shin & Kim). Phase 1 review is 30 days, extendable (Lex Mundi Korea guide).
- Check sector-specific approvals (financial, telecom, defense, data-localization regimes).

**Environmental / real estate / data protection / anti-bribery / tax**
- Obtain environmental notices, prior site assessments, and contamination history (datarooms.org).
- Verify title/leasehold for owned and leased sites; check CoC clauses in leases (datarooms.org).
- Review privacy notices, breach/incident records, lawful basis for cross-border data transfers (datarooms.org).
- Test anti-bribery controls and sanctions screening of counterparties and beneficial owners (datarooms.org).
- Confirm tax filings are current; identify open audits and assessments (datarooms.org lists tax compliance failures among common red flags).

### Deliverables & format
- Rolling "due diligence summaries" (daily/weekly record of what was reviewed) culminating in a due diligence report with an executive summary of significant findings (TR guide).
- A red-flag DD report when severe issues surface; standard red flags: undisclosed litigation, IP ownership gaps, non-transferable CoC contracts, tax failures (datarooms.org).
- Findings register with RAG (red/amber/green) severity rating — red = deal-structural/remediation required, amber = warranty/indemnity protection, green = acceptable (Neotas DD report guide).
- Timing benchmark: 4–6 weeks for smaller private deals (datarooms.org).

### Owners
External M&A counsel or in-house legal lead owns the workstream; specialists embedded for IP, employment, real estate, tax, and local counsel; a junior lawyer coordinates and a paralegal maintains the DD index (TR guide).

---

## Area 2 — Market Due Diligence (buy side)

### What it is
Market DD is the market-facing subset of commercial DD (CDD): it validates market size, growth, and structure; CDD extends to the target's position within that market, customer relationships, and achievable growth (IMAA Institute; pe-primer). It is the buy side's independent test of the target's commercial attractiveness (Ansarada).

### Workstreams and checklist items
**Market size & growth triangulation**
- Triangulate TAM/SAM via at least two of: top-down industry data, bottom-up build (price × volume × customer counts), and demand-side/supply-side checks; require the methods to reconcile within a stated tolerance (Ducker Carlisle CDD case study).
- State market growth drivers and disruptors; test management's growth assumption against independent market forecasts.

**Competitive dynamics**
- Build the competitive set as described by customers, not management; capture win/loss dynamics ("chosen as best" vs "cheapest/first/already integrated") (userintuition CDD report guide).
- Estimate market shares and concentration; classify each competitor's pricing power.
- Rate the target's moat: proprietary data (strong) > integration depth (moderate) > brand/relationship (weak) > price (weakest) (userintuition).

**Customer due diligence**
- Run structured customer interviews with independently recruited samples spanning ARR/revenue tiers and verticals (benchmark: ~85 interviews across tiers; report prevalence patterns, e.g. "14 of 31 mid-market accounts said X") (userintuition; Martec Group on methodology).
- Compute customer concentration: top-10 customers as % of revenue; capture relationship depth and switching costs for the top accounts (Ellty CDD guide; userintuition).
- Analyze 2–3 years of churn/retention by segment; list leading churn indicators found: executive sponsor departure, budget reallocation discussions, active competitive evaluations, "adequate but not differentiated" verdicts, single-champion (non-multi-threaded) relationships (userintuition; Satrix; T4 Associates).
- Perform 80/20 revenue analysis to validate the investment thesis (Strategex).

**Demand sustainability & channels**
- Test whether expansion revenue is broad-based or concentrated in few accounts (userintuition red flag list).
- Map channel structure: distributors, pricing logic, customer mix from the data room (Investor Data Rooms CDD guide).

### Report format (25–40 pages; userintuition)
Executive summary & deal verdict; methodology/sample; thesis-by-thesis validation (validated/partially/invalidated); retention risk assessment; competitive positioning; growth thesis evidence; customer concentration; probability×impact risk matrix; recommended bid adjustments (base-case adjustments, downside scenario, earnout recommendations).

### How findings feed the deal
Retention-adjusted revenue models; dollar/multiple bid adjustments (e.g. "15% of ARR at elevated churn risk → cut Year-1 base case by 50% probability-weighted, structure $2M as retention earnout"); risks mapped to SPA provisions or first-100-day priorities (userintuition).

### Owners
External commercial DD advisor / sector consultant runs it in parallel with legal and financial DD (dealroom.net: "Commercial diligence: Sector consultant analysis"); deal team synthesizes into the investment memo.

---

## Area 3 — Financing & Deal Funding

### Where it sits
Debt financing negotiation runs as a concurrent workstream with final legal/financial/commercial DD (dealroom.net PE deal lifecycle, stage 9). The final binding bid must include committed debt-financing terms from the lead bank (dealroom, stage 11).

### Structure options (Goodwin, Oct 2025)
- Full equity backstop (strongest certainty: no financing contingency, minimal closing conditions).
- Debt/equity mix under commitment papers, with limited conditionality.
- Financing contingency in the SPA (rare, seller-disfavored).
- Reverse termination fee of typically 4–7% of enterprise value when the buyer retains debt-funding risk.

### Checklist items
- Decide the cash/debt/equity mix and tenor/amortization profile before final IC; attach the sources-and-uses table.
- Execute commitment papers: debt commitment letter + fee letter + (facility) term sheet and intercreditor terms (Practical Law Commitment Letter resource; SEC exhibit example).
- Negotiate limited ("certain funds"/SunGard) conditionality: funding conditioned only on (a) specified acquisition-agreement reps being true, (b) the acquisition closing substantially in accordance with the agreement, (c) delivery of closing certificates — no market-MAC out and no full rep bring-down (Cleary Gottlieb on SunGard/certain funds; Willkie Acquisition Finance USA; Stikeman on Canadian limited-conditionality letters).
- Mirror the financing CPs to the acquisition agreement's closing mechanics; lenders focus on CP, termination, and liability provisions (Lexology on debt commitment letters).
- Satisfy drawdown CPs: certified acquisition agreement, officer certificates, KYC (Practical Law, conditions precedent to each drawdown).
- Prepare a funds-flow memorandum showing every inflow/outflow, account, timing, and FX leg for closing day; in cross-border deals route funds to comply with foreign-exchange regulation across jurisdictions (Practical Law funds flow memorandum template; Lyndon Advisory worked example).
- Appoint escrow/paying agent; define escrow sizing against indemnity exposure (SRS Acquiom).
- Hedge FX exposure for cross-border consideration: forwards, options, deal-contingent FX (Axial; Agile Legal).

### Governance gate BEFORE final investment approval
- Certainty of funds must be evidenced before signing/exclusivity: proof of funds, equity commitment letter, debt commitment letters, and completed lender diligence (Glacier Lake Partners).
- The final IC package includes the finalized financing package and a complete risk register; final IC approval precedes the binding bid (dealroom stages 9–11; Street of Walls PE process).
- Sellers weigh the financing proposal as the clearest signal of deal certainty — contingencies shift risk to the seller and weaken bids (Goodwin).
- Recommended for our workflow: require in the IC checklist (i) executed equity commitment + debt commitment letters, (ii) sources & uses, (iii) covenant headroom / leverage analysis vs lender terms, (iv) funds-flow draft, (v) FX plan when currencies differ.

### Owners
CFO/treasury + deal team with a financing advisor; lender's counsel drafts commitment papers; buyer's counsel aligns SPA closing conditions with financing CPs; escrow/paying agent executes funds flow.

---

## Area 4 — HR Due Diligence & Post-Close Integration

### Workstreams and checklist items
**Key-person risk & retention**
- Identify key people and roles whose loss would damage operations or integration; map each to a retention action (MA Science).
- Budget stay/retention bonuses covering 12–24 months post-closing for critical talent (Soteria HR) — or at minimum tie a stay bonus to remaining ≥ 6 months post-close (IMAA).
- Prepare a Day-1 retention plan: pre-drafted retention offers, stay bonuses, and communication scripts for critical staff (Aura talent DD).

**Organization & leadership**
- Obtain org charts, management structure, headcount by function, and job descriptions (MergerIntegration.com 8-page HR DD checklist).
- Assess leadership bench: who is needed for the first 100 days vs who will exit.

**Labor relations & benefits**
- Review all CBAs and open grievances; check successorship clauses and CBA expiry (Horton PLLC; Axial).
- Quantify pension/benefits liabilities: unfunded status, multiemployer withdrawal liability, retiree medical (USI; Gibson Dunn).
- For EU targets: plan works council information & consultation, which can gate timing and structure (Gibson Dunn).

**Cross-border employment transfer rules**
- TUPE (UK; analogous EU Acquired Rights Directive regimes): employees transfer automatically on an asset/undertaking transfer — the transferee cannot pick which employees to take; terms carry over unchanged; transferor and transferee must inform and (where measures are envisaged) consult employee representatives (Acas; Practical Law TUPE inform & consult note; Lewis Silkin).
- Korea (no TUPE statute — judicial doctrine): in a qualifying business transfer (영업양도), employment relationships succeed automatically. Court criteria: the business function continues after transfer; employees perform substantially the same roles; operational/organizational identity is maintained. Leading precedent: Supreme Court decision 2000다8448 (Mar 29, 2002). Succession covers only employees working in the transferred business at transfer time; employees may refuse and resign. Share deals raise no succession issue because the employer entity is unchanged (The Korean Law Blog; Kang Nam labor firm; KOTRA rulings digest).

**Culture**
- Use a standardized instrument pre-close: OCAI or Cultural Values Assessment (M&A Council); Denison-model quantitative culture DD is the academic standard (Denison & Ko, "Cultural Due Diligence in Mergers and Acquisitions").
- Capture cultural distance on decision-making speed, risk appetite, and management style; feed into integration design.

**Day-1 / first-100-days plan**
- Day 1: payroll and benefits continuity, HR policy alignment, leadership communication to all staff (VisioneerIT; Fooda checklist; Teamland).
- First 100 days: culture diagnostics executed, retention plan live, integration governance with named workstream owners and cadence, HR systems integration (VisioneerIT; Phoenix Strategy Group; Auxo 100-day plan).

### Owners
CHRO or dedicated HR integration lead owns the workstream; HR DD advisors and employment counsel support diligence; culture assessment typically outsourced to a specialist.

---

## Cross-cutting: canonical stage map and where findings land

Stage sequence (dealroom.net PE lifecycle, applicable to corporate M&A):
1. NDA/CIM screening → 2. Initial DD + first IC (authorizes diligence spend + non-binding LOI with valuation range) → 3. Expanded DD: four concurrent workstreams — financial QoE (Big-4 accountant), commercial/market DD (sector consultant), legal DD (M&A law firm), debt financing negotiation (lenders) → 4. Preliminary IC → 5. Final DD (3–6 weeks; outputs: confirmed valuation, finalized financing package, complete risk register) → 6. Final IC approval → 7. Binding bid incl. committed debt terms → 8. SPA signing (reps/warranties, indemnification, escrow, working-capital adjustments, closing conditions) → 9. Closing (regulatory approvals, funds flow; 4–8 weeks post-signing) → post-close integration (100 days).

Which findings feed what:
- Market/CDD findings → valuation (retention-adjusted revenue, bid adjustments) and earnout structures (userintuition).
- Financial/QoE findings → purchase-price adjustment mechanics: working-capital true-up, net debt, locked-box leakage (FTI Consulting; Auxo).
- Legal DD red flags → SPA protections: specific indemnities for identified risks, escrow/holdback securing them, conditions precedent requiring pre-close remedy, warranty package with disclosure schedules (Leaders in Law SPA pitfalls; Plausity: "the ultimate output of PPA due diligence is the set of definitions and schedules in the SPA").
- HR DD findings → price (pension/liability quantification), SPA CPs (works council/TUPE consultation), and integration plan (retention, culture).
- Financing certainty → closing certainty: equity/debt commitment letters, limited conditionality, RTF sizing (Goodwin; Glacier Lake).
- Merger-control analysis → SPA CP (regulatory approval) and timeline; Korea phase 1 is 30 days extendable, with a voluntary-commitment track (since May 2024) that shortens KFTC review to 15-day deliberation / 20-day decision (Lee & Ko).

Korea-specific notes (keep as a sidebar, not the spine): KFTC thresholds KRW 300bn / 30bn + local-nexus and killer-acquisition triggers (above); 근로승계 doctrine (above); KFTC reviewed 590 business combinations in 2025 (KFTC official trends report).

---

## Sources

1. Thomson Reuters Practical Law — M&A DD guide: https://legal.thomsonreuters.com/blog/mergers-and-acquisitions-due-diligence-guide/
2. datarooms.org — Legal DD checklist: https://datarooms.org/vdr-blog/legal-due-diligence-checklist/
3. Neotas — How to write a DD report (RAG): https://www.neotas.com/due-diligence-report/
4. KMGS Law — legal DD acquiring a competitor: https://www.kmgslaw.com/articles/what-legal-due-diligence-is-needed-when-acquiring-a-competitor
5. Lumenci — IP DD 10-step checklist: https://lumenci.com/blogs/ip-due-diligence-importance-and-checklist-conducting-guide/
6. SmartRoom — IP DD guide: https://smartroom.com/blog/due-diligence/ip-due-diligence/
7. Martensen IP — IP DD in M&A: https://www.martensenip.com/blog/2026/august/ip-due-diligence-in-mergers-acquisitions-what-co/
8. Practical Law — IP in M&A toolkit: https://content.next.westlaw.com/practical-law/document/I6855e056fb0a11e398db8b09b4f043e0/
9. Horton PLLC — Employment law DD buyer's guide: https://hortonpllc.com/employment-law-due-diligence-a-buyers-guide-to-ma-transactions/
10. Axial — 6 crucial labor & employment DD areas: https://www.axial.net/forum/6-crucial-labor-employment-areas-for-buyer-due-diligence/
11. USI Consulting — retirement plan DD checklist: https://www.usicg.com/specialty-solutions/merger-acquisition-retirement-plan-support/ma-buyers-checklist-retirement-plan-due-diligence/
12. Gibson Dunn — labor & benefits issues in M&A: https://www.gibsondunn.com/top-labor-and-employee-benefits-issues-to-think-about-in-ma-deals/
13. Practical Law (CA) — Labor & employment DD checklist: https://ca.practicallaw.thomsonreuters.com/3-507-0920
14. Acquisition Stars — union CBA successorship: https://acquisitionstars.com/blog/union-cba-ma-successorship
15. IMAA Institute — commercial DD: https://imaa-institute.org/forums/topic/the-imporatnce-of-commercial-due-diligence-in-the-realm-of-specialized-diligence/
16. Ducker Carlisle — CDD case study: https://www.duckercarlisle.com/knowledge-center/case-studies/commercial-due-diligence-for-an-ma-transaction/
17. userintuition — CDD report structure: https://www.userintuition.ai/reference-guides/commercial-due-diligence-report-structure/
18. Ellty — CDD guide, red flags & metrics: https://www.ellty.com/blog/commercial-due-diligence
19. Martec Group — customer intelligence in CDD: https://martecgroup.com/customer-intelligence-as-part-of-commercial-due-diligence-cdd/
20. Satrix Solutions — voice-of-customer buy-side DD: https://www.satrixsolutions.com/blog/voice-of-customer-due-diligence/
21. T4 Associates — customer DD in PE: https://www.t4associates.com/insights/customer-due-diligence-in-private-equity
22. Strategex — customer DD: https://strategex.com/solutions/customer-due-diligence
23. Investor Data Rooms — CDD: https://investordatarooms.com/blog/commercial-due-diligence/
24. dealroom.net — PE deal lifecycle (stage map): https://dealroom.net/faq/private-equity-deal
25. Street of Walls — PE investment process / final IC: https://www.streetofwalls.com/finance-training-courses/private-equity-investment-process/
26. Goodwin — deal & financing certainty (RTF 4-7%, equity backstop): https://www.goodwinlaw.com/en/insights/publications/2025/10/insights-privateequity-deal-certainty-building-closing
27. Glacier Lake Partners — buyer financing risk / certainty of funds: https://glacierlakepartners.com/insights/buyer-financing-risk-capital-certainty-ma
28. Practical Law — Commitment letter: https://uk.practicallaw.thomsonreuters.com/4-570-3125
29. SEC — debt commitment letter exhibit: https://www.sec.gov/Archives/edgar/data/1006892/000119312512472390/d438799dex99b1.htm
30. Cleary Gottlieb — SunGard conditionality & certain funds: https://www.clearymawatch.com/2025/10/cross-border-acquisition-financing-navigating-sungard-conditionality-and-certain-funds-requirements/
31. Willkie — Acquisition Finance USA: https://www.willkie.com/-/media/files/publications/2023/2023-acquisition-finance---usa.pdf
32. Lexology — debt commitment letters in US acquisitions: https://www.lexology.com/library/detail.aspx?g=3b8145d5-8ab2-42d2-bb20-0d7855626537
33. Stikeman — limited conditionality commitment letters (Canada): https://stikeman.com/en-ca/kh/canadian-ma-law/the-rise-of-limited-conditionality-commitment-letters-in-canadian
34. Practical Law — CPs to each drawdown: https://content.next.westlaw.com/practical-law/document/I612f1b3bd57411e9adfea82903531a62/
35. Practical Law (CA) — funds flow memorandum: https://ca.practicallaw.thomsonreuters.com/w-035-6025
36. Lyndon Advisory — funds flow worked example: https://lyndonadvisory.com/blog/funds-flow-in-ma
37. SRS Acquiom — FX in M&A deals: https://www.srsacquiom.com/our-insights/fx-m-a-deal/
38. Agile Legal — FX risk in multinational M&A: https://www.agilelegal.com/business-law-news/5-ways-to-manage-fx-risk-in-multinational-m-a-deals
39. FTI Consulting — purchase price adjustments in SPAs: https://www.fticonsulting.com/insights/articles/strategic-use-purchase-price-adjustments-share-agreements
40. Leaders in Law — SPA negotiation pitfalls (DD → price/indemnity/CP): https://www.leaders-in-law.com/common-pitfalls-in-spa-negotiations/
41. Plausity — PPA due diligence → SPA schedules: https://plausity.com/en/news/purchase-price-adjustment-due-diligence
42. Auxo Capital — purchase price adjustment: https://auxocapitaladvisors.com/purchase-price-adjustment-m-a/
43. Soteria HR — HR DD checklist: https://soteriahr.com/hr-due-diligence-checklist/
44. MergerIntegration.com — HR integration checklist: https://www.mergerintegration.com/m-a-human-resources
45. IMAA — retention of key employees: https://imaa-institute.org/forums/topic/retention-of-key-employees/
46. Aura — talent DD in PE: https://blog.getaura.ai/talent-due-diligence-in-ma-private-equity
47. MA Science — identify key people/roles: https://www.mascience.com/plays/identify-key-people-and-roles-for-retention
48. datarooms.org — HR DD guide: https://datarooms.org/vdr-blog/hr-due-diligence/
49. Acas — TUPE advice: https://www.acas.org.uk/tupe/advice-for-employers-and-employees
50. Practical Law — TUPE inform & consult: https://uk.practicallaw.thomsonreuters.com/5-380-7945
51. Lewis Silkin — TUPE: https://www.lewissilkin.com/en/insights/2026/02/17/tupe
52. The Korean Law Blog — business transfers & employee rights: https://www.thekoreanlawblog.com/2018/10/employment-transfers-korea.html
53. Denison — Cultural Due Diligence in M&A (paper): http://denisonconsulting.com/wp-content/uploads/2019/05/culturalduediligence-denisonko.pdf
54. M&A Council — conducting culture DD (OCAI/CVA): https://www.macouncil.org/blog/2024/06/27/conducting-culture-due-diligence
55. VisioneerIT — 100-day PMI plan: https://www.visioneerit.com/blog/post-merger-integration-100-day-plan
56. Phoenix Strategy Group — post-merger culture checklist: https://phoenixstrategy.group/blog/post-merger-culture-integration-checklist
57. ICLG — Merger Control 2026, Korea: https://iclg.com/practice-areas/merger-control-laws-and-regulations/korea/
58. Lee & Ko — 2024 KFTC merger guideline changes: https://www.leeko.com/leenko/news/newsLetterView.do?lang=KR&newsletterNo=2102
59. Kim & Chang — amended merger control regulations: https://www.kimchang.com/en/insights/detail.kc?sch_section=4&idx=30466
60. Lex Mundi — Korea merger notification guide: https://www.lexmundi.com/guides/merger-notification-guide/jurisdictions/asia-pacific/korea-republic-of/
61. Cornerstone Research — East Asia merger control regimes: https://www.cornerstone.com/wp-content/uploads/2025/03/The-Fundamentals-of-East-Asia-Merger-Control-Regimes-China-Japan-South-Korea.pdf
62. KFTC — Merger Review Trends 2025: https://www.ftc.go.kr/eng/downloadBbsFile.do?atchmnflNo=52872

## Researcher caveats (verbatim)
(a) ICLG/Kim & Chang/Jipyong/Shin & Kim threshold numbers came via search snippets — ICLG blocked direct fetch, so treat exact KRW figures as "verify against current statute" when drafting the manual; the 300bn/30bn structure is corroborated by multiple firms. (b) userintuition and Ellty are vendor content, not Big-4 — used for report-format specifics because Big-4 CDD report templates are not public; the structure matches what sector consultants deliver per dealroom's lifecycle description. (c) Korean labor succession summary is doctrine-level; for the manual, have Korean counsel confirm current Supreme Court stance (the 2000다8448 precedent line remains the leading authority per the sources found).
