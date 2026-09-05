# Decision Record — Technical Execution Dimension Thresholds

**Approval**: all decisions as drafted (user “go”, 2026-08-23); recorded alternatives remain recalibration candidates.

**Date**: 2026-08-23
**Chair and record owner**: process-governance-manager (owner of the D-M3 precedent, `docs/governance/rag-framework.md` §2–§4)
**Participants**: technical-dd-agent (technology evidence owner), certification-agent (certification transferability), platform-lead (predicate AST / schema feasibility, ADR-0046), risk-officer (adversarial challenge), process-governance-manager (chair)
**Replaces**: `docs/decisions/open/technical-execution-thresholds.md` (the agenda; every `임계값 미정` slot is filled below)
**Becomes**: the `thresholds_source` value cited by every `technical_execution` rule at PR-9 activation
**Locked premises honored, not re-litigated**: Decision 9 Green cap (Amber/Red only until calibration — nothing below lifts it); UNASSESSED as the normal pre-DD state; `antitrust_finding` excluded from this dimension (regulatory_permit owns it); the two CHECK enums land before rule authoring.

**Calibration ground truth**: live DB has 0 rows in `dd_finding`, `certification`, `permit`, `permit_edge`. Every number below is calibrated against the 14 pilot case files plus external standards, and each basis is stated. Numbers with no two-anchor calibration are explicitly marked **uncalibrated default — first-recalibration candidate**.

**Doctrine line used for every grade choice**: Red is reserved for *definitional* case-breaking facts (the evidence, by its own semantics, kills the thesis as presented); Amber covers material-but-restructurable exposure. This is the only direction consistent with the Green cap: over-signalling Amber is the designed pre-calibration bias; over-signalling Red kills deals the framework has no calibration right to kill.

---

## D-M-TE-1 — `trl_grade` enum: TRL1..TRL9 confirmed; membership treatment; ordinal deferred

**Decision**. The enum is exactly `TRL1`..`TRL9` (uppercase prefix, single digit, no zero-padding). Treatment is **membership (`in`)**, not ordinal: the staged var `tech.trl_grade` (string) is used as-is; **no `tech.trl_grade_ordinal` var is added in v1**. Ordinal treatment is recorded as a recalibration option only.

DDL-ready (prerequisite, lands before rule authoring — `dd_finding` verified 0 rows today, so the SQLite table rebuild is trivially safe in the current window):

```sql
CHECK (trl_grade IS NULL OR trl_grade IN
  ('TRL1','TRL2','TRL3','TRL4','TRL5','TRL6','TRL7','TRL8','TRL9'))
```

**Basis**. TRL 1–9 is the NASA/EU Horizon standard scale; nothing in the pilot set suggests a tenth grade or a different granularity. Membership over ordinal (technical-dd-agent, platform-lead): the enum values are copy-stable strings from a now-constrained column, the membership list renders explicitly in the Korean governance prose a human signs, and a future re-cut edits an auditable value list rather than a comparison integer. Ordinal was rejected for v1 because it requires a new evidence var + filler for zero expressive gain at two bands.

**Gate applicability / missing evidence**. TRL evidence originates in DD findings (`technical-dd-checklist` tdd-03, `rbd-technology-checklist` rbd-01 — both gate: DD). Both TRL rules fire at `stage_gate='dd'` only. At Screening/Pre-FS/FS the var is structurally UNASSESSED — normal, not an error. At DD, a missing TRL is **UNASSESSED, not graded**: the mandatory checklist items (tdd-03/rbd-01) plus the gate-blocking completeness validator (ADR-0037/0048) own the forcing of the assessment; this dimension does not double as a completeness checker. Considered and rejected (technical-dd-agent proposal): an `is_null`→Amber conjunct symmetric with IP — rejected because TRL absence at DD is a not-yet-performed assessment (it requires the site-visit/document base), whereas IP-status absence is itself the adverse fact pattern in spin-off shapes (pilots 011/012: originator IP terms undisclosed). The asymmetry is deliberate and gate-dependent, per the agenda's own framing.

## D-M-TE-2 — TRL bands: Red TRL1–3, Amber TRL4–5, no adverse signal at TRL6+

**Decision** (at DD):

| Band | Condition | Grade |
|---|---|---|
| Pre-validation | `tech.trl_grade ∈ {TRL1, TRL2, TRL3}` | **Red** |
| Validation-stage | `tech.trl_grade ∈ {TRL4, TRL5}` | **Amber** |
| Demonstrated+ | `TRL6`..`TRL9` | no grade from this axis (not Green — Green cap) |

**Basis**. NASA/EU definitions: below TRL4 there is no validated proof of concept in any environment, so the quantitative DD evidentiary base (performance data, pilot results, corroboration under rbd-06) structurally cannot exist — an IC-gated DD case resting on it is definitional Red (it is venture-screening material, not DD material). TRL4–5 = validated in lab/relevant environment but no prototype demonstrated in an operational-representative environment: this is exactly the pilot-012 Studio341 spectrum (~70% pivot rate during selection — pre-commercial validation), contrasted with pilot-011 Amberoad (33 fielded internal deployments ≈ TRL9, no adverse technical signal) and pilot-014 C2Y (active KRISS standardization ≈ TRL5–6, joint-IP risk carried by the IP axis instead). Band boundaries are standard-anchored but not case-calibrated: **TRL band edges are uncalibrated defaults — first-recalibration candidates**.

## D-M-TE-3 — `ip_ownership_status` enum, unfavourable members, and the gate-dependent `is_null`

**Decision**. Enum (DDL-ready, same 0-row rebuild window):

```sql
CHECK (ip_ownership_status IS NULL OR ip_ownership_status IN
  ('owned_by_target','owned_by_originator','licensed_in','jointly_owned','disputed'))
```

Members are the ownership-chain shapes the four R&BD pilots actually distinguish: `owned_by_target` (clean chain, pilot-013's one-hop chain from the licensee side), `owned_by_originator` (spin-off with parent-retained IP, pilots 011/012), `licensed_in` (external licensor, pilot 013 ETRI), `jointly_owned` (active co-research, pilot 014 KRISS), `disputed` (contested chain). License quality (exclusivity, field of use) is deliberately out of the enum — it is a checklist/evidence fact, not an ownership status.

Unfavourable sets and grades (at DD):
- `disputed` → **Red** (definitional: the core asset's ownership is contested — the valuation basis is invalid as presented).
- `owned_by_originator`, `licensed_in`, `jointly_owned` → **Amber** (material dependency on a third party's continuing cooperation; negotiable, hence restructurable).
- `owned_by_target` → no adverse grade.
- **`is_null` at DD → Amber** (fires as TRUE whenever the var's snapshot status is not `present` — missing, stale, or low-confidence; per ADR-0046 §2 `is_null` evaluates against status). Absent IP status at DD *is* the signal (agenda §3.2): in spin-off and license-in shapes the undisclosed terms are precisely the adverse pattern.

**Gate dependence**. This grading is legal *only because the rule is stage-gated to DD*: at Screening/Pre-FS an absent IP status is not-yet-known, and the rule is simply not evaluated there (UNASSESSED is the normal state). The staged `is_null` conjunct is confirmed at DD, not generalized.

## D-M-TE-4 — Certification and permit are two axes; cert count cut; `load_bearing` enters v1 as a definitional Red discriminator only

**Decision**. **Two axes, one dimension.** Certification transferability (sell-ability on change of control) and permit critical path (schedule survival) are separate rules over separate tables, consistent with non-negotiable boundary #5 (a permit lets you operate, a certification lets you sell — separate issuers, procedures, critical paths; separate tables `permit`/`certification` since 0011 by design).

Certification rules (at DD):
- `count(cert.non_transferable_on_coc) ≥ 1` → **Amber**. **Uncalibrated default** (staged degenerate maximal-sensitivity integer, confirmed): one verified non-transferable certification is material (validator-applicability: "a non-transferable certification strips the acquisition premium") — first-recalibration candidate.
- **New rule**: `count(cert.load_bearing_non_transferable_on_coc) ≥ 1` → **Red**. `load_bearing` semantics per migration 0012: "1 = the business case depends on this certification (its loss kills the deal)". A *verified* non-transferable *load-bearing* certification is Red **by the column's own definitional semantics** — no statistical calibration is claimed. This is the only form of criticality weighting in v1; multi-level criticality weighting is **deferred** to post-calibration (there is no calibration data on how reliably writers set the flag — default 0 backfill).
- **Unknown transferability is never transferable** (hard constraint, respected): the count vars count only rows with `transferable_on_coc='no' AND transferability_basis='verified'`. Rows with no position taken are invisible to the count — and must be: the repository hard-blocks `basis='inferred'` at write time (`db/repositories/certification.repository.ts`), so no rule can ever see an inferred transferability, and no rule treats absence as `yes`. Completeness of positions is enforced by the sixth validator (no skip condition exists by design) and by DD-close cross-validation (`db/lib/dd-cross-validation.ts:152`), not by a RAG rule. Legitimate N/A shapes produce zero rows and correctly zero signal: pilot-006 (asset-tied regulatory pathway — drug approval travels with the asset, not the entity) and pilots 001/002 (equity-stake acquisitions that trigger no CoC re-assessment).
- **Companion CHECK (addition beyond the two premise-locked enums, necessitated by filler semantics)**: `transferable_on_coc` is currently vocabulary-free TEXT — `tests/unit/dd-cross-validation.test.ts:77` even writes the integer `1` into it. Constrain to:
```sql
CHECK (transferable_on_coc IS NULL OR transferable_on_coc IN ('yes','no'))
```
(NULL = no position taken.) The companion test write must be updated to `'no'`/`'yes'` in the same PR.

**Dissent registered (risk-officer)**: proposed an Amber rule on "certifications with no transferability position at DD, count ≥ 1" to make the RAG layer itself catch missing positions. Rejected 4–1: the no-skip certification validator already blocks gate pass on exactly this, and double machinery would Amber the legitimate N/A shapes (pilot-006 class). Registered as a first-recalibration candidate if the validator proves porous in calibration runs.

## D-M-TE-5 — Boundary vs `regulatory_permit`; double-counting guard

**Decision**. Adopt the candidate split, sharpened to one sentence each:
- **`regulatory_permit`**: *whether the permit/approval is obtainable, and on what conditions* — obtainability, conditions, remedies (behavioral/structural, §2.5), prohibition (pilot-010 Red lives there). It reads `permit.status` outcomes (granted/denied) and `antitrust_finding`.
- **`technical_execution`**: *whether the schedule survives obtaining it* — the permit DAG's timing (`statutory_days` sums along `permit_edge`), and how many discrete approval events still stand. A long statutory lead time is not unobtainability; a denial is not a schedule problem.

**Guard, stated per evidence piece** (enforced at PR-9 activation review via the `rag_rule_variable` join rows — an indexed lookup, not a LIKE scan):
- `permit.critical_path_duration`, `permit.unresolved_on_critical_path` → referenced by `technical_execution` rules only. No `regulatory_permit` rule may join to either var.
- `permit.status`, `antitrust_finding.*` → `regulatory_permit` only. No `technical_execution` rule reads them (antitrust exclusion is premise-locked anyway).
- Straddle case resolved: "unresolved" means *still pending* (`status ∈ {'not_started','in_progress'}`) — schedule exposure now. If a pending permit later becomes a denial, `regulatory_permit`'s own evidence catches it; the two dimensions may legitimately disagree over time as schedule risk resolves into either outcome. `denied`/`withdrawn` permits leave the critical path and force DAG re-derivation rather than counting as "unresolved".

**Prerequisite companion decision**: `permit.status` is currently unconstrained TEXT (default `'not_started'`). The unresolved-count filler is meaningless without a canonical vocabulary. Adopt (DDL-ready): `CHECK (status IN ('not_started','in_progress','granted','denied','withdrawn'))` with default `'not_started'`.

## D-M-TE-6 — Permit thresholds: duration cut > 18 months; unresolved count ≥ 1

**Decision** (at DD):
- `permit.critical_path_duration > 18` months → **Amber**. **Uncalibrated default — first-recalibration candidate.** Anchors: pilot-007's 484-day (~16-month) national average for a *single* heavyweight permit (shared-water-surface-use) and 24 months for one license stage (2017→2019); a critical *path* — sequenced permits — exceeding 18 months means more than one heavyweight stage in sequence or one plus contingency. 18 keeps the single-worst-known-permit average just inside the firing band without categorically Amber-ing every Korean heavy-permit case at 12.
- `count(permit.unresolved_on_critical_path) ≥ 1` → **Amber**. **Uncalibrated default** (staged degenerate integer, confirmed). Consequence accepted explicitly: nearly every GF project at DD (construction not yet started) fires this — correct under the Green cap (a GF project with pending critical-path approvals is genuinely schedule-exposed), and the count conjunct is also the false-pass guard for NULL `statutory_days` (see D-M-TE-8 filler: a DAG of unquantified permits sums to 0 duration; only the count catches it).
- No Red band for permits in v1: schedule overrun is restructurable (the model re-runs with a later revenue start), unlike the definitional Reds. Tail anchor for context: pilot-005's "usual 10 years" industrial-complex formation vs the 5-year target; pilot-007's ≥32-month designation-to-operator minimum under the new streamlined regime.

**Dissent registered (risk-officer)**: prefers a 12-month cut so the 484-day single-permit average alone fires; outvoted 3–1–1 on the no-two-anchor-calibration argument; recorded as the leading alternative for recalibration.

## D-M-TE-7 — Missing-evidence treatment per axis, per gate (Kleene, per operator)

All seven rules fire at `stage_gate='dd'` (the staged default is confirmed as the actual decision — TRL/IP evidence is DD-born; the permit DAG's DD-grade population is what a RAG rule should read; FS-stage permit estimates stay with the FS capex-schedule checklist, and FS firing is a recorded recalibration candidate for GF-heavy calibration sets like pilots 005/007). Carry-forward of a DD-gate `technical_execution` assessment to entity_ic/group_ic is a `rag_assessment`-level mechanic for the activation PR to state, not a threshold decision.

| Var | Pre-DD gates | At DD | Operator mechanics (ADR-0046 §2, as implemented in `db/lib/predicate.ts`) |
|---|---|---|---|
| `tech.trl_grade` | UNASSESSED (normal) | missing → UNASSESSED; completeness validator owns forcing | `in`: status ≠ present → UNASSESSED; type mismatch → UNASSESSED (surfaces authoring defect, never false-pass) |
| `tech.ip_ownership_status` | UNASSESSED (normal) | missing/stale/low-confidence → `is_null` TRUE → **Amber** | `is_null` evaluates against *status*: TRUE for anything not `present`, FALSE for present — so a stale or low-confidence determination grades as absent, which is the conservative reading and is intended |
| `cert.non_transferable_on_coc` / `cert.load_bearing_non_transferable_on_coc` | UNASSESSED | zero certifications with positions (N/A shapes) → count 0, present, no fire; no certification rows at all → UNASSESSED | `count`: numeric payload required; status ≠ present → UNASSESSED |
| `permit.critical_path_duration` | UNASSESSED | all permits granted → 0 months, present, no fire (schedule survived); no permit rows recorded → UNASSESSED — deliberately **not** zero: "no permit plan on record" is not "permit plan complete" | `cmp`: status ≠ present → UNASSESSED |
| `permit.unresolved_on_critical_path` | UNASSESSED | all granted → 0, present, no fire | `count` as above |

Composite behavior worth stating: `tech-dd-permit-critical-path` is `any_of[cmp, count]` — duration present and >18 fires Amber even when the count is missing (Kleene: TRUE dominates); both missing → UNASSESSED. `tech-dd-ip-clarity` is `any_of[in, is_null]` — at DD exactly one of the two can be non-UNASSESSED by construction, so no Kleene interaction arises.

## D-M-TE-8 — Rule mapping: final `condition_expr` values, priorities, gates, and activation prerequisites

Staged skeleton rows restated (placeholder scalars and the `stage_gate='dd'` staging default replaced per this record); three new rows authorized. Priorities restated 1–7, Red before Amber within each axis so the worst matching grade wins under priority-ordered evaluation. All rows: `dimension='technical_execution'`, `enabled=0` until PR-9, `thresholds_source` = this record.

| # | rule_key | prio | grade | final condition_expr |
|---|---|---|---|---|
| 1 | `tech-dd-trl-pre-validation` *(new)* | 1 | red | `{"op":"in","var":"tech.trl_grade","values":["TRL1","TRL2","TRL3"]}` |
| 2 | `tech-dd-trl-grade` | 2 | amber | `{"op":"in","var":"tech.trl_grade","values":["TRL4","TRL5"]}` |
| 3 | `tech-dd-ip-disputed` *(new)* | 3 | red | `{"op":"in","var":"tech.ip_ownership_status","values":["disputed"]}` |
| 4 | `tech-dd-ip-clarity` | 4 | amber | `{"op":"any_of","of":[{"op":"in","var":"tech.ip_ownership_status","values":["owned_by_originator","licensed_in","jointly_owned"]},{"op":"is_null","var":"tech.ip_ownership_status"}]}` |
| 5 | `tech-dd-cert-load-bearing-loss` *(new)* | 5 | red | `{"op":"count","var":"cert.load_bearing_non_transferable_on_coc","cmp":"gte","value":1}` |
| 6 | `tech-dd-cert-transferability` | 6 | amber | `{"op":"count","var":"cert.non_transferable_on_coc","cmp":"gte","value":1}` *(unchanged from staged)* |
| 7 | `tech-dd-permit-critical-path` | 7 | amber | `{"op":"any_of","of":[{"op":"cmp","var":"permit.critical_path_duration","cmp":"gt","value":18,"unit":"months"},{"op":"count","var":"permit.unresolved_on_critical_path","cmp":"gte","value":1}]}` |

**New evidence var (1)**: `cert.load_bearing_non_transferable_on_coc` — `value_type='number'`, `unit='count'`, `source_kind='computed'`, `requires_evidence_ref=0`, plus its `rag_rule_variable` join row.

**Filler semantics pinned** (the post-meeting filler PR implements exactly this; provenance flows through the source query per the 0017/0018 convention):
- `tech.trl_grade` = **minimum** TRL across `dd_finding` rows carrying a non-null `trl_grade` (weakest-link: a TRL9 production process cannot rescue a TRL3 core technology — rbd-01's own core-vs-process distinction); none → status `missing`.
- `tech.ip_ownership_status` = **worst** status across rows, total order `disputed > licensed_in > jointly_owned > owned_by_originator > owned_by_target`; none → `missing` (then `is_null` fires at DD).
- `cert.non_transferable_on_coc` = COUNT(`transferable_on_coc='no' AND transferability_basis='verified'`); the load-bearing var adds `AND load_bearing=1`. Inferred basis cannot reach a filler (write-time block).
- `permit.critical_path_duration` = longest-path sum of `statutory_days` over the `permit_edge` DAG restricted to permits with `status ∈ {'not_started','in_progress'}`, months = days ÷ 30.44 rounded to 1 decimal; NULL `statutory_days` contributes 0 duration (the permit still counts in the unresolved count). No permit rows → status `missing`.
- `permit.unresolved_on_critical_path` = count of permits on that critical path with `status ∈ {'not_started','in_progress'}`.

**Activation prerequisites (ordered)**: (1) the enum migration — `dd_finding.trl_grade`, `dd_finding.ip_ownership_status`, `certification.transferable_on_coc`, `permit.status` CHECKs, via SQLite table rebuild in the verified 0-row window, plus the companion test-write fix at `tests/unit/dd-cross-validation.test.ts:77`; (2) the filler PR for the six technical_execution vars incl. the new seventh; (3) PR-9 sets the seven rows `enabled=1` with `policy_id` and `thresholds_source` = this record, and the activation review verifies the D-M-TE-5 double-counting guard against `rag_rule_variable` join rows. **Green-cap restated**: no row above emits Green; `technical_execution` cannot grade Green, and therefore cannot contribute to an all-six-Green overall, until calibration against 5–10 historical cases completes and a deliberate Green-emitting rule is authored under a new record.

---

## Dissents registered (non-blocking)

1. **risk-officer** — 12-month permit duration cut preferred (D-M-TE-6); Amber-on-missing-cert-position rejected (D-M-TE-4). Both recorded as leading recalibration alternatives.
2. **certification-agent** — multi-level criticality weighting deferred (D-M-TE-4); accepted the definitional `load_bearing` Red rule as the v1 form, dissent reserved on whether post-calibration weighting should replace the binary.

## First-recalibration candidates (ordered)

1. Permit duration cut 18 months (vs 12) — single-anchor only.
2. TRL band edges (TRL3/4 and TRL5/6) — standard-anchored, not case-calibrated.
3. `cert.non_transferable_on_coc ≥ 1` and `permit.unresolved_on_critical_path ≥ 1` — degenerate maximal-sensitivity defaults.
4. Amber-on-missing-cert-position (if the no-skip validator proves porous).
5. FS-gate firing of the permit rule (GF-heavy calibration sets, pilots 005/007 shapes).
