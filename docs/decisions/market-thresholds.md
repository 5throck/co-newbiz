# Decision Record — Market Dimension Thresholds

**Status**: APPROVED by user, 2026-08-23 ("go" — all decisions as drafted; recorded alternatives remain recalibration candidates)
**Date**: 2026-08-23
**Chair / record owner**: process-governance-manager (functional domain lead; owns the RAG scoring framework and the D-M3-* precedent this record follows)
**Participants**:

| Name | Role in this meeting |
|---|---|
| market-intelligence-agent | Evidence owner for TAM/SAM/SOM, value-chain linkage axes, switching-cost and right-to-win evidence shapes |
| industry-lead | Industry-data and proxy-chain conventions; `fact_industry` metric_key ownership; HHI interpretation |
| risk-officer | Adversarial review — false-pass analysis per rule, calibration-basis discipline, Kill Criteria boundary |
| process-governance-manager | Chair; record format, gate applicability, `thresholds_source` wording, PR-9 gating |

**Supersedes**: `docs/decisions/open/market-thresholds.md` (the agenda — upon user approval, this record replaces it and becomes the `thresholds_source` value required by the `rag_rule` CHECK before any `market` rule may be set `enabled=1`).

**Premises inherited as locked** (not re-litigated): corrected evidence mapping (agenda §2); antitrust/regulatory stays in `regulatory_permit`; Decision 9 Green cap (Amber/Red only until calibration — **the numbers below do not lift it**); D-M3-3 priority-ordered overall rule; staged gate applicability (agenda §4.1).

**Calibration ground truth**: the live DB has **zero rows** in `value_chain_link`, `fact_industry`, and all other evidence tables (verified). Every number below is calibrated against the 14 pilot case files plus named external standards, and each carries an explicit calibration-basis tag. Three tiers are used: `[PILOT]` (anchored in pilot facts), `[EXT]` (external standard), `[UCD]` (uncalibrated default — first-recalibration candidate, so ranked at the calibration dry-run).

---

## D-M-MKT-1 — `market.competitive_intensity` is composite-only; no standalone var is registered

**Decision**: competitive intensity is **never a standalone evidence var**. It is expressed exclusively by the `market-dd-competitive-demerit` composite spanning `market.growth_rate` + `market.entry_barrier` + `market.top3_share`. The var_key `market.competitive_intensity` is **not seeded** into `evidence_var` (migration 0017 already withholds it; this decision makes that permanent). Introducing a standalone var later requires a new dated decision, never a filler invention.

**Values**: n/a (structural decision).

**Calibration basis**: `[PILOT]` the composite is the user's own worked example (agenda §3.2) and is already the staged rule shape; `[PILOT]` pilot-006 §3 shows forcing every case through fixed axes produces honest nulls, not weak values — a standalone "intensity" var would pressure-fill exactly such a null. `market.top3_share` is the measurable core of intensity and is already a computed var from `fact_industry` (D-M-MKT-3).

**Gate applicability**: DD only (composite includes the judgement var `entry_barrier`, unassessed before DD).

**Missing-evidence behavior**: inherited from the composite rule (D-M-MKT-7).

**Dissent**: none. risk-officer confirmed the double-counting risk (standalone var + composite firing on the same facts) outweighs the flexibility of a judgement var.

---

## D-M-MKT-2 — `switching_cost_grade` CHECK enum: five members

**Decision**: `value_chain_link.switching_cost_grade` is constrained to a five-member ordinal enum (NULL allowed — absence must remain distinguishable from a value):

| Member | Meaning (anchor) | Direction for customer lock-in |
|---|---|---|
| `negligible` | Multi-homing within one purchase cycle; consumer-app-shaped (pilot-008 §1 pre-lock-in food delivery) | Unfavourable |
| `low` | Re-registration/retraining only; < 1 month effort, no contract friction | Unfavourable |
| `moderate` | Months of integration/requalification; contract terms exist but avoidable | Neutral (fires no rule) |
| `high` | Deep technical/process integration or contractual lock-in; switching is an annual-budget-scale event (pilot-011 §1: 3-month deployed process AI with tuned models; pilot-010 §1: long-term rental + maintenance/used-car integration the KFTC itself called a durable advantage) | Favourable |
| `very_high` | Effectively captive — certification/physical integration; switching cost comparable to reinvestment | Favourable |

CHECK text for the filler PR (note: SQLite cannot `ALTER ADD CHECK`; enforcement is by table-rebuild migration or trigger — implementation detail owned by the PR, not this record):
`switching_cost_grade IS NULL OR switching_cost_grade IN ('negligible','low','moderate','high','very_high')`

**Calibration basis**: `[UCD]` vocabulary — no pilot states a switching-cost grade directly; the member anchors above are pilot-validated for discriminative range (pilot-008 vs pilot-011 vs pilot-010 sit at three different members) but the *labels* are a default. First-recalibration candidate for wording, not for the demerit set.

**Gate applicability**: DD only (`value_chain_link` evidence activates at DD per agenda §4.1).

**Missing-evidence behavior**: NULL grade → var status `missing` → `in` predicate UNASSESSED → no demerit; the dimension remains Amber-by-default (an unassessed axis is never an assessed-clear one — see risk-officer note under D-M-MKT-6).

**Dissent (recorded)**: market-intelligence-agent argued `moderate` should also demerit pre-calibration (conservative direction). Chair ruled against: only clearly-unfavourable members fire; `moderate`'s treatment is an explicit calibration-review item. **Rider action item**: `substitution_threat` on the same table remains unconstrained TEXT with the identical silent-mismatch risk that motivated this decision — owner process-governance-manager, to be enumed at the technical/risk thresholds follow-up or the filler PR, never left unbounded indefinitely.

---

## D-M-MKT-3 — `fact_industry` `metric_key` convention: three keys, self-describing units

**Decision**: exact key strings:

| metric_key | Carries | Unit | Feeds var |
|---|---|---|---|
| `market_tam_krw` | Annual TAM of the industry, KRW | KRW | `market.tam` |
| `market_growth_yoy_ratio` | Trailing 1-year YoY market growth, decimal | ratio | `market.growth_rate` |
| `market_top3_share_ratio` | Combined share of top-3 participants, decimal | ratio | `market.top3_share` |

Resolution contract for the snapshot filler: latest `period_id` per `(industry_id, metric_key)`; annual periods only; growth computed from the two latest annual periods; `evidence_ref` mandatory on the snapshot row (Pre-FS strictness per rag-framework §5-1 — non-null value without `evidence_ref` is status `missing` at Pre-FS, not `present`); recommended `evidence_var.max_age_days = 730` for all three (filler-PR detail, flagged not decided here). No other `market_*` keys may be invented by fillers.

**Calibration basis**: `[EXT]`/convention — `fact_industry` is empty (0 rows), so this is a naming decision, not an empirical one; self-describing suffixes (`_krw`, `_ratio`) prevent the unit ambiguity that the HHI scale decision (D-M-MKT-6) shows is a real hazard. `governance_kpi.metric_key` snake_case style is the in-repo precedent.

**Gate applicability**: `market_tam_krw` / `market_growth_yoy_ratio` live at Screening + Pre-FS + DD (agenda §4.1); `market_top3_share_ratio` at DD only (composite rule).

**Missing-evidence behavior**: no row for the key → var `missing` → dependent cmp UNASSESSED. Row older than `max_age_days` → `stale` → same UNASSESSED at leaf, distinguishable in the ledger.

**Dissent**: none.

---

## D-M-MKT-4 — Ordinal vocabularies: `entry_barrier` (5 levels, string) and the three `right_to_win` vars (0–4 numeric)

**Decision (a) — `market.entry_barrier`** (asserted judgement var; requires `evidence_ref` + `rationale` + cross-domain `reviewed_by` before it may reach scoring):

| Member | Meaning |
|---|---|
| `none` | No meaningful barrier; capital alone enters within one budget cycle |
| `low` | Months to replicate; no IP/regulatory/capital moat |
| `moderate` | 1–3 years or material capital/IP; replicable by a determined large entrant |
| `high` | Multi-year, large capital, IP/certification moat, network effects |
| `very_high` | Regulatory exclusivity / natural monopoly / >10-year technology lead |

Anchors: `very_high` = semiconductor fab (pilot-005 §1: KRW 9.4T single-fab capex); `high` = post-consolidation platform network effects (pilot-008); `moderate` = rental cars (pilot-010 §1: "many small operators" existed, so entry was possible but the FTC found durable scale advantages); `low` = pre-2020 food-delivery apps (both pilot-008 parties were recent entrants).

**Decision (b) — the three `right_to_win` vars** (`customer_overlap`, `tech_overlap`, `brand_transferability`): shared integer scale **0–4**, unitless:

| Value | Level | Meaning |
|---|---|---|
| 0 | absent | No meaningful overlap/transfer |
| 1 | weak | Incidental only; no commercial evidence |
| 2 | moderate | Partial; requires material adaptation to monetize |
| 3 | strong | Substantial direct overlap/transfer with minor gaps |
| 4 | decisive | Near-complete, independently evidenced |

Anchors `[PILOT]`: pilot-011 §1–§2 walks the full range — customer_overlap 4 (33 deployed internal projects; 16 external enterprise customers incl. POSCO/Kia), tech_overlap 4 (0% production-failure record), brand_transferability 3 (POSCO association explicitly described by the CEO as a commercial asset). pilot-013 §2: tech_overlap 3–4 (licensed core technology) but customer_overlap 1 and brand_transferability 1 (ETRI institutional brand is not a commercial transfer asset; TRL itself not publicly assessable). pilot-014 §2: brand 1–2, tech 2 (standardization co-research still ongoing — validation, not proof).

**Calibration basis**: `[PILOT]` for discriminative range as above; `[UCD]` for the exact numeric boundaries — 5 levels and the 0–4 mapping are defaults, first-recalibration candidates.

**Gate applicability**: DD only, both vocabularies (asserted judgement vars are unassessed at Screening/Pre-FS by agenda §4.1).

**Missing-evidence behavior**: un-populated or un-reviewed (`reviewed_by` empty) judgement var → status `missing` → leaf UNASSESSED; downstream Kleene behavior per D-M-MKT-10.

**Dissent**: none — industry-lead confirmed 5 levels is the coarsest scale that still separates pilot-013's 4/1/1 profile from pilot-011's 4/4/3; a 3-level scale would collapse both to "strong tech" and lose the signal.

---

## D-M-MKT-5 — Low-confidence exclusion cutoff: `r2 >= 0.6`, confirmed

**Decision**: **confirm 0.6** — any var derived from `value_chain_link` is excluded on link fit `r2 < 0.6`, mirroring `gradeChain()` (D-M4-1, `db/lib/chain-grading.ts`).

Filler status contract (normative for the value_chain_link filler PR):
- Link has `r2 IS NULL` → the link contributes nothing; vars derived solely from it get status **`missing`** (no fit was ever measured).
- Link has `r2 < 0.6` → derived var gets status **`low_confidence`** with the raw value still written to `value_num` (a value exists and was measured — this is the distinction migration 0017's fourth status exists to carry).
- Link has `r2 >= 0.6` → derived var eligible for `present` (subject to `evidence_ref`/staleness rules).

**Calibration basis**: `[EXT]` in-system precedent — D-M4-1 already fixed 0.6 as the statistical-reliability bar for hops; two different r2 bars in one system would be indefensible at any audit. Strongest-basis number in this record.

**Gate applicability**: DD only (value-chain evidence activates at DD).

**Missing-evidence behavior**: `low_confidence`/`missing` status → leaf operators UNASSESSED (ADR-0046 §2) — a low-confidence link can neither demerit nor clear.

**Dissent**: none. risk-officer note adopted into the record: rule-FALSE and rule-UNASSESSED must both leave the dimension short of Green (the axis ledger shows `low_confidence`), so exclusion is never a false pass — verified structurally against the priority-ordered overall rule (D-M3-3).

---

## D-M-MKT-6 — Bargaining-power rule: HHI >= 0.25 AND fit >= 0.60 → Amber; **worst-of** aggregation; HHI on a normalized 0–1 scale

**Decision**:
1. **Scale convention (load-bearing)**: `value_chain_link.concentration_hhi` and the var `market.bargaining_power_hhi` are on the **normalized 0–1 scale** (sum of squared fractional shares), consistent with the var's registered `unit='ratio'`. 0.25 corresponds to the classic 2500-point HHI; 0.15 to 1500. Classic 0–10000 quoting is a documentation error in this system — a 10,000x ambiguity, which is why this convention is decided here and not left to the filler.
2. **Aggregation — worst-of, single var**: `market.bargaining_power_hhi` = **max** `concentration_hhi` across all links (upstream and downstream pooled). The most concentrated adjacent tier dominates bargaining risk regardless of side. Separate upstream/downstream vars are deferred (see dissent). `market.link_fit_quality` = the `r2` of the arg-max link, written truthfully even below 0.6 (this keeps the rule's second conjunct non-tautological and self-defending against filler drift or a future recalibrated cutoff).
3. **Rule fires Amber at DD** when: adjacent-tier HHI >= 0.25 AND the supplying link's r2 >= 0.6.

**Calibration basis**: `[EXT]` the 0.25 cut borrows the DOJ/FTC 2010 Horizontal Merger Guidelines concentration taxonomy (unconcentrated < 0.15, moderate 0.15–0.25, highly concentrated > 0.25) — borrowed **as a concentration taxonomy only, not as a merger-review presumption** (locked premise #1: this axis measures bargaining power in adjacent tiers, a different question). `[PILOT]` context anchors (horizontal, not adjacent-tier, so illustrative only): pilot-008 §1 implies HHI ≈ 0.42+ (55.7/33.5 duopoly); pilot-009 §1 implies ≈ 0.07 (18/13/12/3 fragmentation) — the cut cleanly separates a dominance-shaped market from a genuinely fragmented one. No pilot states an adjacent-tier HHI → **externally anchored, pilot-uncalibrated — first-recalibration candidate**.

**Gate applicability**: DD only.

**Missing-evidence behavior** (`all_of`): fit < 0.6 with HHI present → conjunct 2 FALSE → rule FALSE (no demerit), but the var status `low_confidence` holds the axis unassessed in the ledger — not a false pass. HHI var UNASSESSED (no links / r2 NULL) with fit TRUE → `all_of(U, T)` = UNASSESSED. No links at all (pilot-006 §3 pure-diversification shape — six null axes) → var `missing` → rule UNASSESSED → dimension Amber-by-default, correctly refusing to invent a linkage.

**Dissent (recorded)**: industry-lead prefers separate upstream/downstream vars (asymmetric squeeze is analytically real — pilot-002 §2's retained seller-supplier entanglement vs pilot-010's downstream disposal-network dependence). Accepted for v1 as worst-of because it is the conservative aggregation (a benign side can never mask an adverse one by averaging); split vars are a post-calibration candidate if pilot data shows asymmetry changing outcomes.

---

## D-M-MKT-7 — Competitive-demerit composite: growth < 0.05 AND entry_barrier in {none, low} AND top3_share >= 0.50 → Amber

**Decision**: the composite (D-M-MKT-1) fires Amber at DD when all three conjuncts hold. Cut values:

| Conjunct | Cut | Basis |
|---|---|---|
| `market.growth_rate` lt | **0.05** (5% nominal YoY) | `[UCD]` derived: meaningful-growth bar = Korean nominal GDP (~2%, BOK long-run) + sector premium. Pilot-009 §1 (GMV +6.2%) sits just above — a market attractive enough for a KRW 3.44T commitment. Deliberately *higher* than the single-axis cut (D-M-MKT-9): three jointly-moderate adverse signals (stagnant-ish, unmoored, concentrated) justify firing where one alone would not. First-recalibration candidate. |
| `market.entry_barrier` in | **["none","low"]** | `[PILOT]` vocabulary decision consequence — the user's worked example predated the enum; once `none` exists as a member, excluding it from the demerit set would be a false pass (risk-officer catch, adopted). |
| `market.top3_share` gte | **0.50** | `[EXT]`+`[PILOT]` — the best-calibrated number in this record: KFTC review presumption territory (combined >= 50%), and it cleanly separates pilot-009 (top-3 ≈ 46% — genuinely competitive, no remedy) from pilot-010 (top-2 already 38.3% in long-term rental → top-3 >= 50%; KFTC found dominance dynamics, §1). |

**Gate applicability**: DD only.

**Missing-evidence behavior** (`all_of`): any conjunct FALSE → rule FALSE (e.g. growth 8% kills the squeeze thesis regardless of the un-reviewed barrier var). All-TRUE required to fire; any UNASSESSED among otherwise-TRUE conjuncts → UNASSESSED (no demerit, dimension stays Amber-by-default — again not a false pass).

**Dissent (recorded)**: risk-officer flags the 0.05-vs-0.02 inconsistency between composite and single-axis growth cuts as a watch item for the calibration dry-run; the joint-signal rationale above is the accepted justification, not a defense of the specific values.

---

## D-M-MKT-8 — Switching-cost rule: grade in {negligible, low} → Amber

**Decision**: `in(market.switching_cost_grade, ["negligible","low"])` → Amber. Only clearly-unfavourable members fire (D-M-MKT-2); the favourable members (`high`, `very_high`) are the future Green-candidate direction and are **not** staged — under the Decision 9 cap no market rule may emit Green, so staging a Green rule now would be inert at best and a cap-bypass temptation at worst.

**Calibration basis**: `[UCD]` set membership (vocabulary-level pilot validation only, per D-M-MKT-2 anchors).

**Gate applicability**: DD only.

**Missing-evidence behavior**: NULL/absent grade → `in` UNASSESSED → no demerit; dimension Amber-by-default.

**Dissent**: the `moderate` question — recorded under D-M-MKT-2, not repeated.

---

## D-M-MKT-9 — TAM/growth rule: TAM < KRW 100bn OR growth < 0.02 → Amber; fires at **all three gates**

**Decision**:

| Cut | Value | Basis |
|---|---|---|
| `market.tam` lt | **100,000,000,000 KRW (1e11)** | `[UCD]` — **no pilot states a TAM figure**; anchored by scale arithmetic on pilots: ~123% of pilot-001's deal value (KRW 81.3bn — the smallest Entity-IC-scale deal in the set), 250x pilot-012's per-team commitment (KRW 0.4bn), ~1% of pilot-009's target GMV (KRW 17.2T — an entire major e-commerce market). A market 10x smaller than the smallest group-reviewable deal cannot support group-level review. **Explicitly marked: uncalibrated default, first-recalibration candidate, highest priority.** |
| `market.growth_rate` lt | **0.02** (2% nominal YoY) | `[EXT]` — Korean long-run nominal GDP growth (BOK ~2%): a market growing slower than the whole economy offers no relative tailwind. Semi-calibrated (macro standard, no pilot basis). |

**Sector-relative TAM: rejected** for v1 — no calibration basis, and it would make the rule opaque at governance review. Recorded as a calibration-candidate idea, not adopted.

**Gate applicability**: **the only market rule live at Screening and Pre-FS** (agenda §4.1), continuing at DD. Implementation: the staged `market-dd-tam-growth` row serves DD; two additional rows with identical `condition_expr` — `market-screening-tam-growth` (stage_gate `screening`) and `market-pre-fs-tam-growth` (stage_gate `pre_fs`) — are required at PR-9 (the `UNIQUE(rule_key, version)` index forbids one row serving three gates). The Pre-FS evidence_ref strictness is carried by the filler/status contract (D-M-MKT-3), not by a different threshold. At Screening/Pre-FS the market dimension remains Amber-capped regardless — this rule changes the *rationale*, not the ceiling.

**Missing-evidence behavior** (`any_of` of demerit conditions): TAM confirmed < floor, growth UNASSESSED → `any_of(T, U)` = **TRUE** — a confirmed too-small market cannot be rescued by an unknown growth rate. TAM confirmed >= floor, growth UNASSESSED → `any_of(F, U)` = **UNASSESSED** — the missing value is decisive (ADR-0046 §2 table, applied verbatim).

**Dissent (recorded)**: risk-officer dissents from 1e11 as arbitrary in magnitude (accepts the reasoning, not the number); accepted resolution — the floor is marked highest-priority recalibration candidate, and until calibration lifts the Green cap the cost of a wrong floor is bounded (at Screening/Pre-FS it toggles Amber rationale only; at DD the dimension cannot go Green anyway).

---

## D-M-MKT-10 — Right-to-win: staged rule **re-graded Green**, k=2, per-var cut >= 3; plus one NEW demerit rule

**Decision**:
1. The staged `market-dd-right-to-win` rule is **re-graded `amber` → `green`** (explicitly permitted by migration 0017's placeholder convention). Rationale: `at_least(k, [gte-cut x3])` is a *merit* condition — reading it as Amber would demerit companies **for having** right-to-win. It stays `enabled=0`, and activates only when calibration lifts the Decision 9 cap (an enabled green market rule pre-calibration would violate the cap).
2. Confirmed values: **k = 2**, per-var cut **gte 3** (strong or decisive on the 0–4 scale of D-M-MKT-4). Two confirmed strong sources of advantage, at minimum, justify a future Green on this axis.
3. **New rule row required at PR-9** — `market-dd-right-to-win-absent` (dd, amber, priority 6): `all_of[cmp(customer_overlap, lt, 2), cmp(tech_overlap, lt, 2), cmp(brand_transferability, lt, 2)]` → Amber ("no source of advantage reaches even moderate"). Without it, the axis emits no Amber/Red signal at all pre-calibration — a company with zero right-to-win would face no demerit, which is exactly the false pass risk-officer challenged and the chair accepted as decisive.

**Calibration basis**: `[PILOT]` weakly calibrated — cut 3 / k 2 is the coarsest setting that separates pilot-011 (4/4/3 → merit fires) from pilot-013 (4-ish/1/1 → neither rule fires: one strong source = neutral, the honest result) and pilot-014 (2/2/1-ish → absent-rule marginal, calibration watch). `[UCD]` boundaries.

**Gate applicability**: DD only, both rules.

**Missing-evidence behavior**:
- Green rule (`at_least k=2`): `[T,T,U]` = **TRUE** — accepted: two confirmed wins cannot be overturned by the third being unassessed. `[T,U,U]` = UNASSESSED → no Green — the conservative direction for a merit rule. Judgement vars un-reviewed (`reviewed_by` empty) → status `missing` → leaves UNASSESSED.
- Absent rule (`all_of` of lt-cuts): any var >= 2 → that conjunct FALSE → rule FALSE (one moderate source of advantage means "absent" is not established). All three present and < 2 → TRUE → Amber. Any UNASSESSED among otherwise-TRUE conjuncts → UNASSESSED (cannot demerit on an un-reviewed judgement).

**Dissent**: none on the re-grade (unanimous once the merit-direction reading was stated); risk-officer's absent-rule addition adopted by consensus.

---

## D-M-MKT-11 — Record-level rulings (chair)

1. **No rule in this record emits Red.** Concentration, stagnation, lock-in absence, and missing right-to-win are Amber-grade findings; Red on the market dimension would require a Kill Criteria pathway (risk-officer authority), which is a separate registry, not a threshold tweak.
2. **Choosing these numbers does not lift the Decision 9 Green cap.** All five staged rules (plus the three additions below) remain `enabled=0`; PR-9 activation additionally requires user approval of this record and its landing as the replacement of `docs/decisions/open/market-thresholds.md`. The Green-graded right-to-win rule stays disabled until calibration.
3. **Proposed `thresholds_source` literal** (for every `market` rule row set `enabled=1`): `D-M-MKT-1..11, market thresholds meeting 2026-08-23 (market-intelligence-agent, industry-lead, risk-officer, chair process-governance-manager) — docs/decisions/market-thresholds.md, supersedes docs/decisions/open/market-thresholds.md`.
4. **Action items**: (i) substitution_threat enum — process-governance-manager (D-M-MKT-2 rider); (ii) HHI normalized-scale note added to `docs/db-schema.md` `value_chain_link` row — industry-lead; (iii) value_chain_link + fact_industry fillers built to the contracts in D-M-MKT-3/5/6 — platform-lead's PR, post-approval; (iv) all `[UCD]` numbers ranked ahead of the calibration dry-run backlog — risk-officer (owns the dry-run per role definition).
5. **Gate applicability summary**:

| Rule | Screening | Pre-FS | DD | Grade |
|---|---|---|---|---|
| tam-growth (3 rows) | fires | fires (+evidence_ref strictness) | fires | amber |
| bargaining-power | — | — | fires | amber |
| competitive-demerit | — | — | fires | amber |
| switching-cost | — | — | fires | amber |
| right-to-win (merit) | — | — | cap-deferred | green |
| right-to-win-absent | — | — | fires | amber |

At Screening/Pre-FS the market dimension is Amber-capped by default; at DD the cap lifts but the Decision 9 Green cap on *uncalibrated* rules persists until the calibration exercise.

---

## Mapping onto the staged `market-dd-*` rules (final `condition_expr` values)

All rules: `version=1`, `enabled=0` until PR-9; `policy_id` + `thresholds_source` per D-M-MKT-11.3 at activation. HHI values on the normalized 0–1 scale (D-M-MKT-6.1).

| rule_key | stage_gate | grade | priority | Final condition_expr |
|---|---|---|---|---|
| `market-dd-bargaining-power` | dd | amber | 1 | `{"op":"all_of","of":[{"op":"cmp","var":"market.bargaining_power_hhi","cmp":"gte","value":0.25},{"op":"cmp","var":"market.link_fit_quality","cmp":"gte","value":0.6}]}` |
| `market-dd-competitive-demerit` | dd | amber | 2 | `{"op":"all_of","of":[{"op":"cmp","var":"market.growth_rate","cmp":"lt","value":0.05},{"op":"in","var":"market.entry_barrier","values":["none","low"]},{"op":"cmp","var":"market.top3_share","cmp":"gte","value":0.5}]}` |
| `market-dd-switching-cost` | dd | amber | 3 | `{"op":"in","var":"market.switching_cost_grade","values":["negligible","low"]}` |
| `market-dd-tam-growth` | dd | amber | 4 | `{"op":"any_of","of":[{"op":"cmp","var":"market.tam","cmp":"lt","value":100000000000,"unit":"krw"},{"op":"cmp","var":"market.growth_rate","cmp":"lt","value":0.02,"unit":"ratio"}]}` |
| `market-dd-right-to-win` | dd | **green** (re-graded; activates only post-calibration) | 5 | `{"op":"at_least","k":2,"of":[{"op":"cmp","var":"right_to_win.customer_overlap","cmp":"gte","value":3},{"op":"cmp","var":"right_to_win.tech_overlap","cmp":"gte","value":3},{"op":"cmp","var":"right_to_win.brand_transferability","cmp":"gte","value":3}]}` |

**New rows required at PR-9** (additions to the staged skeleton, mandated by this record):

| rule_key | stage_gate | grade | priority | condition_expr |
|---|---|---|---|---|
| `market-screening-tam-growth` | screening | amber | 1 | identical expr to `market-dd-tam-growth` (D-M-MKT-9) |
| `market-pre-fs-tam-growth` | pre_fs | amber | 1 | identical expr to `market-dd-tam-growth`; Pre-FS evidence_ref strictness lives in the snapshot status contract, not the predicate |
| `market-dd-right-to-win-absent` | dd | amber | 6 | `{"op":"all_of","of":[{"op":"cmp","var":"right_to_win.customer_overlap","cmp":"lt","value":2},{"op":"cmp","var":"right_to_win.tech_overlap","cmp":"lt","value":2},{"op":"cmp","var":"right_to_win.brand_transferability","cmp":"lt","value":2}]}` |

Schema prerequisites landing with the fillers, per this record: `switching_cost_grade` CHECK (D-M-MKT-2), the three `fact_industry` metric_keys (D-M-MKT-3), the r2 >= 0.6 exclusion with the four-status contract (D-M-MKT-5), and the normalized-HHI + worst-of filler contract (D-M-MKT-6).
