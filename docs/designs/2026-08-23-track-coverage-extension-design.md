# Track Coverage Extension — Design (R&BD / Internal-Venture / JV / M&A Post-Close)

**Status**: Stage 0 — design of record for PR-12 (design-only PR; no procedure, skill, or checklist file changes in PR-11)
**Owner**: process-governance-manager (partnership-agent / pmi-agent / quant-methodologist / legal-counsel / market-intelligence-agent / valuation-agent co-review)
**Date**: 2026-08-23
**Related ADRs**: [ADR-0047](../adr/0047-three-axis-case-classification-model-retiring-case-subtype.md) (three-axis classification, origin=joint) · [ADR-0031](../adr/0031-partner-sourcing-failure-modeled-as-deal-termination-not-del.md) (partner-sourcing failure as deal termination, not delay) · [ADR-0051](../adr/0051-workflow-gap-closure-fifteen-step-chain-concretization.md) (PR-10 anchor steps)
**Research basis** (committed, `docs/research/`): `pmi-jv-lifecycle-best-practice.md` (cited `[pmi-jv X.Y]`) · `rbd-partnership-best-practice.md` (cited `[rbd X.Y]`) · `venture-governance-best-practice.md` (cited `[venture X.Y]`) · `ma-dd-best-practice.md` (cited `[ma-dd Area N]`)

> Per ADR-0032 (documents before code), no implementation starts until this design and ADR-0052 are accepted. PR-11 commits only this document, ADR-0052, and the two new research provenance copies.

---

## Preamble — reading rules for this document

1. **Boundary #3 discipline.** Procedures (`procedures/*.yaml`) own WHAT happens and WHEN; skills (`skills/*/SKILL.md`) own HOW. This document specifies future procedure steps at the WHAT/WHEN level (phase, owner agent, dispatch trigger, deliverable class, kill condition). Wherever it sketches method content — e.g. the PMI phase contents in Section B — that content defines the *scope of the future procedure and skill*, and the skill author of PR-12 owns the method prose. No step-by-step HOW text here is authoritative for skills, and nothing here restates existing procedure steps.
2. **Illustrative-numbers discipline.** Every research-derived numeric benchmark below is marked **ILLUSTRATIVE**. None is enforcement-active. Activation requires the thresholds meeting recorded under `docs/decisions/open/` — the same discipline that keeps `rag_rule` rows at `enabled=0` (ADR-0051 §Decision).
3. **Attribution.** JV-lifecycle practice is cited to the Watermark / Water Street Partners → Ankura author lineage (Bamford, Ernst, Branding Pyle, Walker, Bhargava, Mogstad, Kwicinski). The attribution "Vann & Willis-Shore" is unlocatable and must not appear in any governance doc [pmi-jv, attribution note].
4. **Post-PR-10 numbering.** Step references into merged procedures use post-PR-10 numbering, verified against the as-merged files: `brownfield-dd` steps 1–15 with market DD at 4, legal DD at 5, the six validators at 6–11 (certification last, at 11), financing at 12, HR DD at 13, the no-waiver completeness check at 14, gate record at 15; `greenfield-pre-fs` conditional step 1; `entity-establishment-execution` (5 steps, ends at formation completion).
5. **Six-validator invariant untouched.** Everything in this design is post-IC (integration, JV operation, portfolio) or front-of-funnel (deal-shape selection, R&BD gating) — orthogonal to the `brownfield-dd` no-waiver core (design §8.9-1(f)). No DD-side validator changes are proposed.

## 0. Audit result this design answers

The 12-cell classification matrix (ADR-0047: `case_type` × 4-value `origin` × `technology_track`) was audited against procedure routing. The root cause mirrors PR-10's: **routing, not inventory** — assets exist but no procedure step dispatches them.

- Zero-dispatch agents (4): `partnership-agent`, `pmi-agent`, `quant-methodologist`, `industry-lead`
- Zero-dispatch skills (8): `partner-sourcing-strategy`, `partner-due-diligence`, `jv-structuring`, `proxy-industry-chain`, `pmi-planning`, `monte-carlo-simulation`, `scenario-planning`, `expert-interview`
- Post-close gap: no procedure covers signing → close → integration → BAU for M&A (PMI); nothing covers operate/monitor/restructure/exit for JVs (origin=joint); nothing covers portfolio-level venture monitoring. The chain effectively ends at Entity-IC approval.

---

## A. Deal-shape selection chain (partner track)

**Problem.** Between "partner need identified" and "transaction executed" the current procedures offer only the binary acquisition path (brownfield chain) or the standalone greenfield chain. License-in, co-development, and minority investment — the shapes a capability-gap closure usually wants first — have no route at all, and `partnership-agent` has zero dispatches.

**A.1 Chain shape.** A decision chain with five stations:

partner sourcing → partner screening/fit → partner due diligence → **deal-shape selection** → execution route

Stage skeleton adapted from the R&BD gate table [rbd 1.3], with PR-10 assets reused rather than duplicated:

| Gate | Name | What it decides | Reuse / new |
|---|---|---|---|
| P0 | Need & funnel entry | A named technology-roadmap gap justifies external search; scouting funnel assigns each candidate a recommended deal shape and route [rbd 4.1, 4.2] | new (partnership-agent / `partner-sourcing-strategy`) |
| P1 | Strategic fit & partner screen | Knock-out + scorecard on the *partnership*, not the market — strategic fit, complementarity, technical capability, operational/cultural fit, financial health, alliance track record, readiness [rbd 2.2] | **reuses PR-10 `strategic-fit-screening` skill** (entity-level screen, `brownfield-screening` step 2 / `greenfield-screening` step 1); the partnership variant adds partner-facing criteria via `partner-sourcing-strategy` |
| P2 | Partner due diligence | The seven partner-DD workstreams — legal/title, technical (TRL/MRL evidence against our next gate), collaboration capability, financial, commercial-conflict, cultural, exit/reversibility — producing the standard report with deal-shape recommendation [rbd 2.3, 2.6] | new step (partnership-agent / `partner-due-diligence`); referencing ≥2 of the partner's other alliance partners is a required evidence item [rbd 2.4] |
| P3 | Deal-shape selection | Which shape (A.2) on the five criteria (A.3) | new step (partnership-agent + legal-counsel / `jv-structuring` for JV-shaped outcomes) |
| P4 | Contracting & execution | Pre-signing gate keyed to the selected shape's checklist (A.2); then the execution route into existing procedures | reuses `entity-establishment-execution` for entity-bearing shapes; `investment-vehicle-structuring` (`brownfield-fs` step, PR-10) for structure review |
| P5 | Launch & post-launch review | Kickoff plan and a dated review of the alliance against its selection rationale [rbd 2.1 phase 6–7] | new; feeds Section C (JV-shaped) or Section E (minority-stake) monitoring |

**A.2 Deal shapes and their pre-signing gates.** Each shape carries the shape-specific pre-signature checklist from research — these become PR-12 checklist specs, not new invention:

- **License-in** [rbd 3.1]: explicit grant scope (exclusive justified against a public-interest-style test), field/territory no broader than exploitable, complete financial stack (upfront, milestones, royalties, minimums), dated development benchmarks with annual reporting, **NIH-style anti-shelving revocation for non-use**, grantback, audit rights, government-strings identification (Bayh-Dole march-in / manufacture preference where applicable), inventor-assignment title verification before term sheet.
- **Co-development** [rbd 3.2]: background-IP definition per party; foreground-IP ownership rule chosen deliberately (joint vs by-field vs by-inventor); joint steering committee with named decision rights and deadlock ladder; milestone-tranched budgets with failure-to-fund consequences; publication review windows; exit/step-in triggers with data and sublicense handover.
- **Minority investment** [rbd 3.3]: NVCA-standard rights package (board designation, information rights, registration rights, ROFR/co-sale, management rights letter, pro-rata participation) plus corporate overlays — technology access licensed separately from equity, exclusivity windows with sunset, standstill/information barriers, foreign-investment screening.
- **JV (origin=joint)** [rbd 3.4]: committed parent contributions, board/reserved-matters/deadlock terms, IP licenses in/out, **exit architecture at signing** (put/call, ROFR, drag/tag, valuation mechanism), JV-specific antitrust clearance, wind-down terms. Formation mechanics ride PR-10's `entity-formation` JV addendum (`ef-13..17`); this chain owns the decision to choose the shape, not the formation itself.
- **Full M&A (origin=external)**: the existing brownfield chain unchanged — the deal-shape decision routes here and stops.

**A.3 Deal-shape selection criteria** (decision matrix content for the P3 step; scoring weights are a thresholds-meeting item, see ADR-0052 open question d):

1. **Control need** — does the capability require owning decisions (M&A/JV-control), sharing them (co-dev/JV), or merely accessing them (license/minority)?
2. **IP position** — in-bound license vs assignment; foreground-IP exposure; the partner's chain-of-title quality [rbd 2.3].
3. **Capital at risk** — upfront vs milestone-tranched exposure; reversibility if the alliance fails [rbd 2.3 exit/reversibility].
4. **Exit optionality** — mechanism availability at acceptable cost (put/call vs divestiture vs termination) [rbd 3.1–3.4 exit terms].
5. **Time-to-market** — contracting complexity vs speed; co-development and licensing beat entity formation where the clock dominates.

**A.4 Kill criteria candidates** (PR-12 registry entries; predicates inert until thresholds meeting, per ADR-0051 discipline):

- `partner_dd_red_ip_chain` — partner DD red finding on IP title/chain or encumbrances that conflict with our exclusivity → halt [rbd 2.3, 2.6]
- `partner_dd_red_financial_distress` — partner cannot survive the alliance horizon including exit tail → halt [rbd 2.2]
- `no_viable_deal_shape` — no shape meets the strategic-fit threshold → **Recycle**, not Kill: the need returns to the scouting funnel with the screen's written feedback [rbd 1.1 decision vocabulary]

**A.5 Classification interaction.** The P3 outcome writes the classification axes (ADR-0047): license-in/co-development → `greenfield`+`external` typically; minority → `greenfield`+`hybrid`; JV → `greenfield`+`joint`; M&A → `brownfield`+`external`. The chain never invents a fifth origin value. Post-approval applicability for each origin value is fixed by the matrix in Section G.0 (PM decision 2026-08-23).

---

## B. PMI procedure design (post-approval, case_type=brownfield)

**Problem.** The brownfield chain ends at Entity-IC approval (`entity-ic-review` decision; `entity-establishment-execution` covers only internal/joint-origin formation). For acquisitions — where integration, not selection, is where value is lost ("when deals fail, integration is at the root 83% of the time" [pmi-jv A.6], ILLUSTRATIVE as a planning prior) — nothing governs signing → close → integration → BAU. `pmi-agent` and `pmi-planning` have zero dispatches.

**B.1 Procedure frame.** Future `procedures/_shared/pmi-integration-execution/`:

- `applies_when`: `case_type = brownfield` AND approval granted at entity/group IC — activated at signing
- Owner: `pmi-agent` (first dispatch route for the orphan agent); skill: `pmi-planning`
- Gate: post_close (new gate slot after entity_ic)
- Applicability note: partial-stake acquisitions without control run a reduced phase set (B.2 phases 1–2 plus monitoring only) — control scope is determined by the stake, per ADR-0045's stake axis

**B.2 Phases** (scope definitions for the future procedure and `pmi-planning` skill; the skill owns method detail):

1. **Pre-close (signing → close)** [pmi-jv A.1]: stand up the IMO at signing staffed from both companies; write the integration thesis derived from the deal thesis; charter a clean team under agreed legal protocols for pre-close sensitive-data work — gun-jumping exposure is real (EC fines up to 10% of revenue, Illumina/Grail — statutory ceiling, verify against current enforcement practice before it is cited in a live checklist); set top-down stretch synergy targets validated bottom-up (BCG "W"); filter initiatives through the five synergy stage gates (ideas → quantified ranges → vetted plans → budget-embedded → impact accrual — ILLUSTRATIVE as a gate count); identify key talent and retention packages during diligence with day-1 appointments decided; set the revenue baseline so revenue synergies are attributable; assess culture fault-lines; decide the interim operating model separately from end-state; maintain the day-1 readiness checklist.
2. **Day-1** [pmi-jv A.2]: continuity as the objective; top 2–3 leadership layers announced; interim operating model live; pre-planned customer/supplier communications; synergy tracker activated (owner, baseline, timing, dependency, financial impact per initiative); control handover (treasury authority, statutory filings, delegation-of-authority matrix).
3. **First 100 days** [pmi-jv A.3]: standing cadence (weekly workstream stand-ups, weekly IMO escalation, monthly steering committee, quarterly board); pivotal cross-functional decisions resolved early; culture perceptions workshop; monthly promised-vs-actual synergy comparison with escalation of late/unowned items; key-talent attrition tracked at 30/60/90; approved initiatives folded into line budgets.
4. **Value-up → BAU exit** [pmi-jv A.4]: integration governance held until the synergy run-rate is **certified by Finance**, the end-state operating model is announced, and retention milestones pass; IMO formally demobilized with no open-item transfer lacking a named line-executive owner and date; final synergy accounting published; deal post-mortem feeds the M&A playbook.

**B.3 Standing bodies** (design section, mirrored in the procedure's governance block) [pmi-jv A.5]: steering committee (approves targets, stage-gates, pivotal decisions, escalations) · IMO (plan, risk/interdependency management, decision rights, value tracking) · workstream leads from both companies (finance, HR, IT, operations, commercial, legal, comms — seven standard workstreams) · one accountable synergy owner per initiative; escalation path workstream lead → IMO weekly issue log → steering committee → CEO/board with decision SLAs.

**B.4 Kill criteria candidates**:

- `synergy_run_rate_uncertified_at_bau_handover` → block IMO demobilization (the BAU exit is a completeness fact, not a judgment call — same logic as PR-10's financing precondition)
- `key_talent_attrition_above_threshold_at_90d` → escalate to risk-officer (threshold ILLUSTRATIVE until set)
- `clean_team_protocol_breach` → immediate halt + legal-counsel (gun-jumping exposure)

**B.5 Boundary with existing procedures.** HR DD (brownfield-dd step 13) and `hr-dd` checklist produce the key-person map and retention plan *inputs* this procedure consumes; `entity-establishment-execution` does not apply to acquisitions (origin=external); nothing in Section B touches brownfield-dd steps 6–11 or the completeness check at 14.

---

## C. JV lifecycle governance (origin=joint)

**Problem.** PR-10's `entity-establishment-execution` ends at formation (step 5 completion confirm, JV addendum `ef-13..17` verified). Between formation and exit — typically a decade (median JV lifespan 10 years, ILLUSTRATIVE [pmi-jv B framing]) — the venture operates, drifts, and usually restructures: JVs that undergo at least one major restructuring were more than twice as likely (79% vs 33%, ILLUSTRATIVE) to meet owner objectives [pmi-jv B.3, B.4]. No procedure owns any of it.

**C.1 Frame.** A future extension of `entity-establishment-execution` (or a sibling `jv-lifecycle-governance` procedure; PR-12 decides the file shape — see open decisions): `applies_when: origin = joint`; four phases operate → monitor → restructure → exit. Attribution throughout: the Watermark/Water Street → Ankura lineage [pmi-jv B.1–B.6].

**C.2 Operate** [pmi-jv B.1]: board-approved JV governance framework — only 45% of JVs have one (ILLUSTRATIVE; cite as the practice gap the design closes); directors-only board attendance; quarterly board + one annual strategy off-site; reserved-matters map (board vs shareholder) with conflict-prone decisions moved to shareholders; conflict-of-interest protocol covering the three JV conflict types (business opportunity, self-dealing, information disclosure) with a deliberately-chosen fiduciary-duty approach; arm's-length pricing for parent-JV commercial relationships. The `jv-structuring` skill (currently zero-dispatch) owns the formation-side counterpart; the operate phase dispatches it for governance reviews.

**C.3 Monitor** [pmi-jv B.2]: per-JV health scorecard across **seven dimensions** — performance, people, partner alignment, decision health, milestones & funding, governance health, value-distribution symmetry. Portfolio-level: annual strategic asset review per JV; independent external governance review every 3 years (ILLUSTRATIVE cadence). Scorecard weights and cadence are a thresholds-meeting item (ADR-0052 open question b). **Storage gap**: no schema holds scorecards — Section E flags the prerequisite. [closed 2026-08-24 — migration 0024 + repository + rollup CLI + portfolio view landed; see Honest summary]

**C.4 Restructure** [pmi-jv B.3, B.4]: formal triggers tied to metrics, not crisis-waiting — baseline expectation that at least half of JVs fail on ≥1 owner objective and a median 39-month restructuring lag vs comparable wholly-owned businesses (both ILLUSTRATIVE, cited as the reason triggers must be metric-tied); restructuring menu (scope, ownership, governance, economics, operating model, leadership); deadlock ladder with binding time-boxes — functional managers 15–30d → senior executives 30–60d → CEOs → institutional mediation (day ranges ILLUSTRATIVE); pre-agreed evolution paths in the JV agreement ("inability to evolve" is a named failure cause).

**C.5 Exit — designed at formation, executed here** [pmi-jv B.5]: the five-step exit-design practice (strategic end-game; trigger selection from 16 categories, typically 4–8 adopted (ILLUSTRATIVE); mechanisms put/call/buy-sell with ROFR/tag-drag protections; valuation including the two-appraisers-then-third process; post-exit transition across six areas — IP licensing, people/secondees, services, supply & purchase, non-competes, debt/guarantees). Exit paths: sale to partner (65% of endings, ILLUSTRATIVE), third-party sale, IPO, unwind. **Formation-time hook**: PR-10's `entity-formation` JV addendum (`ef-16` exit clauses) already writes the mechanics into formation documents — this phase is their operate-side counterpart, consuming what formation created; no duplication.

**C.6 Parent-side** [pmi-jv B.6]: designated executive accountability for JVs (only 38% of companies have it, ILLUSTRATIVE); avoid "corporate adhocracy"; a JV portfolio gameboard by venture type × lifecycle phase; post-close lookbacks feeding standards.

---

## D. R&BD track gating (technology_track=rbd)

**Problem.** The R&BD track rides commercial procedures whose evidence demands are market/business-shaped. Cooper's model family explicitly prescribes a separate 2–3 gate research/derisking front-end that joins the commercial pipeline only at the business-case gate [rbd 1.1] — the R&BD track's proof points must be staged *before* commercial scale-up, not parallel to it. PR-10's `greenfield-pre-fs` conditional step 1 (right-to-win proof for origin=internal, cells 9/10) is the anchor; this section generalizes it to the whole R&BD track.

**D.1 TRL/MRL evidence matrix per gate** (adapted from [rbd 1.2, 1.3]; all cutoffs ILLUSTRATIVE until the thresholds meeting):

| Our gate | R&BD-mode evidence demanded | Readiness cutoff (ILLUSTRATIVE) | Typical kill |
|---|---|---|---|
| Screening | Scientific basis; roadmap pull; preliminary prior-art/FTO screen | TRL 1–2 | no plausible principle→application path; roadmap absent |
| Pre-FS | Concept memo; critical-function list; POC experiment protocol | TRL 2 | concept not credible vs state of the art |
| FS entry | POC results demonstrating the critical function, reproducible | TRL 3 | technical feasibility wall |
| FS / DD | Integrated test data; relevant-environment validation plan; FTO opinion; patent strategy; updated cost model | TRL 4–5, MRL 4–5 | FTO failure (blocking third-party IP); unit cost over value ceiling |
| Entity-IC (= business-case gate) | Full business case; make/buy/partner decision (routes into Section A); real-options valuation; staged funding request for next stage only | TRL 5–6, MRL 5–6 | no viable business model; option value below stage premium |
| Post-IC execution | Operational-environment demonstration; pilot-line capability; regulatory pathway | TRL 7–8, MRL 7–8 | manufacturability failure; regulatory rejection |

The gate vocabulary adds **Hold/Recycle** alongside Go/Kill for tech bets whose evidence is immature [rbd 1.1].

**D.2 Evidence quality rules** (from the GAO TRA Guide, GAO-20-48G) [rbd 1.4]: every TRL/MRL claim supported by named tests, test environments, and data artifacts — not assertion; readiness assessments reviewed by a reviewer not reporting to the project champion; the assessment records *how* maturity was demonstrated, not only the level claimed; known limitations of readiness scales noted in gate records.

**D.3 Staged funding as real options** [rbd 1.5]: each stage approval is the exercise of a sequential option — the stage budget is the premium, the next gate the exercise decision; a negative static NPV does not by itself kill an early technology bet when staging options carry positive value; kill discipline remains when option value sits below the next premium even under favorable scenarios.

**D.4 quant-methodologist routes** (closing the orphan agent):

- `monte-carlo-simulation` → dispatched at **FS valuation** (value-at-risk / distributional valuation) — both greenfield and brownfield FS
- `scenario-planning` → dispatched at **FS risk assessment** — both tracks
- The proxy-chain confidence problem (the domain's distinctive risk: a two-hop proxy estimate cannot reach Green, boundary #4) is exactly where distributional valuation earns its keep — the design note for the skill author, not a procedure step.

**D.5 Korea co-funding context, flagged** [rbd 4.5]: KIAT-type co-funding programs and co-funding withdrawal appear as G3/G5 kill conditions in the research. **TIPS** (MSS private-investment-led startup support) and **tech-holding / technology-special-listing structures (KONEX/KOSDAQ tracks)** carry the researcher's verification flag: primary sources were unreachable this session — *needs primary-source verification against tips.or.kr / MSS / KRX / KLRI before any of it becomes gate criteria*. Nothing in this design depends on them.

---

## E. Venture portfolio monitoring

**Problem.** No procedure or script watches the portfolio after approval: no financial-vs-strategic metric split, no tranche discipline, no kill/graduate governance at stage transitions. Cells with venture character (internal venture cells 9/10, minority/hybrid cells 5/6) have no post-IC visibility at all.

**E.1 Metrics design (bifurcated)** [pmi-jv C.1, C.2]:

- **Financial**: IRR vs hurdle, cash-on-cash multiples, capital deployed vs milestone plan, revenue growth, valuation marks by stage normalized for time in market.
- **Strategic**: introductions (BU–startup / partner), learning progressing to tangible products/partnerships/JVs (leading → lagging), stage-progression rate, kill/graduate decision counts.
- **Benchmark odds**: 20–30% success is normal for CVC (ILLUSTRATIVE) — continued funding beyond that band requires explicit evidence; a disciplined venture-building model reported 66% (ILLUSTRATIVE, one firm's reported result — not a target).

**E.2 Tranche-gated funding** [pmi-jv C.2]: no tranche release without blueprint milestones, metrics, and documented parent + venture contribution responsibilities; gate decisions routed through a small senior IC with integrity guardrails; parent-side capability commitments tracked as obligations; "freedom within financial guardrails".

**E.3 Kill/graduate governance at each stage transition** [pmi-jv C.3]: evaluate the exit path with a clear rationale — integrate / standalone / spinout / reduce ownership / divest / kill; time-boxed evidence windows (ventures that cannot show measurable impact lose management support — the window length is a thresholds-meeting item); kill decisions recorded with rationale and learning capture recycled into the playbook; the graduation/integration concept is prepared **before** absorbing a venture into the core.

**E.4 Script needs — design statement only (no implementation in this PR).** A future `portfolio-monitoring` script:

| Aspect | Design statement |
|---|---|
| Inputs | `md_project` (classification axes), gate records (`gate_pass_record` outputs), Section C.3 JV scorecards, Section B synergy tracker data |
| Outputs | stage-progression ledger, capital-vs-milestone comparison, kill/graduate decision ledger, per-venture scorecard rollup |
| Consumers | process-governance-manager (portfolio review cadence), pmi-agent (BAU exit evidence), the thresholds meeting (empirical basis for E.1 benchmarks) |
| Prerequisite — flagged | **JV/venture scorecard storage does not exist yet** — a schema addition is required before the script can read what Section C.3 produces. This is an ADR trigger per the design's ADR-trigger list (DB schema change); recorded as ADR-0052 open question (e). [resolved 2026-08-24 — ADR-0059 → migration 0024 + repository + `scorecard:rollup` CLI (PR #103) + portfolio view (PR #104); open question (e) resolved] |

---

## F. Orphan routing table (before/after)

Design-level routes; implementation wiring lands in PR-12.

| Asset | Before (PR-10 merged) | After (this design, via) |
|---|---|---|
| `partnership-agent` | zero dispatches | Section A chain: sourcing (P0), partner screen (P1), partner DD (P2), deal-shape selection (P3) |
| `pmi-agent` | zero dispatches | Section B PMI procedure — all four phases |
| `quant-methodologist` | zero dispatches | Section D.4: FS valuation (monte-carlo) + FS risk (scenario-planning), GF and BF |
| `industry-lead` | zero dispatches | **No procedure dispatch — by design.** One of the four domain leads (design §Team Axes); industry input enters through `industry-profiles/` (mandatory `source`/`verified_on` per the profile contract) and lead consultation at review, not through procedure steps. Documented here to close the audit item as by-design, not as a gap. |
| `partner-sourcing-strategy` | zero dispatches | partnership-agent steps, Section A (P0/P1) |
| `partner-due-diligence` | zero dispatches | partnership-agent step, Section A (P2) |
| `jv-structuring` | zero dispatches | legal-counsel deal-shape selection (Section A P3, JV outcome) + JV governance reviews (Section C.2); cross-refs PR-10 `entity-formation` JV addendum |
| `proxy-industry-chain` | zero dispatches | greenfield market-sizing steps — the domain's distinctive proxy-chain methodology; also the confidence input to D.4 distributional valuation |
| `pmi-planning` | zero dispatches | pmi-agent steps, Section B |
| `monte-carlo-simulation` | zero dispatches | quant-methodologist, FS valuation (D.4) |
| `scenario-planning` | zero dispatches | quant-methodologist, FS risk (D.4) |
| `expert-interview` | zero dispatches | market DD evidence gathering (`brownfield-dd` step 4, PR-10) + R&BD validation evidence (Section D gates) |

---

## G. Readiness matrix — before/after (12 cells, ADR-0047)

### G.0 Origin → post-approval procedure applicability (PM decision 2026-08-23)

The PR-10 flagged question — why `entity-establishment-execution` covers only `origin ∈ {internal, joint}` when ADR-0047 defines four origin values — is resolved by PM decision (2026-08-23): **the exclusion is correct by design.** Hybrid is a passive minority investment in an *existing* external entity (the pilot-014 pattern) — there is nothing to establish. Internal (we form the entity) and joint (we co-form with a partner) are the only establishment cases; external means the target already exists.

| origin | Post-approval procedure(s) | Rationale |
|---|---|---|
| `internal` | `entity-establishment-execution` (PR-10) | we form the entity — formation, statutory filings, IP assignment, people transfer |
| `joint` | `entity-establishment-execution` (PR-10) + JV lifecycle (Section C) | we co-form with a partner; establishment ends at formation completion, the lifecycle owns operate → exit |
| `hybrid` | minority-investment monitoring only (Section E) — **no establishment procedure** | passive minority stake in an existing external entity; investor protections ride the NVCA rights package (Section A.2, [rbd 3.3]) — nothing to establish |
| `external` | PMI track (Section B) where our acquisition completes; otherwise nothing post-IC on our side | the target exists; establishment never applies |

PR-5's classification routing encodes this matrix (conditional dispatch on the origin axis); until it lands, the matrix is design-level. The matrix is origin-level and composes with `case_type` — e.g. cell 12 (brownfield internal carve-out) receives establishment plus the reduced-phase PMI of B.1 where control transfers.

Coverage = which procedure chain serves the cell post-PR-11-design. "Thin" cells are stated honestly.

| # | case_type | origin | technology_track | Before | After (chain) | Residual gap |
|---|---|---|---|---|---|---|
| 1 | greenfield | external | none | screening→pre-FS→FS→IC | + Section A chain when a partner is the vehicle (license-in/co-dev route) | P5 review depends on PR-12 |
| 2 | greenfield | external | rbd | same, no TRL/MRL evidence demands | + Section D TRL/MRL matrix at every gate | cutoffs ILLUSTRATIVE until thresholds meeting |
| 3 | greenfield | internal | none | + PR-10 `entity-establishment-execution` | unchanged (PR-10 closed it) | post-IC portfolio view only via Section E |
| 4 | greenfield | internal | rbd | + PR-10 pre-FS gate (step 1) | + Section D full matrix (pre-FS was the anchor; D generalizes) | same as cell 2 |
| 5 | greenfield | hybrid | none | (passive minority) thin | + Section A P3 minority shape + NVCA rights checklist | **thin**: monitoring depends on Section E script + schema (open question e) [closed 2026-08-24 — chain landed, see Honest summary] |
| 6 | greenfield | hybrid | rbd | thin | + Section A minority + Section D | both cells' residuals stack [monitoring/schema half closed 2026-08-24 — chain landed, see Honest summary; Section D cutoffs stay ILLUSTRATIVE] |
| 7 | greenfield | joint | none | formation only (PR-10 JV addendum) | + Section C operate/monitor/restructure/exit | scorecard schema gap (open question e) [closed 2026-08-24 — chain landed, see Honest summary] |
| 8 | greenfield | joint | rbd | formation only | + Section C + Section D | both residuals [Section C schema half closed 2026-08-24 — see Honest summary; Section D cutoffs stay ILLUSTRATIVE] |
| 9 | greenfield | internal | none (internal-venture-specific) | PR-10 pre-FS right-to-win gate | + Section E portfolio monitoring (kill/graduate, tranche funding) | **thin**: depends on Section E script + scorecard schema follow-up [closed 2026-08-24 — chain landed, see Honest summary] |
| 10 | greenfield | internal | rbd (internal-venture-specific) | PR-10 gate | + Section D + Section E | same as 9 |
| 11 | brownfield | external | none | full DD→FS→IC chain (PR-10) | + Section B PMI post-approval (the post-close gap) | PMI procedure itself is PR-12 |
| 12 | brownfield | internal | none | carve-out/intra-group: PR-10 `entity-establishment-execution` | unchanged + Section B reduced-phase PMI where control transfers | B.1 partial-stake scope rule needs PR-12 detail |

**Honest summary**: cells 3 and 12 are genuinely closed; cells 1/2/4/7/8/11 gain designed chains pending PR-12; cells 5/6/9 remain **thin** until the Section E script and its scorecard schema prerequisite exist — that dependency chain (schema ADR → script → portfolio view) is the longest lead item and is flagged in ADR-0052 open question (e). [chain landed 2026-08-24 — schema ADR (ADR-0059, PR #100) → storage + rollup script (PR #103) → portfolio view: server routes + web page (PR #104); open question (e) resolved. D-round R8 context: PRs #102–#104, where PR #102 is the parallel kill-criteria classification, not part of this chain.]

---

## Decisions this spec left open (flagged for PM review)

1. **JV lifecycle as extension vs sibling procedure** (C.1): extend `entity-establishment-execution` with a lifecycle block, or a new `jv-lifecycle-governance` file. This design leans **sibling** — the existing procedure is formation-scoped with a clean completion gate, and lifecycle phases have different cadence/gate semantics — but leaves the call to PR-12's spec.
2. **PMI partial-stake scope** (B.1): reduced phase set for non-control acquisitions defined here at one sentence; PR-12 must write the exact `applies_when` predicate.
3. **Section A P1 reuse depth**: the strategic-fit screen is reused as-is for partnerships; whether the partnership variant needs its own checklist (`chk-partner-fit`) versus extending `chk-strategic-fit` with a partner part is a PR-12 authoring choice.
4. **P5 launch review ownership**: assigned to partnership-agent by default; an argument exists for process-governance-manager (cadence consistency with Section E). Not decided.
