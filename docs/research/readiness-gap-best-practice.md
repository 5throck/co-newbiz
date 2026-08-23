# Research Report: Best Practice for the Readiness-Audit Gap Areas

> **Provenance:** researched by the PM (inline, 2026-08-23), as input to [`docs/audits/2026-08-23-readiness-audit.md`](../audits/2026-08-23-readiness-audit.md) and the gap-remediation design. Method: direct WebFetch (channel verified working this session). The Z.ai search backend (built-in WebSearch + web-reader MCP) returned quota-exhausted for every query (resets 2026-09-01) — same condition under which `rbd-research2` produced `rbd-partnership-best-practice.md` via WebFetch. Successful fetches this session (7): GAO-20-48G product page, Wikipedia (reference class forecasting, expert elicitation, corporate venture capital, balanced scorecard), OMG DMN, stage-gate.com landing. Failed fetches, recorded honestly: iso.org 403, bcg.com 403, gao.gov full PDF > 10 MB limit, stage-gate.com sub-path 404. Claims below are marked with their fetched source; widely-documented practice not traceable to a fetched URL is marked `[practice]`. Consultancy/ISO primary pages should be re-fetched after 2026-09-01 as a supplement — no decision in the remediation design waits on them.

---

## Area 1 — Venture / JV Scorecard Storage and Metrics (gap R3; ADR-0052 open question (e))

### 1.1 Findings

- **Dual financial/strategic objectives are the documented CVC norm, with a four-type portfolio taxonomy**: driving (tightly linked to current strategy), enabling (strategic, loosely linked), emergent (operational link, potential future strategic value), passive (purely financial) — from combining the strategic and financial dimensions (Wikipedia, Corporate venture capital). 54% of European CVCs name strategic reasons primary.
- **CVC evaluation screens strategic fit first, then applies independent-VC financial standards**; funding is staged (seed → expansion → exit) with exit horizons ~4–7 years for early-stage (Wikipedia, Corporate venture capital).
- **Balanced scorecard practice caps and structures the measure set**: "a small number of financial and non-financial measures" (~20 total) across four perspectives, each measure carrying an explicit target, reported on a fixed cadence in a single concise report; later generations anchor every measure to a strategic objective on a strategy map rather than picking measures ad hoc (Wikipedia, Balanced scorecard).
- **Scorecards are ongoing governance instruments, not one-off ratings**: 88% of users run them for strategy-implementation monitoring, 63% for operational management; they trigger intervention by highlighting deviation from targets, and mature organizations automate collection/reporting (Wikipedia, Balanced scorecard).
- **JV-specific dimension sets already committed**: the Ankura/Watermark JV governance-index lineage and the seven-dimension health scorecard live in `pmi-jv-lifecycle-best-practice.md` (committed) — the storage design should treat those dimensions as fixed content and the storage as the missing part.

### 1.2 Implication for co-newbiz

- The **four-type taxonomy maps directly onto the cell structure** (ADR-0047 §G): driving/enabling ≈ cells 9/10 (internal venture), emergent ≈ cells 5/6 (hybrid/minority), passive ≈ the carve-outs. Storage should carry a `venture_class` field so the rollup can report by class rather than flattening.
- The balanced-scorecard discipline (~20 measures, target per measure, strategy-map linkage, fixed cadence) validates the design choice of **bifurcated financial/strategic sections with per-measure targets** — and warns against unbounded metric sprawl: the schema should make "measure without target" invalid, not merely discouraged.
- Scorecard rows must be **run-scoped and time-series** (review-cycle cadence, deviation flags), not latest-value-only — the governance use case is trend-and-trigger, matching how `jv_health_scorecard` and `portfolio_scorecard_rollup` outputs are specified in the procedures.

## Area 2 — Gate Deliverable Template Standards (gap R1; templates 1/59)

### 2.1 Findings

- **GAO's TRA quality bar for evidence deliverables**: credibility, objectivity, reliability, usefulness — high-quality readiness assessments demonstrate all four, and immature technology is a documented driver of program delay and cost growth (GAO-20-48G product page, fetched this session; full detail already encoded in `rbd-technology-checklist.yaml` rbd-14 from the committed research).
- **Stage-gate practice centers gate reviews on a small set of standard deliverables with an explicit decision vocabulary** — Go / Kill / Hold / Recycle at every gate, Hold/Recycle being *expected* for tech bets whose evidence is immature (stage-gate.com landing page fetched; the full 5th-generation model detail is committed in `rbd-partnership-best-practice.md` §1.1).
- **The site's portfolio-governance framing matches our rollup gap**: gate visibility exists to "provide business leaders with visibility … and engage them with investment decision support" (stage-gate.com landing) — i.e., the deliverable is for decision-makers, and its format should serve ranking/intervention, not archiving.
- IC memo practice is already committed (`templates/deliverables/ic-memo-template.md`; `ma-dd-best-practice.md` 62 sources) — the template set should reuse its conventions (RAG table, findings-with-evidence-refs, sign-off block) rather than invent per-template house styles. `[practice]`

### 2.2 Implication for co-newbiz

- Every human-signoff template should carry the **GAO four characteristics as its evidence discipline** (source named, verifiable, reviewer independent of author where applicable) and the **decision vocabulary as a closed enum** — both already exist in our checklists/output types; templates make them visible at the point of signature.
- Selection criterion for which of the 59 output types get templates first: **human-authority steps and audit-evidence outputs** (the 4 human steps' outputs + gate records + scorecards) — decided in the remediation design (PR-2), landed in PR-3.

## Area 3 — Front-End Expert Elicitation and Proxy Chains (gap R4; §F residuals)

### 3.1 Findings

- **Reference-class forecasting is the standard corrective for early-stage estimate optimism**: predict from the distribution of comparable past cases, not the case's internal detail — three steps (identify the reference class, obtain the outcome distribution, adjust); adopted by UK Department for Transport from 2004 after documented optimism bias (Wikipedia, Reference class forecasting — Kahneman/Tversky lineage).
- **A proxy chain is a reference class in disguise**: estimating demand through upstream industries *is* taking the outside view when no direct market data exists — which argues for treating the chain's base rates and dispersion (not just its r²) as first-class recorded inputs. `[practice, synthesis]`
- **Structured elicitation protocols beat informal interviews**: SHELF and Stanford-SRI style protocols exist precisely because unstructured conversations let experts overlook evidence and drift on vocabulary; calibration and quantified uncertainty are core, and qualitative probability words ("likely") must be pinned down because they mean different things to different people (Wikipedia, Expert elicitation).
- **Aggregation of multiple experts with uncertainty made explicit** is part of the protocol, not an afterthought (Wikipedia, Expert elicitation).

### 3.2 Implication for co-newbiz

- **`proxy-industry-chain` — keep the prose wiring, upgrade the recording**: the skill already feeds `distributional_valuation` as the named confidence input; what research adds is that chain base rates/dispersion should be treated as reference-class inputs. Verdict refined in PR-2 (skill-protocol note, no procedure-step change — displacing the market-sizing step remains out of scope).
- **`expert-interview` — the gap is structure, not routing**: research supports keeping it off the procedure layer (no shipped step is displaced) *provided* the skill's protocol is upgraded to a structured-elicitation standard (question framing, vocabulary pinning, calibration, multi-expert aggregation). That is a skill-version bump, decided in PR-2.

## Area 4 — Kill-Criteria / Decision-Rule Formalization (gap R5; 2 of 29 executable)

### 4.1 Findings

- **DMN (Decision Model and Notation) is the reference standard for decision-rule formalization**: decision tables defining business rules "simply and reliably" and unambiguously, graphical decomposition of decision requirements, specs "automatically validated and executed", reusable decision libraries, designed to sit alongside process models (OMG DMN page, fetched).
- **Executable-and-validatable is the point**: the value is not documentation but rules that a machine can check — the same claim our predicate-AST registry (ADR-0046/0058 lineage) makes internally. `[practice, synthesis]`
- **Evidence sufficiency precedes rule firing**: GAO's quality characteristics (Area 2) apply to the inputs of any decision rule — a formally perfect rule over unsourced evidence is still a bad gate (GAO-20-48G, fetched).

### 4.2 Implication for co-newbiz

- The registry approach is validated; what is missing is **coverage and thresholds, not architecture**. Roadmap (PR-2): (1) classify the 29 declared criteria by evidence-var availability (already-expressible in the migration-0014 var registry vs needs-new-var vs needs-threshold), (2) express the already-expressible ones in the predicate AST, (3) leave threshold-dependent ones inert with their open-question pointer — exactly the `enabled=0` discipline already in force.
- DMN's decision-table hit policies are a *vocabulary* we can borrow for documenting multi-condition criteria in the registry's prose fields; adopting the DMN runtime itself is not proposed. `[practice]`

## Sources (fetched this session, 2026-08-23)

1. GAO — Technology Readiness Assessment Guide product page — https://www.gao.gov/products/gao-20-48g
2. Wikipedia — Reference class forecasting — https://en.wikipedia.org/wiki/Reference_class_forecasting
3. Wikipedia — Expert elicitation — https://en.wikipedia.org/wiki/Expert_elicitation
4. Wikipedia — Corporate venture capital — https://en.wikipedia.org/wiki/Corporate_venture_capital
5. Wikipedia — Balanced scorecard — https://en.wikipedia.org/wiki/Balanced_scorecard
6. OMG — Decision Model and Notation — https://www.omg.org/dmn/
7. Stage-Gate International — landing page — https://www.stage-gate.com

Failed (recorded): https://www.iso.org/standard/68295.html (403), https://www.bcg.com/publications/2020/corporate-venture-building (403), https://www.gao.gov/assets/gao-20-48g.pdf (>10 MB), https://www.stage-gate.com/the-stage-gate-process/ (404).

Prior committed research this report builds on: `ma-dd-best-practice.md`, `pmi-jv-lifecycle-best-practice.md`, `rbd-partnership-best-practice.md`, `venture-governance-best-practice.md` (Cooper/Stage-Gate, GAO, EU Horizon TRL, ASAP, NIH, NVCA, Bain/BCG/McKinsey/EY, HLS Forum/Ankura).
