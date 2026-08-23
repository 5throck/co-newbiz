# Decision Pack — Residual Threshold Decisions (ADR-0052 (a)–(d), calibration corpus, antitrust premise)

**Status**: OPEN — awaiting user decisions
**Date**: 2026-08-24
**Owner**: pm (assembled per the 2026-08-24 leads' meeting disposition)
**Answers**: ADR-0052 open questions (a)–(d); the calibration-corpus data request; the antitrust premise-withdrawal question (ADR-0060 row 13)
**Does not re-open**: anything decided by the four approved 2026-08-23 records (Section 0), the migration-0018/0019 schema layer, or the Decision 9 Green cap

This is a **pre-meeting agenda pack**, not a record. Each decision-bearing item states its context, the options with what each implies, and a blank DECISION field. The user may decide asynchronously (reply per item id) or in one sitting; on approval, pm converts each decided item into a dated decision record in this directory's established format, which then becomes the governance anchor (`thresholds_source` / `policy_id` value) the validators require.

---

## 0. Already decided — context, no action required

Four records were **approved by the user on 2026-08-23** ("go" — all decisions as drafted; recorded alternatives remain recalibration candidates) and landed as commit `dbed8f1` (PR #86), with the substitution-threat vocabulary ratified in the riders round (`ed6af12`, PR #90):

| Record | Path |
|---|---|
| Market dimension thresholds (D-M-MKT-1..11) | `docs/decisions/market-thresholds.md` |
| Risk dimension thresholds (D-M-RISK-*) | `docs/decisions/risk-thresholds.md` |
| Technical-execution thresholds (D-M-TE-1..8) | `docs/decisions/technical-execution-thresholds.md` |
| Substitution-threat vocabulary | `docs/decisions/substitution-threat-vocabulary.md` |

The old `docs/decisions/open/` agenda directory was superseded and removed in the same change. The RAG rule layer is active (migration 0022: 18 of 19 rule rows `enabled=1`; the 19th is the Green-graded `market-dd-right-to-win`, deliberately held `enabled=0` under the cap per D-M-MKT-10).

**The Decision 9 Green cap survives all four records** (Amber/Red only until calibration — restated in each record's premises; ADR-0049). No number approved on 2026-08-23 lifted it, and nothing in this pack lifts it either: the lift is gated solely by the calibration corpus (Agenda item 5).

---

## 1. Agenda item 1 — (b) JV health-scorecard weights and review cadence  *[PRIORITY]*

**Why first**: the E.4 chain landed 2026-08-24 — migration 0024 (`venture_scorecard`), the repository, the `scorecard:rollup` CLI (PR #103), and the portfolio view (PR #104) — so the scorecard surface is now **live end to end**. A decision here fills an operating instrument, not a drawer.

**Context** (ADR-0052 §C.3 / design §C.3): the JV health scorecard measures **seven dimensions** — performance, people, partner alignment, decision health, milestones & funding, governance health, value-distribution symmetry. Storage already landed without weights: ADR-0059 Decision 2 excludes them by design — *"when decided they enter via the governance-doc reference pattern (like `rag_rule.policy_id`), never a column with silent defaults."* So the decision adds **no schema change**; it creates the governance document the producing step (`jv-lifecycle-governance#2`) and the rollup read.

### 1a. Weights

| Option | What it implies |
|---|---|
| **W1 — Equal weights** (each dimension 1/7) | Transparent, claims no calibration basis; reading is per-dimension status plus a deviation count. Any future tiering is a corpus-informed change. |
| **W2 — Dimension-tiered** (e.g. performance + partner alignment + value-distribution symmetry as tier 1; people / decision health / milestones & funding / governance health as tier 2) | Encodes the JV failure research's emphasis (partner misalignment and governance are the cited failure modes; the 79%-vs-33% restructuring statistic is ILLUSTRATIVE). Tier boundaries are `[UCD]` until the corpus — a deviation in tier 1 would outweigh several tier-2 deviations. |
| **W3 — Deferred: no weights in v1, cadence only** | The scorecard operates as seven status rows (`on_target` / `deviation` / `insufficient_evidence`, worst-of reading) exactly as migration 0024 stores them; the rollup reports by dimension and venture class with no composite score. Weights join the calibration backlog. |

**DECISION (item 1a): W__** — weights: ______________________

### 1b. Review cadence

Storage fact: `review_cycle` is the shared time axis (`'YYYY-Qn'`, CHECK `GLOB '????-Q[1-4]'`); the JV monitor and the portfolio procedure (`portfolio-venture-monitoring`) share it. Quarterly is the finest representable cadence; coarser cadences are representable by skipping quarters.

| Option | What it implies |
|---|---|
| **C1 — Quarterly** | Matches the JV board cadence (§C.2 operate phase: quarterly board) and the metric-tied restructuring triggers (§C.4), which need fresh signal to be triggers rather than post-mortems. |
| **C2 — Semiannual** | Halves the production effort; weakens the §C.4 trigger design (a metric breach waits up to six months for its reading). |
| **C3 — Annual** | Matches only the strategic-asset-review layer (§C.3: annual per-JV strategic review; external governance review every 3 years, ILLUSTRATIVE). Too coarse as the scorecard's own cadence, though the annual layers ride regardless. |

**DECISION (item 1b): C__** — cadence: ______________________

---

## 2. Agenda item 2 — (a) TRL/MRL cutoffs per gate

**Context** (design §D.1, carried verbatim into `checklists/rbd-technology-checklist.yaml` rbd-08..rbd-13, each row still marked *"cutoff ILLUSTRATIVE until the thresholds meeting"*). The TRL **enum and membership treatment are already fixed** by the approved technical-execution record D-M-TE-1 (`docs/decisions/technical-execution-thresholds.md`): exactly `TRL1`..`TRL9`, membership (`in`) predicates, no ordinal var in v1. **Only the per-gate cutoff numbers remain.**

Each row below restates the design's ILLUSTRATIVE value; the DECISION column is blank for the user.

| # | Gate | Evidence demanded (fixed, not being decided) | Readiness floor (ILLUSTRATIVE) | DECISION |
|---|---|---|---|---|
| A2-1 | Screening | Scientific basis; roadmap pull; preliminary prior-art/FTO screen | TRL 1–2 | __________ |
| A2-2 | Pre-FS | Concept memo; critical-function list; POC experiment protocol | TRL 2 | __________ |
| A2-3 | FS entry | POC results demonstrating the critical function, reproducible | TRL 3 | __________ |
| A2-4 | FS / DD | Integrated test data; relevant-environment validation plan; FTO opinion; patent strategy; updated cost model | TRL 4–5, MRL 4–5 | __________ |
| A2-5 | Entity-IC (= business-case gate) | Full business case; make/buy/partner decision; real-options valuation; staged funding for next stage only | TRL 5–6, MRL 5–6 | __________ |
| A2-6 | Post-IC execution | Operational-environment demonstration; pilot-line capability; regulatory pathway | TRL 7–8, MRL 7–8 | __________ |

Notes:

- **A blanket option exists**: confirm all six rows as drafted (the ILLUSTRATIVE values trace to the NASA/EU TRL definitions and the DoD MRL deskbook lineage per the design's source basis), which retires the ILLUSTRATIVE flags in one stroke. Deviating per row is equally valid — state the row id and the new floor.
- **These cutoffs are a different instrument from the DD RAG bands.** The approved D-M-TE-2 rule (Red TRL1–3, Amber TRL4–5 at DD, on `dd_finding` evidence) grades a case at DD; this matrix sets the R&BD track's per-gate evidence *floor* with the Hold/Recycle vocabulary. The A2-4 floor (TRL 4–5) is consistent with D-M-TE-2's Amber band — deciding here does not reopen that rule.
- **MRL vocabulary**: D-M-TE-1 constrained TRL only. If any MRL cutoff is adopted, the MRL scale convention (deskbook 1–10) needs the same enum/vocabulary treatment TRL received before a rule or checklist validator enforces it — flagged now so it is not discovered by the reflection PR.
- Deciding A2-* retires the "cutoffs ILLUSTRATIVE" residuals on cells 2/4/6/8 of the design's §G matrix.

---

## 3. Agenda item 3 — (c) Synergy certification criteria + 90-day attrition threshold

**Context** (design §B.2 phase 4, §B.4): PMI integration governance is held until the **synergy run-rate is certified by Finance**, the end-state operating model is announced, and retention milestones pass; only then is the IMO demobilized (with no open-item transfer lacking a named line-executive owner and date) and the final synergy accounting published. Two kill-criteria registry entries wait on this item:

- `synergy_run_rate_uncertified_at_bau_handover` — blocks IMO demobilization (a completeness fact, not a judgment call);
- `key_talent_attrition_above_threshold_at_90d` — escalates to risk-officer (threshold ILLUSTRATIVE until set here).

Synergy tracking already runs monthly promised-vs-actual with escalation of late/unowned items, through the five stage gates (ideas → quantified ranges → vetted plans → budget-embedded → impact accrual — gate count ILLUSTRATIVE).

### 3a. What "certified by Finance" requires

| Component | Options (all `[UCD]` until the corpus) |
|---|---|
| Run-rate floor | (i) ≥ 90% of the bottom-up validated target, sustained over 2 consecutive monthly closes; (ii) 100% at a single close; (iii) ≥ 80% sustained over 3 closes (tolerant-forestalling) |
| Signoff artifact | The published final synergy accounting, signed by: (i) the Finance controller of the acquiring entity; (ii) CFO |
| Attribution rule | Synergies measured against the pre-close baseline set during diligence (design §B.2 phase 1 — already the procedure's rule; confirm or amend) |

**DECISION (item 3a)**: floor __________ ; signoff __________ ; attribution __________

### 3b. 90-day key-talent attrition threshold

Numerator/denominator: departures from the **named key-talent list** identified during diligence, by day 90.

| Option | What it implies |
|---|---|
| ≥ 10% | Early-warning posture — fires often, escalations are cheap |
| ≥ 15% | Mid-band |
| ≥ 20% | Fires only on clear retention failure |

Also decide the numerator: all departures, or regretted voluntary departures only (recommended — non-regretted exits are not integration failure).

**DECISION (item 3b)**: threshold ____ % ; numerator: ______________________

---

## 4. Agenda item 4 — (d) Deal-shape selection thresholds

**Context** (design §A.3): gate P3 selects the deal shape (license-in / co-development / minority / JV / full M&A) on **five criteria** — control need, IP position, capital at risk, exit optionality, time-to-market. The design fixes the criteria; the **weights and any minimums** are this item. The kill-criteria entry `no_viable_deal_shape` (Recycle, not Kill — the need returns to the scouting funnel with written feedback) reads exactly this threshold: "no shape meets the strategic-fit threshold."

| Option | What it implies |
|---|---|
| **D1 — Equal weights** (1/5 each, no minimums) | Simple scorecard; no criterion can veto. Risk: a shape scoring well on four convenience criteria but failing control need still passes. |
| **D2 — Weighted with knockout minimums** | Control need and IP position carry pass/fail minimums (a shape that cannot deliver the control the capability requires, or whose partner chain-of-title fails, is out regardless of total score); the remaining three carry weights. Most faithful to §A.3's own ordering. |
| **D3 — Lexicographic (control-need tiers)** | First resolve access / share / own from the control-need answer, then score the remaining criteria within that tier. Deterministic and explainable; coarser. |
| **D4 — Deferred** | Qualitative matrix with named-gates rationale; thresholds join the calibration backlog. The `no_viable_deal_shape` criterion stays inert. |

**DECISION (item 4): D__** — weights/minimums: ______________________

---

## 5. Agenda item 5 — Calibration corpus (data request, NOT a decision)

**Request**: 5–10 historical cases with known outcomes, **greenfield + brownfield mix**, from the group's own review history.

**Why this is the gating item**: the corpus alone gates (i) the **Decision 9 Green-cap lift** (ADR-0049 — Amber/Red only until calibration; restated in the premises of all three 2026-08-23 records) and (ii) the **first recalibration pass** — every `[UCD]` (uncalibrated default) number in the approved records is tagged a first-recalibration candidate with an ordered backlog (e.g. the market TAM floor 1e11 KRW, highest priority; TRL band edges; permit-duration 18 vs 12 months). It is also the empirical basis the portfolio benchmarks (E.1, 20–30% CVC odds — ILLUSTRATIVE) were deferred to.

**Shape needed per case** (minimum, to make a dry-run scorable): the deal thesis and classification axes; gate outcomes with dates; the RAG-relevant evidence as it was known at the time (market size/growth/share where stated, TRL/IP/permit facts, covenant and partner facts); and the realized outcome (synergy realization for M&A; graduate / reduce / divest / kill for ventures; covenant performance).

With the corpus, the dry-run scores each case under the current enabled rules, ranks `[UCD]` numbers by how often flipping them would change a grade, and produces the recalibration proposal + Green-cap lift recommendation as a new dated record.

**CORPUS: provided / partially provided (n = __) / not available** — notes: ______________________

---

## 6. Agenda item 6 — Antitrust kill-criteria extension (#13): premise withdrawal (yes/no only)

**Premise on record**: migration-0018 Decision 4 locked `antitrust_finding` into the `regulatory_permit` dimension and **excluded antitrust vars from the risk/market evidence-var registry**. ADR-0060 row 13 (`brownfield-screening__preliminary_hhi_flags_certain_block`) is therefore **premise-locked class (iii)**: expressing it requires a **reversal ADR** superseding that premise — not a seed. Guard already on record: `market.bargaining_power_hhi` is value-chain HHI, not antitrust screening HHI — it must not be reused for #13.

| Option | What it implies |
|---|---|
| **YES** | Authorize drafting the reversal ADR (antitrust screening signal becomes registry-eligible); #13 then proceeds through the normal extension round — var design, filler, anchors. |
| **NO** | The premise stands. #13 stays procedural — preliminary antitrust block judgment remains a human screening step, never a machine-evaluated criterion. |

**DECISION (item 6): YES / NO**

---

## 7. What each decision unlocks (verified against ADR-0060 §3)

Mapping checked entry-by-entry against the ADR-0060 classification-of-record table (29 entries: 3 class (i) / 1 class (ii) / 25 class (iii)):

| This pack's item | ADR-0060 entries unblocked | Verified detail |
|---|---|---|
| 1 (b) JV weights/cadence | **none** | No (b)-tagged row exists in the table; ADR-0059's consequences state scorecard rows are evidence, not gate-time halts. The unlock is the live E.4 surface (governance anchoring for `jv-lifecycle-governance#2` + rollup), not the kill-criteria registry. |
| 2 (a) TRL/MRL cutoffs | **none** | No (a)-tagged row exists in the table either. The unlock is the checklist/procedure layer: the ILLUSTRATIVE flags on rbd-08..rbd-13 retire and §G cells 2/4/6/8's residual closes. |
| 3 (c) synergy + attrition | **#28** `pmi.key_talent_attrition_90d`, **#29** `pmi.synergy_run_rate_certified` | Both are "(iii) + (c)" — dual-blocked. Item 3 removes the **threshold** half only; the class-(iii) **var** half still requires a registry-extension ADR round (ADR-0060 §3: one lifecycle dimension at a time, never a silent seed). |
| 4 (d) deal-shape thresholds | **#14** `dealshape.viable_shapes` | Same dual structure: "(iii) + (d)". Threshold half removed here; var half waits for the extension round. |
| 5 corpus | n/a (not a registry unlock) | Gates the Decision 9 Green-cap lift, the first `[UCD]` recalibration pass, and the 19th rule (`market-dd-right-to-win`, `enabled=0` under the cap per D-M-MKT-10). |
| 6 antitrust | **#13** — only via reversal ADR | Premise-locked; YES authorizes the reversal ADR, after which #13 enters the normal extension path. |

**What the already-approved 2026-08-23 records unlocked — verified, and already landed**: the sole registry entry whose only blocker was threshold indecision was **#3** (the greenfield partner-dependency twin), and ADR-0060 §2 has already expressed and enabled it (`policy_id: gd-0022-risk-thresholds`, citing D-M-RISK-3 + AI-1) — registry now 29 declared / 3 executable / 3 enabled. **No further kill-criteria entry waits solely on the approved records**; the remaining class-(iii) backlog is var-blocked, not threshold-blocked. Several of its rows have thresholds already decided by their own criterion wording (e.g. #5/#6 `fin.wacc_source_status`, #7/#8 `cert.load_bearing_unconfirmed`, #9 `cert.transferability_inferred_count`, #10 `validators.applicable_missing`, #17, #18, #20) and are therefore **seedable in follow-up extension rounds independent of this pack** — per-dimension ADRs, no silent seeding.

**Also registered, outside this pack's items**: ADR-0060 §4 registered row #4's threshold need (per-project incentive deadline vs `permit.critical_path_duration`) as a **new** thresholds-agenda item — it is a per-project convention, not a registry constant, and is not covered by (a)–(d). It is noted here so it is not lost; propose the convention when the greenfield incentive-deadline data shape is next touched.

---

## 8. Post-decision procedure (what happens after the user decides)

1. **Thresholds reflection PR** — each decided item lands in its artifact: the rbd-08..rbd-13 cutoff text (item 2), the JV governance-doc reference for weights/cadence (item 1, per ADR-0059's pattern), and the certification/attrition and P3 threshold text (items 3–4) wherever the producing procedure/checklist carries it. The PR must pass `bun procedures/_validate.ts --strict` — in particular the anti-tamper check (enabled ⇒ `policy_id` AND `thresholds_source`, mirroring the `rag_rule` CHECK from migration 0012): any criterion enabled by these decisions carries both governance anchors or it does not ship enabled.
2. **Seeding of unlocked vars** — #28/#29 (item 3) and #14 (item 4) proceed as explicit registry-extension rounds per ADR-0060 §3: one lifecycle dimension at a time, each with a filler, migration seeds, tests, and its own ADR recording why the var set is now decidable. No silent seeding.
3. **Executable re-baseline** — any change to the enabled count bumps `procedures/_kill-criteria/_baseline.json` in the same change (ADR-0060 §5 convention, so the strict gate and the count never drift).
4. **R9 orchestrator design ADR** — MVP scope per the 2026-08-24 leads' meeting: run lifecycle persistence, resolved-snapshot fixation, step state machine, dispatch loop, human-step pause/resume. Non-goals: auto-retry/schedulers, agent accounts, auto-approval.
5. **R9 implementation gate** — implementation proceeds only after one manual full-procedure run OR an explicit user GO.
