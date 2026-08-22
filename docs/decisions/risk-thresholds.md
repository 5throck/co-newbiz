# Decision Record — Risk Dimension Thresholds

**Approval**: all decisions as drafted (user “go”, 2026-08-23); recorded alternatives remain recalibration candidates.

**Date**: 2026-08-23
**Status**: APPROVED by user, 2026-08-23; supersedes the open/ agenda, which is removed in the same change.
**thresholds_source value for PR-9**: `docs/decisions/risk-thresholds.md — D-M-RISK-1..7, meeting 2026-08-23 (risk-officer, valuation-agent, legal-counsel, process-governance-manager chair)`

**Participants**:

| Agent | Role in meeting | Contributes |
|---|---|---|
| risk-officer | Risk evidence owner; Kill Criteria authority | Axis scope, kill-trigger boundary, calibration ownership |
| valuation-agent | Contingent liability / covenant mechanics | Monte Carlo integration semantics (ADR-0026), covenant test mechanics (ma-11) |
| legal-counsel | Covenant interpretation, partner contract exposure | Recognition-threshold anchoring, vocabulary |
| process-governance-manager | Chair; owns the record and the D-M3-* precedent | Procedure precedence, registry boundary, record format |

**Record-of-note (mandated by the agenda, §2)**: partner-sourcing failure is one of the risk-officer's own three declared kill-triggers (`agents/risk-officer.md` Responsibilities: covenant breach in downside scenarios, non-transferable mandatory certification, failed partner sourcing), yet it was **entirely absent from the original risk-dimension mapping** until design Decision 8 / risk-officer F8 added it. The absence of one of the risk owner's own kill-triggers from the risk owner's own evidence mapping is recorded here as the mapping-defect class this meeting exists to close: ownership of a risk is not evidence that the risk is measured.

**Locked premises applied, not re-litigated**: (1) `antitrust_finding` excluded from `risk` (regulatory_permit owns it; reversal requires a separate ADR); (2) Decision 9 Green cap — uncalibrated `risk` rules emit Amber/Red only; (3) leniency direction on missing evidence is the principal failure mode — every rule's missing-evidence behavior is stated per operator (D-M-RISK-5); (4) D-M3-3 priority-ordered overall rule (any dimension Red ⇒ overall Red; kill criteria trigger Red independently).

**Calibration basis, stated once for all numbers**: the live DB has **zero rows** in `contingent_liability`, `covenant_test`, and `partner_candidate` (verified). The pilot set offers **no quantitative calibration** for these axes: pilots 001 and 002 both record ma-10/ma-11 (contingent liabilities, covenant breach) as "**Not executable from public data**" — they are internal DD outputs. Every monetary/probability cut below is therefore marked **uncalibrated default, first-recalibration candidate**, anchored to external standards and pilot deal scale, never to internal outcomes. The Stage 3 calibration dry-run (ADR-0049 §4, 5–10 historical cases) is owned by risk-officer and is the recalibration trigger.

**Scale semantics verified before any cut was chosen**: `contingent_liability.probability` is `CHECK (probability >= 0 AND probability <= 1)` (migration 0005) — a **0–1 ratio**, so cuts are written 0.5, not 50. Monetary vars are REAL (recorded F-3 debt); all cuts below are round integer KRW values (≤ 2^53, exactly representable as doubles), compared with `gte` after the engine's `quantize(1e-6)` (`db/lib/predicate.ts`), so the boundary sits far from fractional-accumulation noise and exact-equality edge behavior is a non-issue. At-threshold values fire (intended: at-threshold = material).

---

## D-M-RISK-1: Contingent liability — keep BOTH forms as separate rules (option c); v1 denominator is absolute KRW; ratio deferred

**Decision**: Both staged forms survive as separate rules at different priorities. Neither subsumes the other:

- The **expected-value form** (sum of probability × amount_expected) catches many-small-but-likely items; the two-factor form is blind to that shape.
- The **two-factor form** catches a single dominant item (large amount, moderate probability) whose expected value dilutes below the EV cut — exactly the tail-risk shape ADR-0026 says must thicken the Monte Carlo downside, and which a RAG rule must also see.
- Dropping either reopens a blind spot; keeping both was the staged intent (migration 0018 header: "staging both = option (c)") and is confirmed.

**Cross-row semantics of the two-factor form, accepted explicitly**: `risk.contingent_max_amount` and `risk.contingent_max_probability` are **per-factor maxima across rows** — the amount maximum and the probability maximum may come from different items. The staged conjunction therefore reads "a big item exists somewhere AND a likely item exists somewhere", which is slightly more sensitive than a same-row worst-item test. Accepted: the bias direction is toward more Amber signal on a Green-capped dimension, and a same-row form would require a differently-shaped var that was never staged.

**Denominator**: **absolute KRW in v1.** A ratio (to deal value or EBITDA) is more durable across deal sizes, but **no denominator evidence_var exists today** — neither deal value nor EBITDA is in the `evidence_var` registry. A ratio choice implies a new evidence_var plus its own filler and provenance rules, which is a staging PR of its own, not a threshold decision. Recorded migration path: at first recalibration, migrate to expected-value ÷ transaction equity value (pilot-anchored deal-size denominators exist in the case files), at which point the absolute-KRW rules are retired in the same change. valuation-agent's dissent recorded below.

**Non-duplication boundary vs the financial dimension (D-M3-1)**: financial bands read IRR/DSCR from simulation outputs; the risk rules here read **pre-simulation disclosure facts** (`contingent_liability` rows), not `simulation_result`. The same underlying rows feeding the Monte Carlo is by design (ADR-0026), not double-counting — the two dimensions grade different questions (modeled return impact vs disclosed exposure severity).

**Grade**: Amber (graded axis; not kill-triggering — see D-M-RISK-4). **Gate**: DD (ma-10 is a DD-step validator; no meaningful contingent-liability evidence exists earlier).

**Dissent (valuation-agent)**: wanted the ratio form now, arguing an absolute KRW cut misgrades a KRW 5T strategic deal vs a KRW 100B bolt-on. Outvoted on the missing-denominator-var fact; the absolute cuts are sized against pilot deal scale (below) as the interim mitigation, and the ratio migration is a recorded commitment, not a deferral without a path.

## D-M-RISK-2: Covenant breach — any single breach in the latest downside test fires; grade Red; type/cure distinctions deferred for cause (no source columns)

**Decision**: `count(risk.covenants_breached) >= 1` fires **Red**. Single breach suffices — no count threshold above 1.

- **Basis**: the risk-officer's kill-trigger definition is "covenant breach **in downside scenarios**" — singular breach suffices; a count > 1 would be lenient on the first breach, which is the wrong direction under locked premise (3). The +200bp rate-shock test is already mandated by checklist ma-11, so the evidence the rule reads is itself a mandatory no-waiver DD validator output.
- **Grade Red, not Amber**: see D-M-RISK-4 for why Red-at-dimension-level is the correct v1 carrier for a kill-grade fact.

**Recency window — resolved structurally, not numerically**: `covenant_test` (migration 0011) is keyed `(simulation_id, period_id, covenant_key)` with only `breached INTEGER` — there is **no historical-breach record at all** in the schema; the table stores the *projected forward-looking test* per simulation run. "Recency" therefore means: **the latest run only**. The filler counts `breached=1` rows across all periods of the project's **latest** simulation; stale runs are excluded. The agenda's recency-qualified variant (`covenants_breached_recent` + `covenant_type` membership) is **confirmed dead** — not staged, and it cannot be staged without new columns. It does not die for policy reasons; it dies because its evidence does not exist.

**Cured-breach treatment — deferred for cause**: `covenant_test` has no cure/status column; a cured breach is indistinguishable from a live one. v1 counts every `breached=1` row of the latest run. Any cure semantics require a schema change (a `cured_at` or `status` column), which is ADR-triggering per the lifecycle rules and out of scope for a thresholds record. Deferred to first recalibration, with the note that cure-treatment is a **leniency** question and must not be introduced without evidence that cured breaches are non-predictive.

**Financial vs affirmative covenant type — deferred for cause**: covenant definitions live in `debt_instrument.covenant_json` (free TEXT); `covenant_test` carries only `covenant_key`. No type column exists; a type distinction in v1 would parse unconstrained JSON by convention, which is exactly the typo-silently-fails-to-match failure the corrected market mapping warned about (rag-framework §5-1). Deferred; when introduced it should land as a CHECK-constrained column, not a parsing convention.

**Non-duplication vs financial**: D-M3-1 reads IRR/DSCR; nothing in the financial bands reads `covenant_test`. No double count.

**Gate**: DD. **Missing-evidence behavior**: see D-M-RISK-5 — the no-debt vs test-not-run split is load-bearing here.

**Dissent (risk-officer, recorded as action item)**: covenant breach under downside with change-of-control acceleration is declared a Kill Criteria candidate by both risk-officer.md and valuation-agent.md, yet **no procedure YAML declares it** (brownfield-dd's two kill criteria are the validators-completeness and certification-inference halts). risk-officer wants the kill criterion declared in `brownfield-dd/schema.yaml` now. Chair ruling: procedure YAML is authoritative and the kill-criteria registry is the single inventory; adding a criterion is a procedure change with policy-impact analysis, not a thresholds decision. Recorded as action item AI-1 (below), with the interim carrier being this Red rule plus D-M3-3.

## D-M-RISK-3: Partner sourcing — status enum and dependency vocabulary confirmed; floor = at most 1 active candidate; conjunction retained; graded Amber with the kill path left in the registry

**Decision**:

- **`partner_candidate.status` enum confirmed** (schema has no CHECK; default `'sourcing'`): six values — `sourcing`, `contacted`, `in_negotiation`, `signed`, `withdrawn`, `rejected`. Landing a CHECK constraint lands with the activation/filler PR (the 0018 header refused to land CHECKs *pre*-meeting; this record is the meeting, so the vocabulary is now policy).
- **Active/viable set = `{contacted, in_negotiation, signed}`** — evidence of counterparty engagement. `sourcing` (the unconstrained default) is a longlist entry, not demonstrated viability: counting it would let a names-only pool mask a sourcing failure, the exact false-pass shape premise (3) prohibits. `withdrawn`/`rejected` are explicitly out.
- **`dependency_risk` vocabulary = `{high, medium, low, none}`** — three severity grades plus `none`. The `none` member is load-bearing (see D-M-RISK-5): a project with no structural partner dependency writes `none`, making the rule **determinately FALSE** rather than forever-UNASSESSED. Without it, every non-partner deal (e.g. pilot-005 SK hynix Yongin — no partner dependency disclosed) would be ungradeable on risk.
- **Candidate-count floor = `lte 1`** (the staged `lte 0` was the degenerate maximal-sensitivity placeholder; re-decided). Basis: the kill criterion's own name — `partner_dependency_unconfirmed_and_no_alternative` — defines "no alternative" as fewer than **two** viable candidates; a single surviving candidate means the deal dies if that one counterparty walks. Floor 0 would fire only on a fully emptied pool, which is lenient by exactly the case ADR-0031 exists for. **Uncalibrated default, first-recalibration candidate.**
- **Conjunction shape retained**: thin pool AND high dependency. A thin pool with low dependency (an optional-partner deal) is a sourcing nuisance, not a deal risk; a rich pool with high dependency is ordinary negotiation. Kleene walkthrough in D-M-RISK-5.
- **Filler aggregation semantics**: `risk.partner_dependency_risk` = the **maximum** severity across the project's `partner_candidate.dependency_risk` values (high > medium > low), `none` where the deal-structure hypothesis declares no partner requirement; missing only where the deal-structure hypothesis itself is unrecorded. `risk.partner_candidates_active` = count of rows with status in the active set.

**Grade**: Amber. **Gate**: **pre_fs** — restated from the staged default `dd`. Rationale: partner-dependency confirmation is a greenfield-Screening step and the existing kill criterion lives at Screening; a thin pool at Screening is normal noise (sourcing has just begun), but by Pre-FS a hard-dependency deal must show an engaged candidate or the ADR-0031 failure mode is live and should signal **before** DD spend. DD-stage partner evidence (jv_term) is reviewed by its own DD steps and the six-validator completeness gate; no second risk row in v1.

**Boundary with the kill path (the agenda §3.3 question "graded, kill-triggering, or both")**: **both, non-competing**. The graded Amber rule lives here; the kill path stays exactly where ADR-0031 and the YAML put it — `greenfield-screening`'s `partner_dependency_unconfirmed_and_no_alternative`, action `mark_conditional`. The same evidence may drive both; the kill action is never weakened by the graded signal, and the graded Amber never substitutes for a halt/mark_conditional the registry prescribes. No brownfield counterpart kill criterion exists today — gap recorded with AI-1.

## D-M-RISK-4: Per axis — graded, kill-triggering, or both; the guard against "Amber on a kill-grade fact"

| Axis | v1 carrier | Rationale |
|---|---|---|
| Contingent liability | Graded **Amber** only | No kill trigger for it exists in any agent definition or YAML; inventing one here would exceed a thresholds meeting's authority. Red band deferred to calibration rather than stacked uncalibrated cuts. |
| Covenant breach | Graded **Red** | A kill-grade fact per risk-officer's own mandate, but undeclared in any kill_criteria YAML. A dimension-level Red forces overall Red under D-M3-3 — operationally equivalent to a kill for the overall grade — without fabricating a registry entry. |
| Partner sourcing | Graded **Amber** here + kill path remains in the registry (`mark_conditional` at greenfield-screening) | ADR-0031's termination modeling is decided **per-project** on structural dependency; that judgement belongs to the procedure/registry layer, not a dimension rule. |

**The guard, three layers**:

1. **Grade ceiling per fact**: covenant breach is graded Red, full stop — the configuration "Amber on a fact that should have killed the deal" is impossible for this axis because no Amber rule reads `covenants_breached`.
2. **Intra-dimension priority order** — a defect caught in this meeting: the staged priorities (5=EV Amber, 6=two-factor Amber, 7=covenant Red, 8=partner Amber) would let the higher-priority Amber rules **mask the covenant Red** under first-match-wins evaluation. Restated at activation: covenant Red = priority 5, expected-value = 6, two-factor = 7, partner = 8 (D-M-RISK-7). Red precedes Amber within the dimension, mirroring D-M3-3's own Red-dominance at overall level.
3. **Registry precedence**: `procedures/**/schema.yaml` kill_criteria are authoritative for halt/escalate/mark_conditional actions (boundary #3). A risk rule firing Amber on the same evidence never cancels, dilutes, nor re-interprets a registry action. The boundary against brownfield-dd's existing criteria is clean: its two halts (validators-missing, certification-by-inference) are completeness/integrity conditions over **different** evidence; no overlap with the three axes here.

**D-M3-3 interaction stated**: any dimension Red ⇒ overall Red even with other dimensions unassessed (ADR-0049 §2) — so the covenant Red path is not delayed by missing market/technical evidence.

## D-M-RISK-5: Missing-evidence behavior, per rule, per operator

Engine semantics are ADR-0046 §2 / `db/lib/predicate.ts` (normative Kleene); leaf operators return UNASSESSED unless snapshot `status='present'`; `count` compares a numeric payload, it does not enumerate rows. The decisions below are the **filler contracts** (post-meeting filler PR, 0017 precedent) that make the Kleene behavior say what the meeting means:

| Var | Present with value… | Missing (UNASSESSED) when… |
|---|---|---|
| `risk.contingent_expected_value` | sum(probability × amount_expected), **0.0 when zero rows AND the contingent-liability DD validator has a coverage row** (six-validator completeness, step 10) | No validator coverage — "not yet diligenced", which must not read as "no liabilities" |
| `risk.contingent_max_amount` / `_max_probability` | MAX(amount_expected) / MAX(probability), same presence condition; 0 / 0.0 with coverage and zero rows | Same |
| `risk.covenants_breached` | Count of `breached=1` in the **latest run's** covenant_test rows. **0 when the project has zero `debt_instrument` rows** (legitimately nothing to test) | Project has debt instruments but no covenant test in the latest run — ma-11 not executed; the honest gap, forced into the no-waiver completeness path |
| `risk.partner_candidates_active` | Count of status ∈ {contacted, in_negotiation, signed}; 0 for no-partner-requirement deals | Deal-structure hypothesis unrecorded |
| `risk.partner_dependency_risk` | Max severity across candidates; `'none'` when no partner requirement declared | Deal-structure hypothesis unrecorded |

**Per-rule Kleene walkthroughs** (the leniency audit premise (3) demands):

- **Contingent EV / two-factor**: var missing ⇒ leaf UNASSESSED ⇒ rule UNASSESSED ⇒ contributes nothing to the dimension; dimension becomes UNASSESSED unless another rule fires TRUE. An undiligenced deal cannot grade risk-Green-by-silence. Note the two-factor `all_of`: `all_of(UNASSESSED_amount, TRUE_prob) = UNASSESSED` (decisive missing propagates); `all_of(FALSE, UNASSESSED) = FALSE` — one factor determinately below cut blocks the rule even when the other is unknown, which is correct: a big-but-nowhere-near-likely exposure alone is the EV rule's business, not this one's.
- **Covenant**: var missing ⇒ UNASSESSED ⇒ dimension UNASSESSED (unless contingent/partner rules fire) ⇒ overall null (no row written, ADR-0049 §2). The dangerous alternative — defaulting an untested project to 0 breaches — is precisely the false-pass and is excluded by the no-debt-vs-untested split above.
- **Partner**: `all_of(TRUE_thin_pool, UNASSESSED_dependency) = UNASSESSED` — a thin pool with dependency unassessed is not graded, it is flagged; it resolves only when the dependency assessment exists. `all_of(TRUE, FALSE)` — thin pool, low/medium/none dependency — determinately does not fire. `in` with an unrecognized payload string (vocabulary typo) returns FALSE only if the payload type matches a member type; a misspelled severity reads as non-high ⇒ rule silent — which is why the CHECK constraint on the column lands with the activation PR (D-M-RISK-3).

**Dimension-level combination rule (pinned for PR-9)**: rules evaluate in priority order; the dimension grade is the grade of the highest-priority rule evaluating TRUE; UNASSESSED rules are skipped, not matched; if no rule is TRUE and any is UNASSESSED the dimension is UNASSESSED; if all are FALSE the dimension would be Green and is **capped to Amber** under Decision 9 until calibration lifts — structurally consistent with ADR-0049's near-zero-cost argument (all-six-Green was already unreachable while any of the three capped dimensions exists).

## D-M-RISK-6: Every numeric threshold

| # | Rule | Threshold | Calibration basis | Status |
|---|---|---|---|---|
| 1 | `risk-dd-contingent-expected-value` | expected value **≥ KRW 10,000,000,000** (`100억`) | Deal-scale materiality heuristic (~1–5% of equity check) vs pilot anchors: pilot-002 total consideration KRW 226.9B (4.4%), pilot-010 SK Rentcar KRW 820B (1.2%) | **Uncalibrated default, first-recalibration candidate** |
| 2 | `risk-dd-contingent-two-factor` | max amount **≥ KRW 30,000,000,000** (`300억`) AND max probability **≥ 0.5** | 0.5 = more-likely-than-not / "probable" provision-recognition threshold (K-IFRS provision practice); 30B ≈ 3.7–13% of pilot equity checks, set ~3× the EV cut because this form fires on a single maximum-severity item. 0.5 is exactly representable in binary (2⁻¹) — no boundary representation risk | **Uncalibrated default, first-recalibration candidate** |
| 3 | `risk-dd-covenant-breach` | **≥ 1** breach (latest run) | Structural, from the kill-trigger definition's own singular; not a number awaiting calibration | Decided (structural) |
| 4 | `risk-dd-partner-sourcing` | active candidates **≤ 1** AND dependency **= high** | "No alternative" ≡ fewer than two viable candidates, from the kill criterion's own name and ADR-0031's wording | **Uncalibrated default, first-recalibration candidate** |

## D-M-RISK-7: Mapping onto the four staged rules (migration 0018)

All four staged rules survive — **neither contingent form is dropped** (option (c) confirmed, D-M-RISK-1); the only casualty is the agenda's recency-qualified covenant variant, which was never staged and is confirmed dead for want of source columns (D-M-RISK-2). Stage gates restated from the inert `'dd'` default; priorities restated per D-M-RISK-4 layer 2. Grades restated from the all-Amber placeholder convention.

| rule_key | final condition_expr | grade | stage_gate | priority |
|---|---|---|---|---|
| `risk-dd-covenant-breach` | `{"op":"count","var":"risk.covenants_breached","cmp":"gte","value":1}` | **red** | dd | **5** (was 7) |
| `risk-dd-contingent-expected-value` | `{"op":"cmp","var":"risk.contingent_expected_value","cmp":"gte","value":10000000000,"unit":"krw"}` | amber | dd | 6 (was 5) |
| `risk-dd-contingent-two-factor` | `{"op":"all_of","of":[{"op":"cmp","var":"risk.contingent_max_amount","cmp":"gte","value":30000000000,"unit":"krw"},{"op":"cmp","var":"risk.contingent_max_probability","cmp":"gte","value":0.5,"unit":"ratio"}]}` | amber | dd | 7 (was 6) |
| `risk-dd-partner-sourcing` | `{"op":"all_of","of":[{"op":"count","var":"risk.partner_candidates_active","cmp":"lte","value":1},{"op":"in","var":"risk.partner_dependency_risk","values":["high"]}]}` | amber | **pre_fs** (was dd) | 8 |

Changes from the staged rows: covenant grade amber→red and priority 7→5; partner `lte 0`→`lte 1`, in-values placeholder→`["high"]`, gate dd→pre_fs; the two contingent rules' string placeholders→the D-M-RISK-6 numbers. `rag_rule_variable` join rows need no change (same var sets). Green cap note: no rule in this set carries grade green — the Decision 9 cap is structurally satisfied and bites only if a future Green rule is added pre-calibration.

**Gate applicability, stated**: risk is **UNASSESSED at Screening** for all projects (no fillers run there) — with financial Amber-capped at Screening, this yields overall null at Screening unless a Red fires elsewhere; accepted as the honest reading under ADR-0049. Pre-FS: partner rule live, contingent/covenant unassessed. DD: all four live.

---

## Dissents (recorded, all overruled with reasons)

1. **valuation-agent** — ratio denominator now (D-M-RISK-1): outvoted on the missing-denominator-var fact; migration path recorded as a commitment.
2. **legal-counsel** — probability cut 0.4 with an OR-shaped single-item rule, to catch "reasonably possible"-grade disclosure exposures (~30–40% band in contingency-disclosure practice): outvoted because the marginal mid-band cases (e.g. 20B at 0.45, EV ≈ 9B) sit below the EV cut only narrowly, the recognition threshold 0.5 is the principled anchor, and the Green cap already forces human reading of every pre-calibration Amber. Recorded as a named alternative for the first recalibration.
3. **risk-officer** — declare the covenant/CoC kill criterion in procedure YAML now (D-M-RISK-2): outvoted on scope (procedure change ≠ threshold decision); carried as AI-1.

## Action items

- **AI-1** (risk-officer, post-approval, procedure track): propose kill-criteria YAML additions — `covenant_breach_with_coc_acceleration_under_downside` (brownfield-dd) and a brownfield counterpart to `partner_dependency_unconfirmed_and_no_alternative` — through the procedure-change path with policy-impact analysis; predicates only over the vars seeded in 0018.
- **AI-2** (filler PR, activation window): implement the D-M-RISK-5 filler contracts; land CHECK constraints on `partner_candidate.status` and `.dependency_risk` per the confirmed vocabularies.
- **AI-3** (risk-officer, calibration window): first-recalibration agenda = the four uncalibrated cuts, the ratio-denominator migration (D-M-RISK-1), a Red band for contingent liability, and cure/type covenant semantics pending schema.