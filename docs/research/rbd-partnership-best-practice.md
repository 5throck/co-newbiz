---
lang: en
---

> Provenance: researched by the rbd-research2 agent, 2026-08-23 (direct WebFetch of ~15 canonical URLs — NASA, EC Horizon annex, GAO, Stage-Gate Institute, ASAP, NVCA, NIH techtransfer; search backend rate-limited, resets 2026-09-01; 22 sources). Committed copy of .git/research/rbd-partnership-best-practice.md for ADR-0052 citation; the untracked original is the working input.

# Research Report: R&BD Stage-Gating, Partner Sourcing & Due Diligence, and Technology Deal Governance

> **Provenance:** Agent `rbd-research2` (R&BD research agent, dispatched by team-lead) · Date 2026-08-23 · Method: direct WebFetch of ~15 canonical URLs (NASA, EC Horizon annex, GAO, Stage-Gate Institute, ASAP, NVCA, NIH techtransfer, Wikipedia) — the Z.ai search backend (built-in WebSearch + web-reader MCP) returned `-429 Weekly/Monthly Limit Exhausted` for every query this session (resets 2026-09-01). All URLs in the Sources list were actually retrieved and summarized during this session. Claims not traceable to a fetched URL are marked [practice] — widely documented industry practice, safe for checklists but not attributable to a single fetched source. File lives in `.git/research/` (untracked by design; never `git add`).

---

## Area 1 — R&BD Stage-Gate: Gating Technology Ventures Differently from Commercial Ones

### 1.1 Core finding: two-track gating

Cooper's Stage-Gate Institute explicitly prescribes **a simplified 2–3 gate research/"technology derisking" model that precedes the classic 5-stage, 5-gate new-product process** for research-focused, discovery-type projects — plus tailored process variants (process development, services, develop-to-order) so that portfolio variety is not over-managed with one rigid pipeline (stage-gate.com, 5th Generation Stage-Gate page). The 5th-generation model adds: evolving (not frozen) product definition, parallel/overlapping stages progressing on "sufficiently reliable" information, and agile-sprint execution inside a gated superstructure ("agility with discipline"). Implication for our system: the R&BD track should have its own front-end gates with technical (TRL/MRL) evidence, joining the commercial track only at the business-case gate.

- Technology ventures enter a dedicated front-end (research/derisking) pipeline, not the commercial 5-gate pipeline, until the business-case gate is passed. [stage-gate.com]
- Gate decision types at every gate: Go / Kill / Hold / Recycle — a Hold decision is expected behavior for tech bets whose evidence is immature. [practice, Cooper's model family]
- Front-end gates demand technical-readiness evidence; commercial gates demand market/business evidence; the transition gate demands both.

### 1.2 Readiness scales as gate criteria (verbatim level evidence)

**TRL (EU Horizon 2020/Europe definitions, General Annexes G-A)** — the contract-grade scale for gate criteria:

| TRL | EU definition (verbatim) |
|---|---|
| 1 | Basic principles observed |
| 2 | Technology concept formulated |
| 3 | Experimental proof of concept |
| 4 | Technology validated in lab |
| 5 | Technology validated in relevant environment (industrially relevant environment in the case of key enabling technologies) |
| 6 | Technology demonstrated in relevant environment (industrially relevant environment for KETs) |
| 7 | System prototype demonstration in operational environment |
| 8 | System complete and qualified |
| 9 | Actual system proven in operational environment (competitive production for KETs) |

NASA's scale is equivalent in numbering; NASA TRL 7 requires prototype demonstration in the (space/operational) environment, TRL 8 = flight-qualified through test, TRL 9 = flight-proven through operations (nasa.gov). TRL was created at NASA (Sadin, 1989 formalization), adopted by DoD (2000s) and the EC (2010/Horizon 2020), and codified as **ISO 16290:2013** (space systems) — a citable international standard anchor (Wikipedia TRL, summarizing primary sources).

**MRL (DoD Manufacturing Readiness Levels, 1–10)** — the companion scale our gates should demand whenever the venture involves making things:

| MRL | Definition (condensed, verbatim where quoted) |
|---|---|
| 1 | Basic manufacturing implications identified |
| 2 | Manufacturing concepts identified |
| 3 | Manufacturing proof of concept developed |
| 4 | Capability to produce the technology in a laboratory environment |
| 5 | Capability to produce prototype components in a production relevant environment |
| 6 | Capability to produce a prototype system or subsystem in a production relevant environment |
| 7 | Capability to produce systems/subsystems/components in a production representative environment |
| 8 | Pilot line capability demonstrated; ready to begin low-rate production |
| 9 | Low-rate production demonstrated; capability in place to begin full-rate production |
| 10 | Full-rate production demonstrated; lean production practices in place |

MRL is deliberately numbered "roughly congruent with comparable levels of TRL," and maps to acquisition decision points: MRL 4–5 spans Milestone A→B (technology maturation), MRL 6–7 spans post-CDR→Milestone C (EMD), MRL 8–9 gates full-rate production (Wikipedia MRL, after DoD deskbook). Companion scales to consider citing: IRL (Integration Readiness Level), CRL (Commercial Readiness Level).

### 1.3 Per-gate table: gate → evidence demanded → typical kill condition

| # | Gate name (recommended) | Readiness demanded | Evidence demanded at the gate | Typical kill condition |
|---|---|---|---|---|
| G0 | Discovery screen (ideation) | TRL 1–2 | Peer-reviewed scientific basis; link of the technology to a technology-roadmap need; preliminary prior-art/FTO screen; strategic-fit statement | No plausible path from principle to a business-model application; no roadmap pull; prior-art landscape blocks the field |
| G1 | Technology concept gate | TRL 2 (concept formulated) | Technology concept memo; critical-function-and-assumptions list; POC experiment protocol; rough cost/performance envelope | Concept not credible against state of the art; critical function unidentified |
| G2 | Proof-of-concept gate | TRL 3 (experimental proof of concept) | POC results demonstrating the critical function analytically and experimentally; reproducibility notes | Critical function fails in experiment (technical feasibility wall); performance gap unbridgeable within stage budget |
| G3 | Technology validation gate | TRL 4–5 (lab validation → relevant environment); MRL 4–5 | Integrated component/subsystem test data; relevant-environment validation plan and first results; legal FTO opinion; patent-filing strategy; updated cost model | FTO failure (blocking third-party IP); components cannot be integrated; unit-cost model exceeds value ceiling |
| G4 | Business-case gate (transition: R&BD → commercial track) | TRL 5–6 (demonstrated in relevant environment); MRL 5–6 | Full business case: market evidence and value proposition; make/buy/partner decision; partner shortlist or sourcing plan; real-options valuation; staged funding request for the next stage only | No viable business model at any plausible cost point; no partner or co-funding source willing to cross the Valley of Death; option value below stage premium |
| G5 | Development exit gate (pre-launch) | TRL 7–8 (prototype in operational environment; system complete and qualified); MRL 7–8 | Operational-environment demonstration results; pilot-line capability evidence; regulatory/subsidy pathway cleared; launch/rollout plan; supply-chain readiness | Manufacturability failure at pilot scale; regulatory rejection; co-funding program withdrawal; launch economics below threshold |
| G6 | Launch & scale review | TRL 9 (proven in operations); MRL 9–10 | Field/operations data; initial sales or adoption; rate-production cost; scale/harvest/license-out recommendation | Commercial traction below floor after fixed observation window — disposition is license-out/spin-out, not necessarily kill |

Kill-condition sources: technical feasibility wall = TRL gate failure at G2/G3 (NASA/EU definitions); FTO failure = G3 legal opinion [practice]; co-funding withdrawal = KIAT-type government co-funding exit (Area 4) [practice]; **Valley of Death = TRL 5–7 gap** where "many technologies fail due to the need for significant industry investment while challenges remain unresolved" (Wikipedia TRL, and GAO TRA Guide's premise that immature technologies cause program delay/cost growth).

### 1.4 Evidence quality rules (GAO TRA Guide, GAO-20-48G)

A TRL claim is only gate-grade if the assessment demonstrates **credibility, objectivity, reliability, and usefulness**, and evaluates both "the level of maturity of a technology and how this maturity has been demonstrated." Checklist lines:

- Every TRL/MRL claim at a gate is supported by named tests, test environments, and data artifacts, not vendor or researcher assertion.
- TRL assessments for gate decisions are reviewed by an independent reviewer or review team not reporting to the project champion.
- The assessment records how maturity was demonstrated (which experiment, which environment), not only the level claimed.
- Gate records note known limitations of readiness scales: TRL ignores obsolescence risk and does not equal appropriateness in a specific system context (Wikipedia TRL criticisms).

### 1.5 Valuing early-stage bets and staged funding (real options)

- Treat each stage approval as the exercise of a sequential (compound) option: the stage budget is the option premium; the next gate is the exercise decision (Wikipedia Real option; Myers coined the term 1977; Luehrman's HBR popularization).
- A negative static NPV does not by itself justify killing an early technology bet when expansion/staging options carry positive value — the documented staged-investment example shows a −0.5M standalone NPV turning +0.41M with a properly valued expansion option (Wikipedia Real option).
- Options logic suits technology ventures precisely because uncertainty is high, information arrives between gates, and management flexibility is real.
- Kill discipline remains: if the option's expected value is below the next stage premium even under favorable scenarios, kill at the gate rather than hold.
- Portfolio-level: gate decisions feed portfolio reviews that allocate resources across programs and balance aggregate risk (stage-gate.com Portfolio Governance page).

### 1.6 Deliverables and role ownership (Area 1)

| Gate | Primary deliverable | Owner (proposer) | Reviewer/gatekeeper |
|---|---|---|---|
| G0–G1 | Discovery brief, concept memo | Research lead / R&BD owner | Research director + strategy rep |
| G2 | POC report + reproducibility annex | Principal investigator | Independent technical review team (GAO model) |
| G3 | Validation dossier + FTO opinion + IP strategy | CTO office + IP counsel | Technical review team + legal |
| G4 | Business case (incl. make/buy/partner, real-options valuation, funding tranche request) | New-business PM | Cross-functional gatekeeper board (Cooper model: senior, cross-functional, empowered to kill) |
| G5 | Readiness dossier (TRL 7–8 + MRL 7–8 evidence), regulatory status, launch plan | Development lead | Gatekeeper board + QA/regulatory |
| G6 | Post-launch review + disposition (scale / harvest / license-out) | Business owner | Executive sponsor |

---

## Area 2 — Partner Sourcing & Alliance Due Diligence

### 2.1 Canonical lifecycle: ASAP Alliance Life Cycle (7 phases, verbatim names)

Source: strategic-alliances.org/alliance-lifecycle (ASAP — Association of Strategic Alliance Professionals; note the pattern for dispatch points in our procedures):

1. **Alliance-Specific Strategy** — alliance manager facilitates strategy with senior management; ensure systems/processes support the strategy.
2. **Analysis and Selection** — "define potential partners using tools and best practices to gather data"; selection criteria include **financial data and measures of strategic, operational, and cultural fit**.
3. **Building Trust and Value-Creating Negotiations** — trust is "cocreated"; alliance managers "review term sheets and contracts" to keep obligations "reasonably executable."
4. **Operational Planning** — surface operational issues; operational business plan as a "pilot project" testing prior-phase assumptions.
5. **Alliance Structuring and Governance** — governance, organizational, legal frameworks plus a "risk-and-reward formula that motivates both parties."
6. **Launching and Managing** — without an "energized, successful kickoff and follow-up launch plan, many alliances will fail."
7. **Transform, Innovate, or Exit Gracefully** — renew, adapt/transform, or dissolve amicably.

Supporting ASAP assets: the ASAP Handbook of Alliance Management (4th ed., written by 40+ practitioners; 5th ed. due Sept 2026; covers alliance strategy, governance, value creation, relationship management); the I-SAMM (Integrated System of Alliance Management Model) competency framework with risk management and cross-enterprise decision-making as named competencies.

**ISO layer:** ISO 44000 (12 principles of collaborative working), **ISO 44001:2017** (management-system requirements for collaborative business relationships), 44002 (implementation), 44003 (SMEs), 44004 (large-small collaboration), with emerging 44005 (leadership), **44006 (university-business collaboration)**, 44007/44008 (ecosystems/SDG collaborations); ASAP is the US TC286 voting member (strategic-alliances.org/iso-standard). Use ISO 44001 as the maturity bar for "alliance readiness."

### 2.2 Partner selection criteria (gate-grade checklist)

- Strategic fit: the partner closes a capability gap named in the technology roadmap; the alliance maps to a defined strategy (ASAP Phase 1–2).
- Complementarity: partner assets/technologies complement rather than duplicate ours (goal: joint value creation, not arbitrage).
- Technical capability: demonstrated TRL-relevant evidence at the level our next gate demands (apply Area 1 evidence rules to the partner's claims).
- Operational fit: compatible processes, capacity, and geographic/regulatory coverage to execute the operational plan (ASAP Phase 4 assumptions).
- Cultural fit: assessed explicitly, not assumed (ASAP names cultural fit as a selection measure).
- Financial health: financial data reviewed as a screening measure (ASAP Phase 2); partner must survive the alliance's full horizon including exit tail.
- Alliance track record: prior alliances of the partner — formation rate, survival, disputes — via referencing.
- Readiness: both parties' internal alliance capability (dedicated alliance function, executive sponsorship) — ISO 44001 management-system maturity.

### 2.3 Partner due diligence: workstreams and how they differ from M&A target DD

| Workstream | Partner-DD focus | Contrast with M&A target DD |
|---|---|---|
| Legal/title | Verify the partner actually owns or controls the IP/capability it brings; chain of title, liens, exclusivity conflicts | M&A does exhaustive full-entity legal DD (all liabilities, litigation, tax) — partner-DD scopes to collaboration-relevant assets only |
| Technical | Deep: validate claimed TRL/MRL with test evidence; assess integration risk; assess R&D process maturity | M&A technical DD is shallower — the asset is bought wholesale |
| Collaboration capability | Deep and distinctive: alliance history, joint-governance experience, decision speed, dedicated alliance staff, prior partner references | Not an M&A category at all |
| Financial | Sufficient health over the alliance horizon; funding for its share of workpackages | M&A does full valuation, quality of earnings, debt |
| Commercial | Channel/market overlap conflicts; customer channel conflicts; competition-law exposure of the combination | M&A does full market/antitrust merger analysis |
| Cultural | Decision culture, IP-sharing culture, escalation norms | M&A cultural DD centers on post-merger integration |
| Exit/reversibility | Who keeps what on failure; step-in and license-back paths | M&A exit is divestiture of an owned entity |

[practice, grounded in ASAP Phase 2–5 and ISO 44001 scope; delta framing vs M&A is synthesized practice]

### 2.4 Referencing and readiness

- Reference at least two of the prospective partner's other alliance partners before signing; ask about decision speed, dispute behavior, and whether promises survived leadership change. [practice]
- Alliance-readiness assessment = checklist of internal prerequisites: named alliance owner, executive sponsor, negotiation mandate, JSC design prepared, integration/resources budgeted, alliance KPIs defined. [ASAP Phases 1/4/5, practice]
- Internal gate before external term sheet: confirm we can execute the obligations we are about to negotiate (ASAP Phase 3's "reasonably executable" standard).

### 2.5 Term sheet essentials for partnerships (negotiation-stage checklist)

- Scope and exclusivity (field, territory, duration) and anti-shelving performance obligations tied to milestones.
- Governance: steering committee composition, reserved matters, escalation ladder, deadlock resolution.
- IP: background IP definitions, foreground IP ownership/licensing, improvements/grantback, prosecution cost allocation.
- Risk-and-reward formula that motivates both parties (ASAP Phase 5 verbatim requirement).
- Exit: termination triggers, wind-down, survival of licenses, step-in rights.
- Alliance-manager review of the term sheet for executability before signature (ASAP Phase 3).

### 2.6 Partner-DD report: standard contents (deliverable spec)

- Executive summary with go/no-go recommendation and conditions.
- Partner profile: ownership, financials, organization, key people, stability over alliance horizon.
- Strategic-fit analysis (roadmap gap closure) and alternative-partner comparison.
- Technical capability assessment with TRL/MRL evidence table and integration risk register.
- Legal/IP: ownership chain of contributed IP, FTO, liens/licenses that conflict with our exclusivity, litigation.
- Alliance-capability assessment: history, dedicated function, governance experience, referencing results.
- Cultural/operational fit findings with evidence.
- Risk register with mitigations; deal-shape recommendation (license / co-development / minority / JV per Area 3) and negotiation levers.

---

## Area 3 — Licensing-in / Co-development / Minority Investment / JV Deal Governance

### 3.1 License-in (exclusive vs non-exclusive) — pre-signing gate checklist

Grounded in NIH public-licensing practice (techtransfer.nih.gov/licensing) and standard commercial terms [practice]:

- Grant scope decided explicitly: exclusive / sole / co-exclusive / non-exclusive; if exclusive, justify against a public-interest-style test (NIH criteria for exclusive licenses: exclusivity serves the broader interest, provides incentives for risk capital, terms not overly broad, market competition preserved).
- Field-of-use and territory boundaries drawn to match our roadmap need — never broader than we can exploit (over-broad grants invite shelving disputes and reverse-royalty leakage).
- Sublicensing rights, sublicensing economics, and change-of-control assignment explicitly negotiated.
- Financial stack complete: upfront, development/regulatory milestones, sales milestones, royalties with a defined royalty base, minimum annual payments or minimum-exertion obligations.
- Development plan with dated benchmarks accepted into the agreement; annual progress reporting; license revocable for non-use/failure to develop (NIH's anti-shelving architecture: benchmarks, annual utilization reporting, revocation for non-use).
- Grantback of our improvements and license to licensor background IP needed for exploitation; audit rights on royalty reports; publication/confidentiality terms.
- Government strings identified: federally funded subject IP carries US-manufacture preference for exclusive US licenses and agency march-in rights (Bayh-Dole; no agency has ever marched in — pricing is not a march-in ground per NIH precedent).
- Title/chain verification completed before term sheet: inventor assignment trail (Stanford v. Roche: title vests in inventors absent assignment), patent status and term, FTO.

### 3.2 Co-development agreement — pre-signing gate checklist

- Background IP: precise definition per party; each party retains background; cross-licenses to background limited to exploitation of the collaboration output.
- Foreground IP: ownership rule chosen deliberately (joint ownership vs allocation by field/territory vs by inventing party) with consequences mapped per jurisdiction; sole improvements vs jointly-created works distinguished.
- Governance: joint steering committee with named decision rights, quorum, escalation ladder, deadlock resolution, change control.
- Funding: milestone-tranched budgets per party; in-kind contributions valued; failure-to-fund consequences.
- Publication and confidentiality review windows (CRADA-style review periods) — standard in public-institution collaborations (federal labs use CRADAs as the co-development vehicle; FLC T2 mechanisms).
- Public-partner provisions when applicable: government rights retained (nonexclusive government license, march-in), domestic-manufacture obligations.
- Exit and step-in: triggers (milestone failure, insolvency, supply failure, change of control); step-in scope (technology transfer, license to continue, access to data/facilities); survival of licenses post-termination; handover of data, regulatory documentation, and sublicenses; wind-down transition services.
- Antitrust/competition screening for the collaboration footprint; export-control screening.

### 3.3 Minority investment with strategic rights — rights package checklist

Grounded in NVCA model legal documents (nvca.org/model-legal-documents) — the industry-standard package:

- Board representation via Voting Agreement board-designation provisions (NVCA Voting Agreement, updated June 2026).
- Information rights: delivery of financial statements and budgets (NVCA Investors' Rights Agreement).
- Registration rights (demand/piggyback) and liquidity path expectations (IRA).
- ROFR on transfers and co-sale/tag-along on founder sales (NVCA Right of First Refusal and Co-Sale Agreement).
- Management Rights Letter for compliance-verified access to operations, facilities, and personnel (NVCA Management Rights Letter).
- Pro-rata/preemptive participation in future rounds to defend the stake (NVCA suite; tranche mechanisms exist for milestone-gated funding).
- Strategic overlays specific to corporate investment: technology access or license agreements priced separately from equity; exclusivity windows with sunset; KPI-linked information escalation; anti-competitive guardrails (no blocking of competitors beyond agreed field); standstill and information barriers; CFIUS/foreign-investment screening (NVCA publishes LPA CFIUS insert language).

### 3.4 JV deal-terms governance (formation mechanics covered elsewhere; what the pre-signing gate checks)

- Business plan with committed parent contributions (cash, IP, people) and value-sharing formula that motivates both parties (ASAP Phase 5 standard applied to JVs).
- Governance terms: board composition, reserved matters requiring both parents, deadlock ladder ending in exit mechanics.
- IP contribution licenses in/out of the JV; foreground ownership and post-JV licenses.
- Exit architecture at signing: put/call options, ROFR on the other parent's stake, drag/tag rights, buy-sell (shotgun) clauses, valuation mechanism.
- Competition/antitrust clearance strategy for the combination (JV-specific filings).
- Termination and wind-down: asset return, license survival, personnel, customer commitments.
[practice, ISO 44001/ASAP-grounded]

---

## Area 4 — Open Innovation / Corporate Venturing Sourcing Funnel

### 4.1 Funnel design (Chesbrough open innovation)

- Two directions: **outside-in** (buy/license/acquire external inventions; "sourcing" non-pecuniary vs "acquiring" pecuniary) and **inside-out** (unused internal inventions go outside via licensing, joint ventures, or spin-offs; "revealing" vs "selling"). (Wikipedia Open Innovation, after Chesbrough 2003, 2006.)
- Outside-in process stages: **scan/scout the external environment → acquire via partnership or licensing → integrate with internal capabilities.** Each is a procedure step and a dispatch point.
- Innovation is not just technology acquisition: open innovation couples it with changed use and management of IP and the business model — funnel exits must state which business model the acquired technology feeds.
- Drivers justifying the funnel (vs closed innovation): mobile skilled workers, VC availability, external paths to market for internal ideas, capable external suppliers.

### 4.2 Technology scouting process

- Technology scouting = identifying emerging technologies and channeling the information into the organization to support technology acquisition; sits at the intersection of competitive intelligence, technology forecasting, and corporate foresight; "an essential element of a modern technology management system" (Wikipedia Technology scouting, after Rohrbeck's ICT-industry research).
- Scout profile: lateral thinker, scientifically/technically knowledgeable, respected internally, cross-disciplinary, imaginative (scout-selection checklist).
- Modes: needs-driven (technology roadmap pull — scouts hunt for defined gap-closers) vs supply-driven (scout push — trend radars and opportunity briefs route unprompted findings to roadmap owners). [practice, consistent with the definition above]
- Scout deliverables (checklist): periodic scan reports; single-technology briefs (TRL estimate, IP landscape, application fit, acquisition path); trend/technology radar; partner or startup candidate long-list with sourcing-route recommendation per candidate (license / co-development / minority / JV / acquisition).
- Organizational placement options with named trade-offs: central scout unit, embedded in business units, or external consultant network (documented cases: Deutsche Telekom Labs, Novartis, Elf Aquitaine, Phonak). (Wikipedia Technology scouting)

### 4.3 University / research-institute collaboration governance

- Determine the funding fountain first: federally/government-funded inventions may carry statutory constraints (US Bayh-Dole: contractor may retain title, must disclose/elect/file; government keeps a nonexclusive paid-up license; march-in exists but has never been exercised; exclusive US licenses require substantially-US manufacture). Industry-sponsored research is NOT covered — ownership and license terms are freely negotiated in the contract. (Wikipedia Bayh–Dole Act.)
- Checklist for sponsored-research agreements: background IP schedules; foreground ownership (often university retains title, sponsor takes first-negotiation exclusive license option); option-to-license windows; publication rights with review delay; royalty and equity terms for spinout rights; student/postdoc IP and data clauses.
- US federal-lab co-development uses the CRADA vehicle with publication review and confidentiality as standard terms (FLC T2 mechanisms).
- Public model documents exist and should anchor term-sheet benchmarks: NVCA "TTO and VC Early-Stage Life-Science Term Sheet," "US-BOLT Life Science Sample License Agreement," and "Model University Climate Tech Licensing Term Sheet" (nvca.org). University-business collaboration also has a dedicated ISO track (ISO 44006, in development via TC286/ASAP).

### 4.4 Corporate venturing structures

- Corporate accelerator: fixed-term, cohort-based, objectives derive from the sponsoring company — strategic (stay close to emerging tech), investment (CVC funnel), innovation transfer. Known failure mode: startups over-focus on the sponsor's problems rather than external customers. Checklist: define KPI per objective type; decide equity terms vs free pilot access; build a graduation-to-deal path (Area 3 shapes). (Wikipedia Corporate Accelerator)
- Inside-out disposition: unused internal IP routes to license-out, spin-off, or sale — a standing disposition gate, not an afterthought. (Chesbrough outbound flow)

### 4.5 Korea-specific (co-funding / government programs) — with verification caveat

- **KIAT** (Korea Institute for Advancement of Technology): MOTIE-affiliated industrial-technology funding agency (~US$0.94B distributed in 2012; ~US$1B annual budget), formed in 2009 by merger of six bodies including the Korea Technology Transfer Center; Korea's National Contact Point for EUREKA pan-European R&D cooperation. Role: co-funding industrial R&D, technology transfer/commercialization infrastructure, international tech cooperation matchmaking. (Wikipedia KIAT.)
- **TIPS** (private-investment-led tech startup support program under the Ministry of SMEs and Startups, tips.or.kr): government R&D grants matched to private lead investors to pull VC-validated startups toward commercialization — **flag: primary site (tips.or.kr) was DNS-unreachable from this research network and the MSS English site does not describe it; verify against tips.or.kr / MSS primary sources before citing program mechanics as gate criteria.** [partially verified]
- **Tech-holding-company / technology special listing structures** (KONEX/KOSDAQ technology-special tracks): **not verifiable this session** (KONEX EN wiki page 404; search backend exhausted) — treat as unverified; re-run after 2026-09-01 or against KRX/KLRI primary sources.
- MSS English-site policy categories confirmed for orientation: "Tech Innovations," "Startups," "Venture Business" (mss.go.kr English).

---

## Sources (all URLs retrieved and summarized this session)

**Area 1**
1. NASA — Technology Readiness Level: https://www.nasa.gov/general/technology-readiness-level/
2. European Commission — Horizon 2020 General Annexes, Part G-A (TRL definitions): https://ec.europa.eu/research/participants/data/ref/h2020/other/wp/2018-2020/annexes/h2020-wp1820-annex-ga_en.pdf
3. Wikipedia — Technology readiness level (lineage, ISO 16290:2013, Valley of Death, companion scales): https://en.wikipedia.org/wiki/Technology_readiness_level
4. Wikipedia — Manufacturing Readiness Level (MRL 1–10, TRL congruence, Milestone A/B/C mapping): https://en.wikipedia.org/wiki/Manufacturing_Readiness_Level
5. GAO — Technology Readiness Assessment Guide (GAO-20-48G): https://www.gao.gov/products/gao-20-48g
6. Stage-Gate International — 5th Generation Stage-Gate Model: https://www.stage-gate.com/about/5th-generation-stage-gate-model/
7. Stage-Gate International — Portfolio Governance: https://www.stage-gate.com/solutions/programs/portfolio-governance/
8. Stage-Gate International — site overview: https://www.stage-gate.com/
9. Wikipedia — Real option (Myers 1977; Trigeorgis; staged/compound options; Luehrman HBR): https://en.wikipedia.org/wiki/Real_option

(Literature pointer, not fetched: Cooper, R.G., "Perspective: The Stage-Gate idea-to-launch process — update, what's new, and NexGen systems," Journal of Product Innovation Management, 2014.)

**Area 2**
10. ASAP — Alliance Life Cycle (7 phases): https://strategic-alliances.org/alliance-lifecycle
11. ASAP — ISO standard (ISO 44000/44001 family, TC286): https://strategic-alliances.org/iso-standard
12. ASAP — Handbook of Alliance Management: https://strategic-alliances.org/handbook
13. ASAP — Mastering Alliance Management (I-SAMM): https://strategic-alliances.org/mastering-alliance-management

**Area 3**
14. NVCA — Model Legal Documents (IRA, Voting Agreement, ROFR/Co-Sale, Management Rights Letter, university licensing term sheets): https://nvca.org/model-legal-documents/
15. NIH — Technology Transfer licensing (license types, benchmarks, revocation, exclusive-license test): https://www.techtransfer.nih.gov/licensing (redirect target of https://ott.nih.gov/)
16. Wikipedia — Bayh–Dole Act: https://en.wikipedia.org/wiki/Bayh%E2%80%93Dole_Act
17. Federal Laboratory Consortium — T2 Mechanisms (CRADA et al.): https://www.federallabs.org/references/t2-mechanisms

**Area 4**
18. Wikipedia — Open innovation (Chesbrough 2003/2006; inbound/outbound; scan-acquire-integrate): https://en.wikipedia.org/wiki/Open_innovation
19. Wikipedia — Technology scouting (Rohrbeck; scout profile; cases): https://en.wikipedia.org/wiki/Technology_scouting
20. Wikipedia — Corporate accelerator: https://en.wikipedia.org/wiki/Corporate_accelerator
21. Wikipedia — Korea Institute for Advancement of Technology: https://en.wikipedia.org/wiki/Korea_Institute_for_Advancement_of_Technology
22. Korea MSS — English site (policy categories): https://www.mss.go.kr/site/eng/main.do

**Known-blocked/unreachable this session** (documented for follow-up after 2026-09-01): WebSearch and web-reader backends (rate-limit −429); AUTM autm.net (403); ISO iso.org product pages (403); WIPO "Successful Technology Licensing" PDF (404 at both known URLs); tips.or.kr (DNS failure); Harvard Law corpgov search (JS-rendered, no results); KONEX EN wiki (404).

---

**Bottom-line design implications for our procedures:** (1) give the R&BD track its own 2–3 front-end gates keyed to TRL/MRL evidence that hand off to the commercial pipeline at the business-case gate (G4 table in §1.3); (2) insert partner-DD dispatch at ASAP Phase 2 with the report spec in §2.6; (3) key pre-signature deal gates to the shape-specific checklists in §3.1–3.4; (4) wire the scouting funnel (§4.1–4.2) so every sourced candidate arrives with a recommended deal shape and a route into the Area 2 pipeline.
