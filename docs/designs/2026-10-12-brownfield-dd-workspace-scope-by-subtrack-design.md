# Brownfield S9 Workspace Domains by Sub-Track (Item-Level Scoping)

- Date: 2026-10-12
- Status: Draft (Row 0 Design Gate)
- Owner: process-governance-manager (functional domain lead)
- ADR: ADR-0162 (Proposed, draft) — `docs/adr/0162-brownfield-dd-workspace-scope-by-subtrack.md`
- Sibling design (mechanism reused): `docs/designs/2026-10-12-greenfield-dd-workspace-domains-by-track-design.md` (ADR-0160 addendum b; overlay `checklists/_overlays/greenfield-workspace-scope.yaml`, validator in `checklists/_validate.ts`, loader/scope in `app/web-next/lib/greenfield-subtrack.ts`)
- Related: ADR-0148 (seven S9 workspace domains), ADR-0048 (M&A validator applicability), ADR-0051 (DD expansion steps with standard waiver path), ADR-0052 (deal-shape checklists), ADR-0157 (optional per-target DD), Wave F-8 audit B1 (sub-track extra checklists)

## 1. Problem (user finding)

S9 DD items must match the deal shape. Greenfield is being scoped by the sibling design. Brownfield shows the **same 77 items of the seven ADR-0148 workspace domains for all seven brownfield sub-tracks** (`m_and_a`, `jv`, `strategic_investment`, `minority_investment`, `partnership`, `rbd`, `corporate_venture`; enum in `db/migrations/0049_brownfield_routes.sql:12`), although many items presuppose control, a closing, an employer change or an acquired balance sheet. A minority investor is asked for a Day-1 retention plan, TUPE and an escrow; a contractual partner is asked for a cap table, a quality-of-earnings report and a certain-funds structure.

## 2. Current brownfield behaviour (verified in code and data)

| # | Finding | Location |
|---|---|---|
| F1 | The seven workspace checklists are the same for every brownfield sub-track; no item-level filter exists on the brownfield path. | `app/web-next/lib/library.ts:63-71` (`DD_WORKSPACE_CHECKLISTS`); `app/web-next/lib/dd-checklist-tailor.ts:636-643` (unassessed loop uses `getChecklistItems` for workspace checklists) |
| F2 | Scoping that already exists is **checklist-level only**: extra checklists by sub-track. `m_and_a` gets brownfield-feasibility + ma-special-topics; `jv`, `partnership`, `minority_investment` get partnership + deal-shape-presigning; `rbd` gets rbd-technology; `strategic_investment` and `corporate_venture` get nothing extra. | `app/web-next/lib/library.ts:80-88` |
| F3 | Extras apply only when the route is brownfield with a non-null sub-track and the project's earliest pin (or `created_at`) is on or after `WAVE_F_PREDICATE_DATE`. | `app/web-next/lib/dd-checklist-tailor.ts:576-585` |
| F4 | The deal-shape-presigning checklist is attached **whole** (26 items: lic-01..09 license-in, cdv-01..06 co-development, min-01..05 minority, jvd-01..06 JV) to jv, partnership and minority_investment alike; a minority investor is asked to judge JV wind-down and license anti-shelving terms. Its own header states "one checklist set per deal shape". | `checklists/deal-shape-presigning-checklist.yaml:11-17`; `library.ts:80` |
| F5 | `pt-06` ("For JV structures: governance ...") is attached to partnership and minority_investment, where it cannot apply. | `checklists/partnership-checklist.yaml` (pt-06) |
| F6 | `scopedChecklistItems` narrows only `chk-entity-formation-checklist` (ef-01, ef-03, ef-07) and is greenfield-only in effect. | `app/web-next/lib/greenfield-subtrack.ts:41-59` |
| F7 | The six M&A validators (procedure steps 6-11) are "Brownfield always" applicable in the ADR-0048 registry, but their checklists (bf-*, ma-*) attach only for `m_and_a`. For jv / minority / partnership / SI / CV the validators are declared applicable in step 14 with no workspace items. Recorded here, **not changed** by this design (open question Q5). | `db/lib/validator-applicability.ts:99-140`; `procedures/_shared/brownfield-dd/schema.yaml` steps 6-14; `library.ts:81-88` |
| F8 | `procedures/_shared/brownfield-dd/schema.yaml` carries **no** sub-track predicates: all 15 steps apply to every brownfield sub-track. | `procedures/_shared/brownfield-dd/schema.yaml` (no `applies_when`) |
| F9 | Only one of the 77 items is binding (mandatory and `waiver_eligible: false`): **fin-09** (certainty of funds before IC). Binding extras: bf-01, bf-02, bf-03 (m_and_a only), ef-07 (not attached to brownfield). | checklist YAMLs |

In-flight brownfield projects (read-only query of `db/data/co-newbiz.sqlite`, 2026-10-12):

| Project | Sub-track | Created | S9 state rows |
|---|---|---|---|
| PRJ-QGB2W5 (`01M1MPD52T6TAGKWP3P6QGB2W5`) | strategic_investment | 2026-09-03 | 37 (commercial 7, legal 22, technical 8) |
| PRJ-T7T81A (`01M2Y2SM5TM27D5YZ3CHT7T81A`) | partnership | 2026-09-20 | 0 |
| demo-s1-s12-project | m_and_a | 2026-10-01 | 78 (+1 custom) |

Note: PRJ-QGB2W5 is an additional in-flight brownfield project with recorded judgements; it must be grandfathered exactly like PRJ-DSE4PW on the greenfield side.

## 3. Classification codes

Same codes as the sibling design, same meaning and effect. **C is not used for brownfield** (no `site_required` rule exists on the brownfield route); the validator rejects C in the brownfield overlay.

| Code | Meaning | Effect |
|---|---|---|
| A | Apply as-is | Shown unchanged; counts in Y |
| R | Apply reinterpreted | Shown with a sub-track reading line under the original text; counts in Y |
| X | Replace | Pointer row to the replacing item (judged in an attached extra checklist); not in Y |
| N | Not applicable by track rule | Listed under "Excluded by track rule" with the reason; not in Y |

**Classification principle.** N is used only where the subject of the item **cannot exist structurally** for the sub-track (no closing, no employer change, no acquired balance sheet, no shares). Where the subject merely *may be absent* in a given deal (a technology company with no revenue, a target without a CBA), the item stays A or R and the existing per-item `na`-with-reason path applies. This keeps the overlay a rule about deal shapes, not a guess about data.

**Baseline invariant.** `m_and_a` is the baseline: **every one of its 77 rows is A**, its extras are unchanged, and its selection, render input and counts stay byte-identical. No `m_and_a` row in this design says otherwise. The validator enforces "m_and_a column all A" (section 7).

Every row is a **proposal** requiring recorded human sign-off (section 11).

## 4. Item-level classification

Columns: MA = m_and_a, JV = jv, SI = strategic_investment, MI = minority_investment, PT = partnership, RBD = rbd, CV = corporate_venture. The text column is shown to the user (English here; Korean UI labels via glossary-curator).

### 4.1 Commercial (chk-commercial-dd-checklist)

| Item | Topic | MA | JV | SI | MI | PT | RBD | CV | Brownfield reading / replacement / reason |
|---|---|---|---|---|---|---|---|---|---|
| cdd-01 | Customer concentration | A | A | A | A | R | A | A | PT: concentration of the partner's customer base only where the alliance revenue depends on it; otherwise of the joint offering's prospective customers |
| cdd-02 | Customer churn history | A | A | A | A | N | A | A | PT reason: "A contractual alliance acquires no customer base; partner reliability is judged under pt-03 and pt-11." |
| cdd-03 | Pricing power | A | A | A | A | R | A | A | PT: pricing power of the joint offering and the revenue-share split |
| cdd-04 | Win/loss analysis | A | A | A | A | R | A | A | PT: win/loss of the partner in the alliance's target segment |
| cdd-05 | Channel check | A | A | A | A | A | A | A | — |
| cdd-06 | Findings tied to assumption_key / value_impact | A | A | A | A | A | A | A | — |
| cdd-07 | Expert interview triangulation | A | A | A | A | A | A | A | — |
| cdd-08 | Revenue quality (recommended) | A | A | A | A | R | A | A | PT: revenue quality of the alliance revenue line in the plan |

### 4.2 Technical (chk-technical-dd-checklist)

| Item | Topic | MA | JV | SI | MI | PT | RBD | CV | Brownfield reading / replacement / reason |
|---|---|---|---|---|---|---|---|---|---|
| tdd-01 | Site visit | A | A | A | A | A | A | A | — |
| tdd-02 | Site visit evidence | A | A | A | A | A | A | A | — |
| tdd-03 | TRL of core production process | A | A | A | A | A | A | A | — |
| tdd-04 | Bottleneck process | A | A | A | A | A | A | A | — |
| tdd-05 | Remaining useful life of equipment | A | R | R | R | N | R | R | JV: equipment contributed to the JV. SI/MI/CV: proportionate to the stake; material assets only. RBD: pilot or lab equipment acquired with the technology. PT reason: "No equipment is acquired or contributed in a contractual alliance; partner capability is judged under pt-09." |
| tdd-06 | EHS liability exposure | A | A | A | A | R | A | A | PT: EHS exposure of activities performed jointly or on our behalf (contractor liability) |
| tdd-07 | Independent capex verification | A | A | A | A | R | A | A | PT: capex we commit under the alliance |
| tdd-08 | Production line certification status | A | A | A | A | A | A | A | — |

### 4.3 Legal (chk-legal-dd-checklist)

| Item | Topic | MA | JV | SI | MI | PT | RBD | CV | Brownfield reading / replacement / reason |
|---|---|---|---|---|---|---|---|---|---|
| ldd-01 | Good standing of target and subsidiaries | A | A | A | A | R | A | A | PT: good standing of the contracting partner entity only (no subsidiaries reviewed) |
| ldd-02 | Cap table | A | A | A | A | N | A | A | PT reason: "No equity is acquired; ultimate beneficial ownership is screened under ldd-19 and pt-02." |
| ldd-03 | Shareholder consents, ROFR, tag/drag | A | A | A | A | N | A | A | PT reason: "No shares change hands." |
| ldd-04 | Signing authority | A | A | A | A | A | A | A | — |
| ldd-05 | Borrowing and guarantee restrictions | A | A | A | A | R | A | A | PT: restrictions that limit the partner's ability to perform (negative covenants on assets it commits) |
| ldd-06 | Top-20 contract change-of-control scan | A | R | R | R | R | A | R | JV: contracts of any business contributed to the JV (transfer consent) and of the partner where JV formation triggers them. SI/MI/CV: whether our stake crosses a CoC or consent threshold in the target's contracts. PT: exclusivity, non-compete and MFN terms in the partner's contracts that block the alliance; where the partner is a competitor, also the scope of competitively sensitive information exchange, clean-team arrangements and the KFTC Monopoly Regulation and Fair Trade Act Art. 40 (unfair concerted practices, including information exchange) review (added after legal review 2026-10-12) |
| ldd-07 | Asset vs share transfer | A | R | N | N | N | A | N | JV: contribution route of the businesses or assets put into the JV. SI/MI/CV reason: "A share subscription or secondary purchase; no asset transfer." PT reason: "No transfer." |
| ldd-08 | Loans requiring consent at close | A | R | R | R | N | A | R | JV/SI/MI/CV: target loans whose consent or prepayment is triggered by our entry. PT reason: "No closing." |
| ldd-09 | Litigation and regulatory investigations | A | A | A | A | A | A | A | — |
| ldd-10 | IP inventory and inventor assignment | A | A | A | A | R | A | A | PT: IP the partner brings to the alliance (background IP) |
| ldd-11 | In/out licences | A | A | A | A | A | A | A | — |
| ldd-12 | IP encumbrances, fees, disputes | A | A | A | A | R | A | A | PT: encumbrances on the partner's background IP used in the alliance |
| ldd-13 | PIIA coverage | A | A | A | A | R | A | A | PT: PIIA coverage of partner staff assigned to joint work |
| ldd-14 | Union and pension (CBA succession) | A | R | N | N | N | A | N | JV: CBA succession for staff transferred into the JV. SI/MI/CV reason: "No employer change; the target's labour relations are judged under hdd-06." PT reason: "No employees transfer." |
| ldd-15 | Permit transfer classification | A | R | R | R | R | A | R | JV: permits the JV needs in its own name vs those held by a parent. SI/MI/CV: permits that require notification or approval on a change in shareholding. PT: permits each party needs for its own share of the work |
| ldd-16 | Environmental notices, land survey, contamination | A | A | A | A | R | A | A | PT: only sites used jointly |
| ldd-17 | Real estate title and leases | A | A | A | A | R | A | A | PT: only property used jointly |
| ldd-18 | Privacy | A | A | A | A | R | A | A | PT: data shared under the alliance (sharing basis, cross-border transfer) |
| ldd-19 | Anti-bribery and sanctions screening | A | A | A | A | A | A | A | — |
| ldd-20 | Tax filings current | A | A | A | A | N | A | A | PT reason: "No entity is acquired; tax effects of the alliance are reviewed under fdd-04." |
| ldd-21 | Findings register (RAG) | A | A | A | A | A | A | A | — |
| ldd-22 | Korean business-transfer employee succession | A | R | R | R | N | A | R | JV: staff transferred into the JV by business transfer. SI/MI/CV: applies when the investment carries a transfer of a business unit or staff, including contribution in kind (changed from N after legal review 2026-10-12). PT reason: "No business transfer." |

### 4.4 Market (chk-market-dd-checklist)

| Item | Topic | MA | JV | SI | MI | PT | RBD | CV | Brownfield reading / replacement / reason |
|---|---|---|---|---|---|---|---|---|---|
| mdd-01 | TAM/SAM triangulation | A | A | A | A | A | A | A | — |
| mdd-02 | Growth drivers vs management assumptions | A | A | A | A | A | A | A | — |
| mdd-03 | Competitive landscape from customers, win/loss | A | A | A | A | A | A | A | — |
| mdd-04 | Share, concentration, pricing power | A | A | A | A | A | A | A | — |
| mdd-05 | Target's moat | A | A | A | A | R | A | A | PT: moat of the joint offering |
| mdd-06 | Concentration (uses cdd-01) | A | A | A | A | R | A | A | PT: follows the cdd-01 reading |
| mdd-07 | Churn and retention (uses cdd-02) | A | A | A | A | N | A | A | PT: follows cdd-02; reason as cdd-02 |
| mdd-08 | 80/20 revenue analysis | A | A | A | A | R | A | A | PT: 80/20 of the partner revenue the alliance draws on |
| mdd-09 | Expansion revenue breadth | A | A | A | A | N | A | A | PT reason: "No acquired customer base whose expansion revenue could be measured." |
| mdd-10 | Distribution structure | A | A | A | A | A | A | A | — |
| mdd-11 | Thesis verdicts and bid adjustment | A | R | R | R | R | A | R | JV: adjustment targets contribution values or the equity split. SI/MI/CV: adjustment targets the pre-money valuation or the round terms. PT: adjustment targets the revenue-share or milestone terms |

### 4.5 Financial (chk-financial-dd-checklist)

| Item | Topic | MA | JV | SI | MI | PT | RBD | CV | Brownfield reading / replacement / reason |
|---|---|---|---|---|---|---|---|---|---|
| fdd-01 | Quality of earnings | A | A | A | A | X | A | A | PT: replaced by pt-03 (partner financial stability and capacity with evidence) |
| fdd-02 | Working capital | A | A | A | A | N | A | A | PT reason: "No balance sheet is acquired; the alliance's working-capital needs are in fin-01." |
| fdd-03 | Debt and contingent liabilities | A | A | A | A | R | A | A | PT: partner liabilities that threaten performance; our contingent obligations under the alliance |
| fdd-04 | Tax position | A | A | A | A | R | A | A | PT: tax treatment of alliance payments (withholding, transfer pricing of cross-border flows) |
| fdd-05 | Cash-flow quality | A | A | A | A | N | A | A | PT reason: "No cash flows are acquired; partner capacity is judged under pt-03." |
| fdd-06 | Related-party transactions | A | A | A | A | R | A | A | PT: related-party flows of the partner that touch the alliance |
| fdd-07 | Management vs audited accounts | A | A | A | A | X | A | A | PT: replaced by pt-03 |
| fdd-08 | Forecast assessment | A | A | A | A | R | A | A | PT: forecast of the alliance revenue and cost plan |

### 4.6 HR (chk-hr-dd-checklist)

| Item | Topic | MA | JV | SI | MI | PT | RBD | CV | Brownfield reading / replacement / reason |
|---|---|---|---|---|---|---|---|---|---|
| hdd-01 | Key person map | A | A | R | R | R | A | R | SI/MI/CV: key people whose departure would impair the value of our stake; retention levers are board and shareholder rights, not our own offers. PT: partner key people named in the alliance (key-person clause) |
| hdd-02 | Stay bonus after closing | A | R | N | N | N | R | N | JV: retention of key staff seconded or transferred to the JV. RBD: retention of the inventors and core researchers acquired with the technology. SI/MI/CV/PT reason: "We do not employ the target's staff and fund no retention bonus." |
| hdd-03 | Day-1 retention plan | A | R | N | N | N | A | N | JV: Day-1 retention for JV staff. SI/MI/CV/PT reason: "No Day 1 of an acquisition; key-person risk is judged under hdd-01." |
| hdd-04 | Organisation documentation | A | A | A | A | R | A | A | PT: alliance governance and team structure |
| hdd-05 | Leadership bench | A | R | R | R | R | A | R | JV: JV leadership from both parents. SI/MI/CV: management quality as an investment risk. PT: the partner's alliance leadership and named sponsor (with pt-12) |
| hdd-06 | CBA | A | A | A | A | N | A | A | PT reason: "No employees transfer; partner labour disruption risk is judged under pt-04." |
| hdd-07 | Pension and benefit liabilities | A | R | R | R | N | A | R | JV: liabilities that move with transferred staff. SI/MI/CV: pension deficit as a valuation item, pro rata to the stake. PT reason: "No benefit liability is assumed." |
| hdd-08 | EU works council | A | A | A | A | R | A | A | PT: applies where a European counterparty, or staff and operations at our own sites, are reorganised by the alliance (changed from N after legal review 2026-10-12). |
| hdd-09 | Employment succession regime | A | R | R | R | N | A | R | JV: regime for staff transferred into the JV. SI/MI/CV: applies when the investment carries a transfer of a business unit or staff, including contribution in kind (changed from N after legal review 2026-10-12). PT reason: "No transfer of undertaking." |
| hdd-10 | Culture gap | A | R | R | R | R | A | R | JV: culture of the two parents within the JV. SI/CV: collaboration fit between our team and the investee. PT: working-style fit (with pt-10). MI: applies where we hold a board nomination right or veto rights (changed from N after legal review 2026-10-12). |
| hdd-11 | Day-1 and 100-day HR plan | A | R | N | N | N | A | N | JV: JV HR stand-up plan (payroll, policies). SI/MI/CV/PT reason: "No organisation is integrated into ours." |

### 4.7 Financing (chk-financing-plan-checklist)

| Item | Topic | MA | JV | SI | MI | PT | RBD | CV | Brownfield reading / replacement / reason |
|---|---|---|---|---|---|---|---|---|---|
| fin-01 | Sources and uses | A | A | A | A | A | A | A | — |
| fin-02 | Signed commitment letters | A | R | R | R | R | A | R | JV: committed capital contributions of each parent. SI/MI/CV/PT: internal funding approval for our subscription or alliance budget; external letters only if debt-funded |
| fin-03 | Covenant headroom | A | A | A | A | A | A | A | — |
| fin-04 | Funds-flow memorandum at closing | A | R | R | R | N | A | R | JV: funds flow at JV formation (capital calls). SI/MI/CV: subscription funds flow at the round closing. PT reason: "No closing; alliance payments follow the contract schedule in fin-01." |
| fin-05 | FX plan | A | A | A | A | A | A | A | — |
| fin-06 | Certain-funds structure | A | N | R | R | N | A | R | SI/MI/CV: applies when the deal includes a purchase of existing shares; not applicable for a pure subscription of new shares (changed from N after legal review 2026-10-12). Reason (JV/PT): "Certain funds protects a seller in a competitive acquisition; a subscription, contribution or alliance has no such seller." |
| fin-07 | Escrow and paying agent | A | R | N | N | N | A | N | JV: escrow or true-up on contributed businesses where values are disputed. SI/MI/CV/PT reason: "No purchase price or indemnity to secure." |
| fin-08 | Reverse termination fee | A | N | R | R | N | A | R | SI/MI/CV: applies when the deal includes a purchase of existing shares; not applicable for a pure subscription of new shares (changed from N after legal review 2026-10-12). Reason (JV/PT): "No acquisition agreement in which the buyer bears funding risk." |
| fin-09 | Certainty of funds before IC (BINDING) | A | A | A | A | A | A | A | Binding item: A in every column (changed from R for JV/SI/MI/PT/CV after risk-officer review 2026-10-12; user decision pending). Former readings remain reviewer guidance: JV, certainty of each parent's contribution; SI/MI/CV, approval of our subscription amount; PT, approval of the alliance budget |


## 5. Classification summary (seven workspace domains, 77 items)

Counts computed mechanically from the section 4 tables (script over the rows; the overlay validator recomputes them and fails on mismatch).

| Code | MA | JV | SI | MI | PT | RBD | CV |
|---|---|---|---|---|---|---|---|
| A | 77 | 57 | 56 | 56 | 22 | 75 | 56 |
| R | 0 | 18 | 15 | 15 | 30 | 2 | 15 |
| X | 0 | 0 | 0 | 0 | 2 | 0 | 0 |
| N | 0 | 2 | 6 | 6 | 23 | 0 | 6 |
| Judgeable (A+R) | **77** | **75** | **71** | **71** | **52** | **77** | **71** |

Revision 2026-10-12 (after legal-counsel review, overlay 1.1.0, DEC-20261012-01): fin-06, fin-08, hdd-09 and ldd-22 moved N -> R for SI/MI/CV; hdd-10 N -> R for MI; hdd-08 N -> R for PT. Before the revision the row read R 12/11/30/12, N 10/11/24/10 and judgeable 67/66/51/67 for SI/MI/PT/CV.

Change note (risk-officer review 2026-10-12; user decision pending): fin-09 moved R -> A for JV, SI, MI, PT and CV, so A rises by 1 and R falls by 1 in those columns; judgeable counts are unchanged.

Binding guard: fin-09 is A in every column (the validator rejects R, X, N and C on binding items since the risk-officer review 2026-10-12). All 45 N/X cells (59 before the 2026-10-12 revision) across the six non-baseline columns fall on items with `waiver_eligible: true`.

Rationale per sub-track, in one line each:

- **jv**: a JV forms a new entity from contributed businesses; control is shared but there is a formation closing and possible staff transfer, so most items stay and transfer items are re-read for contributions. Only fin-06 and fin-08 are N.
- **strategic_investment / corporate_venture**: a non-control stake by subscription or secondary purchase; no integration. Funding-certainty items (fin-06, fin-08) are re-read to apply only when existing shares are bought, and transfer items (hdd-09, ldd-22) only when the investment carries a business-unit or staff transfer (including contribution in kind).
- **minority_investment**: as SI; hdd-10 is re-read to apply where we hold a board nomination right or veto rights (revision 2026-10-12).
- **partnership**: a contractual alliance without equity; target-entity diligence becomes partner diligence. Two X rows point to pt-03 (partner financial stability), which is attached for this sub-track.
- **rbd**: a technology-led acquisition is still an acquisition of a company or business; all control, closing and integration items apply. The technology lens is added by the rbd-technology extra (unchanged), and only tdd-05 and hdd-02 are re-read (pilot equipment; inventor retention). See Q3.

## 6. Sub-track extra checklists

The extras stay attached per `SUB_TRACK_DD_CHECKLISTS` (`library.ts:81-88`); this design adds **section-level scoping** of two of them through the same overlay (key `extra_checklists`). Item text is not edited.

| Extra checklist | MA | JV | SI | MI | PT | RBD | CV |
|---|---|---|---|---|---|---|---|
| brownfield-feasibility (13; bf-01..03 binding) | all, unchanged | — | — | — | — | — | — |
| ma-special-topics (12) | all, unchanged | — | — | — | — | — | — |
| partnership (12) | — | all 12 | — | 11 (pt-06 N) | 11 (pt-06 N) | — | — |
| deal-shape-presigning (26) | — | jvd-01..06 (6); lic/cdv/min N | — | min-01..05 (5); lic/cdv/jvd N | lic-01..09 + cdv-01..06 (15); min/jvd N | — | — |
| rbd-technology (15) | — | — | — | — | — | all, unchanged | — |
| entity-formation (19) | not attached on brownfield (unchanged; JV formation mechanics ef-13..17 stay at S11) | | | | | | |

N reasons for the extras: "This section belongs to another deal shape (license-in / co-development / minority / JV); the shape of this project is <sub-track>." and for pt-06 "JV governance applies only to a JV structure."

Partnership keeps both lic and cdv sections because the sub-track does not say which contract shape was chosen. If a recorded deal-shape decision names one shape, the other section may be narrowed in a later version (Q4).

## 7. Completion count impact

Y = judgeable workspace items + judgeable extra items, for projects in scope (after cut-off or opted in).

| Sub-track | Today: workspace + extras = Y | Proposed: workspace + extras = Y | Change |
|---|---|---|---|
| m_and_a | 77 + 25 = 102 | 77 + 25 = 102 | none (byte-identical) |
| jv | 77 + 38 = 115 | 75 + 18 = 93 | -22 |
| strategic_investment | 77 + 0 = 77 | 71 + 0 = 71 | -6 (was -10 before the 2026-10-12 revision) |
| minority_investment | 77 + 38 = 115 | 71 + 16 = 87 | -28 (was -33) |
| partnership | 77 + 38 = 115 | 52 + 26 = 78 | -37 (was -38) |
| rbd | 77 + 15 = 92 | 77 + 15 = 92 | none in Y (two R reading lines added) |
| corporate_venture | 77 + 0 = 77 | 71 + 0 = 71 | -6 (was -10) |
| brownfield, null sub-track | 77 | 77 | none (no overlay applies; fail closed to A) |

"Today" assumes a project created on or after 2026-10-01 (seven domains counted, `dd-checklist-tailor.ts:650-653`) and after `WAVE_F_PREDICATE_DATE` (extras attached). Projects outside those cut-offs keep their current, smaller sets. The criterion text is unchanged ("every applicable item judged, zero mandatory unmet"); only the applicable set changes. `ddCompletionSummary`, the S9 decision count and the tab counts read the same scoped set.

A recorded `fail` (without waiver) on a mandatory item that is now N or X stays unmet until a person re-judges it (no silent removal of a negative finding) — same rule as greenfield.

## 8. Mechanism (recommendation: one generalized overlay schema, two files)

| Option | For | Against |
|---|---|---|
| 1. Static map in TypeScript | Fast | Governance in code; drifts from checklists |
| 2. `applies_when` on each checklist item | Next to the item | Touches 9 checklists under active translation; no reading/replacement model; m_and_a byte-identity risk |
| 3a. Add brownfield columns to the greenfield overlay file | One file | Changes a governance document now being implemented; mixes two approval sets; greenfield `expected_counts` and version churn |
| **3b. Same overlay schema, separate file `checklists/_overlays/brownfield-workspace-scope.yaml` (recommended)** | Reuses validator and loader; greenfield file untouched; independent version, approval and rollback | Validator and loader must be generalized from "the greenfield overlay" to "an overlay per track" |

Recommended file header (mirrors the greenfield overlay): `governance_doc_id: ovl-brownfield-workspace-scope`, `layer: checklist-overlay`, `version: 1.0.0`, `status: proposed`, `track: brownfield`, `procedure_id: shared-brownfield-dd`, `owner_agent` and `maintainer: process-governance-manager`, `sub_track_keys` (the seven values), `codes` (A, R, X, N), `fail_closed`, `legal_basis`, `expected_counts` per sub-track (section 5), `baseline_sub_track: m_and_a`, rows keyed by checklist id and item id with per-sub-track `{code, reading | replaced_by | na_reason, approved_by, approved_at}`, and an `extra_checklists` block (section 6) with per-sub-track `include_sections` or item lists plus N reasons. No `steps` key (brownfield has no step-to-tab map in scope; Q6).

Validator generalization (`checklists/_validate.ts`, overlay section at :120):
- iterate every `_overlays/*-workspace-scope.yaml`; dispatch track-specific rules on `track`;
- coverage: every item of the seven checklists present for every declared sub-track;
- brownfield: C rejected; `baseline_sub_track` column must be all A and its extras must equal `SUB_TRACK_DD_CHECKLISTS` unscoped;
- binding guard (unchanged rule): binding item never N or X, in workspace rows and in `extra_checklists` (bf-01..03 can never be excluded);
- X target must exist **and** be in a checklist attached to that sub-track (pt-03 for partnership);
- N needs `na_reason`, R needs `reading`; recompute and compare `expected_counts`;
- unapproved row: ignored by the loader (fail closed to A), reported by the validator as a warning.

Loader: generalize `workspaceOverlay()` (`greenfield-subtrack.ts:471`) to `workspaceOverlay(track)` and add a brownfield branch to `workspaceScopeContext` (`:795`) — or a sibling `brownfield-subtrack.ts` exporting the same `WorkspaceScopeContext` shape (recommended, keeps the greenfield module single-purpose). `scopedChecklistItems` gains an optional sub-track argument for extra-checklist section scoping. The brownfield branch in `extraChecklistsFor` (`dd-checklist-tailor.ts:576-585`) is unchanged; scoping happens on items, not on which checklists attach.

## 9. Grandfathering, cut-off and opt-in

1. **Nothing deleted.** No state row is removed, rewritten or re-statused for any project.
2. **Cut-off** `BF_WORKSPACE_SCOPE_DATE` (merge date), separate from `GF_WORKSPACE_SCOPE_DATE` and `WAVE_F_PREDICATE_DATE`. A brownfield project whose earliest policy pin (or `created_at`) is before it keeps the current view and count until a person opts in.
3. **Opt-in** reuses the ADR-0160 opt-in path (human-only, audited `migration_note`, re-pin to `ovl-brownfield-workspace-scope` 1.0.0, count preview before confirm). User decision 2026-10-12: the opt-in also attaches the sub-track extra checklists per `SUB_TRACK_DD_CHECKLISTS`, scoped by the overlay's `extra_checklists` exclusions and counted in Y, even for a project that predates `WAVE_F_PREDICATE_DATE` (X pointers such as fdd-01/fdd-07 -> pt-03 then resolve); the preview lists them (`extras_attached_by_opt_in`). Non-opted-in projects and m_and_a are unchanged. After opt-in: judgements on A/R items stay; judgements on N/X items move to "Judged under previous scope" with original status, author and time and leave Y; a `fail` on an N/X item stays unmet until re-judged.
4. **PRJ-QGB2W5** (strategic_investment, 37 rows): unchanged on deploy. Its 37 rows sit in commercial, legal and technical; under the overlay, ldd-07 and ldd-14 become N for SI (ldd-22 is R for SI since the 2026-10-12 revision), so after an opt-in those (if judged) would move to history. Preview shows the change; default is grandfathered.
5. **PRJ-T7T81A** (partnership, at S8, 0 S9 rows): grandfathered by date like every pre-cut-off project, but opting in has **no history effect** (nothing to move). Recommendation (Q1): opt it in when it enters S9, from the preview. Recomputed on a copy of the live database (2026-10-12): the project was created before 2026-10-01 and before `WAVE_F_PREDICATE_DATE`, so without the opt-in it counts 38 (three original domains, no extras); with the opt-in 29 workspace items (9 excluded) + 26 extras (partnership 11, deal-shape lic+cdv 15) = 55. Note: a person already recorded the opt-in for this project (pin 2026-10-11T23:27Z).
6. **demo-s1-s12-project** (m_and_a): unaffected by construction.
7. Rollback after opt-in restores the old view; all rows remain.

## 10. na-reason rule

N rows carry their reason in the overlay and are not instantiated as judgeable rows, so no user `na` is needed. A person may reinstate an N item (audited, with reason); it becomes judgeable. For in-scope brownfield projects, `naRequiresReason` returns true for the seven workspace checklists and the scoped extras (mirrors the greenfield extension), so data-dependent absences (section 3 principle) always carry a reason.

## 11. Review model

- **AI 1st (deterministic):** overlay validator (coverage, codes, C rejected, m_and_a all-A, binding guard incl. bf-01..03, X targets attached, reasons/readings, counts), glossary lint on reading text, m_and_a snapshot of selection, render input and counts.
- **AI 2nd (cross-domain, never the author's domain):**
  - risk-officer: every N/X row — does it weaken a kill-relevant check or invite optimism (fdd-01/fdd-07 X for PT, cdd-02/mdd-07/mdd-09 N for PT, hdd-02/03 N for minority stakes, fin-06/07/08 N);
  - legal-counsel: all ldd rows, hdd-06/07/09, fin-04/06/07/08, the deal-shape section mapping, ldd-15 readings (permit change-of-shareholding);
  - antitrust-agent: the M&A-specific items and their non-M&A readings — ldd-06, mdd-04, hdd-10, jvd-05 for JV, min-05 (foreign-investment screening) for MI, and F7 (validators declared applicable without checklist items);
  - partnership-agent and brownfield-agent: domain fit of the JV/MI/PT and SI/RBD/CV columns respectively;
  - auditor: coverage, m_and_a byte-identity, grandfathering.
- **Human final, per row:** each overlay row records `approved_by` / `approved_at`; unapproved rows load as A. Output split into verified / could not verify / needs judgement; reviewers declare what they could not check. Checklist applicability is governance and cannot pass on AI review alone.

## 12. Tests

- Validator: missing item -> A; C in brownfield rejected; any m_and_a non-A rejected; fin-09 N/X rejected; bf-01..03 excluded in extras rejected; X to a checklist not attached for the sub-track rejected; N without reason, R without reading rejected; count mismatch rejected; unapproved row ignored.
- Selection matrix: 7 sub-tracks + null sub-track x {before / after `BF_WORKSPACE_SCOPE_DATE`} x {opted in / not} x {before / after `WAVE_F_PREDICATE_DATE`} x {created before / after 2026-10-01}.
- Counts: Y per sub-track equals section 7; m_and_a snapshot of `listDdWorkspace` input, `ddCompletionSummary` and S9 decision count byte-identical to pre-change.
- Extras: minority sees only min-01..05 of deal-shape and 11 pt items; jv sees jvd only; partnership sees lic+cdv.
- Grandfathering fixture modelled on PRJ-QGB2W5 (37 rows unchanged before opt-in; after opt-in no row deleted, history lists ldd-07/14/22 if judged, `fail` on N item still unmet) and on PRJ-T7T81A (opt-in with zero rows).
- Greenfield regression: greenfield overlay, selection and counts unchanged after the validator/loader generalization.
- UI: reading lines, "Replaced by" pointers and excluded panel readable without colour; design:lint.

## 13. Non-goals

No checklist text change; no change to m_and_a; no change to `SUB_TRACK_DD_CHECKLISTS` (which extras a sub-track has), except that a recorded brownfield opt-in attaches them even before `WAVE_F_PREDICATE_DATE` (user decision 2026-10-12, section 9.3); no change to the six-validator registry (ADR-0048), kill criteria, RAG capping, waiver mechanism, gate or approval authority; no `brownfield-dd` procedure step change; no DB schema change; no new extras for SI/CV in v1 (Q2); per-target comparison DD (ADR-0157) follows the same scope but no new comparison behaviour.

## 14. Rollback

Revert the PR(s). The brownfield overlay file and branch disappear; selection falls back to today's behaviour (section 2); all state rows remain; opt-in pins to the brownfield overlay become inert. The greenfield overlay is unaffected because it is a separate file and the generalized validator keeps its rules.

## 15. Open questions (with recommendations)

1. PRJ-T7T81A opt-in. Recommendation: opt in when it enters S9 (no history to move); default stays grandfathered until a person acts. Counts: 38 without, 55 with the opt-in (29 workspace + 26 extras); the opt-in has already been recorded (section 9.5).
2. Should strategic_investment and corporate_venture get the deal-shape `min-*` section as an extra (both are non-control stakes)? Recommendation: yes in a v1.1 after this lands (adds 5 items each; a scope addition, so a separate approval), not in v1.
3. rbd: should any acquisition items be re-read as technology-led (for example cdd-02, mdd-08/09 when the source has no revenue)? Recommendation: no track rule; the absence is data-dependent and goes through `na` with reason. Revisit after the first two brownfield rbd deals.
4. partnership: narrow deal-shape to lic or cdv when a recorded deal-shape decision names one. Recommendation: yes, as a later version driven by that record, not by sub-track.
5. F7 — validators declared applicable for all brownfield sub-tracks without checklist items outside m_and_a. Recommendation: separate ADR-0048 review with antitrust-agent and compliance-officer (minority and partnership arguably need antitrust and foreign-investment screening only); out of scope here.
6. Should brownfield get the greenfield-style step-to-tab map and scope panel? Recommendation: no for v1; brownfield has no panel today and the procedure has no sub-track predicates.
7. Overlay layout: one file per track (3b) vs one merged file. Recommendation: 3b (separate approval, version and rollback).
8. Risk-officer finding 1 (HIGH, review 2026-10-12): silent drop of merger-control and FDI items for strategic_investment, corporate_venture and minority_investment. Recommendation: attach ma-01..03 and min-05 for opt-in projects of these sub-tracks. Not implemented; awaiting a user decision.

## 16. Task split

| Row | Task | Agent |
|---|---|---|
| 0 | This design + ADR-0162 draft (Row 0) | process-governance-manager |
| 1 | Overlay YAML `checklists/_overlays/brownfield-workspace-scope.yaml` (sections 4 and 6 as proposals); collect per-row human approvals | process-governance-manager |
| 2 | Generalize overlay validator in `checklists/_validate.ts` (section 8 rules) with greenfield regression | backend-engineer |
| 3 | Loader and scope (`brownfield-subtrack.ts` or generalized `workspaceOverlay(track)`), `BF_WORKSPACE_SCOPE_DATE`, opt-in reuse with preview, scoped extras in `scopedChecklistItems`, `ddCompletionSummary`, `naRequiresReason`; tests (section 12) | backend-engineer |
| 4 | DdStage brownfield: reading lines, "Replaced by" pointers, excluded panel, "Judged under previous scope", opt-in preview; m_and_a render unchanged | frontend-engineer |
| 5 | Cross review (section 11) | risk-officer, legal-counsel, antitrust-agent, partnership-agent, brownfield-agent, auditor |
| 6 | /sync | pm |

Dependency: the greenfield rows (sibling design) land first; rows 2-3 here generalize code they introduce. The section 6B seven-domain render fix of the sibling design is a prerequisite (brownfield items in financial, hr, market and financing must be renderable before they can be scoped).
