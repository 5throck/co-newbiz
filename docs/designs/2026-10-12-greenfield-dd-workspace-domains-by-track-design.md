# Greenfield S9 Workspace Domains by Sub-Track (Plan Verification Scoping)

- Date: 2026-10-12
- Status: Draft (Row 0 Design Gate)
- Owner: process-governance-manager (functional domain lead)
- ADR: ADR-0160 (Proposed) addendum "2026-10-12 (b)" — `docs/adr/0160-greenfield-dd-and-structure-by-subtrack.md`
- Parent design: `docs/designs/2026-10-11-greenfield-dd-and-investment-structure-by-subtrack-design.md` (sub-track selection, `site_required`, cut-off and opt-in)
- Related: ADR-0099 (custom checklist items), ADR-0148 (seven DD workspace domains; the comment at `app/web-next/lib/dd-checklist-tailor.ts:38` wrongly cites ADR-0104), ADR-0157 (optional per-target DD), migration 0136 (routing vars `project.sub_track`, `project.site_required`)

## 1. Problem (observed live)

On `/projects/01M1MXQN21DP8KYHNW3GDSE4PW/dd` (greenfield, `existing_business_rbd`) the S9 workspace shows the same domain tabs, with the same items, as a brownfield acquisition. The live GET renders **three** shared tabs (commercial, technical, legal): `DD_DOMAINS` at `app/web-next/lib/dd-checklist-tailor.ts:40-42`, consumed by `listDdWorkspace` (:609-617). The other four ADR-0148 domains (financial, hr, market, financing; `DD_WORKSPACE_CHECKLISTS` in `app/web-next/lib/library.ts`) are counted in completion for projects created on or after 2026-10-01 (:505-512) but rendered nowhere — a separate bug (section 6B). The comment at :38 cites ADR-0104; the seven-domain decision is ADR-0148. Many items presuppose an acquisition target: customer concentration and churn of a target, win/loss, channel checks, remaining equipment life, bottlenecks of an existing plant, target contracts and litigation, change of control, closing funds flow, escrow, reverse termination fee, stay bonuses, TUPE.

A greenfield S9 is a **verification of our own plan**, not a diligence of somebody else's company. Items must either be read as plan evidence, be replaced by an item that already asks the right question, or be marked not applicable with a reason the user can read.

ADR-0160 already scopes the site steps (`GF_SITE_ITEM_SCOPE` = tdd-01, tdd-02) and adds sub-track checklists (`GF_SUB_TRACK_DD_CHECKLISTS`). This design extends the same idea to every item of the seven ADR-0148 workspace domains (three rendered today plus the four restored by section 6B).

## 2. Scope

In scope: the 77 items of the seven ADR-0148 workspace checklists (three tabs rendered today; four restored by the prerequisite fix in section 6B) (cdd 8, tdd 8, ldd 22, mdd 11, fdd 8, hdd 11, fin 9) for greenfield sub-tracks null (new site), `existing_business_rbd`, `intra_venture`.

**Brownfield behaviour is unchanged for every item** (all sub-tracks: Apply as-is, current code path, byte-identical selection and counts). This is stated once here and applies to every row of section 4.

Out of scope: the sub-track extra checklists (rbd-technology, entity-formation, site-selection) which are already scoped by ADR-0160; checklist text (other agents are translating checklists now; this design changes no YAML text).

## 3. Classification codes

| Code | Meaning | Effect on the workspace |
|---|---|---|
| A | Apply as-is | Item shown unchanged, counts in Y |
| R | Apply reinterpreted | Item shown with a greenfield reading line under the original text; counts in Y |
| X | Replace | Item not shown as a judgeable row; a pointer row names the replacing item and where it is judged; not in Y |
| N | Not applicable by track rule | Item listed in the "Excluded by track rule" panel with the reason text below; not in Y |
| C | Conditional (existing ADR-0160 `site_required` rule) | A when `site_required = true`, otherwise N with the site rule reason; unchanged mechanism |

Every row below is a **proposal**. Checklist applicability is governance: each row requires a recorded human sign-off (section 10) before it takes effect.

## 4. Item-level classification

Columns: null = greenfield without sub-track (new site / new plant); RBD = `existing_business_rbd`; IV = `intra_venture`. "Greenfield reading / replacement / reason" is the text shown to the user (English here; Korean UI text via glossary-curator).

### 4.1 Commercial (chk-commercial-dd-checklist)

| Item | Topic | null | RBD | IV | Greenfield reading / replacement / reason |
|---|---|---|---|---|---|
| cdd-01 | Customer concentration | R | R | R | Concentration of the planned revenue base: share of top prospective customers in LOIs, offtake or pipeline (null, IV); for RBD, our own existing customers the expansion depends on, from our sales data |
| cdd-02 | Customer churn history | N | R | N | null/IV reason: "No customer history exists for a new establishment; retention is an assumption tested under cdd-03 and mdd-02." RBD: churn of our own existing customers in the target segment |
| cdd-03 | Pricing power | R | R | R | Can the planned price absorb input-cost increases; plan price assumption tested against market pass-through evidence |
| cdd-04 | Win/loss analysis | X | R | N | null: replaced by gf-09 (competitor capacity expansion vs pricing assumption; judged at Screening/Pre-FS in the greenfield feasibility checklist). IV reason: "A new venture has no sales record to analyse; prospective-customer evidence is tested under cdd-07 and mdd-03." RBD: our own win/loss record in the segment |
| cdd-05 | Channel check | R | A | R | null/IV: the planned channel validated with prospective distributors or buyers. RBD: our existing channels, as-is |
| cdd-06 | Findings tied to assumption_key / value_impact | A | A | A | — |
| cdd-07 | Expert interview triangulation | A | A | A | — |
| cdd-08 | Revenue quality (recommended) | R | R | R | null/IV: forward revenue quality on plan assumptions (concentration, margin, collection period, recurrence of the planned revenue; greenfield-feasibility skill). RBD: revenue quality of the existing business line the expansion builds on |

### 4.2 Technical (chk-technical-dd-checklist)

| Item | Topic | null | RBD | IV | Greenfield reading / replacement / reason |
|---|---|---|---|---|---|
| tdd-01 | Site visit | A | C | C | null: as-is (no `site_required` control exists for null; site always applies). RBD/IV: existing ADR-0160 rule (`GF_SITE_ITEM_SCOPE`) |
| tdd-02 | Site visit evidence | A | C | C | As tdd-01 |
| tdd-03 | TRL of core production process | A | A | A | Planned process TRL/MRL (core IP TRL stays in rbd-01 for RBD/IV) |
| tdd-04 | Bottleneck process | R | A | R | null/IV: bottleneck in the planned process design and capacity model. RBD: our own existing line used by the expansion |
| tdd-05 | Remaining useful life of equipment | R | R | R | null: life and replacement cycle of the planned new equipment, folded into the tdd-07 capex verification reading. RBD: remaining life of our own equipment reused by the expansion. IV: remaining useful life of equipment the parent contributes to the venture (changed from N after risk-officer review 2026-10-12; user decision pending) |
| tdd-06 | EHS liability exposure | R | R | R | Prospective EHS compliance and permit exposure of the planned operation; for null also site legacy contamination (with ldd-16); for RBD our existing site's exposure the expansion adds to |
| tdd-07 | Independent capex verification | A | A | A | — |
| tdd-08 | Production line certification status | R | R | R | Certification plan for planned lines (roadmap and lead time, consistent with gf-08) rather than current status |

### 4.3 Legal (chk-legal-dd-checklist)

| Item | Topic | null | RBD | IV | Greenfield reading / replacement / reason |
|---|---|---|---|---|---|
| ldd-01 | Good standing of target and subsidiaries | N | N | N | Reason: "No entity is acquired; our own corporate standing is not a review question; the venture entity's formation is covered by ef-01 (entity-formation)." |
| ldd-02 | Cap table | N | N | X | null/RBD reason: "No acquired share capital." IV: replaced by ef-03 (share structure and allocations) |
| ldd-03 | Shareholder consents, ROFR, tag/drag | N | N | R | null/RBD reason: "No existing shareholders of a target." IV: terms of the venture shareholders' agreement (parent, founders, co-investors) |
| ldd-04 | Signing authority | N | N | N | Reason: "No target to bind; our own authority follows the group approval chain (two-tier approval); for IV, entity authorities are set at formation (S11, ef-06)." |
| ldd-05 | Borrowing and guarantee restrictions | R | R | R | Restrictions in our existing financing (negative pledge, covenants, guarantee limits) on funding this plan |
| ldd-06 | Top-20 contract change-of-control scan | N | R | R | null reason: "No change of control occurs in a new establishment; planned key contracts (EPC, offtake, supply) are tested under cdd-05 and tdd-07." RBD/IV: whether our own exclusivity, non-compete or MFN commitments block the new business, and whether moving contracts or IP into a new entity needs counterparty consent (changed from N after risk-officer review 2026-10-12; user decision pending) |
| ldd-07 | Asset vs share transfer | N | N | R | null/RBD reason: "No acquisition or transfer transaction, and no contracts or IP move into a new entity." IV: whether moving contracts and IP into the new entity needs counterparty consent or transfers automatically (changed from N after risk-officer review 2026-10-12; the earlier reason "No transfer transaction" was wrong for IV; user decision pending) |
| ldd-08 | Loans requiring consent at close | N | N | N | Reason: "No closing; our existing loan restrictions are covered by ldd-05." |
| ldd-09 | Litigation and regulatory investigations | R | R | R | Pending or threatened disputes that affect the plan (site, IP, permits, our own litigation in this business line) |
| ldd-10 | IP inventory and inventor assignment | R | R | X | null: inventory of IP the plan relies on (owned or licensed). RBD: residual scope beyond rbd-03 (FTO and ownership) — inventory completeness and inventor-to-company assignment. IV: replaced by ef-07 (IP assignment into the entity) and rbd-03 |
| ldd-11 | In/out licences | R | R | R | Licences the plan needs and their terms; the change-of-control trigger part is not applicable |
| ldd-12 | IP encumbrances, fees, disputes | R | R | R | null: encumbrances on IP the plan relies on. RBD/IV: residual scope beyond rbd-03 — security interests, maintenance and renewal fees, pending or threatened IP disputes |
| ldd-13 | PIIA coverage | R | R | X | null: project staff employment terms carry invention assignment and confidentiality. RBD: PIIA coverage of the R&BD team whose work becomes the expansion IP. IV: replaced by ef-07 |
| ldd-14 | Union and pension (CBA succession) | R | R | R | Whether our existing collective agreement extends to the new site or the expansion staff; for IV, whether it follows staff moved from the parent |
| ldd-15 | Permit transfer classification | X | R | R | null: replaced by gf-04 (permit critical path; judged at Screening/Pre-FS in the greenfield feasibility checklist). RBD: whether existing permits cover the expanded scope or need amendment. IV: permits the venture needs in its own name vs those held by the parent |
| ldd-16 | Environmental notices, land survey, contamination | A | C | C | null: candidate-site history as-is. RBD/IV: applies only when `site_required = true` (site rule reason otherwise) |
| ldd-17 | Real estate title and leases | R | R | R | Title or lease rights for the planned site or space (for IV, use rights granted by the parent); lease change-of-control part not applicable |
| ldd-18 | Privacy | R | R | R | Compliance design of the planned data processing (policy, cross-border transfer basis) |
| ldd-19 | Anti-bribery and sanctions screening | R | R | R | Screening of the plan's counterparties: partners, suppliers, EPC contractors, incentive intermediaries |
| ldd-20 | Tax filings current | N | N | N | Reason: "No acquired entity; the plan's tax position is reviewed under fdd-04." |
| ldd-21 | Findings register (RAG) | A | A | A | — |
| ldd-22 | Korean business-transfer employee succession | N | N | R | null/RBD reason: "No business transfer; staff are hired or reassigned. Moving parent staff into a new entity (transfer or secondment consent) is judged at entity-formation ef-08 (people transfer)." (pointer added after legal review 2026-10-12, overlay 1.1.0, DEC-20261012-01). IV: staff moving from the parent to the venture (individual consent or secondment; cross-reference ef-08 at S11) |

### 4.4 Market (chk-market-dd-checklist)

| Item | Topic | null | RBD | IV | Greenfield reading / replacement / reason |
|---|---|---|---|---|---|
| mdd-01 | TAM/SAM triangulation | A | A | A | — |
| mdd-02 | Growth drivers vs management assumptions | R | R | R | Our plan's growth assumptions vs independent market outlook |
| mdd-03 | Competitive landscape from customers, win/loss | R | R | R | Prospective customers' purchase criteria; win/loss part only from our own record (RBD) |
| mdd-04 | Share, concentration, pricing power | A | A | A | — |
| mdd-05 | Target's moat | R | R | R | Moat the plan claims for us, rated on the same scale |
| mdd-06 | Concentration (uses cdd-01) | R | R | R | Follows the cdd-01 reading |
| mdd-07 | Churn and retention (uses cdd-02) | N | R | N | Follows cdd-02; reason as cdd-02 |
| mdd-08 | 80/20 revenue analysis | N | R | N | null/IV reason: "No revenue to analyse." RBD: existing segment revenue |
| mdd-09 | Expansion revenue breadth | R | R | R | null/IV: concentration on the plan's anchor customers and dependence on expansion revenue, judged together with cdd-01 (changed from N after risk-officer review 2026-10-12; user decision pending). RBD: expansion revenue of our existing customers |
| mdd-10 | Distribution structure | R | R | R | Planned distribution route, pricing logic and customer mix |
| mdd-11 | Thesis verdicts and bid adjustment | R | R | R | Verdict per plan thesis; the adjustment targets the investment amount or tranche conditions instead of a bid price |

### 4.5 Financial (chk-financial-dd-checklist)

| Item | Topic | null | RBD | IV | Greenfield reading / replacement / reason |
|---|---|---|---|---|---|
| fdd-01 | Quality of earnings | N | R | N | null/IV reason: "No historical earnings exist." RBD: QoE of the existing business line baseline |
| fdd-02 | Working capital | R | R | R | Planned NWC requirement, seasonality and minimum cash in the plan |
| fdd-03 | Debt and contingent liabilities | R | R | R | Planned debt plus our contingent obligations created by the plan (guarantees, incentive clawback) |
| fdd-04 | Tax position | R | R | R | Plan tax assumptions: effective rate, incentives, transfer pricing of intra-group flows |
| fdd-05 | Cash-flow quality | R | R | R | Capex split maintenance/growth in the plan; DSO/DPO assumptions vs peers |
| fdd-06 | Related-party transactions | R | R | R | Intra-group supply, service and licence terms in the plan at arm's length (key for IV) |
| fdd-07 | Management vs audited accounts | N | R | N | null/IV reason: "No accounts exist yet." RBD: segment management accounts vs audited statements |
| fdd-08 | Forecast assessment | A | A | A | — |

### 4.6 HR (chk-hr-dd-checklist)

| Item | Topic | null | RBD | IV | Greenfield reading / replacement / reason |
|---|---|---|---|---|---|
| hdd-01 | Key person map | R | R | R | Key roles the plan needs, with hiring or retention plan per role |
| hdd-02 | Stay bonus after closing | R | R | R | null/RBD: new hiring, securing key staff, and retention pay (stay incentives) for the new business (changed 2026-10-12, see change note). IV: founding-team retention incentives (for example venture equity) |
| hdd-03 | Day-1 retention plan | N | N | N | Reason: "No Day 1 of an acquisition; key-role retention is covered by hdd-01." |
| hdd-04 | Organisation documentation | R | R | R | Planned organisation chart and headcount plan |
| hdd-05 | Leadership bench | R | R | R | Core-team readiness of the planned leadership (see open question Q4 of the parent design) |
| hdd-06 | CBA | R | R | R | Same reading as ldd-14 |
| hdd-07 | Pension and benefit liabilities | R | R | R | Benefit cost assumptions in the plan; for IV, liabilities that move with transferred staff |
| hdd-08 | EU works council | N | N | N | Reason: "No transaction to consult on; reinstate only if the plan restructures an existing EU workforce." |
| hdd-09 | Employment succession regime | R | R | R | null/RBD: jurisdiction-specific employment-relationship rules and collective-agreement effects for staff newly hired by the new business (changed 2026-10-12). IV: regime for staff moving from the parent |
| hdd-10 | Culture gap | R | R | R | null/RBD: design and culture of the new organisation (changed 2026-10-12). IV: venture autonomy vs parent culture |
| hdd-11 | Day-1 and 100-day HR plan | R | R | R | Hiring and onboarding ramp plan (consistent with gf-06 / ss-07) |

### 4.7 Financing (chk-financing-plan-checklist)

| Item | Topic | null | RBD | IV | Greenfield reading / replacement / reason |
|---|---|---|---|---|---|
| fin-01 | Sources and uses | A | A | A | — |
| fin-02 | Signed commitment letters | R | R | R | At plan stage: internal funding approval or indicative lender terms; signed letters belong to S11 |
| fin-03 | Covenant headroom | A | A | A | — |
| fin-04 | Funds-flow memorandum at closing | R | X | X | No closing. null: funding drawdown plan (timing, accounts, FX windows of capex draws) as the greenfield reading. RBD/IV: replaced by rbd-15 (staged funding as real options); tranches recorded in `capex_tranche` (migration 0136) |
| fin-05 | FX plan | R | R | R | FX plan for multi-currency capex and funding rather than purchase consideration |
| fin-06 | Certain-funds structure | N | N | N | Reason: "Certain funds protects a seller at signing; there is no seller." |
| fin-07 | Escrow and paying agent | N | N | N | Reason: "No purchase price or indemnity to secure." |
| fin-08 | Reverse termination fee | N | N | N | Reason: "No acquisition agreement." |
| fin-09 | Certainty of funds before IC | A | A | A | Binding item: applied as-is in every sub-track (changed from R after risk-officer review 2026-10-12; binding items must be A in every column). The former reading (funding certainty of the staged plan: internal approval plus tranche release conditions) remains guidance for reviewers |

## 5. Classification summary

| Category | null | RBD | IV |
|---|---|---|---|
| A — Apply as-is | 14 | 13 | 11 |
| R — Apply reinterpreted | 42 | 47 | 44 |
| X — Replace | 2 | 1 | 4 |
| N — Not applicable | 19 | 13 | 15 |
| C — Conditional on `site_required` (existing rule) | 0 | 3 | 3 |
| Total | 77 | 77 | 77 |

Counts were computed mechanically (awk over the section 4 tables). Judgeable items in the seven workspace domains (A+R, plus C when `site_required = true`): null 56 (site items are A for null), RBD 60 (+3), IV 55 (+3) out of 77 (after the risk-officer review change note below; previously 55 / 59 / 51). Brownfield: 77, unchanged (after the section 6B fix; 30 rendered today).

Change note (2026-10-12): at the user's request, hdd-02, hdd-09 and hdd-10 were reclassified from N to R for the null and `existing_business_rbd` sub-tracks (`intra_venture` was already R; hdd-03 and hdd-08 stay N). Reason given by the user: establishing a new entity or a new team needs the people and organisation items (hiring and retention, employment-relationship rules for new hires, organisation design and culture). Counts moved from null 52 to 55 and RBD 56 to 59 (+3 site-conditional unchanged); IV 51 unchanged.

Change note (risk-officer review 2026-10-12; user decision pending): fin-09 moved R -> A in all three sub-tracks (binding items must be A in every column; the overlay validator now rejects R, X, N and C on binding items). Reclassified N -> R: ldd-06 for RBD and IV, ldd-07 for IV, tdd-05 for IV, mdd-09 for null and IV. Counts: null A 13 -> 14, N 20 -> 19, judgeable 55 -> 56; RBD A 12 -> 13, N 14 -> 13, judgeable 59 -> 60; IV A 10 -> 11, R 41 -> 44, N 19 -> 15, judgeable 51 -> 55. The rows keep their 2026-10-12 approval record (required by the validator) with a note marking the change as pending the user's decision.

## 6. Target state

- **No domain tab disappears** for any greenfield sub-track: every tab keeps at least four judgeable items. A tab whose judgeable set would become empty is hidden and listed in the excluded panel (rule kept for future changes; not triggered today).
- Tabs for greenfield show the plan-verification framing. Proposed English working names (final Korean labels by glossary-curator, human chooses): Commercial plan, Technical plan, Legal and regulatory plan, Market evidence, Financial plan, People plan, Funding plan. Brownfield labels unchanged.
- Each tab shows: judgeable rows (A as-is; R with a "Greenfield reading" line), a pointer block "Replaced by" (X) linking to the replacing item and its stage, and a collapsed "Excluded by track rule" panel (N, and C when the site is out of scope) with rule id and reason text. Text labels, not colour (Onyx 3.0).
- Sub-track extra checklists (rbd-technology, entity-formation scoped ef-01/03/07) stay as ADR-0160 defines them. site-selection stays out of the S9 workspace scope (it is judged at Screening/Pre-FS) and gets no tab.
- **Replacement targets in earlier stages.** gf-04, gf-09 and gf-10 (greenfield-feasibility checklist) are judged at Screening/Pre-FS. A pointer row shows that earlier judgement read-only with its stage and status; if the target was never judged, the original S9 item reverts to judgeable (fail closed). (Former open question 4, now decided.)
- **Where the count lives.** null: no sub-track panel is rendered, so "Judged X / Y" stays in the S9 stage header. RBD and IV: the count lives only in the scope-summary panel and the stage header omits it. Brownfield: stage header, unchanged.

## 6B. Prerequisite bug fix: render all seven ADR-0148 domains

- **Bug.** `DD_DOMAINS` (`dd-checklist-tailor.ts:40-42`) lists only commercial, technical and legal, so `listDdWorkspace` (:609-617) renders three tabs. Completion (:505-512) already counts all seven `DD_WORKSPACE_CHECKLISTS` for projects created on or after 2026-10-01. Items in financial, hr, market and financing are counted but cannot be judged anywhere, which can block S9 completion.
- **Fix (independent of greenfield scoping, its own commit):** widen `DD_DOMAINS`, `DD_DOMAIN_LABEL` (`lib/labels.ts`), `DD_DOMAIN_TO_SPEC_ACTIVITY` / `DD_DOMAIN_AGENTS` and the custom-item domain type to the seven domains; correct the comment at :38 to ADR-0148.
- **Brownfield effect (explicit):** four new tabs appear for brownfield projects too. This is a bug fix, not a scope change: those items are already in the completion denominator. For projects created before 2026-10-01 (not counted at :505-512) the new tabs are shown as "Not required for this project (created before 2026-10-01)", read-only, and do not enter Y, so older projects' counts do not change.

## 6A. One surface: sub-track scope panel merged into the tabs

### 6A.1 Problem (user finding)

On greenfield `/projects/<id>/dd`, the sub-track scope panel (`components/GreenfieldScopePanel` with `lib/greenfield-dd-view.ts`) lists the eight `greenfield-dd` steps as applies/excluded with reasons, while the tabs below list the checklist items those steps are judged in. The same evidence appears twice in two shapes; the user cannot tell where to judge, and the completion state is not stated in one place.

### 6A.2 Decision

- **Judging happens only in the tabs.** The panel no longer lists steps.
- The panel becomes a **compact scope summary**: sub-track, `site_required` status with its confirmation control (the only write action on the panel), opt-in state, warnings, and the single completion line.
- Each procedure step is **mapped onto the tab and items it is judged in**; each tab header carries a small "Serves step N" tag with an in-scope / out-of-scope text label. No second list.
- Steps without a checklist (4 valuation bridge, 5 gate record, 6 core-team readiness) get a place in a fixed tab **"Plan readiness"** (last tab) holding three status rows that link to their artefacts; they are not checklist items and do not enter Y.
- The completion count "Judged X / Y" is stated **once**: in the panel summary for RBD/IV, in the stage header for null (no panel) — see section 6. Tabs show their own per-tab count only as "x of y in this tab" without restating the total.

### 6A.3 Mapping: step -> tab / checklist -> items

| Step | Purpose | Tab | Checklist / items | Applies (null / RBD / IV) |
|---|---|---|---|---|
| 1 | Site visit | Technical plan | technical-dd tdd-01, tdd-02 (site-selection not in the S9 workspace; judged at Screening/Pre-FS) | yes / if `site_required` / if `site_required` |
| 2 | Talent pipeline | People plan | hdd-11 (R); ss-07 shown as a read-only Pre-FS pointer | yes / replaced by step 6 / replaced by step 6 |
| 3 | Community acceptance | Legal and regulatory plan (step tag only) | no S9 workspace item; ss-08 shown as a read-only Pre-FS pointer | yes / if `site_required` / if `site_required` |
| 4 | DD-to-valuation bridge | Plan readiness (status row) | no checklist; artefact `dd_finding.value_impact` links (cdd-06, ldd-21 feed it) | yes / yes / yes |
| 5 | Gate record, open Entity IC | Plan readiness (status row) | no checklist; gate record | yes / yes / yes |
| 6 | Core-team readiness | Plan readiness (status row) + People plan | `org-readiness-assessment` artefact; hdd-01, hdd-05 (R) as supporting items | no / yes / yes |
| 7 | Technology and market plan verification | R&BD technology; Market evidence | rbd-technology (all in scope, TRL/MRL rows, rbd-05, rbd-07); market-dd per section 4.4 | excluded (as in `greenfield-subtrack.ts`) / yes / yes |
| 8 | Entity readiness | Entity formation | entity-formation ef-01, ef-03, ef-07 | no / no / yes |
| — | (no step; seven workspace domains) | Commercial, Technical, Legal, Market, Financial, People, Funding plan | section 4 classification | per section 4 |

A tab that serves no step shows no step tag. A tab whose step is out of scope is hidden and named in the panel's "Out of scope" line with the reason (for example the R&BD technology tab for null). Out-of-scope site steps are shown as an out-of-scope step tag on the Technical plan tab, not by hiding the tab.

### 6A.4 Wireframe (Onyx 3.0)

```
+----------------------------------------------------------------------------+
| S9 Plan verification            [sub-track: existing_business_rbd]          |  heading: type.title, color.text.primary
|----------------------------------------------------------------------------|
| Scope summary (surface.raised, radius.md, space.4)                          |
|  Site required:  Not confirmed  (text label + icon, never colour only)      |
|                  [ Confirm site requirement ]   <- the ONE primary action  |  button.primary
|  Out of scope:   Site visit (step 1, 3) — site not required (confirmed by …)|  type.body.sm, color.text.secondary
|  Judged 18 / 59    Mandatory unmet 0    Excluded by track rule 17 (view)    |  the only total count on the page
|  Warnings: none                                                             |  status.warning token when present
|----------------------------------------------------------------------------|
| Tabs: Commercial plan | Technical plan | Legal and regulatory plan | Market |
|       evidence | Financial plan | People plan | Funding plan | R&BD tech |    |
|       Plan readiness                                                        |
|----------------------------------------------------------------------------|
| Technical plan     Serves step 1 (out of scope)   4 of 6 judged in this tab |  tag: badge.neutral with text
|  tdd-03  TRL of core production process            [status select]          |
|  tdd-04  Bottleneck process                                                  |
|          Greenfield reading: bottleneck in our existing line ...            |  type.body.sm, color.text.secondary
|  tdd-05  Remaining useful life                                               |
|          Greenfield reading: our own equipment reused by the expansion      |
|  > Excluded by track rule (2)    > Judged under previous scope (0)          |  collapsed disclosure
+----------------------------------------------------------------------------+
```

- One primary action per view: "Confirm site requirement" while unconfirmed; once confirmed the panel has no primary button and the primary action belongs to the tab content (save judgement). The opt-in action, when offered, is a secondary button with a preview of the count change.
- Status is always text plus icon; tokens only, no hard-coded colours (design:lint). Disclosures are keyboard operable and announce item counts.
- Brownfield: panel not rendered (unchanged), tabs and labels unchanged.

### 6A.5 Code and UI changes (task level)

- `lib/greenfield-dd-view.ts`: replace the step-row list builder with `stepTabMap(scope)` returning per-tab `{steps, inScope, reason}` and a `scopeSummary(scope, counts)`; keep `showSubTrackPanel` semantics; remove `showStepList` use from the panel.
- `components/GreenfieldScopePanel`: reduce to summary + `site_required` confirmation + opt-in (secondary) + the single X/Y line; no step list.
- `components/stages/DdStage.tsx`: tab header step tag, per-tab "x of y in this tab", reading lines, "Replaced by" pointers, excluded and previous-scope disclosures, new "Plan readiness" tab with three status rows (steps 4, 5, 6) linking to their artefacts; remove the duplicated total count from the stage header for greenfield.
- Server (`greenfield-subtrack.ts`): expose the step-to-tab mapping derived from the procedure step ids (no new source of truth: the mapping table above lives in the overlay of section 7 under a `steps` key, validated against `greenfield-dd` step ids by the existing drift test).
- Brownfield path untouched; snapshot test asserts identical render input.

## 7. Mechanism options

| Option | Description | For | Against |
|---|---|---|---|
| 1. Static map in code | Extend `lib/greenfield-subtrack.ts` with `GF_WORKSPACE_ITEM_SCOPE[checklistId][itemId] = {null, existing_business_rbd, intra_venture}` like `GF_SITE_ITEM_SCOPE` | Fastest, mirrors existing pattern, no YAML edits | Governance decision (applicability, reason text) lives in TypeScript; reviewed as code, not as a governance document; easy to drift from checklists |
| 2. Machine `applies_when` per checklist item | Add predicates over `project.sub_track` to each item in the seven checklist YAMLs (same evaluator as `greenfield-dd` steps, migration 0136) | Applicability next to the item; single evaluator | Touches 7 checklists under active translation; YAML items carry no reading/replacement text model; brownfield files change (byte-identity risk); predicates cannot carry the user-facing reason or reading |
| 3. Checklist overlay (recommended) | One governance document `checklists/_overlays/greenfield-workspace-scope.yaml` (governance_doc_id, version, owner, maintainer) keyed by checklist id and item id, with per-sub-track `{code, reading, replaced_by, na_reason}`; loaded by `lib/library.ts`, validated by `_validate.ts` (every item of the seven checklists present, codes valid, X targets exist, N has a reason, R has a reading) | Governance artefact with version and policy pin; checklist text untouched; brownfield files untouched; reason and reading text are first-class; one place to review | New loader and validator; overlay must be kept in sync when checklist items are added (validator fails closed: an item missing from the overlay is treated as A) |

**Recommendation: Option 3**, with the code consuming it through one function next to `naRequiresReason` (for example `workspaceItemScope(projectId, checklistId, itemId)`), so the selection still has a single owner module. The overlay is a governance document: changes follow the `policies/**`/`procedures/**` lifecycle row (impact analysis, policy pin, ADR addendum). An item missing from the overlay fails closed to A, never to N.

## 8. Completion criterion and counts

- The completion criterion text is unchanged: "every applicable item judged, zero mandatory unmet". Only the applicable set changes.
- Y (judged denominator) = A + R items (+ C when the site is in scope) of in-scope checklists. X and N rows are not in Y.
- A binding item (mandatory and `waiver_eligible: false`) classified N or X: the overlay validator **always rejects** that classification (no exemption, no ADR-reference escape); binding items always stay in Y. Verified: all 31 item ids classified N or X in the first draft are `waiver_eligible: true`, which covers the 29 ids still N or X after the corrections; the only binding item among the seven checklists, fin-09, is A in every sub-track (R until the risk-officer review 2026-10-12; the validator now rejects any non-A code on a binding item); no kill criterion references any of these ids.
- `ddCompletionSummary` and the S9 decision count read the same scoped set, so the tab counts, the stage header and the gate check agree.

## 9. Existing judgements and PRJ-DSE4PW (grandfathering)

`01M1MXQN21DP8KYHNW3GDSE4PW` has 37 judgements recorded under the old scope. Rules:

1. **Nothing is deleted or invalidated.** No item state row is removed, rewritten or re-statused by this change, for any project.
2. **Grandfathering by default.** A project whose earliest policy pin (or `created_at`) is before a new cut-off constant `GF_WORKSPACE_SCOPE_DATE` (merge date) keeps the old view and the old X/Y count until a person opts in. PRJ-DSE4PW is therefore unchanged on deploy: same tabs, same items, same 37 judgements, same count.
3. **Opt-in** reuses the ADR-0160 opt-in path (human-only, audited `migration_note`, re-pin to the overlay version). After opt-in:
   - judgements on A/R items stay and count as before;
   - judgements on items now N or X are kept and shown in a "Judged under previous scope" section of the excluded panel, with their original status, author and timestamp; they leave Y;
   - a recorded `fail` on an item now N or X is **not** cleared: it stays counted as unmet until a person re-judges it (no silent removal of a negative finding);
   - a recorded `pass`/`na`/`waived` on an N/X item leaves Y and is retained as history;
   - the resulting X/Y is shown before the opt-in is confirmed (preview), so the person sees the count change.
4. Rollback after opt-in restores the old view; the 37 rows are still there.

## 10. na-reason rule and cut-off interaction

- ADR-0160 requires a reason on `na` for sub-track-ruled items. Overlay N rows carry their reason in the overlay; the item is not instantiated as a judgeable row, so no user-entered `na` is needed. If a person reinstates an N item (allowed, audited, with a reason), it becomes judgeable and normal rules apply.
- A person may still set `na` on an A/R item; for greenfield sub-track projects within scope, `naRequiresReason` returns true for all seven workspace checklists (extension of the existing rule).
- Cut-off: `GF_WORKSPACE_SCOPE_DATE` is separate from `GF_SUBTRACK_PREDICATE_DATE` so that projects which opted into ADR-0160 site scoping are not silently moved to the new workspace scope; a single opt-in action may record both pins.

## 11. Review model

- AI 1st (deterministic): overlay validator (coverage of all 77 items, code set, X target existence, reason/reading presence, binding-item guard), glossary lint on reading text, brownfield snapshot of selection and counts.
- AI 2nd (cross-domain, different from the author domain): risk-officer (does any N/X weaken a kill-relevant check or create optimism bias, especially cdd/mdd retention and fdd QoE), legal-counsel (all ldd rows, hdd-06/08/09, fin-06..08), auditor (coverage, brownfield byte-identity, grandfathering).
- **Human final, per item**: each overlay row records `approved_by` and `approved_at`; the overlay loader ignores rows without approval (fail closed to A). Checklist applicability is governance and cannot pass on AI review alone. Review output split into verified / could not verify / needs judgement.

## 12. Tests

- Overlay validator: missing item -> A; N without reason rejected; X with unknown target rejected; binding item N/X always rejected (even with an ADR reference); unapproved row ignored.
- Selection: matrix {null, existing_business_rbd, intra_venture, unknown value, each brownfield sub-track} x {before / after cut-off} x {opted in / not} x `site_required` {true, false, unasserted}.
- Counts: Y per sub-track equals section 5; brownfield Y = 77 unchanged (snapshot).
- Grandfathering fixture modelled on PRJ-DSE4PW: 37 judgements unchanged before opt-in; after opt-in no row deleted, `fail` on N item still unmet, history section lists moved items.
- UI: excluded panel and reading lines readable without colour; design:lint; the X/Y total appears exactly once on the greenfield page; every applying step maps to at least one tab or a Plan readiness row; brownfield render input snapshot unchanged.

## 13. Non-goals

No checklist text change; no change to brownfield selection, counts or labels; no change to the `dd` gate, kill criteria, RAG capping, waiver mechanism or approval authority; no DB schema change (overlay is a file; opt-in reuses `project_policy_pin`); no re-scoping of the sub-track extra checklists.

## 14. Rollback

Revert the PR. The overlay file and loader disappear, selection falls back to ADR-0160 behaviour, and all item state rows remain (none were deleted). Opt-in pins to the overlay version become inert (ignored by the old code).

## 15. Open questions (with recommendation)

1. Tab names for greenfield (section 6). Recommendation: glossary-curator proposes Korean labels from the English working names; human chooses; keep one shared suffix meaning "plan".
2. Should IV reuse more entity-formation items (ef-04, ef-08) as replacements, widening `GF_CHECKLIST_ITEM_SCOPE`? Recommendation: no for S9; they are execution items for S11. Pointers name them as "judged at S11".
3. cdd-02/mdd-07 for null: N or R ("expected retention assumption")? Recommendation: N, because the assumption is already tested by cdd-03 and mdd-02; avoids judging an item with no evidence.
4. (Decided, moved to section 6: read-only Screening/Pre-FS pointer; never-judged target reverts the S9 item to judgeable.)
5. Opt-in for PRJ-DSE4PW: should the team opt it in now? Recommendation: human decides after viewing the preview count; default is grandfathered.
6. Overlay location and doc id. Recommendation: `checklists/_overlays/greenfield-workspace-scope.yaml`, governance_doc_id `ovl-greenfield-workspace-scope`, version 1.0.0, owner process-governance-manager.
7. Should brownfield sub-tracks (for example `rbd`, `corporate_venture`) later use the same overlay? Recommendation: out of scope now; the overlay schema keys by track and sub-track so it can extend without redesign.

## 16. Task split

| Row | Task | Agent |
|---|---|---|
| 0 | Prerequisite bug fix (section 6B): seven domains in `DD_DOMAINS`, `DD_DOMAIN_LABEL`, `DD_DOMAIN_TO_SPEC_ACTIVITY`/`DD_DOMAIN_AGENTS`, custom-item domain type; pre-2026-10-01 read-only marker; brownfield-visible, separate commit | backend-engineer + frontend-engineer |
| 1 | Overlay YAML (section 4 as proposals), overlay validator spec, ADR-0160 addendum final text, process-map note; collect per-row human approvals | process-governance-manager |
| 2 | Loader in `lib/library.ts`, `workspaceItemScope` in `lib/greenfield-subtrack.ts`, `GF_WORKSPACE_SCOPE_DATE`, opt-in extension with preview count, step-to-tab map from the overlay `steps` key (section 6A.5), `ddCompletionSummary` scoped set, `naRequiresReason` extension, validator in `procedures/_validate.ts` or `checklists/_validate`, tests in section 12 | backend-engineer |
| 3 | GreenfieldScopePanel reduced to scope summary + `site_required` confirmation + single X/Y line; `greenfield-dd-view.ts` step list replaced by `stepTabMap`; DdStage greenfield tabs: step tags, Plan readiness tab, labels, reading lines, "Replaced by" pointers, excluded panel with "Judged under previous scope" history, opt-in preview | frontend-engineer |
| 4 | Cross review: risk-officer (optimism and kill relevance), legal-counsel (legal, labour and financing rows), auditor (coverage, brownfield byte-identity, grandfathering) | risk-officer, legal-counsel, auditor |
| 5 | /sync | pm |
