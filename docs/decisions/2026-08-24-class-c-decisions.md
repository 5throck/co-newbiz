# Decision Record — Class C Residual Decisions (Approved Async)

**Status**: APPROVED
**Date**: 2026-08-24
**Decided by**: User (async session approval; boundary #2 — human decision)
**Chair**: pm | **Grounding research**: `docs/research/residual-decisions-best-practice.md`
**Supersedes**: nothing (first approval of these six items) | **Amends**: ADR-0052 open questions (a)–(d); enables antitrust #13 reversal per ADR-0060 §3

---

## Decisions

### (a) TRL/MRL per-gate cutoffs — CONFIRMED as drafted, MRL conditional

All six rbd-09..rbd-13 matrix rows confirmed verbatim from the pack (Screening TRL 1–2 / Pre-FS TRL 2 / FS-entry TRL 3 / FS-DD TRL 4–5 + MRL 4–5 / Entity-IC TRL 5–6 + MRL 5–6 / Post-IC TRL 7–8 + MRL 7–8). External anchors: EU EIC windows (Pathfinder 1–4 / Transition 4→5-6 / Accelerator 6-8), DoD milestone congruence (MS-A≈MRL4 / MS-B≈6 / MS-C≈8).
**Conditions**: (1) MRL applies ONLY to hardware-making ventures, binding from A2-4 onward; software/service ventures are assessed on TRL alone. (2) If/when MRL becomes an evidence var, it enters as the `MRL1..MRL10` membership enum mirroring D-M-TE-1 (`in` predicates, no ordinal var). (3) FS-DD/Entity-IC (TRL 5→7 Valley of Death) are the designated recycle/hold decision zones. ILLUSTRATIVE markers on the checklist rows lift upon this record.

### (b) JV scorecard weights and cadence — EQUAL WEIGHTS + QUARTERLY

Seven dimensions scored UNWEIGHTED with per-dimension red-flag thresholds (Ankura/Watermark flat-rollup precedent; no published JV framework discloses weights). Scoring cycle: QUARTERLY on the landed `'YYYY-Qn'` axis, consumed by the quarterly JV board cycle; annual deepening layer (strategy off-site / strategic asset review); triennial external governance review; event-driven re-score on defined triggers (deadlock, milestone miss, capital-call deviation). Differential weights revisited only after 4–6 quarters of accumulated cycles, cross-case evidence required. Resolves ADR-0052 open question (b).

### (c) Synergy certification + attrition thresholds

Certification floor (BAU-exit certifier input): **≥90% of committed COST-synergy run-rate** in annualized P&L actuals vs the baseline locked at close; revenue synergies annexed, not a precondition. Sustainment: **2 consecutive quarters** (or 3 monthly closes). Signatures: CFO signs, deal controller prepares, each synergy owner countersigns, IMO lead co-signs, steering committee minuted. Package: initiative register (owner/baseline/target/actioned/run-rate/months sustained), variance commentary with dated recovery plans, revenue annex, open-item handover register, 12-month lookback clause. Baseline changes post-close require CFO approval + disclosure.
Attrition tripwire (key-talent list locked at close; numerator = regretted only, excluding planned exits and synergy RIF): **90d ≥10% → escalation**; 15% → steering-committee intervention; 20% → failure classification feeding deal lookback; **12-month cumulative ≤20% regretted** as a demob retention milestone. Resolves ADR-0052 open question (c).

### (d) Deal-shape selection at P3 — TWO-STAGE, NOT ONE WEIGHTED SCORE

Stage 1 intent split: integration intent ⇒ majority/M&A shapes (JV/minority only as staged options); capability-access intent ⇒ control bounded by the NVCA-derived rights floor (information rights, board seat/observer, pro-rata, ROFR/co-sale, separately-priced tech license with sunset exclusivity). Stage 2 within surviving branch: five criteria (control need, capability criticality, market uncertainty, integration capacity, speed-to-capability), equal 20% weights × 1–3 scale, PLUS lexicographic override BEFORE the sum: control-need=high AND partner knowledge tacit ⇒ license/co-dev disallowed regardless of total. Default staging: high uncertainty + moderate control ⇒ minority/co-dev WITH pre-negotiated step-up (call option / ROFR / conversion trigger at next gate). Resolves ADR-0052 open question (d).

### Calibration corpus — BOUNDED ANALOGY, GREEN CAP LIFTS ONE TIER MAX

The 5–10 historical cases form a bounded ANALOGY corpus, never a distribution. Green-cap lift justification = wider-class base rate + corpus consistency, never corpus hit-rate alone. Guards adopted: rule moves at most one confidence tier per revision; case joins a class only on ≥2 pre-declared membership properties; <3 matching cases ⇒ widen the class instead of fitting; pre-registration limits calibration to Green-cap lift + threshold nudges (never new kill criteria); no rule fitted to a single case; cases retire after 5–7 years. Per-case fields as listed in the research report §5.3. This is the standing gate on the Decision-9 Green-cap lift.

### Antitrust #13 premise — REVERSED (YES)

Migration-0018 Decision 4 reversed per ADR-0060 §3: antitrust early-screening becomes a risk-layer flag at P1/P3 instead of being locked out of the evidence plane. Screens: combined share >30% → deeper-analysis flag; post-merger HHI >1,800 AND delta >100 → presumption-risk Amber; filing triggers (≥$133.9M HSR-2026 / KFTC 300bn-30bn / EUR 5bn-250M) → timeline flags. Red/kill-path reserved for presumption territory with no remedy path. USD/EUR thresholds stored as verified_on-dated profile fields, NEVER constants. Deep filing analysis stays in `regulatory_permit`. Unblocks kill-criteria registry entry #13 via the reversal path; the mirror/computed var seeding follows ADR-0060 §3 discipline.

---

## Implementation sequence (subsequent PRs)

1. Threshold/evidence landing PR(s) — every activation passes `_validate.ts` anti-tamper (`enabled:true` ⇒ `policy_id` + `thresholds_source`); this record is the `thresholds_source`.
2. Seed unlocked class-(iii) vars per dimension (per-dimension extension ADRs where ADR-0060 §3 requires; #18 ip_assignment-type completeness facts may seed directly).
3. Antitrust #13 reversal ADR (migration-0018 D4) before any antitrust var seeds.
4. Re-baseline `_baseline.json` executables; same-change bump only.
5. Checklist ILLUSTRATIVE-marker lifts (rbd rows, bau-exit template PENDING-(c)) in the reflection PR.
